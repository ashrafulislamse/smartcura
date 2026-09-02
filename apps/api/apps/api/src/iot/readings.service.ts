import { Injectable } from '@nestjs/common';
import { PostgresConnection } from '@smartcura/database';
import { createNotification } from '@smartcura/database/consultations';
import {
  serializeHealthAlert,
  serializeVitalReading,
  VitalReadingRepository,
  type AcknowledgeAlertResult,
  type HealthAlertRecord,
  type IngestBatchOutcome,
  type IngestBatchResult,
  type IotActorContext,
  type VitalReadingRecord,
} from '@smartcura/database/iot';
import { evaluatePermission } from '@smartcura/policy';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import {
  correlationId,
  problem,
  validationFailed,
  validationFailedWithDetails,
} from '../platform/problems.js';
import {
  acknowledgeHealthAlertSchema,
  transitionHealthAlertSchema,
  devicePathSchema,
  healthAlertPathSchema,
  ingestVitalReadingsSchema,
  listHealthAlertsQuerySchema,
  listReadingsQuerySchema,
  organizationPathSchema,
  patientProfilePathSchema,
  uuidV7Schema,
  type ListHealthAlertsQuery,
  type ListReadingsQuery,
} from './iot-request.schemas.js';

/**
 * The permission that authorizes ingestion.
 *
 * Its scope suffix, `device`, is not one of the five the policy engine parses
 * (`own`, `assigned`, `site`, `organization`, `global`), so `parsePermission`
 * rejects it and `evaluatePermission` answers `invalid_permission` for every
 * caller — see the note in migration 0014 and HANDOFF-0014.md, which record the
 * `PermissionScope` extension this is waiting on. Until that lands the grant is
 * proved by explicit membership of the acting role's granted list, which is the
 * same set `role_permissions` holds and the same set the repository re-checks by
 * `permission_id` under lock. It is never routed through `evaluatePermission`,
 * which would deny everyone and read as a configuration fault.
 */
const READING_INGEST_PERMISSION = 'reading:ingest:device';

/**
 * Accepted replay window for a submitted packet, 30 days.
 *
 * This is the same window `vital_reading_ingest_claims.expires_at` is written
 * with, and the two must agree: a packet older than its claim's lifetime can no
 * longer be proved unseen, because the claim that would have caught the duplicate
 * may already have been purged. Accepting it would create exactly the duplicate
 * the ledger exists to prevent, so anything older is counted as rejected. Thirty
 * days is the figure the capacity plan budgets ledger storage for, and it is long
 * enough for a device that spent weeks offline to upload its buffer intact.
 */
const REPLAY_WINDOW_MS = 2_592_000_000;

/**
 * Tolerated device clock lead, five minutes.
 *
 * A reading stamped in the future is a clock fault, not a measurement, and storing
 * it would break `vital_readings_ingested_order_check` and put the row in a
 * partition that has not started yet. Some lead has to be allowed: field devices
 * drift and many have no reliable time source between synchronisations. Five
 * minutes absorbs ordinary drift while keeping a badly wrong clock — the kind that
 * would scatter a patient's chart across the wrong days — out of the store.
 */
const CLOCK_SKEW_TOLERANCE_MS = 300_000;

@Injectable()
export class ReadingsService {
  constructor(
    private readonly readings: VitalReadingRepository,
    private readonly authorization: SessionAuthorizationService,
    private readonly connection: PostgresConnection,
  ) {}

