import Link from "next/link";
import { PulseDivider } from "@/components/public/pulse-divider";
import { SystemMap } from "@/components/public/system-map";

interface Station {
  id: string;
  title: string;
  one_liner: string;
  details: string;
  evidence: ReadonlyArray<{ label: string; path: string }>;
  limitations?: ReadonlyArray<string>;
}

const STATIONS: ReadonlyArray<Station> = [
  {
    id: "body",
    title: "Body — the sensor",
    one_liner: "MAX30102 PPG/oximetry on a DOIT DevKit V1. Health Connect on the phone.",
    details:
      "Two complementary sources feed the pipeline. The ESP32 board reads photoplethysmography from a MAX30102 — heart rate and SpO₂, with a finger-detection threshold tuned for uncalibrated hands. The Android phone pulls steps, sleep, distance, heart rate and oxygen through Health Connect, then converts consumer-friendly units (mmol/L, bpm, °C, mmHg) into UCUM labels (/min, mg/dL, Cel, mm[Hg]). Blood glucose is a scale conversion, not just a label change: ×18.0182 in the Flutter collector.",
    evidence: [
      { label: "ESP32 firmware (Arduino)", path: "iot-firmware/smartcura_vitals_monitor/" },
      { label: "Health Connect sync", path: "apps/patient-app/lib/features/health_connect" },
      { label: "UCUM labels (vital-reading-repository.ts)", path: "apps/api/packages/database/src/vital-reading-repository.ts" },
    ],
    limitations: [
      "MAX30102 with no calibration — heart-rate variance is expected and the AI flags it.",
      "Health Connect on FunTouch OS is unreliable; the patient app can open its permission screen.",
    ],
  },
  {
    id: "edge",
    title: "Edge — the device",
    one_liner: "BLE provisioning, NVS-persisted Wi-Fi, OLED that tells you what's happening.",
    details:
      "A patient pairs the device from the patient app via a QR link. BLE exchanges a PIN, then the app pushes Wi-Fi credentials over a single encrypted write. The ESP32 persists credentials in NVS so it reconnects after power-cycles without re-provisioning. Subscribing to the notify stream for the *current* connection always re-renders correctly — the earlier race where a fast peripheral's status event arrived before the listener attached is fixed.",
    evidence: [
      { label: "BLE provisioning service", path: "apps/patient-app/lib/features/iot/presentation/services/ble_provisioning_service.dart" },
      { label: "flash.sh / flash.bat", path: "iot-firmware/smartcura_vitals_monitor/flash.sh" },
      { label: "Firmware OLED status code", path: "iot-firmware/smartcura_vitals_monitor/ble_provisioning.cpp" },
    ],
    limitations: [
      "No reset path for lost PINs; a re-shared QR is required.",
      "OLED gestures are minimal — only status text, not active interaction.",
    ],
  },
  {
    id: "transport",
    title: "Transport — the connection",
    one_liner: "MQTT over WSS, per-device credentials, UCUM unit validation.",
    details:
      "The device publishes over MQTT-over-WebSocket to mqtt.smartcura.app. Each device has a per-device mosquitto credential written to the broker's auth volume — the named volume, not a transient bind mount, so Coolify recreating the broker container doesn't silently evict existing devices. Backend ingests readings, validates the unit (UCUM, exact), and writes to vital_readings with version-stamped optimistic concurrency.",
    evidence: [
      { label: "Compose service for Mosquitto", path: "apps/api/docker-compose.prod.yaml" },
      { label: "Per-device setup script", path: "tools/setup-mqtt-auth.sh" },
      { label: "CHECK constraints", path: "apps/api/packages/database/drizzle/*_check_constraints.sql" },
    ],
  },
  {
    id: "platform",
    title: "Platform — the API + worker",
    one_liner: "NestJS, PostgreSQL 18, transactional outbox, Zod-validated contracts.",
    details:
      "246 REST operations, 62 migrations, 421 OpenAPI schemas, all regenerated to TypeScript and Dart contracts. Every state-changing route declares @RequireCsrf; a dedicated test enforces the rule (the only exemption is POST /sessions, which mints the token a mutation would need). Sessions ride on a __Host-prefixed, SameSite=Strict cookie — the portal proxies the API same-origin so the cookie is accepted. The worker fires off transactional outbox events; if it crashes mid-process the API retries from the durable queue on next boot.",
    evidence: [
      { label: "API entry", path: "apps/api/apps/api/src/main.ts" },
      { label: "Worker entry", path: "apps/api/apps/worker/src/main.ts" },
      { label: "OpenAPI", path: "apps/api/packages/contracts/openapi/openapi.json" },
      { label: "test/csrf-coverage.test.ts", path: "apps/api/test/csrf-coverage.test.ts" },
    ],
  },
  {
    id: "intelligence",
    title: "Intelligence — the AI",
    one_liner: "Health context → risk → anomaly → longitudinal → Fireworks Kimi K3.",
    details:
      "All ten AI phases are implemented and deployed. HealthContextBuilder aggregates conditions (soft-deleted filtered), signed prescriptions, and 24-hour vitals with source provenance. RiskScoringEngine scores cardiovascular, fall, medication adherence and respiratory. AdvancedAnomalyDetector flags sustained elevation, acute spikes, progressive decline, erratic and cyclical patterns. LongitudinalAnalyzer tracks trends, rate of change, variability, seasonal patterns and health trajectory. KeywordKnowledgeRetriever surfaces medical facts the LLM can cite. The LLM is Fireworks Kimi K3 (accounts/fireworks/models/kimi-k3) — chosen over DeepSeek variants for medical source citations and red-flag warnings. Every artifact is non_diagnostic by schema.",
    evidence: [
      { label: "ai-repository.ts", path: "apps/api/packages/database/src/ai-repository.ts" },
      { label: "RiskScoringEngine", path: "apps/api/packages/ai/src/risk-scoring.js" },
      { label: "AdvancedAnomalyDetector", path: "apps/api/packages/ai/src/anomaly-detector.js" },
      { label: "LongitudinalAnalyzer", path: "apps/api/packages/ai/src/longitudinal-analysis.js" },
    ],
    limitations: [
      "Health Connect data missing in the demo dataset — explicit 'absence of source' is surfaced by the AI.",
      "AI cannot diagnose; it routes red-flag symptoms to a human care team.",
      "Known model trade-offs logged in AGENTS.md (18 Aug Fireworks migration).",
    ],
  },
  {
    id: "care",
    title: "Care — the receiving end",
    one_liner: "Doctor alerts, LiveKit video, e-prescriptions, pharmacy, dispatch, SOS.",
    details:
      "The doctor's mobile app, the driver app and the operations portal share one outbox. CRITICAL vitals trigger mandatoryPush to the assigned doctor; non-CRITICAL entries become toast / in-app only. Video consultations run over LiveKit with token-issued rooms; the patient app presents 15 states for a call (live, poor connection, doctor not connected, call ended). E-prescriptions go prescription → pharmacy order; pharmacy fulfilment picks up by the operations portal and, for transport orders, by the driver app with live waypoints and per-stop proof capture. SOS is its own emergency path with mandatoryPush to staff and a break-glass disclosure.",
    evidence: [
      { label: "Notification pipeline", path: "apps/api/apps/worker/src/notification-copy.ts" },
      { label: "LiveKit config", path: "apps/api/apps/api/src/video/video.module.ts" },
      { label: "Dispatch stops", path: "apps/api/packages/database/src/dispatch-stops-repository.ts" },
      { label: "Break-glass audit", path: "apps/api/packages/audit/src/break-glass.ts" },
    ],
    limitations: [
      "Driver-app delivery and tripComplete screenshots depend on `GET /dispatch/assignments/{id}` — pending.",
      "Stripe / payments adapter is intentionally a deterministic stub for the demo posture.",
    ],
  },
];

