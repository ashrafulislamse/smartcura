import { Injectable } from '@nestjs/common';
import {
  FinanceRepository,
  type LedgerEntryKind,
  type PayoutRunStatus,
  type SupportTicketStatus,
} from '@smartcura/database/finance';
import type { ZodType } from 'zod';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  addPayoutItemSchema,
  addTicketMessageSchema,
  advancePayoutRunSchema,
  advanceTicketSchema,
  assignTicketSchema,
  createPayoutRunSchema,
  createTicketSchema,
  requestExportSchema,
  reverseEntrySchema,
  settlePayoutItemSchema,
  updateSettingSchema,
  listLedgerEntriesSchema,
  listPayoutRunsSchema,
  listTicketsSchema,
} from './finance-request.schemas.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SETTING_KEY = /^[a-z][a-z0-9_.]{1,62}$/;

@Injectable()
export class FinanceService {
  constructor(private readonly finance: FinanceRepository) {}

  /** Projected account balances. Read-only: nothing here can move money. */
  async ledger(current: AuthenticatedSession) {
    const active = this.administrative(current, 'ledger:read:organization');
    const balances = await this.finance.accountBalances(active.organizationId);
    return {
      organization_id: active.organizationId,
      currency: 'MYR',
      data: balances.map((account) => ({
        ledger_account_id: account.ledgerAccountId,
        account_code: account.accountCode,
        kind: account.kind,
        normal_side: account.normalSide,
        // Signed, projected over postings. No stored balance exists to disagree.
        balance_sen: account.balanceSen,
      })),
    };
  }

