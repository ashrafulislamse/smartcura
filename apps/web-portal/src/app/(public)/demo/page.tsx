import Link from "next/link";
import { LIVE_HREFS } from "@/lib/site-data";
import { PulseDivider } from "@/components/public/pulse-divider";

const LIVE_LINKS: ReadonlyArray<{ label: string; href: string; note: string; when: string }> = [
  {
    label: "Web portal",
    href: LIVE_HREFS[0]?.href ?? "#",
    note: "Sign in to the authenticated dashboard. Two clicks to live data.",
    when: "live",
  },
  {
    label: "API health",
    href: LIVE_HREFS[1]?.href ?? "#",
    note: "Public health endpoint, returns ok in under 200ms on the live VPS.",
    when: "live",
  },
  {
    label: "LiveKit signalling",
    href: LIVE_HREFS[2]?.href ?? "#",
    note: "Telephony and video-consultation media server; token-issued rooms only.",
    when: "live",
  },
  {
    label: "MQTT broker",
    href: LIVE_HREFS[3]?.href ?? "#",
    note: "TLS WebSocket MQTT listener, per-device credentials carried by a named volume.",
    when: "live",
  },
];

const READING_LIST: ReadonlyArray<{ label: string; href: string; description: string }> = [
  {
    label: "Starting point — docs/QUICK_REFERENCE.md",
    href: "/QUICK_REFERENCE.md",
    description: "Source-verified project state. What was measured, what is open.",
  },
  {
    label: "Architectural intent — docs/04_TECHNICAL_SPECIFICATIONS/Backend_Implementation_Plan.md",
    href: "/Backend_Implementation_Plan.md",
    description: "34–46 week plan with the FYP core first. Append-only log of every verification, dated.",
  },
  {
    label: "Status snapshot — docs/STATUS.md",
    href: "/STATUS.md",
    description: "Generated. Never edited by hand. Match-and-trust-the-generator.",
  },
  {
    label: "AI Master Plan — docs/AI_MASTER_PLAN.md",
    href: "/AI_MASTER_PLAN.md",
    description: "Ten AI phases, ports, dates, and what's out of FYP scope.",
  },
  {
    label: "Trap log — AGENTS.md",
    href: "/AGENTS.md",
    description: "Every wasted round-trip is documented here. Read it before you trust a check.",
  },
];

const TOUR: ReadonlyArray<{ idx: string; role: string; action: string }> = [
  { idx: "01", role: "Patient", action: "Sign in, install the APK if you haven't, open Health → Overview." },
  { idx: "02", role: "Patient", action: "Tap Sync from Watch. Confirm a reading lands in vitals with UCUM units." },
  { idx: "03", role: "Patient", action: "Open the AI chat. Send \"How is my health today?\". Read the artifact card." },
  { idx: "04", role: "Doctor", action: "Sign in. Check the dashboard's needs-attention queue. Open a patient." },
  { idx: "05", role: "Doctor", action: "Review the AI artifact the patient just produced. Confirm the source provenance." },
];

export const metadata = {
  title: "Try the demo",
  description:
    "A live, index-first landing page for stepping into the SmartCura prototype — portal login, API health, artefact reading order, and a five-minute end-to-end tour.",
};

