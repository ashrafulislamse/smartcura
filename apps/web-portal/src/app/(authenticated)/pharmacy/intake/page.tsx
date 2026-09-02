'use client';

/**
 * Medicine intake (goods receipt), wired to POST /procurement/purchase-orders/{id}/receipts.
 *
 * The backend models intake as receiving goods against an existing purchase order: the caller
 * selects an ordered PO, enters the variant, lot number, expiry date and received quantity,
 * and the server creates a batch + receipt + positive ledger movement in one transaction.
 *
 * RECONCILIATION WITH THE MOCK: the mock was a 4-step wizard collecting medicine name, generic
 * name, category, manufacturer, SKU, controlled-substance flag, batch ID, lot number, expiry,
 * manufacture date, stock quantity, unit, unit cost, storage temperature, humidity, handling
 * instructions and a hazardous flag. The real `ReceiveGoodsRequest` accepts only four fields:
 * `variant_id`, `lot_number`, `expires_on` and `received_quantity`. Everything else the mock
 * collected has no corresponding API field — the medication catalogue, batch metadata and
 * stock ledger are managed by the backend, not entered by hand on an intake form.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import {
  formatInstant,
  humaniseCode,
  listPurchaseOrders,
  receiveGoods,
  shortId,
} from '@/lib/api/pharmacy';
import { ApiError } from '@/lib/api/client';

export default function PharmacyIntakePage() {
  const { user, activeMembership, isLoading: isAuthLoading } = useAuth();
  const siteId = activeMembership?.site_ids?.[0] ?? null;

  // Load open purchase orders that can receive goods (ordered or partially_received).
  const { data, isLoading, error, reload } = useApiResource(
    (signal) => listPurchaseOrders({ siteId: siteId ?? undefined, openOnly: true, limit: 100, signal }),
    [siteId],
  );

  const purchaseOrders = useMemo(() => data?.data ?? [], [data]);

  // Form state.
  const [poId, setPoId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [receivedQty, setReceivedQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [submitError, setSubmitError] = useState('');

  const selectedPo = purchaseOrders.find((po) => po.purchase_order_id === poId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poId || !variantId || !lotNumber || !expiresOn || !receivedQty) return;
    setSaving(true);
    setSuccess('');
    setSubmitError('');
    try {
      const result = await receiveGoods(
        poId,
        {
          variant_id: variantId,
          lot_number: lotNumber,
          expires_on: expiresOn,
          received_quantity: Number(receivedQty),
        },
        crypto.randomUUID(),
      );
      setSuccess(
        `Goods received. Batch ${shortId(result.batch_id)} created (receipt ${shortId(result.goods_receipt_id)}). PO is now ${humaniseCode(result.status)}.`,
      );
      // Reset form.
      setVariantId('');
      setLotNumber('');
      setExpiresOn('');
      setReceivedQty('');
      // Reload the PO list to reflect the updated status.
      reload();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected error' });
      setSubmitError(apiError.message || apiError.title);
    } finally {
      setSaving(false);
    }
  };

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
        <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Medicine intake' }]} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <span className="material-symbols-outlined text-slate-300 text-5xl">inventory_2</span>
            <h1 className="mt-3 text-lg font-bold text-slate-900">No site assigned</h1>
            <p className="mt-1 text-sm text-slate-500">
              Goods receipt is site-scoped. Your membership is not linked to a site.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Medicine intake' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[800px] mx-auto flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Medicine Intake
            </h1>
            <p className="text-slate-500 mt-1">
              Receive goods against an open purchase order. Creates an inventory batch with FEFO
              ordering.
            </p>
          </div>

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={purchaseOrders.length === 0}
            onRetry={reload}
            loadingLabel="Loading purchase orders…"
            forbiddenTitle="You cannot receive goods"
            errorTitle="Could not load purchase orders"
            emptyTitle="No open purchase orders"
            emptyBody="Goods can only be received against an existing ordered PO. Create one in Procurement first."
            emptyIcon="inventory_2"
          />

          {!isLoading && !error && purchaseOrders.length > 0 && (
            <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
              {/* Step 1: Select purchase order */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  Purchase order
                </label>
                <select
                  required
                  value={poId}
                  onChange={(e) => setPoId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal focus:border-[#1e3fae] focus:outline-none focus:ring-1 focus:ring-[#1e3fae]"
                >
                  <option value="">Select an open purchase order</option>
                  {purchaseOrders.map((po) => (
                    <option key={po.purchase_order_id} value={po.purchase_order_id}>
                      {shortId(po.purchase_order_id)} · {humaniseCode(po.status)} · {po.outstanding_quantity} outstanding · {formatInstant(po.created_at)}
                    </option>
                  ))}
                </select>
                {selectedPo && (
                  <div className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
                    <p>Lines: {selectedPo.line_count} · Ordered: {selectedPo.ordered_quantity} · Received: {selectedPo.received_quantity} · Outstanding: {selectedPo.outstanding_quantity}</p>
                  </div>
                )}
              </div>

              {/* Step 2: Receipt details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Variant ID
                  </label>
                  <input
                    type="text"
                    required
                    value={variantId}
                    onChange={(e) => setVariantId(e.target.value)}
                    placeholder="UuidV7 of the medication variant"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal focus:border-[#1e3fae] focus:outline-none focus:ring-1 focus:ring-[#1e3fae]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Lot number
                  </label>
                  <input
                    type="text"
                    required
                    value={lotNumber}
                    onChange={(e) => setLotNumber(e.target.value)}
                    placeholder="Manufacturer lot number"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal focus:border-[#1e3fae] focus:outline-none focus:ring-1 focus:ring-[#1e3fae]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Expiry date
                  </label>
                  <input
                    type="date"
                    required
                    value={expiresOn}
                    onChange={(e) => setExpiresOn(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal focus:border-[#1e3fae] focus:outline-none focus:ring-1 focus:ring-[#1e3fae]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Received quantity
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={receivedQty}
                    onChange={(e) => setReceivedQty(e.target.value)}
                    placeholder="Units received"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal focus:border-[#1e3fae] focus:outline-none focus:ring-1 focus:ring-[#1e3fae]"
                  />
                </div>
              </div>

              {submitError && (
                <p className="text-sm text-red-600" role="alert">
                  {submitError}
                </p>
              )}

              {success && (
                <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg p-3" role="status">
                  {success}
                </p>
              )}

              <button
                type="submit"
                disabled={saving || !poId || !variantId || !lotNumber || !expiresOn || !receivedQty}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-6 py-3 font-bold text-white disabled:opacity-50 hover:bg-[#1a3694] transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">check_circle</span>
                {saving ? 'Receiving goods…' : 'Confirm & receive'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
