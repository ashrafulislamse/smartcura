'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageHeader from '@/components/ui/page-header';
import PageLoader from '@/components/ui/page-loader';
import StatCard from '@/components/ui/stat-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import FilterPills from '@/components/ui/filter-pills';
import SectionCard from '@/components/ui/section-card';
import ChartCard from '@/components/ui/chart-card';
import EmptyState from '@/components/ui/empty-state';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { readDoctorEarnings } from '@/lib/api/doctor-api';
import { formatSen, humaniseCode } from '@/lib/api/finance';
import { formatInstant, shortId } from '@/lib/api/directory';

type PeriodKey = 'all' | 'month' | 'quarter' | 'year';

const PERIOD_TABS: ReadonlyArray<{ key: PeriodKey; label: string }> = [
  { key: 'all', label: 'All time' },
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
];

// Tone maps keyed over the generated enum vocabularies so an invented status cannot compile
// into a wrong colour. The generated types carry `UnknownEnumValue` (a forward-compat escape
// hatch), so the lookup falls back to a neutral slate for anything the server may add later.
const ITEM_STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'amber',
  paid: 'green',
  failed: 'red',
  cancelled: 'slate',
};

const RUN_STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'slate',
  approved: 'blue',
  processing: 'amber',
  completed: 'green',
  partially_failed: 'orange',
  failed: 'red',
  cancelled: 'slate',
};

interface ChartPoint {
  readonly date: string;
  readonly net_sen: number;
}

/** True when the ISO instant falls inside the selected calendar period. */
function withinPeriod(iso: string, period: PeriodKey): boolean {
  if (period === 'all') return true;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  if (period === 'year') return d.getFullYear() === now.getFullYear();
  if (period === 'month') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  // quarter
  return (
    d.getFullYear() === now.getFullYear() &&
    Math.floor(d.getMonth() / 3) === Math.floor(now.getMonth() / 3)
  );
}

/** Compact date for chart X-axis ticks, e.g. "13 Aug". */
function formatChartDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function itemStatusTone(status: string): BadgeTone {
  return ITEM_STATUS_TONE[status] ?? 'slate';
}

function runStatusTone(status: string): BadgeTone {
  return RUN_STATUS_TONE[status] ?? 'slate';
}

