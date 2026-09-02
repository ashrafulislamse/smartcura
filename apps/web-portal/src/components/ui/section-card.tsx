/**
 * SectionCard — a content card with an optional title and action.
 *
 * The canonical wrapper for every content block on a doctor page: `bg-white rounded-xl border
 * border-slate-200 shadow-sm p-6`. The optional `title` and `action` render in a flex row at
 * the top so a section like "Upcoming appointments" can carry a "View all" link without each
 * page reinventing the layout.
 */

import { cn } from '@/lib/utils';

interface SectionCardProps {
  readonly title?: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
}

export default function SectionCard({ title, action, children, className, bodyClassName }: SectionCardProps) {
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200 shadow-sm', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between px-6 pt-5 pb-0">
          {title && <h2 className="text-lg font-bold text-slate-900">{title}</h2>}
          {action}
        </div>
      )}
      <div className={cn('p-6', bodyClassName)}>{children}</div>
    </div>
  );
}
