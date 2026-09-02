import type { PoolClient } from 'pg';
import {
  LEDGER_ENTRY_POSTED_EVENT_TYPE,
  LEDGER_ENTRY_POSTED_EVENT_VERSION,
} from './finance-events.js';

/**
 * The single place a balanced ledger entry is written.
 *
 * Both the finance surface and the domain flows that move money post through here, so
 * there is exactly ONE implementation of what "balanced" means. Two implementations would
 * eventually disagree, and the one that disagreed would still commit because a service can
 * always be wrong about arithmetic — the deferred database trigger is the backstop, not the
 * primary guarantee this function provides.
 *
 * `amountSen` is SIGNED: debits positive, credits negative. A caller therefore cannot mix
 * up which column meant what, because there is only one column.
 */

export interface LedgerPostingInput {
  readonly ledgerAccountId: string;
  readonly amountSen: number;
}

export interface PostBalancedEntryInput {
  readonly organizationId: string;
  readonly kind: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly memoCode: string;
  readonly reversesEntryId: string | null;
  readonly postings: readonly LedgerPostingInput[];
  readonly correlationId: string;
  readonly occurredAt?: Date;
}

export async function postBalancedEntry(
  client: PoolClient, input: PostBalancedEntryInput,
): Promise<string> {
  const net = input.postings.reduce((sum, posting) => sum + posting.amountSen, 0);
  // Refused here as well as by the deferred trigger. Failing at the call site names the
  // caller in the stack, whereas a commit-time failure only names the transaction.
  if (net !== 0) {
    throw new Error(`ledger entry is unbalanced by ${net} sen`);
  }
  if (input.postings.length < 2) {
    throw new Error('a ledger entry needs at least two postings');
  }
  const entry = await client.query<{ ledgerEntryId: string }>(
    `INSERT INTO ledger_entries
       (organization_id, kind, reference_type, reference_id, memo_code, reverses_entry_id)
     VALUES ($1,$2::ledger_entry_kind,$3,$4,$5,$6)
     RETURNING ledger_entry_id AS "ledgerEntryId"`,
    [input.organizationId, input.kind, input.referenceType, input.referenceId,
      input.memoCode, input.reversesEntryId],
  );
  const ledgerEntryId = entry.rows[0]!.ledgerEntryId;
  for (const posting of input.postings) {
    await client.query(
      `INSERT INTO ledger_postings (ledger_entry_id, ledger_account_id, amount_sen)
       VALUES ($1,$2,$3)`,
      [ledgerEntryId, posting.ledgerAccountId, posting.amountSen],
    );
  }
  await client.query(
    `INSERT INTO outbox_events
       (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
        payload,correlation_id,occurred_at)
     VALUES (uuidv7(),$1,$2,'ledger_entry',$3,0,$4::jsonb,$5,$6)`,
    [LEDGER_ENTRY_POSTED_EVENT_TYPE, LEDGER_ENTRY_POSTED_EVENT_VERSION,
      ledgerEntryId, JSON.stringify({
        ledger_entry_id: ledgerEntryId,
        kind: input.kind,
        // Half the absolute movement, which is the amount of the transaction rather than
        // the sum of both sides. No account structure travels.
        amount_sen: input.postings
          .reduce((sum, posting) => sum + Math.abs(posting.amountSen), 0) / 2,
      }), input.correlationId, input.occurredAt ?? new Date()],
  );
  return ledgerEntryId;
}

/**
 * Platform accounts, resolved by code and created on first use.
 *
 * These are structural accounts the platform always needs, not a user-managed chart, so
 * creating one on demand is safe and removes a deployment ordering problem: a payment must
 * not fail because nobody had opened a revenue account yet. `ON CONFLICT DO NOTHING`
 * followed by a read makes this safe under concurrency.
 */
export async function resolvePlatformAccount(
  client: PoolClient,
  organizationId: string,
  accountCode: string,
  kind: 'asset' | 'liability' | 'revenue' | 'expense' | 'equity',
  normalSide: 'debit' | 'credit',
): Promise<string> {
  // READ FIRST. An unconditional upsert made every payment write to the same account row,
  // which under SERIALIZABLE turned concurrent bookings into serialization conflicts
  // instead of the specific slot-taken answer they used to get. The steady state is now a
  // pure read, and only the very first use of an account writes anything.
  const existing = await client.query<{ ledgerAccountId: string }>(
    `SELECT ledger_account_id AS "ledgerAccountId" FROM ledger_accounts
      WHERE organization_id = $1 AND account_code = $2 AND owner_profile_id IS NULL`,
    [organizationId, accountCode],
  );
  const found = existing.rows[0]?.ledgerAccountId;
  if (found !== undefined) return found;
  await client.query(
    `INSERT INTO ledger_accounts (organization_id, account_code, kind, normal_side)
     VALUES ($1,$2,$3::ledger_account_kind,$4)
     ON CONFLICT (organization_id, account_code,
       COALESCE(owner_profile_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO NOTHING`,
    [organizationId, accountCode, kind, normalSide],
  );
  const created = await client.query<{ ledgerAccountId: string }>(
    `SELECT ledger_account_id AS "ledgerAccountId" FROM ledger_accounts
      WHERE organization_id = $1 AND account_code = $2 AND owner_profile_id IS NULL`,
    [organizationId, accountCode],
  );
  return created.rows[0]!.ledgerAccountId;
}

/** The platform account codes the domain flows post against. */
export const PLATFORM_ACCOUNTS = Object.freeze({
  cash: { code: 'platform_cash', kind: 'asset', side: 'debit' },
  consultationRevenue: { code: 'consultation_revenue', kind: 'revenue', side: 'credit' },
  refunds: { code: 'consultation_refunds', kind: 'expense', side: 'debit' },
  doctorPayable: { code: 'doctor_payable', kind: 'liability', side: 'credit' },
  deliveryRevenue: { code: 'delivery_revenue', kind: 'revenue', side: 'credit' },
} as const);