  /**
   * Ingests a batch of readings from one device.
   *
   * WHY THERE IS NO `Idempotency-Key` ON THIS ROUTE: deduplication already has an
   * authority, and a second one would be weaker. Every reading carries its own
   * packet identity, `(device_id, boot_id, sequence_number)`, and
   * `vital_reading_ingest_claims` holds that as a primary key on an unpartitioned
   * table, claimed in the same transaction as the reading insert. A redelivered
   * packet therefore claims nothing, stores nothing, raises no alert and is simply
   * counted as deduplicated — per reading, at any batch boundary, in any order. An
   * `Idempotency-Key` deduplicates whole requests instead: a client that resent the
   * same buffer split differently, or with one new reading appended, would present
   * a new key and be treated as a fresh batch, so the header would add work and a
   * false sense of safety without closing any hole the ledger leaves open.
   *
   * 202 Accepted, not 201: the response reports how the batch was classified, and
   * a batch is routinely part-accepted, part-deduplicated and part-rejected. There
   * is no single created resource to point at.
   */
  async ingest(
    current: AuthenticatedSession,
    organizationIdValue: string,
    deviceIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parseOrganizationPath(organizationIdValue);
    const deviceId = parseDevicePath(deviceIdValue);
    const request = parseIngest(bodyValue);
    const authorized = await this.authorizeIngest(current, organizationId, deviceId);
    const result = await this.readings.ingestBatch({
      deviceId,
      organizationId,
      actorProfileId: authorized.aggregate.profile.profileId,
      actor: ingestActor(authorized),
      readings: request.readings.map((reading) => ({
        bootId: reading.boot_id,
        sequenceNumber: reading.sequence_number,
        metric: reading.metric,
        value: reading.value,
        unit: reading.unit,
        recordedAt: new Date(reading.recorded_at),
        quality: reading.quality,
      })),
      replayWindowMs: REPLAY_WINDOW_MS,
      clockSkewToleranceMs: CLOCK_SKEW_TOLERANCE_MS,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') {
      if (result.accepted > 0) {
        await this.maybeNotifyVitalsReceived(result.patientProfileId, result.deviceId);
      }
      return serializeIngestOutcome(result);
    }
    return this.ingestFailure(authorized, organizationId, deviceId, result);
  }

  /**
   * Notifies the patient that new vital readings were received, throttled to
   * once per 30 minutes to avoid spam from frequent ESP32 publishes. The
   * notification is created outside the ingest transaction (the readings are
   * already committed by the time this runs), so a failure here does not roll
   * back stored readings.
   */
  private async maybeNotifyVitalsReceived(patientProfileId: string, deviceId: string): Promise<void> {
    await this.connection.transaction(async (client) => {
      const recent = await client.query(
        `SELECT 1 FROM notifications
         WHERE profile_id = $1 AND category = 'vitals_update'
         AND created_at > NOW() - INTERVAL '30 minutes'
         LIMIT 1`,
        [patientProfileId],
      );
      if ((recent.rowCount ?? 0) > 0) return;

      await createNotification(client, {
        profileId: patientProfileId,
        category: 'vitals_update',
        resourceType: 'vital_reading',
        resourceId: deviceId,
        titleCode: 'vitals.received.title',
        bodyCode: 'vitals.received.body',
        correlationId: correlationId(),
        now: new Date(),
      });
    }).catch(() => {
      // A notification failure must not break the ingest response — the
      // readings are already stored and the 202 has already been earned.
    });
  }

  /**
   * The acting profile's own reading history, newest first.
   *
   * `patientProfileId` is taken from the session and never from the query. The
   * route has no patient parameter at all, so there is nothing to substitute: an
   * identifier in a query string is the one thing a caller can always change.
   */
  async listOwnReadings(
    current: AuthenticatedSession,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const query = parseListReadings(queryValue);
    await this.authorizeOwnRead(current);
    return this.readingPage(current.aggregate.profile.profileId, query);
  }

  /**
   * A patient's reading history for the clinician actively assigned to them.
   *
   * Authority comes from an active care assignment and from nothing else — not from
   * sharing an organization, and not from an administrative role. Migration 0014
   * grants `reading:read:assigned` to `doctor` only and deliberately gives `admin`
   * no clinical read scope at all.
   */
  async listPatientReadings(
    current: AuthenticatedSession,
    patientProfileIdValue: string,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const patientProfileId = parsePatientProfilePath(patientProfileIdValue);
    const query = parseListReadings(queryValue);
    await this.authorizeCareAssignment(
      current, patientProfileId, 'reading:read:assigned', 'reading.read.assigned',
    );
    return this.readingPage(patientProfileId, query);
  }

  /**
   * Health alerts raised for an actively assigned patient, newest first, optionally
   * narrowed to one state. Same care-assignment rule as the reading history: an
   * alert names a patient and a breached clinical threshold.
   */
  async listPatientAlerts(
    current: AuthenticatedSession,
    patientProfileIdValue: string,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const patientProfileId = parsePatientProfilePath(patientProfileIdValue);
    const query = parseListAlerts(queryValue);
    await this.authorizeCareAssignment(
      current, patientProfileId, 'alert:read:assigned', 'health_alert.list',
    );
    const cursor = query.cursor === undefined ? undefined : decodeAlertCursor(query.cursor);
    const records = await this.readings.listAlerts({
      patientProfileId,
      ...(query.state === undefined ? {} : { state: query.state }),
      ...(cursor === undefined ? {} : {
        beforeObservedAt: cursor.observedAt,
        beforeAlertId: cursor.alertId,
      }),
      limit: query.page_size + 1,
    });
    const hasMore = records.length > query.page_size;
    const page = hasMore ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return {
      data: page.map(serializeHealthAlert),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeAlertCursor(last) : null,
      },
    };
  }

