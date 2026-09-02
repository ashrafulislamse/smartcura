import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import { createNotification } from './notification-repository.js';
import {
  BREAK_GLASS_ACTIVATED_EVENT_TYPE,
  BREAK_GLASS_ACTIVATED_EVENT_VERSION,
  BREAK_GLASS_TERMINATED_EVENT_TYPE,
  BREAK_GLASS_TERMINATED_EVENT_VERSION,
  EMERGENCY_DISPATCH_CHANGED_EVENT_TYPE,
  EMERGENCY_DISPATCH_CHANGED_EVENT_VERSION,
  EMERGENCY_EVENT_CHANGED_EVENT_TYPE,
  EMERGENCY_EVENT_CHANGED_EVENT_VERSION,
  EMERGENCY_RESOLVED_EVENT_TYPE,
  EMERGENCY_RESOLVED_EVENT_VERSION,
  type EmergencyEventStatus,
  type EmergencyResolutionType,
  type EmergencyUnitStatus,
  type TriagePriority,
} from './emergency-events.js';
import type {
  VitalReadingRecord,
  HealthAlertRecord,
} from './vital-reading-repository.js';

/**
 * Canonical progression from the frozen catalogue:
 *   created → triaged → dispatching → unit_assigned → responding → on_scene
 * then either transporting → resolved, or resolved directly.
 */
const EVENT_SEQUENCE: readonly EmergencyEventStatus[] = [
  'created', 'triaged', 'dispatching', 'unit_assigned', 'responding', 'on_scene',
];

export function emergencyTransitionAllowed(
  current: EmergencyEventStatus, next: EmergencyEventStatus,
): boolean {
  if (current === 'resolved' || current === 'cancelled' || current === 'false_alarm') return false;
  // Terminal reasoned outcomes may interrupt any live step: an emergency can be
  // cancelled or found false at any point, and refusing that would strand the event.
  if (next === 'cancelled' || next === 'false_alarm') return true;
  // On scene may transport or resolve directly; treated-on-scene needs no transport.
  if (current === 'on_scene') return next === 'transporting' || next === 'resolved';
  if (current === 'transporting') return next === 'resolved';
  const from = EVENT_SEQUENCE.indexOf(current);
  const to = EVENT_SEQUENCE.indexOf(next);
  // One step at a time, so an event cannot reach `responding` with no triage recorded.
  return from >= 0 && to === from + 1;
}

export interface EmergencyEventRecord {
  readonly emergencyEventId: string;
  readonly organizationId: string;
  readonly siteId: string | null;
  readonly patientProfileId: string;
  readonly status: EmergencyEventStatus;
  readonly triagePriority: TriagePriority;
  readonly categoryCode: string;
  readonly version: number;
  readonly createdAt: Date;
}

export interface RaiseEmergencyInput {
  readonly organizationId: string;
  readonly patientProfileId: string;
  readonly reportedByProfileId: string;
  readonly siteId: string | null;
  readonly categoryCode: string;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly addressText: string | null;
  readonly vitals: readonly {
    readonly metric: string;
    readonly value: string;
    readonly unit: string;
    readonly quality: string;
    readonly measuredAt: Date;
  }[];
  readonly correlationId: string;
}

/** Minimum-necessary patient projection disclosed under an active grant. */
export interface BreakGlassDisclosure {
  readonly patientProfileId: string;
  readonly displayName: string;
  readonly allergies: readonly {
    readonly substance: string;
    readonly severity: string;
    readonly reaction: string | null;
  }[];
  readonly conditions: readonly {
    readonly conditionName: string;
    readonly status: string;
  }[];
}

/** Vital readings disclosed under an active break-glass grant. */
export interface BreakGlassReadingsResult {
  readonly patientProfileId: string;
  readonly readings: readonly VitalReadingRecord[];
}

/** Health alerts disclosed under an active break-glass grant. */
export interface BreakGlassAlertsResult {
  readonly patientProfileId: string;
  readonly alerts: readonly HealthAlertRecord[];
}

