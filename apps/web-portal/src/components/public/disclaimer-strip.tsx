/**
 * Medical disclaimer strip — rendered on every public page in the footer band.
 * Plain language, prototype-framed. The text mirrors AGENTS.md wording so the codebase
 * and the website say the same thing.
 */
export function DisclaimerStrip({ compact = false }: { compact?: boolean }) {
  return (
    <div
      role="note"
      aria-label="Medical and prototype disclaimer"
      className={
        compact
          ? "border-t border-[var(--rule-hairline)] bg-[var(--color-night-edge)] text-[var(--color-ink-inverse)]"
          : "border-t border-[var(--rule-hairline)] bg-[var(--color-night)] text-[var(--color-ink-inverse)]"
      }
    >
      <div className="mx-auto max-w-[1180px] px-6 py-5 text-[12px] leading-relaxed">
        <p className="font-semibold uppercase tracking-[0.16em] text-[var(--color-pulse-night)]">
          Prototype · Synthetic data only
        </p>
        <p className="mt-1 max-w-[78ch] text-[var(--color-ink-inverse)]/80">
          SmartCura is an early-stage platform prototype. The system runs on synthetic
          patient data and uncalibrated prototype sensors. It is not a medical device
          and is not approved for diagnosis, treatment or any form of real patient
          care. AI-generated summaries are explicitly labelled
          <span className="font-mono"> non_diagnostic</span> and route red-flag
          findings to a human care team.
        </p>
      </div>
    </div>
  );
}