export default function EarningsPayouts() {
  const { user, isLoading } = useAuth();
  const [period, setPeriod] = useState<PeriodKey>('all');
  // Doctor-scoped earnings from the ledger. The previous page read /drivers/me/earnings,
  // which is the driver-withdrawal surface and the wrong role entirely; this reads the
  // doctor's own payout items and projected balance.
  const resource = useApiResource((signal) => readDoctorEarnings({ pageSize: 100, signal }), []);

  const earnings = resource.data;
  const currency = earnings?.currency ?? 'MYR';
  const items = useMemo(() => earnings?.data ?? [], [earnings]);

  // The stat cards describe the global picture (balance, lifetime totals, this month, pending)
  // and are NOT narrowed by the period filter. Only the chart and the history table respond to it.
  const filteredItems = useMemo(
    () => items.filter((item) => withinPeriod(item.created_at, period)),
    [items, period],
  );

  const chartData = useMemo<ChartPoint[]>(
    () =>
      [...filteredItems]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((item) => ({ date: formatChartDate(item.created_at), net_sen: item.net_sen })),
    [filteredItems],
  );

  const thisMonthSen = useMemo(() => {
    const monthItems = items.filter((item) => withinPeriod(item.created_at, 'month'));
    if (monthItems.length === 0) return null;
    return monthItems.reduce((acc, item) => acc + item.net_sen, 0);
  }, [items]);

  const pendingCount = useMemo(
    () => items.filter((item) => item.status === 'pending').length,
    [items],
  );

  if (isLoading || !user || user.activeRole !== 'doctor') {
    return <PageLoader label="Loading earnings..." />;
  }

  // Client-side CSV export of the loaded payout items. No endpoint exists for this yet, so the
  // button exports the integer-sen rows already in memory. Money stays integer sen in the file.
  function handleExport() {
    if (!earnings || items.length === 0) return;
    const header =
      'Date,Period Start,Period End,Gross (sen),Platform Fee (sen),Net (sen),Status,Run Status';
    const lines = items.map((item) =>
      [
        item.created_at,
        item.period_start,
        item.period_end,
        item.gross_sen,
        item.platform_fee_sen,
        item.net_sen,
        item.status,
        item.run_status,
      ].join(','),
    );
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'doctor-earnings.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Earnings' }]} />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="My Earnings"
            subtitle="Payout balance and history for your active doctor membership."
            actions={
              <button
                onClick={handleExport}
                disabled={!earnings || items.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[20px]">download</span>
                Export
              </button>
            }
          />

          <ResourceState
            isLoading={resource.isLoading}
            error={resource.error}
            isEmpty={!resource.isLoading && !resource.error && !earnings}
            onRetry={resource.reload}
            loadingLabel="Loading earnings..."
            forbiddenTitle="You cannot view earnings"
            errorTitle="Earnings could not be loaded"
            emptyTitle="Earnings unavailable"
            emptyBody="The backend returned no earnings balance for this membership."
            emptyIcon="payments"
          />

          {earnings && (
            <>
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon="account_balance_wallet"
                  label="Balance"
                  value={formatSen(earnings.balance_sen, earnings.currency)}
                  note={`Available in ${earnings.currency}`}
                  tone="blue"
                />
                <StatCard
                  icon="payments"
                  label="Total earned"
                  value={formatSen(earnings.total_earned_sen, earnings.currency)}
                  note="Lifetime net payouts"
                  tone="green"
                />
                <StatCard
                  icon="calendar_month"
                  label="This month"
                  value={thisMonthSen === null ? '—' : formatSen(thisMonthSen, earnings.currency)}
                  note={thisMonthSen === null ? `No payouts in ${monthLabel}` : `Net for ${monthLabel}`}
                  tone="teal"
                />
                <StatCard
                  icon="hourglass_empty"
                  label="Pending"
                  value={pendingCount}
                  note={pendingCount === 0 ? 'All payouts settled' : 'Items awaiting payment'}
                  tone="amber"
                />
              </section>

              <FilterPills
                tabs={PERIOD_TABS}
                activeKey={period}
                onSelect={setPeriod}
              />

              <ChartCard title="Earnings Over Time">
                {chartData.length < 2 ? (
                  <div className="flex items-center justify-center h-full">
                    <EmptyState
                      icon="show_chart"
                      title="Not enough data to chart"
                      body="Earnings appear on this chart once at least two payout items have been posted to the ledger."
                    />
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="earningsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1e3fae" stopOpacity={1} />
                          <stop offset="100%" stopColor="#1e3fae" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12, fill: '#64748b' }}
                        tickLine={false}
                        axisLine={{ stroke: '#e2e8f0' }}
                        minTickGap={24}
                      />
                      <YAxis
                        tickFormatter={(value) =>
                          `MYR ${Math.trunc(Number(value) / 100).toLocaleString('en-MY')}`
                        }
                        tick={{ fontSize: 12, fill: '#64748b' }}
                        tickLine={false}
                        axisLine={false}
                        width={96}
                      />
                      <Tooltip
                        formatter={(value) => [formatSen(Number(value), currency), 'Net']}
                        contentStyle={{
                          borderRadius: 8,
                          border: '1px solid #e2e8f0',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                          fontSize: 13,
                        }}
                        labelStyle={{ color: '#64748b', fontSize: 12 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="net_sen"
                        stroke="#1e3fae"
                        strokeWidth={2}
                        fill="url(#earningsGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              <SectionCard title="Payout History">
                {filteredItems.length === 0 ? (
                  <EmptyState
                    icon="payments"
                    title="No payouts in this period"
                    body="Adjust the period filter above, or wait for new payout items to be posted to the ledger."
                  />
                ) : (
                  <>
                    <div className="overflow-x-auto -m-6 p-6">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr className="text-left text-xs font-bold text-slate-500 uppercase">
                            <th className="px-5 py-3">Date</th>
                            <th className="px-5 py-3">Gross</th>
                            <th className="px-5 py-3">Fee</th>
                            <th className="px-5 py-3">Net</th>
                            <th className="px-5 py-3">Status</th>
                            <th className="px-5 py-3">Run status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredItems.map((item) => (
                            <tr key={item.id} className="hover:bg-slate-50">
                              <td className="px-5 py-4">
                                <div className="font-medium text-slate-900">
                                  {formatInstant(item.created_at)}
                                </div>
                                <div className="text-xs text-slate-400">
                                  <code>{shortId(item.id)}</code>
                                </div>
                              </td>
                              <td className="px-5 py-4 text-slate-600">
                                {formatSen(item.gross_sen, earnings.currency)}
                              </td>
                              <td className="px-5 py-4 text-xs text-slate-400">
                                {formatSen(item.platform_fee_sen, earnings.currency)}
                              </td>
                              <td className="px-5 py-4 font-bold text-slate-900">
                                {formatSen(item.net_sen, earnings.currency)}
                              </td>
                              <td className="px-5 py-4">
                                <Badge tone={itemStatusTone(item.status)}>
                                  {humaniseCode(item.status)}
                                </Badge>
                              </td>
                              <td className="px-5 py-4">
                                <Badge tone={runStatusTone(item.run_status)}>
                                  {humaniseCode(item.run_status)}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 text-xs text-slate-500">
                      Showing {filteredItems.length} payout
                      {filteredItems.length === 1 ? ' item' : ' items'}
                      {period !== 'all' ? ` in this ${period === 'month' ? 'month' : period === 'quarter' ? 'quarter' : 'year'}` : ''}
                    </div>
                  </>
                )}
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
