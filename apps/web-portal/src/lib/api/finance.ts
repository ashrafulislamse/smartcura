/**
 * Finance surface: ledger account balances, posted entries and payout runs.
 *
 * MONEY IS INTEGER SEN THROUGHOUT, never a float and never a formatted string from the
 * server. `formatSen` below is the ONLY place a display string is produced, so a rounding
 * choice cannot quietly differ between two pages showing the same figure.
 *
 * AUTHORITY IS SPLIT, and the portal must not paper over it: balances and entries need
 * `ledger:read:organization`, while payout runs need `payout_run:manage:organization` because
 * a run names its payees. A user holding one and not the other will get 403 on the other,
 * and that is correct rather than a bug to work around.
 */

import type {
  AddPayoutItemRequest,
  AdvancePayoutRunRequest,
  CreatePayoutRunRequest,
  LedgerAccountBalanceList,
  LedgerEntryList,
  LedgerReversal,
  PayoutItemCreated,
  PayoutItemSettled,
  PayoutRunCreated,
  PayoutRunList,
  PayoutRunState,
  ReverseLedgerEntryRequest,
  SettlePayoutItemRequest,
} from '@/types/contracts';
import { apiRequest } from './client';

export type PayoutRunStatus =
  | 'draft'
  | 'approved'
  | 'processing'
  | 'completed'
  | 'partially_failed'
  | 'failed'
  | 'cancelled';

export type LedgerEntryKind =
  | 'appointment_payment'
  | 'appointment_refund'
  | 'delivery_fee'
  | 'doctor_payout'
  | 'driver_withdrawal'
  | 'platform_fee'
  | 'adjustment'
  | 'reversal';

/** Projected balances. Derived from the postings; no stored balance exists to disagree. */
export function listLedgerAccounts(signal?: AbortSignal): Promise<LedgerAccountBalanceList> {
  return apiRequest<LedgerAccountBalanceList>({
    method: 'GET',
    path: '/finance/ledger/accounts',
    signal,
  });
}

export function listLedgerEntries(
  options: { kind?: LedgerEntryKind; limit?: number; signal?: AbortSignal } = {},
): Promise<LedgerEntryList> {
  const query = new URLSearchParams();
  if (options.kind) query.set('kind', options.kind);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
  return apiRequest<LedgerEntryList>({
    method: 'GET',
    path: `/finance/ledger/entries${suffix}`,
    signal: options.signal,
  });
}

export function listPayoutRuns(
  options: { status?: PayoutRunStatus; limit?: number; signal?: AbortSignal } = {},
): Promise<PayoutRunList> {
  const query = new URLSearchParams();
  if (options.status) query.set('status', options.status);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
  return apiRequest<PayoutRunList>({
    method: 'GET',
    path: `/finance/payout-runs${suffix}`,
    signal: options.signal,
  });
}

/**
 * The single place integer sen becomes a display string.
 *
 * Sen are divided by exactly 100 with two fixed decimals. No locale-dependent rounding
 * and no currency symbol guessing: the API states `currency: 'MYR'` once per response, so
 * the caller passes it in rather than this function assuming it.
 */
export function formatSen(amountSen: number, currency = 'MYR'): string {
  const negative = amountSen < 0;
  const absolute = Math.abs(amountSen);
  const major = Math.trunc(absolute / 100);
  const minor = String(absolute % 100).padStart(2, '0');
  const grouped = major.toLocaleString('en-MY');
  return `${negative ? '-' : ''}${currency} ${grouped}.${minor}`;
}

/** Machine vocabulary rendered readably, without inventing new words for it. */
export function humaniseCode(code: string): string {
  return code.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

// -------------------------------------------------------------- payout mutations

/**
 * Prepares a draft payout run covering a period. The caller does not name payees here —
 * items are added one at a time via `addPayoutItem`. Idempotent on the period range.
 */
export function createPayoutRun(
  body: CreatePayoutRunRequest,
  idempotencyKey: string,
): Promise<PayoutRunCreated> {
  return apiRequest<PayoutRunCreated>({
    method: 'POST',
    path: '/finance/payout-runs',
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Adds a single payee line to a draft run. The payee and amounts are resolved server-side. */
export function addPayoutItem(
  payoutRunId: string,
  body: AddPayoutItemRequest,
  idempotencyKey: string,
): Promise<PayoutItemCreated> {
  return apiRequest<PayoutItemCreated>({
    method: 'POST',
    path: `/finance/payout-runs/${payoutRunId}/items`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

/**
 * Approves, starts or cancels a payout run. Separation of duties: the approver must not be
 * the same membership that prepared the run. `expected_version` guards against concurrent edits.
 */
export function advancePayoutRun(
  payoutRunId: string,
  body: AdvancePayoutRunRequest,
): Promise<PayoutRunState> {
  return apiRequest<PayoutRunState>({
    method: 'PUT',
    path: `/finance/payout-runs/${payoutRunId}/status`,
    body,
    csrf: true,
  });
}

/**
 * Settles one payout line while a run is processing: posts a balanced ledger entry and marks
 * the item `paid`. Both account IDs must be supplied so the ledger entry is fully specified.
 */
export function settlePayoutItem(
  payoutItemId: string,
  body: SettlePayoutItemRequest,
  idempotencyKey: string,
): Promise<PayoutItemSettled> {
  return apiRequest<PayoutItemSettled>({
    method: 'POST',
    path: `/finance/payout-items/${payoutItemId}/settlement`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

// ----------------------------------------------------------- ledger reversal

/**
 * Posts a reversing entry for a posted ledger entry. The reversal creates a new entry with
 * `kind: 'reversal'` and opposite-sign postings, linked back via `reverses_entry_id`.
 */
export function reverseLedgerEntry(
  ledgerEntryId: string,
  body: ReverseLedgerEntryRequest,
  idempotencyKey: string,
): Promise<LedgerReversal> {
  return apiRequest<LedgerReversal>({
    method: 'POST',
    path: `/finance/ledger/entries/${ledgerEntryId}/reversal`,
    body,
    csrf: true,
    idempotencyKey,
  });
}
