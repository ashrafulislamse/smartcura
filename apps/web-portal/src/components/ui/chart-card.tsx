/**
 * ChartCard — a SectionCard variant with a fixed-height body for recharts.
 *
 * Recharts needs a container with an explicit height to render; without one the ResponsiveContainer
 * collapses to zero. This card sets `h-[300px]` (override with `height` prop) so every chart page
 * gets a consistent visual frame without each page hardcoding the dimension.
 */

import { cn } from '@/lib/utils';

interface ChartCardProps {
  readonly title?: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly height?: string;
  readonly className?: string;
}

export default function ChartCard({ title, action, children, height = 'h-[300px]', className }: ChartCardProps) {
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200 shadow-sm', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between px-6 pt-5 pb-0">
          {title && <h3 className="text-lg font-bold text-slate-900">{title}</h3>}
          {action}
        </div>
      )}
      <div className="p-6">
        <div className={cn('w-full', height)}>{children}</div>
      </div>
    </div>
  );
}
