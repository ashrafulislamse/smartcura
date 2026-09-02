# SmartCura Doctor App

Flutter client for doctors: a dashboard with the next appointment and
needs-attention queue, schedule management with accept/decline, an assigned
patients directory, e-prescriptions from draft to signature with PDF export,
LiveKit video consultations, a clinical messaging inbox, and non-diagnostic AI
artifacts.

> **Status:** wired to the live backend. Dashboard, schedule, patients,
> prescriptions, messaging, video calls, AI artifacts and avatars all use real
> authenticated `/api/v1` routes against generated contract types. Debug APKs
> build; on-device verification is ongoing. Not production-ready — synthetic
> data only.

## Feature map

- **Dashboard** — hero next-appointment card with live countdown, four-stat
  day overview, time-rail schedule, needs-attention queue
- **Schedule** — week strip with per-day appointment counts; accept or
  decline pending requests
- **Patients** — assigned-patients directory with profiles and avatars
- **E-prescriptions** — draft with diagnosis and medication items, sign, and
  download the prescription PDF
- **Video consultations** — LiveKit rooms with device-specific audio
  processing workarounds for reliable calls
- **Inbox** — clinical messaging with a live unread badge
- **AI** — view patient AI artifacts and query the assistant endpoint;
  structured, source-cited, **non-diagnostic by design**, with clinician
  review required

## Stack

Flutter 3.44 (Dart 3) · Riverpod · Dio · `livekit_client` · `firebase_auth` +
FCM · `flutter_dotenv` (optional — the app falls back to defaults without a
`.env`) · `app_links` deep links · generated Dart contracts
(`smartcura_contracts`)

## Run locally

```bash
flutter pub get
flutter run
```

Sign-in needs your Firebase `google-services.json` in `android/app/`
(gitignored by policy). An `.env` file is optional — the app loads it when
present and otherwise uses built-in defaults.

## Further reading

- [System architecture](../../docs/ARCHITECTURE.md)
- [Roadmap](../../docs/ROADMAP.md)
- [Patient app](../patient-app/README.md) — the other side of the consultation

Synthetic data and prototype sensors only — see the medical disclaimer in the
[root README](../../README.md). AI output is non-diagnostic and requires
clinician review.
