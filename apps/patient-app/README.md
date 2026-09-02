# SmartCura Patient App

Flutter client for patients: appointments and LiveKit video consultations,
IoT vitals from the ESP32 monitor, Health Connect sync, prescriptions with
PDF download, pharmacy orders and delivery tracking, emergency SOS, messaging
with doctors, and non-diagnostic AI health summaries.

> **Status:** wired to the live backend. Appointments, consultations,
> messaging, prescriptions, BLE IoT provisioning, Health Connect sync, AI
> artifacts, avatars and SOS all use real authenticated `/api/v1` routes
> against generated contract types. Debug APKs build; on-device verification
> is ongoing. Not production-ready — synthetic data only.

## Feature map

- **Appointments** — book and reschedule; join LiveKit video consultations
  with in-call chat and selective vitals sharing
- **IoT devices** — discover the ESP32 monitor over BLE, verify the
  provisioning PIN, send Wi-Fi credentials, then follow live vitals; devices
  can be assigned and released by the patient
- **Health Connect** — sync steps, distance, sleep, energy, blood glucose and
  more into the same care record, with UCUM units and scale conversions
  (`mmol/L` → `mg/dL` ×18.0182)
- **AI** — request `daily_summary`, `trend_analysis`, `health_summary` or
  `symptom_summary`; structured artifacts render with their sources and a
  clinician-review note; **non-diagnostic by design**
- **Prescriptions & pharmacy** — signed prescriptions with PDF download;
  pharmacy orders with live delivery status
- **Emergency** — SOS flow with emergency contacts
- **Profile** — avatar upload and removal (base64 data URIs)

## Stack

Flutter 3.44 (Dart 3) · Riverpod · Dio · `livekit_client` · `firebase_auth` +
FCM · `health` (Health Connect) · `flutter_blue_plus` (BLE) ·
`flutter_dotenv` · `app_links` deep links · generated Dart contracts
(`smartcura_contracts`)

## Run locally

```bash
flutter pub get
flutter run
```

Two configuration pieces are gitignored by policy:

1. `android/app/google-services.json` — your Firebase project config (required
   for sign-in)
2. `.env` — copy from [`.env.example`](.env.example) and fill in your values

## Further reading

- [System architecture](../../docs/ARCHITECTURE.md)
- [IoT firmware](../../iot-firmware/README.md) — the device the patient app provisions
- [Roadmap](../../docs/ROADMAP.md)

Synthetic data and prototype sensors only — see the medical disclaimer in the
[root README](../../README.md). AI output is non-diagnostic and requires
clinician review.