export const metadata = {
  title: "How it works",
  description:
    "The SmartCura pipeline, six stations long — from a MAX30102 sensor through MQTT-over-WSS, NestJS, transactional outbox, Fireworks Kimi K3 AI, to LiveKit video, pharmacy dispatch and emergency SOS.",
};

export default function HowItWorksPage() {
  return (
    <>
      <section aria-labelledby="h1" className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
            System map · six stations
          </p>
          <h1
            id="h1"
            className="mt-3 max-w-[28ch] text-[length:var(--text-display)] font-semibold leading-[1.04] tracking-[-0.02em] text-[var(--color-ink)]"
          >
            One signal, six stations.
          </h1>
          <p className="mt-6 max-w-[60ch] text-[length:var(--text-3)] text-[var(--color-ink-2)]">
            The map below is an honest diagram of the SmartCura prototype. Walk either
            direction. Each station is referenced from the codebase — click into a station
            to see what we built, what we measured, and what remains simulated.
          </p>
        </div>
      </section>

      <SystemMap stations={STATIONS.map(({ id, title, one_liner }) => ({ id, title, one_liner }))} />

      <PulseDivider className="block h-12 w-full bg-[var(--color-paper)]" variant="long" stroke="var(--color-pulse)" ariaHidden />

      <section aria-label="Station details" className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-20">
          <ol className="space-y-16 md:space-y-24">
            {STATIONS.map((s, idx) => (
              <li
                key={s.id}
                id={s.id}
                className={`grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-start ${idx % 2 === 1 ? "md:[&>*:first-child]:order-2" : ""}`}
              >
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-blue)]">
                    Station 0{idx + 1}
                  </p>
                  <h2 className="mt-2 text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
                    {s.title}
                  </h2>
                  <p className="mt-3 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
                    {s.one_liner}
                  </p>
                </div>
                <div>
                  <p className="text-[15px] leading-relaxed text-[var(--color-ink)]">{s.details}</p>

                  <div className="mt-6 rounded-xl border border-[var(--rule-hairline)] bg-white">
                    <header className="border-b border-[var(--rule-hairline)] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                      Evidence in the repository
                    </header>
                    <ul className="divide-y divide-[var(--rule-hairline)]">
                      {s.evidence.map((e) => (
                        <li
                          key={e.path}
                          className="grid grid-cols-[minmax(0,_1fr)_auto] gap-3 px-5 py-3 text-[13px]"
                        >
                          <span className="text-[var(--color-ink)]">{e.label}</span>
                          <code className="overflow-x-auto font-mono text-[12px] text-[var(--color-ink-2)]">
                            {e.path}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {s.limitations ? (
                    <div className="mt-6 rounded-xl border border-[var(--rule-hairline)] bg-[var(--color-paper-2)]">
                      <header className="flex items-center gap-2 border-b border-[var(--rule-hairline)] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                        <span aria-hidden>⚠</span> Honest limitations
                      </header>
                      <ul className="space-y-2 px-5 py-4 text-[14px] leading-relaxed text-[var(--color-ink-2)]">
                        {s.limitations.map((l) => (
                          <li key={l} className="flex gap-3">
                            <span aria-hidden className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-ink-3)]" />
                            <span>{l}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        aria-labelledby="limits-heading"
        className="border-y border-[var(--rule-hairline)] bg-[var(--color-night)] text-[var(--color-ink-inverse)]"
      >
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-24">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-pulse-night)]/80">
            Prototype posture
          </p>
          <h2
            id="limits-heading"
            className="mt-3 max-w-[36ch] text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink-inverse)]"
          >
            What this map does — and does not — promise.
          </h2>
          <div className="mt-6 grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-pulse-night)]/80">Working today</h3>
              <ul className="mt-3 space-y-2 text-[14px] text-[var(--color-ink-inverse)]/85">
                <li>· BLE provisioning end-to-end on the DOIT DevKit V1</li>
                <li>· MQTT-over-WSS publishing with UCUM-validated unit ingestion</li>
                <li>· All ten AI phases wired into one generation pipeline</li>
                <li>· LiveKit video studies, e-prescription → pharmacy, emergency SOS</li>
              </ul>
            </div>
            <div>
              <h3 className="font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-pulse-night)]/80">Out of FYP scope</h3>
              <ul className="mt-3 space-y-2 text-[14px] text-[var(--color-ink-inverse)]/85">
                <li>· AI-10 wearable expansion (smartwatches beyond Health Connect)</li>
                <li>· Real Stripe payment adapter (deterministic stub by design)</li>
                <li>· Production FCM/SMTP from a real provider is supported, optional</li>
                <li>· Calibration of the MAX30102 — readings are diagnostic-grade in shape, not in number</li>
              </ul>
            </div>
          </div>
          <p className="mt-8 text-[14px] text-[var(--color-ink-inverse)]/85">
            Next:{" "}
            <Link
              href="/ai"
              className="font-medium text-[var(--color-pulse-night)] underline-offset-4 hover:underline"
            >
              the AI pipeline
            </Link>
            {" "}or{" "}
            <Link
              href="/security"
              className="font-medium text-[var(--color-pulse-night)] underline-offset-4 hover:underline"
            >
              the security ledger
            </Link>.
          </p>
        </div>
      </section>
    </>
  );
}
