#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#include "config.h"
#include "secrets.h"

// Two tasks share the buffer. A sampler task takes a reading every SAMPLE_INTERVAL_MS and runs the
// status LED; loop() uploads. They are separate so a slow TLS handshake or a bad network never
// leaves a gap in the data (the sampler preempts the uploader).
//
// Readings are buffered with the millis() at which they were taken. When uploading, each one is sent
// with `ago_ms` (how long before the request it was taken), so the server places it correctly even
// after an outage. The server is the clock; the device needs no real time (NTP is only used so TLS
// certificate dates can be checked).

struct Reading {
  uint32_t takenMs;
  uint16_t adc;
};

static Reading buffer[BUFFER_CAPACITY];
static size_t head = 0;      // index of the oldest reading
static size_t count = 0;     // readings held
static uint32_t headSeq = 0; // bumped every time a reading leaves the front of the buffer
static SemaphoreHandle_t bufLock;

// Remove n readings from the front. Caller holds bufLock.
static void dropFront(size_t n) {
  head = (head + n) % BUFFER_CAPACITY;
  count -= n;
  headSeq += n;
}

static void push(uint16_t adc) {
  xSemaphoreTake(bufLock, portMAX_DELAY);
  if (count == BUFFER_CAPACITY) dropFront(1);  // full: lose the oldest
  buffer[(head + count) % BUFFER_CAPACITY] = {millis(), adc};
  count++;
  xSemaphoreGive(bufLock);
}

// Status LED, driven without delay(). One blink per reading, two after a successful upload.
// Requests don't stack: the larger count wins.
static volatile uint8_t pendingBlinks = 0;
static bool ledOn = false;
static uint32_t ledChangedAt = 0;

static void setLed(bool on) {
  ledOn = on;
  digitalWrite(LED_PIN, on ? LED_ON_LEVEL : !LED_ON_LEVEL);
}

static void blink(uint8_t n) {
  if (n > pendingBlinks) pendingBlinks = n;
}

static void ledService() {
  // No WiFi: solid on, until the connection is back.
  if (WiFi.status() != WL_CONNECTED) {
    if (!ledOn) setLed(true);
    return;
  }
  uint32_t now = millis();
  if (ledOn) {
    if (now - ledChangedAt >= LED_ON_MS) {
      setLed(false);
      ledChangedAt = now;
    }
  } else if (pendingBlinks > 0 && now - ledChangedAt >= LED_OFF_MS) {
    setLed(true);
    pendingBlinks = pendingBlinks - 1;
    ledChangedAt = now;
  }
}

static uint16_t readAdc() {
  uint32_t sum = 0;
  for (int i = 0; i < OVERSAMPLE; i++) sum += analogRead(ADC_PIN);
  return sum / OVERSAMPLE;
}