  /**
   * Acknowledges an alert: a clinician taking responsibility for a breach.
   *
   * The alert is read first only to learn which organization and patient it belongs
   * to, so the care assignment can be proved before anything is disclosed. That
   * check is then made again inside the transaction, under a share lock on the
   * assignment rows, because a clinician whose assignment ended between the two
   * must not be able to acknowledge. The acting membership is passed as
   * `clinicianMembershipId`: the assignment belongs to a membership, not to a
   * profile, so a doctor with two memberships acknowledges only where the
   * assignment actually is.
   */
  async acknowledgeAlert(
    current: AuthenticatedSession,
    alertIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const alertId = parseHealthAlertPath(alertIdValue);
    const request = parseAcknowledge(bodyValue);
    const alert = await this.readings.getAlert(alertId);
    // Concealed as absent: whether an alert exists for a patient the caller has no
    // relationship with is itself sensitive, and a 403 would confirm it.
    if (alert === undefined) {
      return this.deny(
        current, null, 'health_alert', alertId, 'health_alert.acknowledge', 404,
        'RESOURCE_NOT_FOUND', 'Health alert was not found',
      );
    }
    const authorized = await this.authorizeCareAssignment(
      current, alert.patientProfileId, 'alert:acknowledge:assigned',
      'health_alert.acknowledge', alert.organizationId, 'health_alert', alertId,
    );
    const membershipId = requireActiveMembershipId(authorized);
    const active = activeMembership(authorized);
    // The alert must belong to the organization the acting membership is in. The
    // repository refuses the mismatch too, as `actor_permission_denied`; catching
    // it here keeps the answer a concealing 404 instead of a confirming 403.
    if (active === undefined || active.organizationId !== alert.organizationId) {
      return this.deny(
        current, null, 'health_alert', alertId, 'health_alert.acknowledge', 404,
        'RESOURCE_NOT_FOUND', 'Health alert was not found',
      );
    }
    const result = await this.readings.acknowledge({
      alertId,
      organizationId: alert.organizationId,
      actorProfileId: authorized.aggregate.profile.profileId,
      actor: careActor(authorized, 'alert:acknowledge:assigned'),
      clinicianMembershipId: membershipId,
      expectedVersion: request.expected_version,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') return serializeHealthAlert(result);
    return this.acknowledgeFailure(authorized, alert.organizationId, alertId, result);
  }

  /**
   * Escalates, resolves or dismisses an alert. Authority is the same assigned-care
   * relationship acknowledgement requires, plus the explicit
   * `iot.alert:escalate:assigned` grant, and the repository re-proves both inside
   * the transaction while the alert row is locked.
   */
  async transitionAlert(
    current: AuthenticatedSession,
    alertIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const alertId = parseHealthAlertPath(alertIdValue);
    const request = parseTransition(bodyValue);
    const action = `health_alert.${request.state}`;
    const alert = await this.readings.getAlert(alertId);
    if (alert === undefined) {
      return this.deny(
        current, null, 'health_alert', alertId, action, 404,
        'RESOURCE_NOT_FOUND', 'Health alert was not found',
      );
    }
    const authorized = await this.authorizeCareAssignment(
      current, alert.patientProfileId, 'iot.alert:escalate:assigned',
      action, alert.organizationId, 'health_alert', alertId,
    );
    const membershipId = requireActiveMembershipId(authorized);
    const active = activeMembership(authorized);
    if (active === undefined || active.organizationId !== alert.organizationId) {
      return this.deny(
        current, null, 'health_alert', alertId, action, 404,
        'RESOURCE_NOT_FOUND', 'Health alert was not found',
      );
    }
    const result = await this.readings.transitionAlert({
      alertId,
      organizationId: alert.organizationId,
      nextState: request.state,
      reasonCode: request.reason_code,
      escalatedToMembershipId: request.escalated_to_membership_id,
      actorProfileId: authorized.aggregate.profile.profileId,
      actor: careActor(authorized, 'iot.alert:escalate:assigned'),
      clinicianMembershipId: membershipId,
      expectedVersion: request.expected_version,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') return serializeHealthAlert(result);
    return this.acknowledgeFailure(authorized, alert.organizationId, alertId, result);
  }

  /** Shared newest-first reading page for both the own and assigned read paths. */
  private async readingPage(
    patientProfileId: string,
    query: ListReadingsQuery,
  ): Promise<Record<string, unknown>> {
    const cursor = query.cursor === undefined ? undefined : decodeReadingCursor(query.cursor);
    const records = await this.readings.listReadings({
      patientProfileId,
      ...(query.metric === undefined ? {} : { metric: query.metric }),
      ...(query.device_id === undefined ? {} : { deviceId: query.device_id }),
      ...(query.from === undefined ? {} : { from: new Date(query.from) }),
      ...(query.to === undefined ? {} : { to: new Date(query.to) }),
      ...(cursor === undefined ? {} : {
        beforeRecordedAt: cursor.recordedAt,
        beforeReadingId: cursor.readingId,
      }),
      limit: query.page_size + 1,
    });
    const hasMore = records.length > query.page_size;
    const page = hasMore ? records.slice(0, query.page_size) : records;
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
   * Ingestion authority.
   *
   * The grant is checked by explicit list membership rather than through
   * `evaluatePermission`, for the reason recorded on `READING_INGEST_PERMISSION`.
   * The role then decides which actor the repository re-proves:
   *
   * - a `patient` acts as `self`, so the repository additionally refuses any device
   *   whose open assignment is not theirs. That is the whole reason a patient may
   *   ingest at all, and it is why a patient is not given a membership actor, which
   *   would let them submit for any device in the organization;
   * - any other granted role — `admin`, submitting on behalf of a gateway or the
   *   simulator — acts as `membership`, and the repository re-checks the grant by
   *   `permission_id` under lock.
   */
  private async authorizeIngest(
    current: AuthenticatedSession,
    organizationId: string,
    deviceId: string,
  ): Promise<AuthenticatedSession> {
    const action = 'reading.ingest';
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, organizationId, 'device', deviceId, action, 403, 'PERMISSION_DENIED',
        'Profile onboarding is incomplete',
      );
    }
    const active = activeMembership(current);
    if (active === undefined || active.status !== 'active') {
      return this.deny(
        current, organizationId, 'device', deviceId, action, 403, 'MEMBERSHIP_INACTIVE',
        'An active membership is required',
      );
    }
    if (active.organizationId !== organizationId) {
      return this.deny(
        current, organizationId, 'device', deviceId, action, 404, 'RESOURCE_NOT_FOUND',
        'Organization was not found',
      );
    }
    if (!active.permissions.includes(READING_INGEST_PERMISSION)) {
      return this.deny(
        current, organizationId, 'device', deviceId, action, 403, 'PERMISSION_DENIED',
        'Reading ingestion is not permitted',
      );
    }
    return this.authorization.touch(current);
  }

  /**
   * Own-scope read authority. `reading:read:own` is decidable from the session
   * alone, so `PermissionGuard` has already rejected a caller without it; this is
   * the same decision made again with the audit trail the guard cannot write for a
   * reading object, and it is what makes the route safe if the decorator is ever
   * removed.
   */
  private async authorizeOwnRead(
    current: AuthenticatedSession,
  ): Promise<AuthenticatedSession> {
    const action = 'reading.read.own';
    const profileId = current.aggregate.profile.profileId;
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, null, 'profile', profileId, action, 403, 'PERMISSION_DENIED',
        'Profile onboarding is incomplete',
      );
    }
    const active = activeMembership(current);
    if (active === undefined || active.status !== 'active') {
      return this.deny(
        current, null, 'profile', profileId, action, 403, 'MEMBERSHIP_INACTIVE',
        'An active membership is required',
      );
    }
    const decision = evaluatePermission(active.permissions, 'reading:read:own', {
      actorProfileId: profileId,
      ownerProfileId: profileId,
    });
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      return this.deny(
        current, null, 'profile', profileId, action, 403, code,
        'Vital readings are not readable for this membership',
      );
    }
    return this.authorization.touch(current);
  }

