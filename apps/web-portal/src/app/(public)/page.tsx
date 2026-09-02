import Link from "next/link";
import { Suspense } from "react";
import { TelemetryCanvas } from "@/components/public/telemetry-canvas";
import { PulseDivider } from "@/components/public/pulse-divider";
import { CountUp } from "@/components/public/count-up";
import { MEASURED, MEASURED_AT, LIVE_HREFS } from "@/lib/site-data";

const STATIONS: ReadonlyArray<{ id: string; label: string; one_liner: string }> = [
  { id: "body", label: "Body", one_liner: "MAX30102 on the DOIT DevKit V1, Health Connect on the phone." },
  { id: "edge", label: "Edge", one_liner: "BLE provisioning, NVS-persisted WiFi, OLED that shows what's happening." },
  { id: "transport", label: "Transport", one_liner: "MQTT-over-WSS to mqtt.smartcura.app, per-device credentials, UCUM units." },
  { id: "platform", label: "Platform", one_liner: "NestJS API + worker, PostgreSQL 18, transactional outbox, 62 migrations." },
  { id: "intelligence", label: "Intelligence", one_liner: "Health context · risk · anomaly · longitudinal → Fireworks Kimi K3." },
  { id: "care", label: "Care", one_liner: "Doctor alerts, LiveKit video, e-prescription, pharmacy, dispatch, SOS." },
];

const SURFACES: ReadonlyArray<{
  label: string;
  href: string;
  roleColor: string;
  features: ReadonlyArray<string>;
  icon: React.ReactNode;
}> = [
  {
    label: "Patient",
    href: "/apps#patient",
    roleColor: "var(--color-role-patient)",
    features: [
      "Health Connect sync",
      "BLE device provisioning",
      "Live vitals + trends",
      "AI chat with structured summaries",
      "Video consultations",
    ],
    icon: <PhIcon name="patient" />,
  },
  {
    label: "Doctor",
    href: "/apps#doctor",
    roleColor: "var(--color-role-doctor)",
    features: [
      "Needs-attention dashboard",
      "Schedule with Accept/Decline",
      "E-prescription writer",
      "AI assistant + artifact review",
      "Patient roster",
    ],
    icon: <PhIcon name="doctor" />,
  },
  {
    label: "Driver",
    href: "/apps#driver",
    roleColor: "var(--color-role-driver)",
    features: [
      "Order offers in real time",
      "Stop-by-stop live waypoints",
      "Delivery + proof capture",
      "Earnings ledger",
      "SOS escalation",
    ],
    icon: <PhIcon name="driver" />,
  },
  {
    label: "Portal",
    href: "/apps#portal",
    roleColor: "var(--color-role-portal)",
    features: [
      "68 authenticated pages",
      "Appointments · pharmacy · emergency",
      "Devices · verification · roles",
      "Notifications inbox",
      "Finance + audit logs",
    ],
    icon: <PhIcon name="portal" />,
  },
];

const STATS: ReadonlyArray<{ label: string; value: number; suffix?: string; note?: string }> = [
  { label: "REST operations", value: MEASURED.restOperations, note: "across controllers" },
  { label: "Migrations", value: MEASURED.migrations, note: "Drizzle journal" },
  { label: "Local tests", value: MEASURED.localTests, note: "passing" },
  { label: "Tables", value: MEASURED.tables, note: "PostgreSQL 18 schema" },
  { label: "Portal pages", value: MEASURED.portalPages, note: "all wired" },
  { label: "AI phases", value: MEASURED.aiPhases, note: "AI-0 → AI-9" },
];

