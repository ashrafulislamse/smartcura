import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AvailabilityRepository,
  AvailabilityScheduleRepository,
  serializeAvailabilityException,
  serializeAvailabilityRule,
  serializeAvailabilitySlot,
  serializeSlotGeneration,
  type AvailabilitySlotRecord,
  type GenerateAvailabilitySlotsResult,
  type RecordAvailabilityExceptionResult,
  type ReplaceAvailabilityRulesResult,
  type SchedulingActorContext,
} from '@smartcura/database/appointments';
import { evaluatePermission } from '@smartcura/policy';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  generateAvailabilitySlotsSchema,
  listOwnAvailabilitySlotsQuerySchema,
  membershipPathSchema,
  organizationPathSchema,
  recordAvailabilityExceptionSchema,
  replaceAvailabilityRulesSchema,
  searchAppointmentSlotsQuerySchema,
  slotPathSchema,
  idempotencyKeySchema,
  type ListOwnAvailabilitySlotsQuery,
  type SearchAppointmentSlotsQuery,
} from './appointment-request.schemas.js';

/** Replay window for an availability generation `Idempotency-Key`. */
const IDEMPOTENCY_TTL_MS = 86_400_000;

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly availability: AvailabilityRepository,
    private readonly schedule: AvailabilityScheduleRepository,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  /**
   * The acting doctor's own published rule set, with the revision to quote back
   * as `expected_version` on a replacement. Authorized as an own-scoped write
   * authority rather than a read authority: a rule set is the doctor's working
   * pattern together with the concurrency token that lets it be rewritten, and
   * `availability:read:global` publishes slots, not the rules behind them.
   */
  async listRules(
    current: AuthenticatedSession,
    membershipIdValue: string,
  ): Promise<Record<string, unknown>> {
    const membershipId = parseMembershipPath(membershipIdValue);
    await this.authorizeOwnWrite(current, membershipId, 'availability.rules.read');
    const view = await this.schedule.findRuleSet(membershipId);
    return {
      data: view.rules.map(serializeAvailabilityRule),
      version: view.version,
    };
  }

  /**
   * Replaces the acting doctor's own weekly rule set and regenerates the slot
   * horizon. The membership in the path must be the acting membership: a doctor
   * publishes their own availability and nobody else's, which is why the seeded
   * permission is `own` scoped and there is no organization-scoped counterpart.
   */
  async replaceRules(
    current: AuthenticatedSession,
    membershipIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const membershipId = parseMembershipPath(membershipIdValue);
    const request = parseReplaceRules(bodyValue);
    const authorized = await this.authorizeOwnWrite(current, membershipId, 'availability.rules.replace');
    const result = await this.availability.replaceRules({
      membershipId,
      actor: writeActor(authorized, membershipId),
      rules: request.rules.map((rule) => ({
        weekday: rule.weekday,
        startTime: rule.start_time,
        endTime: rule.end_time,
        slotDurationMinutes: rule.slot_duration_minutes,
        timezone: rule.timezone,
        effectiveFrom: rule.effective_from,
        effectiveTo: rule.effective_to,
      })),
      expectedVersion: request.expected_version,
      generationHorizonDays: request.horizon_days,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') {
      return {
        data: result.rules.map(serializeAvailabilityRule),
        version: result.version,
        generated_slot_count: result.generatedSlotCount,
      };
    }
    return this.ruleFailure(authorized, membershipId, result);
  }

  /**
   * Records a per-date exception. Slots the exception invalidates are closed, and
   * a replacement window regenerates the day. Booked capacity is never withdrawn
   * silently; the doctor must cancel those appointments explicitly.
   */
  async recordException(
    current: AuthenticatedSession,
    membershipIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const membershipId = parseMembershipPath(membershipIdValue);
    const request = parseRecordException(bodyValue);
    const authorized = await this.authorizeOwnWrite(
      current, membershipId, 'availability.exception.record',
    );
    const result = await this.availability.recordException({
      membershipId,
      actor: writeActor(authorized, membershipId),
      exceptionDate: request.exception_date,
      isUnavailable: request.is_unavailable,
      replacementStartTime: request.replacement_start_time,
      replacementEndTime: request.replacement_end_time,
      reasonCode: request.reason_code,
      expectedVersion: request.expected_version,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') {
      return {
        data: serializeAvailabilityException(result.exception),
        closed_slot_count: result.closedSlotCount,
        generated_slot_count: result.generatedSlotCount,
      };
    }
    return this.exceptionFailure(authorized, membershipId, result);
  }

  /**
   * Regenerates the acting doctor's own slots over a stated date range.
   *
   * The same `availability:write:own` authority as rule replacement, because it
   * publishes the same capacity by the same rules; only the window differs.
   * `Idempotency-Key` is mandatory and passed straight through: generation is
   * already idempotent in the database, so a retry would legitimately report
   * zero new slots, and replaying the stored count is the only way the caller
   * can tell a retry from a generation that produced nothing.
   */
  async generateSlots(
    current: AuthenticatedSession,
    membershipIdValue: string,
    idempotencyKeyValue: string | undefined,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const membershipId = parseMembershipPath(membershipIdValue);
    const idempotencyKey = parseIdempotencyKey(idempotencyKeyValue);
    const request = parseGenerateSlots(bodyValue);
    const authorized = await this.authorizeOwnWrite(
      current, membershipId, 'availability.slots.generate',
    );
    const result = await this.schedule.generateSlots({
      membershipId,
      actor: writeActor(authorized, membershipId),
      fromDate: request.from_date,
      toDate: request.to_date,
      idempotencyKey,
      requestHash: requestHash({
        membership_id: membershipId,
        from_date: request.from_date,
        to_date: request.to_date,
      }),
      idempotencyTtlMs: IDEMPOTENCY_TTL_MS,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') {
      return result.replayed ? result.snapshot.body : serializeSlotGeneration(result.result);
    }
    return this.generationFailure(authorized, membershipId, result);
  }

  /**
   * Bookable slot search across an organization, optionally narrowed to one
   * doctor, cursor-paginated deterministically on `(starts_at, slot_id)` in the
   * same shape membership listing uses.
   *
   * `availability:read:global` is granted broadly because published capacity is
   * not confidential: it is the schedule a patient must see to book at all. No
   * patient identity, hold owner or appointment detail is returned here.
   */
  async searchSlots(
    current: AuthenticatedSession,
    organizationIdValue: string,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parseOrganizationPath(organizationIdValue);
    const query = parseSearchSlots(queryValue);
    await this.authorizeRead(current, organizationId);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const records = await this.schedule.searchOpenSlots({
      organizationId,
      ...(query.membership_id === undefined ? {} : { membershipId: query.membership_id }),
      from: new Date(query.from),
      to: new Date(query.to),
      ...(cursor === undefined ? {} : {
        afterStartsAt: cursor.startsAt,
        afterSlotId: cursor.slotId,
      }),
      limit: query.page_size + 1,
      now: new Date(),
    });
    const hasMore = records.length > query.page_size;
    const page = hasMore ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return {
      data: page.map(serializeAvailabilitySlot),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeCursor(last) : null,
      },
    };
  }

  /**
   * The acting doctor's own already-generated slots over a stated date range,
   * cursor-paginated on `(starts_at, slot_id)` in the same shape the organization
   * search uses.
   *
   * `availability:read:own` rather than `availability:read:global` because this
   * is the doctor's own schedule: every slot state — `open`, `held`, `booked`,
   * `closed` — is returned, not just the `open` capacity a booker sees. A held
   * slot is visible with its true state so the doctor knows a booking is in
   * flight, and a booked slot is visible so the doctor sees the day as it
   * actually is. The membership in the path must be the acting membership; a
   * mismatch is concealed as a 404, exactly as the write path does.
   */
  async listOwnSlots(
    current: AuthenticatedSession,
    membershipIdValue: string,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const membershipId = parseMembershipPath(membershipIdValue);
    const query = parseOwnSlots(queryValue);
    await this.authorizeOwnRead(current, membershipId, 'availability.slots.read');
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const records = await this.schedule.listOwnSlots({
      membershipId,
      from: new Date(query.from),
      to: new Date(query.to),
      ...(cursor === undefined ? {} : {
        afterStartsAt: cursor.startsAt,
        afterSlotId: cursor.slotId,
      }),
      limit: query.page_size + 1,
      now: new Date(),
    });
    const hasMore = records.length > query.page_size;
    const page = hasMore ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return {
      data: page.map(serializeAvailabilitySlot),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeCursor(last) : null,
      },
    };
  }

  /**
   * Fast rejection before the write. The repository re-proves all of this under
   * lock in the mutation transaction, because between this check and the write the
   * session can be revoked or the membership suspended.
   */
  private async authorizeOwnWrite(
    current: AuthenticatedSession,
    membershipId: string,
    action: string,
  ): Promise<AuthenticatedSession> {
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, membershipId, action, 403, 'PERMISSION_DENIED',
        'Profile onboarding is incomplete',
      );
    }
    const active = activeMembership(current);
    if (active === undefined || active.membershipId !== membershipId) {
      // Concealed as not found: whether another doctor's membership exists is not
      // something an unrelated actor may probe.
      return this.deny(
        current, membershipId, action, 404, 'RESOURCE_NOT_FOUND',
        'Membership was not found',
      );
    }
    const decision = evaluatePermission(active.permissions, 'availability:write:own', {
      actorProfileId: current.aggregate.profile.profileId,
      ownerProfileId: current.aggregate.profile.profileId,
    });
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      return this.deny(
        current, membershipId, action, 403, code, 'Availability management is not permitted',
      );
    }
    return this.authorization.touch(current);
  }

  /**
   * Own-schedule read authorization. Structurally identical to
   * `authorizeOwnWrite` — profile active, onboarding complete, the path
   * membership is the acting membership — but the grant is
   * `availability:read:own` rather than `availability:write:own`, so a doctor
   * who can read their schedule but not change it is still admitted. The
   * mismatch is concealed as a 404 for the same reason the write path conceals
   * it: whether another doctor's membership exists is not something an
   * unrelated actor may probe.
   */
  private async authorizeOwnRead(
    current: AuthenticatedSession,
    membershipId: string,
    action: string,
  ): Promise<AuthenticatedSession> {
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, membershipId, action, 403, 'PERMISSION_DENIED',
        'Profile onboarding is incomplete',
      );
    }
    const active = activeMembership(current);
    if (active === undefined || active.membershipId !== membershipId) {
      return this.deny(
        current, membershipId, action, 404, 'RESOURCE_NOT_FOUND',
        'Membership was not found',
      );
    }
    const decision = evaluatePermission(active.permissions, 'availability:read:own', {
      actorProfileId: current.aggregate.profile.profileId,
      ownerProfileId: current.aggregate.profile.profileId,
    });
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      return this.deny(
        current, membershipId, action, 403, code, 'Availability is not readable',
      );
    }
    return this.authorization.touch(current);
  }

  /**
   * Slot search authorization. The audited object is the ORGANIZATION searched,
   * not a membership, so a refused search is attributable to the organization
   * whose capacity was probed.
   */
  private async authorizeRead(
    current: AuthenticatedSession,
    organizationId: string,
  ): Promise<AuthenticatedSession> {
    const active = activeMembership(current);
    if (active === undefined) {
      return this.denySearch(
        current, organizationId, 403, 'MEMBERSHIP_INACTIVE',
        'An active membership is required',
      );
    }
    const decision = evaluatePermission(active.permissions, 'availability:read:global', {
      actorProfileId: current.aggregate.profile.profileId,
      // Published availability is deliberately readable across organizations: a
      // patient must see a doctor's bookable capacity before any relationship
      // exists to scope it by.
      globalAllowed: true,
    });
    if (!decision.allowed) {
      return this.denySearch(
        current, organizationId, 403, 'PERMISSION_DENIED', 'Availability is not readable',
      );
    }
    return this.authorization.touch(current);
  }

  private async generationFailure(
    current: AuthenticatedSession,
    membershipId: string,
    result: Extract<GenerateAvailabilitySlotsResult, string>,
  ): Promise<never> {
    switch (result) {
      case 'no_active_rules':
        return this.deny(
          current, membershipId, 'availability.slots.generate', 409,
          'AVAILABILITY_RULES_MISSING',
          'No active availability rule exists to generate slots from',
        );
      case 'idempotency_reused':
        return this.deny(
          current, membershipId, 'availability.slots.generate', 409,
          'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused',
        );
      default:
        return this.actorFailure(current, membershipId, 'availability.slots.generate', result);
    }
  }

  private async ruleFailure(
    current: AuthenticatedSession,
    membershipId: string,
    result: Extract<ReplaceAvailabilityRulesResult, string>,
  ): Promise<never> {
    switch (result) {
      case 'rules_overlap':
        return this.deny(
          current, membershipId, 'availability.rules.replace', 422, 'VALIDATION_FAILED',
          'Availability rules overlap on the same weekday',
        );
      case 'version_conflict':
        return this.deny(
          current, membershipId, 'availability.rules.replace', 409,
          'AVAILABILITY_VERSION_CONFLICT', 'Availability version is stale',
        );
      default:
        return this.actorFailure(current, membershipId, 'availability.rules.replace', result);
    }
  }

  private async exceptionFailure(
    current: AuthenticatedSession,
    membershipId: string,
    result: Extract<RecordAvailabilityExceptionResult, string>,
  ): Promise<never> {
    if (result === 'version_conflict') {
      return this.deny(
        current, membershipId, 'availability.exception.record', 409,
        'AVAILABILITY_VERSION_CONFLICT', 'Availability exception version is stale',
      );
    }
    return this.actorFailure(current, membershipId, 'availability.exception.record', result);
  }

  private async actorFailure(
    current: AuthenticatedSession,
    membershipId: string,
    action: string,
    result: 'membership_not_found' | 'actor_session_invalid' | 'actor_permission_denied' |
      'actor_step_up_required',
  ): Promise<never> {
    switch (result) {
      case 'membership_not_found':
        return this.deny(
          current, membershipId, action, 404, 'RESOURCE_NOT_FOUND', 'Membership was not found',
        );
      case 'actor_session_invalid':
        return this.deny(
          current, membershipId, action, 401, 'APP_SESSION_INVALID',
          'The session is no longer valid',
        );
      case 'actor_permission_denied':
        return this.deny(
          current, membershipId, action, 403, 'PERMISSION_DENIED',
          'Availability management is not permitted',
        );
      case 'actor_step_up_required':
        return this.deny(
          current, membershipId, action, 403, 'STEP_UP_REQUIRED',
          'A current MFA step-up is required',
        );
    }
  }

  private async deny(
    current: AuthenticatedSession,
    membershipId: string,
    action: string,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    const requestCorrelationId = correlationId();
    await this.availability.recordDenial(
      membershipId,
      current.aggregate.profile.profileId,
      action,
      code,
      requestCorrelationId,
    );
    throw problem(status, code, title, requestCorrelationId);
  }

  private async denySearch(
    current: AuthenticatedSession,
    organizationId: string,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    const requestCorrelationId = correlationId();
    await this.schedule.recordSearchDenial(
      organizationId,
      current.aggregate.profile.profileId,
      'availability.slots.search',
      code,
      requestCorrelationId,
    );
    throw problem(status, code, title, requestCorrelationId);
  }
}