  /**
   * Assigned-scope authority, proved by an ACTIVE CARE ASSIGNMENT and nothing else.
   *
   * `care_assignments` is the only source of truth for `assigned` scope, so the
   * relationship is looked up before the permission is evaluated and the result is
   * fed in as the object-policy context. `PermissionGuard` cannot do this: it
   * supplies owner context only, so an `assigned` requirement denies every caller
   * there, which is why these routes carry no `@RequirePermission`.
   *
   * A missing care assignment answers 404, not 403. Whether a given person is a
   * patient of this organization at all is itself sensitive, and a 403 would
   * confirm it to anyone who could guess a profile identifier. The refusal is still
   * audited as `CARE_ASSIGNMENT_REQUIRED`, so the reason is recoverable by an
   * auditor even though it is invisible to the caller.
   */
  private async authorizeCareAssignment(
    current: AuthenticatedSession,
    patientProfileId: string,
    permission: string,
    action: string,
    organizationId: string | null = null,
    objectType: 'device' | 'health_alert' | 'profile' = 'profile',
    objectId: string = patientProfileId,
  ): Promise<AuthenticatedSession> {
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, organizationId, objectType, objectId, action, 403, 'PERMISSION_DENIED',
        'Profile onboarding is incomplete',
      );
    }
    const active = activeMembership(current);
    if (active === undefined || active.status !== 'active') {
      return this.deny(
        current, organizationId, objectType, objectId, action, 403, 'MEMBERSHIP_INACTIVE',
        'An active membership is required',
      );
    }
    const assigned = await this.readings.hasActiveCareAssignment(
      active.membershipId, patientProfileId,
    );
    if (!assigned) {
      return this.deny(
        current, organizationId, objectType, objectId, action, 404, 'RESOURCE_NOT_FOUND',
        'Patient was not found', 'CARE_ASSIGNMENT_REQUIRED',
      );
    }
    const decision = evaluatePermission(active.permissions, permission, {
      actorProfileId: current.aggregate.profile.profileId,
      assigned: true,
    });
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      return this.deny(
        current, organizationId, objectType, objectId, action, 403, code,
        'Access is not permitted for this patient',
      );
    }
    return this.authorization.touch(current);
  }

  private async ingestFailure(
    current: AuthenticatedSession,
    organizationId: string,
    deviceId: string,
    result: Extract<IngestBatchResult, string>,
  ): Promise<never> {
    switch (result) {
      case 'device_not_found':
        return this.deny(
          current, organizationId, 'device', deviceId, 'reading.ingest', 404,
          'RESOURCE_NOT_FOUND', 'Device was not found',
        );
      case 'device_not_ingestible':
        return this.deny(
          current, organizationId, 'device', deviceId, 'reading.ingest', 409,
          'DEVICE_NOT_INGESTIBLE',
          'Only an active device may submit readings',
        );
      case 'device_not_assigned':
        return this.deny(
          current, organizationId, 'device', deviceId, 'reading.ingest', 409,
          'DEVICE_NOT_ASSIGNED',
          'The device has no open patient assignment to attribute readings to',
        );
      case 'patient_mismatch':
        // Concealed as absent, and audited as an object-policy refusal: telling a
        // patient that the device they addressed belongs to somebody else is a
        // disclosure in itself.
        return this.deny(
          current, organizationId, 'device', deviceId, 'reading.ingest', 404,
          'RESOURCE_NOT_FOUND', 'Device was not found', 'OBJECT_ACCESS_DENIED',
        );
      default:
        return this.actorFailure(
          current, organizationId, 'device', deviceId, 'reading.ingest', result,
        );
    }
  }

  private async acknowledgeFailure(
    current: AuthenticatedSession,
    organizationId: string,
    alertId: string,
    result: Extract<AcknowledgeAlertResult, string>,
  ): Promise<never> {
    const action = 'health_alert.acknowledge';
    switch (result) {
      case 'not_found':
        return this.deny(
          current, organizationId, 'health_alert', alertId, action, 404,
          'RESOURCE_NOT_FOUND', 'Health alert was not found',
        );
      case 'version_conflict':
        return this.deny(
          current, organizationId, 'health_alert', alertId, action, 409,
          'HEALTH_ALERT_VERSION_CONFLICT', 'Health alert version is stale',
        );
      case 'alert_not_open':
        return this.deny(
          current, organizationId, 'health_alert', alertId, action, 409,
          'HEALTH_ALERT_NOT_OPEN', 'A resolved health alert cannot be acknowledged',
        );
      case 'care_assignment_required':
        // Not concealed as 404 here: the caller has already been shown this alert
        // by a read that proved the assignment, so the honest answer is that the
        // assignment ended in between rather than that the alert never existed.
        return this.deny(
          current, organizationId, 'health_alert', alertId, action, 403,
          'CARE_ASSIGNMENT_REQUIRED',
          'The care assignment authorizing this acknowledgement is no longer active',
        );
      default:
        return this.actorFailure(
          current, organizationId, 'health_alert', alertId, action, result,
        );
    }
  }

  private async actorFailure(
    current: AuthenticatedSession,
    organizationId: string | null,
    objectType: 'device' | 'health_alert' | 'profile',
    objectId: string,
    action: string,
    result: 'actor_session_invalid' | 'actor_permission_denied' | 'actor_step_up_required',
  ): Promise<never> {
    switch (result) {
      case 'actor_session_invalid':
        return this.deny(
          current, organizationId, objectType, objectId, action, 401,
          'APP_SESSION_INVALID', 'The session is no longer valid',
        );
      case 'actor_permission_denied':
        return this.deny(
          current, organizationId, objectType, objectId, action, 403,
          'PERMISSION_DENIED', 'Access is not permitted',
        );
      case 'actor_step_up_required':
        return this.deny(
          current, organizationId, objectType, objectId, action, 403,
          'STEP_UP_REQUIRED', 'A current MFA step-up is required',
        );
    }
  }

  /**
   * Audits the refusal, then throws it. `auditCode` exists for the concealed
   * refusals: the caller is told 404 while the audit row records the real reason,
   * so concealment costs the operator no visibility.
   */
  private async deny(
    current: AuthenticatedSession,
    organizationId: string | null,
    objectType: 'device' | 'health_alert' | 'profile',
    objectId: string | null,
    action: string,
    status: number,
    code: string,
    title: string,
    auditCode: string = code,
  ): Promise<never> {
    const requestCorrelationId = correlationId();
    await this.readings.recordDenial(
      organizationId,
      objectType,
      objectId,
      current.aggregate.profile.profileId,
      action,
      auditCode,
      requestCorrelationId,
    );
    throw problem(status, code, title, requestCorrelationId);
  }
}

