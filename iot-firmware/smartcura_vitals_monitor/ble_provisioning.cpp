/*
 * SmartCura BLE provisioning service implementation.
 *
 * Uses NimBLE-Arduino to provide a GATT server with encrypted characteristics.
 * The device ID is readable; the PIN must be verified before Wi-Fi credentials
 * are accepted. After the SSID and password are received, the device saves them
 * to NVS and reboots.
 */

#include "ble_provisioning.h"
#include "secrets.h"
#include <NimBLEDevice.h>

// Legacy secrets.h files may not define the provisioning PIN. Provide a fallback
// so the firmware always compiles; the factory flash script sets the real PIN.
#ifndef PROVISIONING_PIN
#define PROVISIONING_PIN "00000000"
#endif

// Externals from smartcura_vitals_monitor.ino
extern bool oledOK;
extern void oledShow(const char* l1, const char* l2, const char* l3, const char* l4);
extern void setProvisioningStatus(const char* status);
extern void saveWiFiCredentials(const String& ssid, const String& password);

static const char* PROV_SERVICE_UUID = SMARTCURA_PROV_SERVICE_UUID;
static const char* CHAR_DEVICE_ID = SMARTCURA_PROV_CHAR_DEVICE_ID;
static const char* CHAR_PIN_VERIFY = SMARTCURA_PROV_CHAR_PIN_VERIFY;
static const char* CHAR_WIFI_SSID = SMARTCURA_PROV_CHAR_WIFI_SSID;
static const char* CHAR_WIFI_PASSWORD = SMARTCURA_PROV_CHAR_WIFI_PASSWORD;
static const char* CHAR_STATUS = SMARTCURA_PROV_CHAR_STATUS;
static const char* CHAR_COMMAND = SMARTCURA_PROV_CHAR_COMMAND;

static NimBLEServer* pServer = nullptr;
static NimBLECharacteristic* pStatusChar = nullptr;
static bool pinVerified = false;
static String pendingSsid;
static String pendingPassword;
static uint8_t pinAttemptCount = 0;
static unsigned long pinLockoutUntil = 0;

static void notifyStatus(const char* status) {
  if (pStatusChar != nullptr) {
    // Use std::string to force the string-content overload. Passing a plain
    // const char* parameter selects the template with T=const char*, which
    // stores the pointer bytes instead of the text (the app then receives
    // garbage like "+@?" instead of "pin_verified").
    pStatusChar->setValue(std::string(status));
    pStatusChar->notify();
  }
  Serial.printf("[BLE] status: %s\n", status);

  if (!oledOK) return;

  const char* friendly = status;
  if (strcmp(status, "waiting_for_pin") == 0) friendly = "Enter PIN in app";
  else if (strcmp(status, "pin_verified") == 0) friendly = "PIN verified";
  else if (strcmp(status, "pin_invalid") == 0) friendly = "PIN wrong";
  else if (strcmp(status, "pin_locked") == 0) friendly = "Locked 30s";
  else if (strcmp(status, "pin_required") == 0) friendly = "PIN required";
  else if (strcmp(status, "ssid_received") == 0) friendly = "Wi-Fi SSID ok";
  else if (strcmp(status, "credentials_saved") == 0) friendly = "Wi-Fi saved";
  else if (strcmp(status, "rebooting") == 0) friendly = "Rebooting...";
  else if (strcmp(status, "ssid_missing") == 0) friendly = "SSID missing";

  setProvisioningStatus(friendly);
}

static void saveAndReboot() {
  notifyStatus("credentials_saved");
  delay(500);
  saveWiFiCredentials(pendingSsid, pendingPassword);
  notifyStatus("rebooting");
  delay(500);
  ESP.restart();
}

class ProvisioningCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic) override {
    std::string uuid = pCharacteristic->getUUID().toString();
    std::string value = pCharacteristic->getValue();

    // device_id is read-only; ignore writes
    if (uuid == CHAR_DEVICE_ID) {
      return;
    }

    // PIN verification gate
    if (uuid == CHAR_PIN_VERIFY) {
      if (millis() < pinLockoutUntil) {
        notifyStatus("pin_locked");
        return;
      }
      String pin = String(value.c_str());
      pin.trim();
      if (pin == String(PROVISIONING_PIN)) {
        pinVerified = true;
        pinAttemptCount = 0;
        notifyStatus("pin_verified");
      } else {
        pinAttemptCount++;
        if (pinAttemptCount >= 3) {
          pinLockoutUntil = millis() + 30000;
          pinAttemptCount = 0;
          notifyStatus("pin_locked");
        } else {
          notifyStatus("pin_invalid");
        }
      }
      return;
    }

