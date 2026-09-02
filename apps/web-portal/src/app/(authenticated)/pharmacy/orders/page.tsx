'use client';

/**
 * Pharmacy orders, wired to GET /pharmacy-orders.
 *
 * THE ORDER LIFECYCLE IS THE POINT OF THIS PAGE, so the status is not just a badge: the
 * stages run received → awaiting_validation → validated → stock_reserved → fulfilling →
 * ready_for_dispatch → dispatched → delivered, and what a pharmacist needs to know is which
 * orders are WAITING ON THEM rather than on a courier or a patient. Orders in a pharmacy
 * stage are grouped and counted separately from orders that have left the building.
 *
 * `stock_reserved` deserves special attention and gets it: stock is held for that order and
 * unavailable to anyone else, so an order sitting there is consuming inventory. That is a
 * cost of delay the status alone does not communicate.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  formatInstant,
  humaniseCode,
  listPharmacyOrders,
  shortId,
  type PharmacyOrderStatus,
} from '@/lib/api/pharmacy';
import TopBar from '@/components/layout/TopBar';

/** Stages where the order is the pharmacy's responsibility. */
const PHARMACY_STAGES: ReadonlySet<string> = new Set([
  'received',
  'awaiting_validation',
  'validated',
  'stock_reserved',
  'fulfilling',
  'ready_for_dispatch',
]);

const TABS: ReadonlyArray<{ key: 'all' | PharmacyOrderStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'received', label: 'Received' },
  { key: 'awaiting_validation', label: 'Validating' },
  { key: 'validated', label: 'Validated' },
  { key: 'stock_reserved', label: 'Stock reserved' },
  { key: 'fulfilling', label: 'Fulfilling' },
  { key: 'ready_for_dispatch', label: 'Ready' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS_STYLE: Record<string, string> = {
  received: 'bg-blue-50 text-blue-700 border-blue-100',
  validating: 'bg-amber-50 text-amber-700 border-amber-100',
  validated: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  stock_reserved: 'bg-purple-50 text-purple-700 border-purple-100',
  fulfilling: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  ready_for_dispatch: 'bg-teal-50 text-teal-700 border-teal-100',
  dispatched: 'bg-slate-50 text-slate-700 border-slate-100',
  delivered: 'bg-green-50 text-green-700 border-green-100',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  rejected: 'bg-red-50 text-red-700 border-red-100',
};

export default function PharmacyOrdersPage() {
  const router = useRouter();
  const { user, activeMembership, isLoading: isAuthLoading } = useAuth();
  const [tab, setTab] = useState<'all' | PharmacyOrderStatus>('all');

  // The membership is the authority on which site this pharmacist works, so the site is
  // read from it rather than kept anywhere else where it could go stale after a role change.
  const siteId = activeMembership?.site_ids?.[0];

  const { data, isLoading, error, reload } = useApiResource(
    (signal) =>
      listPharmacyOrders({ siteId, status: tab === 'all' ? undefined : tab, signal }),
    [siteId, tab],
  );

  const orders = useMemo(() => data?.data ?? [], [data]);

  const withPharmacy = useMemo(
    () => orders.filter((order) => PHARMACY_STAGES.has(order.status)).length,
    [orders],
  );
  const holdingStock = useMemo(
    () => orders.filter((order) => order.status === 'stock_reserved').length,
    [orders],
  );

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Orders' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Pharmacy Orders</h1>
            <p className="text-slate-500 mt-1">
              Prescription orders for this site through validation, reservation and fulfilment.
            </p>
          </div>

          {!siteId && (
            // Stated rather than shown as an empty list: the reason is a missing site
            // assignment, and no amount of retrying fixes that.
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
              <span className="font-bold">No pharmacy site is assigned to your membership.</span>{' '}
              Orders are site-scoped, so an administrator must assign you to a site before this
              page can show anything.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'receipt_long', tint: 'text-blue-600', label: 'Orders', value: String(orders.length), note: 'In view' },
              { icon: 'local_pharmacy', tint: 'text-cyan-600', label: 'With pharmacy', value: String(withPharmacy), note: 'Awaiting action here' },
              { icon: 'lock', tint: 'text-purple-600', label: 'Holding stock', value: String(holdingStock), note: 'Reserved, unavailable to others' },
            ].map((card) => (
              <div key={card.label} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className={`material-symbols-outlined ${card.tint} text-2xl`}>{card.icon}</span>
                  <span className="text-xs font-bold text-slate-500">{card.label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">{isLoading ? '—' : card.value}</p>
                <p className="text-xs text-slate-500 mt-1">{card.note}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {TABS.map((option) => (
              <button
                key={option.key}
                onClick={() => setTab(option.key)}
                className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  tab === option.key
                    ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={orders.length === 0}
            onRetry={reload}
            loadingLabel="Loading pharmacy orders…"
            forbiddenTitle="You cannot view orders for this site"
            errorTitle="Could not load pharmacy orders"
            emptyTitle="No orders for this filter"
            emptyBody="Orders appear once a signed prescription reaches this pharmacy."
            emptyIcon="receipt_long"
          />

          {!isLoading && !error && orders.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Pharmacy orders for this site</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Order</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3">Stage</th>
                    <th scope="col" className="px-5 py-3">Items</th>
                    <th scope="col" className="px-5 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((order) => {
                    const withUs = PHARMACY_STAGES.has(order.status);
                    return (
                      <tr
                        key={order.pharmacy_order_id}
                        onClick={() => router.push(`/pharmacy/orders/${order.pharmacy_order_id}`)}
                        className={`cursor-pointer hover:bg-slate-50 transition-colors ${
                          order.status === 'stock_reserved' ? 'bg-purple-50/30' : ''
                        }`}
                      >
                        <td className="px-5 py-3">
                          <code className="text-xs text-slate-700">
                            {shortId(order.pharmacy_order_id)}
                          </code>
                          <span className="block text-xs text-slate-400">
                            patient {shortId(order.patient_profile_id)} · prescription{' '}
                            {shortId(order.prescription_id)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                              STATUS_STYLE[order.status] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                            }`}
                          >
                            {humaniseCode(order.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          {withUs ? 'With pharmacy' : 'Left the pharmacy'}
                          {order.status === 'stock_reserved' && (
                            <span className="block text-xs text-purple-700">holding stock</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-600">{order.items?.length ?? 0}</td>
                        <td className="px-5 py-3 text-slate-500">{formatInstant(order.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && !error && orders.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{orders.length}</span> order
              {orders.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
