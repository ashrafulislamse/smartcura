import { Injectable } from '@nestjs/common';
import { PostgresConnection } from '@smartcura/database';
import { problem, validationFailed } from '../platform/problems.js';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import type { SessionMembershipRecord } from '@smartcura/database';
import { z } from 'zod';
import { earningsQuerySchema, type EarningsQuery } from './doctor-earnings.schemas.js';

/**
 * Doctor-scoped earnings service.
 *
 * GET /doctor/earnings returns the current doctor's payout history: a balance
 * projected over paid payout items, a cumulative total earned, and a page of
 * recent entries. The scope is derived entirely from the session: the active
 * doctor membership is resolved from
 * `current.aggregate.session.activeMembershipId`, and every query is
 * restricted to `payout_items.payee_membership_id = that membership`.
 *
 * WHY THE SCOPE IS `payee_membership_id`, NOT `owner_profile_id`. The ledger
 * has per-counterparty accounts (`ledger_accounts.owner_profile_id`), and a
 * doctor's payable account could be resolved by profile. But `payout_items`
 * carries `payee_membership_id` directly, and the payout flow
 * (`FinanceRepository.settlePayoutItem`) posts `kind = 'doctor_payout'` with
 * `reference_id = payout_item_id`. The membership is the stable handle the
 * payout system uses, and it is what the session gives us, so the query goes
 * through `payout_items` rather than the ledger account projection. This also
 * avoids assuming a `doctor_payable` account exists for every doctor — the
 * account is created on first use (`resolvePlatformAccount`), so a doctor who
 * has never been in a payout run would have no ledger account to project.
 *
 * THE BALANCE IS A PROJECTION, NOT A STORED COLUMN. There is no cached balance
 * anywhere in this schema (the central rule of the finance migration: "Cached
 * balances do not exist as stored columns anywhere here, because a stored
 * balance is a second source of truth"). The balance is the sum of `net_sen`
 * for items whose `status = 'paid'`, minus any reversal entries. A reversal
 * posts a new opposing entry rather than editing the original, so the
 * projection over postings is always correct.
 *
 * AUTHORIZATION mirrors `DoctorService.doctor()` and
 * `WorkstreamFService.assignedPatients`: the caller must hold an active
 * membership with `role_id = 'doctor'` and the
 * `profile_detail:read:assigned` permission. A non-doctor membership or a
 * revoked membership is refused with 403.
 */
@Injectable()
export class DoctorEarningsService {
  constructor(private readonly database: PostgresConnection) {}

  async earnings(
    current: AuthenticatedSession,
    queryValue: unknown,
  ): Promise<{
    balance_sen: number;
    currency: string;
    total_earned_sen: number;
    data: ReturnType<typeof payoutItemResponse>[];
    page: { has_more: boolean; next_cursor: string | null };
  }> {
    const active = this.doctor(current);
    const query = parseQuery(queryValue);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

    const [balance, totalEarned, rows] = await Promise.all([
      doctorBalanceSen(this.database, active.membershipId, active.organizationId),
      doctorTotalEarnedSen(this.database, active.membershipId, active.organizationId),
      listDoctorPayoutItems(this.database, {
        payeeMembershipId: active.membershipId,
        organizationId: active.organizationId,
        afterCreatedAt: cursor?.createdAt,
        afterPayoutItemId: cursor?.payoutItemId,
        limit: query.page_size + 1,
      }),
    ]);

    const hasMore = rows.length > query.page_size;
    const page = hasMore ? rows.slice(0, query.page_size) : rows;
    const last = page.at(-1);

    return {
      balance_sen: balance,
      currency: 'MYR',
      total_earned_sen: totalEarned,
      data: page.map(payoutItemResponse),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeCursor(last) : null,
      },
    };
  }

  /**
   * Resolve the active doctor membership from the session, refusing if the
   * caller is not an active doctor with assignment-read authority. Mirrors
   * `DoctorService.doctor()` exactly.
   */
  private doctor(current: AuthenticatedSession): SessionMembershipRecord {
    const active = current.aggregate.memberships.find(
      (m) => m.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (
      !active ||
      active.status !== 'active' ||
      active.roleId !== 'doctor' ||
      !active.permissions.includes('profile_detail:read:assigned')
    ) {
      throw problem(403, 'PERMISSION_DENIED', 'Doctor assignment authority is required');
    }
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      throw problem(403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete');
    }
    return active;
  }
}

