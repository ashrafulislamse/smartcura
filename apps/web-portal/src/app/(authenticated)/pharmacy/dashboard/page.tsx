'use client';

/**
 * Pharmacy dashboard, wired to GET /pharmacy-orders and GET /sites/{siteId}/inventory/batches.
 *
 * No dedicated pharmacy dashboard endpoint exists. KPIs and alerts are derived client-side
 * from the list endpoints the backend already exposes: order counts by status, and inventory
 * batches flagged for low stock or near-expiry.
 *
 * RECONCILIATION WITH THE MOCK: the mock carried patient names ("Jonathan Harker"), medication
 * names ("Lisinopril 10mg"), hardcoded KPIs (24/8/12/6/45), an "Avg Processing Time" bar chart,
 * and a "Delivery Status" panel. None of those map to real data:
 *   - the orders list carries `patient_profile_id` and `prescription_id`, not names or medication
 *     names, and no endpoint resolves either;
 *   - the KPIs were invented;
 *   - processing time requires a time-series endpoint that does not exist;
 *   - delivery status requires a fleet/transport endpoint that does not exist.
 * What replaces them is the real order pipeline by status and the real inventory batch state.
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import StatCard from '@/components/ui/stat-card';
import SectionCard from '@/components/ui/section-card';
import {
  daysUntil,
  humaniseCode,
  listInventoryBatches,
  listPharmacyOrders,
  shortId,
  type PharmacyOrderStatus,
} from '@/lib/api/pharmacy';

const ORDER_STATUS_STYLE: Record<string, string> = {
  received: 'bg-blue-50 text-blue-700 border-blue-100',
  awaiting_validation: 'bg-amber-50 text-amber-700 border-amber-100',
  validated: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  stock_reserved: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  fulfilling: 'bg-purple-50 text-purple-700 border-purple-100',
  ready_for_dispatch: 'bg-teal-50 text-teal-700 border-teal-100',
  dispatched: 'bg-green-50 text-green-700 border-green-100',
  delivered: 'bg-green-50 text-green-700 border-green-100',
  delivery_exception: 'bg-red-50 text-red-700 border-red-100',
  returned: 'bg-orange-50 text-orange-700 border-orange-100',
  rejected: 'bg-red-50 text-red-700 border-red-100',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

export default function PharmacyDashboardPage() {
  const router = useRouter();
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

  // KPI counts by order status.
  const awaitingValidation = orders.filter((o) => o.status === 'awaiting_validation').length;
  const fulfilling = orders.filter((o) => o.status === 'fulfilling').length;
  const readyForDispatch = orders.filter((o) => o.status === 'ready_for_dispatch').length;
  const dispatchedToday = orders.filter((o) => o.status === 'dispatched' || o.status === 'delivered').length;

  // Inventory alerts: low available stock or expiring within 30 days.
  const lowStock = useMemo(
    () => batches.filter((b) => b.available_quantity <= 0 && b.status === 'available'),
    [batches],
  );
  const expiringSoon = useMemo(
    () => batches.filter((b) => {
      const days = daysUntil(b.expires_on);
      return days !== null && days <= 30 && days >= 0 && b.status === 'available';
    }),
    [batches],
  );
  const expired = useMemo(
    () => batches.filter((b) => b.status === 'expired' || (daysUntil(b.expires_on) ?? 1) < 0),
    [batches],
  );

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
        <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Overview' }]} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <span className="material-symbols-outlined text-slate-300 text-5xl">local_pharmacy</span>
            <h1 className="mt-3 text-lg font-bold text-slate-900">No site assigned</h1>
            <p className="mt-1 text-sm text-slate-500">
              Pharmacy operations are site-scoped. Your membership is not linked to a site, so
              inventory and orders cannot be loaded.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Overview' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                Pharmacy Overview
              </h1>
              <p className="text-slate-500 mt-1">
                Order pipeline and inventory alerts for this site.
              </p>
            </div>
            <button
              onClick={() => { ordersResource.reload(); inventoryResource.reload(); }}
              className="px-4 py-2.5 border border-slate-200 bg-white rounded-lg font-bold text-sm text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={orders.length === 0 && batches.length === 0}
            onRetry={() => { ordersResource.reload(); inventoryResource.reload(); }}
            loadingLabel="Loading pharmacy overview…"
            forbiddenTitle="You cannot view the pharmacy dashboard"
            errorTitle="Could not load pharmacy data"
            emptyTitle="No pharmacy data"
            emptyBody="No orders or inventory batches found for this site."
            emptyIcon="local_pharmacy"
          />

          {!isLoading && !error && (orders.length > 0 || batches.length > 0) && (
            <>
              {/* KPI stat cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon="pending_actions"
                  label="Awaiting validation"
                  value={awaitingValidation}
                  note="Prescriptions to check"
                  tone="amber"
                  onClick={() => router.push('/pharmacy/validation')}
                />
                <StatCard
                  icon="science"
                  label="In preparation"
                  value={fulfilling}
                  note="Being fulfilled"
                  tone="purple"
                  onClick={() => router.push('/pharmacy/fulfillment')}
                />
                <StatCard
                  icon="local_shipping"
                  label="Ready for dispatch"
                  value={readyForDispatch}
                  note="Awaiting logistics"
                  tone="teal"
                  onClick={() => router.push('/pharmacy/logistics')}
                />
                <StatCard
                  icon="check_circle"
                  label="Dispatched / delivered"
                  value={dispatchedToday}
                  note="In transit or completed"
                  tone="green"
                />
              </div>

              {/* Inventory alerts */}
              {(lowStock.length > 0 || expiringSoon.length > 0 || expired.length > 0) && (
                <SectionCard title="Inventory alerts">
                  <div className="flex flex-col gap-3">
                    {lowStock.length > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="material-symbols-outlined text-red-600 text-[20px]">error</span>
                        <span className="text-slate-700">
                          <span className="font-bold text-red-700">{lowStock.length}</span> batch
                          {lowStock.length === 1 ? '' : 'es'} with zero available stock
                        </span>
                      </div>
                    )}
                    {expiringSoon.length > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="material-symbols-outlined text-amber-600 text-[20px]">schedule</span>
                        <span className="text-slate-700">
                          <span className="font-bold text-amber-700">{expiringSoon.length}</span> batch
                          {expiringSoon.length === 1 ? '' : 'es'} expiring within 30 days
                        </span>
                      </div>
                    )}
                    {expired.length > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="material-symbols-outlined text-red-600 text-[20px]">dangerous</span>
                        <span className="text-slate-700">
                          <span className="font-bold text-red-700">{expired.length}</span> expired batch
                          {expired.length === 1 ? '' : 'es'}
                        </span>
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

              {/* Order pipeline */}
              {orders.length > 0 && (
                <SectionCard title="Recent orders" action={
                  <button onClick={() => router.push('/pharmacy/orders')} className="text-sm font-bold text-[#1e3fae] hover:underline">
                    View all
                  </button>
                }>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide border-b border-slate-200">
                        <tr>
                          <th scope="col" className="px-3 py-2">Order</th>
                          <th scope="col" className="px-3 py-2">Patient</th>
                          <th scope="col" className="px-3 py-2">Status</th>
                          <th scope="col" className="px-3 py-2">Items</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {orders.slice(0, 10).map((order) => (
                          <tr
                            key={order.pharmacy_order_id}
                            className="hover:bg-slate-50 cursor-pointer transition-colors"
                            onClick={() => router.push(`/pharmacy/orders/${order.pharmacy_order_id}`)}
                          >
                            <td className="px-3 py-2">
                              <code className="text-xs font-bold text-slate-900">{shortId(order.pharmacy_order_id)}</code>
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {/* An identifier, not a name: no endpoint resolves a profile name. */}
                              <code className="text-xs">{shortId(order.patient_profile_id)}</code>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                                ORDER_STATUS_STYLE[order.status] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                              }`}>
                                {humaniseCode(order.status)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-600">{order.items.length}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}

              <p className="py-2 text-sm text-slate-500">
                Showing <span className="font-bold text-slate-900">{orders.length}</span> order
                {orders.length === 1 ? '' : 's'} and{' '}
                <span className="font-bold text-slate-900">{batches.length}</span> inventory batch
                {batches.length === 1 ? '' : 'es'}
                {(orders.length === 100 || batches.length === 100) && ' (server limit reached)'}.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
