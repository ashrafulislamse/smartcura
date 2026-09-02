'use client';

/**
 * Emergency analytics — aggregations derived from the event list, wired to
 * GET /emergencies?active_only=false and GET /admin/metrics.
 *
 * The backend exposes no dedicated emergency analytics endpoint. The `emergencies` group
 * in `/admin/metrics` returns only `{ active: number }` — a single count. Everything else
 * this page shows is computed client-side from the event list the server returns.
 *
 * THE 100-EVENT LIMIT IS A CEILING, NOT A COMPLETE DATASET. The server caps the list at
 * 100 rows. If the organization has more events than that, the charts and medians reflect
 * only the most recent 100 — which is what the server chose to return. The footer says so.
 *
 * RECONCILIATION WITH THE MOCK: the mock carried hardcoded figures ("8m 12s", "1,240",
 * "88%", "94%"), a fabricated SVG trend line, a CSS-blur "heatmap", and a "Fleet
 * Utilization" panel. None of those map to real data:
 *   - response time trend requires a time-series endpoint that does not exist;
 *   - the heatmap requires PostGIS density data that the pinned image cannot provide;
 *   - fleet utilization requires a unit listing endpoint that does not exist.
 * What replaces them is an honest distribution of real events by status, priority and
 * outcome, plus median response times computed from the stage instants each event carries.
 */

import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageHeader from '@/components/ui/page-header';
import StatCard from '@/components/ui/stat-card';
import ChartCard from '@/components/ui/chart-card';
import {
  listEmergencyEvents,
  minutesBetween,
  formatDuration,
  humaniseCode,
  TERMINAL_STATUSES,
} from '@/lib/api/emergency';
import { readAdminMetrics } from '@/lib/api/metrics';

const TOOLTIP_STYLE = {
  contentStyle: {
    borderRadius: '0.75rem',
    border: '1px solid #e2e8f0',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    fontSize: '0.875rem',
  },
  labelStyle: { color: '#334155', fontWeight: 700 },
};

/** Status slice colours for the pie chart. */
const STATUS_COLOR: Readonly<Record<string, string>> = {
  created: '#ef4444',
  triaged: '#f97316',
  dispatching: '#f59e0b',
  unit_assigned: '#3b82f6',
  responding: '#6366f1',
  on_scene: '#8b5cf6',
  transporting: '#06b6d4',
  resolved: '#22c55e',
  cancelled: '#94a3b8',
  false_alarm: '#64748b',
};
const DEFAULT_STATUS_COLOR = '#cbd5e1';

/** Priority bar colours. */
const PRIORITY_COLOR: Readonly<Record<string, string>> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#3b82f6',
  unknown: '#94a3b8',
};
const DEFAULT_PRIORITY_COLOR = '#cbd5e1';

