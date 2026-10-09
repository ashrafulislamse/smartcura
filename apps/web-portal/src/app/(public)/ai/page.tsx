import Link from "next/link";
import { PulseDivider } from "@/components/public/pulse-divider";
import { ArtifactReadout } from "@/components/public/artifact-readout";

interface Stage {
  id: string;
  index: string;
  title: string;
  blurb: string;
  detail: string;
  inputs: ReadonlyArray<string>;
  outputs: ReadonlyArray<string>;
  where: string;
}

const STAGES: ReadonlyArray<Stage> = [
  {
    id: "context",
    index: "01",
    title: "Health context",
    blurb: "Profile, conditions, medications, 24-hour vitals with source provenance.",
    detail:
      "Aggregates the active patient profile, soft-deletion-filtered conditions and allergies, signed prescriptions joined to prescription_items, and 24 hours of recent vital_readings joined to devices for source provenance (ESP32 vs. Health Connect). A derived 'stale' tag attached at serialization marks anything older than five minutes — the tag is not stored, recomputed each request.",
    inputs: ["profiles (active)", "patient_conditions (deleted_at IS NULL)", "patient_allergies (deleted_at IS NULL)", "prescriptions (status='signed') JOIN prescription_items", "vital_readings JOIN devices"],
    outputs: ["LlmGenerationRequest.healthContext — present-only summary serialised in the system prompt"],
    where: "apps/api/packages/database/src/health-context.ts",
  },
  {
    id: "risk",
    index: "02",
    title: "Risk scoring",
    blurb: "Cardiovascular, fall, medication adherence, respiratory.",
    detail:
      "Each entry is a structured record with a score, a severity level and contributing factors. Schemas are strict: a RiskScore cannot be returned without its contributors; Zod enforces the shape; the database stores the projection. Risk is a projection of recent vitals against the patient's conditions and medications, never an isolated numeric.",
    inputs: ["HealthContext", "vital_readings (24h)"],
    outputs: ["RiskProfile[] with score, severity, contributing_factors"],
    where: "apps/api/packages/ai/src/risk-scoring.js",
  },
  {
    id: "anomaly",
    index: "03",
    title: "Anomaly detection",
    blurb: "Sustained elevation, acute spike, progressive decline, erratic, cyclical.",
    detail:
      "Five pattern detectors run in sequence on the same window. Each detector is a hand-coded statistical check rather than a learned one — predictable, debuggable, and explicit about its inputs. Alerts carry a pattern type and a window so the AI can quote it back in the artifact.",
    inputs: ["vital_readings timeseries (24h)"],
    outputs: ["AnomalyReport[] — pattern, window, severity"],
    where: "apps/api/packages/ai/src/anomaly-detector.js",
  },
  {
    id: "longitudinal",
    index: "04",
    title: "Longitudinal analysis",
    blurb: "Trends, rate of change, variability, seasonal patterns, health trajectory.",
    detail:
      "Improves / declines / stable classification per metric, with rate-per-day and coefficient of variation. Two-week window comparison surfaces delta-from-baseline. Health trajectory is a hand-written summary keyed to whichever vitals have at least fourteen days of context.",
    inputs: ["vital_readings timeseries (≥24h, longer when available)"],
    outputs: ["RichLongitudinalAnalysis — trajectories, windows, patterns"],
    where: "apps/api/packages/ai/src/longitudinal-analysis.js",
  },
  {
    id: "retrieval",
    index: "05",
    title: "Knowledge retrieval",
    blurb: "Keyword extraction → relevance scoring → ordinal fallback.",
    detail:
      "Symptoms, condition names and medication names are tokenised then matched against a curated knowledge catalogue. When no exact match is found, an ordinal fallback surfaces next-of-kin suggestions. The LLM cites sources by name and the artifact's `sources[]` array lists each one for the doctor to verify.",
    inputs: ["patient_conditions + medications + symptom tokens"],
    outputs: ["DrugInfo / KnowledgeCitation[]"],
    where: "apps/api/apps/worker/src/keyword-knowledge-retriever.ts",
  },
  {
    id: "generation",
    index: "06",
    title: "Generation",
    blurb: "Fireworks Kimi K3 against a non-diagnostic system prompt.",
    detail:
      "All five preceding outputs are serialised into a single system prompt. Fireworks Kimi K3 (accounts/fireworks/models/kimi-k3) was selected over DeepSeek variants because its replies reliably cite medical sources, name red-flag symptoms, and avoid hallucinated numbers. An artifact-type-specific instruction overlay drives the shape (symptom_summary focuses on patient-reported symptoms; health_summary focuses on vitals and conditions; daily_summary is a brief overview; trend_analysis is a 7-day delta).",
    inputs: ["All five stages", "artifact_type — drives the artifact shape"],
    outputs: ["AiArtifact — non_diagnostic, fields per artifact type"],
    where: "apps/api/packages/ai/src/openai.js + apps/api/packages/database/src/ai-repository.ts",
  },
];

export const metadata = {
  title: "AI pipeline",
  description:
    "Ten AI phases wired into one pipeline. Health context → risk scoring → anomaly detection → longitudinal analysis → keyword retrieval → Fireworks Kimi K3 → a non-diagnostic structured artifact.",
};

const ASIDE_NON_DIAGNOSTIC = {
  title: "Non-diagnostic by design.",
  why: "It is an early-stage prototype. The system carries no clinical claims:",
  bullets: [
    "It does not diagnose.",
    "It does not recommend treatment.",
    "It does escalate red-flag symptoms to a human care team via CRITICAL mandatoryPush notifications.",
    "Every artifact carries `non_diagnostic: true` in its schema and the disclaimer in its UI.",
  ],
} as const;

