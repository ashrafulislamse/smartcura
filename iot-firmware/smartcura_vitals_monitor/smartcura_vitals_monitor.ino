/*
 * SmartCura Vitals Monitor — Complete Firmware
 *
 * ESP32 (DOIT DEVKIT V1) reads MAX30102 (HR/SpO2) + DS18B20 (body temp),
 * renders to a 1.3" SSD1306 128x64 OLED, and publishes vitals packets to the
 * SmartCura MQTT broker over WebSocket on port 9001.
 *
 * Hardware:
 *   MAX30102   I2C 0x57   SDA=GPIO21  SCL=GPIO22  (3.3V only!)
 *   SSD1306    I2C 0x3C   SDA=GPIO21  SCL=GPIO22  (shared bus)
 *   DS18B20    1-Wire     DATA=GPIO5               (4.7k pull-up to 3.3V)
 *
 * Payload shape (published to smartcura/v1/devices/{device_id}/vitals):
 *   {
 *     "boot_id": 17,
 *     "recorded_at": "2026-08-12T04:25:00+08:00",
 *     "metrics": [
 *       { "sequence_no": 1, "metric": "heart_rate",        "value": 72.0, "unit": "/min", "quality": "valid" },
 *       { "sequence_no": 2, "metric": "oxygen_saturation",  "value": 98.0, "unit": "%",    "quality": "valid" },
 *       { "sequence_no": 3, "metric": "body_temperature",   "value": 36.6, "unit": "C",    "quality": "valid" }
 *     ]
 *   }
 *
 * If no finger is on the MAX30102, metrics=0 and the publish is skipped
 * (the backend rejects empty metrics arrays).
 */

#include <Wire.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <Preferences.h>          // NVS for boot_id persistence
#include <time.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>
#include <HTTPUpdate.h>
#include "MAX30105.h"
#include "spo2_algorithm.h"
#include <OneWire.h>
#include <DallasTemperature.h>
#include <U8g2lib.h>
#include "MqttWsClient.h"
#include "secrets.h"
#include "ble_provisioning.h"

// Provisioning PIN is burned at factory flash time. Allow a fallback so a
// legacy secrets.h without the macro still compiles (the factory script will
// set the real value on the next flash).
#ifndef PROVISIONING_PIN
#define PROVISIONING_PIN "00000000"
#endif

// ── Firmware version (bumped for every release build) ──────────────
// The backend version-check endpoint compares this against the latest
// published firmware for the hardware profile. Change it for each build
// so the device can tell whether an OTA update is available.
#define FIRMWARE_VERSION      "1.0.3"
#define HARDWARE_PROFILE      "smartcura_esp32_v1"

// ── Pin assignments ────────────────────────────────────────────────
#define DS18B20_PIN          5
#define I2C_SDA              21
#define I2C_SCL              22
#define OLED_ADDR            0x3C
#define OLED_WIDTH           128
#define OLED_HEIGHT          64
#define SETUP_BUTTON_PIN     4    // External setup/reset button (active LOW)
#define SETUP_BUTTON_HOLD_MS 3000 // hold 3 s to clear Wi-Fi and restart

// ── Sensor tuning ──────────────────────────────────────────────────
#define SAMPLES_PER_CYCLE   100
#define TEMP_INTERVAL_MS   5000
#define FINGER_THRESHOLD   12000      // IR reading below this = no finger (lowered from 50000 for reliable detection on DOIT DevKit V1)

// ── MQTT ───────────────────────────────────────────────────────────
#define MQTT_TOPIC_PREFIX  "smartcura/v1/devices/"
#define MQTT_TOPIC_SUFFIX  "/vitals"
#define MQTT_LWT_TOPIC     "smartcura/v1/devices/" DEVICE_ID "/status"
#define MQTT_LWT_PAYLOAD   "offline"
#define MQTT_PUBLISH_MS    5000       // publish every 5 s when finger present
#define MQTT_TEMP_PUBLISH_MS 30000     // publish temp-only every 30 s (no finger needed)
#define MQTT_FIRMWARE_TOPIC "smartcura/v1/devices/" DEVICE_ID "/firmware-events"

// ── OTA firmware update ────────────────────────────────────────────
// The device polls the backend version-check endpoint on boot and once an
// hour. If a newer firmware is published, it downloads and flashes it via
// ESPhttpUpdate, then reboots. Firmware events are published to MQTT so the
// backend (and the patient app) can follow the update progress.
#define OTA_API_HOST         "api.smartcura.app"
#define OTA_API_VERSION_PATH "/api/v1/firmware/versions/" HARDWARE_PROFILE
#define OTA_CHECK_INTERVAL_MS (60UL * 60UL * 1000UL)  // 1 hour
#define OTA_HTTPS_TIMEOUT_MS  15000

// ── Objects ────────────────────────────────────────────────────────
MAX30105 particleSensor;
OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);
U8G2_SSD1306_128X64_NONAME_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE);
MqttWsClient wsClient;
PubSubClient mqttClient(wsClient);
Preferences nvs;

// ── State ──────────────────────────────────────────────────────────
uint32_t irBuffer[SAMPLES_PER_CYCLE];
uint32_t redBuffer[SAMPLES_PER_CYCLE];
int32_t  spo2 = 0;
int8_t   validSPO2 = 0;
int32_t  heartRate = 0;
int8_t   validHeartRate = 0;

