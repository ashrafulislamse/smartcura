import { Injectable } from '@nestjs/common';
import {
  EmergencyRepository,
  type EmergencyEventStatus,
  type EmergencyUnitStatus,
  type TriagePriority,
} from '@smartcura/database/emergency';
import {
  serializeVitalReading,
  serializeHealthAlert,
  type VitalReadingRecord,
  type HealthAlertRecord,
  type VitalMetricValue,
  type HealthAlertStateValue,
} from '@smartcura/database/iot';
import type { ZodType } from 'zod';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  activateBreakGlassSchema,
  listEmergenciesSchema,
  listEmergencyUnitsSchema,
  advanceEmergencySchema,
  raiseEmergencySchema,
  recordCommunicationSchema,
  recordTriageSchema,
  reserveUnitSchema,
  resolveEmergencySchema,
  reviewBreakGlassSchema,
  terminateBreakGlassSchema,
} from './emergency-request.schemas.js';
import {
  listReadingsQuerySchema,
  listHealthAlertsQuerySchema,
  uuidV7Schema,
  type ListReadingsQuery,
  type ListHealthAlertsQuery,
} from '../iot/iot-request.schemas.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class EmergencyService {
  constructor(private readonly emergency: EmergencyRepository) {}

  /**
   * Raise an SOS.
   *
   * The reporter is always the session. A patient may be named so a bystander or family
   * member can call for someone else, but naming any profile is not sufficient: raising
   * for another patient requires an active dependant relationship, otherwise anyone
   * could manufacture an emergency event for any profile — and an emergency event is
   * precisely what makes a break-glass grant possible.
   */
  /**
   * The dispatch queue for a site operator. Gated on `emergency.event:read:site`, the
   * same permission the per-event read uses, so the queue discloses nothing the detail
   * view would not already show to the same actor.
   */
  async listEvents(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listEmergenciesSchema, queryValue);
    // `operator()` cannot be used: it resolves an EVENT to enforce site scope, and a queue
    // has no event yet. So the membership is checked directly and the organization is
    // taken FROM it rather than from the request, which is what keeps the read scoped.
    const active = this.active(current);
    if (!active.permissions.includes('emergency.event:read:site')) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const rows = await this.emergency.listEvents({
      organizationId: active.organizationId,
      status: (query.status ?? null) as EmergencyEventStatus | null,
      triagePriority: (query.triage_priority ?? null) as TriagePriority | null,
      activeOnly: query.active_only !== 'false',
      limit: query.limit,
    });
    return {
      data: rows.map((row) => ({
        emergency_event_id: row.emergencyEventId,
        site_id: row.siteId,
        patient_profile_id: row.patientProfileId,
        reported_by_profile_id: row.reportedByProfileId,
        status: row.status,
        triage_priority: row.triagePriority,
        category_code: row.categoryCode,
        reason_code: row.reasonCode,
        // Decimal strings, never floats: re-serializing would change the stored value.
        latitude: row.latitude,
        longitude: row.longitude,
        address_text: row.addressText,
        version: row.version,
        created_at: row.createdAt.toISOString(),
        triaged_at: row.triagedAt?.toISOString() ?? null,
        dispatched_at: row.dispatchedAt?.toISOString() ?? null,
        on_scene_at: row.onSceneAt?.toISOString() ?? null,
        resolved_at: row.resolvedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * The fleet roster for a site operator. Gated on `emergency.fleet:read:site`, scoped
   * to the membership's organization. Ordered by availability, then call sign — so the
   * units a dispatcher can send NOW are at the top, not the most recently created ones.
   *
   * The roster carries no crew or location: `emergency_units` has no such columns, and
   * crew is a derived, time-windowed join through `responder_shifts` that is not surfaced
   * here. Fabricating either would repeat the mock's mistake.
   */
  async listUnits(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listEmergencyUnitsSchema, queryValue);
    const active = this.active(current);
    if (!active.permissions.includes('emergency.fleet:read:site')) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const rows = await this.emergency.listUnits({
      organizationId: active.organizationId,
      status: (query.status ?? null) as EmergencyUnitStatus | null,
      limit: query.limit,
    });
    return {
      data: rows.map((row) => ({
        emergency_unit_id: row.emergencyUnitId,
        organization_id: row.organizationId,
        site_id: row.siteId,
        call_sign: row.callSign,
        unit_type: row.unitType,
        status: row.status,
        capacity: row.capacity,
        version: row.version,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      })),
    };
  }
  async raise(current: AuthenticatedSession, value: unknown) {
    const request = parse(raiseEmergencySchema, value);
    const active = this.active(current);
    const reporterProfileId = current.aggregate.profile.profileId;
    const patientProfileId = request.patient_profile_id ?? reporterProfileId;
    if (patientProfileId !== reporterProfileId) {
      const permitted = await this.emergency.reporterMayActFor(
        reporterProfileId, patientProfileId,
      );
      if (!permitted) {
        throw problem(403, 'OBJECT_ACCESS_DENIED', 'Raising for this patient is not permitted');
      }
    }
    if (active.organizationId !== request.organization_id) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Organization was not found');
    }
    const event = await this.emergency.raise({
      organizationId: request.organization_id,
      patientProfileId,
      reportedByProfileId: reporterProfileId,
      siteId: request.site_id,
      categoryCode: request.category_code,
      latitude: request.latitude,
      longitude: request.longitude,
      addressText: request.address_text,
      vitals: request.vitals.map((vital) => ({
        metric: vital.metric,
        value: vital.value,
        unit: vital.unit,
        quality: vital.quality,
        measuredAt: new Date(vital.measured_at),
      })),
      correlationId: correlationId(),
    });
    return {
      emergency_event_id: event.emergencyEventId,
      status: event.status,
      triage_priority: event.triagePriority,
      version: event.version,
    };
  }

  /** Read an event. A patient sees their own; an emergency membership sees its site's. */
  async read(current: AuthenticatedSession, eventIdValue: string) {
    const eventId = id(eventIdValue);
    const event = await this.emergency.findEvent(eventId);
    const active = this.active(current);
    // Concealed rather than refused, so probing cannot enumerate emergencies.
    if (event === null) throw problem(404, 'RESOURCE_NOT_FOUND', 'Event was not found');
    const isPatient = event.patientProfileId === current.aggregate.profile.profileId;
    const isOperator = active.roleId === 'emergency'
      && active.organizationId === event.organizationId
      && active.permissions.includes('emergency.event:read:site');
    if (!isPatient && !isOperator) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Event was not found');
    }
    return {
      emergency_event_id: event.emergencyEventId,
      status: event.status,
      triage_priority: event.triagePriority,
      category_code: event.categoryCode,
      version: event.version,
    };
  }

  async triage(current: AuthenticatedSession, eventIdValue: string, value: unknown) {
    const eventId = id(eventIdValue);
    const request = parse(recordTriageSchema, value);
    const active = await this.operator(current, 'emergency.triage:manage:site', eventId);
    const result = await this.emergency.recordTriage({
      emergencyEventId: eventId,
      assessedByMembershipId: active.membershipId,
      priority: request.priority,
      protocolCode: request.protocol_code,
      reasonCode: request.reason_code,
      expectedVersion: request.expected_version,
      correlationId: correlationId(),
    });
    if (!result.ok) this.failure(result.reason);
    return { emergency_event_id: eventId, status: result.status,
      triage_priority: request.priority };
  }

  /** Atomic boundary 7: reserve the unit and transition the event together. */
  async reserveUnit(current: AuthenticatedSession, eventIdValue: string, value: unknown) {
    const eventId = id(eventIdValue);
    const request = parse(reserveUnitSchema, value);
    const active = await this.operator(current, 'emergency.dispatch:manage:site', eventId);
    // policy-matrix.md lists manual dispatch override as an emergency step-up action. It
    // was missing when this surface was built: overriding automatic unit selection is a
    // reviewable act, so it needs recent re-authentication and not merely a reason code.
    if (request.manual_override) this.requireStepUp(current);
    const result = await this.emergency.reserveUnit({
      emergencyEventId: eventId,
      emergencyUnitId: request.emergency_unit_id,
      assignedByMembershipId: active.membershipId,
      manualOverride: request.manual_override,
      overrideReasonCode: request.override_reason_code,
      expectedVersion: request.expected_version,
      correlationId: correlationId(),
    });
    if (!result.ok) this.failure(result.reason);
    return {
      emergency_dispatch_id: result.emergencyDispatchId,
      emergency_event_id: eventId,
      status: 'unit_assigned',
    };
  }

  async advance(current: AuthenticatedSession, eventIdValue: string, value: unknown) {
    const eventId = id(eventIdValue);
    const request = parse(advanceEmergencySchema, value);
    await this.operator(current, 'emergency.dispatch:manage:site', eventId);
    const result = await this.emergency.advance({
      emergencyEventId: eventId,
      next: request.status,
      reasonCode: request.reason_code,
      expectedVersion: request.expected_version,
      correlationId: correlationId(),
    });
    if (!result.ok) this.failure(result.reason);
    return { emergency_event_id: eventId, status: result.status };
  }

  async resolve(current: AuthenticatedSession, eventIdValue: string, value: unknown) {
    const eventId = id(eventIdValue);
    const request = parse(resolveEmergencySchema, value);
    const active = await this.operator(current, 'emergency.resolution:create:site', eventId);
    const result = await this.emergency.resolve({
      emergencyEventId: eventId,
      resolvedByMembershipId: active.membershipId,
      resolutionType: request.resolution_type,
      notes: request.notes,
      outcomeCode: request.outcome_code,
      expectedVersion: request.expected_version,
      correlationId: correlationId(),
    });
    if (!result.ok) this.failure(result.reason);
    return {
      emergency_event_id: eventId,
      resolution_type: request.resolution_type,
      // Computed by the database from the event's own creation instant, never supplied.
      response_duration_seconds: result.responseDurationSeconds,
    };
  }

  async recordCommunication(
    current: AuthenticatedSession, eventIdValue: string, value: unknown,
  ) {
    const eventId = id(eventIdValue);
    const request = parse(recordCommunicationSchema, value);
    const active = await this.operator(current, 'emergency.communication:manage:site', eventId);
    const recorded = await this.emergency.recordCommunication({
      emergencyEventId: eventId,
      actorMembershipId: active.membershipId,
      channel: request.channel,
      direction: request.direction,
      summaryCode: request.summary_code,
    });
    if (!recorded) {
      throw problem(409, 'EMERGENCY_EVENT_CLOSED', 'The event is no longer active');
    }
    return { emergency_event_id: eventId, recorded: true };
  }

  /**
   * Activate break-glass.
   *
   * ACTIVATION ALONE IS NEVER READ AUTHORITY. Policy requires the actor to hold BOTH
   * `break_glass:activate` AND the underlying unscoped clinical permission, so both are
   * checked here. Recent step-up is also required, because break-glass is listed as a
   * step-up action for the doctor and emergency roles.
   */
  async activateBreakGlass(current: AuthenticatedSession, value: unknown) {
    const request = parse(activateBreakGlassSchema, value);
    const active = this.active(current);
    if (active.roleId !== 'doctor' && active.roleId !== 'emergency') {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    if (!active.permissions.includes('break_glass:activate')) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    // The underlying clinical permission, without which a grant would confer authority
    // the actor does not otherwise have.
    if (!active.permissions.includes('patient.record:read')) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    this.requireStepUp(current);
    const event = await this.emergency.findEvent(request.emergency_event_id);
    if (event === null || event.organizationId !== active.organizationId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Event was not found');
    }
    const result = await this.emergency.activateBreakGlass({
      actorMembershipId: active.membershipId,
      actorProfileId: current.aggregate.profile.profileId,
      organizationId: active.organizationId,
      // Taken from the EVENT, not the request: a grant must describe the patient the
      // emergency is actually about.
      patientProfileId: event.patientProfileId,
      emergencyEventId: request.emergency_event_id,
      reasonCode: request.reason_code,
      reasonDetail: request.reason_detail,
      renewsGrantId: request.renews_grant_id,
      grantMinutes: request.grant_minutes,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      if (result.reason === 'already_active') {
        throw problem(409, 'BREAK_GLASS_ALREADY_ACTIVE', 'An active grant already exists');
      }
      throw problem(409, 'BREAK_GLASS_NOT_PERMITTED', 'The grant conditions are not met');
    }
    return {
      break_glass_grant_id: result.grantId,
      patient_profile_id: event.patientProfileId,
      expires_at: result.expiresAt.toISOString(),
    };
  }

  /** Minimum-necessary disclosure under an active grant; every read is logged. */
  async readUnderBreakGlass(current: AuthenticatedSession, grantIdValue: string) {
    const grantId = id(grantIdValue);
    const active = this.active(current);
    if (!active.permissions.includes('patient.record:read')) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const disclosure = await this.emergency.readUnderBreakGlass({
      grantId,
      actorMembershipId: active.membershipId,
      correlationId: correlationId(),
    });
    // An expired, terminated or foreign grant reads nothing, concealed as not found.
    if (disclosure === null) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'No active grant was found');
    }
    return {
      break_glass_grant_id: grantId,
      patient_profile_id: disclosure.patientProfileId,
      display_name: disclosure.displayName,
      allergies: disclosure.allergies.map((allergy) => ({
        substance: allergy.substance,
        severity: allergy.severity,
        reaction: allergy.reaction,
      })),
      active_conditions: disclosure.conditions.map((condition) => ({
        condition_name: condition.conditionName,
        status: condition.status,
      })),
    };
  }

  /**
   * Vital readings under an active break-glass grant.
   *
   * Same authorization as `readUnderBreakGlass`: the actor must hold
   * `patient.record:read`. The grant itself IS the object-level authority — an
   * expired, terminated or foreign grant returns null and is concealed as 404.
   * Every read is logged to `break_glass_access_log` with `field_group =
   * 'vital_readings'` in the same transaction as the read.
   */
  async readVitalsUnderBreakGlass(
    current: AuthenticatedSession,
    grantIdValue: string,
    queryValue: unknown,
  ) {
    const grantId = id(grantIdValue);
    const active = this.active(current);
    if (!active.permissions.includes('patient.record:read')) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const query = parseReadingsQuery(queryValue);
    const cursor = query.cursor === undefined ? undefined : decodeReadingCursor(query.cursor);
    const result = await this.emergency.listReadingsUnderBreakGlass({
      grantId,
      actorMembershipId: active.membershipId,
      correlationId: correlationId(),
      ...(query.metric === undefined ? {} : { metric: query.metric }),
      ...(query.from === undefined ? {} : { from: new Date(query.from) }),
      ...(query.to === undefined ? {} : { to: new Date(query.to) }),
      ...(cursor === undefined ? {} : {
        beforeRecordedAt: cursor.recordedAt,
        beforeReadingId: cursor.readingId,
      }),
      limit: query.page_size + 1,
    });
    if (result === null) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'No active grant was found');
    }
    const hasMore = result.readings.length > query.page_size;
    const page = hasMore ? result.readings.slice(0, query.page_size) : result.readings;
    const last = page.at(-1);
    return {
      data: page.map(serializeVitalReading),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeReadingCursor(last) : null,
      },
    };
  }

  /**
   * Health alerts under an active break-glass grant.
   *
   * Same authorization and audit-log pattern as `readVitalsUnderBreakGlass`,
   * with `field_group = 'health_alerts'`.
   */
  async readAlertsUnderBreakGlass(
    current: AuthenticatedSession,
    grantIdValue: string,
    queryValue: unknown,
  ) {
    const grantId = id(grantIdValue);
    const active = this.active(current);
    if (!active.permissions.includes('patient.record:read')) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const query = parseAlertsQuery(queryValue);
    const cursor = query.cursor === undefined ? undefined : decodeAlertCursor(query.cursor);
    const result = await this.emergency.listAlertsUnderBreakGlass({
      grantId,
      actorMembershipId: active.membershipId,
      correlationId: correlationId(),
      ...(query.state === undefined ? {} : { state: query.state }),
      ...(cursor === undefined ? {} : {
        beforeObservedAt: cursor.observedAt,
        beforeAlertId: cursor.alertId,
      }),
      limit: query.page_size + 1,
    });
    if (result === null) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'No active grant was found');
    }
    const hasMore = result.alerts.length > query.page_size;
    const page = hasMore ? result.alerts.slice(0, query.page_size) : result.alerts;
    const last = page.at(-1);
    return {
      data: page.map(serializeHealthAlert),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeAlertCursor(last) : null,
      },
    };
  }

  async terminateBreakGlass(
    current: AuthenticatedSession, grantIdValue: string, value: unknown,
  ) {
    const grantId = id(grantIdValue);
    const request = parse(terminateBreakGlassSchema, value);
    const active = this.active(current);
    const terminated = await this.emergency.terminateBreakGlass({
      grantId,
      actorMembershipId: active.membershipId,
      reasonCode: request.reason_code,
      correlationId: correlationId(),
    });
    if (!terminated) throw problem(404, 'RESOURCE_NOT_FOUND', 'No active grant was found');
    return { break_glass_grant_id: grantId, status: 'terminated' };
  }

  /**
   * Retrospective review. Deliberately requires `break_glass:review`, which is seeded
   * only to administrative roles, and the actor is read from the grant so the not-self
   * rule cannot be defeated by supplying someone else's identity.
   */
  async reviewBreakGlass(current: AuthenticatedSession, grantIdValue: string, value: unknown) {
    const grantId = id(grantIdValue);
    const request = parse(reviewBreakGlassSchema, value);
    const active = this.active(current);
    if (!active.permissions.includes('break_glass:review')) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const result = await this.emergency.reviewBreakGlass({
      grantId,
      reviewerMembershipId: active.membershipId,
      reviewerProfileId: current.aggregate.profile.profileId,
      outcome: request.outcome,
      notes: request.notes,
    });
    if (!result.ok) {
      if (result.reason === 'not_found') {
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Grant was not found');
      }
      if (result.reason === 'self_review') {
        throw problem(403, 'BREAK_GLASS_SELF_REVIEW', 'An actor cannot review their own use');
      }
      throw problem(409, 'BREAK_GLASS_ALREADY_REVIEWED', 'The grant is already reviewed');
    }
    return { break_glass_grant_id: grantId, outcome: request.outcome };
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
   * An emergency operator acting on an event in their own organization.
   *
   * The PermissionGuard cannot evaluate `site` scope, because it has no object context,
   * so the site/organization relationship is enforced HERE. Failure is concealed as a
   * 404 for the same reason event reads are: confirming an emergency exists is a leak.
   */
  private async operator(
    current: AuthenticatedSession, permission: string, emergencyEventId: string,
  ) {
    const active = this.active(current);
    if (active.roleId !== 'emergency') {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    if (!active.permissions.includes(permission)) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const event = await this.emergency.findEvent(emergencyEventId);
    if (event === null || event.organizationId !== active.organizationId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Event was not found');
    }
    return { membershipId: active.membershipId, event };
  }

  private requireStepUp(current: AuthenticatedSession) {
    const validUntil = current.aggregate.session.stepUpValidUntil ?? null;
    if (validUntil === null || validUntil.getTime() <= Date.now()) {
      throw problem(403, 'STEP_UP_REQUIRED', 'Recent step-up authentication is required');
    }
  }

  private failure(value: string): never {
    if (value === 'conflict') {
      throw problem(409, 'EMERGENCY_VERSION_CONFLICT', 'The event changed');
    }
    if (value === 'unit_unavailable') {
      throw problem(409, 'EMERGENCY_UNIT_UNAVAILABLE', 'The unit is not available');
    }
    if (value === 'already_resolved') {
      throw problem(409, 'EMERGENCY_ALREADY_RESOLVED', 'The event is already resolved');
    }
    throw problem(409, 'EMERGENCY_TRANSITION_INVALID', 'The transition is not allowed');
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

// ---------------------------------------------------------------------------
// Break-glass vitals/alerts cursor and query helpers
// ---------------------------------------------------------------------------

interface ReadingCursor {
  readonly recordedAt: Date;
  readonly readingId: string;
}

interface AlertCursor {
  readonly observedAt: Date;
  readonly alertId: string;
}

function encodeReadingCursor(record: VitalReadingRecord): string {
  return Buffer.from(JSON.stringify({
    recorded_at: record.recordedAt.toISOString(),
    reading_id: record.readingId,
  }), 'utf8').toString('base64url');
}

function decodeReadingCursor(value: string): ReadingCursor {
  const cursor = decodeCursor(value, 'recorded_at', 'reading_id');
  return { recordedAt: cursor.instant, readingId: cursor.id };
}

function encodeAlertCursor(record: HealthAlertRecord): string {
  return Buffer.from(JSON.stringify({
    observed_at: record.observedAt.toISOString(),
    alert_id: record.alertId,
  }), 'utf8').toString('base64url');
}

function decodeAlertCursor(value: string): AlertCursor {
  const cursor = decodeCursor(value, 'observed_at', 'alert_id');
  return { observedAt: cursor.instant, alertId: cursor.id };
}

/**
 * Base64url JSON keyset cursor — same encoding as the readings service. Opaque
 * to the client but not secret: it carries only the sort key of the last row on
 * the page, and the identifier is re-validated as UUIDv7 so a tampered cursor is
 * a validation failure.
 */
function decodeCursor(
  value: string,
  instantField: string,
  idField: string,
): { readonly instant: Date; readonly id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (typeof decoded !== 'object' || decoded === null) throw new Error();
    const candidate = decoded as Record<string, unknown>;
    const instantValue = candidate[instantField];
    const idValue = candidate[idField];
    if (typeof instantValue !== 'string' || typeof idValue !== 'string') throw new Error();
    const instant = new Date(instantValue);
    if (!Number.isFinite(instant.getTime())) throw new Error();
    const uuidParse = uuidV7Schema.safeParse(idValue);
    if (!uuidParse.success) throw new Error();
    return { instant, id: idValue };
  } catch {
    throw validationFailed();
  }
}

function parseReadingsQuery(value: unknown): ListReadingsQuery {
  const result = listReadingsQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseAlertsQuery(value: unknown): ListHealthAlertsQuery {
  const result = listHealthAlertsQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}
