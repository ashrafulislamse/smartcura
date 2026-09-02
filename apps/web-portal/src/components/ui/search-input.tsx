/**
 * SearchInput — search field with a leading Material icon.
 *
 * Extracted from the inline pattern in support/tickets and finance/transactions: a relative
 * wrapper with an absolute `search` icon on the left that turns blue on focus. The input uses
 * `focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae]` for a consistent focus style.
 */

interface SearchInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly className?: string;
}

export default function SearchInput({ value, onChange, placeholder = 'Search...', className }: SearchInputProps) {
  return (
    <div className={`relative w-full group ${className ?? ''}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#1e3fae] transition-colors">
        <span className="material-symbols-outlined">search</span>
      </span>
      <input
        className="w-full bg-white text-sm text-slate-900 rounded-lg border border-slate-200 pl-10 pr-4 py-3 placeholder-slate-400 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all shadow-sm"
        placeholder={placeholder}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
