interface StationSummary {
  id: string;
  title: string;
  one_liner: string;
}

interface Props {
  stations: ReadonlyArray<StationSummary>;
}

/**
 * Hand-built horizontal system-map SVG that lays out six stations along a
 * single trace. Below 768px the layout switches to a vertical rail that
 * preserves the same reading order. Each station is a clickable anchor to
 * the corresponding detail panel on the page.
 */
export function SystemMap({ stations }: Props) {
  return (
    <section
      aria-label="SmartCura system map"
      className="border-y border-[var(--rule-hairline)] bg-[var(--color-paper)]"
    >
      <div className="mx-auto max-w-[1180px] px-6 py-12 md:py-16">
        {/* Wide layout */}
        <div className="hidden md:block">
          <svg
            viewBox="0 0 1100 360"
            role="img"
            aria-label="System map: Body → Edge → Transport → Platform → Intelligence → Care"
            className="block h-auto w-full"
          >
            <defs>
              <linearGradient id="trace" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--color-pulse)" />
                <stop offset="100%" stopColor="var(--color-pulse-night)" />
              </linearGradient>
            </defs>

            {/* Background grid */}
            <g stroke="var(--rule-hairline)" strokeWidth="1">
              {[60, 120, 180, 240, 300].map((y) => (
                <line key={y} x1="60" y1={y} x2="1040" y2={y} />
              ))}
            </g>

            {/* Trace — a single sweep that crosses through every node */}
            <path
              d="M60 180 H160 L180 180 L200 110 L240 250 L260 180 H380 L400 180 L420 110 L460 250 L480 180 H600 L620 180 L640 110 L680 250 L700 180 H820 L840 180 L860 110 L900 250 L920 180 H1040"
              fill="none"
              stroke="url(#trace)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* Stations */}
            {stations.map((s, idx) => {
              const x = 100 + idx * 188;
              const y = 180;
              return (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:6px]"
                >
                  <circle cx={x} cy={y} r="44" fill="white" stroke="var(--color-pulse)" strokeWidth="2" />
                  <text x={x} y={y + 5} textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight="600" fontSize="22" fill="var(--color-ink)">
                    0{idx + 1}
                  </text>
                  <text x={x} y={y + 56} textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight="600" fontSize="14" fill="var(--color-ink)">
                    {s.title.replace(/^[^\s—]+\s—\s/, "")}
                  </text>
                </a>
              );
            })}
          </svg>
        </div>

        {/* Narrow layout — vertical rail. */}
        <ol className="space-y-6 md:hidden">
          {stations.map((s, idx) => (
            <li key={s.id} className="rounded-xl border border-[var(--rule-hairline)] bg-white p-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-pulse-soft)] font-mono text-[14px] font-semibold text-[var(--color-ink)]">
                  0{idx + 1}
                </span>
                <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{s.title}</h3>
              </div>
              <p className="mt-2 text-[13px] text-[var(--color-ink-2)]">{s.one_liner}</p>
              <a
                href={`#${s.id}`}
                className="mt-2 inline-block text-[12px] font-medium text-[var(--color-brand-blue)] underline-offset-4 hover:underline"
              >
                Details →
              </a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
