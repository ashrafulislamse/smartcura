'use client';

/**
 * Finance overview, wired to GET /finance/ledger/accounts and /finance/ledger/entries.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT DO. It computes no revenue figure of its own. The
 * ledger stores signed postings and every balance is a PROJECTION with no stored total to
 * disagree with — inventing a "total revenue" in the browser would reintroduce exactly the
 * cached total the schema was designed to make impossible. Balances are shown as the
 * server derives them, grouped by account kind.
 *
 * The previous page showed invented monthly figures and a growth percentage. Both are gone
 * rather than fabricated from one page of entries.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import {
  formatSen,
  humaniseCode,
  listLedgerAccounts,
  listLedgerEntries,
} from '@/lib/api/finance';
import TopBar from '@/components/layout/TopBar';

const KIND_TINT: Record<string, string> = {
  asset: 'text-blue-600',
  liability: 'text-amber-600',
  revenue: 'text-green-600',
  expense: 'text-red-600',
  equity: 'text-purple-600',
};

export default function FinanceOverviewPage() {
  const { user, isLoading: isAuthLoading } = useAuth();

  const accounts = useApiResource((signal) => listLedgerAccounts(signal), []);
  const entries = useApiResource((signal) => listLedgerEntries({ limit: 10, signal }), []);

  const currency = accounts.data?.currency ?? 'MYR';

  const byKind = useMemo(() => {
    const groups = new Map<string, { total: number; count: number }>();
    for (const account of accounts.data?.data ?? []) {
      const current = groups.get(account.kind) ?? { total: 0, count: 0 };
      groups.set(account.kind, {
        total: current.total + account.balance_sen,
        count: current.count + 1,
      });
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [accounts.data]);

  const unbalanced = useMemo(
    () => (entries.data?.data ?? []).filter((entry) => !entry.balanced).length,
    [entries.data],
  );

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  const forbidden = accounts.error?.isForbidden ?? false;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Finance' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Finance</h1>
              <p className="text-slate-500 mt-1">
                Balances are projections of the posted ledger. Amounts are integer sen in {currency}.
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href="/finance/transactions"
                className="px-4 py-2.5 border border-slate-200 bg-white rounded-lg font-bold text-sm text-slate-700 hover:bg-slate-50"
              >
                All transactions
              </Link>
              <Link
                href="/finance/payouts"
                className="px-4 py-2.5 bg-[#1e3fae] text-white rounded-lg font-bold text-sm shadow-md hover:bg-blue-700"
              >
                Payout runs
              </Link>
            </div>
          </div>

          {accounts.isLoading && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3fae]"></div>
              <p className="text-sm text-slate-500">Loading ledger balances…</p>
            </div>
          )}

          {!accounts.isLoading && accounts.error && (
            <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8" role="alert">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600">error</span>
                <div className="flex-1">
                  <h2 className="font-bold text-slate-900">
                    {forbidden ? 'You cannot read the ledger' : 'Could not load ledger balances'}
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">{accounts.error.message}</p>
                  {accounts.error.correlationId && (
                    <p className="text-xs text-slate-400 mt-2">
                      Reference: <code>{accounts.error.correlationId}</code>
                    </p>
                  )}
                  {!forbidden && (
                    <button
                      onClick={accounts.reload}
                      className="mt-4 px-4 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!accounts.isLoading && !accounts.error && byKind.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">account_balance</span>
              <h2 className="font-bold text-slate-900 mt-3">No ledger accounts yet</h2>
              <p className="text-sm text-slate-500 mt-1">
                Accounts appear once money has moved through the platform.
              </p>
            </div>
          )}

          {!accounts.isLoading && !accounts.error && byKind.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {byKind.map(([kind, group]) => (
                <div key={kind} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`material-symbols-outlined ${KIND_TINT[kind] ?? 'text-slate-500'} text-2xl`}>
                      account_balance
                    </span>
                    <span className="text-xs font-bold text-slate-500">{humaniseCode(kind)}</span>
                  </div>
                  <p className="text-2xl font-bold text-slate-900">{formatSen(group.total, currency)}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {group.count} account{group.count === 1 ? '' : 's'}
                  </p>
                </div>
              ))}
            </div>
          )}

          {!accounts.isLoading && !accounts.error && (accounts.data?.data.length ?? 0) > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="font-bold text-slate-900">Accounts</h2>
              </div>
              <table className="w-full text-sm">
                <caption className="sr-only">Ledger accounts with projected balances</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Account</th>
                    <th scope="col" className="px-5 py-3">Kind</th>
                    <th scope="col" className="px-5 py-3">Normal side</th>
                    <th scope="col" className="px-5 py-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts.data!.data.map((account) => (
                    <tr key={account.ledger_account_id}>
                      <td className="px-5 py-3 font-mono text-xs text-slate-700">{account.account_code}</td>
                      <td className="px-5 py-3 text-slate-600">{humaniseCode(account.kind)}</td>
                      <td className="px-5 py-3 text-slate-600">{humaniseCode(account.normal_side)}</td>
                      <td className="px-5 py-3 text-right font-bold text-slate-900">
                        {formatSen(account.balance_sen, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Recent entries</h2>
              <Link href="/finance/transactions" className="text-sm font-bold text-[#1e3fae] hover:underline">
                View all
              </Link>
            </div>

            {unbalanced > 0 && (
              // An unbalanced entry cannot exist by database constraint, so seeing one
              // means the invariant has been defeated. That is escalation-worthy, not a
              // cosmetic warning to style quietly.
              <div className="px-5 py-3 bg-red-50 border-b border-red-100 text-sm text-red-800 font-bold" role="alert">
                {unbalanced} entr{unbalanced === 1 ? 'y' : 'ies'} report as unbalanced. This should be
                impossible — report it before relying on these figures.
              </div>
            )}

            {entries.isLoading && <p className="px-5 py-6 text-sm text-slate-500">Loading entries…</p>}
            {!entries.isLoading && entries.error && (
              <p className="px-5 py-6 text-sm text-slate-600">{entries.error.message}</p>
            )}
            {!entries.isLoading && !entries.error && (entries.data?.data.length ?? 0) === 0 && (
              <p className="px-5 py-6 text-sm text-slate-500">No entries have been posted yet.</p>
            )}
            {!entries.isLoading && !entries.error && (entries.data?.data.length ?? 0) > 0 && (
              <table className="w-full text-sm">
                <caption className="sr-only">Most recent posted ledger entries</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Kind</th>
                    <th scope="col" className="px-5 py-3">Reference</th>
                    <th scope="col" className="px-5 py-3">Posted</th>
                    <th scope="col" className="px-5 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.data!.data.map((entry) => (
                    <tr key={entry.ledger_entry_id}>
                      <td className="px-5 py-3">
                        <span className="font-bold text-slate-900">{humaniseCode(entry.kind)}</span>
                        {entry.reverses_entry_id && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border bg-amber-50 text-amber-700 border-amber-100">
                            reversal
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{humaniseCode(entry.reference_type)}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {new Date(entry.posted_at).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-slate-900">
                        {formatSen(entry.amount_sen, entries.data!.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
