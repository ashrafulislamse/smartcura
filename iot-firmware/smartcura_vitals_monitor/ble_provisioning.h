/*
 * SmartCura BLE provisioning service.
 *
 * This module runs only when the device is in provisioning mode (no valid Wi-Fi
 * credentials stored in NVS). It exposes a NimBLE GATT service that allows the
 * SmartCura patient app to:
 *   1. read the device ID and confirm it matches the QR sticker,
 *   2. verify the factory provisioning PIN,
 *   3. send Wi-Fi credentials,
 *   4. trigger a reboot so the device joins the network and connects to MQTT.
 *
 * The MQTT broker credential is never exposed over BLE. It remains compiled into
 * the firmware and stored in NVS alongside the permanent device ID.
 */

#ifndef SMARTCURA_BLE_PROVISIONING_H
#define SMARTCURA_BLE_PROVISIONING_H

#include <Arduino.h>

// SmartCura-specific 128-bit UUIDs for the provisioning service and its
// characteristics. These are project-specific and must not be changed once
// devices are deployed, because the patient app relies on them.
#define SMARTCURA_PROV_SERVICE_UUID        "5c40a76e-8749-4df4-909b-b0e812ea8554"
#define SMARTCURA_PROV_CHAR_DEVICE_ID      "ab8ea1c7-88be-4413-91c8-e6553b5ab52e"
#define SMARTCURA_PROV_CHAR_PIN_VERIFY     "f973817e-61dc-4c80-a927-0448bf543acd"
#define SMARTCURA_PROV_CHAR_WIFI_SSID      "3190b9cd-77de-4707-be59-689c5e82639a"
#define SMARTCURA_PROV_CHAR_WIFI_PASSWORD  "6f7d24de-a412-4daa-8afd-fb38d6ffb045"
#define SMARTCURA_PROV_CHAR_STATUS         "657bd447-0431-4946-a11b-09e66f8a9a30"
#define SMARTCURA_PROV_CHAR_COMMAND        "e36d4e43-3b24-4083-9837-17b0dae3ceb0"

// Initialize the NimBLE stack and create the provisioning GATT service.
// Must be called once before advertising.
void initProvisioningBLE();

// Start BLE advertising with the name "SmartCura-XXXX" where XXXX is the last
// 4 characters of the device ID. The provisioning service UUID is included in the
// advertisement so the patient app can filter scans.
void startProvisioningAdvertising();

// Stop advertising. Useful when leaving provisioning mode.
void stopProvisioningAdvertising();

// Pump any periodic BLE tasks. Call from loop() while in provisioning mode.
void handleProvisioningBLE();

// Returns true once the provisioning PIN has been verified in the current BLE
// session. Wi-Fi credential writes are rejected until this is true.
bool isProvisioningPinVerified();

#endif  // SMARTCURA_BLE_PROVISIONING_H
