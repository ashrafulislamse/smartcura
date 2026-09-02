'use client';

/**
 * Ledger transactions, wired to GET /finance/ledger/entries and the reversal mutation.
 *
 * RECONCILIATION WITH THE MOCK. `mockTransactions` carried a patient name, a doctor name,
 * a payment method and a status. The ledger has NONE of those: an entry records a KIND, a
 * reference to the aggregate that caused it, a memo code and its postings. Names would
 * need a lookup no endpoint offers, and payment method is not something the ledger models.
 * They are removed rather than filled with plausible-looking values.
 *
 * `amount_sen` is the entry's MAGNITUDE. The postings are signed and sum to zero, so a
 * page that displayed the signed sum would show 0.00 for every transaction.
 *
 * REVERSAL. A posted entry is never deleted; a mistake is corrected by posting a reversing
 * entry (`kind: 'reversal'`, opposite-sign postings, linked via `reverses_entry_id`). The
 * page exposes a "Reverse" action per row that opens a confirmation modal taking a
 * `memo_code`. Creates send a fresh `crypto.randomUUID()` idempotency key and, on success,
 * the page RE-READS via `reload()` rather than mutating held state. A row that is itself a
 * reversal is shown as already corrected and its reverse button is disabled, because
 * reversing a reversal is not a correction this UI should offer one click away.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import {
  formatSen,
  humaniseCode,
  listLedgerEntries,
  reverseLedgerEntry,
  type LedgerEntryKind,
} from '@/lib/api/finance';
import { ApiError } from '@/lib/api/client';
import type { ReverseLedgerEntryRequest } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';

const KINDS: ReadonlyArray<{ key: 'all' | LedgerEntryKind; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'appointment_payment', label: 'Appointment payment' },
  { key: 'appointment_refund', label: 'Appointment refund' },
  { key: 'delivery_fee', label: 'Delivery fee' },
  { key: 'doctor_payout', label: 'Doctor payout' },
  { key: 'driver_withdrawal', label: 'Driver withdrawal' },
  { key: 'platform_fee', label: 'Platform fee' },
  { key: 'adjustment', label: 'Adjustment' },
  { key: 'reversal', label: 'Reversal' },
];

const KIND_STYLE: Record<string, string> = {
  appointment_payment: 'bg-green-50 text-green-700 border-green-100',
  appointment_refund: 'bg-orange-50 text-orange-700 border-orange-100',
  delivery_fee: 'bg-blue-50 text-blue-700 border-blue-100',
  doctor_payout: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  driver_withdrawal: 'bg-purple-50 text-purple-700 border-purple-100',
  platform_fee: 'bg-slate-50 text-slate-700 border-slate-100',
  adjustment: 'bg-amber-50 text-amber-700 border-amber-100',
  reversal: 'bg-red-50 text-red-700 border-red-100',
};

export default function TransactionsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [kind, setKind] = useState<'all' | LedgerEntryKind>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, error, reload } = useApiResource(
    (signal) => listLedgerEntries({ kind: kind === 'all' ? undefined : kind, limit: 200, signal }),
    [kind],
  );

  const entries = useMemo(() => data?.data ?? [], [data]);
  const currency = data?.currency ?? 'MYR';

  const filtered = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (needle === '') return entries;
    return entries.filter(
      (entry) =>
        entry.memo_code.toLowerCase().includes(needle) ||
        entry.reference_type.toLowerCase().includes(needle) ||
        entry.reference_id.toLowerCase().includes(needle) ||
        entry.ledger_entry_id.toLowerCase().includes(needle),
    );
  }, [entries, searchQuery]);

  const totalShown = useMemo(
    () => filtered.reduce((sum, entry) => sum + entry.amount_sen, 0),
    [filtered],
  );
  const reversals = useMemo(
    () => entries.filter((entry) => entry.reverses_entry_id !== null).length,
    [entries],
  );
  const unbalanced = useMemo(() => entries.filter((entry) => !entry.balanced).length, [entries]);

  // --- Reversal mutation state ----------------------------------------------
  const [reverseTargetId, setReverseTargetId] = useState<string | null>(null);
  const [reverseBusy, setReverseBusy] = useState(false);
  const [reverseError, setReverseError] = useState<ApiError | null>(null);

  async function runReverse(entryId: string, body: ReverseLedgerEntryRequest) {
    if (reverseBusy) return;
    setReverseBusy(true);
    setReverseError(null);
    try {
      await reverseLedgerEntry(entryId, body, crypto.randomUUID());
      setReverseTargetId(null);
      reload();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected error' });
      setReverseError(apiError);
      if (apiError.isConflict) reload();
    } finally {
      setReverseBusy(false);
    }
  }

  function openReverse(entryId: string) {
    setReverseError(null);
    setReverseTargetId(entryId);
  }

  function closeReverse() {
    setReverseTargetId(null);
    setReverseError(null);
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
      <TopBar breadcrumbs={[{ label: 'Finance' }, { label: 'Transactions' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Transactions</h1>
            <p className="text-slate-500 mt-1">
              Posted ledger entries, newest first. Every entry balances to zero across its postings;
              the amount shown is the entry magnitude.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'receipt_long', tint: 'text-blue-600', label: 'Loaded', value: String(entries.length), note: 'Entries in view' },
              { icon: 'functions', tint: 'text-slate-600', label: 'Sum shown', value: formatSen(totalShown, currency), note: 'Magnitudes of filtered rows' },
              { icon: 'undo', tint: 'text-amber-600', label: 'Reversals', value: String(reversals), note: 'Corrections, not deletions' },
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

          {unbalanced > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 font-bold" role="alert">
              {unbalanced} entr{unbalanced === 1 ? 'y' : 'ies'} report as unbalanced. A database
              constraint makes that impossible, so treat these figures as unreliable and report it.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {KINDS.map((option) => (
              <button
                key={option.key}
                onClick={() => setKind(option.key)}
                className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  kind === option.key
                    ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="relative w-full group">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#1e3fae] transition-colors">
              <span className="material-symbols-outlined">search</span>
            </span>
            <input
              className="w-full bg-white text-sm text-slate-900 rounded-lg border border-slate-200 pl-10 pr-4 py-3 placeholder-slate-400 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all shadow-sm"
              placeholder="Search loaded entries by memo, reference or id..."
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>

          {isLoading && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3fae]"></div>
              <p className="text-sm text-slate-500">Loading entries…</p>
            </div>
          )}

          {!isLoading && error && (
            <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8" role="alert">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600">error</span>
                <div className="flex-1">
                  <h2 className="font-bold text-slate-900">
                    {error.isForbidden ? 'You cannot read the ledger' : 'Could not load entries'}
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">{error.message}</p>
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

          {!isLoading && !error && filtered.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">receipt_long</span>
              <h2 className="font-bold text-slate-900 mt-3">
                {entries.length === 0 ? 'No entries for this filter' : 'No entries match your search'}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {entries.length === 0
                  ? 'Nothing has been posted with this kind yet.'
                  : 'Try a different memo, reference or id.'}
              </p>
            </div>
          )}

          {!isLoading && !error && filtered.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Posted ledger entries</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Kind</th>
                    <th scope="col" className="px-5 py-3">Memo</th>
                    <th scope="col" className="px-5 py-3">Reference</th>
                    <th scope="col" className="px-5 py-3">Postings</th>
                    <th scope="col" className="px-5 py-3">Posted</th>
                    <th scope="col" className="px-5 py-3 text-right">Amount</th>
                    <th scope="col" className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((entry) => {
                    const isReversalEntry = entry.reverses_entry_id !== null;
                    return (
                      <tr key={entry.ledger_entry_id} className={entry.balanced ? '' : 'bg-red-50/40'}>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                              KIND_STYLE[entry.kind] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                            }`}
                          >
                            {humaniseCode(entry.kind)}
                          </span>
                          {isReversalEntry && (
                            <span className="block text-xs text-slate-400 mt-1">
                              reverses <code className="font-mono">{entry.reverses_entry_id!.slice(0, 8)}</code>
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-600">{entry.memo_code}</td>
                        <td className="px-5 py-3 text-slate-600">
                          {humaniseCode(entry.reference_type)}
                          <span className="block text-xs text-slate-400 font-mono">
                            {entry.reference_id.slice(0, 8)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          {entry.posting_count}
                          {!entry.balanced && (
                            <span className="ml-2 text-xs font-bold text-red-700">unbalanced</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-500">
                          {new Date(entry.posted_at).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-slate-900">
                          {formatSen(entry.amount_sen, currency)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openReverse(entry.ledger_entry_id)}
                            disabled={isReversalEntry}
                            title={
                              isReversalEntry
                                ? 'This entry is already a reversal and cannot be reversed here'
                                : 'Post a reversing entry for this line'
                            }
                            className="px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors bg-red-50 text-red-700 border-red-200 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-50"
                          >
                            Reverse
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && !error && entries.length > 0 && (
            <div className="py-4">
              <span className="text-sm text-slate-500">
                Showing <span className="font-bold text-slate-900">{filtered.length}</span> of{' '}
                <span className="font-bold text-slate-900">{entries.length}</span> loaded entries
                {entries.length === 200 && ' (server limit reached; narrow by kind)'}
              </span>
            </div>
          )}
        </div>
      </div>

      {reverseTargetId !== null && (
        <ReverseEntryModal
          entryId={reverseTargetId}
          isSaving={reverseBusy}
          error={reverseError}
          onClose={closeReverse}
          onSubmit={(body) => runReverse(reverseTargetId, body)}
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Reverse entry modal                                                         */
/* -------------------------------------------------------------------------- */

