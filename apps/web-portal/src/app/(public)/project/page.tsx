import Link from "next/link";
import { PulseDivider } from "@/components/public/pulse-divider";

interface Milestone {
  date: string;
  headline: string;
  detail: string;
}

const TIMELINE: ReadonlyArray<Milestone> = [
  {
    date: "12 Aug 2026",
    headline: "Live stack healthy, ten reads green.",
    detail:
      "api.smartcura.app, livekit.smartcura.app, mqtt.smartcura.app all returning success. Traefik stale-state got a permanent fix in tools/deploy/proxy-watch.sh.",
  },
  {
    date: "14 Aug 2026",
    headline: "Roles permission editor + 4 detail pages wired.",
    detail:
      "GET /admin/permissions already existed; the note that it was missing was stale. Permission nullable cleanup applied. Pharmacy/Doctor/Users detail pages switched to read-one endpoints.",
  },
  {
    date: "15 Aug 2026",
    headline: "Report screenshots + admin role grants.",
    detail:
      "Verification-queue cast fixed; Super Admin granted the device and emergency permissions it was missing. Nine portal screenshots captured for Chapter 5; the report DOCX was rebuilt.",
  },
  {
    date: "16 Aug 2026",
    headline: "Doctor app redesigned end-to-end.",
    detail:
      "Dashboard, schedule timeline and patients screen all rewritten to a researched reference. E-prescription works without the 404 fallback. Doctor app final UI verified on the Vivo V2507.",
  },
  {
    date: "17 Aug 2026",
    headline: "BLE provisioning race fix + AI-5 verified live.",
    detail:
      "subscribe to onValueReceived before writes — the peripheral-bound notification race is closed. health_summary artifact type verified end-to-end with a real ESP32 reading cited by source.",
  },
  {
    date: "18 Aug 2026",
    headline: "AI-9 wired, Fireworks Kimi K3 on the pipe.",
    detail:
      "Risk + anomaly + longitudinal modules now reach the LLM system prompt alongside the existing health context. AI provider switched from Cloudflare Workers AI to Fireworks Kimi K3 after a model-accuracy sweep.",
  },
  {
    date: "19 Aug 2026",
    headline: "Patient self-device-management and this site.",
    detail:
      "Patient app can self-assign and self-release its devices; live Health Connect sync targeted correctly. This public marketing site goes live at smartcura.app on the same portal deployment.",
  },
];

const STACK: ReadonlyArray<{ area: string; items: ReadonlyArray<string> }> = [
  { area: "API", items: ["NestJS 11 + TypeScript", "PostgreSQL 18 (uuidv7 server-side)", "Drizzle ORM + Zod-validated contracts", "Transactional outbox + worker"] },
  { area: "Client surfaces", items: ["Patient, Doctor, Driver Flutter apps", "Admin portal — Next.js 15 App Router", "Shared RBAC + identity context"] },
  { area: "IoT", items: ["ESP32 / DOIT DevKit V1 + MAX30102", "BLE provisioning with OLED feedback", "MQTT-over-WSS over TLS", "Health Connect sync on Android"] },
  { area: "AI", items: ["Fireworks Kimi K3 ('openai' provider)", "Health context · risk · anomaly · longitudinal", "Keyword knowledge retrieval", "Structured, non-diagnostic artifacts"] },
  { area: "Realtime + media", items: ["LiveKit at livekit.smartcura.app", "Token-issued rooms + 15-state call UI", "FCM push + SMTP email", "In-app + push + email outbox"] },
  { area: "Infrastructure", items: ["Single VPS + Coolify v4", "Caddy / Traefik / Cloudflare DNS", "ClamAV + private R2 objects", "Per-device Mosquitto credentials on a named volume"] },
];

export const metadata = {
  title: "The project",
  description:
    "A first-person note from the author. Why the SmartCura prototype was built, what was measured, and what stayed out of scope.",
};

