'use client';

/**
 * Stock reconciliation, wired to GET /procurement/reconciliations.
 *
 * THIS PAGE SHOWS TWO VARIANCE FIGURES ON PURPOSE, and that is the whole point of it.
 *
 * `variance` is the SIGNED sum of counted minus expected. `discrepancy` is the sum of the
 * absolute differences. A count that is +50 on one batch and -50 on another has a signed
 * variance of ZERO while being two separate counting errors, so a page showing only the net
 * would report that count as clean. The absolute figure is what makes it visible, and rows
 * where the two disagree are flagged.
 *
 * Dual control is also surfaced: an approved or posted reconciliation always has an approver
 * distinct from the counter, enforced by database constraint rather than by review.
 *
 * Mutations: open a draft count, record a batch count (PUT, idempotent per batch), and
 * advance a count through submitted/approved/rejected/posted. Approval is a different
 * person from the counter by constraint, so the page offers approve only on submitted
 * counts and does not pretend the same actor can both count and approve.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  advanceReconciliation,
  createReconciliation,
  formatInstant,
  humaniseCode,
  listStockReconciliations,
  recordReconciliationCount,
  shortId,
  type StockReconciliationStatus,
} from '@/lib/api/pharmacy';
import { ApiError } from '@/lib/api/client';
import type { StockReconciliationSummary } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';

const TABS: ReadonlyArray<{ key: 'open' | 'all' | StockReconciliationStatus; label: string }> = [
  { key: 'open', label: 'Outstanding' },
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'approved', label: 'Approved' },
  { key: 'posted', label: 'Posted' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-50 text-slate-700 border-slate-100',
  submitted: 'bg-blue-50 text-blue-700 border-blue-100',
  approved: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  posted: 'bg-green-50 text-green-700 border-green-100',
  rejected: 'bg-red-50 text-red-700 border-red-100',
};

/**
 * The transitions the page offers. A draft can be submitted; a submitted count can be
 * approved (by a second person) or rejected; an approved count can be posted; a posted or
 * rejected count is terminal. Reject is offered alongside approve because a reviewer who
 * finds the count wrong should be able to send it back, not only bless it.
 */
const NEXT_ACTIONS: Partial<Record<StockReconciliationStatus, ReadonlyArray<{ status: 'submitted' | 'approved' | 'rejected' | 'posted'; label: string; tone: 'primary' | 'danger' | 'success' }>>> = {
  draft: [
    { status: 'submitted', label: 'Submit', tone: 'primary' },
  ],
  submitted: [
    { status: 'approved', label: 'Approve', tone: 'success' },
    { status: 'rejected', label: 'Reject', tone: 'danger' },
  ],
  approved: [
    { status: 'posted', label: 'Post', tone: 'primary' },
  ],
};

