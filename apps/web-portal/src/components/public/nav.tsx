"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Apps", href: "/apps" },
  { label: "AI", href: "/ai" },
  { label: "Security", href: "/security" },
  { label: "Project", href: "/project" },
];

const PRIMARY_CTA = { label: "Try the demo", href: "/demo" } as const;

/**
 * Floating pill nav — N5 archetype from the design language doc. Compact at
 * the top of the page, morphs to a smaller padding/blur on scroll. On mobile
 * the links collapse into a full-screen sheet behind a wordmark + menu button.
 */
export function PublicNav() {
  const [compact, setCompact] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while sheet is open.
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-4 transition-all duration-300 ease-out"
        style={{ paddingTop: compact ? "10px" : "16px" }}
      >
        <nav
          aria-label="Primary"
          className="flex w-full max-w-[1100px] items-center justify-between rounded-full border border-[var(--rule-hairline)]/60 bg-white/85 px-4 py-2 backdrop-blur-md transition-all duration-300 ease-out md:px-5 md:py-2.5"
          style={{
            boxShadow: compact
              ? "0 6px 24px -10px rgba(15,23,42,0.18)"
              : "0 4px 18px -12px rgba(15,23,42,0.10)",
          }}
        >
          <Link
            href="/"
            aria-label="SmartCura — home"
            className="flex items-center gap-2 focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:4px] rounded-full pr-2"
          >
            <Mark className="h-7 w-auto" />
            <span className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
              SmartCura
            </span>
          </Link>

          <ul className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="rounded-full px-3 py-1.5 text-[14px] font-medium text-[var(--color-ink-2)] underline-offset-4 transition-colors hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)] focus-visible:bg-[var(--color-pulse-soft)] focus-visible:text-[var(--color-ink)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>

          <Link
            href={PRIMARY_CTA.href}
            className="hidden rounded-full bg-[var(--color-brand-blue)] px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-brand-blue-strong)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px] md:inline-flex"
          >
            {PRIMARY_CTA.label} <span aria-hidden> →</span>
          </Link>

          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--color-ink)] hover:bg-[var(--color-paper-2)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px] md:hidden"
          >
            <span aria-hidden className="block text-[20px] leading-none">≡</span>
          </button>
        </nav>
      </header>

      {sheetOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          className="fixed inset-0 z-50 flex flex-col bg-[var(--color-paper)] px-6 py-8"
        >
          <div className="flex items-center justify-between">
            <Link
              href="/"
              onClick={() => setSheetOpen(false)}
              className="flex items-center gap-2 focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:4px] rounded-full pr-2"
            >
              <Mark className="h-7 w-auto" />
              <span className="text-[14px] font-semibold text-[var(--color-ink)]">SmartCura</span>
            </Link>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setSheetOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--color-ink)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
            >
              <span aria-hidden className="block text-[20px] leading-none">✕</span>
            </button>
          </div>

          <ul className="mt-10 flex flex-col gap-4">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setSheetOpen(false)}
                  className="block text-[24px] font-semibold text-[var(--color-ink)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>

          <Link
            href={PRIMARY_CTA.href}
            onClick={() => setSheetOpen(false)}
            className="mt-12 inline-flex w-fit rounded-full bg-[var(--color-brand-blue)] px-5 py-3 text-[16px] font-semibold text-white hover:bg-[var(--color-brand-blue-strong)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
          >
            {PRIMARY_CTA.label} →
          </Link>

          <p className="mt-auto pt-12 text-[12px] text-[var(--color-ink-3)]">
            Prototype · synthetic data only. Press <span className="font-mono">Esc</span> to close.
          </p>
        </div>
      ) : null}
    </>
  );
}

function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label=""
      className={className}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M18 28 C16 18 36 14 42 22 C46 28 44 38 38 40"
        stroke="var(--color-brand-blue)"
        strokeWidth="6"
      />
      <path
        d="M46 28 C48 18 28 14 22 22 C18 28 20 38 26 40"
        stroke="var(--color-brand-blue)"
        strokeWidth="6"
      />
      <path
        d="M14 44 C20 54 32 60 32 60 C32 60 44 54 50 44"
        stroke="var(--color-brand-blue)"
        strokeWidth="6"
      />
      <path d="M2 32 H22 L26 36 L32 22 L38 50 L44 36 L48 32 H62" stroke="var(--color-pulse)" strokeWidth="5" />
    </svg>
  );
}