export default function HomePage() {
  const primaryHref = LIVE_HREFS[0]?.href ?? "#";

  return (
    <>
      {/* Hero — night band, marquee shape: the canvas + headline fills the fold. */}
      <section
        aria-labelledby="hero-heading"
        className="relative isolate overflow-hidden bg-[var(--color-night)] text-[var(--color-ink-inverse)]"
      >
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[var(--color-night)] via-[var(--color-night-deep)] to-[var(--color-night-edge)]" />
        <div className="mx-auto max-w-[1180px] px-6 pb-16 pt-10 md:pb-24 md:pt-16">
          <div className="grid items-end gap-10 md:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-pulse-night)]/80">
                Final-year project · measured {MEASURED_AT}
              </p>
              <h1
                id="hero-heading"
                className="mt-4 font-display text-[length:var(--text-display)] font-semibold leading-[1.04] tracking-[-0.02em] text-[var(--color-ink-inverse)]"
              >
                Care, watched over by intelligence.
              </h1>
              <p className="mt-6 max-w-[58ch] text-[length:var(--text-3)] leading-relaxed text-[var(--color-ink-inverse)]/85">
                An end-to-end IoT + AI telehealth prototype: real vitals from a sensor,
                structured summaries from an AI, and a care team to receive it. Verified
                on a live VPS — synthetic data only.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/how-it-works"
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-brand-blue)] px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--color-brand-blue-strong)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
                >
                  How it works <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
                </Link>
                <Link
                  href="/demo"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--color-ink-inverse)]/30 px-5 py-3 text-[15px] font-semibold text-[var(--color-ink-inverse)]/95 transition-colors hover:border-[var(--color-pulse-night)] hover:text-[var(--color-pulse-night)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
                >
                  Try the demo
                </Link>
              </div>
              <p className="mt-6 font-mono text-[12px] text-[var(--color-ink-inverse)]/55">
                <span aria-hidden>◆</span> SmartCura · Not a medical device
              </p>
            </div>

            <div>
              <Suspense fallback={<div className="h-[220px]" aria-hidden />}>
                <TelemetryCanvas
                  caption="Simulated telemetry — prototype firmware. Not a real patient."
                  bpm={72}
                  spO2={98}
                />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      <PulseDivider
        className="block h-12 w-full bg-[var(--color-paper)]"
        variant="long"
        stroke="var(--color-pulse)"
        aria-label="Pulsing rhythm divider"
        ariaHidden
      />

      {/* Pipeline strip — six stations on a paper background. */}
      <section aria-labelledby="pipeline-heading" className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-24">
          <header className="max-w-[42ch]">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
              One signal · six stations
            </p>
            <h2 id="pipeline-heading" className="mt-3 text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
              The journey from a sensor to a hand.
            </h2>
          </header>

          <ol className="mt-12 grid gap-6 md:grid-cols-3 lg:grid-cols-6">
            {STATIONS.map((station, idx) => (
              <li
                key={station.id}
                className="relative rounded-xl border border-[var(--rule-hairline)] bg-white p-4"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">
                  0{idx + 1}
                </p>
                <h3 className="mt-1 text-[15px] font-semibold tracking-[-0.005em] text-[var(--color-ink)]">
                  {station.label}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-2)]">{station.one_liner}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-[14px] text-[var(--color-ink-2)]">
            <Link
              href="/how-it-works"
              className="font-medium text-[var(--color-brand-blue)] underline-offset-4 hover:underline"
            >
              Walk each station
            </Link>{" "}
            — including the engineering decisions that make it honest.
          </p>
        </div>
      </section>

      {/* Surfaces grid — the four human surfaces, role-coloured. */}
      <section aria-labelledby="surfaces-heading" className="border-y border-[var(--rule-hairline)] bg-white">
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-24">
          <header className="max-w-[42ch]">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
              Four surfaces, one platform
            </p>
            <h2 id="surfaces-heading" className="mt-3 text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
              One signal, four audiences.
            </h2>
          </header>

          <ul className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {SURFACES.map((s) => (
              <li
                key={s.label}
                className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-[var(--rule-hairline)] bg-[var(--color-paper)] transition-shadow hover:shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)]"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-[3px]"
                  style={{ backgroundColor: s.roleColor }}
                />
                <div className="flex items-center justify-between gap-2 px-5 pt-5">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-paper-2)]"
                      style={{ color: s.roleColor }}
                    >
                      {s.icon}
                    </span>
                    <span className="text-[14px] font-semibold tracking-[-0.005em] text-[var(--color-ink)]">
                      {s.label}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                    surface
                  </span>
                </div>
                <ul className="mt-4 grow space-y-1.5 px-5 text-[13px] text-[var(--color-ink-2)]">
                  {s.features.map((f) => (
                    <li key={f} className="leading-relaxed">
                      <span aria-hidden className="mr-1 text-[var(--color-ink-3)]">·</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={s.href}
                  className="mt-5 inline-flex items-center gap-1 px-5 pb-5 text-[13px] font-medium text-[var(--color-brand-blue)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
                >
                  See screenshots <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Stat band — measured numbers only. */}
      <section aria-labelledby="stats-heading" className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-24">
          <header className="max-w-[42ch]">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
              What got measured
            </p>
            <h2 id="stats-heading" className="mt-3 text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
              Every figure on this site traces back to the repository.
            </h2>
            <p className="mt-4 max-w-[60ch] text-[14px] text-[var(--color-ink-2)]">
              Generated from <span className="font-mono text-[13px] text-[var(--color-ink)]">tools/status.mjs</span>{" "}
              and verified against the dated addenda in{" "}
              <span className="font-mono text-[13px] text-[var(--color-ink)]">AGENTS.md</span>. Last refreshed {MEASURED_AT}.
            </p>
          </header>

          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {STATS.map((s) => (
              <li
                key={s.label}
                className="rounded-xl border border-[var(--rule-hairline)] bg-white px-4 py-5"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                  {s.label}
                </p>
                <p className="mt-1 font-mono text-[28px] font-semibold leading-none tabular-nums text-[var(--color-ink)]">
                  <CountUp to={s.value} />
                  {s.suffix ? <span className="ml-0.5 text-[14px] text-[var(--color-ink-3)]">{s.suffix}</span> : null}
                </p>
                {s.note ? <p className="mt-2 text-[12px] text-[var(--color-ink-2)]">{s.note}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Closing CTA — night band. */}
      <section aria-labelledby="cta-heading" className="bg-[var(--color-night)] text-[var(--color-ink-inverse)]">
        <div className="mx-auto max-w-[1180px] px-6 py-20 md:py-28">
          <div className="grid gap-10 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-pulse-night)]/80">
                Two ways in
              </p>
              <h2
                id="cta-heading"
                className="mt-3 text-[length:var(--text-5)] font-semibold leading-[1.05] tracking-[-0.01em] text-[var(--color-ink-inverse)]"
              >
                Read the source, or step into the demo.
              </h2>
              <p className="mt-4 max-w-[58ch] text-[15px] text-[var(--color-ink-inverse)]/80">
                Either path lands you inside something honest. The repository is the
                evidence. The demo is the experience. Both run on synthetic data, both
                were verified on {MEASURED_AT}.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
              <a
                href="https://github.com/ashrafulislamse/smartcura"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-brand-blue)] px-5 py-3 text-[15px] font-semibold text-white hover:bg-[var(--color-brand-blue-strong)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
              >
                Source on GitHub <span aria-hidden> ↗</span>
              </a>
              <a
                href={primaryHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--color-ink-inverse)]/30 px-5 py-3 text-[15px] font-semibold text-[var(--color-ink-inverse)] transition-colors hover:border-[var(--color-pulse-night)] hover:text-[var(--color-pulse-night)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
              >
                Open the portal <span aria-hidden> ↗</span>
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function PhIcon({ name }: { name: "patient" | "doctor" | "driver" | "portal" }) {
  const stroke = "currentColor";
  const sw = 1.6;
  switch (name) {
    case "patient":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
          <path d="M12 21s-7-4.5-7-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.5-7 11-7 11" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 12h4l2-2 2 6 2-8 2 4h4" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "doctor":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
          <path d="M5 4v6a7 7 0 0 0 14 0V4" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 14v6M15 14v6" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 7v3M10.5 8.5h3" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      );
    case "driver":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
          <path d="M12 22s7-7 7-13a7 7 0 1 0-14 0c0 6 7 13 7 13Z" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <circle cx="12" cy="9" r="2.5" stroke={stroke} strokeWidth={sw} />
          <path d="M12 2 L12 5" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      );
    case "portal":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
          <path d="M12 3 4 7v5c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V7l-8-4Z" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M8 12l2 2 4-4" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}