export class EmergencyRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * ATOMIC BOUNDARY 7 (raise half). The event, its vital snapshots and the outbox
   * notification commit together: an SOS whose event exists but whose notification was
   * never queued is an emergency nobody is told about.
   */
  async raise(input: RaiseEmergencyInput): Promise<EmergencyEventRecord> {
    return this.database.transaction(async (client) => {
      const created = await client.query<EmergencyEventRecord>(
        `INSERT INTO emergency_events
           (organization_id, site_id, patient_profile_id, reported_by_profile_id,
            category_code, latitude, longitude, address_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING emergency_event_id AS "emergencyEventId",
                   organization_id AS "organizationId", site_id AS "siteId",
                   patient_profile_id AS "patientProfileId", status, triage_priority AS "triagePriority",
                   category_code AS "categoryCode", version, created_at AS "createdAt"`,
        [input.organizationId, input.siteId, input.patientProfileId,
          input.reportedByProfileId, input.categoryCode,
          input.latitude, input.longitude, input.addressText],
      );
      const event = created.rows[0]!;
      // Snapshots are COPIES taken now. Linking to live readings would let a later
      // correction rewrite the evidence the responders acted on.
      for (const vital of input.vitals) {
        await client.query(
          `INSERT INTO emergency_vital_snapshots
             (emergency_event_id, metric, value_numeric, unit, quality, measured_at)
           VALUES ($1,$2::vital_metric,$3,$4,$5::vital_reading_quality,$6)`,
          [event.emergencyEventId, vital.metric, vital.value, vital.unit,
            vital.quality, vital.measuredAt],
        );
      }
      await this.publishEvent(client, event, input.correlationId);
      // Every active emergency operator of the organization is told immediately,
      // with push forced past per-category preferences: an SOS the operator
      // muted is an SOS nobody sees. `mandatoryPush` is exactly this flag.
      const operators = (await client.query<{ readonly profileId: string }>(
        `SELECT profile_id AS "profileId" FROM organization_memberships
          WHERE organization_id = $1 AND role_id = 'emergency' AND status = 'active'`,
        [event.organizationId],
      )).rows;
      for (const operator of operators) {
        await createNotification(client, {
          profileId: operator.profileId,
          category: 'emergency',
          resourceType: 'emergency_event',
          resourceId: event.emergencyEventId,
          titleCode: 'emergency.created.title',
          bodyCode: 'emergency.created.body',
          priority: 'critical',
          mandatoryPush: true,
          mandatoryEmail: true,
          correlationId: input.correlationId,
          now: new Date(),
        });
      }
      return event;
    });
  }

  /**
   * May this reporter raise an SOS naming another patient?
   *
   * Only through a live consent grant. Without this check anyone could manufacture an
   * emergency event for any profile, and an emergency event is exactly the precondition
   * a break-glass grant requires — so an unchecked reporter field would be a route to
   * reading any patient's record.
   */
  async reporterMayActFor(
    reporterProfileId: string, patientProfileId: string,
  ): Promise<boolean> {
    const permitted = await this.database.query(
      `SELECT 1 FROM consent_grants
        WHERE grantor_profile_id = $1
          AND grantee_profile_id = $2
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
        LIMIT 1`,
      [patientProfileId, reporterProfileId],
    );
    return (permitted.rowCount ?? 0) > 0;
  }

  async findEvent(emergencyEventId: string): Promise<EmergencyEventRecord | null> {
    const found = await this.database.query<EmergencyEventRecord>(
      `SELECT emergency_event_id AS "emergencyEventId", organization_id AS "organizationId",
              site_id AS "siteId", patient_profile_id AS "patientProfileId", status,
              triage_priority AS "triagePriority", category_code AS "categoryCode",
              version, created_at AS "createdAt"
         FROM emergency_events WHERE emergency_event_id = $1`,
      [emergencyEventId],
    );
    return found.rows[0] ?? null;
  }

  /** Append-only triage assessment; the event advances to `triaged` on the first one. */
  /**
   * The dispatch QUEUE, ordered by clinical urgency rather than recency.
   *
   * Active events come first, then `critical` before `low`, then oldest first within a
   * priority. Recency ordering would put a new low-priority call above a critical one
   * that has been waiting, which is the opposite of triage.
   *
   * DISCLOSURE. Rows carry location and the patient IDENTIFIER because a responder
   * cannot be dispatched without them, and the route is gated on
   * `emergency.event:read:site`. They carry no vitals snapshot, no triage notes and no
   * communications: those are per-event reads, and a queue that embedded them would
   * widen exposure for every row an operator merely scrolls past. Coordinates stay
   * decimal STRINGS end to end, because parsing to float and re-serializing would
   * change the stored value.
   */
  async listEvents(input: {
    readonly organizationId: string;
    readonly status: EmergencyEventStatus | null;
    readonly triagePriority: TriagePriority | null;
    readonly activeOnly: boolean;
    readonly limit: number;
  }): Promise<readonly {
    readonly emergencyEventId: string; readonly siteId: string | null;
    readonly patientProfileId: string; readonly reportedByProfileId: string;
    readonly status: EmergencyEventStatus; readonly triagePriority: TriagePriority;
    readonly categoryCode: string; readonly reasonCode: string | null;
    readonly latitude: string | null; readonly longitude: string | null;
    readonly addressText: string | null; readonly version: number;
    readonly createdAt: Date; readonly triagedAt: Date | null;
    readonly dispatchedAt: Date | null; readonly onSceneAt: Date | null;
    readonly resolvedAt: Date | null;
  }[]> {
    return (await this.database.query(
      `SELECT emergency_event_id AS "emergencyEventId", site_id AS "siteId",
              patient_profile_id AS "patientProfileId",
              reported_by_profile_id AS "reportedByProfileId",
              status, triage_priority AS "triagePriority",
              category_code AS "categoryCode", reason_code AS "reasonCode",
              latitude::text AS "latitude", longitude::text AS "longitude",
              address_text AS "addressText", version,
              created_at AS "createdAt", triaged_at AS "triagedAt",
              dispatched_at AS "dispatchedAt", on_scene_at AS "onSceneAt",
              resolved_at AS "resolvedAt"
         FROM emergency_events
        WHERE organization_id = $1
          AND ($2::text IS NULL OR status::text = $2::text)
          AND ($3::text IS NULL OR triage_priority::text = $3::text)
          AND ($4 = false OR status NOT IN ('resolved','cancelled','false_alarm'))
        ORDER BY
          (status NOT IN ('resolved','cancelled','false_alarm')) DESC,
          CASE triage_priority
            WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
            WHEN 'low' THEN 3 ELSE 4 END ASC,
          created_at ASC,
          emergency_event_id ASC
        LIMIT $5`,
      [input.organizationId, input.status, input.triagePriority, input.activeOnly, input.limit],
    )).rows as never;
  }

  /**
   * The fleet roster for an organization. Scoped by `organization_id` (taken from the
   * caller's membership in the service, never from the request). Ordered by operational
   * availability first — `available` units are what a dispatcher can send NOW — then by
   * call sign within each status group. The partial index `emergency_units_available_idx`
   * serves the common "what can I send?" query; this broader listing uses the call-sign
   * unique index for its secondary sort.
   */
  async listUnits(input: {
    readonly organizationId: string;
    readonly status: EmergencyUnitStatus | null;
    readonly limit: number;
  }): Promise<readonly {
    readonly emergencyUnitId: string; readonly organizationId: string;
    readonly siteId: string; readonly callSign: string; readonly unitType: string;
    readonly status: EmergencyUnitStatus; readonly capacity: number;
    readonly version: number; readonly createdAt: Date; readonly updatedAt: Date;
  }[]> {
    return (await this.database.query(
      `SELECT emergency_unit_id AS "emergencyUnitId", organization_id AS "organizationId",
              site_id AS "siteId", call_sign AS "callSign", unit_type AS "unitType",
              status, capacity, version,
              created_at AS "createdAt", updated_at AS "updatedAt"
         FROM emergency_units
        WHERE organization_id = $1
          AND ($2::text IS NULL OR status::text = $2::text)
        ORDER BY
          CASE status
            WHEN 'available' THEN 0 WHEN 'en_route' THEN 1 WHEN 'on_scene' THEN 2
            WHEN 'transporting' THEN 3 WHEN 'reserved' THEN 4
            WHEN 'out_of_service' THEN 5 ELSE 6 END ASC,
          call_sign ASC
        LIMIT $3`,
      [input.organizationId, input.status, input.limit],
    )).rows as never;
  }
  async recordTriage(input: {
    readonly emergencyEventId: string;
    readonly assessedByMembershipId: string;
    readonly priority: Exclude<TriagePriority, 'unknown'>;
    readonly protocolCode: string;
    readonly reasonCode: string;
    readonly expectedVersion: number;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly status: EmergencyEventStatus }
    | { readonly ok: false; readonly reason: 'conflict' | 'state' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{ status: EmergencyEventStatus; version: number }>(
        `SELECT status, version FROM emergency_events
          WHERE emergency_event_id = $1 FOR UPDATE`,
        [input.emergencyEventId],
      );
      const current = locked.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'state' as const };
      if (current.version !== input.expectedVersion) {
        return { ok: false as const, reason: 'conflict' as const };
      }
      if (current.status === 'resolved' || current.status === 'cancelled'
        || current.status === 'false_alarm') {
        return { ok: false as const, reason: 'state' as const };
      }
      await client.query(
        `INSERT INTO triage_events
           (emergency_event_id, assessed_by_membership_id, priority, protocol_code, reason_code)
         VALUES ($1,$2,$3::triage_priority,$4,$5)`,
        [input.emergencyEventId, input.assessedByMembershipId, input.priority,
          input.protocolCode, input.reasonCode],
      );
      // Re-triage of an already dispatched event updates priority without rewinding
      // lifecycle state: a worsening patient must not reset an en-route response.
      const nextStatus: EmergencyEventStatus = current.status === 'created'
        ? 'triaged' : current.status;
      const updated = await client.query<EmergencyEventRecord>(
        `UPDATE emergency_events
            SET status = $2::emergency_event_status,
                triage_priority = $3::triage_priority,
                triaged_at = COALESCE(triaged_at, now()),
                version = version + 1,
                updated_at = now()
          WHERE emergency_event_id = $1
          RETURNING emergency_event_id AS "emergencyEventId", organization_id AS "organizationId",
                    site_id AS "siteId", patient_profile_id AS "patientProfileId", status,
                    triage_priority AS "triagePriority", category_code AS "categoryCode",
                    version, created_at AS "createdAt"`,
        [input.emergencyEventId, nextStatus, input.priority],
      );
      await this.publishEvent(client, updated.rows[0]!, input.correlationId);
      return { ok: true as const, status: nextStatus };
    });
  }

  /**
   * ATOMIC BOUNDARY 7 (dispatch half). Reserving the unit, creating the dispatch and
   * transitioning the event happen in ONE serializable transaction. Two operators
   * assigning the last ambulance concurrently must produce one reservation, not two,
   * and the partial unique indexes refuse the second even if the check passes.
   */
  async reserveUnit(input: {
    readonly emergencyEventId: string;
    readonly emergencyUnitId: string;
    readonly assignedByMembershipId: string;
    readonly manualOverride: boolean;
    readonly overrideReasonCode: string | null;
    readonly expectedVersion: number;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly emergencyDispatchId: string }
    | { readonly ok: false; readonly reason: 'conflict' | 'state' | 'unit_unavailable' }> {
    return this.database.serializableTransaction(async (client) => {
      const locked = await client.query<{ status: EmergencyEventStatus; version: number }>(
        `SELECT status, version FROM emergency_events
          WHERE emergency_event_id = $1 FOR UPDATE`,
        [input.emergencyEventId],
      );
      const current = locked.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'state' as const };
      if (current.version !== input.expectedVersion) {
        return { ok: false as const, reason: 'conflict' as const };
      }
      // Dispatch is reachable from triaged or dispatching only. An untriaged event has
      // no priority, so choosing which unit to send is not yet a decision anyone can make.
      if (current.status !== 'triaged' && current.status !== 'dispatching') {
        return { ok: false as const, reason: 'state' as const };
      }
      const unit = await client.query<{ status: string }>(
        `SELECT status FROM emergency_units
          WHERE emergency_unit_id = $1 FOR UPDATE`,
        [input.emergencyUnitId],
      );
      if (unit.rows[0] === undefined || unit.rows[0].status !== 'available') {
        return { ok: false as const, reason: 'unit_unavailable' as const };
      }
      const dispatched = await client.query<{ emergencyDispatchId: string }>(
        `INSERT INTO emergency_dispatches
           (emergency_event_id, emergency_unit_id, assigned_by_membership_id,
            manual_override, override_reason_code)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING emergency_dispatch_id AS "emergencyDispatchId"`,
        [input.emergencyEventId, input.emergencyUnitId, input.assignedByMembershipId,
          input.manualOverride, input.overrideReasonCode],
      );
      await client.query(
        `UPDATE emergency_units SET status = 'reserved', version = version + 1, updated_at = now()
          WHERE emergency_unit_id = $1`,
        [input.emergencyUnitId],
      );
      const updated = await client.query<EmergencyEventRecord>(
        `UPDATE emergency_events
            SET status = 'unit_assigned', dispatched_at = COALESCE(dispatched_at, now()),
                version = version + 1, updated_at = now()
          WHERE emergency_event_id = $1
          RETURNING emergency_event_id AS "emergencyEventId", organization_id AS "organizationId",
                    site_id AS "siteId", patient_profile_id AS "patientProfileId", status,
                    triage_priority AS "triagePriority", category_code AS "categoryCode",
                    version, created_at AS "createdAt"`,
        [input.emergencyEventId],
      );
      await this.publishEvent(client, updated.rows[0]!, input.correlationId);
      await client.query(
        `INSERT INTO outbox_events
           (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
            payload,correlation_id,occurred_at)
         VALUES (uuidv7(),$1,$2,'emergency_dispatch',$3,0,$4::jsonb,$5,now())`,
        [EMERGENCY_DISPATCH_CHANGED_EVENT_TYPE, EMERGENCY_DISPATCH_CHANGED_EVENT_VERSION,
          dispatched.rows[0]!.emergencyDispatchId, JSON.stringify({
            emergency_dispatch_id: dispatched.rows[0]!.emergencyDispatchId,
            emergency_event_id: input.emergencyEventId,
            emergency_unit_id: input.emergencyUnitId,
            status: 'reserved',
          }), input.correlationId],
      );
      return { ok: true as const, emergencyDispatchId: dispatched.rows[0]!.emergencyDispatchId };
    });
  }

  /** Advance the event one step, keeping the reserved unit's status in step. */
  async advance(input: {
    readonly emergencyEventId: string;
    readonly next: EmergencyEventStatus;
    readonly reasonCode: string | null;
    readonly expectedVersion: number;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly status: EmergencyEventStatus }
    | { readonly ok: false; readonly reason: 'conflict' | 'state' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{ status: EmergencyEventStatus; version: number }>(
        `SELECT status, version FROM emergency_events
          WHERE emergency_event_id = $1 FOR UPDATE`,
        [input.emergencyEventId],
      );
      const current = locked.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'state' as const };
      if (current.version !== input.expectedVersion) {
        return { ok: false as const, reason: 'conflict' as const };
      }
      if (!emergencyTransitionAllowed(current.status, input.next)) {
        return { ok: false as const, reason: 'state' as const };
      }
      // Computed in TypeScript, never as `CASE WHEN $n = ...`: reusing a bind parameter
      // as both an enum value and a comparison operand raises 42P08, which cost several
      // debugging cycles in WP-06 and WP-10 before the rule was written down.
      const terminal = input.next === 'resolved' || input.next === 'cancelled'
        || input.next === 'false_alarm';
      const onScene = input.next === 'on_scene';
      const updated = await client.query<EmergencyEventRecord>(
        `UPDATE emergency_events
            SET status = $2::emergency_event_status,
                reason_code = COALESCE($3, reason_code),
                on_scene_at = CASE WHEN $4 THEN COALESCE(on_scene_at, now()) ELSE on_scene_at END,
                resolved_at = CASE WHEN $5 AND $2::emergency_event_status = 'resolved'
                                   THEN now() ELSE resolved_at END,
                version = version + 1, updated_at = now()
          WHERE emergency_event_id = $1
          RETURNING emergency_event_id AS "emergencyEventId", organization_id AS "organizationId",
                    site_id AS "siteId", patient_profile_id AS "patientProfileId", status,
                    triage_priority AS "triagePriority", category_code AS "categoryCode",
                    version, created_at AS "createdAt"`,
        [input.emergencyEventId, input.next, input.reasonCode, onScene, terminal],
      );
      // Releasing the unit on a terminal outcome is part of the same commit: a resolved
      // emergency holding an ambulance forever would silently shrink the fleet.
      if (terminal) {
        await client.query(
          `UPDATE emergency_units SET status = 'available', version = version + 1, updated_at = now()
            WHERE emergency_unit_id IN (
              SELECT emergency_unit_id FROM emergency_dispatches
               WHERE emergency_event_id = $1 AND released_at IS NULL)`,
          [input.emergencyEventId],
        );
        await client.query(
          `UPDATE emergency_dispatches SET released_at = now(), status = 'available',
                  version = version + 1, updated_at = now()
            WHERE emergency_event_id = $1 AND released_at IS NULL`,
          [input.emergencyEventId],
        );
        // Every grant justified by this event ends with it: the policy relationship the
        // grant depends on no longer exists.
        await client.query(
          `UPDATE break_glass_grants
              SET status = 'terminated', terminated_at = now(),
                  termination_reason_code = 'event_closed'
            WHERE emergency_event_id = $1 AND status = 'active'`,
          [input.emergencyEventId],
        );
      }
      await this.publishEvent(client, updated.rows[0]!, input.correlationId);
      // The patient learns the event is closed — resolved, cancelled, or a false
      // alarm — in the same commit that closes it. Their app polls the event, but
      // a terminal push is what stops the anxious polling loop.
      if (terminal) {
        await createNotification(client, {
          profileId: updated.rows[0]!.patientProfileId,
          category: 'emergency',
          resourceType: 'emergency_event',
          resourceId: input.emergencyEventId,
          titleCode: input.next === 'resolved'
            ? 'emergency.resolved.title' : 'emergency.cancelled.title',
          bodyCode: input.next === 'resolved'
            ? 'emergency.resolved.body' : 'emergency.cancelled.body',
          correlationId: input.correlationId,
          now: new Date(),
        });
      }
      return { ok: true as const, status: input.next };
    });
  }

  /** Resolution notes and the computed response duration, written with the event. */
  async resolve(input: {
    readonly emergencyEventId: string;
    readonly resolvedByMembershipId: string;
    readonly resolutionType: EmergencyResolutionType;
    readonly notes: string;
    readonly outcomeCode: string | null;
    readonly expectedVersion: number;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly responseDurationSeconds: number }
    | { readonly ok: false; readonly reason: 'conflict' | 'state' | 'already_resolved' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{
        status: EmergencyEventStatus; version: number; createdAt: Date;
      }>(
        `SELECT status, version, created_at AS "createdAt" FROM emergency_events
          WHERE emergency_event_id = $1 FOR UPDATE`,
        [input.emergencyEventId],
      );
      const current = locked.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'state' as const };
      if (current.version !== input.expectedVersion) {
        return { ok: false as const, reason: 'conflict' as const };
      }
      const alreadyTerminal = current.status === 'resolved' || current.status === 'cancelled'
        || current.status === 'false_alarm';
      if (!alreadyTerminal && !emergencyTransitionAllowed(current.status, 'resolved')) {
        return { ok: false as const, reason: 'state' as const };
      }
      const existing = await client.query(
        'SELECT 1 FROM emergency_resolutions WHERE emergency_event_id = $1',
        [input.emergencyEventId],
      );
      if ((existing.rowCount ?? 0) > 0) {
        return { ok: false as const, reason: 'already_resolved' as const };
      }
      let record = current;
      if (!alreadyTerminal) {
        const updated = await client.query<{
          status: EmergencyEventStatus; version: number; createdAt: Date;
        }>(
          `UPDATE emergency_events
              SET status = 'resolved', resolved_at = now(), version = version + 1, updated_at = now()
            WHERE emergency_event_id = $1
            RETURNING status, version, created_at AS "createdAt"`,
          [input.emergencyEventId],
        );
        record = updated.rows[0]!;
      }
      // `event_created_at` is the event's OWN instant, verified by a deferred trigger,
      // so the response duration cannot be improved by supplying a later start.
      const resolution = await client.query<{ responseDurationSeconds: number }>(
        `INSERT INTO emergency_resolutions
           (emergency_event_id, resolved_by_membership_id, resolution_type, notes,
            outcome_code, event_created_at, resolved_at)
         SELECT $1,$2,$3::emergency_resolution_type,$4,$5,created_at,now()
           FROM emergency_events WHERE emergency_event_id = $1
         RETURNING response_duration_seconds AS "responseDurationSeconds"`,
        [input.emergencyEventId, input.resolvedByMembershipId, input.resolutionType,
          input.notes, input.outcomeCode],
      );
      await client.query(
        `UPDATE emergency_units SET status = 'available', version = version + 1, updated_at = now()
          WHERE emergency_unit_id IN (
            SELECT emergency_unit_id FROM emergency_dispatches
             WHERE emergency_event_id = $1 AND released_at IS NULL)`,
        [input.emergencyEventId],
      );
      await client.query(
        `UPDATE emergency_dispatches SET released_at = now(), status = 'available',
                version = version + 1, updated_at = now()
          WHERE emergency_event_id = $1 AND released_at IS NULL`,
        [input.emergencyEventId],
      );
      await client.query(
        `UPDATE break_glass_grants
            SET status = 'terminated', terminated_at = now(),
                termination_reason_code = 'event_closed'
          WHERE emergency_event_id = $1 AND status = 'active'`,
        [input.emergencyEventId],
      );
      await client.query(
        `INSERT INTO outbox_events
           (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
            payload,correlation_id,occurred_at)
         VALUES (uuidv7(),$1,$2,'emergency_event',$3,$4,$5::jsonb,$6,now())`,
        [EMERGENCY_RESOLVED_EVENT_TYPE, EMERGENCY_RESOLVED_EVENT_VERSION,
          input.emergencyEventId, record.version, JSON.stringify({
            emergency_event_id: input.emergencyEventId,
            resolution_type: input.resolutionType,
            response_duration_seconds: resolution.rows[0]!.responseDurationSeconds,
          }), input.correlationId],
      );
      return {
        ok: true as const,
        responseDurationSeconds: resolution.rows[0]!.responseDurationSeconds,
      };
    });
  }

  async recordCommunication(input: {
    readonly emergencyEventId: string;
    readonly actorMembershipId: string;
    readonly channel: string;
    readonly direction: 'inbound' | 'outbound';
    readonly summaryCode: string;
  }): Promise<boolean> {
    const inserted = await this.database.query(
      `INSERT INTO emergency_communications
         (emergency_event_id, actor_membership_id, channel, direction, summary_code)
       SELECT $1,$2,$3::emergency_communication_channel,$4,$5
         FROM emergency_events
        WHERE emergency_event_id = $1
          AND status NOT IN ('resolved','cancelled','false_alarm')`,
      [input.emergencyEventId, input.actorMembershipId, input.channel,
        input.direction, input.summaryCode],
    );
    return (inserted.rowCount ?? 0) > 0;
  }

  private async publishEvent(
    client: PoolClient, event: EmergencyEventRecord, correlationId: string,
  ): Promise<void> {
    // Minimum data: no coordinates, no address, no patient name, no triage narrative.
    await client.query(
      `INSERT INTO outbox_events
         (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
          payload,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,'emergency_event',$3,$4,$5::jsonb,$6,now())`,
      [EMERGENCY_EVENT_CHANGED_EVENT_TYPE, EMERGENCY_EVENT_CHANGED_EVENT_VERSION,
        event.emergencyEventId, event.version, JSON.stringify({
          emergency_event_id: event.emergencyEventId,
          status: event.status,
          triage_priority: event.triagePriority,
          organization_id: event.organizationId,
        }), correlationId],
    );
  }

  /**
   * Break-glass activation. The grant, its security notification and its first audit
   * entry commit together; the 15-minute ceiling is additionally a database constraint,
   * so a service bug cannot widen it.
   */
  async activateBreakGlass(input: {
    readonly actorMembershipId: string;
    readonly actorProfileId: string;
    readonly organizationId: string;
    readonly patientProfileId: string;
    readonly emergencyEventId: string;
    readonly reasonCode: string;
    readonly reasonDetail: string | null;
    readonly renewsGrantId: string | null;
    readonly grantMinutes: number;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly grantId: string; readonly expiresAt: Date }
    | { readonly ok: false; readonly reason: 'already_active' | 'not_permitted' }> {
    // The active-event, patient-match and organization-match rules are enforced by a
    // DEFERRABLE constraint trigger, so they fire at COMMIT — not at the INSERT. A
    // try/catch inside the transaction body cannot see them, which is why activating on
    // a resolved emergency first surfaced as a 500 rather than a refusal. The mapping
    // therefore wraps the WHOLE transaction.
    try {
      return await this.activateBreakGlassCommitted(input);
    } catch (error) {
      const code = typeof error === 'object' && error !== null
        ? (error as { readonly code?: unknown }).code : undefined;
      if (code === '23505') return { ok: false as const, reason: 'already_active' as const };
      if (code === '23514') return { ok: false as const, reason: 'not_permitted' as const };
      throw error;
    }
  }

  private async activateBreakGlassCommitted(input: {
    readonly actorMembershipId: string;
    readonly actorProfileId: string;
    readonly organizationId: string;
    readonly patientProfileId: string;
    readonly emergencyEventId: string;
    readonly reasonCode: string;
    readonly reasonDetail: string | null;
    readonly renewsGrantId: string | null;
    readonly grantMinutes: number;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly grantId: string; readonly expiresAt: Date }
    | { readonly ok: false; readonly reason: 'already_active' | 'not_permitted' }> {
    return this.database.transaction(async (client) => {
      // A renewal must supersede a grant that is genuinely finished, so an actor cannot
      // hold two live windows at once.
      if (input.renewsGrantId !== null) {
        await client.query(
          `UPDATE break_glass_grants
              SET status = 'terminated', terminated_at = now(),
                  termination_reason_code = 'renewed'
            WHERE break_glass_grant_id = $1 AND status = 'active'`,
          [input.renewsGrantId],
        );
      }
      const minutes = Math.min(Math.max(input.grantMinutes, 1), 15);
      // Immediate violations propagate to the wrapper alongside the deferred ones, so
      // there is exactly one place that decides what a constraint failure means.
      const granted = await client.query<{ grantId: string; expiresAt: Date }>(
        `INSERT INTO break_glass_grants
           (actor_membership_id, actor_profile_id, organization_id, patient_profile_id,
            emergency_event_id, reason_code, reason_detail, renews_grant_id, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $9::int))
         RETURNING break_glass_grant_id AS "grantId", expires_at AS "expiresAt"`,
        [input.actorMembershipId, input.actorProfileId, input.organizationId,
          input.patientProfileId, input.emergencyEventId, input.reasonCode,
          input.reasonDetail, input.renewsGrantId, minutes],
      );
      const grantId = granted.rows[0]!.grantId;
      const expiresAt = granted.rows[0]!.expiresAt;
      await client.query(
        `INSERT INTO outbox_events
           (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
            payload,correlation_id,occurred_at)
         VALUES (uuidv7(),$1,$2,'break_glass_grant',$3,0,$4::jsonb,$5,now())`,
        [BREAK_GLASS_ACTIVATED_EVENT_TYPE, BREAK_GLASS_ACTIVATED_EVENT_VERSION,
          grantId, JSON.stringify({
            break_glass_grant_id: grantId,
            actor_membership_id: input.actorMembershipId,
            patient_profile_id: input.patientProfileId,
            emergency_event_id: input.emergencyEventId,
            reason_code: input.reasonCode,
            expires_at: expiresAt.toISOString(),
          }), input.correlationId],
      );
      await client.query(
        `INSERT INTO break_glass_access_log
           (break_glass_grant_id, resource_type, field_group, correlation_id)
         VALUES ($1,'break_glass_grant','activation',$2)`,
        [grantId, input.correlationId],
      );
      return { ok: true as const, grantId, expiresAt };
    });
  }

  /**
   * Read the minimum-necessary projection under a grant, logging the access in the
   * SAME transaction as the read. Logging afterwards would let a crash produce an
   * unrecorded disclosure, which is the one outcome this table exists to prevent.
   */
  async readUnderBreakGlass(input: {
    readonly grantId: string;
    readonly actorMembershipId: string;
    readonly correlationId: string;
  }): Promise<BreakGlassDisclosure | null> {
    return this.database.transaction(async (client) => {
      const grant = await client.query<{ patientProfileId: string }>(
        `SELECT patient_profile_id AS "patientProfileId"
           FROM break_glass_grants
          WHERE break_glass_grant_id = $1
            AND actor_membership_id = $2
            AND status = 'active'
            AND expires_at > now()`,
        [input.grantId, input.actorMembershipId],
      );
      const active = grant.rows[0];
      // An expired or foreign grant reads nothing. Expiry is part of the QUERY rather
      // than a later comparison, so a clock check cannot be forgotten at a call site.
      if (active === undefined) return null;

      const patient = await client.query<{ displayName: string }>(
        'SELECT display_name AS "displayName" FROM profiles WHERE profile_id = $1',
        [active.patientProfileId],
      );
      const allergies = await client.query<{
        substance: string; severity: string; reaction: string | null;
      }>(
        // `patient_allergies`, NOT the superseded `profile_allergies` from 0011. The
        // wrong table compiles, runs, and returns zero rows, which would show a
        // responder "no allergies" for a patient who has them — the most dangerous
        // possible failure of this exact query. Soft-deleted rows are excluded because
        // this table is soft-deleted and a removed allergy must not resurface.
        `SELECT substance, severity, reaction FROM patient_allergies
          WHERE profile_id = $1 AND deleted_at IS NULL
          ORDER BY CASE severity
                     WHEN 'life_threatening' THEN 0 WHEN 'severe' THEN 1
                     WHEN 'moderate' THEN 2 ELSE 3 END, substance`,
        [active.patientProfileId],
      );
      const conditions = await client.query<{ conditionName: string; status: string }>(
        `SELECT condition_name AS "conditionName", status FROM patient_conditions
          WHERE profile_id = $1 AND deleted_at IS NULL AND status <> 'resolved'
          ORDER BY condition_name`,
        [active.patientProfileId],
      );
      // One row per field group actually disclosed, so "minimum necessary" is auditable
      // rather than merely asserted.
      for (const fieldGroup of ['patient_identity', 'allergies', 'active_conditions']) {
        await client.query(
          `INSERT INTO break_glass_access_log
             (break_glass_grant_id, resource_type, resource_id, field_group, correlation_id)
           VALUES ($1,'patient_record',$2,$3,$4)`,
          [input.grantId, active.patientProfileId, fieldGroup, input.correlationId],
        );
      }
      return {
        patientProfileId: active.patientProfileId,
        displayName: patient.rows[0]?.displayName ?? '',
        allergies: allergies.rows,
        conditions: conditions.rows,
      };
    });
  }

  /**
   * List vital readings under an active grant, logging the access in the SAME
   * transaction as the read — matching `readUnderBreakGlass`. An expired,
   * terminated or foreign grant returns null (concealed as not found by the
   * service).
   *
   * The query mirrors `VitalReadingRepository.listReadings` exactly: newest-first
   * keyset pagination on `(recorded_at, reading_id)`, with optional metric and
   * time-window predicates. Inlining it here keeps the grant verification, the
   * read and the audit log in one transaction, which is the guarantee this table
   * exists to enforce.
   */
  async listReadingsUnderBreakGlass(input: {
    readonly grantId: string;
    readonly actorMembershipId: string;
    readonly correlationId: string;
    readonly metric?: string;
    readonly from?: Date;
    readonly to?: Date;
    readonly beforeRecordedAt?: Date;
    readonly beforeReadingId?: string;
    readonly limit: number;
  }): Promise<BreakGlassReadingsResult | null> {
    return this.database.transaction(async (client) => {
      const grant = await client.query<{ patientProfileId: string }>(
        `SELECT patient_profile_id AS "patientProfileId"
           FROM break_glass_grants
          WHERE break_glass_grant_id = $1
            AND actor_membership_id = $2
            AND status = 'active'
            AND expires_at > now()`,
        [input.grantId, input.actorMembershipId],
      );
      const active = grant.rows[0];
      if (active === undefined) return null;

      const readings = await client.query<VitalReadingRecord>(
        `SELECT reading.reading_id AS "readingId", reading.device_id AS "deviceId",
           reading.patient_profile_id AS "patientProfileId", reading.metric,
           reading.value::double precision AS value, reading.unit,
           reading.recorded_at AS "recordedAt", reading.ingested_at AS "ingestedAt",
           reading.quality
         FROM vital_readings reading
         WHERE reading.patient_profile_id = $1
           AND ($2::vital_metric IS NULL OR reading.metric = $2::vital_metric)
           AND ($3::timestamptz IS NULL OR reading.recorded_at >= $3)
           AND ($4::timestamptz IS NULL OR reading.recorded_at < $4)
           AND ($5::timestamptz IS NULL OR
             (reading.recorded_at, reading.reading_id) < ($5, $6::uuid))
         ORDER BY reading.recorded_at DESC, reading.reading_id DESC
         LIMIT $7`,
        [
          active.patientProfileId,
          input.metric ?? null,
          input.from ?? null,
          input.to ?? null,
          input.beforeRecordedAt ?? null,
          input.beforeReadingId ?? null,
          input.limit,
        ],
      );
      await client.query(
        `INSERT INTO break_glass_access_log
           (break_glass_grant_id, resource_type, resource_id, field_group, correlation_id)
         VALUES ($1,'patient_record',$2,'vital_readings',$3)`,
        [input.grantId, active.patientProfileId, input.correlationId],
      );
      return {
        patientProfileId: active.patientProfileId,
        readings: readings.rows,
      };
    });
  }

  /**
   * List health alerts under an active grant, logging the access in the SAME
   * transaction. Same grant-verification and audit-log pattern as
   * `listReadingsUnderBreakGlass`. The query mirrors
   * `VitalReadingRepository.listAlerts` exactly.
   */
  async listAlertsUnderBreakGlass(input: {
    readonly grantId: string;
    readonly actorMembershipId: string;
    readonly correlationId: string;
    readonly state?: string;
    readonly beforeObservedAt?: Date;
    readonly beforeAlertId?: string;
    readonly limit: number;
  }): Promise<BreakGlassAlertsResult | null> {
    return this.database.transaction(async (client) => {
      const grant = await client.query<{ patientProfileId: string }>(
        `SELECT patient_profile_id AS "patientProfileId"
           FROM break_glass_grants
          WHERE break_glass_grant_id = $1
            AND actor_membership_id = $2
            AND status = 'active'
            AND expires_at > now()`,
        [input.grantId, input.actorMembershipId],
      );
      const active = grant.rows[0];
      if (active === undefined) return null;

      const alerts = await client.query<HealthAlertRecord>(
        `SELECT alert.alert_id AS "alertId",
           alert.organization_id AS "organizationId",
           alert.patient_profile_id AS "patientProfileId",
           alert.device_id AS "deviceId", alert.metric,
           alert.observed_value::double precision AS "observedValue",
           alert.threshold_id AS "thresholdId", alert.severity, alert.state,
           alert.observed_at AS "observedAt",
           alert.acknowledged_by_profile_id AS "acknowledgedByProfileId",
           alert.acknowledged_at AS "acknowledgedAt",
           alert.resolved_at AS "resolvedAt",
           alert.version, alert.created_at AS "createdAt",
           alert.updated_at AS "updatedAt"
         FROM health_alerts alert
         WHERE alert.patient_profile_id = $1
           AND ($2::text IS NULL OR alert.state = $2::health_alert_state)
           AND ($3::timestamptz IS NULL OR
             (alert.observed_at, alert.alert_id) < ($3, $4::uuid))
         ORDER BY alert.observed_at DESC, alert.alert_id DESC
         LIMIT $5`,
        [
          active.patientProfileId,
          input.state ?? null,
          input.beforeObservedAt ?? null,
          input.beforeAlertId ?? null,
          input.limit,
        ],
      );
      await client.query(
        `INSERT INTO break_glass_access_log
           (break_glass_grant_id, resource_type, resource_id, field_group, correlation_id)
         VALUES ($1,'patient_record',$2,'health_alerts',$3)`,
        [input.grantId, active.patientProfileId, input.correlationId],
      );
      return {
        patientProfileId: active.patientProfileId,
        alerts: alerts.rows,
      };
    });
  }

  async terminateBreakGlass(input: {
    readonly grantId: string;
    readonly actorMembershipId: string;
    readonly reasonCode: string;
    readonly correlationId: string;
  }): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const terminated = await client.query(
        `UPDATE break_glass_grants
            SET status = 'terminated', terminated_at = now(), termination_reason_code = $3
          WHERE break_glass_grant_id = $1 AND actor_membership_id = $2 AND status = 'active'`,
        [input.grantId, input.actorMembershipId, input.reasonCode],
      );
      if ((terminated.rowCount ?? 0) === 0) return false;
      const accessed = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM break_glass_access_log WHERE break_glass_grant_id = $1',
        [input.grantId],
      );
      await client.query(
        `INSERT INTO outbox_events
           (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
            payload,correlation_id,occurred_at)
         VALUES (uuidv7(),$1,$2,'break_glass_grant',$3,0,$4::jsonb,$5,now())`,
        [BREAK_GLASS_TERMINATED_EVENT_TYPE, BREAK_GLASS_TERMINATED_EVENT_VERSION,
          input.grantId, JSON.stringify({
            break_glass_grant_id: input.grantId,
            termination_reason_code: input.reasonCode,
            accessed_resource_count: Number(accessed.rows[0]?.count ?? '0'),
          }), input.correlationId],
      );
      return true;
    });
  }

  /** Retrospective review. The actor is read from the grant, never from the request. */
  async reviewBreakGlass(input: {
    readonly grantId: string;
    readonly reviewerMembershipId: string;
    readonly reviewerProfileId: string;
    readonly outcome: 'justified' | 'unjustified' | 'inconclusive';
    readonly notes: string;
  }): Promise<{ readonly ok: true } | { readonly ok: false;
    readonly reason: 'not_found' | 'self_review' | 'already_reviewed' }> {
    const grant = await this.database.query<{ actorProfileId: string }>(
      `SELECT actor_profile_id AS "actorProfileId" FROM break_glass_grants
        WHERE break_glass_grant_id = $1`,
      [input.grantId],
    );
    const actorProfileId = grant.rows[0]?.actorProfileId;
    if (actorProfileId === undefined) return { ok: false, reason: 'not_found' };
    // Checked here for a clear refusal, and independently by a database CHECK so the
    // rule holds even if a future caller forgets it.
    if (actorProfileId === input.reviewerProfileId) return { ok: false, reason: 'self_review' };
    try {
      await this.database.query(
        `INSERT INTO break_glass_reviews
           (break_glass_grant_id, reviewer_membership_id, reviewer_profile_id,
            actor_profile_id, outcome, notes)
         VALUES ($1,$2,$3,$4,$5::break_glass_review_outcome,$6)`,
        [input.grantId, input.reviewerMembershipId, input.reviewerProfileId,
          actorProfileId, input.outcome, input.notes],
      );
    } catch (error) {
      const code = typeof error === 'object' && error !== null
        ? (error as { readonly code?: unknown }).code : undefined;
      if (code === '23505') return { ok: false, reason: 'already_reviewed' };
      throw error;
    }
    return { ok: true };
  }
}
