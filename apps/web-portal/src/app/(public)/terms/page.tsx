import Link from "next/link";
import { PulseDivider } from "@/components/public/pulse-divider";

export const metadata = {
  title: "Terms of use",
  description:
    "Terms covering use of the SmartCura public website. Clarifies scope: this is a prototype advertising a prototype.",
};

export default function TermsPage() {
  return (
    <>
      <section aria-labelledby="t-h1" className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[760px] px-6 py-16 md:py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
            Terms of use — public site
          </p>
          <h1
            id="t-h1"
            className="mt-3 max-w-[24ch] text-[length:var(--text-display-s)] font-semibold leading-[1.06] tracking-[-0.02em] text-[var(--color-ink)]"
          >
            The short version, then the longer one.
          </h1>
        </div>
      </section>

      <PulseDivider className="block h-10 w-full bg-[var(--color-paper)]" variant="long" stroke="var(--color-pulse)" ariaHidden />

      <article className="mx-auto max-w-[760px] px-6 py-12 md:py-16 text-[length:var(--text-2)] text-[var(--color-ink)]">
        <p className="rounded-xl border border-[var(--rule-hairline)] bg-[var(--color-paper-2)] p-5 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          This website describes a prototype. It does not offer medical
          advice, diagnosis, or treatment. It does not accept clinical
          information, contact data, or login credentials. It links to a
          separately-operated authenticated platform that has its own terms.
        </p>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          1. What you may do on this site
        </h2>
        <ul className="mt-4 ml-6 list-disc space-y-2">
          <li>Read the documentation, look at screenshots, inspect the code via the links in the footer.</li>
          <li>Run a copy locally against the open-source SmartCura repository for evaluation purposes.</li>
          <li>Quote screenshots and excerpts in a thesis, review, or thesis defence, with attribution to the author.</li>
        </ul>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          2. What you may not do
        </h2>
        <ul className="mt-4 ml-6 list-disc space-y-2">
          <li>Submit any personal health information, real patient identifiers, or real clinical notes anywhere on this surface.</li>
          <li>Attempt to authenticate against the platform via the public-host path; the host-based redirect will refuse.</li>
          <li>Copy the system or its screenshots and present them as a working medical device, regulated product, or production service.</li>
        </ul>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          3. No warranty
        </h2>
        <p className="mt-4 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          This site and the platform it documents are provided as-is, on a
          prototype basis, without warranty of any kind. Service availability,
          data accuracy, and clinical safety are explicitly outside the FYP
          scope. The disclaimers on the home page, in the footer, and on{" "}
          <Link href="/medical-disclaimer" className="font-medium text-[var(--color-brand-blue)] underline-offset-4 hover:underline">the medical disclaimer page</Link>{" "}
          apply to every artefact shown.
        </p>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          4. Intellectual property
        </h2>
        <p className="mt-4 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          The SmartCura name, logo set, and code are released under the terms
          set out in <span className="font-mono">LICENSE</span> in the repository.
          Third-party names and logos — Flutter, Firebase, LiveKit, Cloudflare,
          Caddy, Traefik, Coolify, Fireworks AI — belong to their respective
          owners and are used here for accuracy only.
        </p>

        <h2 className="mt-12 text-[length:var(--text-4)] font-semibold tracking-[-0.005em]">
          5. Contact
        </h2>
        <p className="mt-4 text-[length:var(--text-2)] text-[var(--color-ink-2)]">
          Questions about scope, design decisions, or how to evaluate this
          project, please open a discussion on the public GitHub Discussion
          tab linked from the project page in the footer.
        </p>
      </article>
    </>
  );
}