float    lastTempC = 0.0;
bool     tempSensorOK = false;
bool     max30102OK = false;
bool     oledOK = false;

unsigned long lastTempRead = 0;
unsigned long lastPublish = 0;
uint32_t      bootId = 0;
uint32_t      seqNo = 0;

// ── OTA state ──────────────────────────────────────────────────────
unsigned long lastOtaCheck = 0;
bool          otaUpdateInProgress = false;
WiFiClientSecure otaSecureClient;

// ── Provisioning / Wi-Fi state (stored in NVS) ───────────────────
String wifiSsid;                              // loaded from NVS
String wifiPassword;                          // loaded from NVS
String provisioningState;                     // "normal" or "provisioning"
bool   provisioningMode = false;              // true when Wi-Fi needs setup
int    setupButtonState = HIGH;               // active LOW
unsigned long setupButtonPressedAt = 0;       // ms when button first went LOW
char   provisioningStatusMsg[32] = "Enter PIN in app"; // current BLE prov state

char mqttTopic[80];

// ── Boot ID (monotonic, persisted in NVS) ──────────────────────────
void loadBootId() {
  nvs.begin("smartcura", false);
  bootId = nvs.getULong("boot_id", 0);
  bootId++;
  nvs.putULong("boot_id", bootId);
  nvs.end();
  Serial.printf("[BOOT] bootId=%lu\n", (unsigned long)bootId);
}

// ── Provisioning / Wi-Fi credentials (NVS) ─────────────────────────
// Wi-Fi credentials and the provisioning state are the only changeable values
// stored in NVS. Permanent values (device_id, mqtt_secret, hardware_profile,
// provisioning_pin) remain compile-time defines from secrets.h and are not
// erased when the device is reused by another patient.

void loadWiFiCredentials() {
  nvs.begin("smartcura", false);
  wifiSsid = nvs.getString("wifi_ssid", "");
  wifiPassword = nvs.getString("wifi_password", "");
  // NVS key names are limited to 15 characters, so we use "prov_state" instead
  // of "provisioning_state".
  bool stateKeyExists = nvs.isKey("prov_state");
  provisioningState = nvs.getString("prov_state", "provisioning");
  nvs.end();

  // First-boot migration: if NVS is empty or has no prov_state key, copy the
  // compile-time credentials from secrets.h so the device keeps working after the
  // firmware update. This only matters once; after the first successful save,
  // secrets.h Wi-Fi values are ignored unless the device is factory-reset.
  // If the user explicitly cleared Wi-Fi (e.g., GPIO4 setup/reset button), the
  // stored prov_state is "provisioning" and we must stay in provisioning mode.
  if (wifiSsid.length() == 0) {
    if (stateKeyExists && provisioningState == "provisioning") {
      Serial.println(F("[PROV] provisioning mode — Wi-Fi cleared, waiting for BLE setup"));
    } else {
      wifiSsid = String(WIFI_SSID);
      wifiPassword = String(WIFI_PASSWORD);
      provisioningState = "normal";
      if (wifiSsid.length() > 0 && wifiSsid != "YOUR_WIFI_SSID") {
        nvs.begin("smartcura", false);
        nvs.putString("wifi_ssid", wifiSsid);
        nvs.putString("wifi_password", wifiPassword);
        nvs.putString("prov_state", provisioningState);
        nvs.end();
        Serial.println(F("[PROV] migrated compile-time Wi-Fi credentials to NVS"));
      } else {
        provisioningState = "provisioning";
        Serial.println(F("[PROV] no Wi-Fi credentials in NVS or secrets.h"));
      }
    }
  } else if (!stateKeyExists) {
    // Wi-Fi credentials exist but prov_state was missing (e.g. firmware update
    // from a version that did not write this key). Preserve the stored Wi-Fi
    // and mark the device as normal.
    provisioningState = "normal";
    nvs.begin("smartcura", false);
    nvs.putString("prov_state", provisioningState);
    nvs.end();
    Serial.println(F("[PROV] migrated missing provisioning state to normal"));
  }

  provisioningMode = (provisioningState == "provisioning" || wifiSsid.length() == 0);
  Serial.printf("[PROV] state=%s ssid=%s\n",
                provisioningMode ? "provisioning" : "normal",
                provisioningMode ? "<unset>" : wifiSsid.c_str());
}

void saveWiFiCredentials(const String& ssid, const String& password) {
  nvs.begin("smartcura", false);
  nvs.putString("wifi_ssid", ssid);
  nvs.putString("wifi_password", password);
  nvs.putString("prov_state", "normal");
  nvs.end();
  wifiSsid = ssid;
  wifiPassword = password;
  provisioningState = "normal";
  provisioningMode = false;
  Serial.println(F("[PROV] Wi-Fi credentials saved to NVS"));
}

void clearWiFiCredentials() {
  nvs.begin("smartcura", false);
  nvs.putString("wifi_ssid", "");
  nvs.putString("wifi_password", "");
  nvs.putString("prov_state", "provisioning");
  nvs.end();
  wifiSsid = "";
  wifiPassword = "";
  provisioningState = "provisioning";
  provisioningMode = true;
  Serial.println(F("[PROV] Wi-Fi credentials cleared"));
}

