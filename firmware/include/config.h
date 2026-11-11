#pragma once

// GPIO the sensor's analog output is wired to. Use GPIO0-4 (ADC1): ADC2 is unreliable with WiFi on the C3.
#define ADC_PIN 0

// One reading is the average of this many ADC conversions (reduces the C3's noisy ADC).
#define OVERSAMPLE 16

#define SAMPLE_INTERVAL_MS 1000UL  // time between readings
#define POST_INTERVAL_MS 60000UL   // time between upload attempts

// Readings kept in RAM while offline (8 bytes each). The oldest are dropped when full.
#define BUFFER_CAPACITY 3600
// Most readings sent in one request (the server accepts up to 10,800).
#define MAX_PER_REQUEST 600

#define WIFI_CONNECT_TIMEOUT_MS 20000UL
#define HTTP_TIMEOUT_MS 15000UL

// Some Super Mini boards cannot associate at full TX power (antenna design). Comment out if yours is fine.
#define LOW_TX_POWER 1
