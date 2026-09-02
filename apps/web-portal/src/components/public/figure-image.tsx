interface Props {
  src: string;
  alt: string;
  caption?: string;
  aspect?: "phone" | "wide" | "tall" | "square";
  className?: string;
}

/**
 * Real, unedited screenshots presented in plain <figure>. No fake device
 * frames, no shadow tricks, no IDE chrome around photos. The aspect classes
 * are tuned to the captured screenshots in
 * report/project-2/source/screenshots/.
 */
export function FigureImage({ src, alt, caption, aspect = "wide", className }: Props) {
  return (
    <figure className={`overflow-hidden rounded-2xl border border-[var(--rule-hairline)] bg-white ${className ?? ""}`}>
      <div className={`${ASPECT[aspect]}`}>
        <img src={src} alt={alt} className="h-full w-full object-cover object-top" />
      </div>
      {caption ? (
        <figcaption className="border-t border-[var(--rule-hairline)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

const ASPECT: Record<NonNullable<Props["aspect"]>, string> = {
  wide: "aspect-[16/10]",
  tall: "aspect-[3/4]",
  phone: "aspect-[9/19]",
  square: "aspect-square",
};
