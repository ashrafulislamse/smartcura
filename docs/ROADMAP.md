# SmartCura Complete Roadmap

From the current ESP32 state → Health Connect → unified health data → AI, including the cleanup that must be done before adding smartwatch support.

## Principle

We are not building an "ESP32 app" and then a "smartwatch app." We are building **one SmartCura Health Platform** with multiple data sources:

> **ESP32 + Health Connect + future sources → one patient health record → one UI → one AI layer.**

---

## PHASE 2 — ESP32 IoT Foundation

### 2.1 ESP32 firmware

Already essentially completed:

* ESP32 SmartCura firmware
* MAX30102
* DS18B20
* OLED
* Device ID
* MQTT
* OTA foundation
* NVS configuration

### 2.2 Device provisioning

Completed/validated flow:

```text
New ESP32
   ↓
SmartCura firmware
   ↓
BLE provisioning
   ↓
Device ID
   ↓
Secure PIN
   ↓
Wi-Fi SSID
   ↓
Wi-Fi password
   ↓
Save credentials
   ↓
ESP32 reboot
   ↓
Wi-Fi
   ↓
MQTT
```

This is the important change from the **old patient self-pairing architecture**.

The patient should not simply discover an unregistered ESP32 and claim it. Instead:

```text
Device
   ↓
Provisioned
   ↓
Registered
   ↓
Unassigned / pending
   ↓
Provider assigns
   ↓
Patient receives device
```

### 2.3 — ESP32 → Real SmartCura Data

Before touching smartwatch, finish the complete real-data pipeline:

```text
MAX30102 / DS18B20
        ↓
       ESP32
        ↓
       Wi-Fi
        ↓
       MQTT
        ↓
SmartCura Backend
        ↓
   Health Data
        ↓
    Patient App
```

Verify:

* Real HR
* Real SpO₂
* Real temperature
* Timestamp
* Device ID
* Patient association
* Online/offline state
* Last seen
* MQTT reconnect
* Data appearing correctly in UI

**Note:** recent logs showed `DS18B20 NOT FOUND`, so that physical sensor needs to be fixed/verified before calling the complete ESP32 sensor pipeline finished.

### 2.4 — Patient IoT Architecture Cleanup

**This comes before smartwatch.**

We currently have two overlapping architectures:

#### Old

```text
Patient
 ↓
BLE scan
 ↓
Discover ESP32
 ↓
Self-pair
```

#### New

```text
ESP32
 ↓
Provision
 ↓
Register
 ↓
Provider assignment
 ↓
Patient
```

We keep the **new architecture**.

#### Keep

* `HealthScreen` — main health dashboard.
* `PatientDevicesScreen` — single device-management hub.
* `DeviceVitalsScreen` — unified device detail screen.
* `AddDeviceScreen` — redesign as the single entry point for future device types.

### 2.5 — Clean the old screens

Before deleting anything, migrate useful functionality from:

* `IoTDeviceManagementHubScreen`
* `IoTDeviceDetailScreen`

Move useful features into the current screens:

* Device status
* Device type
* Last seen
* Sync information
* Release/unassign device
* Release reason
* Device management actions

Especially keep available:

```text
POST /organizations/{org}/devices/{id}/assignments/release
```

Then retire the obsolete screens and routes:

```text
iot_device_discovery_hub_screen
pairing_select_device_type_screen
pairing_enable_permissions_screen
pairing_establishing_connection_screen
pairing_successful_1_screen
iot_device_management_hub_screen
iot_device_detail_screen
```

**Do not delete them before migrating useful functionality.**

### 2.6 — New Add Device architecture

`AddDeviceScreen` becomes the unified entry point.

```text
             ADD DEVICE
                 │
       ┌─────────┴─────────┐
       │                   │
       ▼                   ▼
 SmartCura Monitor     Wearable
       │                   │
       ▼                   ▼
BLE + Wi-Fi           Health Connect
Provisioning              │
       │                   │
       └─────────┬─────────┘
                 ▼
          SmartCura Health
              Platform
```

Do not create:

* `AddESP32Screen`
* `AddSamsungWatchScreen`
* `AddPixelWatchScreen`
* etc.

One entry point, multiple integration adapters.

---

## PHASE 3 — Health Connect Integration

Now we add smartwatch/wearable support.

**Health Connect is the primary Android integration layer.**

```text
Smartwatch
     ↓
Wear OS / manufacturer
     ↓
Android Health Connect
     ↓
SmartCura Patient App
```

SmartCura does **not** need to directly integrate every watch manufacturer.

### 3.1 Health Connect permissions

Request only the health records we actually support:

* ❤️ Heart rate
* 🫁 SpO₂
* 😴 Sleep
* 🚶 Steps
* 🏃 Exercise
* 🔥 Calories
* ❤️ Resting heart rate
* HRV, if available
* Stress-related data, if available
* Body temperature, if available
* Other supported Health Connect records

