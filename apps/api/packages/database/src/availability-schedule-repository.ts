/**
 * Schedule reads and range slot generation.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * `AvailabilityRepository` owns the two availability WRITES that carry
 * invariants: replacing a rule set and recording a per-date exception. It
 * deliberately exposes no rule read and no standalone generation entry point,
 * and it is frozen. The HTTP surface still needs three things it does not
 * offer — reading a doctor's published rule set, searching an organization's
 * bookable capacity, and regenerating a stated date range — so they live here
 * rather than being reimplemented inside the API where they would have no
 * access to a transaction.
 *
 * The two reads are pure. The one write reuses the frozen module's own
 * primitives — `revalidateSchedulingActor` for under-lock authority and the
 * published availability event contract — so it cannot drift from the writes
 * next to it.
 */

import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  AVAILABILITY_CHANGED_EVENT_TYPE,
  AVAILABILITY_CHANGED_EVENT_VERSION,
  revalidateSchedulingActor,
  type AvailabilityRuleRecord,
  type AvailabilitySlotRecord,
  type SchedulingActorContext,
  type SchedulingActorFailure,
} from './availability-repository.js';
import {
  claimIdempotency,
  completeIdempotency,
  deleteIdempotency,
  loadIdempotency,
  type IdempotencyRecord,
  type IdempotencyScope,
} from './idempotency.js';

/** The operation key every range generation claims its `Idempotency-Key` under. */
const GENERATE_OPERATION_ID = 'availability.slots.generate';

export interface AvailabilityRuleSetView {
  /** Only the active rules: the inactive rows are superseded revisions. */
  readonly rules: AvailabilityRuleRecord[];
  /**
   * The rule-set revision a subsequent replacement must present as
   * `expected_version`. Taken over every row of the membership, active or not,
   * because withdrawing all capacity leaves a revision behind with no active
   * row to carry it.
   */
  readonly version: number;
}

export interface SearchOpenSlotsInput {
  readonly organizationId: string;
  /** Narrows the search to one doctor. Absent searches the whole organization. */
  readonly membershipId?: string;
  readonly from: Date;
  readonly to: Date;
  readonly afterStartsAt?: Date;
  readonly afterSlotId?: string;
  readonly limit: number;
  readonly now: Date;
}

export interface GenerateAvailabilitySlotsInput {
  readonly membershipId: string;
  readonly actor: SchedulingActorContext;
  /** Inclusive local calendar bounds, as `YYYY-MM-DD`. */
  readonly fromDate: string;
  readonly toDate: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly idempotencyTtlMs: number;
  readonly now: Date;
  readonly correlationId: string;
}

export interface GenerateAvailabilitySlotsSuccess {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly generatedSlotCount: number;
  readonly version: number;
}

/**
 * A replayed idempotent request returns the byte-for-byte response stored when
 * the original succeeded, exactly as booking does. Reloading current state would
 * let a replay observe later generations.
 */
export interface AvailabilitySlotGenerationSnapshot {
  readonly status: 201;
  readonly body: Record<string, unknown>;
}

export type GenerateAvailabilitySlotsResult =
  | { readonly result: GenerateAvailabilitySlotsSuccess; readonly replayed: false }
  | { readonly snapshot: AvailabilitySlotGenerationSnapshot; readonly replayed: true }
  | 'no_active_rules'
  | 'idempotency_reused'
  | SchedulingActorFailure;

interface RuleSetRow extends QueryResultRow {
  readonly ruleId: string | null;
  readonly membershipId: string | null;
  readonly organizationId: string | null;
  readonly weekday: number | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly slotDurationMinutes: number | null;
  readonly timezone: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly isActive: boolean | null;
  readonly version: number | null;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
  readonly ruleSetVersion: number;
}

interface SlotRow extends QueryResultRow, AvailabilitySlotRecord {}

