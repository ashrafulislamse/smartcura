# Changelog

All notable changes to SmartCura are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and the project adheres
to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-09-02 — First public release

### Shipped

- **Backend** — NestJS 11 modular monolith plus a transactional-outbox worker:
  251 REST operations across 206 OpenAPI 3.1 paths (421 schemas), 9 AsyncAPI
  channels, 64 hand-written migrations over 73 tables, 368 automated checks.
- **Web portal** — Next.js 15: 68 authenticated admin pages wired to generated
  API clients (users, credential verification, appointments, finance, pharmacy,
  emergency, support, broadcasts, RBAC roles editor, audit logs, analytics)
  plus a 10-page public site.
- **Mobile** — Flutter 3.44 patient, doctor and driver apps: LiveKit video
  consultations, BLE IoT provisioning, Health Connect sync, e-prescriptions
  with PDF export, dispatch with live GPS and waypoint reporting, earnings
  ledger.
- **IoT** — ESP32 firmware (MAX30102 heart rate/SpO₂, DS18B20 temperature,
  SSD1306 OLED) publishing vitals over MQTT-over-WebSocket with per-device
  broker credentials.
- **AI layer** — non-diagnostic artifacts (`daily_summary`, `trend_analysis`,
  `health_summary`, `symptom_summary`) generated on Fireworks Kimi K3 from an
  assembled health context with risk scoring, anomaly detection and
  longitudinal analysis.
- **Notifications** — FCM push and SMTP email delivered through the
  transactional outbox with per-channel retry and dead-letter handling.
- **Deployment** — single VPS via Coolify/Traefik (`docker-compose.prod.yaml`)
  or a standalone Caddy stack (`compose.prod.yaml`).

### Live demo

- `portal.smartcura.app` · `api.smartcura.app` · `livekit.smartcura.app` ·
  `wss://mqtt.smartcura.app:9001/mqtt`
- Prototype running on **synthetic data only** — see the medical disclaimer in
  the [README](README.md).

### Known limitations

- Payments are a deterministic stub — out of FYP scope.
- Three baseline k6 load scenarios were executed against the live deployment
  (100% success, p95 < 21 ms, rate limiting verified); the four
  contention/race scripts remain unexecuted.
- On-device verification of the mobile apps is ongoing.
- Driver-app map tiles need a Google Maps key (see `apps/driver-app/README.md`).
- The AI layer is non-diagnostic and requires clinician review — not for
  clinical use.
