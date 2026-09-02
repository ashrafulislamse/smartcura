"use client";

import { useEffect, useRef } from "react";

interface Props {
  /** Visible labelled caption — the canvas itself is aria-hidden. */
  caption?: string;
  /** Show a SpO2-style ring alongside the trace. */
  showRing?: boolean;
  /** Live-ish BPM label displayed on the ring. */
  bpm?: number;
  spO2?: number;
}

/**
 * Simulated ECG trace + SpO2 ring drawn on <canvas>. The component is a
 * client island whose loop pauses when the tab is hidden, when the canvas
 * scrolls off-screen, or when the user has opted into reduced motion. A
 * static pre-drawn fallback renders in the reduced-motion case.
 *
 * This is decoration only — it does not represent a real patient. The caption
 * is required and accompanies the canvas next to it.
 */
export function TelemetryCanvas({
  caption = "Simulated telemetry — prototype firmware. Not a real patient.",
  showRing = true,
  bpm = 72,
  spO2 = 98,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ringRef = useRef<SVGSVGElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Geometry: responsive to device pixel ratio.
    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapper);

    // Pre-computed synthetic ECG sample (a single normalised QRS shape repeated).
    // Coordinates are 0..1 in width, 0..1 in height. The centerline is 0.5.
    const QRS = [
      0.00, 0.5, 0.06, 0.5, 0.10, 0.42, 0.13, 0.62, 0.165, 0.86, 0.18, 0.20,
      0.21, 0.55, 0.24, 0.48, 0.27, 0.50, 0.40, 0.50,
    ] as const;

    let raf: number | null = null;
    let running = true;
    let offset = 0;
    let lastDraw = performance.now();
    const speed = 0.00045; // trace-shift per ms

    const draw = (now: number) => {
      if (!running) return;
      const rect = wrapper.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      // Soft baseline grid
      ctx.strokeStyle = "rgba(103, 232, 249, 0.06)";
      ctx.lineWidth = 1;
      for (let y = 1; y < 4; y++) {
        ctx.beginPath();
        ctx.moveTo(0, (h / 4) * y);
        ctx.lineTo(w, (h / 4) * y);
        ctx.stroke();
      }

      // The trace.
      offset = (offset + (now - lastDraw) * speed) % 1;
      lastDraw = now;

      ctx.strokeStyle = "var(--color-pulse-night, #67E8F9)";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const cycle = 0.36; // % of width per QRS
      const baseline = h * 0.55;
      const amplitude = h * 0.34;

      ctx.beginPath();
      const totalCycles = Math.ceil(w / (w * cycle)) + 2;
      for (let c = -1; c <= totalCycles; c++) {
        const x0 = c * (w * cycle) - offset * (w * cycle);
        for (let i = 0; i < QRS.length; i += 2) {
          const px = x0 + QRS[i] * (w * cycle);
          const py = baseline - (QRS[i + 1] - 0.5) * amplitude * 2;
          if (px < -20) continue;
          if (px > w + 20) break;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    };

    const start = () => {
      if (prefersReducedMotion.matches) {
        // Static frame: same trace at offset=0.
        const rect = wrapper.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        ctx.clearRect(0, 0, w, h);
        const cycle = 0.36;
        const baseline = h * 0.55;
        const amplitude = h * 0.34;
        ctx.strokeStyle = "var(--color-pulse-night, #67E8F9)";
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        const totalCycles = Math.ceil(w / (w * cycle)) + 2;
        for (let c = -1; c <= totalCycles; c++) {
          const x0 = c * (w * cycle);
          for (let i = 0; i < QRS.length; i += 2) {
            const px = x0 + QRS[i] * (w * cycle);
            const py = baseline - (QRS[i + 1] - 0.5) * amplitude * 2;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
        return;
      }
      running = true;
      lastDraw = performance.now();
      raf = requestAnimationFrame(draw);
    };

    const stop = () => {
      running = false;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
    };

    // Pause when tab is hidden or canvas scrolls off.
    const onVis = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    const onIntersect: IntersectionObserverCallback = (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) start();
        else stop();
      }
    };

    const io = new IntersectionObserver(onIntersect, { threshold: 0.1 });
    io.observe(wrapper);
    document.addEventListener("visibilitychange", onVis);

    const onReducedMotionChange = () => {
      stop();
      start();
    };
    prefersReducedMotion.addEventListener?.("change", onReducedMotionChange);

    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      prefersReducedMotion.removeEventListener?.("change", onReducedMotionChange);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="flex flex-col">
      <figure
        aria-hidden="true"
        className="relative overflow-hidden rounded-2xl border border-[var(--color-pulse-night)]/15 bg-[var(--color-night)]/85 shadow-[inset_0_0_60px_-30px_var(--color-pulse-night)]"
      >
        <canvas
          ref={canvasRef}
          className="block h-[180px] w-full md:h-[220px]"
        />
        {showRing ? (
          <div className="pointer-events-none absolute right-5 top-5 hidden md:block">
            <SpO2Ring ringRef={ringRef} bpm={bpm} spO2={spO2} />
          </div>
        ) : null}
        <div className="pointer-events-none absolute left-5 top-5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-pulse-night)]/80">
          <span className="block h-2 w-2 rounded-full bg-[var(--color-pulse-night)] shadow-[0_0_8px_var(--color-pulse-night)]" />
          lead II · simulated
        </div>
      </figure>
      <figcaption className="mt-2 text-[12px] text-[var(--color-ink-3)]">
        {caption}
      </figcaption>
    </div>
  );
}

function SpO2Ring({ ringRef, bpm, spO2 }: { ringRef: React.RefObject<SVGSVGElement>; bpm: number; spO2: number; }) {
  const C = 2 * Math.PI * 44;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--color-pulse-night)]/15 bg-[var(--color-night-deep)]/70 px-3 py-2 backdrop-blur-sm">
      <svg
        ref={ringRef}
        viewBox="0 0 100 100"
        className="h-14 w-14"
        fill="none"
        strokeLinecap="round"
      >
        <circle cx="50" cy="50" r="44" stroke="var(--color-pulse-night)" strokeOpacity="0.18" strokeWidth="6" />
        <circle
          cx="50"
          cy="50"
          r="44"
          stroke="var(--color-pulse-night)"
          strokeWidth="6"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - (spO2 / 100))}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="flex flex-col font-mono">
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-pulse-night)]/70">SpO₂</span>
        <span className="text-[20px] font-semibold leading-none tabular-nums text-[var(--color-pulse-night)]">
          {spO2}
          <span className="text-[12px] text-[var(--color-pulse-night)]/70"> %</span>
        </span>
        <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--color-pulse-night)]/70">
          HR {bpm} <span className="opacity-60">/min</span>
        </span>
      </div>
    </div>
  );
}