export class AvailabilityScheduleRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * The doctor's published rule set and the revision to quote back on a
   * replacement. One statement, so the rules and the revision cannot be read
   * from either side of a concurrent replacement.
   */
  async findRuleSet(membershipId: string): Promise<AvailabilityRuleSetView> {
    const result = await this.database.query<RuleSetRow>(
      // LEFT JOIN from the revision row, not from the rules: a membership whose
      // capacity was withdrawn entirely has no active rule but still has a
      // revision, and an inner join would report version 0 and make the next
      // replacement fail its concurrency check forever.
      `WITH revision AS (
         SELECT COALESCE(MAX(version), 0) AS version
         FROM availability_rules WHERE membership_id = $1
       )
       SELECT ${ruleProjection()}, revision.version AS "ruleSetVersion"
       FROM revision
       LEFT JOIN availability_rules AS rule
         ON rule.membership_id = $1 AND rule.is_active
       ORDER BY rule.weekday, rule.start_time, rule.rule_id`,
      [membershipId],
    );
    const version = result.rows[0]?.ruleSetVersion ?? 0;
    return { rules: result.rows.flatMap(toRuleRecord), version };
  }

  /**
   * Bookable capacity in an organization, ordered and cursor-paginated
   * deterministically on `(starts_at, slot_id)`.
   *
   * Only slots whose doctor is actually bookable are returned: active doctor
   * membership, approved verification, accepting new patients. Publishing
   * capacity a booking would refuse under lock would send every patient down a
   * path that ends in 409. This is a read and never writes: a slot whose hold
   * has lapsed is reported as available, and the booking transaction reclaims
   * the row for real.
   */
  async searchOpenSlots(input: SearchOpenSlotsInput): Promise<AvailabilitySlotRecord[]> {
    const result = await this.database.query<SlotRow>(
      // Served by `appointment_slots_organization_window_idx` for organization
      // searches and the membership window index when one doctor is named.
      `SELECT slot.slot_id AS "slotId", slot.membership_id AS "membershipId",
       slot.organization_id AS "organizationId", slot.starts_at AS "startsAt",
       slot.ends_at AS "endsAt", slot.state, slot.held_until AS "heldUntil",
       slot.version
       FROM appointment_slots AS slot
       JOIN organization_memberships AS membership
         ON membership.membership_id = slot.membership_id
         AND membership.organization_id = slot.organization_id
       JOIN doctor_professional_details AS detail
         ON detail.membership_id = membership.membership_id
         AND detail.organization_id = membership.organization_id
       WHERE slot.organization_id = $1
         AND ($2::uuid IS NULL OR slot.membership_id = $2::uuid)
         AND slot.starts_at >= greatest($3::timestamptz, $5::timestamptz)
         AND slot.starts_at < $4::timestamptz
         AND (slot.state = 'open'
           OR (slot.state = 'held' AND slot.held_until <= $5::timestamptz))
         AND membership.status = 'active' AND membership.role_id = 'doctor'
         AND membership.verification_status = 'approved'
         AND detail.accepts_new_patients
         AND ($6::timestamptz IS NULL OR
           (slot.starts_at, slot.slot_id) > ($6, $7::uuid))
       ORDER BY slot.starts_at, slot.slot_id
       LIMIT $8`,
      [
        input.organizationId, input.membershipId ?? null, input.from, input.to,
        input.now, input.afterStartsAt ?? null, input.afterSlotId ?? null, input.limit,
      ],
    );
    return result.rows;
  }

  /**
   * The acting doctor's OWN already-generated slots over a date range, in EVERY
   * state — open, held, booked and closed.
   *
   * This is the `own`-scope READ the slot-generation POST has no GET counterpart
   * for. `searchOpenSlots` is the global published-capacity read and deliberately
   * hides held, booked and closed slots, because a patient booking must not see
   * another patient's hold or a cancelled slot. A doctor reviewing their own
   * schedule needs the opposite: the full picture of what was generated and what
   * happened to it, so they can see which slots are taken and which were closed
   * by an exception. That is why this is a separate, own-scoped method rather
   * than a flag on the global search.
   *
   * `membershipId` is the acting membership, proved by the service to be the
   * session's own. Cursor-paginated deterministically on `(starts_at, slot_id)`,
   * the same keyset the global search uses, bounded by the same window cap so one
   * request cannot scan the whole horizon. A slot whose hold has lapsed is
   * reported with its true `held` state rather than being masked as `open`, again
   * because the doctor sees their schedule as it is, not as a booker would.
   */
  async listOwnSlots(input: {
    membershipId: string; from: Date; to: Date;
    afterStartsAt?: Date; afterSlotId?: string; limit: number; now: Date;
  }): Promise<AvailabilitySlotRecord[]> {
    const result = await this.database.query<SlotRow>(
      `SELECT slot.slot_id AS "slotId", slot.membership_id AS "membershipId",
       slot.organization_id AS "organizationId", slot.starts_at AS "startsAt",
       slot.ends_at AS "endsAt", slot.state, slot.held_until AS "heldUntil",
       slot.version
       FROM appointment_slots AS slot
       WHERE slot.membership_id = $1
         AND slot.starts_at >= greatest($2::timestamptz, $6::timestamptz)
         AND slot.starts_at < $3::timestamptz
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

  /**
   * Materialises slots for the doctor's own rule set over an explicit inclusive
   * date range.
   *
   * Deterministic and idempotent twice over. The slot set is a pure function of
   * the active rules, the exception rows and the range, and every insert
   * conflicts away against `appointment_slots_live_start_uq`, so regenerating
   * cannot duplicate a slot and cannot disturb a held or booked one. On top of
   * that the `Idempotency-Key` is claimed inside the transaction, so a retried
   * request replays the original count instead of reporting zero new slots and
   * confusing the caller into thinking generation failed.
   *
   * Days carrying an exception are skipped, exactly as the rule-driven
   * generation skips them. A replacement window belongs to the exception write
   * path, which knows the slot shape to use; generating one here would publish
   * capacity the doctor never configured.
   */
  async generateSlots(
    input: GenerateAvailabilitySlotsInput,
  ): Promise<GenerateAvailabilitySlotsResult> {
    return this.database.transaction(async (client) => {
      const actor = await revalidateSchedulingActor(client, input.actor, input.now);
      if (typeof actor === 'string') return actor;
      // The membership in the path must be the acting membership. A doctor
      // publishes their own capacity and nobody else's.
      if (actor.membershipId !== input.membershipId) return 'actor_permission_denied';

      const scope: IdempotencyScope = {
        organizationId: actor.organizationId,
        actorProfileId: actor.profileId,
        operationId: GENERATE_OPERATION_ID,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      };
      const existing = await loadIdempotency(client, scope, input.now, true);
      if (existing !== undefined && !existing.expired) {
        return resolveSnapshot(existing, input.requestHash);
      }
      if (existing?.expired === true) await deleteIdempotency(client, scope);

      const revision = await this.lockRuleRevision(client, input.membershipId);
      // A membership with no rule row at all and one whose rules were all
      // withdrawn are the same situation to a caller: there is nothing to
      // generate from. They are reported identically rather than inventing a
      // distinction the doctor cannot act on differently.
      if (revision.activeRuleCount === 0) return 'no_active_rules';
      if (!await claimIdempotency(
        client, scope, new Date(input.now.getTime() + input.idempotencyTtlMs),
      )) {
        const raced = await loadIdempotency(client, scope, input.now, true);
        if (raced === undefined) throw new Error('Idempotency claim disappeared');
        return resolveSnapshot(raced, input.requestHash);
      }

      const generatedSlotCount = await this.insertGeneratedSlots(client, input);
      const success: GenerateAvailabilitySlotsSuccess = {
        membershipId: input.membershipId,
        organizationId: actor.organizationId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        generatedSlotCount,
        version: revision.version,
      };
      await this.recordGeneration(client, {
        membershipId: input.membershipId,
        organizationId: actor.organizationId,
        actorProfileId: actor.profileId,
        aggregateVersion: revision.version,
        generatedSlotCount,
        fromDate: input.fromDate,
        toDate: input.toDate,
        correlationId: input.correlationId,
        now: input.now,
      });
      await completeIdempotency(
        client, scope, 201, serializeSlotGeneration(success), input.now,
      );
      return { result: success, replayed: false };
    });
  }

  /**
   * Audits a refused slot search. The object is the organization whose capacity
   * was probed, and the organization column is written only when that
   * organization exists, so an audit row for an invented identifier cannot break
   * its foreign key.
   */
  async recordSearchDenial(
    organizationId: string,
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
        CASE WHEN EXISTS (SELECT 1 FROM organizations WHERE organization_id = $1)
          THEN $1::uuid ELSE NULL END,
        $2, $3, 'availability', $1, $4, $5, $6)`,
      [organizationId, actorProfileId, action, code, correlationId, { denial_code: code }],
    );
  }

  /** Audits a refused generation request. PHI-free by construction. */
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
   * Locks the membership's rule rows in `rule_id` order, matching the lock order
   * `AvailabilityRepository` uses for every availability mutation: actor session
   * and membership first, then rules, then slots. Taking them in any other order
   * would deadlock a concurrent rule replacement.
   */
  private async lockRuleRevision(
    client: PoolClient,
    membershipId: string,
  ): Promise<{ readonly version: number; readonly activeRuleCount: number }> {
    const locked = await client.query<{
      readonly version: number;
      readonly isActive: boolean;
    }>(
      `SELECT version, is_active AS "isActive"
       FROM availability_rules
       WHERE membership_id = $1
       ORDER BY rule_id
       FOR UPDATE`,
      [membershipId],
    );
    return {
      version: locked.rows.reduce((highest, row) => Math.max(highest, row.version), 0),
      activeRuleCount: locked.rows.filter((row) => row.isActive).length,
    };
  }

  /**
   * The generation query. Structurally identical to the rule-driven generation in
   * `AvailabilityRepository`, differing only in taking both range bounds from the
   * caller instead of `[today, today + horizon]`. Rows are inserted in
   * `starts_at` order so two concurrent generators take index locks in one order.
   */
  private async insertGeneratedSlots(
    client: PoolClient,
    input: GenerateAvailabilitySlotsInput,
  ): Promise<number> {
    const result = await client.query(
      `WITH horizon AS (
         SELECT day::date AS day
         FROM generate_series($2::date, $3::date, interval '1 day') AS day
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
      [input.membershipId, input.fromDate, input.toDate, input.now],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Single writer for the audit row and the published event, both inside the
   * generation transaction. The payload carries only the four fields
   * `AvailabilityChangedData` declares — it sets `additionalProperties: false`,
   * so an extra key would dead-letter in the worker. The range and the counts
   * stay in the audit log.
   */
  private async recordGeneration(
    client: PoolClient,
    change: {
      readonly membershipId: string;
      readonly organizationId: string;
      readonly actorProfileId: string;
      readonly aggregateVersion: number;
      readonly generatedSlotCount: number;
      readonly fromDate: string;
      readonly toDate: string;
      readonly correlationId: string;
      readonly now: Date;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, 'availability.slots.generate', 'availability',
        $3, NULL, $4, $5)`,
      [
        change.organizationId, change.actorProfileId, change.membershipId,
        change.correlationId,
        {
          from_date: change.fromDate,
          to_date: change.toDate,
          generated_slot_count: change.generatedSlotCount,
          version: change.aggregateVersion,
        },
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
          change: 'slots_generated',
          slot_count: change.generatedSlotCount,
        },
        change.correlationId,
        change.now,
      ],
    );
  }
}

