'use client';

/**
 * Procurement, wired to GET /procurement/purchase-orders.
 *
 * THE COLUMN THAT MATTERS IS `outstanding`. A status of `partially_received` says an order
 * is incomplete without saying by how much, so the server derives outstanding quantity from
 * the receipts and this page shows it. Ordering by outstanding work first is also the
 * server's decision, and this page must not re-sort by date — that would bury the orders
 * still waiting on a supplier beneath newer ones that are already fulfilled.
 *
 * Mutations: create a draft PO (supplier only — lines land separately), add a line to a
 * draft PO, and advance a PO through submitted/approved/ordered/cancelled. Each state
 * transition sends the version the last read returned, so a 409 means the row moved under
 * the user and the list is re-read rather than blindly retried.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  addPurchaseOrderItem,
  advancePurchaseOrder,
  createPurchaseOrder,
  formatInstant,
  formatSen,
  humaniseCode,
  listPurchaseOrders,
  shortId,
  type PurchaseOrderStatus,
} from '@/lib/api/pharmacy';
import { ApiError } from '@/lib/api/client';
import type { PurchaseOrderSummary } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';

const TABS: ReadonlyArray<{ key: 'open' | 'all' | PurchaseOrderStatus; label: string }> = [
  { key: 'open', label: 'Outstanding' },
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'approved', label: 'Approved' },
  { key: 'ordered', label: 'Ordered' },
  { key: 'partially_received', label: 'Partially received' },
  { key: 'received', label: 'Received' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-50 text-slate-700 border-slate-100',
  submitted: 'bg-blue-50 text-blue-700 border-blue-100',
  approved: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  ordered: 'bg-purple-50 text-purple-700 border-purple-100',
  partially_received: 'bg-amber-50 text-amber-700 border-amber-100',
  received: 'bg-green-50 text-green-700 border-green-100',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

/**
 * The state machine the backend enforces, pruned to the transitions this page offers.
 * A draft may be submitted or cancelled; a submitted order may be approved or cancelled;
 * an approved order may be placed (ordered) or cancelled. `partially_received` and
 * `received` are terminal here — receipts land through a different surface.
 */
