import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import type { RoleId } from './session-repository.js';

/**
 * Canonical event contract for every availability mutation. The payload must
 * match `AvailabilityChangedData` in the AsyncAPI document exactly, which
 * declares `additionalProperties: false`, so no extra key may be added here.
 * Contextual detail belongs in the audit log, not in the published event.
 */
export const AVAILABILITY_CHANGED_EVENT_TYPE = 'availability.changed.v1';
export const AVAILABILITY_CHANGED_EVENT_VERSION = 1;

/** The three shapes an availability mutation can take, as published. */
export const AVAILABILITY_CHANGE_KINDS = [
  'rules_replaced', 'exception_recorded', 'slots_generated',
] as const;
export type AvailabilityChangeKind = typeof AVAILABILITY_CHANGE_KINDS[number];

/**
 * Structured, PHI-free reasons a doctor closes or moves a working day. Free text
 * is deliberately not accepted: the reason reaches audit logs and patient-facing
 * copy, and no operator can be relied upon to keep clinical detail out of an open
 * string field.
 */
export const AVAILABILITY_EXCEPTION_REASON_CODES = [
  'annual_leave',
  'sick_leave',
  'public_holiday',
  'training',
  'administrative_block',
  'clinic_closure',
  'schedule_correction',
  'emergency_cover',
] as const;
export type AvailabilityExceptionReasonCode = typeof AVAILABILITY_EXCEPTION_REASON_CODES[number];

/** Fallback zone for a membership that has no active rule to borrow one from. */
const DEFAULT_TIMEZONE = 'Asia/Kuala_Lumpur';

/**
 * Everything needed to re-prove the actor's authority *inside* the mutation
 * transaction. Checking authorization in the HTTP layer alone is a
 * time-of-check-to-time-of-use hazard: between the guard and the write the
 * session can be revoked, the membership suspended, or the step-up can expire.
 *
 * `membershipId` is always the actor's OWN membership. The revalidation query
 * joins it to the session's profile, so an actor cannot present someone else's
 * membership and inherit its authority.
 */
export interface SchedulingActorContext {
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly membershipId: string;
  readonly requiredPermission: string;
  readonly additionalRequiredPermissions?: readonly string[];
  readonly requireStepUp: boolean;
}

export type SchedulingActorFailure =
  | 'actor_session_invalid'
  | 'actor_permission_denied'
  | 'actor_step_up_required';

export interface SchedulingActor {
  readonly profileId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly roleId: RoleId;
}