Do not assume every watch supplies every metric.

### 3.2 — Health Connect Sync

Read Health Connect records and normalize them:

```text
Health Connect
     ↓
Heart Rate Record
     ↓
SmartCura Health Data Adapter
     ↓
Normalized Measurement
```

Example:

```json
{
  "patient_id": "...",
  "source": "health_connect",
  "metric": "heart_rate",
  "value": 72,
  "unit": "bpm",
  "timestamp": "..."
}
```

### 3.3 — Unified Health Data Model

Do **not** build separate health systems:

```text
ESP32Data
WatchData
AIWatchData
```

Instead use a unified model:

```text
HealthMeasurement
├── patient_id
├── device_id
├── source
├── metric
├── value
├── unit
├── timestamp
└── quality
```

Sources:

```text
source = esp32
source = health_connect
source = manual
```

Potential future sources:

```text
source = clinical
source = lab
source = medication
```

### 3.4 — Device Model

Keep physical devices separate from measurements:

```text
Device
├── id
├── patient_id
├── type
├── manufacturer
├── model
├── connection_status
├── last_seen
└── metadata
```

Device types:

```text
esp32_vitals
wearable
```

Health Connect itself is an **integration/source**, not necessarily a physical device.

### 3.5 — Patient Health Timeline

Combine everything chronologically:

```text
08:00
ESP32
HR 74
SpO₂ 98%
Temperature 36.7°C

08:15
Health Connect
HR 72

08:30
Health Connect
Steps +420

23:30
Health Connect
Sleep started
```

This becomes the patient's unified health history.

---

## PHASE 4 — Patient UI

We don't need lots of new screens.

### Health

`HealthScreen` becomes the unified health dashboard.

```text
Health Overview

Heart Rate       72 bpm
SpO₂             98%
Temperature      36.7°C
Sleep            7h 24m
Steps            8,421
Activity         42 min
```

### Devices

`PatientDevicesScreen` shows:

```text
My Devices

🩺 SmartCura Monitor
Connected
HR 74 | SpO₂ 98%

⌚ Wearable
Connected
HR 72 | Sleep 7h 24m

+ Add Device
```

### Device Detail

`DeviceVitalsScreen` becomes device-type aware.

#### ESP32

```text
Vitals
HR
SpO₂
Temperature
Connection
Firmware
Last sync
Remove device
```

#### Wearable

```text
Heart Rate
HRV
Sleep
Steps
Activity
Stress*
Battery
Last sync
Disconnect
```

No duplicate smartwatch-detail architecture unless a genuinely different UX requirement is discovered.

---

## PHASE 5 — Backend Health Data

Backend receives both:

```text
ESP32 ───────────────┐
                     │
                     ▼
                 Health Data
                     ▲
                     │
Health Connect ──────┘
```

Normalize:

```text
Source
Metric
Value
Unit
Timestamp
Patient
Device
Quality
```

Store it in the patient's health timeline.

---

## PHASE 6 — AI Layer

**Only after the data foundation is stable.**

AI should not directly process:

```text
MQTT packets
BLE packets
Health Connect API responses
```

Instead:

```text
ESP32
   ↓
Health Data
   ↓
Health Timeline
   ↓
AI
```

and:

```text
Health Connect
   ↓
Health Data
   ↓
Health Timeline
   ↓
AI
```

Then AI can correlate:

```text
Sleep ↓
+
Resting HR ↑
+
Activity ↓
+
HRV ↓
        ↓
Potential health trend
```

The AI can eventually generate:

* Health summaries
* Trend analysis
* Anomaly detection
* Longitudinal changes
* Patient insights
* Clinician summaries
* Alerts/recommendations where appropriate

---

## PHASE 7 — Provider/Doctor Side

The provider shouldn't care whether data came from ESP32 or a watch. They should see:

```text
Patient
   ↓
Health Overview
   ↓
Vitals
   ↓
Trends
   ↓
Device Sources
```

For example:

```text
Heart Rate Trend

ESP32 ──────┐
            ├── Combined HR timeline
Watch ──────┘
```

The source remains visible so clinicians can understand where measurements originated.

---

## PHASE 8 — Multi-device / Patient Management

A patient can eventually have:

```text
Patient A
├── ESP32 #001
└── Smartwatch

Patient B
├── ESP32 #002
└── Smartwatch
```

And devices can exist before assignment:

```text
ESP32 #003
Status: Registered
Assignment: None
```

Admin/provider can:

```text
Assign
Reassign
Release
Deactivate
```

A released device should **not delete historical patient data**. Instead:

```text
Device
 ↓
Assignment A
 ↓
Released
 ↓
Assignment B
```

Historical measurements remain associated with the original patient/assignment.

---

## Final architecture