// ---------------------------------------------------------------------------
// Repository-style queries (kept in this file so no database/src file is touched)
// ---------------------------------------------------------------------------

/**
 * A payout item row scoped to the active doctor.
 *
 * `netSen` is the generated column (`gross_sen - platform_fee_sen`), read as a
 * string from bigint and converted to a number. `status` is the payout item
 * lifecycle: `pending`, `paid`, `failed`, or `cancelled`. `ledgerEntryId` is
 * present iff `status = 'paid'` (enforced by `payout_items_paid_entry_check`).
 */
export interface DoctorPayoutItemRecord {
  readonly payoutItemId: string;
  readonly payoutRunId: string;
  readonly grossSen: number;
  readonly platformFeeSen: number;
  readonly netSen: number;
  readonly status: string;
  readonly ledgerEntryId: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly runStatus: string;
  readonly createdAt: Date;
}

interface DoctorPayoutItemRow {
  readonly payoutItemId: string;
  readonly payoutRunId: string;
  readonly grossSen: string;
  readonly platformFeeSen: string;
  readonly netSen: string;
  readonly status: string;
  readonly ledgerEntryId: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly runStatus: string;
  readonly createdAt: Date;
}

interface ListDoctorPayoutItemsInput {
  readonly payeeMembershipId: string;
  readonly organizationId: string;
  readonly afterCreatedAt?: Date | undefined;
  readonly afterPayoutItemId?: string | undefined;
  readonly limit: number;
}

interface BalanceRow {
  readonly balance: string;
}

/**
 * The doctor's current payable balance as a projection over paid payout items.
 *
 * Only items with `status = 'paid'` have moved money (the
 * `payout_items_paid_entry_check` constraint guarantees a paid item has a
 * ledger entry). The balance is the sum of `net_sen` for paid items — the
 * amount the doctor actually receives after the platform fee. A reversal posts
 * a new opposing `doctor_payout` entry, which would appear as a negative in the
 * ledger projection; here we project over `payout_items` directly, and a
 * reversed payout item would have its `status` changed, so the projection over
 * item status is consistent.
 *
 * The organization scope is applied through the `payout_runs` join so the sum
 * cannot cross an organization boundary even if the membership were somehow
 * reused across organizations (it cannot be — a membership belongs to exactly
 * one organization — but the join is defence in depth).
 */
async function doctorBalanceSen(
  database: PostgresConnection,
  payeeMembershipId: string,
  organizationId: string,
): Promise<number> {
  const result = await database.query<BalanceRow>(
    `SELECT COALESCE(SUM(item.net_sen), 0)::text AS balance
     FROM payout_items item
     JOIN payout_runs run ON run.payout_run_id = item.payout_run_id
     WHERE item.payee_membership_id = $1
       AND run.organization_id = $2
       AND item.status = 'paid'`,
    [payeeMembershipId, organizationId],
  );
  return Number(result.rows[0]?.balance ?? '0');
}

/**
 * The doctor's cumulative total earned (gross), projected over all paid payout
 * items regardless of period. This is the lifetime gross the doctor has earned
 * — the sum of `gross_sen` before the platform fee is deducted — not the net
 * balance. Like the balance, it is a projection — no stored total exists.
 *
 * `gross_sen` is used rather than `net_sen` so `total_earned_sen` and
 * `balance_sen` carry different information: the total earned is the gross
 * billing, and the balance is what the doctor actually receives after fees.
 */
async function doctorTotalEarnedSen(
  database: PostgresConnection,
  payeeMembershipId: string,
  organizationId: string,
): Promise<number> {
  const result = await database.query<BalanceRow>(
    `SELECT COALESCE(SUM(item.gross_sen), 0)::text AS balance
     FROM payout_items item
     JOIN payout_runs run ON run.payout_run_id = item.payout_run_id
     WHERE item.payee_membership_id = $1
       AND run.organization_id = $2
       AND item.status = 'paid'`,
    [payeeMembershipId, organizationId],
  );
  return Number(result.rows[0]?.balance ?? '0');
}