export default function ReconciliationPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [tab, setTab] = useState<'open' | 'all' | StockReconciliationStatus>('open');

  const { data, isLoading, error, reload } = useApiResource(
    (signal) =>
      listStockReconciliations({
        status: tab === 'open' || tab === 'all' ? undefined : tab,
        openOnly: tab === 'open',
        limit: 100,
        signal,
      }),
    [tab],
  );

  const counts = useMemo(() => data?.data ?? [], [data]);

  const totalDiscrepancy = useMemo(
    () => counts.reduce((sum, entry) => sum + entry.absolute_variance_quantity, 0),
    [counts],
  );
  /** Counts whose net looks clean while their absolute discrepancy is not. */
  const nettingOut = useMemo(
    () =>
      counts.filter(
        (entry) => entry.variance_quantity === 0 && entry.absolute_variance_quantity > 0,
      ).length,
    [counts],
  );
  const awaitingApproval = useMemo(
    () => counts.filter((entry) => entry.status === 'submitted').length,
    [counts],
  );

  // --- Mutation state ------------------------------------------------------
  const [openBusy, setOpenBusy] = useState(false);
  const [openError, setOpenError] = useState<ApiError | null>(null);

  const [recordFor, setRecordFor] = useState<StockReconciliationSummary | null>(null);
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordError, setRecordError] = useState<ApiError | null>(null);

  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<Record<string, ApiError>>({});

  async function handleOpen() {
    if (openBusy) return;
    setOpenBusy(true);
    setOpenError(null);
    try {
      await createReconciliation(crypto.randomUUID());
      reload();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      setOpenError(apiError);
      if (apiError?.isConflict) reload();
    } finally {
      setOpenBusy(false);
    }
  }

  async function handleRecord(entry: StockReconciliationSummary, body: { batch_id: string; counted_quantity: number }) {
    if (recordBusy) return;
    setRecordBusy(true);
    setRecordError(null);
    try {
      await recordReconciliationCount(entry.reconciliation_id, body, crypto.randomUUID());
      setRecordFor(null);
      reload();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      setRecordError(apiError);
      if (apiError?.isConflict) reload();
    } finally {
      setRecordBusy(false);
    }
  }

  async function handleAdvance(entry: StockReconciliationSummary, nextStatus: 'submitted' | 'approved' | 'rejected' | 'posted') {
    if (advancingId === entry.reconciliation_id) return;
    setAdvancingId(entry.reconciliation_id);
    setAdvanceError((prev) => {
      const next = { ...prev };
      delete next[entry.reconciliation_id];
      return next;
    });
    try {
      await advanceReconciliation(entry.reconciliation_id, {
        status: nextStatus,
        expected_version: entry.version,
      });
      reload();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      if (apiError) {
        setAdvanceError((prev) => ({ ...prev, [entry.reconciliation_id]: apiError }));
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
      <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Reconciliation' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Stock Reconciliation</h1>
              <p className="text-slate-500 mt-1">
                A net variance of zero does not mean the count was clean. Both figures are shown.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setOpenError(null); handleOpen(); }}
              disabled={openBusy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold border border-[#1e3fae] bg-[#1e3fae] text-white hover:bg-[#173080] transition-colors shadow-sm disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">add</span>
              {openBusy ? 'Opening…' : 'Open stock count'}
            </button>
          </div>

          {openError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {openError.isForbidden
                  ? 'You cannot open a stock count for this site'
                  : openError.isConflict
                    ? 'Conflict — a count may already be open'
                    : openError.title}
              </p>
              <p className="text-xs text-red-600 mt-1">{openError.message}</p>
              {openError.correlationId && (
                <p className="text-xs text-red-400 mt-1">
                  Reference: <code>{openError.correlationId}</code>
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'fact_check', tint: 'text-blue-600', label: 'Counts', value: String(counts.length), note: 'In view' },
              { icon: 'difference', tint: 'text-amber-600', label: 'Discrepancy', value: String(totalDiscrepancy), note: 'Absolute units across counts' },
              { icon: 'how_to_reg', tint: 'text-indigo-600', label: 'Awaiting approval', value: String(awaitingApproval), note: 'Submitted, needs a second person' },
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

          {nettingOut > 0 && (
            // The case the absolute figure exists for. Worth stating plainly rather than
            // leaving a reader to compare two columns and notice.
            <div
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
              role="status"
            >
              <span className="font-bold">
                {nettingOut} count{nettingOut === 1 ? '' : 's'} net to zero but contain real
                discrepancies.
              </span>{' '}
              Overages and shortages have cancelled out; the absolute discrepancy column shows the
              true size.
            </div>
          )}

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
            isEmpty={counts.length === 0}
            onRetry={reload}
            loadingLabel="Loading reconciliations…"
            forbiddenTitle="You cannot view reconciliations for this site"
            errorTitle="Could not load reconciliations"
            emptyTitle="No reconciliations for this filter"
            emptyBody="Counts appear once a stock take has been started for this site."
            emptyIcon="fact_check"
          />

          {!isLoading && !error && counts.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Stock reconciliations, outstanding work first</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Count</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3">Dual control</th>
                    <th scope="col" className="px-5 py-3">Lines</th>
                    <th scope="col" className="px-5 py-3 text-right">Net variance</th>
                    <th scope="col" className="px-5 py-3 text-right">Discrepancy</th>
                    <th scope="col" className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {counts.map((entry) => {
                    const hidden =
                      entry.variance_quantity === 0 && entry.absolute_variance_quantity > 0;
                    // The contract summary status includes UnknownEnumValue; the action map is
                    // keyed by the known statuses only, so narrow here. An unknown status maps
                    // to no actions, which is the correct outcome.
                    const actions = NEXT_ACTIONS[entry.status as StockReconciliationStatus] ?? [];
                    const rowError = advanceError[entry.reconciliation_id];
                    const isThisAdvancing = advancingId === entry.reconciliation_id;
                    return (
                      <tr key={entry.reconciliation_id} className={hidden ? 'bg-amber-50/30' : ''}>
                        <td className="px-5 py-3">
                          <code className="text-xs text-slate-700">
                            {shortId(entry.reconciliation_id)}
                          </code>
                          <span className="block text-xs text-slate-400">
                            {formatInstant(entry.created_at)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                              STATUS_STYLE[entry.status] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                            }`}
                          >
                            {humaniseCode(entry.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-600">
                          <span className="block">counted {shortId(entry.counted_by_profile_id)}</span>
                          <span className="block">
                            {entry.approved_by_profile_id
                              ? `approved ${shortId(entry.approved_by_profile_id)}`
                              : 'not yet approved'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{entry.line_count}</td>
                        <td className="px-5 py-3 text-right">
                          <span
                            className={
                              entry.variance_quantity === 0
                                ? 'text-slate-400'
                                : entry.variance_quantity < 0
                                  ? 'font-bold text-red-700'
                                  : 'font-bold text-blue-700'
                            }
                          >
                            {entry.variance_quantity > 0 ? '+' : ''}
                            {entry.variance_quantity}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span
                            className={
                              entry.absolute_variance_quantity > 0
                                ? 'font-bold text-amber-700'
                                : 'text-slate-400'
                            }
                          >
                            {entry.absolute_variance_quantity}
                          </span>
                          {hidden && (
                            <span className="block text-xs text-amber-700">net hides this</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {entry.status === 'draft' && (
                              <button
                                type="button"
                                onClick={() => { setRecordError(null); setRecordFor(entry); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                              >
                                Record count
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
                                    ? 'You cannot advance this count.'
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

          {!isLoading && !error && counts.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{counts.length}</span> count
              {counts.length === 1 ? '' : 's'}
              {counts.length === 100 && ' (server limit reached; narrow by status)'}
            </p>
          )}
        </div>
      </div>

      {recordFor && (
        <RecordCountModal
          entry={recordFor}
          isSaving={recordBusy}
          error={recordError}
          onClose={() => { setRecordFor(null); setRecordError(null); }}
          onSubmit={handleRecord}
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Record count modal                                                          */
/* -------------------------------------------------------------------------- */

interface RecordCountModalProps {
  readonly entry: StockReconciliationSummary;
  readonly isSaving: boolean;
  readonly error: ApiError | null;
  readonly onClose: () => void;
  readonly onSubmit: (entry: StockReconciliationSummary, body: { batch_id: string; counted_quantity: number }) => void;
}

function RecordCountModal({ entry, isSaving, error, onClose, onSubmit }: RecordCountModalProps) {
  const [batchId, setBatchId] = useState('');
  const [countedQuantity, setCountedQuantity] = useState('');

  const quantityNum = Number(countedQuantity);
  const canSubmit =
    batchId.trim() !== '' &&
    countedQuantity.trim() !== '' &&
    Number.isFinite(quantityNum) &&
    quantityNum >= 0 &&
    !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(entry, {
      batch_id: batchId.trim(),
      counted_quantity: quantityNum,
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
            Record count · <code className="text-sm text-slate-600">{shortId(entry.reconciliation_id)}</code>
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
            Records the physical count for one batch in this draft. The endpoint is idempotent per
            batch, so re-recording the same batch replaces the prior count.
          </p>
          <form id="record-count-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                Counted quantity <span className="text-red-500">*</span>
              </span>
              <input
                type="number"
                min={0}
                value={countedQuantity}
                onChange={(e) => setCountedQuantity(e.target.value)}
                placeholder="e.g. 48"
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                required
              />
            </label>
          </form>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isForbidden
                  ? 'You cannot record counts for this reconciliation'
                  : error.isConflict
                    ? 'Conflict — the count may no longer be a draft'
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
              form="record-count-form"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
            >
              {isSaving ? 'Recording…' : 'Record count'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
