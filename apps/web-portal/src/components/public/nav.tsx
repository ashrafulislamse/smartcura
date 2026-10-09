"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
 * the top of the page, morphs to a smaller padding/blur on scroll. The current
 * route's link carries an active pill. On mobile the links collapse into a
 * full-screen animated sheet behind a wordmark + menu button; the sheet
 * closes on Esc (as its hint promises) and on any link tap.
 */
export function PublicNav() {
  const pathname = usePathname();
  const [compact, setCompact] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetCloseRef = useRef<HTMLButtonElement | null>(null);

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

  // Esc closes the sheet; focus moves to the close button on open and back
  // to the menu button on close so keyboard users never lose their place.
  useEffect(() => {
    if (!sheetOpen) return;
    sheetCloseRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      menuButtonRef.current?.focus();
    };
  }, [sheetOpen]);

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href + "/"));

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-40 flex justify-center px-4 transition-all duration-300 ease-out"
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
            className="flex items-center gap-2 rounded-full pr-2 focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:4px]"
          >
            <Mark className="h-7 w-auto" />
            <span className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
              SmartCura
            </span>
          </Link>

          <ul className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => {
              const active = isActive(l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className={
                      "rounded-full px-3 py-1.5 text-[14px] font-medium underline-offset-4 transition-colors focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px] " +
                      (active
                        ? "bg-[var(--color-pulse-soft)] text-[var(--color-brand-navy)]"
                        : "text-[var(--color-ink-2)] hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)] focus-visible:bg-[var(--color-pulse-soft)] focus-visible:text-[var(--color-ink)]")
                    }
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <Link
            href={PRIMARY_CTA.href}
            className="hidden rounded-full bg-[var(--color-brand-blue)] px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-brand-blue-strong)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px] md:inline-flex"
          >
            {PRIMARY_CTA.label} <span aria-hidden> →</span>
          </Link>

          <button
            type="button"
            ref={menuButtonRef}
            aria-label="Open menu"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--color-ink)] transition-colors hover:bg-[var(--color-paper-2)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px] md:hidden"
          >
            <MenuIcon />
          </button>
        </nav>
      </header>

      {sheetOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          className="public-sheet fixed inset-0 z-50 flex flex-col bg-[var(--color-paper)] px-6 py-8"
        >
          <div className="flex items-center justify-between">
            <Link
              href="/"
              onClick={() => setSheetOpen(false)}
              className="flex items-center gap-2 rounded-full pr-2 focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:4px]"
            >
              <Mark className="h-7 w-auto" />
              <span className="text-[14px] font-semibold text-[var(--color-ink)]">SmartCura</span>
            </Link>
            <button
              type="button"
              ref={sheetCloseRef}
              aria-label="Close menu"
              onClick={() => setSheetOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--color-ink)] transition-colors hover:bg-[var(--color-paper-2)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
            >
              <CloseIcon />
            </button>
          </div>

          <ul className="mt-10 flex flex-col gap-2">
            {LINKS.map((l, i) => {
              const active = isActive(l.href);
              return (
                <li
                  key={l.href}
                  className="public-sheet-item"
                  style={{ animationDelay: `${70 + i * 45}ms` }}
                >
                  <Link
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setSheetOpen(false)}
                    className={
                      "flex items-center justify-between rounded-2xl px-3 py-3 text-[24px] font-semibold underline-offset-4 transition-colors focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px] " +
                      (active
                        ? "bg-[var(--color-pulse-soft)] text-[var(--color-brand-navy)]"
                        : "text-[var(--color-ink)] hover:bg-[var(--color-paper-2)]")
                    }
                  >
                    {l.label}
                    {active ? (
                      <span
                        aria-hidden
                        className="text-[14px] font-mono uppercase tracking-[0.18em] text-[var(--color-brand-blue)]"
                      >
                        here
                      </span>
                    ) : (
                      <span aria-hidden className="text-[18px] text-[var(--color-ink-3)]">
                        →
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="public-sheet-item mt-10" style={{ animationDelay: "320ms" }}>
            <Link
              href={PRIMARY_CTA.href}
              onClick={() => setSheetOpen(false)}
              className="inline-flex w-fit rounded-full bg-[var(--color-brand-blue)] px-5 py-3 text-[16px] font-semibold text-white transition-colors hover:bg-[var(--color-brand-blue-strong)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
            >
              {PRIMARY_CTA.label} →
            </Link>
          </div>

          <p className="mt-auto pt-12 text-[12px] text-[var(--color-ink-3)]">
            Prototype · synthetic data only. Press <span className="font-mono">Esc</span> to close.
          </p>
        </div>
      ) : null}
    </>
  );
}

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <path d="M3 5.5h14" />
      <path d="M3 10h14" />
      <path d="M3 14.5h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <path d="M5 5l10 10" />
      <path d="M15 5L5 15" />
    </svg>
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
