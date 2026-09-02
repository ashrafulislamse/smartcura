'use client';

/**
 * Payout runs, wired to GET /finance/payout-runs plus the payout mutations.
 *
 * WHY THIS PAGE MAY 403 WHILE /finance/transactions DOES NOT. A payout run names its
 * payees, so it requires `payout_run:manage:organization` rather than
 * `ledger:read:organization`. That split is deliberate — reading a run is payroll
 * access — so a forbidden response here is the authority model working, and the page
 * says so rather than showing an empty table.
 *
 * Totals are DERIVED by the server from the run's items. This page must not recompute them
 * from a separate source: a second calculation is a second answer, and the whole point of
 * having no stored total is that there is only one.
 *
 * MUTATIONS. The page wires createPayoutRun, addPayoutItem, advancePayoutRun (approve /
 * start / cancel) and settlePayoutItem. Every mutation sends `expected_version` from the
 * run as read and, on success, RE-READS via `reload()` rather than incrementing a held
 * version — a 409 conflict also triggers a re-read so the operator can retry against the
 * real current version. Creates send a fresh `crypto.randomUUID()` idempotency key.
 *
 * HONEST LIMITATION. There is no `GET /finance/payout-runs/{id}/items` endpoint, so the
 * run summary carries `item_count` / `paid_count` but not the individual payout item ids.
 * Settling one item therefore needs its `payout_item_id` pasted by the operator (the same
 * paste-a-UUID pattern the clinical-notes page uses for consultation ids). The modal says
 * so rather than inventing ids the API never sent.
 */

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import {
  addPayoutItem,
  advancePayoutRun,
  createPayoutRun,
  formatSen,
  humaniseCode,
  listPayoutRuns,
  settlePayoutItem,
  type PayoutRunStatus,
} from '@/lib/api/finance';
import { ApiError } from '@/lib/api/client';
import type {
  AddPayoutItemRequest,
  AdvancePayoutRunRequest,
  CreatePayoutRunRequest,
  SettlePayoutItemRequest,
} from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';

