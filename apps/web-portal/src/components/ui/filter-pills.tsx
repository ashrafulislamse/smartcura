/**
 * FilterPills — a row of selectable filter/tab pills.
 *
 * Extracted from the inline tab rows in support/tickets, appointments, and finance. The active
 * pill uses `bg-[#1e3fae] text-white border-[#1e3fae]`; inactive pills are white with a hover.
 * Generic over the key type so each page's vocabulary is type-safe.
 */

interface FilterPillsProps<K extends string> {
  readonly tabs: ReadonlyArray<{ key: K; label: string }>;
  readonly activeKey: K;
  readonly onSelect: (key: K) => void;
  readonly className?: string;
}

export default function FilterPills<K extends string>({ tabs, activeKey, onSelect, className }: FilterPillsProps<K>) {
  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ''}`}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onSelect(tab.key)}
          className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
            activeKey === tab.key
              ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