static void samplerTask(void*) {
  uint32_t next = millis();
  for (;;) {
    uint32_t now = millis();
    if ((int32_t)(now - next) >= 0) {
      next += SAMPLE_INTERVAL_MS;  // fixed cadence, no drift
      uint16_t v = readAdc();
      push(v);
      blink(1);
      Serial.printf("adc=%u buffered=%u\n", v, (unsigned)count);
    }
    ledService();
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

static bool wifiConnected() { return WiFi.status() == WL_CONNECTED; }

static bool clockSet() { return time(nullptr) > 1700000000; }

static uint32_t lastWifiAttempt = 0;

static void wifiBegin() {
  lastWifiAttempt = millis();
  Serial.printf("WiFi: connecting to %s\n", WIFI_SSID);
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// Called from loop(). Never blocks: it notices connects and drops, restarts NTP whenever the
// connection comes back, and starts a fresh attempt every WIFI_RETRY_MS while down (a backstop to
// the stack's own auto-reconnect, which can give up).
static void wifiMaintain() {
  static bool wasUp = false;
  static bool clockReported = false;
  bool up = wifiConnected();

  if (up && !wasUp) {
    Serial.printf("WiFi: connected, IP %s\n", WiFi.localIP().toString().c_str());
    configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");  // (re)start the clock sync
  } else if (!up && wasUp) {
    Serial.println("WiFi: connection lost");
  }
  wasUp = up;

  if (!up && millis() - lastWifiAttempt >= WIFI_RETRY_MS) wifiBegin();

  if (!clockReported && clockSet()) {
    clockReported = true;
    time_t t = time(nullptr);
    char buf[32];
    strftime(buf, sizeof buf, "%Y-%m-%d %H:%M:%S UTC", gmtime(&t));
    Serial.printf("Clock set via NTP: %s\n", buf);
  }
}

// Sends up to `limit` (and at most MAX_PER_REQUEST) of the oldest readings. Returns how many were
// dealt with: stored, or rejected by the server so retrying would not help. Returns 0 on failure,
// leaving them buffered for the next attempt.
static size_t sendChunk(size_t limit) {
  // Snapshot the oldest readings into the request body while holding the lock, then release it so
  // sampling continues during the (slow) network request.
  String body;
  size_t n;
  uint32_t firstSeq;
  xSemaphoreTake(bufLock, portMAX_DELAY);
  n = count < MAX_PER_REQUEST ? count : MAX_PER_REQUEST;
  if (n > limit) n = limit;
  firstSeq = headSeq;
  uint32_t now = millis();
  body.reserve(n * 32 + 16);
  body = "{\"readings\":[";
  for (size_t i = 0; i < n; i++) {
    const Reading& r = buffer[(head + i) % BUFFER_CAPACITY];
    if (i) body += ',';
    body += "{\"adc\":";
    body += r.adc;
    body += ",\"ago_ms\":";
    body += (uint32_t)(now - r.takenMs);
    body += '}';
  }
  body += "]}";
  xSemaphoreGive(bufLock);
  if (n == 0) return 0;

  uint32_t started = millis();
  WiFiClientSecure client;
  if (strlen(ROOT_CA) > 0) {
    client.setCACert(ROOT_CA);
  } else {
    Serial.println("WARNING: ROOT_CA empty, server certificate is NOT verified");
    client.setInsecure();
  }

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, INGEST_URL)) {
    Serial.println("HTTP: begin failed");
    return 0;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + API_KEY);
  int status = http.POST(body);
  String reply = status > 0 ? http.getString() : http.errorToString(status);
  http.end();

  Serial.printf("POST %u readings -> %d %s (%lu ms)\n", (unsigned)n, status, reply.c_str(),
                (unsigned long)(millis() - started));

  bool done = (status >= 200 && status < 300) || status == 400;  // 400: body rejected, don't retry forever
  if (done) {
    // Some of the readings we sent may already have been pushed out of a full buffer meanwhile.
    xSemaphoreTake(bufLock, portMAX_DELAY);
    size_t alreadyGone = headSeq - firstSeq;
    size_t toDrop = n > alreadyGone ? n - alreadyGone : 0;
    if (toDrop > count) toDrop = count;
    dropFront(toDrop);
    xSemaphoreGive(bufLock);
    if (status < 300) blink(2);
    return n;
  }
  if (status == 401) Serial.println("Unauthorized: check API_KEY");
  return 0;
}

// Uploads what is buffered right now. Readings taken while the upload runs wait for the next one;
// chasing them would mean uploading back to back forever.
static void flush() {
  size_t remaining = count;
  Serial.printf("Status: uptime=%lus wifi=%s rssi=%d clock=%s buffered=%u\n", millis() / 1000,
                wifiConnected() ? "up" : "down", wifiConnected() ? WiFi.RSSI() : 0,
                clockSet() ? "set" : "NOT set", (unsigned)remaining);
  if (remaining == 0) return;
  if (!wifiConnected()) {
    Serial.println("Upload skipped: no WiFi");
    return;
  }
  if (strlen(ROOT_CA) > 0 && !clockSet()) {
    Serial.println("Upload skipped: clock not set yet (needs NTP to check the certificate dates)");
    return;
  }
  while (remaining > 0) {
    size_t sent = sendChunk(remaining);
    if (sent == 0) break;
    remaining -= sent;
  }
}

static const char* resetReasonName(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_SW: return "software reset";
    case ESP_RST_PANIC: return "PANIC (crash)";
    case ESP_RST_INT_WDT: return "interrupt watchdog";
    case ESP_RST_TASK_WDT: return "task watchdog";
    case ESP_RST_WDT: return "other watchdog";
    case ESP_RST_BROWNOUT: return "BROWNOUT (supply sagged)";
    case ESP_RST_DEEPSLEEP: return "deep sleep wake";
    default: return "other";
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.printf("level-logger starting, last reset: %s\n", resetReasonName(esp_reset_reason()));
  pinMode(LED_PIN, OUTPUT);
  setLed(false);
  analogReadResolution(12);
  analogSetPinAttenuation(ADC_PIN, ADC_11db);  // full 0-~3.1 V range
  WiFi.persistent(false);  // don't write credentials to flash on every connect
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
#ifdef LOW_TX_POWER
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
#endif
  wifiBegin();  // connect right away, before the first upload is due

  bufLock = xSemaphoreCreateMutex();
  // Higher priority than loop() (1) so sampling preempts the uploader.
  xTaskCreate(samplerTask, "sampler", 4096, nullptr, 2, nullptr);
}

void loop() {
  static uint32_t lastPost = 0;
  wifiMaintain();
  if (millis() - lastPost >= POST_INTERVAL_MS) {
    lastPost = millis();
    flush();
  }
  delay(50);
}
