"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  to: number;
  /** Duration in ms, defaults to 600. */
  duration?: number;
  /** Optional suffix rendered after the number. */
  suffix?: string;
  /** Optional prefix rendered before the number. */
  prefix?: string;
  className?: string;
}

/**
 * Animate a count-up once on viewport entry. Uses tabular-nums in mono space
 * to avoid layout shift. Renders the final value immediately when reduced
 * motion is requested.
 */
export function CountUp({ to, duration = 600, suffix, prefix, className }: Props) {
  // Start at the final value so the server-rendered HTML (and the no-JS
  // fallback) shows the honest number — never a flash of 0. The animation
  // rewinds to 0 on the client only, after mount, when the value scrolls into
  // view.
  const [value, setValue] = useState(to);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setValue(to);
      return;
    }

    // Client-only: rewind to 0 so the entry animation has somewhere to go.
    // If the value is already in view when this mounts (short pages), the
    // observer below fires immediately and the count runs at once.
    setValue(0);

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started.current) {
            started.current = true;
            const start = performance.now();
            const tick = (now: number) => {
              const elapsed = now - start;
              const t = Math.min(1, elapsed / duration);
              const eased = 1 - Math.pow(1 - t, 3); // cubic-out
              setValue(Math.round(eased * to));
              if (t < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            io.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [to, duration]);

  const display = `${prefix ?? ""}${value.toLocaleString()}${suffix ?? ""}`;
  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