void enterProvisioningMode() {
  provisioningMode = true;
  Serial.println(F("[PROV] entering provisioning mode"));
  oledShowProvisioningStatus();
}

void startProvisioningAfterFailure() {
  Serial.println(F("[PROV] Wi-Fi connection failed — starting BLE provisioning"));
  provisioningMode = true;
  provisioningState = "provisioning";
  nvs.begin("smartcura", false);
  nvs.putString("prov_state", "provisioning");
  nvs.end();
  initProvisioningBLE();
  startProvisioningAdvertising();
  enterProvisioningMode();
}

void setProvisioningStatus(const char* status) {
  strlcpy(provisioningStatusMsg, status, sizeof(provisioningStatusMsg));
  oledShowProvisioningStatus();
}

void oledShowProvisioningStatus() {
  if (!oledOK) return;
  char buf[48];
  display.clearBuffer();
  display.setFont(u8g2_font_6x10_tf);
  display.drawStr(0, 12, "SmartCura Setup");
  display.drawStr(0, 26, provisioningStatusMsg);

  String deviceIdStr = String(DEVICE_ID);
  String suffix = deviceIdStr.substring(deviceIdStr.length() - 4);
  snprintf(buf, sizeof(buf), "Device: %s", suffix.c_str());
  display.drawStr(0, 40, buf);

  if (wifiSsid.length() > 0) {
    snprintf(buf, sizeof(buf), "WiFi: %s", wifiSsid.c_str());
  } else {
    snprintf(buf, sizeof(buf), "Open app + enter PIN");
  }
  display.drawStr(0, 54, buf);
  display.sendBuffer();
}

void handleSetupButton() {
  // The setup/reset button is active LOW. It is connected to a non-strapping
  // GPIO (GPIO4) so it can be held at any time without affecting the ESP32
  // boot mode. After setup() has run we sample it to trigger a Wi-Fi reset.
  int reading = digitalRead(SETUP_BUTTON_PIN);
  if (reading == LOW && setupButtonState == HIGH) {
    setupButtonState = LOW;
    setupButtonPressedAt = millis();
  } else if (reading == LOW && setupButtonState == LOW) {
    if (millis() - setupButtonPressedAt >= SETUP_BUTTON_HOLD_MS) {
      Serial.println(F("[BUTTON] held — clearing Wi-Fi and restarting"));
      if (oledOK) {
        oledShow("Resetting", "Clearing Wi-Fi", "Restarting...", nullptr);
      }
      clearWiFiCredentials();
      delay(500);
      ESP.restart();
    }
  } else if (reading == HIGH) {
    setupButtonState = HIGH;
  }
}

// ── OLED helpers ───────────────────────────────────────────────────
void oledShow(const char* l1, const char* l2, const char* l3, const char* l4) {
  if (!oledOK) return;
  display.clearBuffer();
  display.setFont(u8g2_font_6x10_tf);
  if (l1) display.drawStr(0, 12, l1);
  if (l2) display.drawStr(0, 26, l2);
  if (l3) display.drawStr(0, 40, l3);
  if (l4) display.drawStr(0, 54, l4);
  display.sendBuffer();
}

void oledShowVitals(int hr, int sp, float temp, bool finger) {
  if (!oledOK) return;
  char buf[48];
  display.clearBuffer();
  display.setFont(u8g2_font_6x10_tf);

  if (!finger) {
    display.drawStr(0, 12, "Place finger on sensor");
    display.drawStr(0, 26, max30102OK ? "HR sensor OK" : "HR sensor FAIL");
    snprintf(buf, sizeof(buf), "Temp:%s", tempSensorOK ? "OK" : "FAIL");
    display.drawStr(0, 40, buf);
    snprintf(buf, sizeof(buf), "WiFi:%s MQTT:%s",
             WiFi.status() == WL_CONNECTED ? "OK" : "--",
             mqttClient.connected() ? "OK" : "--");
    display.drawStr(0, 54, buf);
    display.sendBuffer();
    return;
  }

  snprintf(buf, sizeof(buf), "HR:%d  SpO2:%d%%", hr, sp);
  display.drawStr(0, 12, buf);
  snprintf(buf, sizeof(buf), "Temp:%.1fC", temp);
  display.drawStr(0, 26, buf);
  snprintf(buf, sizeof(buf), "WiFi:%s MQTT:%s",
           WiFi.status() == WL_CONNECTED ? "OK" : "--",
           mqttClient.connected() ? "OK" : "--");
  display.drawStr(0, 40, buf);
  snprintf(buf, sizeof(buf), "Pub:%lus ago", (millis() - lastPublish) / 1000);
  display.drawStr(0, 54, buf);
  display.sendBuffer();
}

// ── WiFi ───────────────────────────────────────────────────────────
bool connectWiFi() {
  if (wifiSsid.length() == 0) {
    Serial.println(F("[WIFI] no SSID stored — skipping WiFi connection"));
    return false;
  }
  Serial.printf("[WIFI] connecting to %s", wifiSsid.c_str());
  oledShow("Connecting", "WiFi...", wifiSsid.c_str(), nullptr);
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] connected, IP=%s\n", WiFi.localIP().toString().c_str());
    oledShow("WiFi OK", WiFi.localIP().toString().c_str(), "Syncing NTP...", nullptr);
    return true;
  } else {
    Serial.println(F("\n[WIFI] FAILED — continuing without WiFi"));
    oledShow("WiFi FAILED", "No network", "Sensors only", nullptr);
    return false;
  }
}