export default function DemoPage() {
  return (
    <>
      <section
        aria-labelledby="demo-h1"
        className="bg-[var(--color-paper)]"
      >
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
            Try the demo
          </p>
          <h1
            id="demo-h1"
            className="mt-3 max-w-[28ch] text-[length:var(--text-display)] font-semibold leading-[1.04] tracking-[-0.02em] text-[var(--color-ink)]"
          >
            The whole demo is a list of links.
          </h1>
          <p className="mt-6 max-w-[60ch] text-[length:var(--text-3)] text-[var(--color-ink-2)]">
            No marketing form. No signup gate. Pick a surface, follow the
            suggested order, and read the same evidence the dashboard reads.
          </p>
        </div>
      </section>

      <PulseDivider className="block h-12 w-full bg-[var(--color-paper)]" variant="long" stroke="var(--color-pulse)" ariaHidden />

      <section aria-labelledby="live-h" className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[1180px] px-6 py-12 md:py-20">
          <header>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
              Live surfaces
            </p>
            <h2
              id="live-h"
              className="mt-3 text-[length:var(--text-4)] font-semibold tracking-[-0.005em] text-[var(--color-ink)]"
            >
              Stepping in.
            </h2>
          </header>

          <ol className="mt-8 divide-y divide-[var(--rule-hairline)] overflow-hidden rounded-xl border border-[var(--rule-hairline)] bg-white">
            {LIVE_LINKS.map((l) => (
              <li key={l.href} className="grid gap-3 px-5 py-5 md:grid-cols-[140px_minmax(0,1fr)_auto] md:items-center">
                <div>
                  <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">
                    {l.when}
                  </p>
                  <p className="mt-1 text-[14px] font-semibold text-[var(--color-ink)]">{l.label}</p>
                </div>
                <p className="text-[14px] text-[var(--color-ink-2)]">{l.note}</p>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-brand-blue)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--color-brand-blue-strong)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
                >
                  Open <span aria-hidden>↗</span>
                </a>
              </li>
            ))}
          </ol>

          <p className="mt-6 text-[13px] text-[var(--color-ink-2)]">
            Test accounts are documented in <span className="font-mono">TEST_USERS.md</span> in
            the repository. Credentials are intentionally <em>not</em> printed on this
            site — the file is the source of truth.
          </p>
        </div>
      </section>

      <section
        aria-labelledby="tour-h"
        className="border-y border-[var(--rule-hairline)] bg-[var(--color-night)] text-[var(--color-ink-inverse)]"
      >
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-pulse-night)]/80">
            A five-minute tour
          </p>
          <h2
            id="tour-h"
            className="mt-3 max-w-[36ch] text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink-inverse)]"
          >
            From sensor to artifact, in five steps.
          </h2>

          <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {TOUR.map((t) => (
              <li
                key={t.idx}
                className="rounded-xl border border-[var(--color-ink-inverse)]/10 bg-[var(--color-night-deep)]/50 p-4"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-pulse-night)]/80">
                  Step {t.idx}
                </p>
                <p className="mt-1.5 text-[13px] font-semibold uppercase tracking-[0.05em] text-[var(--color-pulse-night)]">
                  {t.role}
                </p>
                <p className="mt-2 text-[13px] text-[var(--color-ink-inverse)]/85">{t.action}</p>
              </li>
            ))}
          </ol>

          <p className="mt-8 text-[14px] text-[var(--color-ink-inverse)]/85">
            Each step ends at an artifact: a vital_readings row, an
            ai_generations artifact, a prescription, a pharmacy order milestone,
            a notification delivery. The system holds an evidence chain
            end-to-end — the next page explains how to verify it.
          </p>
        </div>
      </section>

      <section aria-labelledby="read-h" className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[1180px] px-6 py-12 md:py-20">
          <header>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
              Reading the evidence
            </p>
            <h2
              id="read-h"
              className="mt-3 text-[length:var(--text-4)] font-semibold tracking-[-0.005em] text-[var(--color-ink)]"
            >
              Five documents, ordered.
            </h2>
          </header>

          <ol className="mt-8 divide-y divide-[var(--rule-hairline)] overflow-hidden rounded-xl border border-[var(--rule-hairline)] bg-white">
            {READING_LIST.map((r, idx) => (
              <li key={r.label + idx} className="grid gap-3 px-5 py-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] md:items-start">
                <div>
                  <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">
                    0{idx + 1}
                  </p>
                  <p className="mt-1 text-[14px] font-semibold text-[var(--color-ink)]">{r.label}</p>
                </div>
                <p className="text-[14px] text-[var(--color-ink-2)]">{r.description}</p>
              </li>
            ))}
          </ol>

          <p className="mt-8 text-[14px] text-[var(--color-ink-2)]">
            Or read{" "}
            <Link
              href="/security"
              className="font-medium text-[var(--color-brand-blue)] underline-offset-4 hover:underline"
            >
              the security ledger
            </Link>{" "}
            to see how engineering decisions were vetted.
          </p>
        </div>
      </section>
    </>
  );
}