  /** Corrections are new opposing entries; the original is never edited. */
  async reverseEntry(current: AuthenticatedSession, entryIdValue: string, value: unknown) {
    const entryId = id(entryIdValue);
    const request = parse(reverseEntrySchema, value);
    const active = this.administrative(current, 'ledger:read:organization');
    this.requireStepUp(current);
    const result = await this.finance.reverseEntry({
      organizationId: active.organizationId,
      reversesEntryId: entryId,
      memoCode: request.memo_code,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      if (result.reason === 'already_reversed') {
        throw problem(409, 'LEDGER_ALREADY_REVERSED', 'The entry is already reversed');
      }
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Entry was not found');
    }
    return { ledger_entry_id: result.ledgerEntryId, reverses_entry_id: entryId };
  }

  async createPayoutRun(current: AuthenticatedSession, value: unknown) {
    const request = parse(createPayoutRunSchema, value);
    const active = this.administrative(current, 'payout_run:manage:organization');
    const result = await this.finance.createPayoutRun({
      organizationId: active.organizationId,
      periodStart: request.period_start,
      periodEnd: request.period_end,
      preparedByMembershipId: active.membershipId,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      throw problem(409, 'PAYOUT_PERIOD_ALREADY_OPEN', 'An open run exists for that period');
    }
    return { payout_run_id: result.payoutRunId, status: 'draft' };
  }

  async addPayoutItem(current: AuthenticatedSession, runIdValue: string, value: unknown) {
    const runId = id(runIdValue);
    const request = parse(addPayoutItemSchema, value);
    const active = this.administrative(current, 'payout_run:manage:organization');
    const run = await this.finance.findPayoutRun(runId);
    if (run === null || run.organizationId !== active.organizationId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Run was not found');
    }
    const payee = await this.finance.payeeProfileForMembership(
      request.payee_membership_id, active.organizationId,
    );
    // The payee must belong to this organization. Without the check a run could pay a
    // membership from elsewhere, which no later approval would notice.
    if (payee === null) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Payee was not found');
    }
    const result = await this.finance.addPayoutItem({
      payoutRunId: runId,
      payeeMembershipId: request.payee_membership_id,
      payeeProfileId: payee,
      grossSen: request.gross_sen,
      platformFeeSen: request.platform_fee_sen,
    });
    if (!result.ok) {
      if (result.reason === 'duplicate_payee') {
        throw problem(409, 'PAYOUT_PAYEE_ALREADY_LISTED', 'The payee is already in this run');
      }
      throw problem(409, 'PAYOUT_RUN_FROZEN', 'The run is approved and its amounts are frozen');
    }
    return {
      payout_item_id: result.payoutItemId,
      // Derived by the database from gross minus fee.
      net_sen: result.netSen,
      status: 'pending',
    };
  }

  /**
   * Approval requires the `payout_run:approve:org` permission, which is seeded only to
   * `super_admin` and is disjoint from the preparer's permission by a migration assertion.
   * The repository additionally refuses approval by the SAME membership that prepared it.
   */
  async advancePayoutRun(current: AuthenticatedSession, runIdValue: string, value: unknown) {
    const runId = id(runIdValue);
    const request = parse(advancePayoutRunSchema, value);
    const permission = request.status === 'approved'
      ? 'payout_run:approve:organization' : 'payout_run:manage:organization';
    const active = this.administrative(current, permission);
    const run = await this.finance.findPayoutRun(runId);
    if (run === null || run.organizationId !== active.organizationId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Run was not found');
    }
    if (request.status === 'approved') this.requireStepUp(current);
    const result = await this.finance.advancePayoutRun({
      payoutRunId: runId,
      next: request.status,
      actorMembershipId: active.membershipId,
      actorProfileId: current.aggregate.profile.profileId,
      reasonCode: request.reason_code,
      expectedVersion: request.expected_version,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      if (result.reason === 'conflict') {
        throw problem(409, 'PAYOUT_VERSION_CONFLICT', 'The run changed');
      }
      if (result.reason === 'self_approval') {
        throw problem(403, 'PAYOUT_SELF_APPROVAL', 'A run cannot be approved by its preparer');
      }
      if (result.reason === 'no_items') {
        throw problem(409, 'PAYOUT_RUN_EMPTY', 'An empty run cannot be approved');
      }
      throw problem(409, 'PAYOUT_TRANSITION_INVALID', 'The transition is not allowed');
    }
    return { payout_run_id: runId, status: result.status };
  }

  async settlePayoutItem(current: AuthenticatedSession, itemIdValue: string, value: unknown) {
    const itemId = id(itemIdValue);
    const request = parse(settlePayoutItemSchema, value);
    const active = this.administrative(current, 'payout_run:manage:organization');
    const result = await this.finance.settlePayoutItem({
      payoutItemId: itemId,
      organizationId: active.organizationId,
      payableAccountId: request.payable_account_id,
      cashAccountId: request.cash_account_id,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      if (result.reason === 'already_settled') {
        throw problem(409, 'PAYOUT_ITEM_ALREADY_SETTLED', 'The item is already settled');
      }
      if (result.reason === 'not_processing') {
        throw problem(409, 'PAYOUT_RUN_NOT_PROCESSING', 'The run is not processing');
      }
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Item was not found');
    }
    return { payout_item_id: itemId, status: 'paid', ledger_entry_id: result.ledgerEntryId };
  }

  /** Anyone authenticated may raise a ticket about their own experience. */
  async createTicket(current: AuthenticatedSession, value: unknown) {
    const request = parse(createTicketSchema, value);
    const active = this.active(current);
    if (active.organizationId !== request.organization_id) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Organization was not found');
    }
    const created = await this.finance.createTicket({
      organizationId: request.organization_id,
      requesterProfileId: current.aggregate.profile.profileId,
      categoryCode: request.category_code,
      subjectCode: request.subject_code,
      priority: request.priority,
      body: request.body,
      correlationId: correlationId(),
    });
    return { support_ticket_id: created.supportTicketId, status: 'open' };
  }

  /**
   * The support queue. Staff holding `support.ticket:manage:org` see the whole
   * organization; anyone else sees only the tickets they raised, enforced by scoping the
   * query rather than by filtering the result.
   *
   * Summaries deliberately carry no message bodies. A ticket body is whatever a user
   * typed, so a list endpoint that embedded it would widen exposure for no benefit and
   * make the response unbounded.
   */
  /**
   * Payout runs.
   *
   * Requires payroll authority rather than `ledger:read:org`, because a run names its
   * payees — reading the list is payroll access, not general ledger access.
   *
   * BUT EITHER SIDE OF THE SEPARATION OF DUTIES QUALIFIES. `payout_run:manage:org` is
   * granted to `admin` and `payout_run:approve:org` to `super_admin`, and a migration
   * fails if one role holds both. Gating the LIST on manage alone locked the APPROVER out
   * of the queue entirely: they could not find a run to approve. Separation of duties is
   * about who may prepare versus who may authorise, not about hiding the work from the
   * person expected to authorise it. Reading is neither preparing nor approving.
   */
  async listPayoutRuns(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listPayoutRunsSchema, queryValue);
    const active = this.eitherPayoutAuthority(current);
    const rows = await this.finance.listPayoutRuns({
      organizationId: active.organizationId,
      status: (query.status ?? null) as PayoutRunStatus | null,
      limit: query.limit,
    });
    return {
      currency: 'MYR',
      data: rows.map((row) => ({
        payout_run_id: row.payoutRunId,
        period_start: row.periodStart,
        period_end: row.periodEnd,
        status: row.status,
        prepared_by_membership_id: row.preparedByMembershipId,
        approved_by_membership_id: row.approvedByMembershipId,
        reason_code: row.reasonCode,
        item_count: row.itemCount,
        paid_count: row.paidCount,
        // Derived from the items, never a stored total: a cached total that disagrees with
        // its items is what makes a payout report untrustworthy.
        gross_sen: Number(row.grossSen),
        net_sen: Number(row.netSen),
        version: row.version,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      })),
    };
  }

  /** Posted ledger entries. General ledger read, so `ledger:read:org`. */
  async listLedgerEntries(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listLedgerEntriesSchema, queryValue);
    const active = this.administrative(current, 'ledger:read:organization');
    const rows = await this.finance.listLedgerEntries({
      organizationId: active.organizationId,
      kind: (query.kind ?? null) as LedgerEntryKind | null,
      limit: query.limit,
    });
    return {
      currency: 'MYR',
      data: rows.map((row) => ({
        ledger_entry_id: row.ledgerEntryId,
        kind: row.kind,
        reference_type: row.referenceType,
        reference_id: row.referenceId,
        memo_code: row.memoCode,
        reverses_entry_id: row.reversesEntryId,
        // The magnitude, being the sum of the POSITIVE postings. Reporting the signed sum
        // would report zero for every balanced entry, which is every entry.
        amount_sen: Number(row.amountSen),
        posting_count: row.postingCount,
        // Surfaced rather than assumed: an unbalanced entry cannot exist by constraint, so
        // a false here would mean the invariant had been defeated and must be visible.
        balanced: row.balanced,
        posted_at: row.postedAt.toISOString(),
      })),
    };
  }
  async listTickets(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listTicketsSchema, queryValue);
    const active = this.active(current);
    const isStaff = active.permissions.includes('support.ticket:manage:organization');
    const rows = await this.finance.listTickets({
      organizationId: active.organizationId,
      requesterProfileId: isStaff ? null : current.aggregate.profile.profileId,
      status: (query.status ?? null) as SupportTicketStatus | null,
      assignedMembershipId: query.assigned_membership_id ?? null,
      limit: query.limit,
    });
    return {
      data: rows.map((row) => ({
        support_ticket_id: row.supportTicketId,
        category_code: row.categoryCode,
        subject_code: row.subjectCode,
        status: row.status,
        priority: row.priority,
        requester_profile_id: row.requesterProfileId,
        assigned_membership_id: row.assignedMembershipId,
        resolution_code: row.resolutionCode,
        version: row.version,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        sla: {
          first_response_due_at: row.firstResponseDueAt.toISOString(),
          resolution_due_at: row.resolutionDueAt.toISOString(),
          first_responded_at: row.firstRespondedAt?.toISOString() ?? null,
          first_response_breached: row.firstResponseBreached,
          resolution_breached: row.resolutionBreached,
        },
      })),
    };
  }
  async readTicket(current: AuthenticatedSession, ticketIdValue: string) {
    const ticketId = id(ticketIdValue);
    const { ticket, isStaff } = await this.ticketAccess(current, ticketId);
    const messages = await this.finance.ticketMessages(ticketId, isStaff);
    return {
      support_ticket_id: ticket.supportTicketId,
      status: ticket.status,
      version: ticket.version,
      sla: {
        first_response_due_at: ticket.firstResponseDueAt.toISOString(),
        resolution_due_at: ticket.resolutionDueAt.toISOString(),
        first_responded_at: ticket.firstRespondedAt?.toISOString() ?? null,
        first_response_breached: ticket.firstResponseBreached,
        resolution_breached: ticket.resolutionBreached,
      },
      // Internal notes are excluded for the requester by the QUERY, not filtered
      // afterwards, so a serialization mistake cannot leak them.
      messages: messages.map((message) => ({
        author_profile_id: message.authorProfileId,
        body: message.body,
        internal_only: message.internalOnly,
        created_at: message.createdAt.toISOString(),
      })),
    };
  }

  async addTicketMessage(current: AuthenticatedSession, ticketIdValue: string, value: unknown) {
    const ticketId = id(ticketIdValue);
    const request = parse(addTicketMessageSchema, value);
    const { isStaff } = await this.ticketAccess(current, ticketId);
    // A requester marking their own message internal would hide it from the people meant
    // to read it, so the flag is refused rather than silently ignored.
    if (request.internal_only && !isStaff) {
      throw problem(403, 'PERMISSION_DENIED', 'Only support staff may add an internal note');
    }
    const added = await this.finance.addTicketMessage({
      supportTicketId: ticketId,
      authorProfileId: current.aggregate.profile.profileId,
      body: request.body,
      internalOnly: request.internal_only,
      staffResponse: isStaff && !request.internal_only,
    });
    if (!added) throw problem(409, 'SUPPORT_TICKET_CLOSED', 'The ticket is closed');
    return { support_ticket_id: ticketId, recorded: true };
  }

  async assignTicket(current: AuthenticatedSession, ticketIdValue: string, value: unknown) {
    const ticketId = id(ticketIdValue);
    const request = parse(assignTicketSchema, value);
    const active = this.administrative(current, 'support.ticket:manage:organization');
    const ticket = await this.finance.findTicket(ticketId);
    if (ticket === null || ticket.organizationId !== active.organizationId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Ticket was not found');
    }
    const result = await this.finance.assignTicket({
      supportTicketId: ticketId,
      assignedMembershipId: request.assigned_membership_id,
      assignedByMembershipId: active.membershipId,
      reasonCode: request.reason_code,
      expectedVersion: request.expected_version,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      if (result.reason === 'conflict') {
        throw problem(409, 'SUPPORT_VERSION_CONFLICT', 'The ticket changed');
      }
      throw problem(409, 'SUPPORT_TRANSITION_INVALID', 'The ticket cannot be assigned');
    }
    return { support_ticket_id: ticketId, status: 'assigned' };
  }

  async advanceTicket(current: AuthenticatedSession, ticketIdValue: string, value: unknown) {
    const ticketId = id(ticketIdValue);
    const request = parse(advanceTicketSchema, value);
    const active = this.administrative(current, 'support.ticket:manage:organization');
    const ticket = await this.finance.findTicket(ticketId);
    if (ticket === null || ticket.organizationId !== active.organizationId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Ticket was not found');
    }
    const result = await this.finance.advanceTicket({
      supportTicketId: ticketId,
      next: request.status,
      actorMembershipId: active.membershipId,
      actorProfileId: current.aggregate.profile.profileId,
      reasonCode: request.reason_code,
      resolutionCode: request.resolution_code,
      expectedVersion: request.expected_version,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      if (result.reason === 'conflict') {
        throw problem(409, 'SUPPORT_VERSION_CONFLICT', 'The ticket changed');
      }
      if (result.reason === 'resolution_required') {
        throw problem(422, 'VALIDATION_FAILED', 'Resolving requires a resolution code');
      }
      throw problem(409, 'SUPPORT_TRANSITION_INVALID', 'The transition is not allowed');
    }
    return { support_ticket_id: ticketId, status: result.status };
  }

  async requestExport(current: AuthenticatedSession, value: unknown) {
    const request = parse(requestExportSchema, value);
    const active = this.administrative(current, 'export_job:manage:organization');
    this.requireStepUp(current);
    const created = await this.finance.requestExport({
      organizationId: active.organizationId,
      requestedByMembershipId: active.membershipId,
      requestedByProfileId: current.aggregate.profile.profileId,
      datasetCode: request.dataset_code,
      purposeCode: request.purpose_code,
      correlationId: correlationId(),
    });
    return { export_job_id: created.exportJobId, status: 'queued' };
  }

  async readExport(current: AuthenticatedSession, jobIdValue: string) {
    const jobId = id(jobIdValue);
    const active = this.administrative(current, 'export_job:manage:organization');
    const job = await this.finance.findExport(jobId);
    if (job === null || job.organizationId !== active.organizationId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Export was not found');
    }
    return {
      export_job_id: job.exportJobId,
      status: job.status,
      row_count: job.rowCount,
      // False once the file has expired, computed in the query rather than compared here.
      downloadable: job.downloadable,
    };
  }

  async settings(current: AuthenticatedSession) {
    const active = this.administrative(current, 'organization.setting:manage:organization');
    const settings = await this.finance.settings(active.organizationId);
    return {
      organization_id: active.organizationId,
      data: settings.map((setting) => ({
        setting_key: setting.settingKey,
        value: setting.value,
        version: setting.version,
      })),
    };
  }

  async updateSetting(current: AuthenticatedSession, keyValue: string, value: unknown) {
    if (!SETTING_KEY.test(keyValue)) throw validationFailed();
    const request = parse(updateSettingSchema, value);
    const active = this.administrative(current, 'organization.setting:manage:organization');
    const result = await this.finance.updateSetting({
      organizationId: active.organizationId,
      settingKey: keyValue,
      value: request.value,
      updatedByMembershipId: active.membershipId,
      expectedVersion: request.expected_version,
    });
    if (!result.ok) {
      throw problem(409, 'SETTING_VERSION_CONFLICT', 'The setting changed');
    }
    return { setting_key: keyValue, version: result.version };
  }

  /**
   * A requester sees their own ticket; support staff see their organization's. The
   * distinction also decides whether internal notes are read at all.
   */
  private async ticketAccess(current: AuthenticatedSession, supportTicketId: string) {
    const active = this.active(current);
    const ticket = await this.finance.findTicket(supportTicketId);
    if (ticket === null) throw problem(404, 'RESOURCE_NOT_FOUND', 'Ticket was not found');
    const isStaff = active.permissions.includes('support.ticket:manage:organization')
      && active.organizationId === ticket.organizationId;
    const isRequester = ticket.requesterProfileId === current.aggregate.profile.profileId;
    // Concealed rather than refused: confirming a ticket exists is itself a disclosure.
    if (!isStaff && !isRequester) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Ticket was not found');
    }
    return { ticket, isStaff, membershipId: active.membershipId };
  }

  private active(current: AuthenticatedSession) {
    const active = current.aggregate.memberships.find(
      (entry) => entry.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined || active.status !== 'active') {
      throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    if (current.aggregate.profile.status !== 'active' ||
        current.aggregate.profile.onboardingCompletedAt === null) {
      throw problem(403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete');
    }
    return active;
  }

  /**
   * Organization-scoped administrative authority. `PermissionGuard` cannot evaluate `org`
   * scope because it holds no object context, so the permission and the organization
   * relationship are both proved here.
   */
  /**
   * Payroll authority of EITHER kind, for READS only.
   *
   * Not a general `administrative` call: a caller holding neither payout permission is
   * still refused. Mutations continue to demand the specific authority, so the separation
   * of duties between preparing and approving is untouched.
   */
  private eitherPayoutAuthority(current: AuthenticatedSession) {
    try {
      return this.administrative(current, 'payout_run:manage:organization');
    } catch {
      return this.administrative(current, 'payout_run:approve:organization');
    }
  }
  private administrative(current: AuthenticatedSession, permission: string) {
    const active = this.active(current);
    if (!active.permissions.includes(permission)) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    return active;
  }

  private requireStepUp(current: AuthenticatedSession) {
    const validUntil = current.aggregate.session.stepUpValidUntil ?? null;
    if (validUntil === null || validUntil.getTime() <= Date.now()) {
      throw problem(403, 'STEP_UP_REQUIRED', 'Recent step-up authentication is required');
    }
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function id(value: string): string {
  if (!UUID_V7.test(value)) throw validationFailed();
  return value;
}