bool reconnectWiFi() {
  if (wifiSsid.length() == 0) return false;
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.printf("[WIFI] reconnecting to %s", wifiSsid.c_str());
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] reconnected, IP=%s\n", WiFi.localIP().toString().c_str());
    return true;
  } else {
    Serial.println(F("\n[WIFI] reconnect failed"));
    return false;
  }
}

// ── NTP ────────────────────────────────────────────────────────────
void syncNTP() {
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.println(F("[NTP] syncing time..."));
  configTime(TZ_OFFSET_MIN * 60, 0, "pool.ntp.org", "time.nist.gov");

  int attempts = 0;
  while (time(nullptr) < 1700000000 && attempts < 20) {
    delay(500);
    attempts++;
  }

  time_t now = time(nullptr);
  if (now > 1700000000) {
    struct tm* t = localtime(&now);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", t);
    Serial.printf("[NTP] synced: %s\n", buf);
  } else {
    Serial.println(F("[NTP] FAILED — timestamps will be wrong"));
  }
}

// ── Format ISO-8601 timestamp ──────────────────────────────────────
void formatTimestamp(char* buf, size_t len) {
  time_t now = time(nullptr);
  if (now < 1700000000) {
    // NTP not synced — use uptime as fallback
    snprintf(buf, len, "1970-01-01T00:00:00+00:00");
    return;
  }
  struct tm* t = localtime(&now);
  int offset = TZ_OFFSET_MIN;
  int hours = offset / 60;
  int mins = offset % 60;
  char sign = (offset >= 0) ? '+' : '-';
  if (offset < 0) { hours = -hours; mins = -mins; }
  snprintf(buf, len, "%04d-%02d-%02dT%02d:%02d:%02d%c%02d:%02d",
           t->tm_year + 1900, t->tm_mon + 1, t->tm_mday,
           t->tm_hour, t->tm_min, t->tm_sec,
           sign, hours, mins);
}

// ── MQTT connect ───────────────────────────────────────────────────
void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.printf("[MQTT] opening WebSocket to %s:%u/mqtt ...\n", MQTT_HOST, MQTT_PORT);

  wsClient.begin(MQTT_HOST, MQTT_PORT, "/mqtt", "mqtt");

  // PubSubClient needs to know the server host/port (it resolves DNS
  // internally and calls our Client::connect(host, port)).
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setBufferSize(1024);

  String clientId = "esp32-";
  clientId += DEVICE_ID;

  bool ok = mqttClient.connect(
    clientId.c_str(),
    MQTT_USERNAME,
    MQTT_PASSWORD,
    MQTT_LWT_TOPIC,
    1,           // QoS 1 for LWT
    true,        // retain LWT
    MQTT_LWT_PAYLOAD
  );

  if (ok) {
    Serial.println(F("[MQTT] connected"));
    // Clear the LWT by publishing "online" to the status topic
    mqttClient.publish(MQTT_LWT_TOPIC, "online", true);
  } else {
    Serial.printf("[MQTT] FAILED, state=%d\n", mqttClient.state());
    // state codes: -4 = timeout, -2 = no server, 1 = bad protocol,
    //              2 = bad client id, 3 = broker unavailable,
    //              4 = bad username/password, 5 = not authorized
  }
}

// ── Publish vitals ─────────────────────────────────────────────────
void publishVitals(int hr, int sp, float temp, bool hrValid, bool spValid) {
  char timestamp[32];
  formatTimestamp(timestamp, sizeof(timestamp));

  // Count valid metrics
  int metricCount = 0;
  if (hrValid && hr > 0)   metricCount++;
  if (spValid && sp > 0)   metricCount++;
  if (tempSensorOK && temp > 0) metricCount++;

  if (metricCount == 0) {
    Serial.println(F("[PUBLISH] no valid metrics — skipping"));
    return;
  }

  // Build JSON payload manually (avoiding ArduinoJson dependency)
  char payload[512];
  int pos = 0;

  pos += snprintf(payload + pos, sizeof(payload) - pos,
    "{\"boot_id\":%lu,\"recorded_at\":\"%s\",\"metrics\":[",
    (unsigned long)bootId, timestamp);

  bool first = true;

  if (hrValid && hr > 0) {
    seqNo++;
    pos += snprintf(payload + pos, sizeof(payload) - pos,
      "%s{\"sequence_no\":%lu,\"metric\":\"heart_rate\",\"value\":%.1f,\"unit\":\"/min\",\"quality\":\"valid\"}",
      first ? "" : ",", (unsigned long)seqNo, (float)hr);
    first = false;
  }

  if (spValid && sp > 0) {
    seqNo++;
    pos += snprintf(payload + pos, sizeof(payload) - pos,
      "%s{\"sequence_no\":%lu,\"metric\":\"oxygen_saturation\",\"value\":%.1f,\"unit\":\"%%\",\"quality\":\"valid\"}",
      first ? "" : ",", (unsigned long)seqNo, (float)sp);
    first = false;
  }

  if (tempSensorOK && temp > 0) {
    seqNo++;
    pos += snprintf(payload + pos, sizeof(payload) - pos,
      "%s{\"sequence_no\":%lu,\"metric\":\"body_temperature\",\"value\":%.2f,\"unit\":\"Cel\",\"quality\":\"valid\"}",
      first ? "" : ",", (unsigned long)seqNo, temp);
    // NOTE: unit must be UCUM "Cel" not "C" — the backend CHECK constraint rejects non-UCUM units
    first = false;
  }

  pos += snprintf(payload + pos, sizeof(payload) - pos, "]}");

  Serial.printf("[PUBLISH] topic=%s len=%d\n", mqttTopic, pos);
  Serial.println(payload);

  bool published = mqttClient.publish(mqttTopic, payload, false);
  if (published) {
    Serial.println(F("[PUBLISH] OK"));
  } else {
    Serial.println(F("[PUBLISH] FAILED — packet too large or disconnected"));
  }
}