/**
 * The single ingest outcome representation. Counts and identifiers only: the
 * classification a client needs to decide whether to retry, plus the identifiers
 * of the readings this call stored so a device can retire them from its buffer.
 */
function serializeIngestOutcome(outcome: IngestBatchOutcome): Record<string, unknown> {
  return {
    device_id: outcome.deviceId,
    patient_profile_id: outcome.patientProfileId,
    accepted: outcome.accepted,
    deduplicated: outcome.deduplicated,
    rejected: outcome.rejected,
    alerts_raised: outcome.alertsRaised,
    accepted_readings: outcome.acceptedReadings.map((reading) => ({
      id: reading.readingId,
      metric: reading.metric,
      value: reading.value,
      unit: reading.unit,
      recorded_at: reading.recordedAt.toISOString(),
      quality: reading.quality,
    })),
  };
}

/**
 * The ingestion actor. A patient acts as `self` so the repository binds the
 * submission to the device actually assigned to them; every other granted role
 * acts under its membership and grant.
 *
 * `requireStepUp` is FALSE. Ingestion is the routine act the whole subsystem
 * exists for — a monitor uploads continuously, and a patient's phone relays in the
 * background — so a step-up requirement would either drop clinical data or teach
 * people to keep elevated sessions open permanently, which is strictly worse than
 * not asking.
 */
