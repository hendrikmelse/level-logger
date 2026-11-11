#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#include "config.h"
#include "secrets.h"

// Readings are buffered with the millis() at which they were taken. When uploading, each one is sent
// with `ago_ms` (how long before the request it was taken), so the server places it correctly even
// after an outage. The server is the clock; the device needs no real time (NTP is only used so TLS
// certificate dates can be checked).

struct Reading {
  uint32_t takenMs;
  uint16_t adc;
};

static Reading buffer[BUFFER_CAPACITY];
static size_t head = 0;   // index of the oldest reading
static size_t count = 0;  // readings held

static void push(uint16_t adc) {
  if (count == BUFFER_CAPACITY) {  // full: drop the oldest
    head = (head + 1) % BUFFER_CAPACITY;
    count--;
  }
  buffer[(head + count) % BUFFER_CAPACITY] = {millis(), adc};
  count++;
}

static void drop(size_t n) {
  head = (head + n) % BUFFER_CAPACITY;
  count -= n;
}

static uint16_t readAdc() {
  uint32_t sum = 0;
  for (int i = 0; i < OVERSAMPLE; i++) sum += analogRead(ADC_PIN);
  return sum / OVERSAMPLE;
}

static bool wifiUp() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("WiFi: connecting to %s\n", WIFI_SSID);
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) delay(100);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi: failed");
    return false;
  }
  Serial.printf("WiFi: connected, IP %s\n", WiFi.localIP().toString().c_str());
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
  return true;
}

static bool clockSet() { return time(nullptr) > 1700000000; }

// Sends up to MAX_PER_REQUEST of the oldest readings. Returns true if the buffer should move on
// (stored, or the server rejected the body so retrying would not help).
static bool sendChunk() {
  size_t n = count < MAX_PER_REQUEST ? count : MAX_PER_REQUEST;
  uint32_t now = millis();

  String body;
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
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + API_KEY);
  int status = http.POST(body);
  String reply = status > 0 ? http.getString() : http.errorToString(status);
  http.end();

  Serial.printf("POST %u readings -> %d %s\n", (unsigned)n, status, reply.c_str());
  if (status >= 200 && status < 300) {
    drop(n);
    return true;
  }
  if (status == 400) {  // body rejected: do not retry forever
    drop(n);
    return true;
  }
  if (status == 401) Serial.println("Unauthorized: check API_KEY");
  return false;
}

static void flush() {
  if (count == 0 || !wifiUp()) return;
  if (strlen(ROOT_CA) > 0 && !clockSet()) {
    Serial.println("Waiting for NTP before verifying TLS");
    return;
  }
  while (count > 0 && sendChunk()) {
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("level-logger starting");
  analogReadResolution(12);
  analogSetPinAttenuation(ADC_PIN, ADC_11db);  // full 0-~3.1 V range
  WiFi.mode(WIFI_STA);
#ifdef LOW_TX_POWER
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
#endif
}

void loop() {
  static uint32_t lastSample = 0;
  static uint32_t lastPost = 0;
  uint32_t now = millis();

  if (now - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample += SAMPLE_INTERVAL_MS;  // fixed cadence, no drift
    if (now - lastSample >= SAMPLE_INTERVAL_MS) lastSample = now;  // fell far behind (e.g. long upload)
    uint16_t v = readAdc();
    push(v);
    Serial.printf("adc=%u buffered=%u\n", v, (unsigned)count);
  }

  if (now - lastPost >= POST_INTERVAL_MS) {
    lastPost = now;
    flush();
  }
}