// ── OTA firmware update ─────────────────────────────────────────────
//
// checkForUpdate() polls GET /api/v1/firmware/versions/{hardwareProfile}
// with the device's current_version. The backend returns the latest
// published firmware and whether an update is available. When one is, the
// device resolves the presigned download URL from
// /api/v1/firmware/versions/{id}/download and hands it to ESPhttpUpdate,
// which streams the binary into flash and reboots.
//
// Firmware events are published to the device's firmware-events MQTT topic
// so the backend and the patient app can follow update progress:
//   update_check, update_downloading, update_installing,
//   update_success, update_failed.
//
// The OTA flow is deliberately non-blocking of vitals publishing except
// during the actual flash, which ESPhttpUpdate performs synchronously and
// which ends in a reboot — the device stops publishing only for the brief
// flash window, then resumes on the new firmware.

void publishFirmwareEvent(const char* eventType, const char* detail) {
  if (!mqttClient.connected()) return;

  char timestamp[32];
  formatTimestamp(timestamp, sizeof(timestamp));

  char payload[256];
  if (detail != nullptr && detail[0] != '\0') {
    snprintf(payload, sizeof(payload),
      "{\"device_id\":\"%s\",\"event\":\"%s\",\"firmware_version\":\"%s\",\"detail\":\"%s\",\"occurred_at\":\"%s\"}",
      DEVICE_ID, eventType, FIRMWARE_VERSION, detail, timestamp);
  } else {
    snprintf(payload, sizeof(payload),
      "{\"device_id\":\"%s\",\"event\":\"%s\",\"firmware_version\":\"%s\",\"occurred_at\":\"%s\"}",
      DEVICE_ID, eventType, FIRMWARE_VERSION, timestamp);
  }

  bool ok = mqttClient.publish(MQTT_FIRMWARE_TOPIC, payload, false);
  Serial.printf("[OTA] event %s published=%d\n", eventType, ok ? 1 : 0);
}

// Minimal JSON field extractor for the version-check response. The response
// shape is flat (latest_version, update_available, firmware_version_id), so a
// full parser is unnecessary and ArduinoJson is reserved for the richer
// download response. Returns true and fills outBuf if the field is found.
bool extractJsonString(const String& json, const char* field, String& outBuf) {
  String needle = String("\"") + field + "\":\"";
  int start = json.indexOf(needle);
  if (start < 0) return false;
  start += needle.length();
  int end = json.indexOf('"', start);
  if (end < 0) return false;
  outBuf = json.substring(start, end);
  return true;
}

bool extractJsonBool(const String& json, const char* field, bool& outBuf) {
  String needle = String("\"") + field + "\":";
  int start = json.indexOf(needle);
  if (start < 0) return false;
  start += needle.length();
  // Skip whitespace
  while (start < (int)json.length() && json.charAt(start) == ' ') start++;
  if (json.substring(start, start + 4) == "true") { outBuf = true; return true; }
  if (json.substring(start, start + 5) == "false") { outBuf = false; return true; }
  return false;
}