/** A single weekly working window. Times are local to `timezone`. */
export interface AvailabilityRuleInput {
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly slotDurationMinutes: number;
  readonly timezone: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface AvailabilityRuleRecord {
  readonly ruleId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly slotDurationMinutes: number;
  readonly timezone: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly isActive: boolean;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AvailabilityExceptionRecord {
  readonly exceptionId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly exceptionDate: string;
  readonly isUnavailable: boolean;
  readonly replacementStartTime: string | null;
  readonly replacementEndTime: string | null;
  readonly reasonCode: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AvailabilitySlotRecord {
  readonly slotId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly state: 'open' | 'held' | 'booked' | 'closed';
  readonly heldUntil: Date | null;
  readonly version: number;
}

export interface ReplaceAvailabilityRulesInput {
  readonly membershipId: string;
  readonly actor: SchedulingActorContext;
  readonly rules: readonly AvailabilityRuleInput[];
  readonly expectedVersion: number;
  readonly generationHorizonDays: number;
  readonly now: Date;
  readonly correlationId: string;
}

export interface ReplaceAvailabilityRulesSuccess {
  readonly rules: AvailabilityRuleRecord[];
  readonly version: number;
  readonly generatedSlotCount: number;
}

export type ReplaceAvailabilityRulesResult =
  | ReplaceAvailabilityRulesSuccess
  | 'membership_not_found'
  | 'version_conflict'
  | 'rules_overlap'
  | SchedulingActorFailure;

export interface RecordAvailabilityExceptionInput {
  readonly membershipId: string;
  readonly actor: SchedulingActorContext;
  readonly exceptionDate: string;
  readonly isUnavailable: boolean;
  readonly replacementStartTime: string | null;
  readonly replacementEndTime: string | null;
  readonly reasonCode: AvailabilityExceptionReasonCode;
  readonly expectedVersion: number;
  readonly now: Date;
  readonly correlationId: string;
}

export interface RecordAvailabilityExceptionSuccess {
  readonly exception: AvailabilityExceptionRecord;
  readonly closedSlotCount: number;
  readonly generatedSlotCount: number;
}

export type RecordAvailabilityExceptionResult =
  | RecordAvailabilityExceptionSuccess
  | 'membership_not_found'
  | 'version_conflict'
  | SchedulingActorFailure;

export interface ListAvailableSlotsInput {
  readonly membershipId: string;
  readonly from: Date;
  readonly to: Date;
  readonly afterStartsAt?: Date;
  readonly afterSlotId?: string;
  readonly limit: number;
  readonly now: Date;
}

interface RuleRow extends QueryResultRow, AvailabilityRuleRecord {}
interface ExceptionRow extends QueryResultRow, AvailabilityExceptionRecord {}
interface SlotRow extends QueryResultRow, AvailabilitySlotRecord {}
interface ActorRow extends QueryResultRow {
  readonly profileId: string;
  readonly profileStatus: string;
  readonly onboardingCompletedAt: Date | null;
  readonly membershipStatus: string;
  readonly organizationId: string;
  readonly roleId: RoleId;
  readonly stepUpValidUntil: Date | null;
  readonly hasPermission: boolean;
}

/**
 * Re-proves the actor's authority while holding locks, immediately before a
 * write. Every condition the HTTP guards checked is checked again: live session,
 * active profile with completed onboarding, active membership belonging to that
 * profile, the specific permission grant, and a current step-up where required.
 *
 * Shared by the availability and appointment repositories, which both act on
 * behalf of an ordinary member (a doctor or a patient) rather than an
 * administrator, so `MembershipRepository`'s administrator revalidation — which
 * requires an `admin` or `super_admin` role — does not apply.
 */
export async function revalidateSchedulingActor(
  client: PoolClient,
  actor: SchedulingActorContext,
  now: Date,
): Promise<SchedulingActor | SchedulingActorFailure> {
  const result = await client.query<ActorRow>(
    `SELECT profile.profile_id AS "profileId", profile.status AS "profileStatus",
     profile.onboarding_completed_at AS "onboardingCompletedAt",
     membership.status AS "membershipStatus",
     membership.organization_id AS "organizationId",
     membership.role_id AS "roleId",
     session.step_up_valid_until AS "stepUpValidUntil",
     (EXISTS (SELECT 1 FROM role_permissions
       WHERE role_id = membership.role_id AND permission_id = $4)
      AND NOT EXISTS (
        SELECT 1 FROM unnest($6::text[]) AS required(permission_id)
        WHERE NOT EXISTS (
          SELECT 1 FROM role_permissions
          WHERE role_id = membership.role_id
            AND permission_id = required.permission_id
        )
      )) AS "hasPermission"
     FROM app_sessions AS session
     JOIN profiles AS profile ON profile.profile_id = session.profile_id
     JOIN organization_memberships AS membership
       ON membership.membership_id = $3 AND membership.profile_id = session.profile_id
     WHERE session.session_id = $1 AND session.token_hash = $2
       AND session.status = 'active'
       AND session.idle_expires_at > $5 AND session.absolute_expires_at > $5
     FOR UPDATE OF session, membership`,
    [
      actor.sessionId, actor.tokenHash, actor.membershipId,
      actor.requiredPermission, now, actor.additionalRequiredPermissions ?? [],
    ],
  );
  const row = result.rows[0];
  if (row === undefined) return 'actor_session_invalid';
  if (row.profileStatus !== 'active' || row.onboardingCompletedAt === null) {
    return 'actor_session_invalid';
  }
  if (row.membershipStatus !== 'active') return 'actor_permission_denied';
  if (!row.hasPermission) return 'actor_permission_denied';
  if (
    actor.requireStepUp &&
    (row.stepUpValidUntil === null || row.stepUpValidUntil <= now)
  ) return 'actor_step_up_required';
  return {
    profileId: row.profileId,
    membershipId: actor.membershipId,
    organizationId: row.organizationId,
    roleId: row.roleId,
  };
}

export class AvailabilityRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * Replaces the doctor's entire active rule set in one transaction and
   * regenerates the slot horizon.
   *
   * Lock order, fixed for every availability mutation: actor session and
   * membership first, then the membership's rule rows in `rule_id` order, then
   * its slot rows in `slot_id` order. Unlike membership administration this does
   * not lock the organization row: availability and booking are high-concurrency
   * paths, and serialising an entire organization behind one row would trade the
   * deadlock risk for a throughput collapse. Nothing here depends on an
   * organization-wide invariant.
   */
  async replaceRules(
    input: ReplaceAvailabilityRulesInput,
  ): Promise<ReplaceAvailabilityRulesResult> {
    const overlap = findOverlappingRule(input.rules);
    if (overlap) return 'rules_overlap';
    return this.database.transaction(async (client) => {
      const actor = await revalidateSchedulingActor(client, input.actor, input.now);
      if (typeof actor === 'string') return actor;
      if (actor.membershipId !== input.membershipId) return 'actor_permission_denied';

      const current = await this.lockRules(client, input.membershipId);
      const revision = current.reduce((highest, rule) => Math.max(highest, rule.version), 0);
      if (revision !== input.expectedVersion) return 'version_conflict';
      const nextRevision = revision + 1;

      await client.query(
        `UPDATE availability_rules
         SET is_active = false, version = $2, updated_at = $3
         WHERE membership_id = $1 AND is_active`,
        [input.membershipId, nextRevision, input.now],
      );
      for (const rule of orderedRules(input.rules)) {
        await client.query(
          `INSERT INTO availability_rules
           (rule_id, membership_id, organization_id, weekday, start_time, end_time,
            slot_duration_minutes, timezone, effective_from, effective_to,
            is_active, version, created_at, updated_at)
           VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $11)`,
          [
            input.membershipId, actor.organizationId, rule.weekday, rule.startTime,
            rule.endTime, rule.slotDurationMinutes, rule.timezone, rule.effectiveFrom,
            rule.effectiveTo, nextRevision, input.now,
          ],
        );
      }
      const generatedSlotCount = await this.generateSlots(
        client, input.membershipId, input.now, input.generationHorizonDays,
      );
      const rules = await this.loadActiveRules(client, input.membershipId);
      await this.recordChange(client, {
        membershipId: input.membershipId,
        organizationId: actor.organizationId,
        actorProfileId: actor.profileId,
        action: 'availability.rules.replace',
        change: 'rules_replaced',
        aggregateVersion: nextRevision,
        slotCount: generatedSlotCount,
        reasonCode: null,
        metadata: {
          rule_count: rules.length,
          version: nextRevision,
          generated_slot_count: generatedSlotCount,
        },
        correlationId: input.correlationId,
        now: input.now,
      });
      return { rules, version: nextRevision, generatedSlotCount };
    });
  }

  /**
   * Records a per-date exception, closes the bookable slots it invalidates and
   * regenerates the day when the exception supplies a replacement window.
   *
   * Booked slots are deliberately left alone: capacity a patient already holds an
   * appointment against is not silently withdrawn. The database refuses it in any
   * case — `smartcura_guard_slot_release` rejects releasing a booked slot while a
   * live appointment occupies it — so the doctor must cancel those appointments
   * explicitly and be seen to do it.
   */
  async recordException(
    input: RecordAvailabilityExceptionInput,
  ): Promise<RecordAvailabilityExceptionResult> {
    return this.database.transaction(async (client) => {
      const actor = await revalidateSchedulingActor(client, input.actor, input.now);
      if (typeof actor === 'string') return actor;
      if (actor.membershipId !== input.membershipId) return 'actor_permission_denied';

      const existing = await this.lockException(client, input.membershipId, input.exceptionDate);
      if ((existing?.version ?? 0) !== input.expectedVersion) return 'version_conflict';
      const nextVersion = existing === undefined ? 0 : existing.version + 1;
      const stored = await client.query<ExceptionRow>(
        `INSERT INTO availability_exceptions
         (exception_id, membership_id, organization_id, exception_date, is_unavailable,
          replacement_start_time, replacement_end_time, reason_code, version,
          created_at, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         ON CONFLICT (membership_id, exception_date) DO UPDATE
         SET is_unavailable = EXCLUDED.is_unavailable,
             replacement_start_time = EXCLUDED.replacement_start_time,
             replacement_end_time = EXCLUDED.replacement_end_time,
             reason_code = EXCLUDED.reason_code,
             version = EXCLUDED.version,
             updated_at = EXCLUDED.updated_at
         RETURNING ${exceptionProjection()}`,
        [
          input.membershipId, actor.organizationId, input.exceptionDate,
          input.isUnavailable, input.replacementStartTime, input.replacementEndTime,
          input.reasonCode, nextVersion, input.now,
        ],
      );
      const exception = stored.rows[0];
      if (exception === undefined) throw new Error('Availability exception was not stored');

      const closedSlotCount = await this.closeSlotsOnDate(
        client, input.membershipId, input.exceptionDate, input.now,
      );
      const generatedSlotCount = input.isUnavailable
        ? 0
        : await this.generateReplacementSlots(
          client, input.membershipId, input.exceptionDate, input.now,
        );
      await this.recordChange(client, {
        membershipId: input.membershipId,
        organizationId: actor.organizationId,
        actorProfileId: actor.profileId,
        action: 'availability.exception.record',
        change: 'exception_recorded',
        aggregateVersion: exception.version,
        slotCount: generatedSlotCount,
        reasonCode: input.reasonCode,
        metadata: {
          exception_date: exception.exceptionDate,
          is_unavailable: exception.isUnavailable,
          closed_slot_count: closedSlotCount,
          generated_slot_count: generatedSlotCount,
          version: exception.version,
        },
        correlationId: input.correlationId,
        now: input.now,
      });
      return { exception, closedSlotCount, generatedSlotCount };
    });
  }

  /**
   * Bookable slots in a window, ordered and cursor-paginated deterministically on
   * `(starts_at, slot_id)`.
   *
   * A slot whose hold has expired is reported as available without being written
   * first: a read must never mutate, and an expired hold has already stopped
   * reserving anything. The booking transaction reclaims the row for real.
   */
  async listAvailableSlots(input: ListAvailableSlotsInput): Promise<AvailabilitySlotRecord[]> {
    const result = await this.database.query<SlotRow>(
      `${slotProjection()}
       WHERE slot.membership_id = $1
         AND slot.starts_at >= greatest($2::timestamptz, $6::timestamptz)
         AND slot.starts_at < $3::timestamptz
         AND (slot.state = 'open'
           OR (slot.state = 'held' AND slot.held_until <= $6::timestamptz))
         AND ($4::timestamptz IS NULL OR
           (slot.starts_at, slot.slot_id) > ($4, $5::uuid))
       ORDER BY slot.starts_at, slot.slot_id
       LIMIT $7`,
      [
        input.membershipId, input.from, input.to,
        input.afterStartsAt ?? null, input.afterSlotId ?? null, input.now, input.limit,
      ],
    );
    return result.rows;
  }

  /** Audits a refused availability request. PHI-free by construction. */
  async recordDenial(
    membershipId: string,
    actorProfileId: string,
    action: string,
    code: string,
    correlationId: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(),
        (SELECT organization_id FROM organization_memberships WHERE membership_id = $1),
        $2, $3, 'availability', $1, $4, $5, $6)`,
      [membershipId, actorProfileId, action, code, correlationId, { denial_code: code }],
    );
  }

  /**
   * Materialises slots for the rule set over `[now, now + horizonDays]`.
   *
   * Deterministic and idempotent by construction: the slot set is a pure function
   * of the active rules, the exception rows and the horizon, and every insert
   * conflicts away against `appointment_slots_live_start_uq`. Regenerating
   * therefore cannot duplicate a slot, cannot disturb a held or booked slot, and
   * cannot produce a different set for the same inputs. Rows are inserted in
   * `starts_at` order so concurrent generators take index locks in one order.
   */
  private async generateSlots(
    client: PoolClient,
    membershipId: string,
    now: Date,
    horizonDays: number,
  ): Promise<number> {
    const result = await client.query(
      `WITH horizon AS (
         SELECT day::date AS day
         FROM generate_series($2::date, ($2::date + $3::integer), interval '1 day') AS day
       ),
       candidate AS (
         SELECT rule.membership_id, rule.organization_id,
           ((horizon.day + rule.start_time) AT TIME ZONE rule.timezone)
             + make_interval(mins => (offsets.n * rule.slot_duration_minutes)) AS starts_at,
           rule.slot_duration_minutes AS minutes
         FROM availability_rules AS rule
         JOIN horizon
           ON EXTRACT(DOW FROM horizon.day)::smallint = rule.weekday
          AND horizon.day >= rule.effective_from
          AND (rule.effective_to IS NULL OR horizon.day <= rule.effective_to)
         CROSS JOIN LATERAL generate_series(
           0,
           (EXTRACT(EPOCH FROM (rule.end_time - rule.start_time))::integer
             / (rule.slot_duration_minutes * 60)) - 1
         ) AS offsets(n)
         WHERE rule.membership_id = $1 AND rule.is_active
           AND NOT EXISTS (
             SELECT 1 FROM availability_exceptions AS exception
             WHERE exception.membership_id = rule.membership_id
               AND exception.exception_date = horizon.day
           )
       )
       INSERT INTO appointment_slots
       (slot_id, membership_id, organization_id, starts_at, ends_at, state,
        created_at, updated_at)
       SELECT uuidv7(), candidate.membership_id, candidate.organization_id,
         candidate.starts_at,
         candidate.starts_at + make_interval(mins => candidate.minutes),
         'open', $4, $4
       FROM candidate
       WHERE candidate.starts_at > $4
       ORDER BY candidate.starts_at
       ON CONFLICT (membership_id, starts_at) WHERE state <> 'closed' DO NOTHING`,
      [membershipId, isoDate(now), horizonDays, now],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Generates the replacement window of an available exception day. The slot
   * length is borrowed from the doctor's own rule set — the first active rule by
   * `(weekday, start_time, rule_id)` — because inventing a default length would
   * publish capacity in a shape the doctor never configured. A membership with no
   * active rule generates nothing.
   */
  private async generateReplacementSlots(
    client: PoolClient,
    membershipId: string,
    exceptionDate: string,
    now: Date,
  ): Promise<number> {
    const result = await client.query(
      `WITH slot_shape AS (
         SELECT slot_duration_minutes AS minutes, timezone
         FROM availability_rules
         WHERE membership_id = $1 AND is_active
         ORDER BY weekday, start_time, rule_id
         LIMIT 1
       ),
       candidate AS (
         SELECT exception.membership_id, exception.organization_id,
           ((exception.exception_date + exception.replacement_start_time)
             AT TIME ZONE slot_shape.timezone)
             + make_interval(mins => (offsets.n * slot_shape.minutes)) AS starts_at,
           slot_shape.minutes AS minutes
         FROM availability_exceptions AS exception
         CROSS JOIN slot_shape
         CROSS JOIN LATERAL generate_series(
           0,
           (EXTRACT(EPOCH FROM (exception.replacement_end_time - exception.replacement_start_time))::integer
             / (slot_shape.minutes * 60)) - 1
         ) AS offsets(n)
         WHERE exception.membership_id = $1
           AND exception.exception_date = $2::date
           AND exception.is_unavailable = false
       )
       INSERT INTO appointment_slots
       (slot_id, membership_id, organization_id, starts_at, ends_at, state,
        created_at, updated_at)
       SELECT uuidv7(), candidate.membership_id, candidate.organization_id,
         candidate.starts_at,
         candidate.starts_at + make_interval(mins => candidate.minutes),
         'open', $3, $3
       FROM candidate
       WHERE candidate.starts_at > $3
       ORDER BY candidate.starts_at
       ON CONFLICT (membership_id, starts_at) WHERE state <> 'closed' DO NOTHING`,
      [membershipId, exceptionDate, now],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Closes the open and held slots that fall on a local calendar date. Locks are
   * taken in `slot_id` order first, then the update runs by id, so two doctors
   * editing overlapping horizons cannot deadlock.
   */
  private async closeSlotsOnDate(
    client: PoolClient,
    membershipId: string,
    exceptionDate: string,
    now: Date,
  ): Promise<number> {
    const locked = await client.query<{ readonly slotId: string }>(
      `WITH zone AS (
         SELECT COALESCE((
           SELECT timezone FROM availability_rules
           WHERE membership_id = $1 AND is_active
           ORDER BY weekday, start_time, rule_id
           LIMIT 1
         ), $3) AS tz
       )
       SELECT slot.slot_id AS "slotId"
       FROM appointment_slots AS slot, zone
       WHERE slot.membership_id = $1
         AND slot.state IN ('open', 'held')
         AND ((slot.starts_at AT TIME ZONE zone.tz)::date) = $2::date
       ORDER BY slot.slot_id
       FOR UPDATE OF slot`,
      [membershipId, exceptionDate, DEFAULT_TIMEZONE],
    );
    const slotIds = locked.rows.map((row) => row.slotId);
    if (slotIds.length === 0) return 0;
    const updated = await client.query(
      `UPDATE appointment_slots
       SET state = 'closed', held_until = NULL, held_by_profile_id = NULL,
           version = version + 1, updated_at = $2
       WHERE slot_id = ANY($1::uuid[])`,
      [slotIds, now],
    );
    return updated.rowCount ?? 0;
  }

  private async lockRules(
    client: PoolClient,
    membershipId: string,
  ): Promise<AvailabilityRuleRecord[]> {
    const result = await client.query<RuleRow>(
      `SELECT ${ruleProjection()}
       FROM availability_rules AS rule
       WHERE rule.membership_id = $1
       ORDER BY rule.rule_id
       FOR UPDATE`,
      [membershipId],
    );
    return result.rows;
  }

  private async loadActiveRules(
    client: PoolClient,
    membershipId: string,
  ): Promise<AvailabilityRuleRecord[]> {
    const result = await client.query<RuleRow>(
      `SELECT ${ruleProjection()}
       FROM availability_rules AS rule
       WHERE rule.membership_id = $1 AND rule.is_active
       ORDER BY rule.weekday, rule.start_time, rule.rule_id`,
      [membershipId],
    );
    return result.rows;
  }

  private async lockException(
    client: PoolClient,
    membershipId: string,
    exceptionDate: string,
  ): Promise<AvailabilityExceptionRecord | undefined> {
    const result = await client.query<ExceptionRow>(
      `SELECT ${exceptionProjection()}
       FROM availability_exceptions AS exception
       WHERE exception.membership_id = $1 AND exception.exception_date = $2::date
       FOR UPDATE`,
      [membershipId, exceptionDate],
    );
    return result.rows[0];
  }

  /**
   * Single writer for the audit row and the published availability event, both in
   * the mutation transaction. The event payload carries only the four fields
   * `AvailabilityChangedData` declares; richer context stays in the audit log.
   */
  private async recordChange(
    client: PoolClient,
    change: {
      readonly membershipId: string;
      readonly organizationId: string;
      readonly actorProfileId: string;
      readonly action: string;
      readonly change: AvailabilityChangeKind;
      readonly aggregateVersion: number;
      readonly slotCount: number;
      readonly reasonCode: string | null;
      readonly metadata: Record<string, unknown>;
      readonly correlationId: string;
      readonly now: Date;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, $3, 'availability', $4, $5, $6, $7)`,
      [
        change.organizationId, change.actorProfileId, change.action,
        change.membershipId, change.reasonCode, change.correlationId, change.metadata,
      ],
    );
    await client.query(
      `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, payload, correlation_id, occurred_at)
       VALUES (uuidv7(), $1, $2, 'availability', $3, $4, $5, $6, $7)`,
      [
        AVAILABILITY_CHANGED_EVENT_TYPE,
        AVAILABILITY_CHANGED_EVENT_VERSION,
        change.membershipId,
        change.aggregateVersion,
        {
          membership_id: change.membershipId,
          organization_id: change.organizationId,
          change: change.change,
          slot_count: change.slotCount,
        },
        change.correlationId,
        change.now,
      ],
    );
  }
}

