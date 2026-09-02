import type { PoolClient } from 'pg';
import { PostgresConnection } from './connection.js';
import { postBalancedEntry } from './ledger-posting.js';
import {
  PAYOUT_RUN_CHANGED_EVENT_TYPE,
  PAYOUT_RUN_CHANGED_EVENT_VERSION,
  SUPPORT_TICKET_CHANGED_EVENT_TYPE,
  SUPPORT_TICKET_CHANGED_EVENT_VERSION,
  EXPORT_JOB_CHANGED_EVENT_TYPE,
  EXPORT_JOB_CHANGED_EVENT_VERSION,
  type PayoutRunStatus,
  type SupportTicketStatus,
  type LedgerEntryKind,
} from './finance-events.js';

/** Draft is the only editable state; approval freezes amounts. */
const RUN_SEQUENCE: readonly PayoutRunStatus[] = ['draft', 'approved', 'processing'];

export function payoutRunTransitionAllowed(
  current: PayoutRunStatus, next: PayoutRunStatus,
): boolean {
  if (current === 'completed' || current === 'failed' || current === 'cancelled') return false;
  if (next === 'cancelled') return current === 'draft' || current === 'approved';
  // Settlement outcomes are decided by what actually happened to the items, so they are
  // reachable only from `processing` and never requested directly.
  if (next === 'completed' || next === 'partially_failed' || next === 'failed') {
    return current === 'processing';
  }
  const from = RUN_SEQUENCE.indexOf(current);
  const to = RUN_SEQUENCE.indexOf(next);
  return from >= 0 && to === from + 1;
}

export function ticketTransitionAllowed(
  current: SupportTicketStatus, next: SupportTicketStatus,
): boolean {
  if (current === 'closed') return false;
  if (current === next) return false;
  // A resolved ticket may be reopened to in_progress, because a requester saying "this is
  // not fixed" is normal and forcing a new ticket would lose the history.
  if (current === 'resolved') return next === 'closed' || next === 'in_progress';
  // Closing requires a resolution first, so a ticket cannot be silently buried.
  if (next === 'closed') return false;
  return true;
}

export interface LedgerAccountBalance {
  readonly ledgerAccountId: string;
  readonly accountCode: string;
  readonly kind: string;
  readonly normalSide: string;
  /** PROJECTED from postings. There is no stored balance to drift. */
  readonly balanceSen: number;
}

export interface PostingInput {
  readonly ledgerAccountId: string;
  readonly amountSen: number;
}

export class FinanceRepository {
  constructor(private readonly database: PostgresConnection) {}

  async accountBalances(organizationId: string): Promise<readonly LedgerAccountBalance[]> {
    const found = await this.database.query<LedgerAccountBalance>(
      `SELECT a.ledger_account_id AS "ledgerAccountId", a.account_code AS "accountCode",
              a.kind::text AS kind, a.normal_side AS "normalSide",
              COALESCE(sum(p.amount_sen), 0)::bigint AS "balanceSen"
         FROM ledger_accounts a
         LEFT JOIN ledger_postings p ON p.ledger_account_id = a.ledger_account_id
        WHERE a.organization_id = $1 AND a.active
        GROUP BY a.ledger_account_id, a.account_code, a.kind, a.normal_side
        ORDER BY a.account_code`,
      [organizationId],
    );
    return found.rows.map((row) => ({ ...row, balanceSen: Number(row.balanceSen) }));
  }

  /**
   * Post a balanced entry. The postings are written in the SAME transaction as the entry,
   * because the deferred balance trigger only permits a commit where they agree — an
   * entry committed alone would be rejected, which is the intended behaviour.
   */
  async postEntry(input: {
    readonly organizationId: string;
    readonly kind: string;
    readonly referenceType: string;
    readonly referenceId: string;
    readonly memoCode: string;
    readonly reversesEntryId: string | null;
    readonly postings: readonly PostingInput[];
    readonly correlationId: string;
  }, client?: PoolClient): Promise<string> {
    // Delegates to the single shared implementation. A second copy here once existed and
    // is exactly how two definitions of "balanced" start to drift.
    const write = async (session: PoolClient): Promise<string> =>
      postBalancedEntry(session, {
        organizationId: input.organizationId,
        kind: input.kind,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        memoCode: input.memoCode,
        reversesEntryId: input.reversesEntryId,
        postings: input.postings,
        correlationId: input.correlationId,
      });
    if (client !== undefined) return write(client);
    return this.database.transaction(write);
  }

