import type { CSSProperties } from "react";

interface Props {
  className?: string;
  style?: CSSProperties;
  /** Width in CSS units. The block expands to fill. */
  length?: number | string;
  /** Pulse style: trace (single cycle), long (several cycles). */
  variant?: "trace" | "long";
  /** Stroke color — defaults to the cyan trace token. */
  stroke?: string;
  /** Accessible label. The SVG is decorative; aria-hidden by default. */
  "aria-label"?: string;
  ariaHidden?: boolean;
}

/**
 * Hand-built ECG segment used as a section rule across the public site.
 * The single cycle ('trace') is the rule that punctuates a page; 'long' is a
 * wider band used as a hero ornament and inside the system map.
 */
export function PulseDivider({
  className,
  style,
  variant = "trace",
  stroke = "var(--color-pulse)",
  "aria-label": ariaLabel,
  ariaHidden = true,
}: Props) {
  const path = variant === "long" ? LONG_PATH : TRACE_PATH;
  const viewBox = variant === "long" ? "0 0 480 48" : "0 0 120 24";

  return (
    <svg
      role={ariaHidden ? undefined : "img"}
      aria-label={ariaHidden ? undefined : ariaLabel}
      aria-hidden={ariaHidden ? "true" : undefined}
      focusable="false"
      viewBox={viewBox}
      preserveAspectRatio="none"
      className={className}
      style={style}
    >
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={variant === "long" ? 2 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const TRACE_PATH =
  "M0 12 H24 L30 12 L36 4 L42 20 L48 12 L60 12 H72 L78 12 L84 4 L90 20 L96 12 H120";
const LONG_PATH =
  "M0 24 H40 L52 24 L60 12 L72 36 L80 24 H120 L132 24 L140 12 L152 36 L160 24 H200 L212 24 L220 12 L232 36 L240 24 H280 L292 24 L300 12 L312 36 L320 24 H400 L412 24 L420 12 L432 36 L440 24 H480";
