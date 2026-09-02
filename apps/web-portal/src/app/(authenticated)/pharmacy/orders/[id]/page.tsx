'use client';

/**
 * Pharmacy order detail, wired to GET /pharmacy-orders/{id}.
 *
 * RECONCILIATION WITH THE PREVIOUS MOCK. The mock carried a patient name/avatar/contact,
 * a prescribing doctor name and specialty, a delivery address, instructions, an Rx number
 * and a hard-coded timeline. None of that is modelled on the order: the API carries the
 * site, the patient and prescription IDENTIFIERS, the status, the version and the item
 * lines (variant, quantity, unit price). Names and addresses are REMOVED rather than
 * approximated — nothing resolves them here, and the timeline is derived from status and
 * timestamps, not a separate list.
 */

import { useParams, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  formatInstant,
  formatSen,
  getPharmacyOrder,
  humaniseCode,
  shortId,
} from '@/lib/api/pharmacy';
import TopBar from '@/components/layout/TopBar';

const STATUS_STYLE: Record<string, string> = {
  received: 'bg-blue-50 text-blue-700 border-blue-100',
  awaiting_validation: 'bg-amber-50 text-amber-700 border-amber-100',
  validated: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  stock_reserved: 'bg-purple-50 text-purple-700 border-purple-100',
  fulfilling: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  ready_for_dispatch: 'bg-teal-50 text-teal-700 border-teal-100',
  dispatched: 'bg-slate-50 text-slate-700 border-slate-100',
  delivered: 'bg-green-50 text-green-700 border-green-100',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  rejected: 'bg-red-50 text-red-700 border-red-100',
};

export default function OrderDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const orderId = String(params.id);

  const resource = useApiResource(
    (signal) => getPharmacyOrder(orderId, signal),
    [orderId],
  );

  const order = resource.data ?? null;

  const orderTotalSen = useMemo(
    () => order?.items.reduce((sum, item) => sum + item.unit_price_sen * item.quantity, 0) ?? 0,
    [order],
  );

  const notFound = resource.error?.status === 404;

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Pharmacy', href: '/pharmacy/orders' },
          { label: 'Orders', href: '/pharmacy/orders' },
          { label: shortId(orderId) },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1000px] mx-auto flex flex-col gap-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-[#1e3fae] transition-colors self-start"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to orders
          </button>

          {notFound ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">receipt_long</span>
              <h2 className="font-bold text-slate-900 mt-3">Order not found</h2>
              <p className="text-sm text-slate-500 mt-1">
                This order does not exist or is not accessible to your membership.
              </p>
              <button
                onClick={() => router.push('/pharmacy/orders')}
                className="inline-block mt-4 text-sm font-bold text-[#1e3fae] hover:underline"
              >
                Back to orders
              </button>
            </div>
          ) : (
            <ResourceState
              isLoading={resource.isLoading}
              error={resource.error}
              isEmpty={false}
              onRetry={resource.reload}
              loadingLabel="Loading the order…"
              forbiddenTitle="You cannot view this order"
              errorTitle="Could not load the order"
              emptyTitle=""
              emptyBody=""
              emptyIcon=""
            />
          )}

          {order && !resource.error && (
            <div className="flex flex-col gap-6">
              {/* Header */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                  <div>
                    <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                      Order {shortId(order.pharmacy_order_id)}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                      Placed {formatInstant(order.created_at)} · updated{' '}
                      {formatInstant(order.updated_at)} · version {order.version}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold border self-start md:self-auto ${
                      STATUS_STYLE[order.status] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                    }`}
                  >
                    {humaniseCode(order.status)}
                  </span>
                </div>
              </div>

              {/* Parties — identifiers, not names */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Site
                  </p>
                  <code className="text-slate-700">{shortId(order.site_id)}</code>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Patient
                  </p>
                  <code className="text-slate-700">{shortId(order.patient_profile_id)}</code>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Prescription
                  </p>
                  <code className="text-slate-700">{shortId(order.prescription_id)}</code>
                </div>
              </div>

              {/* Items — line totals are derived from unit_price_sen × quantity (integer sen),
                  the same projection the server would compute. No stored total column exists. */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-bold text-slate-900">Items</h2>
                  {order.items.length > 0 && (
                    <span className="text-sm font-bold text-slate-500">
                      Total {formatSen(orderTotalSen)}
                    </span>
                  )}
                </div>
                {order.items.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    This order has no item lines.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                        <th scope="col" className="px-6 py-3">Variant</th>
                        <th scope="col" className="px-6 py-3 text-right">Qty</th>
                        <th scope="col" className="px-6 py-3 text-right">Unit price</th>
                        <th scope="col" className="px-6 py-3 text-right">Line total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {order.items.map((item) => (
                        <tr key={item.order_item_id}>
                          <td className="px-6 py-3">
                            <code className="text-slate-700">{shortId(item.variant_id)}</code>
                          </td>
                          <td className="px-6 py-3 text-right text-slate-600">{item.quantity}</td>
                          <td className="px-6 py-3 text-right text-slate-600">
                            {formatSen(item.unit_price_sen)}
                          </td>
                          <td className="px-6 py-3 text-right font-semibold text-slate-900">
                            {formatSen(item.unit_price_sen * item.quantity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
