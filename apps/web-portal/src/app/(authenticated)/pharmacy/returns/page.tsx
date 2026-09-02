'use client';

/**
 * Stock returns, wired to GET /procurement/returns.
 *
 * THE COLUMN THAT MATTERS IS `posted`. A return's status can read `approved` or `received`
 * while only some of its lines have actually put stock back, because posting happens per
 * line against the append-only stock ledger. Showing status alone would let a half-posted
 * return look finished, so the posted-line count is shown next to it and flagged when the
 * two disagree.
 *
 * Mutations: open a return (optionally linked to a pharmacy order, with a reason), add a
 * batch line to an open return, and advance a return through approved/rejected/received/
 * completed/cancelled. Lines can only be added while the return is `requested`, and the
 * advance transitions follow the backend's state machine.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  addReturnItem,
  advanceReturn,
  createReturn,
  formatInstant,
  humaniseCode,
  listStockReturns,
  shortId,
  type StockReturnStatus,
} from '@/lib/api/pharmacy';
import { ApiError } from '@/lib/api/client';
import type { StockReturnSummary } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';

const TABS: ReadonlyArray<{ key: 'open' | 'all' | StockReturnStatus; label: string }> = [
  { key: 'open', label: 'Outstanding' },
  { key: 'all', label: 'All' },
  { key: 'requested', label: 'Requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'received', label: 'Received' },
  { key: 'completed', label: 'Completed' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLE: Record<string, string> = {
  requested: 'bg-blue-50 text-blue-700 border-blue-100',
  approved: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  received: 'bg-amber-50 text-amber-700 border-amber-100',
  completed: 'bg-green-50 text-green-700 border-green-100',
  rejected: 'bg-red-50 text-red-700 border-red-100',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

/**
 * The transitions the page offers. A requested return can be approved or rejected (or
 * cancelled); an approved return can be received or cancelled; a received return can be
 * completed. Completed/rejected/cancelled are terminal.
 */