  async findEntry(ledgerEntryId: string): Promise<{
    readonly ledgerEntryId: string; readonly organizationId: string;
    readonly kind: string; readonly postings: readonly PostingInput[];
  } | null> {
    const entry = await this.database.query<{
      ledgerEntryId: string; organizationId: string; kind: string;
    }>(
      `SELECT ledger_entry_id AS "ledgerEntryId", organization_id AS "organizationId",
              kind::text AS kind
         FROM ledger_entries WHERE ledger_entry_id = $1`,
      [ledgerEntryId],
    );
    const found = entry.rows[0];
    if (found === undefined) return null;
    const postings = await this.database.query<{ ledgerAccountId: string; amountSen: string }>(
      `SELECT ledger_account_id AS "ledgerAccountId", amount_sen AS "amountSen"
         FROM ledger_postings WHERE ledger_entry_id = $1 ORDER BY created_at`,
      [ledgerEntryId],
    );
    return {
      ...found,
      postings: postings.rows.map((row) => ({
        ledgerAccountId: row.ledgerAccountId, amountSen: Number(row.amountSen),
      })),
    };
  }

  /** A reversal mirrors every posting of the original with the opposite sign. */
  async reverseEntry(input: {
    readonly organizationId: string;
    readonly reversesEntryId: string;
    readonly memoCode: string;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly ledgerEntryId: string }
    | { readonly ok: false; readonly reason: 'not_found' | 'already_reversed' }> {
    const original = await this.findEntry(input.reversesEntryId);
    if (original === null || original.organizationId !== input.organizationId) {
      return { ok: false, reason: 'not_found' };
    }
    try {
      const ledgerEntryId = await this.postEntry({
        organizationId: input.organizationId,
        kind: 'reversal',
        referenceType: 'ledger_entry',
        referenceId: input.reversesEntryId,
        memoCode: input.memoCode,
        reversesEntryId: input.reversesEntryId,
        postings: original.postings.map((posting) => ({
          ledgerAccountId: posting.ledgerAccountId,
          amountSen: -posting.amountSen,
        })),
        correlationId: input.correlationId,
      });
      return { ok: true, ledgerEntryId };
    } catch (error) {
      const code = typeof error === 'object' && error !== null
        ? (error as { readonly code?: unknown }).code : undefined;
      // The one-reversal-per-entry index. Caught around the whole call because the
      // balance and negation triggers are DEFERRABLE and fire at commit.
      if (code === '23505') return { ok: false, reason: 'already_reversed' };
      throw error;
    }
  }

  /**
   * The payee's profile, resolved from their membership WITHIN this organization. The
   * profile id is never taken from a request: a run that could name any profile as payee
   * would move money to someone no approval step would notice.
   */
  async payeeProfileForMembership(
    membershipId: string, organizationId: string,
  ): Promise<string | null> {
    const found = await this.database.query<{ profileId: string }>(
      `SELECT profile_id AS "profileId" FROM organization_memberships
        WHERE membership_id = $1 AND organization_id = $2 AND status = 'active'`,
      [membershipId, organizationId],
    );
    return found.rows[0]?.profileId ?? null;
  }

  async createPayoutRun(input: {
    readonly organizationId: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly preparedByMembershipId: string;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly payoutRunId: string }
    | { readonly ok: false; readonly reason: 'period_open' }> {
    try {
      return await this.database.transaction(async (client) => {
        const created = await client.query<{ payoutRunId: string }>(
          `INSERT INTO payout_runs
             (organization_id, period_start, period_end, prepared_by_membership_id)
           VALUES ($1,$2,$3,$4)
           RETURNING payout_run_id AS "payoutRunId"`,
          [input.organizationId, input.periodStart, input.periodEnd,
            input.preparedByMembershipId],
        );
        const payoutRunId = created.rows[0]!.payoutRunId;
        await this.publishRun(client, payoutRunId, 'draft', input.correlationId);
        return { ok: true as const, payoutRunId };
      });
    } catch (error) {
      const code = typeof error === 'object' && error !== null
        ? (error as { readonly code?: unknown }).code : undefined;
      if (code === '23505') return { ok: false, reason: 'period_open' };
      throw error;
    }
  }

  async findPayoutRun(payoutRunId: string): Promise<{
    readonly payoutRunId: string; readonly organizationId: string;
    readonly status: PayoutRunStatus; readonly version: number;
    readonly preparedByMembershipId: string;
    readonly approvedByMembershipId: string | null;
  } | null> {
    const found = await this.database.query<{
      payoutRunId: string; organizationId: string; status: PayoutRunStatus;
      version: number; preparedByMembershipId: string; approvedByMembershipId: string | null;
    }>(
      `SELECT payout_run_id AS "payoutRunId", organization_id AS "organizationId", status,
              version, prepared_by_membership_id AS "preparedByMembershipId",
              approved_by_membership_id AS "approvedByMembershipId"
         FROM payout_runs WHERE payout_run_id = $1`,
      [payoutRunId],
    );
    return found.rows[0] ?? null;
  }

  async addPayoutItem(input: {
    readonly payoutRunId: string;
    readonly payeeMembershipId: string;
    readonly payeeProfileId: string;
    readonly grossSen: number;
    readonly platformFeeSen: number;
  }): Promise<{ readonly ok: true; readonly payoutItemId: string; readonly netSen: number }
    | { readonly ok: false; readonly reason: 'duplicate_payee' | 'run_frozen' }> {
    try {
      const created = await this.database.query<{ payoutItemId: string; netSen: string }>(
        `INSERT INTO payout_items
           (payout_run_id, payee_membership_id, payee_profile_id, gross_sen, platform_fee_sen)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING payout_item_id AS "payoutItemId", net_sen AS "netSen"`,
        [input.payoutRunId, input.payeeMembershipId, input.payeeProfileId,
          input.grossSen, input.platformFeeSen],
      );
      return {
        ok: true,
        payoutItemId: created.rows[0]!.payoutItemId,
        netSen: Number(created.rows[0]!.netSen),
      };
    } catch (error) {
      const code = typeof error === 'object' && error !== null
        ? (error as { readonly code?: unknown }).code : undefined;
      if (code === '23505') return { ok: false, reason: 'duplicate_payee' };
      // The freeze trigger raises check_violation once a run leaves draft.
      if (code === '23514') return { ok: false, reason: 'run_frozen' };
      throw error;
    }
  }

  async advancePayoutRun(input: {
    readonly payoutRunId: string;
    readonly next: PayoutRunStatus;
    readonly actorMembershipId: string;
    readonly actorProfileId: string;
    readonly reasonCode: string | null;
    readonly expectedVersion: number;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly status: PayoutRunStatus }
    | { readonly ok: false;
      readonly reason: 'conflict' | 'state' | 'self_approval' | 'no_items' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{
        status: PayoutRunStatus; version: number; preparerProfileId: string;
      }>(
        // The preparer's PROFILE, not their membership. Comparing memberships was a real
        // hole: one human holding both an admin and a super_admin membership would present
        // two different membership ids and approve their own batch, which is precisely the
        // control this check exists to provide.
        `SELECT r.status, r.version, m.profile_id AS "preparerProfileId"
           FROM payout_runs r
           JOIN organization_memberships m ON m.membership_id = r.prepared_by_membership_id
          WHERE r.payout_run_id = $1 FOR UPDATE OF r`,
        [input.payoutRunId],
      );
      const current = locked.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'state' as const };
      if (current.version !== input.expectedVersion) {
        return { ok: false as const, reason: 'conflict' as const };
      }
      if (!payoutRunTransitionAllowed(current.status, input.next)) {
        return { ok: false as const, reason: 'state' as const };
      }
      const approving = input.next === 'approved';
      if (approving) {
        // PERSONAL separation of duties, not merely role separation. The permissions are
        // already disjoint by role, but one person holding both memberships would
        // otherwise approve their own batch.
        if (current.preparerProfileId === input.actorProfileId) {
          return { ok: false as const, reason: 'self_approval' as const };
        }
        const items = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM payout_items WHERE payout_run_id = $1',
          [input.payoutRunId],
        );
        // Approving an empty batch would create an authorisation with nothing under it,
        // which later item additions could silently fill.
        if (items.rows[0]?.count === '0') {
          return { ok: false as const, reason: 'no_items' as const };
        }
      }
      await client.query(
        `UPDATE payout_runs
            SET status = $2::payout_run_status,
                approved_by_membership_id = CASE WHEN $3 THEN $4 ELSE approved_by_membership_id END,
                reason_code = COALESCE($5, reason_code),
                version = version + 1, updated_at = now()
          WHERE payout_run_id = $1`,
        [input.payoutRunId, input.next, approving, input.actorMembershipId, input.reasonCode],
      );
      await this.publishRun(client, input.payoutRunId, input.next, input.correlationId);
      return { ok: true as const, status: input.next };
    });
  }

  /**
   * Settle one item: post the balanced entry and mark the item paid IN ONE transaction.
   * The database refuses `paid` without a ledger entry, so these cannot drift apart.
   */
  async settlePayoutItem(input: {
    readonly payoutItemId: string;
    readonly organizationId: string;
    readonly payableAccountId: string;
    readonly cashAccountId: string;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly ledgerEntryId: string }
    | { readonly ok: false; readonly reason: 'not_found' | 'not_processing' | 'already_settled' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{
        netSen: string; status: string; runStatus: PayoutRunStatus;
      }>(
        `SELECT i.net_sen AS "netSen", i.status, r.status AS "runStatus"
           FROM payout_items i JOIN payout_runs r ON r.payout_run_id = i.payout_run_id
          WHERE i.payout_item_id = $1 FOR UPDATE OF i`,
        [input.payoutItemId],
      );
      const item = locked.rows[0];
      if (item === undefined) return { ok: false as const, reason: 'not_found' as const };
      if (item.status !== 'pending') {
        return { ok: false as const, reason: 'already_settled' as const };
      }
      if (item.runStatus !== 'processing') {
        return { ok: false as const, reason: 'not_processing' as const };
      }
      const netSen = Number(item.netSen);
      const ledgerEntryId = await this.postEntry({
        organizationId: input.organizationId,
        kind: 'doctor_payout',
        referenceType: 'payout_item',
        referenceId: input.payoutItemId,
        memoCode: 'payout_settled',
        reversesEntryId: null,
        // Clearing a payable: debit the liability, credit cash.
        postings: [
          { ledgerAccountId: input.payableAccountId, amountSen: netSen },
          { ledgerAccountId: input.cashAccountId, amountSen: -netSen },
        ],
        correlationId: input.correlationId,
      }, client);
      await client.query(
        `UPDATE payout_items
            SET status = 'paid', ledger_entry_id = $2, version = version + 1, updated_at = now()
          WHERE payout_item_id = $1`,
        [input.payoutItemId, ledgerEntryId],
      );
      return { ok: true as const, ledgerEntryId };
    });
  }

  async createTicket(input: {
    readonly organizationId: string;
    readonly requesterProfileId: string;
    readonly categoryCode: string;
    readonly subjectCode: string;
    readonly priority: string;
    readonly body: string;
    readonly correlationId: string;
  }): Promise<{ readonly supportTicketId: string }> {
    return this.database.transaction(async (client) => {
      const created = await client.query<{ supportTicketId: string }>(
        `INSERT INTO support_tickets
           (organization_id, requester_profile_id, category_code, subject_code, priority,
            first_response_due_at, resolution_due_at)
         VALUES ($1,$2,$3,$4,$5::support_ticket_priority,
           now() + CASE $5::support_ticket_priority
             WHEN 'urgent' THEN interval '15 minutes' WHEN 'high' THEN interval '1 hour'
             WHEN 'medium' THEN interval '4 hours' ELSE interval '1 day' END,
           now() + CASE $5::support_ticket_priority
             WHEN 'urgent' THEN interval '4 hours' WHEN 'high' THEN interval '12 hours'
             WHEN 'medium' THEN interval '2 days' ELSE interval '5 days' END)
         RETURNING support_ticket_id AS "supportTicketId"`,
        [input.organizationId, input.requesterProfileId, input.categoryCode,
          input.subjectCode, input.priority],
      );
      const supportTicketId = created.rows[0]!.supportTicketId;
      await client.query(
        `INSERT INTO ticket_messages (support_ticket_id, author_profile_id, body, internal_only)
         VALUES ($1,$2,$3,false)`,
        [supportTicketId, input.requesterProfileId, input.body],
      );
      await client.query(
        `INSERT INTO ticket_status_events
           (support_ticket_id, actor_profile_id, from_status, to_status, reason_code)
         VALUES ($1,$2,NULL,'open','requested')`,
        [supportTicketId, input.requesterProfileId],
      );
      await this.publishTicket(client, supportTicketId, 'open', input.correlationId);
      return { supportTicketId };
    });
  }

  async findTicket(supportTicketId: string): Promise<{
    readonly supportTicketId: string; readonly organizationId: string;
    readonly requesterProfileId: string; readonly status: SupportTicketStatus;
    readonly assignedMembershipId: string | null; readonly version: number;
    readonly firstResponseDueAt: Date; readonly resolutionDueAt: Date;
    readonly firstRespondedAt: Date | null; readonly firstResponseBreached: boolean;
    readonly resolutionBreached: boolean;
  } | null> {
    const found = await this.database.query<{
      supportTicketId: string; organizationId: string; requesterProfileId: string;
      status: SupportTicketStatus; assignedMembershipId: string | null; version: number;
      firstResponseDueAt: Date; resolutionDueAt: Date; firstRespondedAt: Date | null;
      firstResponseBreached: boolean; resolutionBreached: boolean;
    }>(
      `SELECT support_ticket_id AS "supportTicketId", organization_id AS "organizationId",
              requester_profile_id AS "requesterProfileId", status,
              assigned_membership_id AS "assignedMembershipId", version,
              first_response_due_at AS "firstResponseDueAt",
              resolution_due_at AS "resolutionDueAt",
              first_responded_at AS "firstRespondedAt",
              (first_responded_at IS NULL AND now() > first_response_due_at) AS "firstResponseBreached",
              (status NOT IN ('resolved','closed') AND now() > resolution_due_at) AS "resolutionBreached"
         FROM support_tickets WHERE support_ticket_id = $1`,
      [supportTicketId],
    );
    return found.rows[0] ?? null;
  }

  /**
   * Payout runs for a period view. Newest period first, because a payouts page is a
   * ledger of what has been paid rather than a work queue.
   *
   * `itemCount` and `grossSen` are DERIVED from the items in one query rather than stored
   * on the run: this schema deliberately holds no denormalised totals, since a cached
   * total that disagrees with its items is the failure mode that makes a payout report
   * untrustworthy.
   */
  async listPayoutRuns(input: {
    readonly organizationId: string;
    readonly status: PayoutRunStatus | null;
    readonly limit: number;
  }): Promise<readonly {
    readonly payoutRunId: string; readonly periodStart: string; readonly periodEnd: string;
    readonly status: PayoutRunStatus; readonly preparedByMembershipId: string;
    readonly approvedByMembershipId: string | null; readonly reasonCode: string | null;
    readonly itemCount: number; readonly grossSen: string; readonly netSen: string;
    readonly paidCount: number; readonly version: number;
    readonly createdAt: Date; readonly updatedAt: Date;
  }[]> {
    return (await this.database.query(
      `SELECT r.payout_run_id AS "payoutRunId",
              r.period_start::text AS "periodStart", r.period_end::text AS "periodEnd",
              r.status, r.prepared_by_membership_id AS "preparedByMembershipId",
              r.approved_by_membership_id AS "approvedByMembershipId",
              r.reason_code AS "reasonCode",
              count(i.payout_item_id)::int AS "itemCount",
              coalesce(sum(i.gross_sen), 0)::text AS "grossSen",
              coalesce(sum(i.net_sen), 0)::text AS "netSen",
              count(i.payout_item_id) FILTER (WHERE i.status = 'paid')::int AS "paidCount",
              r.version, r.created_at AS "createdAt", r.updated_at AS "updatedAt"
         FROM payout_runs r
         LEFT JOIN payout_items i USING (payout_run_id)
        WHERE r.organization_id = $1
          AND ($2::text IS NULL OR r.status::text = $2::text)
        GROUP BY r.payout_run_id
        ORDER BY r.period_start DESC, r.payout_run_id DESC
        LIMIT $3`,
      [input.organizationId, input.status, input.limit],
    )).rows as never;
  }

  /**
   * Posted ledger entries, newest first.
   *
   * `amountSen` is the sum of the POSITIVE postings, which is the entry's magnitude: this
   * ledger stores signed amounts so a balanced entry sums to zero, and reporting that zero
   * as "the amount" would make every transaction look like nothing happened. The signed
   * postings themselves are not embedded, because a transactions list needs magnitude and
   * kind, not the double-entry detail.
   */
  async listLedgerEntries(input: {
    readonly organizationId: string;
    readonly kind: LedgerEntryKind | null;
    readonly limit: number;
  }): Promise<readonly {
    readonly ledgerEntryId: string; readonly kind: LedgerEntryKind;
    readonly currency: string; readonly referenceType: string; readonly referenceId: string;
    readonly memoCode: string; readonly reversesEntryId: string | null;
    readonly amountSen: string; readonly postingCount: number;
    readonly balanced: boolean; readonly postedAt: Date;
  }[]> {
    return (await this.database.query(
      `SELECT e.ledger_entry_id AS "ledgerEntryId", e.kind, e.currency,
              e.reference_type AS "referenceType", e.reference_id AS "referenceId",
              e.memo_code AS "memoCode", e.reverses_entry_id AS "reversesEntryId",
              coalesce(sum(p.amount_sen) FILTER (WHERE p.amount_sen > 0), 0)::text AS "amountSen",
              count(p.ledger_posting_id)::int AS "postingCount",
              (coalesce(sum(p.amount_sen), 0) = 0) AS "balanced",
              e.posted_at AS "postedAt"
         FROM ledger_entries e
         LEFT JOIN ledger_postings p USING (ledger_entry_id)
        WHERE e.organization_id = $1
          AND ($2::text IS NULL OR e.kind::text = $2::text)
        GROUP BY e.ledger_entry_id
        ORDER BY e.posted_at DESC, e.ledger_entry_id DESC
        LIMIT $3`,
      [input.organizationId, input.kind, input.limit],
    )).rows as never;
  }
  /**
   * The organization support QUEUE.
   *
   * Ordered by urgency rather than recency: a breached ticket first, then the soonest
   * due. A queue sorted by creation time buries the ticket that is about to miss its
   * SLA behind newer ones, which is the opposite of what the person working it needs.
   *
   * `requesterProfileId` scopes the result to one person's own tickets. Staff pass null
   * to see the whole organization. The restriction is applied in the QUERY rather than
   * filtered afterwards, so a serialization mistake cannot leak another requester's
   * ticket.
   */
  async listTickets(input: {
    readonly organizationId: string;
    readonly requesterProfileId: string | null;
    readonly status: SupportTicketStatus | null;
    readonly assignedMembershipId: string | null;
    readonly limit: number;
  }): Promise<readonly {
    readonly supportTicketId: string; readonly categoryCode: string;
    readonly subjectCode: string; readonly status: SupportTicketStatus;
    readonly priority: string; readonly requesterProfileId: string;
    readonly assignedMembershipId: string | null; readonly resolutionCode: string | null;
    readonly version: number; readonly createdAt: Date; readonly updatedAt: Date;
    readonly firstResponseDueAt: Date; readonly resolutionDueAt: Date;
    readonly firstRespondedAt: Date | null; readonly firstResponseBreached: boolean;
    readonly resolutionBreached: boolean;
  }[]> {
    return (await this.database.query(
      `SELECT support_ticket_id AS "supportTicketId", category_code AS "categoryCode",
              subject_code AS "subjectCode", status, priority,
              requester_profile_id AS "requesterProfileId",
              assigned_membership_id AS "assignedMembershipId",
              resolution_code AS "resolutionCode", version,
              created_at AS "createdAt", updated_at AS "updatedAt",
              first_response_due_at AS "firstResponseDueAt",
              resolution_due_at AS "resolutionDueAt",
              first_responded_at AS "firstRespondedAt",
              (first_responded_at IS NULL AND now() > first_response_due_at) AS "firstResponseBreached",
              (status NOT IN ('resolved','closed') AND now() > resolution_due_at) AS "resolutionBreached"
         FROM support_tickets
        WHERE organization_id = $1
          AND ($2::uuid IS NULL OR requester_profile_id = $2::uuid)
          AND ($3::text IS NULL OR status::text = $3::text)
          AND ($4::uuid IS NULL OR assigned_membership_id = $4::uuid)
        ORDER BY
          (status NOT IN ('resolved','closed') AND now() > resolution_due_at) DESC,
          (first_responded_at IS NULL AND now() > first_response_due_at) DESC,
          resolution_due_at ASC,
          support_ticket_id ASC
        LIMIT $5`,
      [
        input.organizationId,
        input.requesterProfileId,
        input.status,
        input.assignedMembershipId,
        input.limit,
      ],
    )).rows as never;
  }
  /** Messages visible to a requester exclude internal notes. */
  async ticketMessages(supportTicketId: string, includeInternal: boolean): Promise<readonly {
    readonly authorProfileId: string; readonly body: string;
    readonly internalOnly: boolean; readonly createdAt: Date;
  }[]> {
    const found = await this.database.query<{
      authorProfileId: string; body: string; internalOnly: boolean; createdAt: Date;
    }>(
      `SELECT author_profile_id AS "authorProfileId", body,
              internal_only AS "internalOnly", created_at AS "createdAt"
         FROM ticket_messages
        WHERE support_ticket_id = $1
          AND ($2 OR internal_only = false)
        ORDER BY created_at`,
      [supportTicketId, includeInternal],
    );
    return found.rows;
  }

  async addTicketMessage(input: {
    readonly supportTicketId: string;
    readonly authorProfileId: string;
    readonly body: string;
    readonly internalOnly: boolean;
    readonly staffResponse: boolean;
  }): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO ticket_messages (support_ticket_id, author_profile_id, body, internal_only)
         SELECT $1,$2,$3,$4 FROM support_tickets
          WHERE support_ticket_id = $1 AND status <> 'closed'`,
        [input.supportTicketId, input.authorProfileId, input.body, input.internalOnly],
      );
      if ((inserted.rowCount ?? 0) === 0) return false;
      if (input.staffResponse) {
        await client.query(
          `UPDATE support_tickets SET first_responded_at = COALESCE(first_responded_at, now())
            WHERE support_ticket_id = $1`,
          [input.supportTicketId],
        );
      }
      return true;
    });
  }

  async assignTicket(input: {
    readonly supportTicketId: string;
    readonly assignedMembershipId: string;
    readonly assignedByMembershipId: string;
    readonly reasonCode: string;
    readonly expectedVersion: number;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true } | { readonly ok: false;
    readonly reason: 'conflict' | 'state' | 'already_assigned' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{ status: SupportTicketStatus; version: number }>(
        'SELECT status, version FROM support_tickets WHERE support_ticket_id = $1 FOR UPDATE',
        [input.supportTicketId],
      );
      const current = locked.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'state' as const };
      if (current.version !== input.expectedVersion) {
        return { ok: false as const, reason: 'conflict' as const };
      }
      if (current.status === 'closed') return { ok: false as const, reason: 'state' as const };
      // Release the current holder first, so the one-active-assignment index expresses a
      // handover rather than refusing it.
      await client.query(
        `UPDATE ticket_assignments SET released_at = now()
          WHERE support_ticket_id = $1 AND released_at IS NULL`,
        [input.supportTicketId],
      );
      await client.query(
        `INSERT INTO ticket_assignments
           (support_ticket_id, assigned_membership_id, assigned_by_membership_id, reason_code)
         VALUES ($1,$2,$3,$4)`,
        [input.supportTicketId, input.assignedMembershipId,
          input.assignedByMembershipId, input.reasonCode],
      );
      if (current.status !== 'assigned') {
        await client.query(
          `INSERT INTO ticket_status_events
             (support_ticket_id, actor_membership_id, actor_profile_id, from_status, to_status, reason_code)
           SELECT $1, $2, m.profile_id, $3::support_ticket_status, 'assigned', $4
             FROM organization_memberships m WHERE m.membership_id = $2`,
          [input.supportTicketId, input.assignedByMembershipId, current.status,
            input.reasonCode],
        );
      }
      await client.query(
        `UPDATE support_tickets
            SET status = 'assigned', assigned_membership_id = $2,
                version = version + 1, updated_at = now()
          WHERE support_ticket_id = $1`,
        [input.supportTicketId, input.assignedMembershipId],
      );
      await this.publishTicket(client, input.supportTicketId, 'assigned', input.correlationId);
      return { ok: true as const };
    });
  }

  async advanceTicket(input: {
    readonly supportTicketId: string;
    readonly next: SupportTicketStatus;
    readonly actorMembershipId: string | null;
    readonly actorProfileId: string;
    readonly reasonCode: string;
    readonly resolutionCode: string | null;
    readonly expectedVersion: number;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly status: SupportTicketStatus }
    | { readonly ok: false; readonly reason: 'conflict' | 'state' | 'resolution_required' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{ status: SupportTicketStatus; version: number }>(
        'SELECT status, version FROM support_tickets WHERE support_ticket_id = $1 FOR UPDATE',
        [input.supportTicketId],
      );
      const current = locked.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'state' as const };
      if (current.version !== input.expectedVersion) {
        return { ok: false as const, reason: 'conflict' as const };
      }
      if (!ticketTransitionAllowed(current.status, input.next)) {
        return { ok: false as const, reason: 'state' as const };
      }
      const resolving = input.next === 'resolved';
      if (resolving && input.resolutionCode === null) {
        return { ok: false as const, reason: 'resolution_required' as const };
      }
      // Computed in TypeScript so no bind parameter is reused inside a comparison, which
      // is what raises 42P08.
      const reopening = input.next === 'in_progress' && current.status === 'resolved';
      const closing = input.next === 'closed';
      await client.query(
        `UPDATE support_tickets
            SET status = $2::support_ticket_status,
                resolution_code = CASE WHEN $3 THEN $4
                                       WHEN $5 THEN NULL ELSE resolution_code END,
                resolved_at = CASE WHEN $3 THEN now()
                                   WHEN $5 THEN NULL ELSE resolved_at END,
                closed_at = CASE WHEN $6 THEN now() ELSE closed_at END,
                version = version + 1, updated_at = now()
          WHERE support_ticket_id = $1`,
        [input.supportTicketId, input.next, resolving, input.resolutionCode,
          reopening, closing],
      );
      await client.query(
        `INSERT INTO ticket_status_events
           (support_ticket_id, actor_membership_id, actor_profile_id, from_status, to_status, reason_code)
         VALUES ($1,$2,$3,$4::support_ticket_status,$5::support_ticket_status,$6)`,
        [input.supportTicketId, input.actorMembershipId, input.actorProfileId,
          current.status, input.next, input.reasonCode],
      );
      await this.publishTicket(client, input.supportTicketId, input.next, input.correlationId);
      return { ok: true as const, status: input.next };
    });
  }

  async requestExport(input: {
    readonly organizationId: string;
    readonly requestedByMembershipId: string;
    readonly requestedByProfileId: string;
    readonly datasetCode: string;
    readonly purposeCode: string;
    readonly correlationId: string;
  }): Promise<{ readonly exportJobId: string }> {
    return this.database.transaction(async (client) => {
      const created = await client.query<{ exportJobId: string }>(
        `INSERT INTO export_jobs
           (organization_id, requested_by_membership_id, requested_by_profile_id,
            dataset_code, purpose_code)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING export_job_id AS "exportJobId"`,
        [input.organizationId, input.requestedByMembershipId, input.requestedByProfileId,
          input.datasetCode, input.purposeCode],
      );
      const exportJobId = created.rows[0]!.exportJobId;
      await client.query(
        `INSERT INTO outbox_events
           (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
            payload,correlation_id,occurred_at)
         VALUES (uuidv7(),$1,$2,'export_job',$3,0,$4::jsonb,$5,now())`,
        [EXPORT_JOB_CHANGED_EVENT_TYPE, EXPORT_JOB_CHANGED_EVENT_VERSION,
          exportJobId, JSON.stringify({
            export_job_id: exportJobId, status: 'queued', dataset_code: input.datasetCode,
          }), input.correlationId],
      );
      return { exportJobId };
    });
  }

  async findExport(exportJobId: string): Promise<{
    readonly exportJobId: string; readonly organizationId: string;
    readonly status: string; readonly requestedByProfileId: string;
    readonly rowCount: number | null; readonly downloadable: boolean;
  } | null> {
    const found = await this.database.query<{
      exportJobId: string; organizationId: string; status: string;
      requestedByProfileId: string; rowCount: string | null; downloadable: boolean;
    }>(
      `SELECT j.export_job_id AS "exportJobId", j.organization_id AS "organizationId",
              j.status::text AS status, j.requested_by_profile_id AS "requestedByProfileId",
              j.row_count AS "rowCount",
              -- Downloadable only while a file exists AND has not expired. Expiry is part
              -- of the query so a caller cannot forget to compare it.
              (f.export_file_id IS NOT NULL AND f.expires_at > now()
                AND j.status = 'completed') AS downloadable
         FROM export_jobs j
         LEFT JOIN export_files f ON f.export_job_id = j.export_job_id
        WHERE j.export_job_id = $1`,
      [exportJobId],
    );
    const record = found.rows[0];
    if (record === undefined) return null;
    return { ...record, rowCount: record.rowCount === null ? null : Number(record.rowCount) };
  }

  async settings(organizationId: string): Promise<readonly {
    readonly settingKey: string; readonly value: unknown; readonly version: number;
  }[]> {
    const found = await this.database.query<{
      settingKey: string; value: unknown; version: number;
    }>(
      `SELECT setting_key AS "settingKey", value, version
         FROM organization_settings WHERE organization_id = $1 ORDER BY setting_key`,
      [organizationId],
    );
    return found.rows;
  }

  async updateSetting(input: {
    readonly organizationId: string;
    readonly settingKey: string;
    readonly value: unknown;
    readonly updatedByMembershipId: string;
    readonly expectedVersion: number;
  }): Promise<{ readonly ok: true; readonly version: number }
    | { readonly ok: false; readonly reason: 'conflict' }> {
    // Upsert guarded by version: a first write expects 0, and a later write must match.
    const updated = await this.database.query<{ version: number }>(
      `INSERT INTO organization_settings
         (organization_id, setting_key, value, updated_by_membership_id, version)
       VALUES ($1,$2,$3::jsonb,$4,1)
       ON CONFLICT (organization_id, setting_key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by_membership_id = EXCLUDED.updated_by_membership_id,
             version = organization_settings.version + 1,
             updated_at = now()
         WHERE organization_settings.version = $5
       RETURNING version`,
      [input.organizationId, input.settingKey, JSON.stringify(input.value),
        input.updatedByMembershipId, input.expectedVersion],
    );
    const record = updated.rows[0];
    if (record === undefined) return { ok: false, reason: 'conflict' };
    return { ok: true, version: record.version };
  }

  private async publishRun(
    client: PoolClient, payoutRunId: string, status: PayoutRunStatus, correlationId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events
         (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
          payload,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,'payout_run',$3,0,$4::jsonb,$5,now())`,
      [PAYOUT_RUN_CHANGED_EVENT_TYPE, PAYOUT_RUN_CHANGED_EVENT_VERSION,
        payoutRunId, JSON.stringify({ payout_run_id: payoutRunId, status }), correlationId],
    );
  }

  private async publishTicket(
    client: PoolClient, supportTicketId: string, status: SupportTicketStatus,
    correlationId: string,
  ): Promise<void> {
    // No subject text, no body, no requester identity: a ticket can contain anything a
    // user typed, so only the identifier and state travel.
    await client.query(
      `INSERT INTO outbox_events
         (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
          payload,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,'support_ticket',$3,0,$4::jsonb,$5,now())`,
      [SUPPORT_TICKET_CHANGED_EVENT_TYPE, SUPPORT_TICKET_CHANGED_EVENT_VERSION,
        supportTicketId, JSON.stringify({ support_ticket_id: supportTicketId, status }),
        correlationId],
    );
  }
}
