/**
 * Synthetic demo excerpt of a `health_summary` artifact — the JSON the patient
 * app renders. Every field shown matches the contract schema; every citation
 * mirrors what a real run carries. The patient demoted to a placeholder name
 * reflects the dataset used during the AI-5 verification (Arif Hossain is
 * itself a synthetic patient). The label "synthetic demo data" is rendered
 * alongside, in monospace, and the disclaimer is rendered at the top.
 */
export function ArtifactReadout() {
  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--color-pulse-night)]/15 bg-[var(--color-night-deep)] font-mono text-[13px] leading-relaxed text-[var(--color-ink-inverse)] shadow-[inset_0_0_60px_-30px_var(--color-pulse-night)]">
      <header className="flex items-center justify-between border-b border-[var(--color-pulse-night)]/10 px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-[var(--color-pulse-night)]/80">
        <span>artifact_get: ai_generations/&lt;g_id&gt;/artifact</span>
        <span aria-hidden>art: ::health_summary ::</span>
      </header>

      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <p className="text-[var(--color-pulse-night)]/70">{`{`}</p>
          <p className="pl-4">
            <span className="text-[var(--color-pulse-night)]">artifact_type</span>:{" "}
            <span className="text-[var(--color-ink-inverse)]">&quot;health_summary&quot;</span>,
          </p>
          <p className="pl-4">
            <span className="text-[var(--color-pulse-night)]">non_diagnostic</span>:{" "}
            <span className="text-[var(--color-ok)]">true</span>,
          </p>
          <p className="pl-4">
            <span className="text-[var(--color-pulse-night)]">provider</span>:{" "}
            <span className="text-[var(--color-ink-inverse)]">&quot;openai&quot;</span>,
          </p>
          <p className="pl-4">
            <span className="text-[var(--color-pulse-night)]">model</span>:{" "}
            <span className="text-[var(--color-ink-inverse)]">&quot;accounts/fireworks/models/kimi-k3&quot;</span>,
          </p>
          <p className="pl-4">
            <span className="text-[var(--color-pulse-night)]">generated_at</span>:{" "}
            <span className="text-[var(--color-ink-inverse)]">&quot;2026-08-19T14:32:11Z&quot;</span>,
          </p>
          <p className="pl-4">
            <span className="text-[var(--color-pulse-night)]">summary_of_reported_symptoms</span>: [
          </p>
          <ul className="ml-8 list-disc space-y-1 marker:text-[var(--color-pulse-night)]/40">
            <li>patient (synthetic) reports intermittent fatigue over 5 days</li>
            <li>no chest pain, no syncope, no acute distress</li>
          </ul>
          <p className="pl-4">],</p>
          <p className="pl-4">
            <span className="text-[var(--color-pulse-night)]">context</span>: [
          </p>
          <ul className="ml-8 list-disc space-y-1 marker:text-[var(--color-pulse-night)]/40">
            <li>conditions: hypertension (signed, I10), type 2 diabetes (signed, E11.9)</li>
            <li>medications: amlodipine 5&nbsp;mg / day; metformin 500&nbsp;mg / twice daily</li>
            <li>recent vitals (24h): HR, SpO₂ from ESP32; values flagged where sensor is uncertain</li>
          </ul>
          <p className="pl-4">],</p>
          <p className="pl-4">
            <span className="text-[var(--color-pulse-night)]">contextual_next_step</span>:{" "}
            <span className="text-[var(--color-ink-inverse)]">
              &quot;Re-seat finger on MAX30102 for a clean 30-second reading; review
              adherence to amlodipine; clinical assessment recommended before any
              medication change.&quot;
            </span>
          </p>
          <p className="text-[var(--color-pulse-night)]/70">{`}`}</p>
        </div>

        <aside className="rounded-xl border border-[var(--color-pulse-night)]/15 bg-[var(--color-night)]/60 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-pulse-night)]/80">
            sources
          </p>
          <ul className="mt-2 space-y-1 text-[12px]">
            <li>vitals_esp32_2026-08-17_11:47:34_to_11:52:16</li>
            <li>patient_conditions_and_medications</li>
            <li>keyword_knowledge_retrieval: amlodipine · metformin</li>
          </ul>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-pulse-night)]/80">
            red-flag routing
          </p>
          <ul className="mt-2 space-y-1 text-[12px]">
            <li>none in this artifact</li>
            <li>“fainting, chest pain, confusion” would trigger CRITICAL mandatoryPush</li>
          </ul>
        </aside>
      </div>

      <footer className="border-t border-[var(--color-pulse-night)]/10 px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-[var(--color-pulse-night)]/80">
        synthetic demo data — not a real patient · non_diagnostic
      </footer>
    </article>
  );
}
