import Link from "next/link";
import { PulseDivider } from "@/components/public/pulse-divider";

export const metadata = {
  title: "Medical disclaimer",
  description:
    "SmartCura is a prototype operating on synthetic data. Not a medical device. Not for diagnosis.",
};

export default function MedicalDisclaimerPage() {
  return (
    <>
      <section
        aria-labelledby="md-h1"
        className="bg-[var(--color-night)] text-[var(--color-ink-inverse)]"
      >
        <div className="mx-auto max-w-[880px] px-6 py-20 md:py-28">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-pulse-night)]/80">
            Medical disclaimer
          </p>
          <h1
            id="md-h1"
            className="mt-3 max-w-[36ch] text-[length:var(--text-display-s)] font-semibold leading-[1.06] tracking-[-0.02em] text-[var(--color-ink-inverse)]"
          >
            This is a prototype. It cannot diagnose, treat, or monitor you.
          </h1>
        </div>
      </section>

      <PulseDivider className="block h-12 w-full bg-[var(--color-night)]" variant="long" stroke="var(--color-pulse-night)" ariaHidden />

      <article className="mx-auto max-w-[760px] px-6 py-12 md:py-20 text-[length:var(--text-2)] text-[var(--color-ink)] bg-[var(--color-paper)]">
        <p className="rounded-xl border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/8 p-5 font-medium text-[var(--color-ink)]">
          SmartCura is a final-year university prototype. It operates on
          synthetic data only and is not a medical device. It must not be
          relied on for clinical decisions, emergency response, or real
          patient care.
        </p>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          Synthetic data and prototype sensors
        </h2>
        <p className="mt-4 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          Every vital reading in the screenshots and live demonstrations is
          synthetic. The MAX30102 sensor on the development kit is uncalibrated
          and not cleared for medical use. The simulated ECG and SpO₂ shown on
          the home page are drawn in your browser and never see a real patient.
        </p>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          AI is non-diagnostic by design
        </h2>
        <p className="mt-4 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          Every AI artifact carries a "non-diagnostic" flag in its structured
          response. The model is wired to{" "}
          <Link href="/ai" className="font-medium text-[var(--color-brand-blue)] underline-offset-4 hover:underline">Fireworks Kimi K3</Link>{" "}
          with a system prompt that frames outputs as educational summaries
          only and that cites its sources explicitly. The system does not
          diagnose, does not prescribe, and does not predict outcomes.
        </p>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          If you are unwell
        </h2>
        <p className="mt-4 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          If you think you may have a medical emergency, contact your local
          emergency number immediately. If you are researching a condition,
          speak with a qualified clinician. The data, charts, and AI
          summaries shown anywhere in this prototype must not be used in
          place of that conversation.
        </p>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          What production deployment requires
        </h2>
        <p className="mt-4 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          Promoting this prototype into a real clinical product requires
          engineering, clinical, privacy, security, and regulatory work that
          intentionally sits outside the FYP scope — including, but not
          limited to: ISO 13485 quality system establishment, IEC 62304
          software lifecycle conformance, MDR / FDA QSR submission, clinical
          trials, validated deployment, regulated-data hosting, and an
          end-to-end safety case. None of that work has been done.
        </p>

        <p className="mt-12 text-[13px] text-[var(--color-ink-3)]">
          This disclaimer is duplicated at the bottom of every public-hosted
          page and inside the authenticated portal, so it cannot be missed by
          accident.
        </p>
      </article>
    </>
  );
}