const NEXT_ACTIONS: Partial<Record<StockReturnStatus, ReadonlyArray<{ status: 'approved' | 'rejected' | 'received' | 'completed' | 'cancelled'; label: string; tone: 'primary' | 'danger' | 'success' }>>> = {
  requested: [
    { status: 'approved', label: 'Approve', tone: 'success' },
    { status: 'rejected', label: 'Reject', tone: 'danger' },
    { status: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  approved: [
    { status: 'received', label: 'Receive', tone: 'primary' },
    { status: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  received: [
    { status: 'completed', label: 'Complete', tone: 'success' },
  ],
};

export default function ReturnsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [tab, setTab] = useState<'open' | 'all' | StockReturnStatus>('open');

  const { data, isLoading, error, reload } = useApiResource(
    (signal) =>
      listStockReturns({
        status: tab === 'open' || tab === 'all' ? undefined : tab,
        openOnly: tab === 'open',
        limit: 100,
        signal,
      }),
    [tab],
  );

  const returns = useMemo(() => data?.data ?? [], [data]);

  const unitsToReturn = useMemo(
    () => returns.reduce((sum, entry) => sum + entry.total_quantity, 0),
    [returns],
  );
  const partiallyPosted = useMemo(
    () =>
      returns.filter((entry) => entry.posted_line_count > 0 && entry.posted_line_count < entry.line_count)
        .length,
    [returns],
  );

  // --- Mutation state ------------------------------------------------------
  const [showCreate, setShowCreate] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<ApiError | null>(null);

  const [addBatchTo, setAddBatchTo] = useState<StockReturnSummary | null>(null);
  const [addBatchBusy, setAddBatchBusy] = useState(false);
  const [addBatchError, setAddBatchError] = useState<ApiError | null>(null);

  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<Record<string, ApiError>>({});

  async function handleCreate(body: { pharmacy_order_id?: string | null; reason_code: string }) {
    if (createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createReturn(body, crypto.randomUUID());
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

  async function handleAddBatch(entry: StockReturnSummary, body: { batch_id: string; quantity: number }) {
    if (addBatchBusy) return;
    setAddBatchBusy(true);
    setAddBatchError(null);
    try {
      await addReturnItem(entry.return_id, body, crypto.randomUUID());
      setAddBatchTo(null);
      reload();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      setAddBatchError(apiError);
      if (apiError?.isConflict) reload();
    } finally {
      setAddBatchBusy(false);
    }
  }

  async function handleAdvance(entry: StockReturnSummary, nextStatus: 'approved' | 'rejected' | 'received' | 'completed' | 'cancelled') {
    if (advancingId === entry.return_id) return;
    setAdvancingId(entry.return_id);
    setAdvanceError((prev) => {
      const next = { ...prev };
      delete next[entry.return_id];
      return next;
    });
    try {
      await advanceReturn(entry.return_id, {
        status: nextStatus,
        expected_version: entry.version,
      });
      reload();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      if (apiError) {
        setAdvanceError((prev) => ({ ...prev, [entry.return_id]: apiError }));
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
      <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Returns' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Stock Returns</h1>
              <p className="text-slate-500 mt-1">
                Stock is posted back per line against the ledger, so a status alone does not mean the
                stock has moved.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setCreateError(null); setShowCreate(true); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold border border-[#1e3fae] bg-[#1e3fae] text-white hover:bg-[#173080] transition-colors shadow-sm"
            >
              <span className="material-symbols-outlined text-base">add</span>
              Open return
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'assignment_return', tint: 'text-blue-600', label: 'Returns', value: String(returns.length), note: 'In view' },
              { icon: 'inventory', tint: 'text-slate-600', label: 'Units', value: String(unitsToReturn), note: 'Across all lines' },
              { icon: 'warning', tint: 'text-amber-600', label: 'Part-posted', value: String(partiallyPosted), note: 'Some lines not yet posted' },
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
            isEmpty={returns.length === 0}
            onRetry={reload}
            loadingLabel="Loading returns…"
            forbiddenTitle="You cannot view returns for this site"
            errorTitle="Could not load returns"
            emptyTitle="No returns for this filter"
            emptyBody="Returns appear once damaged or recalled stock has been raised."
            emptyIcon="assignment_return"
          />

          {!isLoading && !error && returns.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Stock returns, outstanding work first</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Return</th>
                    <th scope="col" className="px-5 py-3">Reason</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3">Lines</th>
                    <th scope="col" className="px-5 py-3">Posted</th>
                    <th scope="col" className="px-5 py-3 text-right">Units</th>
                    <th scope="col" className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {returns.map((entry) => {
                    const partial =
                      entry.posted_line_count > 0 && entry.posted_line_count < entry.line_count;
                    // The contract summary status includes UnknownEnumValue; the action map is
                    // keyed by the known statuses only, so narrow here. An unknown status maps
                    // to no actions, which is the correct outcome.
                    const actions = NEXT_ACTIONS[entry.status as StockReturnStatus] ?? [];
                    const rowError = advanceError[entry.return_id];
                    const isThisAdvancing = advancingId === entry.return_id;
                    return (
                      <tr key={entry.return_id} className={partial ? 'bg-amber-50/30' : ''}>
                        <td className="px-5 py-3">
                          <code className="text-xs text-slate-700">{shortId(entry.return_id)}</code>
                          <span className="block text-xs text-slate-400">
                            {entry.pharmacy_order_id
                              ? `order ${shortId(entry.pharmacy_order_id)}`
                              : 'no linked order'}{' '}
                            · {formatInstant(entry.created_at)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{humaniseCode(entry.reason_code)}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                              STATUS_STYLE[entry.status] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                            }`}
                          >
                            {humaniseCode(entry.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{entry.line_count}</td>
                        <td className="px-5 py-3">
                          <span className={partial ? 'font-bold text-amber-700' : 'text-slate-600'}>
                            {entry.posted_line_count} / {entry.line_count}
                          </span>
                          {partial && (
                            <span className="block text-xs text-amber-700">stock partly returned</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-slate-900">
                          {entry.total_quantity}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {entry.status === 'requested' && (
                              <button
                                type="button"
                                onClick={() => { setAddBatchError(null); setAddBatchTo(entry); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                              >
                                Add batch
                              </button>
                            )}
                            {actions.map((action) => (
                              <button
                                key={action.status}
                                type="button"
                                disabled={isThisAdvancing}
                                onClick={() => handleAdvance(entry, action.status)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${
                                  action.tone === 'danger'
                                    ? 'border border-red-200 text-red-700 hover:bg-red-50'
                                    : action.tone === 'success'
                                      ? 'border border-green-200 text-green-700 hover:bg-green-50'
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
                                    ? 'You cannot advance this return.'
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

          {!isLoading && !error && returns.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{returns.length}</span> return
              {returns.length === 1 ? '' : 's'}
              {returns.length === 100 && ' (server limit reached; narrow by status)'}
            </p>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateReturnModal
          isSaving={createBusy}
          error={createError}
          onClose={() => { setShowCreate(false); setCreateError(null); }}
          onSubmit={handleCreate}
        />
      )}

      {addBatchTo && (
        <AddBatchModal
          entry={addBatchTo}
          isSaving={addBatchBusy}
          error={addBatchError}
          onClose={() => { setAddBatchTo(null); setAddBatchError(null); }}
          onSubmit={handleAddBatch}
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Create Return modal                                                         */
/* -------------------------------------------------------------------------- */

interface CreateReturnModalProps {
  readonly isSaving: boolean;
  readonly error: ApiError | null;
  readonly onClose: () => void;
  readonly onSubmit: (body: { pharmacy_order_id?: string | null; reason_code: string }) => void;
}

function CreateReturnModal({ isSaving, error, onClose, onSubmit }: CreateReturnModalProps) {
  const [pharmacyOrderId, setPharmacyOrderId] = useState('');
  const [reasonCode, setReasonCode] = useState('');

  const canSubmit = reasonCode.trim() !== '' && !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const trimmedOrder = pharmacyOrderId.trim();
    onSubmit({
      pharmacy_order_id: trimmedOrder === '' ? null : trimmedOrder,
      reason_code: reasonCode.trim(),
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
          <h2 className="text-lg font-bold text-slate-900">Open stock return</h2>
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
            Opens a return, optionally linked to a pharmacy order. Batch lines are added
            separately while the return is in the requested state.
          </p>
          <form id="create-return-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">Pharmacy order ID</span>
              <span className="text-xs text-slate-400">Optional — link this return to a dispensed order.</span>
              <input
                value={pharmacyOrderId}
                onChange={(e) => setPharmacyOrderId(e.target.value)}
                placeholder="Paste a pharmacy order UUID, or leave blank…"
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all font-mono"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">
                Reason code <span className="text-red-500">*</span>
              </span>
              <span className="text-xs text-slate-400">e.g. damaged, recalled, expired, wrong_item.</span>
              <input
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                placeholder="e.g. damaged"
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                required
              />
            </label>
          </form>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isForbidden
                  ? 'You cannot open stock returns for this site'
                  : error.isConflict
                    ? 'Conflict — this return may already exist'
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
              form="create-return-form"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
            >
              {isSaving ? 'Opening…' : 'Open return'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Add batch modal                                                             */
/* -------------------------------------------------------------------------- */

interface AddBatchModalProps {
  readonly entry: StockReturnSummary;
  readonly isSaving: boolean;
  readonly error: ApiError | null;
  readonly onClose: () => void;
  readonly onSubmit: (entry: StockReturnSummary, body: { batch_id: string; quantity: number }) => void;
}

function AddBatchModal({ entry, isSaving, error, onClose, onSubmit }: AddBatchModalProps) {
  const [batchId, setBatchId] = useState('');
  const [quantity, setQuantity] = useState('');

  const quantityNum = Number(quantity);
  const canSubmit =
    batchId.trim() !== '' &&
    quantity.trim() !== '' &&
    Number.isFinite(quantityNum) &&
    quantityNum > 0 &&
    !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(entry, {
      batch_id: batchId.trim(),
      quantity: quantityNum,
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
            Add batch · <code className="text-sm text-slate-600">{shortId(entry.return_id)}</code>
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
            Adds one batch line to this open return. Stock is posted back per line against the ledger
            once the return is received.
          </p>
          <form id="add-batch-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">
                Batch ID <span className="text-red-500">*</span>
              </span>
              <input
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                placeholder="Paste a batch UUID…"
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all font-mono"
                required
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">
                Quantity <span className="text-red-500">*</span>
              </span>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 24"
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                required
              />
            </label>
          </form>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isForbidden
                  ? 'You cannot add lines to this return'
                  : error.isConflict
                    ? 'Conflict — the return may no longer be open'
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
              form="add-batch-form"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
            >
              {isSaving ? 'Adding…' : 'Add batch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