void triggerOtaUpdate(const String& firmwareVersionId) {
  otaUpdateInProgress = true;
  publishFirmwareEvent("update_downloading", nullptr);
  oledShow("OTA Update", "Downloading...", firmwareVersionId.c_str(), nullptr);

  // Step 1: resolve the presigned download URL.
  String downloadPath = String("/api/v1/firmware/versions/") + firmwareVersionId + "/download";
  HTTPClient http;
  http.setTimeout(OTA_HTTPS_TIMEOUT_MS);
  if (!http.begin(otaSecureClient, OTA_API_HOST, 443, downloadPath, true)) {
    Serial.println(F("[OTA] failed to begin download-url request"));
    publishFirmwareEvent("update_failed", "download_url_request_failed");
    otaUpdateInProgress = false;
    return;
  }
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[OTA] download-url HTTP %d\n", code);
    char detail[32];
    snprintf(detail, sizeof(detail), "download_url_http_%d", code);
    publishFirmwareEvent("update_failed", detail);
    http.end();
    otaUpdateInProgress = false;
    return;
  }
  String downloadBody = http.getString();
  http.end();

  String downloadUrl;
  if (!extractJsonString(downloadBody, "url", downloadUrl)) {
    Serial.println(F("[OTA] download response missing url"));
    publishFirmwareEvent("update_failed", "download_url_missing");
    otaUpdateInProgress = false;
    return;
  }
  String expectedSha;
  extractJsonString(downloadBody, "sha256", expectedSha);

  Serial.printf("[OTA] download url: %s\n", downloadUrl.c_str());

  // Step 2: hand the presigned URL to ESPhttpUpdate, which streams the
  // binary into flash. This call blocks and reboots on success.
  publishFirmwareEvent("update_installing", nullptr);
  oledShow("OTA Update", "Installing...", "Do not unplug", nullptr);

  WiFiClientSecure updateClient;
  updateClient.setInsecure();   // trust the presigned-URL host (R2/S3)

  HTTPUpdateResult ret = httpUpdate.update(updateClient, downloadUrl);

  // On success the device reboots inside update(), so the lines below only
  // run on a failure that did not corrupt flash.
  switch (ret) {
    case HTTP_UPDATE_OK:
      // Should not reach here (a successful update reboots), but handle it.
      publishFirmwareEvent("update_success", nullptr);
      Serial.println(F("[OTA] update succeeded (reboot pending)"));
      delay(500);
      ESP.restart();
      break;
    case HTTP_UPDATE_FAILED:
      Serial.printf("[OTA] update failed: %s\n",
                    httpUpdate.getLastErrorString().c_str());
      {
        char detail[48];
        snprintf(detail, sizeof(detail), "flash_error_%d",
                 httpUpdate.getLastError());
        publishFirmwareEvent("update_failed", detail);
      }
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println(F("[OTA] no updates (server reported none)"));
      publishFirmwareEvent("update_failed", "no_updates");
      break;
  }
  otaUpdateInProgress = false;
}

void checkForUpdate() {
  if (otaUpdateInProgress) return;
  if (WiFi.status() != WL_CONNECTED) return;

  publishFirmwareEvent("update_check", nullptr);
  Serial.printf("[OTA] checking %s%s\n", OTA_API_HOST, OTA_API_VERSION_PATH);

  // The backend version-check endpoint is authenticated via the session
  // cookie. The ESP32 does not hold a patient/admin session, so for the FYP
  // demo the version-check route is reachable by any authenticated caller;
  // a production deployment would mint a short-lived device token. The
  // presigned download URL the device then fetches is capability-bound and
  // expires, so the unauthenticated check leaks only the existence of a
  // new version, not the artifact.
  HTTPClient http;
  http.setTimeout(OTA_HTTPS_TIMEOUT_MS);
  String fullPath = String(OTA_API_VERSION_PATH) + "?current_version=" FIRMWARE_VERSION;
  if (!http.begin(otaSecureClient, OTA_API_HOST, 443, fullPath, true)) {
    Serial.println(F("[OTA] failed to begin version-check request"));
    return;
  }
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[OTA] version-check HTTP %d\n", code);
    http.end();
    return;
  }
  String body = http.getString();
  http.end();

  Serial.printf("[OTA] version-check response: %s\n", body.c_str());

  bool updateAvailable = false;
  if (!extractJsonBool(body, "update_available", updateAvailable)) {
    Serial.println(F("[OTA] response missing update_available"));
    return;
  }
  if (!updateAvailable) {
    Serial.println(F("[OTA] up to date"));
    return;
  }

  String latestVersion;
  extractJsonString(body, "latest_version", latestVersion);
  String firmwareVersionId;
  if (!extractJsonString(body, "firmware_version_id", firmwareVersionId)) {
    Serial.println(F("[OTA] update available but firmware_version_id missing"));
    publishFirmwareEvent("update_failed", "version_id_missing");
    return;
  }

  Serial.printf("[OTA] update available: %s -> %s\n",
                FIRMWARE_VERSION, latestVersion.c_str());
  triggerOtaUpdate(firmwareVersionId);
}

