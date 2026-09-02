/**
 * Badge — a status/priority/severity pill.
 *
 * Extracted from the inline `inline-flex px-2.5 py-1 rounded-full text-xs font-bold border`
 * pattern duplicated across every list page (support, finance, appointments, etc.) so the
 * colour maps stop drifting. Pass a `tone` that matches the semantic meaning; the caller
 * owns the vocabulary, this component owns the visual.
 */

import { cn } from '@/lib/utils';

export type BadgeTone =
  | 'blue'
  | 'indigo'
  | 'amber'
  | 'orange'
  | 'red'
  | 'green'
  | 'purple'
  | 'slate'
  | 'teal';

const TONE_STYLE: Record<BadgeTone, string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  orange: 'bg-orange-50 text-orange-700 border-orange-100',
  red: 'bg-red-50 text-red-700 border-red-100',
  green: 'bg-green-50 text-green-700 border-green-100',
  purple: 'bg-purple-50 text-purple-700 border-purple-100',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-100',
};

interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: React.ReactNode;
  readonly className?: string;
}

export default function Badge({ tone = 'slate', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border',
        TONE_STYLE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