function writeActor(
  authorized: AuthenticatedSession,
  membershipId: string,
): SchedulingActorContext {
  return {
    sessionId: authorized.aggregate.session.sessionId,
    tokenHash: authorized.tokenHash,
    membershipId,
    requiredPermission: 'availability:write:own',
    // Availability is not a security-sensitive administrative action and is
    // performed constantly during a working day; requiring a fresh MFA step-up
    // for it would push doctors towards leaving elevated sessions open.
    requireStepUp: false,
  };
}

function activeMembership(current: AuthenticatedSession) {
  return current.aggregate.memberships.find(
    (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
  );
}

function parseMembershipPath(value: string): string {
  const result = membershipPathSchema.safeParse({ membershipId: value });
  if (!result.success) throw validationFailed();
  return result.data.membershipId;
}

function parseOrganizationPath(value: string): string {
  const result = organizationPathSchema.safeParse({ organizationId: value });
  if (!result.success) throw validationFailed();
  return result.data.organizationId;
}

function parseIdempotencyKey(value: unknown): string {
  const result = idempotencyKeySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

/**
 * The request fingerprint an `Idempotency-Key` is bound to. A retry that changes
 * the range is a reuse error, not a replay.
 */
function requestHash(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseSlotId(value: string): string {
  const result = slotPathSchema.safeParse({ slotId: value });
  if (!result.success) throw validationFailed();
  return result.data.slotId;
}

function parseReplaceRules(value: unknown) {
  const result = replaceAvailabilityRulesSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseRecordException(value: unknown) {
  const result = recordAvailabilityExceptionSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseGenerateSlots(value: unknown) {
  const result = generateAvailabilitySlotsSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseSearchSlots(value: unknown): SearchAppointmentSlotsQuery {
  const result = searchAppointmentSlotsQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseOwnSlots(value: unknown): ListOwnAvailabilitySlotsQuery {
  const result = listOwnAvailabilitySlotsQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

interface SlotCursor {
  readonly startsAt: Date;
  readonly slotId: string;
}

function encodeCursor(record: AvailabilitySlotRecord): string {
  return Buffer.from(JSON.stringify({
    starts_at: record.startsAt.toISOString(),
    slot_id: record.slotId,
  }), 'utf8').toString('base64url');
}

function decodeCursor(value: string): SlotCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (typeof decoded !== 'object' || decoded === null) throw new Error();
    const candidate = decoded as Record<string, unknown>;
    const startsAtValue = candidate['starts_at'];
    const slotIdValue = candidate['slot_id'];
    if (typeof startsAtValue !== 'string' || typeof slotIdValue !== 'string') throw new Error();
    const startsAt = new Date(startsAtValue);
    if (!Number.isFinite(startsAt.getTime())) throw new Error();
    return { startsAt, slotId: parseSlotId(slotIdValue) };
  } catch {
    throw validationFailed();
  }
}