export default function AiPage() {
  return (
    <>
      <section aria-labelledby="ai-h1" className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
            AI pipeline · six stages
          </p>
          <h1
            id="ai-h1"
            className="mt-3 max-w-[28ch] text-[length:var(--text-display)] font-semibold leading-[1.04] tracking-[-0.02em] text-[var(--color-ink)]"
          >
            Ten AI phases, one pipeline.
          </h1>
          <p className="mt-6 max-w-[60ch] text-[length:var(--text-3)] text-[var(--color-ink-2)]">
            Each stage is a hand-built module. The end-to-end pipeline runs on the live
            VPS, on Fireworks Kimi K3, against the same schema-validated contract the
            patient app polls. The artifact in the right column is a synthetic demo
            excerpt — explicitly labelled, never a real patient.
          </p>
        </div>
      </section>

      <PulseDivider className="block h-12 w-full bg-[var(--color-paper)]" variant="long" stroke="var(--color-pulse)" ariaHidden />

      <FeatureStack stages={STAGES} />

      <section
        aria-labelledby="artifact-h"
        className="border-y border-[var(--rule-hairline)] bg-[var(--color-night)] text-[var(--color-ink-inverse)]"
      >
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-24">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-pulse-night)]/80">
            The artifact
          </p>
          <h2
            id="artifact-h"
            className="mt-3 max-w-[40ch] text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink-inverse)]"
          >
            What the API actually returns.
          </h2>
          <p className="mt-3 max-w-[60ch] text-[14px] text-[var(--color-ink-inverse)]/80">
            Six stages produce one structured artifact. Below is a synthetic demo
            excerpt of the <span className="font-mono">health_summary</span> shape —
            exactly the JSON the patient app renders, every field on the schema,
            every citation a real artifact would carry (with the patient demoted
            from a real name to a placeholder).
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-pulse-night)]/80">
            synthetic demo data — not a real patient
          </p>
          <div className="mt-8">
            <ArtifactReadout />
          </div>
        </div>
      </section>

      <section
        aria-labelledby="aside-h"
        className="bg-[var(--color-paper-2)]"
      >
        <div className="mx-auto max-w-[1180px] px-6 py-12 md:py-16">
          <div className="rounded-2xl border border-[var(--rule-hairline)] bg-white p-6 md:p-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-critical)]">
              {ASIDE_NON_DIAGNOSTIC.title}
            </p>
            <p className="mt-2 max-w-[60ch] text-[14px] text-[var(--color-ink-2)]">{ASIDE_NON_DIAGNOSTIC.why}</p>
            <ul className="mt-4 space-y-1.5 text-[14px] text-[var(--color-ink)]">
              {ASIDE_NON_DIAGNOSTIC.bullets.map((b) => (
                <li key={b} className="flex gap-2">
                  <span aria-hidden className="text-[var(--color-ink-3)]">·</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[14px]">
              <Link
                href="/security"
                className="font-medium text-[var(--color-brand-blue)] underline-offset-4 hover:underline"
              >
                Read the security and trust ledger
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function FeatureStack({ stages }: { stages: ReadonlyArray<Stage> }) {
  return (
    <section aria-labelledby="stack-h" className="bg-[var(--color-paper)]">
      <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-20">
        <header className="max-w-[42ch]">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
            Feature stack
          </p>
          <h2
            id="stack-h"
            className="mt-3 text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink)]"
          >
            Stages, layered.
          </h2>
          <p className="mt-4 max-w-[60ch] text-[14px] text-[var(--color-ink-2)]">
            The left rail names each stage; the right side explains inputs, outputs
            and where the code lives. <span className="font-mono">non_diagnostic: true</span>{" "}
            is a schema-level requirement — not a courtesy at the UI.
          </p>
        </header>

        <div className="mt-12 grid gap-12 md:grid-cols-[180px_minmax(0,1fr)]">
          <nav aria-label="AI pipeline stages" className="md:sticky md:top-28 md:self-start">
            <ul className="space-y-1">
              {stages.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="group flex items-center gap-3 rounded-md px-3 py-2 text-[13px] text-[var(--color-ink-2)] transition-colors hover:bg-white hover:text-[var(--color-ink)] focus-visible:bg-white focus-visible:text-[var(--color-ink)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
                  >
                    <span className="font-mono text-[11px] text-[var(--color-ink-3)]">{s.index}</span>
                    <span className="font-medium">{s.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <ol className="space-y-12">
            {stages.map((s) => (
              <li
                key={s.id}
                id={s.id}
                className="scroll-mt-28 rounded-xl border border-[var(--rule-hairline)] bg-white p-6"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-blue)]">
                  Stage {s.index}
                </p>
                <h3 className="mt-1 text-[length:var(--text-4)] font-semibold tracking-[-0.005em] text-[var(--color-ink)]">
                  {s.title}
                </h3>
                <p className="mt-2 text-[length:var(--text-2)] text-[var(--color-ink-2)]">{s.blurb}</p>
                <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-[var(--color-ink)]">{s.detail}</p>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">Inputs</p>
                    <ul className="mt-2 space-y-1 text-[13px] text-[var(--color-ink)]">
                      {s.inputs.map((i) => (
                        <li key={i} className="font-mono">{i}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">Outputs</p>
                    <ul className="mt-2 space-y-1 text-[13px] text-[var(--color-ink)]">
                      {s.outputs.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">Code</p>
                    <p className="mt-2 break-all font-mono text-[12px] text-[var(--color-ink-2)]">{s.where}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