function ReverseEntryModal({
  entryId,
  isSaving,
  error,
  onClose,
  onSubmit,
}: {
  entryId: string;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (body: ReverseLedgerEntryRequest) => void;
}) {
  const [memoCode, setMemoCode] = useState('');
  const canSubmit = memoCode.trim() !== '' && !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ memo_code: memoCode.trim() });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Reverse ledger entry</h2>
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
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px]">warning</span>
            <span>
              Reversal posts a new entry with opposite-sign postings linked back to this one. The
              original entry is never deleted. This cannot be undone from this page.
            </span>
          </div>
          <p className="text-sm text-slate-600">
            Reversing entry <code className="font-mono">{entryId.slice(0, 8)}</code>.
          </p>
          <form id="reverse-entry-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">
                Memo code <span className="text-red-500">*</span>
              </span>
              <input
                value={memoCode}
                onChange={(e) => setMemoCode(e.target.value)}
                placeholder="e.g. reversal_misposted_payment"
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all font-mono"
                required
              />
              <span className="text-xs text-slate-500">
                A short code recording why this entry is being reversed.
              </span>
            </label>
          </form>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isForbidden
                  ? 'You cannot post ledger reversals'
                  : error.isConflict
                    ? 'Conflict — this entry may already have been reversed. Please retry.'
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
              form="reverse-entry-form"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-lg bg-red-600 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isSaving ? 'Posting reversal…' : 'Post reversal'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