function ingestActor(authorized: AuthenticatedSession): IotActorContext {
  const active = activeMembership(authorized);
  if (active === undefined) throw new Error('Authorized membership context is missing');
  if (active.roleId === 'patient') {
    return {
      kind: 'self',
      sessionId: authorized.aggregate.session.sessionId,
      tokenHash: authorized.tokenHash,
    };
  }
  return {
    kind: 'membership',
    sessionId: authorized.aggregate.session.sessionId,
    tokenHash: authorized.tokenHash,
    membershipId: active.membershipId,
    requiredPermission: READING_INGEST_PERMISSION,
    requireStepUp: false,
  };
}

/**
 * The clinical read and acknowledgement actor.
 *
 * `requireStepUp` is FALSE. Reading a chart and acknowledging an alert are the
 * ordinary work of a shift, performed dozens of times an hour; a fresh MFA
 * challenge on each would delay a response to a critical alert, which is the
 * opposite of what the alert is for. Authority still rests on an active care
 * assignment, re-proved under lock, which is the narrower control.
 */
function careActor(
  authorized: AuthenticatedSession,
  permission: string,
): IotActorContext {
  return {
    kind: 'membership',
    sessionId: authorized.aggregate.session.sessionId,
    tokenHash: authorized.tokenHash,
    membershipId: requireActiveMembershipId(authorized),
    requiredPermission: permission,
    requireStepUp: false,
  };
}

