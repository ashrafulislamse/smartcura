import Link from "next/link";
import { LiveHref, MEASURED, MEASURED_AT } from "@/lib/site-data";
import { DisclaimerStrip } from "./disclaimer-strip";

const STATIC_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Apps", href: "/apps" },
  { label: "AI", href: "/ai" },
  { label: "Security", href: "/security" },
  { label: "Project", href: "/project" },
  { label: "Demo", href: "/demo" },
];

const LEGAL_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Medical disclaimer", href: "/medical-disclaimer" },
];

/**
 * Statement-style footer. Three rows on the night band: a status line that ties
 * the design to the live demo, a link row covering the four nav targets plus
 * project, demo and legal, then the disclaimer strip.
 */
export function PublicFooter({ liveHrefs }: { liveHrefs: ReadonlyArray<LiveHref> }) {
  return (
    <footer>
      <div className="bg-[var(--color-night)] text-[var(--color-ink-inverse)]">
        <div className="mx-auto max-w-[1180px] px-6 py-12 md:py-16">
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
            <div>
              <SiteMark inverted />
              <p className="mt-4 max-w-[36ch] text-[var(--color-ink-inverse)]/85">
                Final-year project · IoT + AI telehealth, verified end-to-end on the
                live VPS — synthetic data only.
              </p>
              <p className="mt-4 font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--color-pulse-night)]/85">
                <span aria-hidden>●</span> live demo verified {MEASURED_AT}
              </p>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-ink-inverse)]/60">
                Pages
              </h3>
              <ul className="mt-4 space-y-2">
                {STATIC_LINKS.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-[var(--color-ink-inverse)]/85 underline-offset-4 transition-colors hover:text-[var(--color-pulse-night)] hover:underline focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-ink-inverse)]/60">
                Live surfaces
              </h3>
              <ul className="mt-4 space-y-2">
                {liveHrefs.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-ink-inverse)]/85 underline-offset-4 transition-colors hover:text-[var(--color-pulse-night)] hover:underline focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
                    >
                      {l.label} <span aria-hidden>↗</span>
                    </a>
                  </li>
                ))}
              </ul>

              <h3 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-ink-inverse)]/60">
                Legal
              </h3>
              <ul className="mt-4 space-y-2">
                {LEGAL_LINKS.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-[var(--color-ink-inverse)]/85 underline-offset-4 transition-colors hover:text-[var(--color-pulse-night)] hover:underline focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-3 border-t border-[var(--color-ink-inverse)]/10 pt-6 text-[12px] text-[var(--color-ink-inverse)]/60 md:flex-row md:items-center md:justify-between">
            <p className="font-mono">
              <span aria-hidden>◆</span> {MEASURED.restOperations} REST ops ·{" "}
              {MEASURED.migrations} migrations · {MEASURED.localTests}/{MEASURED.localTests}{" "}
              tests · {MEASURED.tables} tables
            </p>
            <p>
              <a
                href="https://github.com/ashrafulislamse/smartcura"
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
              >
                Source on GitHub ↗
              </a>
            </p>
          </div>
        </div>
      </div>
      <DisclaimerStrip />
    </footer>
  );
}

export function SiteMark({ inverted = false }: { inverted?: boolean }) {
  const file = inverted
    ? "/brand/logos/smartcura-logo-horizontal-white.svg"
    : "/brand/logos/smartcura-logo-horizontal.svg";
  return (
    <span
      role="img"
      aria-label="SmartCura"
      className="inline-block h-[44px] w-auto"
      style={{
        backgroundImage: `url(${file})`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "left center",
        backgroundSize: "contain",
        width: "190px",
      }}
    />
  );
}