/** Stable response shape, shared by live responses and by list pages. */
export function serializeAvailabilityRule(
  record: AvailabilityRuleRecord,
): Record<string, unknown> {
  return {
    id: record.ruleId,
    membership_id: record.membershipId,
    organization_id: record.organizationId,
    weekday: record.weekday,
    start_time: record.startTime,
    end_time: record.endTime,
    slot_duration_minutes: record.slotDurationMinutes,
    timezone: record.timezone,
    effective_from: record.effectiveFrom,
    effective_to: record.effectiveTo,
    is_active: record.isActive,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export function serializeAvailabilityException(
  record: AvailabilityExceptionRecord,
): Record<string, unknown> {
  return {
    id: record.exceptionId,
    membership_id: record.membershipId,
    organization_id: record.organizationId,
    exception_date: record.exceptionDate,
    is_unavailable: record.isUnavailable,
    replacement_start_time: record.replacementStartTime,
    replacement_end_time: record.replacementEndTime,
    reason_code: record.reasonCode,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export function serializeAvailabilitySlot(
  record: AvailabilitySlotRecord,
): Record<string, unknown> {
  return {
    id: record.slotId,
    membership_id: record.membershipId,
    organization_id: record.organizationId,
    starts_at: record.startsAt.toISOString(),
    ends_at: record.endsAt.toISOString(),
    state: record.state,
    version: record.version,
  };
}

/**
 * Rejects a submitted rule set whose windows overlap on the same weekday while
 * their effective ranges also overlap. The database prevents duplicates, but two
 * overlapping windows of different lengths would generate slots that straddle
 * each other, and only one of them could ever be booked.
 */
function findOverlappingRule(rules: readonly AvailabilityRuleInput[]): boolean {
  const sorted = orderedRules(rules);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (previous.weekday !== current.weekday) continue;
    if (current.startTime >= previous.endTime) continue;
    if (!effectiveRangesOverlap(previous, current)) continue;
    return true;
  }
  return false;
}

function effectiveRangesOverlap(
  left: AvailabilityRuleInput,
  right: AvailabilityRuleInput,
): boolean {
  const leftEnd = left.effectiveTo;
  const rightEnd = right.effectiveTo;
  return (leftEnd === null || leftEnd >= right.effectiveFrom) &&
    (rightEnd === null || rightEnd >= left.effectiveFrom);
}

/** Total order over submitted rules so writes and locks are deterministic. */
function orderedRules(rules: readonly AvailabilityRuleInput[]): AvailabilityRuleInput[] {
  return [...rules].sort((left, right) =>
    left.weekday - right.weekday ||
    left.startTime.localeCompare(right.startTime) ||
    left.effectiveFrom.localeCompare(right.effectiveFrom));
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function ruleProjection(): string {
  return `rule.rule_id AS "ruleId", rule.membership_id AS "membershipId",
   rule.organization_id AS "organizationId", rule.weekday,
   rule.start_time AS "startTime", rule.end_time AS "endTime",
   rule.slot_duration_minutes AS "slotDurationMinutes", rule.timezone,
   rule.effective_from::text AS "effectiveFrom",
   rule.effective_to::text AS "effectiveTo",
   rule.is_active AS "isActive", rule.version,
   rule.created_at AS "createdAt", rule.updated_at AS "updatedAt"`;
}

function exceptionProjection(): string {
  return `exception_id AS "exceptionId", membership_id AS "membershipId",
   organization_id AS "organizationId", exception_date::text AS "exceptionDate",
   is_unavailable AS "isUnavailable",
   replacement_start_time AS "replacementStartTime",
   replacement_end_time AS "replacementEndTime",
   reason_code AS "reasonCode", version,
   created_at AS "createdAt", updated_at AS "updatedAt"`;
}

function slotProjection(): string {
  return `SELECT slot.slot_id AS "slotId", slot.membership_id AS "membershipId",
   slot.organization_id AS "organizationId", slot.starts_at AS "startsAt",
   slot.ends_at AS "endsAt", slot.state, slot.held_until AS "heldUntil",
   slot.version
   FROM appointment_slots AS slot`;
}