/** Stable response shape, shared by live responses and by idempotent replays. */
export function serializeSlotGeneration(
  result: GenerateAvailabilitySlotsSuccess,
): Record<string, unknown> {
  return {
    membership_id: result.membershipId,
    organization_id: result.organizationId,
    from_date: result.fromDate,
    to_date: result.toDate,
    generated_slot_count: result.generatedSlotCount,
    version: result.version,
  };
}

/**
 * Replays the stored response verbatim. Deliberately does not recount slots: a
 * replay must reproduce the original outcome even though a second generation
 * would legitimately produce nothing.
 *
 * A key presented with a different request fingerprint is a REUSE error, not a
 * replay. Replaying the first range's count for a second range would report
 * capacity that was never generated. A key still `processing` is also a reuse
 * error rather than a wait: there is no stored response to return yet.
 */
function resolveSnapshot(
  existing: IdempotencyRecord,
  requestHash: string,
):
  | { readonly snapshot: AvailabilitySlotGenerationSnapshot; readonly replayed: true }
  | 'idempotency_reused' {
  if (existing.requestHash !== requestHash) return 'idempotency_reused';
  const body = existing.responseBody;
  if (existing.state !== 'completed' || existing.responseStatus !== 201 || body === null) {
    return 'idempotency_reused';
  }
  if (body['generated_slot_count'] === undefined) return 'idempotency_reused';
  return { snapshot: { status: 201, body }, replayed: true };
}

/**
 * Drops the single all-null row a membership with no active rule produces. The
 * row exists only to carry the revision.
 */
function toRuleRecord(row: RuleSetRow): AvailabilityRuleRecord[] {
  if (
    row.ruleId === null || row.membershipId === null || row.organizationId === null ||
    row.weekday === null || row.startTime === null || row.endTime === null ||
    row.slotDurationMinutes === null || row.timezone === null ||
    row.effectiveFrom === null || row.isActive === null || row.version === null ||
    row.createdAt === null || row.updatedAt === null
  ) return [];
  return [{
    ruleId: row.ruleId,
    membershipId: row.membershipId,
    organizationId: row.organizationId,
    weekday: row.weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    slotDurationMinutes: row.slotDurationMinutes,
    timezone: row.timezone,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    isActive: row.isActive,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }];
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