// ── Setup ──────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println(F("\n===================================="));
  Serial.println(F("  SmartCura Vitals Monitor"));
  Serial.println(F("  Complete (WiFi + MQTT + OLED)"));
  Serial.println(F("====================================\n"));

  loadBootId();

  // Load Wi-Fi credentials and provisioning state from NVS before any network
  // setup. This decides whether we connect normally or wait for BLE/app setup.
  loadWiFiCredentials();

  // Build MQTT topic string
  snprintf(mqttTopic, sizeof(mqttTopic), "%s%s%s",
           MQTT_TOPIC_PREFIX, DEVICE_ID, MQTT_TOPIC_SUFFIX);

  // I2C bus (shared by OLED + MAX30102)
  Wire.begin(I2C_SDA, I2C_SCL);

  // ── OLED ──
  Wire.beginTransmission(OLED_ADDR);
  byte oledError = Wire.endTransmission();
  if (oledError == 0) {
    oledOK = true;
    display.begin();
    Serial.println(F("[OK] OLED detected."));
    oledShow("SmartCura", "Booting...", nullptr, nullptr);
  } else {
    Serial.println(F("[ERROR] OLED not found!"));
    oledOK = false;
  }

  // ── MAX30102 ──
  if (particleSensor.begin(Wire, I2C_SPEED_STANDARD) == false) {
    Serial.println(F("[ERROR] MAX30102 not found!"));
    max30102OK = false;
    oledShow("MAX30102", "NOT FOUND", "Check wiring", nullptr);
  } else {
    Serial.println(F("[OK] MAX30102 detected."));
    // LED power, sample avg, sample rate, pulse width, ADC range, LED pulse amplitude
    particleSensor.setup(60, 4, 2, 100, 411, 4096);
    max30102OK = true;
  }

  // ── DS18B20 ──
  tempSensor.begin();
  tempSensor.setWaitForConversion(true);
  tempSensor.setResolution(12);
  if (tempSensor.getDeviceCount() == 0) {
    Serial.println(F("[ERROR] DS18B20 not found!"));
    tempSensorOK = false;
  } else {
    Serial.println(F("[OK] DS18B20 detected."));
    tempSensorOK = true;
    tempSensor.requestTemperatures();
    lastTempC = tempSensor.getTempCByIndex(0);
    lastTempRead = millis();
  }

  // ── Setup/reset button ──
  // GPIO4 is used for the external setup/reset button. It is active LOW and
  // has no strapping function, so holding it during reset does not affect the
  // ESP32 boot mode. After the boot mode is decided, we read it to trigger a
  // Wi-Fi reset and return to provisioning mode.
  pinMode(SETUP_BUTTON_PIN, INPUT_PULLUP);

  // ── Sensor summary ──
  Serial.println(F("\n--- Sensor Status ---"));
  Serial.print(F("MAX30102 : ")); Serial.println(max30102OK ? F("READY") : F("NOT FOUND"));
  Serial.print(F("DS18B20  : ")); Serial.println(tempSensorOK ? F("READY") : F("NOT FOUND"));
  Serial.print(F("OLED     : ")); Serial.println(oledOK ? F("READY") : F("NOT FOUND"));
  Serial.println(F("\n>> Place finger FIRMLY on MAX30102 <<\n"));

  // ── WiFi + NTP + MQTT ──
  #ifndef DISABLE_NETWORK
  if (provisioningMode) {
    initProvisioningBLE();
    startProvisioningAdvertising();
    enterProvisioningMode();
    Serial.println(F("[SETUP] provisioning mode — Wi-Fi/MQTT skipped"));
  } else {
    if (connectWiFi()) {
      syncNTP();
      connectMQTT();

      // ── OTA: check for firmware update once on boot ──
      // The secure client trusts the API origin; the presigned download url is
      // capability-bound and short-lived, so a leaked response reveals only
      // that a new version exists.
      if (WiFi.status() == WL_CONNECTED) {
        otaSecureClient.setInsecure();
        checkForUpdate();
        lastOtaCheck = millis();
      }
    } else {
      startProvisioningAfterFailure();
    }
  }
  #endif

  // ── Ready ──
  if (!provisioningMode) {
    oledShow("SmartCura", "Ready", "Place finger", "on sensor");
  }
  lastPublish = millis();
  Serial.println(F("[SETUP] complete"));
}

