/**
 * PageHeader — consistent title row for every doctor page.
 *
 * Replaces the 11 inline `<header><h1><p></header>` blocks that drifted in font-size,
 * tracking and spacing. The title uses `text-3xl font-extrabold tracking-tight`, the subtitle
 * is `text-slate-500`, and optional `actions` render right-aligned (e.g. a "New" button or a
 * date-range selector). Every page that adopts this gets the same visual weight.
 */

import { cn } from '@/lib/utils';

interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: React.ReactNode;
  readonly className?: string;
}

export default function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col md:flex-row md:items-end justify-between gap-4', className)}>
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