    // All other writable characteristics require PIN verification first
    if (!pinVerified) {
      notifyStatus("pin_required");
      return;
    }

    if (uuid == CHAR_WIFI_SSID) {
      pendingSsid = String(value.c_str());
      pendingSsid.trim();
      notifyStatus("ssid_received");
      return;
    }

    if (uuid == CHAR_WIFI_PASSWORD) {
      pendingPassword = String(value.c_str());
      if (pendingSsid.length() == 0) {
        notifyStatus("ssid_missing");
        return;
      }
      saveAndReboot();
      return;
    }

    if (uuid == CHAR_COMMAND) {
      String cmd = String(value.c_str());
      cmd.trim();
      if (cmd == "reboot") {
        notifyStatus("rebooting");
        delay(500);
        ESP.restart();
      }
      return;
    }
  }
};

static ProvisioningCallbacks provisioningCallbacks;

void initProvisioningBLE() {
  NimBLEDevice::init("");
  // Maximum transmit power for reliable discovery during setup
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  // Require an encrypted (bonded) connection for all provisioning
  // characteristics. MITM and Secure Connections are disabled for the first
  // FYP implementation; pairing is Just Works with encryption.
  NimBLEDevice::setSecurityAuth(true, false, false);

  pServer = NimBLEDevice::createServer();

  NimBLEService* pService = pServer->createService(PROV_SERVICE_UUID);

  NimBLECharacteristic* pDeviceIdChar = pService->createCharacteristic(
    CHAR_DEVICE_ID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::READ_ENC
  );
  pDeviceIdChar->setValue(DEVICE_ID);

  NimBLECharacteristic* pPinChar = pService->createCharacteristic(
    CHAR_PIN_VERIFY,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC
  );
  pPinChar->setCallbacks(&provisioningCallbacks);

  NimBLECharacteristic* pSsidChar = pService->createCharacteristic(
    CHAR_WIFI_SSID,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC
  );
  pSsidChar->setCallbacks(&provisioningCallbacks);

  NimBLECharacteristic* pPasswordChar = pService->createCharacteristic(
    CHAR_WIFI_PASSWORD,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC
  );
  pPasswordChar->setCallbacks(&provisioningCallbacks);

  pStatusChar = pService->createCharacteristic(
    CHAR_STATUS,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
  );

  NimBLECharacteristic* pCommandChar = pService->createCharacteristic(
    CHAR_COMMAND,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC
  );
  pCommandChar->setCallbacks(&provisioningCallbacks);

  pService->start();

  Serial.println(F("[BLE] provisioning service initialized"));
  // Diagnostic: print the actual NimBLE properties for each characteristic.
  // This helps verify that WRITE/WRITE_ENC flags are exposed correctly.
  Serial.printf("[BLE-DIAG] device_id   props=0x%04x\n", pDeviceIdChar->getProperties());
  Serial.printf("[BLE-DIAG] pin_verify  props=0x%04x\n", pPinChar->getProperties());
  Serial.printf("[BLE-DIAG] wifi_ssid   props=0x%04x\n", pSsidChar->getProperties());
  Serial.printf("[BLE-DIAG] wifi_pass   props=0x%04x\n", pPasswordChar->getProperties());
  Serial.printf("[BLE-DIAG] status      props=0x%04x\n", pStatusChar->getProperties());
  Serial.printf("[BLE-DIAG] command     props=0x%04x\n", pCommandChar->getProperties());
}

void startProvisioningAdvertising() {
  String deviceIdStr = String(DEVICE_ID);
  // Use the last 4 characters of the UUID as the advertised suffix. The full
  // device ID is read from the GATT characteristic and verified by the app.
  String suffix = deviceIdStr.substring(deviceIdStr.length() - 4);
  String name = "SmartCura-" + suffix;

  // Keep the advertised name in a static buffer so the pointer passed to NimBLE
  // remains valid after this function returns.
  static char advName[32];
  name.toCharArray(advName, sizeof(advName));

  NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
  pAdvertising->setName(advName);
  pAdvertising->addServiceUUID(PROV_SERVICE_UUID);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMaxPreferred(0x12);
  pAdvertising->start();

  Serial.printf("[BLE] advertising as %s\n", advName);
  notifyStatus("waiting_for_pin");
}

void stopProvisioningAdvertising() {
  NimBLEDevice::getAdvertising()->stop();
}

void handleProvisioningBLE() {
  // NimBLE runs asynchronously on the ESP32 controller. No synchronous work is
  // required here for Phase 2.2.1; future phases may add session timeouts or
  // lockout checks.
}

bool isProvisioningPinVerified() {
  return pinVerified;
}