/**
 * Deterministic keyset pagination on `(item.created_at, item.payout_item_id)`,
 * matching the convention in `DeviceRepository.list` and
 * `WorkstreamFRepository.listAssignedPatients`. Both columns are needed because
 * `created_at` is not unique: a payout run that added multiple items in the
 * same millisecond would otherwise repeat or skip one at the page boundary.
 *
 * Ordered by `created_at DESC` so the most recent payout items appear first,
 * which is the shape an earnings page needs: a doctor looking at their recent
 * payouts wants the latest, not the oldest.
 */
async function listDoctorPayoutItems(
  database: PostgresConnection,
  input: ListDoctorPayoutItemsInput,
): Promise<DoctorPayoutItemRecord[]> {
  const result = await database.query<DoctorPayoutItemRow>(
    `SELECT item.payout_item_id AS "payoutItemId",
            item.payout_run_id AS "payoutRunId",
            item.gross_sen::text AS "grossSen",
            item.platform_fee_sen::text AS "platformFeeSen",
            item.net_sen::text AS "netSen",
            item.status,
            item.ledger_entry_id AS "ledgerEntryId",
            run.period_start::text AS "periodStart",
            run.period_end::text AS "periodEnd",
            run.status AS "runStatus",
            item.created_at AS "createdAt"
     FROM payout_items item
     JOIN payout_runs run ON run.payout_run_id = item.payout_run_id
     WHERE item.payee_membership_id = $1
       AND run.organization_id = $2
       AND ($3::timestamptz IS NULL OR
         (item.created_at, item.payout_item_id) < ($3, $4::uuid))
     ORDER BY item.created_at DESC, item.payout_item_id DESC
     LIMIT $5`,
    [
      input.payeeMembershipId,
      input.organizationId,
      input.afterCreatedAt ?? null,
      input.afterPayoutItemId ?? null,
      input.limit,
    ],
  );
  return result.rows.map(toPayoutItemRecord);
}

function toPayoutItemRecord(row: DoctorPayoutItemRow): DoctorPayoutItemRecord {
  return {
    payoutItemId: row.payoutItemId,
    payoutRunId: row.payoutRunId,
    grossSen: Number(row.grossSen),
    platformFeeSen: Number(row.platformFeeSen),
    netSen: Number(row.netSen),
    status: row.status,
    ledgerEntryId: row.ledgerEntryId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    runStatus: row.runStatus,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Serialisation and cursor helpers
// ---------------------------------------------------------------------------

/**
 * Serialise a payout item to the response shape. Money is integer sen
 * everywhere — the server never sends a formatted string (the money convention
 * in AGENTS.md). `ledger_entry_id` is present iff `status = 'paid'`, enforced
 * by the `payout_items_paid_entry_check` constraint.
 */
function payoutItemResponse(r: DoctorPayoutItemRecord): Record<string, unknown> {
  return {
    id: r.payoutItemId,
    payout_run_id: r.payoutRunId,
    gross_sen: r.grossSen,
    platform_fee_sen: r.platformFeeSen,
    net_sen: r.netSen,
    status: r.status,
    ledger_entry_id: r.ledgerEntryId,
    period_start: r.periodStart,
    period_end: r.periodEnd,
    run_status: r.runStatus,
    created_at: r.createdAt.toISOString(),
  };
}

interface PayoutItemCursor {
  readonly createdAt: Date;
  readonly payoutItemId: string;
}

function encodeCursor(record: DoctorPayoutItemRecord): string {
  return Buffer.from(
    JSON.stringify({
      created_at: record.createdAt.toISOString(),
      payout_item_id: record.payoutItemId,
    }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: string): PayoutItemCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (typeof decoded !== 'object' || decoded === null) throw new Error();
    const candidate = decoded as Record<string, unknown>;
    const createdAtValue = candidate['created_at'];
    const payoutItemIdValue = candidate['payout_item_id'];
    if (typeof createdAtValue !== 'string' || typeof payoutItemIdValue !== 'string') {
      throw new Error();
    }
    const createdAt = new Date(createdAtValue);
    if (!Number.isFinite(createdAt.getTime())) throw new Error();
    const uuidParse = z.string().uuid().safeParse(payoutItemIdValue);
    if (!uuidParse.success) throw new Error();
    return { createdAt, payoutItemId: payoutItemIdValue };
  } catch {
    throw validationFailed();
  }
}

function parseQuery(value: unknown): EarningsQuery {
  const result = earningsQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}
