import Link from "next/link";
import { PulseDivider } from "@/components/public/pulse-divider";

export const metadata = {
  title: "Privacy notice",
  description:
    "What SmartCura's public website collects, what it doesn't, and where the boundary between the marketing site and the authenticated platform sits.",
};

export default function PrivacyPage() {
  return (
    <>
      <section aria-labelledby="priv-h1" className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[760px] px-6 py-16 md:py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
            Privacy — public site
          </p>
          <h1
            id="priv-h1"
            className="mt-3 max-w-[24ch] text-[length:var(--text-display-s)] font-semibold leading-[1.06] tracking-[-0.02em] text-[var(--color-ink)]"
          >
            The boundary between this site and the platform.
          </h1>
          <p className="mt-6 text-[length:var(--text-3)] text-[var(--color-ink-2)]">
            Effective 19 August 2026. The SmartCura public marketing site sits at{" "}
            <span className="font-mono">smartcura.app</span> and, by design, does not touch
            patient data. This page documents that boundary.
          </p>
        </div>
      </section>

      <PulseDivider className="block h-10 w-full bg-[var(--color-paper)]" variant="long" stroke="var(--color-pulse)" ariaHidden />

      <article className="mx-auto max-w-[760px] px-6 py-12 md:py-16 text-[length:var(--text-2)] text-[var(--color-ink)]">
        <h2 className="text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          What this site does
        </h2>
        <ul className="mt-4 ml-6 list-disc space-y-2">
          <li>It serves static text and precomputed screenshots.</li>
          <li>It includes a small set of UI components that animate under <span className="font-mono">requestAnimationFrame</span> when the host page is in view; the animation is local to your browser and never reports back.</li>
          <li>It links to the authenticated portal at <span className="font-mono">portal.smartcura.app</span> and to the upstream live services (API health, LiveKit, MQTT) for verification.</li>
        </ul>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          What this site does not do
        </h2>
        <ul className="mt-4 ml-6 list-disc space-y-2">
          <li>It never sets the <span className="font-mono">__Host-smartcura_session</span> cookie.</li>
          <li>It never calls <span className="font-mono">/api/v1/*</span> — the same-origin proxy is <em>only</em> mounted against the portal host.</li>
          <li>It never reads or writes to the local PostgreSQL database or to the worker outbox.</li>
          <li>It never observes patient identifiers, vital readings, or clinical notes.</li>
        </ul>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          Synthesised content
        </h2>
        <p className="mt-4 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          Every screenshot on this site shows a real, deployed build of the
          system operating on synthetic data. The AI assistant artifact shown on {" "}
          <Link href="/ai" className="font-medium text-[var(--color-brand-blue)] underline-offset-4 hover:underline">the AI page</Link>{" "}
          is a structurally faithful demonstration with all patient
          identifiers demoted. The simulated ECG and SpO₂ values on the home
          page are rendered locally; no reading leaves your browser.
        </p>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          Server logs
        </h2>
        <p className="mt-4 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          Requests to this site are served by Caddy and proxied by Traefik on
          the live VPS. Operators can read combined access logs which include
          the request path, IP, response status, and user agent — the standard
          Nginx-style format. Logs are rotated and used only for capacity
          planning and incident response.
        </p>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          Where to go for platform-side questions
        </h2>
        <p className="mt-4 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          Patient data handling, consent records, retention windows, and
          cross-border data transfers for the actual telemedicine platform sit
          inside the authenticated portal and are governed by the operator's
          production privacy notice — not this page. Contact the data
          controller for a copy.
        </p>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          Limitations
        </h2>
        <p className="mt-4 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          SmartCura is an early-stage prototype. It is not a regulated medical
          device and is not for clinical use. It operates on synthetic data
          only. Production deployment of these commitments still requires the
          engineering, clinical, privacy, security, and regulatory work that
          intentionally sits outside the current product scope.
        </p>
      </article>
    </>
  );
}
