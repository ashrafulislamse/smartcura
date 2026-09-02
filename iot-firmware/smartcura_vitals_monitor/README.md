# SmartCura Vitals Monitor — ESP32 firmware

Firmware for the FYP demo ESP32 (DOIT ESP32 DEVKIT V1, CH340). Reads
MAX30102 (HR/SpO2) + DS18B20 (temperature), renders to a 1.3" SSD1306
128x64 OLED, and publishes vitals packets to the SmartCura MQTT broker over
WebSocket on port 9001.

## Wiring (ESP32)

```
MAX30102 (I2C breakout)        OLED (SSD1306 128x32, I2C)
  VIN  -> 3.3V                    VCC -> 3.3V
  GND  -> GND                     GND -> GND
  SDA  -> GPIO 21                 SDA -> GPIO 21
  SCL  -> GPIO 22                 SCL -> GPIO 22
  (both sensors share the same I2C bus)

DS18B20 (waterproof probe, 3 wires)
  RED    (VCC)  -> 3.3V
  BLACK  (GND)  -> GND
  YELLOW (DATA) -> GPIO 5
  + 4.7kΩ resistor between GPIO 5 and 3.3V (pull-up)

Setup / reset button (external momentary button)
  GPIO 4 -> one side of a normally-open push button
  GND -> other side of the push button
  (Internal pull-up is enabled; active LOW)
  Hold for 3 seconds to clear stored Wi-Fi credentials and restart in
  provisioning mode. The SmartCura app can then configure new Wi-Fi.
```

## Board settings (Arduino IDE)

- Board: DOIT ESP32 DEVKIT V1
- Flash Size / Partition: default
- Upload Speed: 921600 (or 115200 if the board fails to enter download mode)
- Port: COMx (your CH340; a **data-capable** USB cable is required,
  charge-only cables will not enumerate the serial port)
- Serial Monitor baud: 115200

## Flashing from the command line

The `arduino-cli` bundled with the Arduino IDE handles command-line
flashing. Two convenience scripts are provided:

| Script | Shell | Command |
|---|---|---|
| `flash.sh` | Git Bash / MSYS2 / sh | `./flash.sh` |
| `flash.bat` | Windows CMD / PowerShell | `flash.bat` |

Both scripts use the exact `arduino-cli` path and the FQBN
`esp32:esp32:esp32doit-devkit-v1:UploadSpeed=115200` because the DOIT DevKit V1
does not reliably enter download mode at 921600 baud.

If the upload fails with `Wrong boot mode detected (0x13)`, put the ESP32 in
download mode manually while the script is running:

1. Hold the **BOOT** button (GPIO0).
2. Press and release the **EN** button (reset).
3. Keep holding **BOOT** until you see `Chip is ESP32` in the output.
4. Release **BOOT**.

If you prefer to run `arduino-cli` directly, an example Windows path is:

```text
%LOCALAPPDATA%\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe
```

Example commands (from the repo root):

```bash
CLI="$LOCALAPPDATA/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"
FQBN="esp32:esp32:esp32doit-devkit-v1:UploadSpeed=115200"
"$CLI" compile --fqbn "$FQBN" iot-firmware/smartcura_vitals_monitor
"$CLI" upload --fqbn "$FQBN" --port COM7 iot-firmware/smartcura_vitals_monitor
```

## Required Arduino libraries

Install these in the IDE via `Sketch → Include Library → Manage Libraries…`
or by extracting the zip into your `Arduino/libraries/` folder:

| Library                          | Version | Source                                                  |
|----------------------------------|---------|---------------------------------------------------------|
| SparkFun MAX3010X Sensor Library | 1.1.2   | SparkFun                                               |
| OneWire                          | 2.3.8   | Paul Stoffregen                                        |
| DallasTemperature                | 4.0.6   | Miles Burton                                           |
| PubSubClient                     | 2.8+    | Nick O'Leary                                           |
| **U8g2** (OLED driver)           | 2.36+   | olikraus                                               |
| **NimBLE-Arduino**               | 1.4+    | h2zero                                                 |
| **WebSockets** (ESP32 client)    | 2.7.3   | https://github.com/Links2004/arduinoWebSockets         |

The last one is **not** a default Arduino library — it must be added
manually. The release zip is on the upstream releases page; the `src/`
folder of the extracted archive goes into `Arduino/libraries/WebSockets/src/`
alongside a `library.properties` that marks it as the WebSockets library.

## Build instructions

