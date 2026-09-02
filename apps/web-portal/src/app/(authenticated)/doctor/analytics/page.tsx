'use client';

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  readDoctorAnalytics,
  DOCTOR_ANALYTICS_GROUPS,
  DOCTOR_ANALYTICS_GROUP_LABEL,
  type DoctorAnalyticsGroup,
} from '@/lib/api/doctor-api';
import { formatSen } from '@/lib/api/finance';
import { formatInstant, humaniseCode } from '@/lib/api/directory';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import StatCard from '@/components/ui/stat-card';
import SectionCard from '@/components/ui/section-card';
import ChartCard from '@/components/ui/chart-card';

/**
 * Pie slice colours, one per appointment status. Keyed over the known status vocabulary so a
 * new status falls through to the slate default rather than rendering transparent. The palette
 * matches the design-system chart colours.
 */
const STATUS_COLOR: Readonly<Record<string, string>> = {
  pending_payment: '#f59e0b',
  confirmed: '#1e3fae',
  checked_in: '#6366f1',
  in_progress: '#8b5cf6',
  cancelled: '#ef4444',
  completed: '#22c55e',
  no_show: '#f97316',
  rescheduled: '#64748b',
};

/** Fallback colour for a status the map does not name. */
const DEFAULT_STATUS_COLOR = '#94a3b8';

/** Shared tooltip styling for every chart. */
const TOOLTIP_STYLE = {
  contentStyle: {
    borderRadius: '0.75rem',
    border: '1px solid #e2e8f0',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    fontSize: '0.875rem',
  },
  labelStyle: { color: '#334155', fontWeight: 700 },
};

export default function MyAnalytics() {
  const { user, isLoading } = useAuth();
  // Doctor-scoped analytics. The previous page read /admin/metrics, which is organization-wide
  // and a doctor membership is not entitled to read; this reads exactly the caller's practice.
  const resource = useApiResource(readDoctorAnalytics, []);

  if (isLoading || !user || user.activeRole !== 'doctor') {
    return <PageLoader label="Loading your analytics..." />;
  }

  const response = resource.data;
  const groups = response?.data;
  const readable = new Set<string>(response?.readable_groups ?? []);
  // A projection is present iff readable_groups lists it AND a value was returned. An omitted
  // projection is uncomputable or refused, not zero, so its section is hidden rather than shown
  // with empty numbers.
  const hasGroup = (name: DoctorAnalyticsGroup) => readable.has(name) && groups?.[name] !== undefined;
  const breakdown = groups?.appointment_status_breakdown ?? [];
  const trend = groups?.patient_count_trend ?? [];
  const rating = groups?.rating_summary;
  const projection = groups?.monthly_earnings_projection;
  const anyPresent = DOCTOR_ANALYTICS_GROUPS.some((name) => hasGroup(name));

  // Chart-ready datasets, derived (not stored) from the API shapes.
  const breakdownData = breakdown.map((row) => ({
    name: humaniseCode(row.status),
    value: row.count,
    color: STATUS_COLOR[row.status] ?? DEFAULT_STATUS_COLOR,
  }));
  const trendData = trend.map((point) => ({
    period_start: point.period_start,
    label: formatInstant(point.period_start),
    count: point.count,
  }));

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Analytics' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Practice Analytics"
            subtitle="Doctor-specific analytics over the last 30 days. Only projections the backend could compute honestly are shown."
          />

          <ResourceState
            isLoading={resource.isLoading}
            error={resource.error}
            isEmpty={!resource.isLoading && !resource.error && !response}
            onRetry={resource.reload}
            loadingLabel="Loading your analytics..."
            forbiddenTitle="Analytics unavailable"
            errorTitle="Analytics could not be loaded"
            emptyTitle="No analytics available"
            emptyBody="The backend returned no doctor-specific analytics for this membership."
            emptyIcon="analytics"
          />

          {response && (
            <>
              {!anyPresent && (
                <p className="text-sm text-slate-500">
                  No analytics projections are available for this membership right now.
                </p>
              )}

              {hasGroup('appointment_status_breakdown') && (
                <ChartCard title={DOCTOR_ANALYTICS_GROUP_LABEL.appointment_status_breakdown}>
                  {breakdown.length === 0 ? (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-sm text-slate-500">No appointments in the window.</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={breakdownData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={2}
                        >
                          {breakdownData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          {...TOOLTIP_STYLE}
                          formatter={(value: number, name: string) => [`${value} appointment${value === 1 ? '' : 's'}`, name]}
                        />
                        <Legend
                          verticalAlign="bottom"
                          height={36}
                          iconType="circle"
                          wrapperStyle={{ fontSize: '0.8rem', color: '#475569' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>
              )}

              {hasGroup('patient_count_trend') && (
                <ChartCard title={DOCTOR_ANALYTICS_GROUP_LABEL.patient_count_trend}>
                  {trend.length === 0 ? (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-sm text-slate-500">No trend points in the window.</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickLine={false}
                          axisLine={{ stroke: '#cbd5e1' }}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickLine={false}
                          axisLine={{ stroke: '#cbd5e1' }}
                          width={40}
                        />
                        <Tooltip
                          {...TOOLTIP_STYLE}
                          formatter={(value: number) => [`${value} assigned`, 'Patients']}
                        />
                        <Line
                          type="monotone"
                          dataKey="count"
                          stroke="#1e3fae"
                          strokeWidth={2.5}
                          dot={{ r: 4, fill: '#1e3fae', strokeWidth: 0 }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>
              )}

              {hasGroup('rating_summary') && rating && (
                <SectionCard title={DOCTOR_ANALYTICS_GROUP_LABEL.rating_summary}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <StatCard
                      icon="star"
                      label="Average rating"
                      value={rating.rating_average.toFixed(2)}
                      note={rating.review_count === 0 ? 'No reviews yet' : 'Out of 5 across all reviews'}
                      tone="amber"
                    />
                    <StatCard
                      icon="reviews"
                      label="Reviews"
                      value={rating.review_count}
                      note={rating.review_count === 0 ? 'Awaiting first review' : 'Total patient reviews'}
                      tone="blue"
                    />
                  </div>
                </SectionCard>
              )}

              {hasGroup('monthly_earnings_projection') && projection && (
                <SectionCard
                  title={DOCTOR_ANALYTICS_GROUP_LABEL.monthly_earnings_projection}
                  action={
                    <span className="text-xs text-slate-400">
                      from {formatInstant(projection.period_start)}
                    </span>
                  }
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <StatCard
                      icon="payments"
                      label="Projected this month"
                      value={formatSen(projection.projected_sen, projection.currency)}
                      note="Linear projection from the current basis"
                      tone="green"
                    />
                    <StatCard
                      icon="event_available"
                      label="Basis (appointments)"
                      value={projection.basis_count}
                      note="Appointments the projection is built from"
                      tone="blue"
                    />
                  </div>
                  <ChartCard height="h-[200px]" className="border-0 shadow-none">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[{ name: 'Projected', amount: projection.projected_sen / 100 }]}
                        margin={{ top: 8, right: 24, bottom: 8, left: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 12, fill: '#64748b' }}
                          tickLine={false}
                          axisLine={{ stroke: '#cbd5e1' }}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickLine={false}
                          axisLine={{ stroke: '#cbd5e1' }}
                          width={56}
                        />
                        <Tooltip
                          {...TOOLTIP_STYLE}
                          formatter={(value: number) => [`${projection.currency} ${value.toFixed(2)}`, 'Projected']}
                        />
                        <Bar dataKey="amount" fill="#22c55e" radius={[6, 6, 0, 0]} barSize={80} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </SectionCard>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