function activeMembership(current: AuthenticatedSession) {
  return current.aggregate.memberships.find(
    (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
  );
}

function requireActiveMembershipId(current: AuthenticatedSession): string {
  const membershipId = current.aggregate.session.activeMembershipId;
  if (membershipId === null) throw new Error('Authorized membership context is missing');
  return membershipId;
}

function parseOrganizationPath(value: string): string {
  const result = organizationPathSchema.safeParse({ organizationId: value });
  if (!result.success) throw validationFailed();
  return result.data.organizationId;
}

function parseDevicePath(value: string): string {
  const result = devicePathSchema.safeParse({ deviceId: value });
  if (!result.success) throw validationFailed();
  return result.data.deviceId;
}

function parsePatientProfilePath(value: string): string {
  const result = patientProfilePathSchema.safeParse({ patientProfileId: value });
  if (!result.success) throw validationFailed();
  return result.data.patientProfileId;
}

function parseHealthAlertPath(value: string): string {
  const result = healthAlertPathSchema.safeParse({ alertId: value });
  if (!result.success) throw validationFailed();
  return result.data.alertId;
}

function parseIngest(value: unknown) {
  const result = ingestVitalReadingsSchema.safeParse(value);
  if (!result.success) throw validationFailedWithDetails(result.error.issues);
  return result.data;
}

function parseListReadings(value: unknown): ListReadingsQuery {
  const result = listReadingsQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseListAlerts(value: unknown): ListHealthAlertsQuery {
  const result = listHealthAlertsQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseAcknowledge(value: unknown) {
  const result = acknowledgeHealthAlertSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseTransition(value: unknown) {
  const result = transitionHealthAlertSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

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
 * Base64url JSON keyset cursor, the same encoding the appointment and slot
 * listings use. It is opaque to the client but not secret: it carries only the
 * sort key of the last row on the page, and the identifier is re-validated as a
 * UUIDv7 so a tampered cursor is a validation failure rather than a query
 * parameter.
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
    return { instant, id: parseUuidV7(idValue) };
  } catch {
    throw validationFailed();
  }
}

function parseUuidV7(value: string): string {
  const result = uuidV7Schema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}