export default function ProjectPage() {
  return (
    <>
      <section
        aria-labelledby="proj-h"
        className="bg-[var(--color-night)] text-[var(--color-ink-inverse)]"
      >
        <div className="mx-auto max-w-[1180px] px-6 py-20 md:py-28">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-pulse-night)]/80">
            A letter from the author
          </p>
          <h1
            id="proj-h"
            className="mt-3 max-w-[28ch] text-[length:var(--text-display)] font-semibold leading-[1.04] tracking-[-0.02em] text-[var(--color-ink-inverse)]"
            style={{ fontFamily: "var(--font-editorial)" }}
          >
            What "done" looked like, and why this site exists.
          </h1>
          <div className="mt-10 max-w-[60ch] space-y-5 text-[length:var(--text-2)] leading-relaxed text-[var(--color-ink-inverse)]/85">
            <p>
              Hello. I built SmartCura as a final-year project. The brief was
              ambitious — a platform where a real sensor reading from a real
              device could end up in front of a real doctor and produce
              something structured and safe, without claiming more than it can
              verify.
            </p>
            <p>
              What "done" meant, for me, was: the pipeline runs, end-to-end,
              on synthetic data, on a live VPS. The "live" matters — every
              decision was checked against the deployed behaviour, not only
              against a unit test. The "synthetic" matters too — the system
              never claims clinical authority, and the UI repeats the
              disclaimer in enough places that you can't miss it.
            </p>
            <p>
              This site is a curated walkthrough, not a marketing site. Every
              screenshot below is from a running build; every number cited
              here traces back to <span className="font-mono">tools/status.mjs</span>{" "}
              and the dated addenda in <span className="font-mono">AGENTS.md</span>.
              If a claim isn't backed, it isn't here.
            </p>
            <p className="font-mono text-[13px] text-[var(--color-pulse-night)]/80">
              — Ashraful Islam
            </p>
          </div>
        </div>
      </section>

      <PulseDivider className="block h-12 w-full bg-[var(--color-night)]" variant="long" stroke="var(--color-pulse-night)" ariaHidden />

      <section
        aria-labelledby="tl-h"
        className="bg-[var(--color-paper)]"
      >
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-24">
          <header className="max-w-[42ch]">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
              Timeline · measured
            </p>
            <h2
              id="tl-h"
              className="mt-3 text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink)]"
            >
              The seven-day arc.
            </h2>
          </header>

          <ol className="mt-12 space-y-6">
            {TIMELINE.map((m, idx) => (
              <li
                key={m.date}
                className="relative grid gap-3 rounded-xl border border-[var(--rule-hairline)] bg-white p-5 md:grid-cols-[160px_minmax(0,1fr)] md:items-start"
              >
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">
                    Milestone 0{idx + 1}
                  </p>
                  <p className="mt-2 font-mono text-[14px] font-semibold tabular-nums text-[var(--color-ink)]">
                    {m.date}
                  </p>
                </div>
                <div>
                  <h3 className="text-[16px] font-semibold leading-snug text-[var(--color-ink)]">
                    {m.headline}
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-2)]">{m.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="stack-h" className="border-y border-[var(--rule-hairline)] bg-white">
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-24">
          <header>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
              Stack
            </p>
            <h2
              id="stack-h"
              className="mt-3 text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink)]"
            >
              What it is built with.
            </h2>
          </header>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {STACK.map((s) => (
              <article
                key={s.area}
                className="rounded-xl border border-[var(--rule-hairline)] bg-[var(--color-paper)] p-5"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">
                  {s.area}
                </p>
                <ul className="mt-3 space-y-1.5 text-[14px] text-[var(--color-ink)]">
                  {s.items.map((i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className="text-[var(--color-ink-3)]">·</span>
                      <span>{i}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        aria-labelledby="scope-h"
        className="bg-[var(--color-paper-2)]"
      >
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-20">
          <header className="max-w-[42ch]">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
              What is out of scope
            </p>
            <h2
              id="scope-h"
              className="mt-3 text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink)]"
            >
              Honest about the edges.
            </h2>
          </header>
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            <li className="rounded-xl border border-[var(--rule-hairline)] bg-white p-5 text-[14px] leading-relaxed text-[var(--color-ink)]">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">Out of FYP scope</span>
              <p className="mt-2">AI-10 wearable expansion beyond Health Connect. Real Stripe payments (a deterministic stub by design). A real production deployment of FCM / SMTP (the adapters are wired, the credentials are optional).</p>
            </li>
            <li className="rounded-xl border border-[var(--rule-hairline)] bg-white p-5 text-[14px] leading-relaxed text-[var(--color-ink)]">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">Pending verification</span>
              <p className="mt-2">Driver-delivery / trip-complete screenshots depend on the missing <span className="font-mono">GET /dispatch/assignments/{`{id}`}</span> route. A few on-device Vivo verifications are queued behind the next batch.</p>
            </li>
          </ul>
          <p className="mt-8 text-[14px] text-[var(--color-ink-2)]">
            Two last places to read:{" "}
            <Link
              href="/security"
              className="font-medium text-[var(--color-brand-blue)] underline-offset-4 hover:underline"
            >
              how the security engineering was vetted
            </Link>
            , and{" "}
            <Link
              href="/how-it-works"
              className="font-medium text-[var(--color-brand-blue)] underline-offset-4 hover:underline"
            >
              the end-to-end pipeline station-by-station
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