/** Median of an array of numbers, or null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

export default function EmergencyAnalyticsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();

  // All events (active + terminal) for aggregation. Capped at 100 by the server.
  const eventsResource = useApiResource(
    (signal) => listEmergencyEvents({ activeOnly: false, limit: 100, signal }),
    [],
  );

  // Admin metrics for the server-side active count.
  const metricsResource = useApiResource((signal) => readAdminMetrics(signal), []);

  const events = useMemo(() => eventsResource.data?.data ?? [], [eventsResource.data]);
  const activeFromMetrics = metricsResource.data?.data.emergencies?.active ?? null;

  const isLoading = eventsResource.isLoading;
  const error = eventsResource.error;

  // --- Aggregations ---

  const total = events.length;
  const activeCount = events.filter((e) => !TERMINAL_STATUSES.has(e.status)).length;
  const resolvedCount = events.filter((e) => e.status === 'resolved').length;
  const falseAlarmCount = events.filter((e) => e.status === 'false_alarm').length;
  const cancelledCount = events.filter((e) => e.status === 'cancelled').length;

  // Median time from creation to dispatch.
  const dispatchTimes = useMemo(
    () =>
      events
        .filter((e) => e.dispatched_at !== null)
        .map((e) => minutesBetween(e.created_at, e.dispatched_at))
        .filter((v): v is number => v !== null),
    [events],
  );
  const medianDispatch = median(dispatchTimes);

  // Median handling time: creation to resolution.
  const handlingTimes = useMemo(
    () =>
      events
        .filter((e) => e.resolved_at !== null)
        .map((e) => minutesBetween(e.created_at, e.resolved_at))
        .filter((v): v is number => v !== null),
    [events],
  );
  const medianHandling = median(handlingTimes);

  // False-alarm rate.
  const falseAlarmRate = total > 0 ? Math.round((falseAlarmCount / total) * 100) : null;

  // Status distribution for the pie chart.
  const statusData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) {
      counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([status, count]) => ({ name: humaniseCode(status), count }))
      .sort((a, b) => b.count - a.count);
  }, [events]);

  // Priority distribution for the bar chart.
  const priorityData = useMemo(() => {
    const order = ['critical', 'high', 'medium', 'low', 'unknown'];
    const counts = new Map<string, number>();
    for (const e of events) {
      counts.set(e.triage_priority, (counts.get(e.triage_priority) ?? 0) + 1);
    }
    return order
      .filter((p) => counts.has(p))
      .map((p) => ({ name: humaniseCode(p), count: counts.get(p) ?? 0, key: p }));
  }, [events]);

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Emergency' }, { label: 'Analytics' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Performance Analytics"
            subtitle="Aggregated from the most recent emergency events. Server caps the list at 100."
            actions={
              <button
                onClick={eventsResource.reload}
                className="px-4 py-2.5 border border-slate-200 bg-white rounded-lg font-bold text-sm text-slate-700 hover:bg-slate-50"
              >
                Refresh
              </button>
            }
          />

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={total === 0}
            onRetry={eventsResource.reload}
            loadingLabel="Loading emergency analytics…"
            forbiddenTitle="You cannot view emergency analytics"
            errorTitle="Could not load analytics"
            emptyTitle="No emergency events"
            emptyBody="There are no events to aggregate yet."
            emptyIcon="bar_chart"
          />

          {!isLoading && !error && total > 0 && (
            <>
              {/* KPI stat cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon="emergency"
                  label="Total events"
                  value={total}
                  note={total === 100 ? 'Server limit reached' : undefined}
                  tone="red"
                />
                <StatCard
                  icon="radio_button_checked"
                  label="Active now"
                  value={activeFromMetrics ?? activeCount}
                  note={activeFromMetrics !== null ? 'From /admin/metrics' : 'From event list'}
                  tone="amber"
                />
                <StatCard
                  icon="check_circle"
                  label="Resolved"
                  value={resolvedCount}
                  tone="green"
                />
                <StatCard
                  icon="cancel"
                  label="False alarms"
                  value={falseAlarmCount}
                  note={falseAlarmRate !== null ? `${falseAlarmRate}% of total` : undefined}
                  tone="slate"
                />
              </div>

              {/* Response time medians */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard
                  icon="timer"
                  label="Median dispatch"
                  value={formatDuration(medianDispatch)}
                  note={`${dispatchTimes.length} dispatched events`}
                  tone="blue"
                />
                <StatCard
                  icon="hourglass_top"
                  label="Median handling"
                  value={formatDuration(medianHandling)}
                  note={`${handlingTimes.length} resolved events`}
                  tone="purple"
                />
                <StatCard
                  icon="block"
                  label="Cancelled"
                  value={cancelledCount}
                  note="Closed without resolution"
                  tone="slate"
                />
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartCard title="Status distribution" height="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        innerRadius={50}
                        paddingAngle={2}
                      >
                        {statusData.map((entry, index) => {
                          const key = Object.keys(STATUS_COLOR).find(
                            (k) => humaniseCode(k) === entry.name,
                          );
                          return (
                            <Cell
                              key={index}
                              fill={key ? STATUS_COLOR[key] : DEFAULT_STATUS_COLOR}
                            />
                          );
                        })}
                      </Pie>
                      <Tooltip {...TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Priority distribution" height="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={priorityData} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        axisLine={{ stroke: '#e2e8f0' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                        width={40}
                      />
                      <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {priorityData.map((entry, index) => (
                          <Cell
                            key={index}
                            fill={PRIORITY_COLOR[entry.key] ?? DEFAULT_PRIORITY_COLOR}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <p className="py-2 text-sm text-slate-500">
                Aggregated from <span className="font-bold text-slate-900">{total}</span> event
                {total === 1 ? '' : 's'}
                {total === 100 && ' (server limit; older events are not included)'}.
                Response medians are computed from the stage instants each event carries.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