const TABS: ReadonlyArray<{ key: 'all' | PayoutRunStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'approved', label: 'Approved' },
  { key: 'processing', label: 'Processing' },
  { key: 'completed', label: 'Completed' },
  { key: 'partially_failed', label: 'Partially failed' },
  { key: 'failed', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-50 text-slate-700 border-slate-100',
  approved: 'bg-blue-50 text-blue-700 border-blue-100',
  processing: 'bg-amber-50 text-amber-700 border-amber-100',
  completed: 'bg-green-50 text-green-700 border-green-100',
  partially_failed: 'bg-orange-50 text-orange-700 border-orange-100',
  failed: 'bg-red-50 text-red-700 border-red-100',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

/**
 * Only one mutation surface is open at a time. A discriminated union makes it impossible
 * to render two modals at once or to forget which run an action targets. The `version`
 * captured on open is the optimistic-concurrency token sent as `expected_version`.
 */
type ModalState =
  | { kind: 'none' }
  | { kind: 'createRun' }
  | { kind: 'addPayee'; runId: string }
  | { kind: 'advance'; runId: string; version: number; target: 'approved' | 'processing' | 'cancelled' }
  | { kind: 'settle'; runId: string };

export default function PayoutsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [status, setStatus] = useState<'all' | PayoutRunStatus>('all');

  const { data, isLoading, error, reload } = useApiResource(
    (signal) => listPayoutRuns({ status: status === 'all' ? undefined : status, limit: 100, signal }),
    [status],
  );

  const runs = useMemo(() => data?.data ?? [], [data]);
  const currency = data?.currency ?? 'MYR';

  const totalNet = useMemo(() => runs.reduce((sum, run) => sum + run.net_sen, 0), [runs]);
  const awaitingApproval = useMemo(
    () => runs.filter((run) => run.status === 'draft').length,
    [runs],
  );
  const needsAttention = useMemo(
    () => runs.filter((run) => run.status === 'failed' || run.status === 'partially_failed').length,
    [runs],
  );

  // --- Mutation state --------------------------------------------------------
  // A single busy/error pair is sufficient because the discriminated `modal` guarantees
  // at most one action is in flight at a time.
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);

  const openModal = useCallback((next: ModalState) => {
    setActionError(null);
    setModal(next);
  }, []);

  const closeModal = useCallback(() => {
    setModal({ kind: 'none' });
    setActionError(null);
  }, []);

  async function runCreateRun(body: CreatePayoutRunRequest) {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await createPayoutRun(body, crypto.randomUUID());
      closeModal();
      reload();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected error' });
      setActionError(apiError);
      if (apiError.isConflict) reload();
    } finally {
      setActionBusy(false);
    }
  }

  async function runAddPayee(runId: string, body: AddPayoutItemRequest) {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await addPayoutItem(runId, body, crypto.randomUUID());
      closeModal();
      reload();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected error' });
      setActionError(apiError);
      if (apiError.isConflict) reload();
    } finally {
      setActionBusy(false);
    }
  }

  async function runAdvance(runId: string, body: AdvancePayoutRunRequest) {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await advancePayoutRun(runId, body);
      closeModal();
      reload();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected error' });
      setActionError(apiError);
      if (apiError.isConflict) reload();
    } finally {
      setActionBusy(false);
    }
  }

  async function runSettle(payoutItemId: string, body: SettlePayoutItemRequest) {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await settlePayoutItem(payoutItemId, body, crypto.randomUUID());
      closeModal();
      reload();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected error' });
      setActionError(apiError);
      if (apiError.isConflict) reload();
    } finally {
      setActionBusy(false);
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
      <TopBar breadcrumbs={[{ label: 'Finance' }, { label: 'Payouts' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Payout Runs</h1>
              <p className="text-slate-500 mt-1">
                Newest period first. Totals are derived from each run&rsquo;s items, never stored.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openModal({ kind: 'createRun' })}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold border border-[#1e3fae] bg-[#1e3fae] text-white hover:bg-[#173080] transition-colors shadow-sm shrink-0"
            >
              <span className="material-symbols-outlined text-base">add</span>
              New run
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'payments', tint: 'text-blue-600', label: 'Net in view', value: formatSen(totalNet, currency), note: 'Sum of loaded runs' },
              { icon: 'pending_actions', tint: 'text-amber-600', label: 'Draft', value: String(awaitingApproval), note: 'Not yet approved' },
              { icon: 'error', tint: 'text-red-600', label: 'Attention', value: String(needsAttention), note: 'Failed or partial' },
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
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatus(tab.key)}
                className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  status === tab.key
                    ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {isLoading && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3fae]"></div>
              <p className="text-sm text-slate-500">Loading payout runs…</p>
            </div>
          )}

          {!isLoading && error && (
            <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8" role="alert">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600">error</span>
                <div className="flex-1">
                  <h2 className="font-bold text-slate-900">
                    {error.isForbidden
                      ? 'You do not have payout access'
                      : 'Could not load payout runs'}
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    {error.isForbidden
                      ? 'Payout runs name their payees, so they need payroll authority rather than ledger read access.'
                      : error.message}
                  </p>
                  {error.correlationId && (
                    <p className="text-xs text-slate-400 mt-2">
                      Reference: <code>{error.correlationId}</code>
                    </p>
                  )}
                  {!error.isForbidden && (
                    <button
                      onClick={reload}
                      className="mt-4 px-4 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isLoading && !error && runs.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">payments</span>
              <h2 className="font-bold text-slate-900 mt-3">No payout runs for this filter</h2>
              <p className="text-sm text-slate-500 mt-1">
                Runs appear once a period has been prepared.
              </p>
            </div>
          )}

          {!isLoading && !error && runs.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Payout runs by period</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Period</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3">Payees</th>
                    <th scope="col" className="px-5 py-3">Paid</th>
                    <th scope="col" className="px-5 py-3 text-right">Gross</th>
                    <th scope="col" className="px-5 py-3 text-right">Net</th>
                    <th scope="col" className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {runs.map((run) => (
                    <tr key={run.payout_run_id}>
                      <td className="px-5 py-3">
                        <span className="font-bold text-slate-900">{run.period_start}</span>
                        {run.period_end !== run.period_start && (
                          <span className="text-slate-500"> → {run.period_end}</span>
                        )}
                        {run.approved_by_membership_id === null && run.status !== 'draft' && (
                          <span className="block text-xs text-slate-400">no approver recorded</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                            STATUS_STYLE[run.status] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                          }`}
                        >
                          {humaniseCode(run.status)}
                        </span>
                        {run.reason_code && (
                          <span className="block text-xs text-slate-500 mt-1">{run.reason_code}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{run.item_count}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {run.paid_count} / {run.item_count}
                        {run.item_count > 0 && run.paid_count < run.item_count && run.status === 'completed' && (
                          // A completed run with unpaid lines is a contradiction worth
                          // surfacing rather than smoothing over.
                          <span className="block text-xs font-bold text-red-700">
                            completed with unpaid lines
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        {formatSen(run.gross_sen, currency)}
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-slate-900">
                        {formatSen(run.net_sen, currency)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex flex-wrap gap-1.5 justify-end">
                          {run.status === 'draft' && (
                            <>
                              <ActionButton
                                tone="blue"
                                onClick={() => openModal({ kind: 'addPayee', runId: run.payout_run_id })}
                              >
                                Add payee
                              </ActionButton>
                              <ActionButton
                                tone="green"
                                onClick={() =>
                                  openModal({
                                    kind: 'advance',
                                    runId: run.payout_run_id,
                                    version: run.version,
                                    target: 'approved',
                                  })
                                }
                              >
                                Approve
                              </ActionButton>
                              <ActionButton
                                tone="slate"
                                onClick={() =>
                                  openModal({
                                    kind: 'advance',
                                    runId: run.payout_run_id,
                                    version: run.version,
                                    target: 'cancelled',
                                  })
                                }
                              >
                                Cancel
                              </ActionButton>
                            </>
                          )}
                          {run.status === 'approved' && (
                            <>
                              <ActionButton
                                tone="amber"
                                onClick={() =>
                                  openModal({
                                    kind: 'advance',
                                    runId: run.payout_run_id,
                                    version: run.version,
                                    target: 'processing',
                                  })
                                }
                              >
                                Start
                              </ActionButton>
                              <ActionButton
                                tone="slate"
                                onClick={() =>
                                  openModal({
                                    kind: 'advance',
                                    runId: run.payout_run_id,
                                    version: run.version,
                                    target: 'cancelled',
                                  })
                                }
                              >
                                Cancel
                              </ActionButton>
                            </>
                          )}
                          {run.status === 'processing' && (
                            <ActionButton
                              tone="indigo"
                              onClick={() => openModal({ kind: 'settle', runId: run.payout_run_id })}
                            >
                              Settle item
                            </ActionButton>
                          )}
                          {/* Terminal/failed runs have no operator action wired here. */}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && !error && runs.length > 0 && (
            <div className="py-4">
              <span className="text-sm text-slate-500">
                Showing <span className="font-bold text-slate-900">{runs.length}</span> run
                {runs.length === 1 ? '' : 's'}
                {runs.length === 100 && ' (server limit reached; narrow by status)'}
              </span>
            </div>
          )}
        </div>
      </div>

      {modal.kind === 'createRun' && (
        <CreateRunModal
          isSaving={actionBusy}
          error={actionError}
          onClose={closeModal}
          onSubmit={(body) => runCreateRun(body)}
        />
      )}

      {modal.kind === 'addPayee' && (
        <AddPayeeModal
          runId={modal.runId}
          isSaving={actionBusy}
          error={actionError}
          onClose={closeModal}
          onSubmit={(body) => runAddPayee(modal.runId, body)}
        />
      )}

      {modal.kind === 'advance' && (
        <AdvanceRunModal
          runId={modal.runId}
          target={modal.target}
          version={modal.version}
          isSaving={actionBusy}
          error={actionError}
          onClose={closeModal}
          onSubmit={(body) => runAdvance(modal.runId, body)}
        />
      )}

      {modal.kind === 'settle' && (
        <SettleItemModal
          runId={modal.runId}
          isSaving={actionBusy}
          error={actionError}
          onClose={closeModal}
          onSubmit={(payoutItemId, body) => runSettle(payoutItemId, body)}
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                 */
/* -------------------------------------------------------------------------- */

type ActionTone = 'blue' | 'green' | 'amber' | 'slate' | 'indigo';

const ACTION_TONE_CLASS: Record<ActionTone, string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  green: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  slate: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
};

function ActionButton({
  tone,
  onClick,
  children,
}: {
  tone: ActionTone;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${ACTION_TONE_CLASS[tone]}`}
    >
      {children}
    </button>
  );
}

/** Renders the shared mutation error inside a modal. */
function MutationError({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
      <p className="text-sm font-bold text-red-700">
        {error.isForbidden
          ? 'You do not have payout authority for this action'
          : error.isConflict
            ? 'Conflict — this run changed since you loaded it. Please retry.'
            : error.needsStepUp
              ? 'Step-up authentication is required for this action.'
              : error.title}
      </p>
      <p className="text-xs text-red-600 mt-1">{error.message}</p>
      {error.correlationId && (
        <p className="text-xs text-red-400 mt-1">
          Reference: <code>{error.correlationId}</code>
        </p>
      )}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Create run modal                                                            */
/* -------------------------------------------------------------------------- */

function CreateRunModal({
  isSaving,
  error,
  onClose,
  onSubmit,
}: {
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (body: CreatePayoutRunRequest) => void;
}) {
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  const canSubmit = periodStart !== '' && periodEnd !== '' && periodStart <= periodEnd && !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ period_start: periodStart, period_end: periodEnd });
  }

  return (
    <ModalShell title="New payout run" onClose={onClose}>
      <form id="create-run-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">
            Period start <span className="text-red-500">*</span>
          </span>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
            required
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">
            Period end <span className="text-red-500">*</span>
          </span>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            min={periodStart || undefined}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
            required
          />
        </label>
        <p className="text-xs text-slate-500">
          The run opens in <span className="font-bold">draft</span>. Payee lines are added one at a
          time after it is created. Idempotent on the period range.
        </p>
      </form>

      <MutationError error={error} />

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
          form="create-run-form"
          disabled={!canSubmit}
          className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
        >
          {isSaving ? 'Creating…' : 'Create run'}
        </button>
      </div>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Add payee modal                                                             */
/* -------------------------------------------------------------------------- */

function AddPayeeModal({
  runId,
  isSaving,
  error,
  onClose,
  onSubmit,
}: {
  runId: string;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (body: AddPayoutItemRequest) => void;
}) {
  const [payeeMembershipId, setPayeeMembershipId] = useState('');
  const [grossSen, setGrossSen] = useState('');
  const [platformFeeSen, setPlatformFeeSen] = useState('');

  const gross = Number.parseInt(grossSen, 10);
  const fee = Number.parseInt(platformFeeSen, 10);
  const amountsValid = Number.isFinite(gross) && gross >= 0 && Number.isFinite(fee) && fee >= 0;
  const canSubmit = payeeMembershipId.trim() !== '' && amountsValid && !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      payee_membership_id: payeeMembershipId.trim(),
      gross_sen: gross,
      platform_fee_sen: fee,
    });
  }

  return (
    <ModalShell title="Add payee line" onClose={onClose}>
      <form id="add-payee-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-bold text-slate-700">
            Payee membership id <span className="text-red-500">*</span>
          </label>
          <input
            value={payeeMembershipId}
            onChange={(e) => setPayeeMembershipId(e.target.value)}
            placeholder="Paste a membership UUID…"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all font-mono"
            required
          />
          <p className="text-xs text-slate-500">
            The payee and their accounts are resolved server-side from this membership id.
          </p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">
            Gross (sen) <span className="text-red-500">*</span>
          </span>
          <input
            type="number"
            min="0"
            step="1"
            value={grossSen}
            onChange={(e) => setGrossSen(e.target.value)}
            placeholder="Integer sen, e.g. 85000"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
            required
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">
            Platform fee (sen) <span className="text-red-500">*</span>
          </span>
          <input
            type="number"
            min="0"
            step="1"
            value={platformFeeSen}
            onChange={(e) => setPlatformFeeSen(e.target.value)}
            placeholder="Integer sen withheld, e.g. 4250"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
            required
          />
        </label>
        {amountsValid && gross - fee >= 0 && (
          <p className="text-xs text-slate-500">
            Net to payee: <span className="font-bold text-slate-700">{formatSen(gross - fee)}</span>
          </p>
        )}
        <p className="text-xs text-slate-500">
          Adding to run <code className="font-mono">{runId.slice(0, 8)}</code>. Refused once the run
          is approved.
        </p>
      </form>

      <MutationError error={error} />

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
          form="add-payee-form"
          disabled={!canSubmit}
          className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
        >
          {isSaving ? 'Adding…' : 'Add payee'}
        </button>
      </div>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Advance run modal (approve / start / cancel)                               */
/* -------------------------------------------------------------------------- */

const ADVANCE_LABEL: Record<'approved' | 'processing' | 'cancelled', string> = {
  approved: 'Approve run',
  processing: 'Start processing',
  cancelled: 'Cancel run',
};

const ADVANCE_VERB: Record<'approved' | 'processing' | 'cancelled', string> = {
  approved: 'approve',
  processing: 'start',
  cancelled: 'cancel',
};

function AdvanceRunModal({
  runId,
  target,
  version,
  isSaving,
  error,
  onClose,
  onSubmit,
}: {
  runId: string;
  target: 'approved' | 'processing' | 'cancelled';
  version: number;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (body: AdvancePayoutRunRequest) => void;
}) {
  // A reason code is only meaningful for a cancellation; approve/start do not take one.
  const [reasonCode, setReasonCode] = useState('');
  const canSubmit = !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      status: target,
      expected_version: version,
      reason_code: target === 'cancelled' && reasonCode.trim() !== '' ? reasonCode.trim() : null,
    });
  }

  return (
    <ModalShell title={ADVANCE_LABEL[target]} onClose={onClose}>
      <form id="advance-run-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          You are about to <span className="font-bold">{ADVANCE_VERB[target]}</span> run{' '}
          <code className="font-mono">{runId.slice(0, 8)}</code> at version{' '}
          <span className="font-bold">v{version}</span>. Separation of duties is enforced server-side:
          the preparer cannot approve their own batch.
        </p>
        {target === 'cancelled' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold text-slate-700">Reason code (optional)</span>
            <input
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              placeholder="e.g. payroll_correction"
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
            />
          </label>
        )}
      </form>

      <MutationError error={error} />

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
          form="advance-run-form"
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 ${
            target === 'cancelled'
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-[#1e3fae] hover:bg-[#173080]'
          }`}
        >
          {isSaving ? 'Working…' : ADVANCE_LABEL[target]}
        </button>
      </div>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Settle item modal                                                           */
/* -------------------------------------------------------------------------- */

function SettleItemModal({
  runId,
  isSaving,
  error,
  onClose,
  onSubmit,
}: {
  runId: string;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (payoutItemId: string, body: SettlePayoutItemRequest) => void;
}) {
  const [payoutItemId, setPayoutItemId] = useState('');
  const [payableAccountId, setPayableAccountId] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');

  const canSubmit =
    payoutItemId.trim() !== '' &&
    payableAccountId.trim() !== '' &&
    cashAccountId.trim() !== '' &&
    !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(
      payoutItemId.trim(),
      {
        payable_account_id: payableAccountId.trim(),
        cash_account_id: cashAccountId.trim(),
      },
    );
  }

  return (
    <ModalShell title="Settle payout item" onClose={onClose}>
      <form id="settle-item-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px]">info</span>
          <span>
            There is no list-items endpoint, so the run summary does not carry individual payout
            item ids. Paste the <span className="font-bold">payout_item_id</span> for the line you
            are settling. Settlement posts a balanced ledger entry and marks the item paid.
          </span>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">
            Payout item id <span className="text-red-500">*</span>
          </span>
          <input
            value={payoutItemId}
            onChange={(e) => setPayoutItemId(e.target.value)}
            placeholder="Paste the payout item UUID…"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all font-mono"
            required
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">
            Payable account id <span className="text-red-500">*</span>
          </span>
          <input
            value={payableAccountId}
            onChange={(e) => setPayableAccountId(e.target.value)}
            placeholder="Ledger account UUID to debit the payable…"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all font-mono"
            required
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">
            Cash account id <span className="text-red-500">*</span>
          </span>
          <input
            value={cashAccountId}
            onChange={(e) => setCashAccountId(e.target.value)}
            placeholder="Ledger account UUID to credit cash…"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all font-mono"
            required
          />
        </label>
        <p className="text-xs text-slate-500">
          Settling an item on run <code className="font-mono">{runId.slice(0, 8)}</code>.
        </p>
      </form>

      <MutationError error={error} />

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
          form="settle-item-form"
          disabled={!canSubmit}
          className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
        >
          {isSaving ? 'Settling…' : 'Settle item'}
        </button>
      </div>
    </ModalShell>
  );
}
