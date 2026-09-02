'use client';

/**
 * Pharmacy analytics — aggregations derived from order and inventory list endpoints.
 *
 * No dedicated pharmacy analytics endpoint exists. This page computes distributions from
 * `GET /pharmacy-orders` and `GET /sites/{siteId}/inventory/batches`, rendered with recharts.
 *
 * THE 100-ROW LIMIT IS A CEILING. Both list endpoints cap at 100 rows. If the site has more
 * orders or batches than that, the charts reflect only the most recent 100.
 *
 * RECONCILIATION WITH THE MOCK: the mock carried projected demand ("14,203 units"), revenue
 * forecast ("$1.24 M"), operational ROI ("22.4%"), a demand forecasting SVG chart, a
 * profitability heatmap, a delivery efficiency scatter, a customer churn funnel, and an
 * inventory anomalies table — all hardcoded. None of those map to real data. What replaces
 * them is the real order status distribution, inventory batch status distribution, and
 * near-expiry batch counts computed from the actual list endpoints.
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
import SectionCard from '@/components/ui/section-card';
import {
  daysUntil,
  humaniseCode,
  listInventoryBatches,
  listPharmacyOrders,
  shortId,
} from '@/lib/api/pharmacy';

const TOOLTIP_STYLE = {
  contentStyle: {
    borderRadius: '0.75rem',
    border: '1px solid #e2e8f0',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    fontSize: '0.875rem',
  },
  labelStyle: { color: '#334155', fontWeight: 700 },
};

const ORDER_STATUS_COLOR: Readonly<Record<string, string>> = {
  received: '#3b82f6',
  awaiting_validation: '#f59e0b',
  validated: '#6366f1',
  stock_reserved: '#06b6d4',
  fulfilling: '#8b5cf6',
  ready_for_dispatch: '#14b8a6',
  dispatched: '#22c55e',
  delivered: '#16a34a',
  delivery_exception: '#ef4444',
  returned: '#f97316',
  rejected: '#dc2626',
  cancelled: '#94a3b8',
};
const DEFAULT_ORDER_COLOR = '#cbd5e1';

const BATCH_STATUS_COLOR: Readonly<Record<string, string>> = {
  available: '#22c55e',
  quarantined: '#f59e0b',
  recalled: '#ef4444',
  expired: '#64748b',
  depleted: '#94a3b8',
};
const DEFAULT_BATCH_COLOR = '#cbd5e1';

export default function PharmacyAnalyticsPage() {
  const { user, activeMembership, isLoading: isAuthLoading } = useAuth();
  const siteId = activeMembership?.site_ids?.[0] ?? null;

  const ordersResource = useApiResource(
    (signal) => listPharmacyOrders({ siteId: siteId ?? undefined, limit: 100, signal }),
    [siteId],
  );

  const inventoryResource = useApiResource(
    (signal) => (siteId ? listInventoryBatches(siteId, { signal }) : Promise.resolve(null)),
    [siteId],
  );

  const orders = useMemo(() => ordersResource.data?.data ?? [], [ordersResource.data]);
  const batches = useMemo(() => inventoryResource.data?.data ?? [], [inventoryResource.data]);

  const isLoading = ordersResource.isLoading || inventoryResource.isLoading;
  const error = ordersResource.error ?? inventoryResource.error;

  // --- Aggregations ---

  const totalOrders = orders.length;
  const totalBatches = batches.length;

  // Order status distribution for pie chart.
  const orderStatusData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) {
      counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([status, count]) => ({ name: humaniseCode(status), count, key: status }))
      .sort((a, b) => b.count - a.count);
  }, [orders]);

  // Batch status distribution for pie chart.
  const batchStatusData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of batches) {
      counts.set(b.status, (counts.get(b.status) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([status, count]) => ({ name: humaniseCode(status), count, key: status }))
      .sort((a, b) => b.count - a.count);
  }, [batches]);

  // Near-expiry batches (within 30 days).
  const expiringBatches = useMemo(
    () =>
      batches
        .filter((b) => {
          const days = daysUntil(b.expires_on);
          return days !== null && days <= 30 && days >= 0 && b.status === 'available';
        })
        .map((b) => ({
          batch_id: shortId(b.batch_id),
          expires_on: b.expires_on,
          days_left: daysUntil(b.expires_on),
          available: b.available_quantity,
        }))
        .sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0)),
    [batches],
  );

  // Available vs reserved vs posted across batches.
  const stockBreakdown = useMemo(() => {
    const totalPosted = batches.reduce((sum, b) => sum + b.posted_quantity, 0);
    const totalReserved = batches.reduce((sum, b) => sum + b.reserved_quantity, 0);
    const totalAvailable = batches.reduce((sum, b) => sum + b.available_quantity, 0);
    return [
      { name: 'Posted', count: totalPosted, key: 'posted' },
      { name: 'Reserved', count: totalReserved, key: 'reserved' },
      { name: 'Available', count: totalAvailable, key: 'available' },
    ];
  }, [batches]);

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  if (!siteId) {
    return (
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
        <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Analytics' }]} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <span className="material-symbols-outlined text-slate-300 text-5xl">bar_chart</span>
            <h1 className="mt-3 text-lg font-bold text-slate-900">No site assigned</h1>
            <p className="mt-1 text-sm text-slate-500">
              Pharmacy analytics are site-scoped. Your membership is not linked to a site.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Analytics' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Pharmacy Analytics"
            subtitle="Aggregated from recent orders and inventory batches. Server caps lists at 100."
            actions={
              <button
                onClick={() => { ordersResource.reload(); inventoryResource.reload(); }}
                className="px-4 py-2.5 border border-slate-200 bg-white rounded-lg font-bold text-sm text-slate-700 hover:bg-slate-50"
              >
                Refresh
              </button>
            }
          />

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={totalOrders === 0 && totalBatches === 0}
            onRetry={() => { ordersResource.reload(); inventoryResource.reload(); }}
            loadingLabel="Loading pharmacy analytics…"
            forbiddenTitle="You cannot view pharmacy analytics"
            errorTitle="Could not load analytics"
            emptyTitle="No pharmacy data"
            emptyBody="No orders or inventory batches found for this site."
            emptyIcon="bar_chart"
          />

          {!isLoading && !error && (totalOrders > 0 || totalBatches > 0) && (
            <>
              {/* KPI stat cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon="receipt_long"
                  label="Total orders"
                  value={totalOrders}
                  note={totalOrders === 100 ? 'Server limit reached' : undefined}
                  tone="blue"
                />
                <StatCard
                  icon="inventory_2"
                  label="Inventory batches"
                  value={totalBatches}
                  note={totalBatches === 100 ? 'Server limit reached' : undefined}
                  tone="teal"
                />
                <StatCard
                  icon="schedule"
                  label="Expiring soon"
                  value={expiringBatches.length}
                  note="Within 30 days"
                  tone="amber"
                />
                <StatCard
                  icon="check_circle"
                  label="Available batches"
                  value={batches.filter((b) => b.status === 'available').length}
                  note="Ready for use"
                  tone="green"
                />
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartCard title="Order status distribution" height="h-[320px]">
                  {orderStatusData.length === 0 ? (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-sm text-slate-500">No orders to chart.</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={orderStatusData}
                          dataKey="count"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          innerRadius={50}
                          paddingAngle={2}
                        >
                          {orderStatusData.map((entry, index) => (
                            <Cell
                              key={index}
                              fill={ORDER_STATUS_COLOR[entry.key] ?? DEFAULT_ORDER_COLOR}
                            />
                          ))}
                        </Pie>
                        <Tooltip {...TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>

                <ChartCard title="Inventory batch status" height="h-[320px]">
                  {batchStatusData.length === 0 ? (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-sm text-slate-500">No batches to chart.</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={batchStatusData}
                          dataKey="count"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          innerRadius={50}
                          paddingAngle={2}
                        >
                          {batchStatusData.map((entry, index) => (
                            <Cell
                              key={index}
                              fill={BATCH_STATUS_COLOR[entry.key] ?? DEFAULT_BATCH_COLOR}
                            />
                          ))}
                        </Pie>
                        <Tooltip {...TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>
              </div>

              {/* Stock breakdown bar chart */}
              <ChartCard title="Stock quantities across batches" height="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stockBreakdown} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
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
                      width={50}
                    />
                    <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: '#f1f5f9' }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#1e3fae" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Near-expiry batches table */}
              {expiringBatches.length > 0 && (
                <SectionCard title="Batches expiring within 30 days">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide border-b border-slate-200">
                        <tr>
                          <th scope="col" className="px-3 py-2">Batch</th>
                          <th scope="col" className="px-3 py-2">Expires on</th>
                          <th scope="col" className="px-3 py-2 text-right">Days left</th>
                          <th scope="col" className="px-3 py-2 text-right">Available qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {expiringBatches.map((b) => (
                          <tr key={b.batch_id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-2"><code className="text-xs font-bold">{b.batch_id}</code></td>
                            <td className="px-3 py-2 text-slate-600">{b.expires_on}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={`font-bold ${(b.days_left ?? 0) <= 7 ? 'text-red-700' : 'text-amber-700'}`}>
                                {b.days_left}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700 font-bold">{b.available}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}

              <p className="py-2 text-sm text-slate-500">
                Aggregated from <span className="font-bold text-slate-900">{totalOrders}</span> order
                {totalOrders === 1 ? '' : 's'} and{' '}
                <span className="font-bold text-slate-900">{totalBatches}</span> batch
                {totalBatches === 1 ? '' : 'es'}
                {(totalOrders === 100 || totalBatches === 100) && ' (server limits; older rows not included)'}.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
