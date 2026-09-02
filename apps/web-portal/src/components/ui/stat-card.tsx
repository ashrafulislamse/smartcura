/**
 * StatCard — a premium KPI card with icon container, accent colour, value and optional note.
 *
 * Replaces the flat "label + number" cards that were duplicated across the dashboard, IoT,
 * earnings and appointments pages. The icon sits in a tinted container that matches the accent,
 * the value uses `text-3xl font-bold` for visual weight, and the whole card lifts on hover via
 * the `bento-card` class already defined in globals.css but previously unused.
 */

import { cn } from '@/lib/utils';

export type StatCardTone = 'blue' | 'red' | 'amber' | 'green' | 'purple' | 'teal' | 'slate';

const TONE_ICON: Record<StatCardTone, string> = {
  blue: 'bg-[#1e3fae]/10 text-[#1e3fae]',
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-600',
  green: 'bg-green-50 text-green-600',
  purple: 'bg-purple-50 text-purple-600',
  teal: 'bg-teal-50 text-teal-600',
  slate: 'bg-slate-100 text-slate-600',
};

interface StatCardProps {
  readonly icon: string;
  readonly label: string;
  readonly value: string | number;
  readonly note?: string;
  readonly tone?: StatCardTone;
  readonly onClick?: () => void;
  readonly className?: string;
}

export default function StatCard({
  icon,
  label,
  value,
  note,
  tone = 'blue',
  onClick,
  className,
}: StatCardProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'bento-card bg-white p-5 rounded-xl border border-slate-200 shadow-sm text-left w-full',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={cn('material-symbols-outlined text-2xl p-2 rounded-lg', TONE_ICON[tone])}>
          {icon}
        </span>
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-3xl font-bold text-slate-900 tracking-tight">{value}</p>
      {note && <p className="text-xs text-slate-500 mt-1">{note}</p>}
    </Comp>
  );
}