1. Copy `secrets.h.example` to `secrets.h` and fill in:
   - `WIFI_SSID` / `WIFI_PASSWORD` — 2.4 GHz WiFi the ESP32 will join
   - `MQTT_HOST` — broker hostname, e.g. `mqtt.smartcura.app`
   - `MQTT_PORT` — **9001** (the public WebSocket port; plain 1883 is
     not exposed on the SmartCura deployment)
   - `DEVICE_ID` — the UUIDv7 returned by `POST /organizations/{org_id}/devices`
   - `MQTT_PASSWORD` — the `provisioning_secret` returned by the same call
   - `PROVISIONING_PIN` — 8-digit PIN burned at factory time and printed on the
     device sticker; the app verifies it over BLE before sending Wi-Fi credentials
   - `TZ_OFFSET_MIN` — minutes east of UTC (480 for Malaysia UTC+8)
2. Open `smartcura_vitals_monitor.ino` in the Arduino IDE
3. Select the board, port, and verify all 8 libraries above are installed
4. **Verify** (✓) — should compile to ~1.14 MB (86% of program storage)
5. **Upload** (→) — first upload may need the BOOT button held on the ESP32
6. Open **Tools → Serial Monitor** at 115200 baud
7. The boot log should show:
   - `[BOOT] bootId=N` (monotonic, persisted across reboots)
   - `[WIFI] connected, IP=...`
   - `[NTP] syncing time...`
   - `[MQTT] opening WebSocket to mqtt.smartcura.app:9001/mqtt ...`
   - `[MQTT] connected`

## MQTT-over-WebSocket, not plain TCP

The Coolify deployment of the SmartCura backend exposes the Mosquitto
broker on the public entry **only** via WebSocket on port 9001. Plain
MQTT on port 1883 is reachable only from inside the Docker network
(where the API worker connects). The ESP32 cannot reach the internal
network, so it goes through the public WebSocket entry.

`MqttWsClient.h` is a thin `Client` subclass that wraps the
`WebSocketsClient` library so `PubSubClient` can speak MQTT-over-WS
without modification. Every published vitals packet is wrapped in a
single WebSocket binary frame.

### Subprotocol: `mqtt`

Mosquitto's WebSocket listener refuses to forward post-upgrade bytes as
MQTT unless the client negotiates `Sec-WebSocket-Protocol: mqtt` in the
handshake. The default `arduino` library subprotocol returns 101
Switching Protocols and then **silently drops the CONNECT**, so
`PubSubClient` waits forever for a CONNACK and times out (`rc=-4` /
`MQTT_CONNECTION_TIMEOUT`).

`MqttWsClient::begin` defaults the subprotocol to `"mqtt"`. Do not pass
`"arduino"` or omit the argument — the WebSocket will upgrade but
the broker will not process the post-upgrade MQTT frames.

## Topic and payload shape

The firmware publishes to:

```
smartcura/v1/devices/{device_id}/vitals
```

with payload:

```json
{
  "boot_id": 17,
  "recorded_at": "2026-08-12T04:25:00+08:00",
  "metrics": [
    { "sequence_no": 1, "metric": "heart_rate",         "value": 72.0, "unit": "/min", "quality": "valid" },
    { "sequence_no": 2, "metric": "oxygen_saturation",  "value": 98.0, "unit": "%",    "quality": "valid" },
    { "sequence_no": 3, "metric": "body_temperature",   "value": 36.6, "unit": "C",    "quality": "valid" }
  ]
}
```

- No `device_id` in the payload — it is the topic.
- No packet-level `sequence_no` — the server refuses it. Each metric carries
  its own `sequence_no` for per-sample dedupe.
- Boot ID is monotonic and persisted in NVS; do not reset it on firmware
  update (the server's per-sample dedupe table uses `(device_id, boot_id,
  sequence_number)` as its primary key).

## Provisioning mode

After the first boot, Wi-Fi credentials are stored in ESP32 NVS. If no
valid Wi-Fi credentials are stored (e.g., a brand-new device or after a
factory reset), the device enters **provisioning mode**:

- OLED shows "Setup mode — Open SmartCura app to connect Wi-Fi".
- The device does not try to connect to Wi-Fi or MQTT.
- Hold the setup/reset button (GPIO 4) for 3 seconds at any time to clear
  the stored Wi-Fi credentials and restart in provisioning mode.
- The SmartCura patient app discovers the device over BLE, verifies the
  provisioning PIN, and sends new Wi-Fi credentials.

Permanent values (device ID, MQTT secret, hardware profile, provisioning
PIN) are compile-time defines from `secrets.h` and are never erased by the
setup-button reset. Only the Wi-Fi credentials and provisioning state are
cleared.

## Clock

The firmware syncs time via NTP once WiFi is up. The backend has a
10-minute replay window and 120s clock-skew tolerance, so a packet with
`recorded_at` more than 10 minutes in the past is rejected. If you flash
without WiFi, `recorded_at` will be wrong and the broker will return
MQTT_CONNACK rc=4 / 5.

## Medical disclaimer

Synthetic data and prototype sensors only. Not for diagnosis, treatment
or real patient care without the required engineering, clinical, privacy,
security and regulatory work.