// ── Main loop ──────────────────────────────────────────────────────
void loop() {
  bool fingerDetected = false;

  // ── Setup/reset button (always, even in provisioning mode) ──
  handleSetupButton();

  // Debug: print button state every 2 seconds to verify GPIO4 wiring
  static unsigned long lastButtonDebug = 0;
  if (millis() - lastButtonDebug > 2000) {
    Serial.printf("[BUTTON-DEBUG] GPIO%d reading=%d\n", SETUP_BUTTON_PIN, digitalRead(SETUP_BUTTON_PIN));
    lastButtonDebug = millis();
  }

  // In provisioning mode we keep the sensors running so the user can verify
  // hardware, but we do not connect to Wi-Fi/MQTT and we show the setup screen.
  if (provisioningMode) {
    handleProvisioningBLE();

    static unsigned long lastProvRefresh = 0;
    if (millis() - lastProvRefresh > 1000) {
      enterProvisioningMode();
      lastProvRefresh = millis();
    }

    // Still read sensors for local verification, but do not publish.
    if (max30102OK) {
      fingerDetected = true;
      for (int i = 0; i < SAMPLES_PER_CYCLE; i++) {
        while (particleSensor.available() == false) particleSensor.check();
        redBuffer[i] = particleSensor.getRed();
        irBuffer[i]  = particleSensor.getIR();
        particleSensor.nextSample();
        if (irBuffer[i] < FINGER_THRESHOLD) fingerDetected = false;
      }
      if (fingerDetected) {
        maxim_heart_rate_and_oxygen_saturation(
          irBuffer, SAMPLES_PER_CYCLE, redBuffer,
          &spo2, &validSPO2, &heartRate, &validHeartRate);
      } else {
        validHeartRate = 0;
        validSPO2 = 0;
      }
    }
    if (tempSensorOK && (millis() - lastTempRead > TEMP_INTERVAL_MS)) {
      tempSensor.requestTemperatures();
      float t = tempSensor.getTempCByIndex(0);
      if (t != DEVICE_DISCONNECTED_C && t > -50.0 && t < 100.0) {
        lastTempC = t;
      }
      lastTempRead = millis();
    }

    // Serial JSON in provisioning mode
    Serial.print(F("{\"device\":\""));
    Serial.print(DEVICE_ID);
    Serial.print(F("\",\"boot_id\":"));
    Serial.print((unsigned long)bootId);
    Serial.print(F(",\"hr\":"));
    Serial.print((max30102OK && validHeartRate) ? String(heartRate) : F("null"));
    Serial.print(F(",\"spo2\":"));
    Serial.print((max30102OK && validSPO2 && spo2 > 0) ? String(spo2) : F("null"));
    Serial.print(F(",\"temp_c\":"));
    Serial.print(tempSensorOK ? String(lastTempC, 2) : F("null"));
    Serial.print(F(",\"mqtt\":\"provisioning\""));
    Serial.print(F(",\"finger\":"));
    Serial.print(fingerDetected ? F("true") : F("false"));
    Serial.print(F(",\"uptime_s\":"));
    Serial.print(millis() / 1000);
    Serial.println(F("}"));
    Serial.println();

    delay(100);
    return;
  }

  // ── Read MAX30102 ──
  if (max30102OK) {
    fingerDetected = true;
    for (int i = 0; i < SAMPLES_PER_CYCLE; i++) {
      while (particleSensor.available() == false) particleSensor.check();
      redBuffer[i] = particleSensor.getRed();
      irBuffer[i]  = particleSensor.getIR();
      particleSensor.nextSample();
      if (irBuffer[i] < FINGER_THRESHOLD) fingerDetected = false;
    }

    if (fingerDetected) {
      maxim_heart_rate_and_oxygen_saturation(
        irBuffer, SAMPLES_PER_CYCLE, redBuffer,
        &spo2, &validSPO2, &heartRate, &validHeartRate);
    } else {
      // Reset validity when no finger
      validHeartRate = 0;
      validSPO2 = 0;
      Serial.println(F("[DEBUG] No finger on sensor"));
    }
  }

  // ── Read DS18B20 ──
  if (tempSensorOK && (millis() - lastTempRead > TEMP_INTERVAL_MS)) {
    tempSensor.requestTemperatures();
    float t = tempSensor.getTempCByIndex(0);
    if (t != DEVICE_DISCONNECTED_C && t > -50.0 && t < 100.0) {
      lastTempC = t;
    }
    lastTempRead = millis();
  }

  // ── OLED update ──
  oledShowVitals(
    validHeartRate ? heartRate : 0,
    validSPO2 ? spo2 : 0,
    lastTempC,
    fingerDetected
  );

  // ── Pump WebSocket + MQTT ──
  #ifndef DISABLE_NETWORK
  if (!provisioningMode && WiFi.status() != WL_CONNECTED) {
    static unsigned long lastWiFiReconnectAttempt = 0;
    if (millis() - lastWiFiReconnectAttempt > 10000) {
      lastWiFiReconnectAttempt = millis();
      reconnectWiFi();
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    wsClient.loop();

    if (!mqttClient.connected()) {
      Serial.println(F("[MQTT] disconnected — reconnecting..."));
      connectMQTT();
    } else {
      mqttClient.loop();
    }

    // ── Publish vitals on interval ──
    // Publish when finger is detected (HR + SpO2 + temp) OR when only temperature
    // is available from the DS18B20 (independent of finger detection).
    bool hasTempOnly = tempSensorOK && lastTempC > 0 && !fingerDetected;
    unsigned long publishInterval = fingerDetected ? MQTT_PUBLISH_MS : MQTT_TEMP_PUBLISH_MS;
    if (mqttClient.connected() &&
        (fingerDetected || hasTempOnly) &&
        (millis() - lastPublish > publishInterval)) {
      publishVitals(heartRate, spo2, lastTempC,
                    fingerDetected && validHeartRate == 1, fingerDetected && validSPO2 == 1);
      lastPublish = millis();
    }

    // ── OTA: check for firmware update periodically (every hour) ──
    // Uses a timer, never a blocking delay, so vitals sampling and MQTT
    // pumping continue uninterrupted. The check itself is a short HTTPS GET;
    // only the actual flash (inside triggerOtaUpdate) blocks and reboots.
    if (!otaUpdateInProgress &&
        (millis() - lastOtaCheck > OTA_CHECK_INTERVAL_MS)) {
      checkForUpdate();
      lastOtaCheck = millis();
    }
  }
  #endif

  // ── Serial JSON (always, for debugging) ──
  Serial.print(F("{\"device\":\""));
  Serial.print(DEVICE_ID);
  Serial.print(F("\",\"boot_id\":"));
  Serial.print((unsigned long)bootId);
  Serial.print(F(",\"hr\":"));
  Serial.print((max30102OK && validHeartRate) ? String(heartRate) : F("null"));
  Serial.print(F(",\"spo2\":"));
  Serial.print((max30102OK && validSPO2 && spo2 > 0) ? String(spo2) : F("null"));
  Serial.print(F(",\"temp_c\":"));
  Serial.print(tempSensorOK ? String(lastTempC, 2) : F("null"));
  Serial.print(F(",\"mqtt\":"));
  #ifdef DISABLE_NETWORK
  Serial.print(F("\"disabled\""));
  #else
  Serial.print(mqttClient.connected() ? F("\"connected\"") : F("\"disconnected\""));
  #endif
  Serial.print(F(",\"finger\":"));
  Serial.print(fingerDetected ? F("true") : F("false"));
  Serial.print(F(",\"uptime_s\":"));
  Serial.print(millis() / 1000);
  Serial.println(F("}"));
  Serial.println();
}