```text
                    SMARTCURA
                        │
        ┌───────────────┴────────────────┐
        │                                │
     DEVICES                          HEALTH
        │                                │
   ┌────┴────┐                    Unified View
   │         │                         │
 ESP32    Wearable                     │
   │         │                         │
 Wi-Fi    Health Connect                │
   │         │                         │
 MQTT       │                           │
   │         │                           │
   └────┬────┘                           │
        ▼                                │
       Backend ◄─────────────────────────┘
        │
        ▼
 Unified Health Data
        │
        ▼
 Patient Timeline
        │
        ▼
       AI
        │
   ┌────┼────┐
   ▼    ▼    ▼
Trends Insights Alerts
```

---

## Exact execution order

1. 🔧 **Clean current IoT architecture**
2. 🔧 Migrate release/unassign functionality
3. 🔧 Remove obsolete pairing screens/routes
4. 🔧 Improve `AddDeviceScreen`
5. ✅ Regression-test ESP32 provisioning
6. ✅ Verify real ESP32 → MQTT → backend → app
7. 🩺 Fix/verify DS18B20 hardware
8. ❤️ Build unified Health Data model
9. ⌚ **Integrate Android Health Connect**
10. ⌚ Sync smartwatch/wearable data
11. 📱 Show combined data in existing Health/Devices UI
12. 📊 Build patient timeline/trends
14. 🤖 **Add AI analysis**
15. 👨‍⚕️ Expose useful combined insights to provider/doctor dashboard

---

## Agent Analysis & Recommended Adjustments

### What is strong

* **One `AddDevice` entry point** is the right pattern. It prevents a screen explosion for every new wearable.
* **Health Connect as the adapter** is correct. We should not integrate Samsung, Pixel, Fitbit, etc., individually.
* **Unified data model before AI** is the right dependency order. AI must consume normalized records, not raw BLE/MQTT/Health Connect payloads.
* **Cleanup before expansion** is the right risk control. Adding smartwatch on top of the old self-pairing screens would create permanent debt.

### Where I would tighten the order

1. **Do not block the unified data model on the DS18B20 hardware fix.** The DS18B20 wiring/sensor issue is independent of the backend schema design. Design the unified model now and validate it with whatever sensors are currently working (MAX30102 HR/SpO₂ + manual/Health Connect entries). Fixing the temperature sensor can be a parallel task.
2. **Add an explicit backend schema step before Health Connect implementation.** Before writing any Health Connect sync code, we need a migration that defines the unified `health_measurements` table (or equivalent) and the multi-source `device` model. Otherwise we will write sync code into a schema that only understands ESP32 `vital_readings`.
3. **Define the Health Connect record subset up front.** Start with heart rate, SpO₂, steps, and sleep. Add HRV, stress, body temperature, and exercise only after the first four are stable.

### Decisions I would make now

| Decision | Rationale |
|---|---|
| Keep `vital_readings` for ESP32 raw data, and add a separate `health_measurements` unified table. | The ESP32 pipeline is already validated and should keep working. A unified table can be populated from ESP32 readings (as a normalized source) plus Health Connect, manual entry, and future sources. |
| Device model uses `source` + `device_type`, not separate tables per device category. | One extensible table is enough for `esp32_vitals`, `wearable`, `manual`, and future types. |
| Patient timeline is the canonical read surface. | `HealthScreen`, `PatientDevicesScreen`, and `DeviceVitalsScreen` should read from the timeline, not from source-specific tables. |
| AI layer reads only the patient timeline. | This prevents AI from coupling to MQTT, BLE, or Health Connect internals. |
| Do not start smartwatch/Health Connect until Step 2 cleanup is complete. | The old pairing screens and routes must be removed first to avoid maintaining two architectures. |

### Improvements to the current codebase before Phase 3

* **Finish Step 2 cleanup:** retire `iot_device_discovery_hub_screen`, `pairing_*`, `iot_device_management_hub_screen`, and `iot_device_detail_screen` once the on-device pending-approval flow is verified.
* **Verify the prescription permission fix on the live app:** migration `0051` grants `prescription:read:own` to the patient role; confirm Arif’s account can now load the Health → Records tab after the next Coolify deploy.
* **Add a real `GET /profiles/me/devices` test on the Vivo device:** confirm the pending card appears after provisioning, and the normal device card appears after portal assignment.
* **Document the Health Connect permission subset in the patient-app privacy/permission screen** so users know exactly what data SmartCura requests.

### Open questions to resolve before Phase 3

1. Should the unified `health_measurements` table replace `vital_readings` long-term, or should `vital_readings` remain the raw ESP32 store and `health_measurements` be the normalized view?
2. How do we represent Health Connect records that have no physical SmartCura device (e.g., phone-derived steps)? Do we create a synthetic “Health Connect” device row, or leave `device_id` nullable?
3. What is the retention policy for raw Health Connect records versus the normalized timeline?
4. Which AI features are actually required for the FYP demo, and which are post-FYP enhancements?