const NEXT_ACTIONS: Partial<Record<PurchaseOrderStatus, ReadonlyArray<{ status: 'submitted' | 'approved' | 'ordered' | 'cancelled'; label: string; tone: 'primary' | 'danger' }>>> = {
  draft: [
    { status: 'submitted', label: 'Submit', tone: 'primary' },
    { status: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  submitted: [
    { status: 'approved', label: 'Approve', tone: 'primary' },
    { status: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  approved: [
    { status: 'ordered', label: 'Place order', tone: 'primary' },
    { status: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
};

export default function ProcurementPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [tab, setTab] = useState<'open' | 'all' | PurchaseOrderStatus>('open');

  const { data, isLoading, error, reload } = useApiResource(
    (signal) =>
      listPurchaseOrders({
        status: tab === 'open' || tab === 'all' ? undefined : tab,
        openOnly: tab === 'open',
        limit: 100,
        signal,
      }),
    [tab],
  );

  const orders = useMemo(() => data?.data ?? [], [data]);
  const currency = data?.currency ?? 'MYR';

  const outstandingUnits = useMemo(
    () => orders.reduce((sum, order) => sum + order.outstanding_quantity, 0),
    [orders],
  );
  const committed = useMemo(
    () => orders.reduce((sum, order) => sum + order.ordered_total_sen, 0),
    [orders],
  );

  // --- Modal state ---------------------------------------------------------
  // One create-PO modal at a time, one add-line modal at a time, and a per-row
  // busy flag for the advance actions so a second click cannot race the first.
  const [showCreate, setShowCreate] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<ApiError | null>(null);

  const [addLineTo, setAddLineTo] = useState<PurchaseOrderSummary | null>(null);
  const [addLineBusy, setAddLineBusy] = useState(false);
  const [addLineError, setAddLineError] = useState<ApiError | null>(null);

  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<Record<string, ApiError>>({});

  async function handleCreate(supplierId: string) {
    if (createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createPurchaseOrder({ supplier_id: supplierId }, crypto.randomUUID());
      setShowCreate(false);
      reload();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      setCreateError(apiError);
      if (apiError?.isConflict) reload();
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleAddLine(order: PurchaseOrderSummary, body: { variant_id: string; ordered_quantity: number; unit_cost_sen: number }) {
    if (addLineBusy) return;
    setAddLineBusy(true);
    setAddLineError(null);
    try {
      await addPurchaseOrderItem(order.purchase_order_id, body, crypto.randomUUID());
      setAddLineTo(null);
      reload();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      setAddLineError(apiError);
      if (apiError?.isConflict) reload();
    } finally {
      setAddLineBusy(false);
    }
  }

  async function handleAdvance(order: PurchaseOrderSummary, nextStatus: 'submitted' | 'approved' | 'ordered' | 'cancelled') {
    if (advancingId === order.purchase_order_id) return;
    setAdvancingId(order.purchase_order_id);
    setAdvanceError((prev) => {
      const next = { ...prev };
      delete next[order.purchase_order_id];
      return next;
    });
    try {
      await advancePurchaseOrder(order.purchase_order_id, {
        status: nextStatus,
        expected_version: order.version,
      });
      reload();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      if (apiError) {
        setAdvanceError((prev) => ({ ...prev, [order.purchase_order_id]: apiError }));
        if (apiError.isConflict) reload();
      }
    } finally {
      setAdvancingId(null);
    }
  }

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Procurement' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Procurement</h1>
              <p className="text-slate-500 mt-1">
                Outstanding work first. Received quantities come from the goods receipts, not the status.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setCreateError(null); setShowCreate(true); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold border border-[#1e3fae] bg-[#1e3fae] text-white hover:bg-[#173080] transition-colors shadow-sm"
            >
              <span className="material-symbols-outlined text-base">add</span>
              Create purchase order
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'inventory_2', tint: 'text-blue-600', label: 'Orders', value: String(orders.length), note: 'In view' },
              { icon: 'pending', tint: 'text-amber-600', label: 'Outstanding units', value: String(outstandingUnits), note: 'Ordered but not received' },
              { icon: 'payments', tint: 'text-slate-600', label: 'Committed', value: formatSen(committed, currency), note: 'Ordered value in view' },
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
            loadingLabel="Loading purchase orders…"
            forbiddenTitle="You cannot view procurement for this site"
            errorTitle="Could not load purchase orders"
            emptyTitle="No purchase orders for this filter"
            emptyBody="Orders appear once a purchase has been raised for this site."
            emptyIcon="inventory_2"
          />

          {!isLoading && !error && orders.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Purchase orders, outstanding work first</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Order</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3">Lines</th>
                    <th scope="col" className="px-5 py-3">Received</th>
                    <th scope="col" className="px-5 py-3">Outstanding</th>
                    <th scope="col" className="px-5 py-3 text-right">Ordered value</th>
                    <th scope="col" className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((order) => {
                    // The contract summary status includes UnknownEnumValue; the action map is
                    // keyed by the known statuses only, so narrow here. An unknown status maps
                    // to no actions, which is the correct outcome.
                    const actions = NEXT_ACTIONS[order.status as PurchaseOrderStatus] ?? [];
                    const rowError = advanceError[order.purchase_order_id];
                    const isThisAdvancing = advancingId === order.purchase_order_id;
                    return (
                      <tr
                        key={order.purchase_order_id}
                        className={order.outstanding_quantity > 0 ? 'bg-amber-50/30' : ''}
                      >
                        <td className="px-5 py-3">
                          <code className="text-xs text-slate-700">{shortId(order.purchase_order_id)}</code>
                          <span className="block text-xs text-slate-400">
                            supplier {shortId(order.supplier_id)} · {formatInstant(order.created_at)}
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
                        <td className="px-5 py-3 text-slate-600">{order.line_count}</td>
                        <td className="px-5 py-3 text-slate-600">
                          {order.received_quantity} / {order.ordered_quantity}
                        </td>
                        <td className="px-5 py-3">
                          {order.outstanding_quantity > 0 ? (
                            <span className="font-bold text-amber-700">{order.outstanding_quantity}</span>
                          ) : (
                            <span className="text-slate-400">none</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-slate-900">
                          {formatSen(order.ordered_total_sen, currency)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {order.status === 'draft' && (
                              <button
                                type="button"
                                onClick={() => { setAddLineError(null); setAddLineTo(order); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                              >
                                Add line
                              </button>
                            )}
                            {actions.map((action) => (
                              <button
                                key={action.status}
                                type="button"
                                disabled={isThisAdvancing}
                                onClick={() => handleAdvance(order, action.status)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${
                                  action.tone === 'danger'
                                    ? 'border border-red-200 text-red-700 hover:bg-red-50'
                                    : 'border border-[#1e3fae] bg-[#1e3fae] text-white hover:bg-[#173080]'
                                }`}
                              >
                                {isThisAdvancing ? '…' : action.label}
                              </button>
                            ))}
                          </div>
                          {rowError && (
                            <div className="mt-1.5 text-right" role="alert">
                              <p className="text-xs text-red-600">
                                {rowError.isConflict
                                  ? 'Changed by another editor — reloaded.'
                                  : rowError.isForbidden
                                    ? 'You cannot advance this order.'
                                    : rowError.needsStepUp
                                      ? 'Step-up required.'
                                      : rowError.title}
                              </p>
                            </div>
                          )}
                        </td>
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
              {orders.length === 100 && ' (server limit reached; narrow by status)'}
            </p>
          )}
        </div>
      </div>

      {showCreate && (
        <CreatePurchaseOrderModal
          isSaving={createBusy}
          error={createError}
          onClose={() => { setShowCreate(false); setCreateError(null); }}
          onSubmit={handleCreate}
        />
      )}

      {addLineTo && (
        <AddLineModal
          order={addLineTo}
          isSaving={addLineBusy}
          error={addLineError}
          onClose={() => { setAddLineTo(null); setAddLineError(null); }}
          onSubmit={handleAddLine}
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Create Purchase Order modal                                                 */
/* -------------------------------------------------------------------------- */

interface CreatePurchaseOrderModalProps {
  readonly isSaving: boolean;
  readonly error: ApiError | null;
  readonly onClose: () => void;
  readonly onSubmit: (supplierId: string) => void;
}

function CreatePurchaseOrderModal({ isSaving, error, onClose, onSubmit }: CreatePurchaseOrderModalProps) {
  const [supplierId, setSupplierId] = useState('');
  const canSubmit = supplierId.trim() !== '' && !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(supplierId.trim());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Create purchase order</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">
          <p className="text-sm text-slate-500">
            Opens a draft purchase order for a supplier. Lines are added separately once the
            draft exists.
          </p>
          <form id="create-po-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">
                Supplier ID <span className="text-red-500">*</span>
              </span>
              <input
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                placeholder="Paste a supplier UUID…"
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all font-mono"
                required
              />
            </label>
          </form>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isForbidden
                  ? 'You cannot create purchase orders'
                  : error.isConflict
                    ? 'Conflict — this order may already exist'
                    : error.title}
              </p>
              <p className="text-xs text-red-600 mt-1">{error.message}</p>
              {error.correlationId && (
                <p className="text-xs text-red-400 mt-1">
                  Reference: <code>{error.correlationId}</code>
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-po-form"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
            >
              {isSaving ? 'Creating…' : 'Create draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Add line modal                                                              */
/* -------------------------------------------------------------------------- */

interface AddLineModalProps {
  readonly order: PurchaseOrderSummary;
  readonly isSaving: boolean;
  readonly error: ApiError | null;
  readonly onClose: () => void;
  readonly onSubmit: (order: PurchaseOrderSummary, body: { variant_id: string; ordered_quantity: number; unit_cost_sen: number }) => void;
}

function AddLineModal({ order, isSaving, error, onClose, onSubmit }: AddLineModalProps) {
  const [variantId, setVariantId] = useState('');
  const [orderedQuantity, setOrderedQuantity] = useState('');
  const [unitCostSen, setUnitCostSen] = useState('');

  const quantityNum = Number(orderedQuantity);
  const costNum = Number(unitCostSen);
  const canSubmit =
    variantId.trim() !== '' &&
    orderedQuantity.trim() !== '' &&
    unitCostSen.trim() !== '' &&
    Number.isFinite(quantityNum) &&
    quantityNum > 0 &&
    Number.isFinite(costNum) &&
    costNum >= 0 &&
    !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(order, {
      variant_id: variantId.trim(),
      ordered_quantity: quantityNum,
      unit_cost_sen: costNum,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            Add line · <code className="text-sm text-slate-600">{shortId(order.purchase_order_id)}</code>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">
          <p className="text-sm text-slate-500">
            Adds one variant line to this draft. Cost is in integer sen (e.g. 500 = RM 5.00).
          </p>
          <form id="add-line-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">
                Variant ID <span className="text-red-500">*</span>
              </span>
              <input
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                placeholder="Paste a medication variant UUID…"
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all font-mono"
                required
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-bold text-slate-700">
                  Ordered quantity <span className="text-red-500">*</span>
                </span>
                <input
                  type="number"
                  min={1}
                  value={orderedQuantity}
                  onChange={(e) => setOrderedQuantity(e.target.value)}
                  placeholder="e.g. 100"
                  className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                  required
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-bold text-slate-700">
                  Unit cost (sen) <span className="text-red-500">*</span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={unitCostSen}
                  onChange={(e) => setUnitCostSen(e.target.value)}
                  placeholder="e.g. 500"
                  className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                  required
                />
              </label>
            </div>
            {quantityNum > 0 && costNum >= 0 && Number.isFinite(quantityNum) && Number.isFinite(costNum) && (
              <p className="text-xs text-slate-500">
                Line total: {formatSen(quantityNum * costNum)}
              </p>
            )}
          </form>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isForbidden
                  ? 'You cannot add lines to this order'
                  : error.isConflict
                    ? 'Conflict — the order may no longer be a draft'
                    : error.title}
              </p>
              <p className="text-xs text-red-600 mt-1">{error.message}</p>
              {error.correlationId && (
                <p className="text-xs text-red-400 mt-1">
                  Reference: <code>{error.correlationId}</code>
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-line-form"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
            >
              {isSaving ? 'Adding…' : 'Add line'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
