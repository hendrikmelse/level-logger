# Firmware (ESP32-C3 Super Mini)

Reads an analog level sensor once a second and uploads the raw readings to `POST /api/ingest` about once a minute over WiFi + HTTPS. Readings are buffered in RAM (default one hour) while WiFi or the server is down, and each is sent with its age (`ago_ms`), so the server timestamps them correctly after an outage.

## Setup

1. Install [PlatformIO](https://platformio.org/install/ide?install=vscode) (VS Code extension) or the `pio` CLI.
2. Create a device key: `npm run device -- create "Sump pit"` (or `rotate-key <id>` for the existing device; the key is shown once).
3. `cp include/secrets.h.example include/secrets.h` and fill in WiFi, URL and key. `secrets.h` is gitignored.
4. Wire the sensor's analog output to GPIO0 (change `ADC_PIN` in `include/config.h`; use GPIO0-4) and share ground. The ADC reads 0 to about 3.1 V, so keep the sensor output below 3.3 V.
5. Plug in over USB and run `pio run -t upload`, then `pio device monitor`.
   If the board is not detected, hold **BOOT**, tap **RESET** (or plug in while holding BOOT), then upload.

## TLS

The server uses a Let's Encrypt certificate, and `secrets.h.example` already contains the matching root (ISRG Root X1, valid until 2035-06-04), so a copied `secrets.h` verifies the server out of the box. If Let's Encrypt changes its chain and TLS starts failing, replace it with the **root** CA that signs the server's certificate. To find it:

```
openssl s_client -showcerts -connect sump.hendrikmelse.com:443 </dev/null
```

The last certificate in the chain is the issuer; download its root from the CA (for Let's Encrypt, ISRG Root X1) and paste it as a C string. With `ROOT_CA` empty the connection is encrypted but not verified; fine for bring-up, not for leaving it running.

## Calibration

The device sends raw ADC counts. The ESP32-C3 ADC is 12-bit (0-4095), but a new device's placeholder calibration maps 0-1023 to 0-40 inches, so inches will look wrong until you calibrate. Read the `adc=` values in the serial monitor at two known depths, then:

```
npm run device -- calibrate <id> <adc1> <inches1> <adc2> <inches2>
```

Old readings keep the calibration that was in force when they were taken. The C3 ADC is noticeably non-linear near both ends; calibrate with points inside the range you actually expect.

## Behavior

- **Two tasks.** A sampler task takes a reading every second and drives the LED; `loop()` handles WiFi and uploads. Uploads (a TLS handshake is several seconds on the C3) therefore never leave gaps in the data.
- **Upload cadence.** About once a minute it uploads what was buffered when the upload began; readings taken during the upload wait for the next one. A batch is deleted from the buffer only after a 2xx (or a 400, which would never succeed). A lost response means the batch is stored twice (known limit, see CLAUDE.md).
- **WiFi.** Connects at power-up. Auto-reconnect is on, plus a fresh attempt every `WIFI_RETRY_MS` while down. NTP is restarted on every (re)connect.
- **Clock.** The TLS certificate check needs the date, so uploads are skipped until NTP has set the clock (`Upload skipped: clock not set yet`). If NTP is blocked on the network, the device never uploads.
- **LED** (external, active-high, `LED_PIN` = GPIO10; not GPIO8 = on-board LED, not GPIO9 = BOOT strapping pin): solid on = no WiFi; one short blink per reading; two short blinks after a successful upload.

## Reading the serial monitor

`pio device monitor` shows `adc=… buffered=…` each second, and at boot `last reset: <reason>` (a `BROWNOUT` or `PANIC` means the board is resetting). About once a minute a `Status:` line gives uptime, WiFi state, RSSI, clock state and buffered count, then `POST n readings -> 200 {...} (… ms)`. Run it with `python -m platformio` if `pio` is not on your PATH.

## Tuning

`include/config.h`: sample and upload intervals, oversampling, buffer size, ADC pin, LED pin and polarity, WiFi retry interval.

## Sensor

The old Arduino sketch is kept in `old/Level_Sensor.ino` for reference. Its conversion was `height = -7447.8 * (1 / (raw * 5.0 / 3.3)) + 20.916` (10-bit ADC), which is not linear in `raw`, so the server's two-point linear calibration will not reproduce it exactly. See CLAUDE.md. The sensor is a resistor divider; feed it from the board's 3V3 pin, never 5 V, because GPIO inputs must stay under 3.3 V.
