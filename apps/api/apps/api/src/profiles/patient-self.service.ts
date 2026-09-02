import { Injectable } from '@nestjs/common';
import {
  AppointmentRepository,
  serializeAppointment,
} from '@smartcura/database/appointments';
import {
  ConsultationRepository,
  PrescriptionRepository,
  serializeConsultation,
  serializePrescription,
} from '@smartcura/database/consultations';
import {
  serializeDevice,
  serializeHealthAlert,
  DeviceRepository,
  VitalReadingRepository,
  type DeviceRecord,
  type IotActorContext,
  type AssignDeviceResult,
  type ReleaseDeviceResult,
} from '@smartcura/database/iot';
import { evaluatePermission } from '@smartcura/policy';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import { SessionAuthorizationService } from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  ownCollectionListSchema,
  ownHealthAlertsQuerySchema,
  ownAssignDeviceSchema,
  ownReleaseDeviceSchema,
  type OwnCollectionListQuery,
  type OwnHealthAlertsQuery,
  type OwnAssignDeviceRequest,
  type OwnReleaseDeviceRequest,
} from './patient-self-request.schemas.js';

/**
 * The authenticated patient's own clinical and scheduling history.
 *
 * Every method here is `own`-scoped: the patient is ALWAYS the session's own
 * profile, taken from `current.aggregate.profile.profileId` and never from a
 * path or query parameter. An identifier in a query string is the one value a
 * caller can always change, so none of these routes accepts one. This is the
 * same rule `OwnVitalReadingsController` follows, and the reason the
 * `:own`-scoped permissions are decidable from the session alone: the owner is
 * the actor, so the shared `PermissionGuard` can reject a caller without the
 * grant before any query runs, and each service method re-proves the grant with
 * the audit trail the guard cannot write for a clinical object.
 */
@Injectable()
export class PatientSelfService {
  constructor(
    private readonly consultations: ConsultationRepository,
    private readonly prescriptions: PrescriptionRepository,
    private readonly readings: VitalReadingRepository,
    private readonly appointments: AppointmentRepository,
    private readonly devices: DeviceRepository,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  /**
   * The patient's own signed-or-active prescriptions, newest first. A draft is
   * the doctor's working copy the patient has not been handed, so it is excluded
   * by the repository; `signed`, `superseded`, `cancelled` and `expired` are all
   * included so the medication history is complete.
   */
  async listOwnPrescriptions(
    current: AuthenticatedSession,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const query = parseList(queryValue);
    await this.authorizeOwn(current, 'prescription:read:own', 'prescription.read.own');
    const cursor = query.cursor === undefined ? undefined : decodeCollectionCursor(query.cursor);
    const records = await this.prescriptions.listOwn({
      patientProfileId: current.aggregate.profile.profileId,
      ...(cursor === undefined ? {} : { afterCreatedAt: cursor.createdAt, afterId: cursor.id }),
      limit: query.page_size + 1,
    });
    return collectionPage(records, query.page_size, (record) => ({
      createdAt: record.createdAt.toISOString(),
      id: record.prescriptionId,
    }), serializePrescription);
  }

  /**
   * The patient's own past consultations, newest by `updated_at` so a
   * consultation that just completed surfaces first. Cursor-paginated on
   * `(updated_at, consultation_id)`.
   */
  async listOwnConsultations(
    current: AuthenticatedSession,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const query = parseList(queryValue);
    await this.authorizeOwn(current, 'consultation:read:own', 'consultation.read.own');
    const cursor = query.cursor === undefined ? undefined : decodeCollectionCursor(query.cursor);
    const records = await this.consultations.listOwnConsultations({
      patientProfileId: current.aggregate.profile.profileId,
      ...(cursor === undefined ? {} : { afterUpdatedAt: cursor.createdAt, afterId: cursor.id }),
      limit: query.page_size + 1,
    });
    return collectionPage(records, query.page_size, (record) => ({
      createdAt: record.updatedAt.toISOString(),
      id: record.consultationId,
    }), serializeConsultation);
  }

  /**
   * The patient's own health alerts, newest first. Same keyset and state filter
   * as the assigned-scope `listPatientAlerts`, but the patient is the session
   * and the authority is `alert:read:own` rather than a care assignment.
   */
  async listOwnHealthAlerts(
    current: AuthenticatedSession,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const query = parseAlerts(queryValue);
    await this.authorizeOwn(current, 'alert:read:own', 'health_alert.read.own');
    const cursor = query.cursor === undefined ? undefined : decodeAlertCursor(query.cursor);
    const records = await this.readings.listAlerts({
      patientProfileId: current.aggregate.profile.profileId,
      ...(query.state === undefined ? {} : { state: query.state }),
      ...(cursor === undefined ? {} : {
        beforeObservedAt: cursor.observedAt,
        beforeAlertId: cursor.alertId,
      }),
      limit: query.page_size + 1,
    });
    return collectionPage(records, query.page_size, (record) => ({
      createdAt: record.observedAt.toISOString(),
      id: record.alertId,
    }), serializeHealthAlert);
  }

  /**
   * The patient's next upcoming appointment, or 404 when there is none. A
   * convenience aggregate for the home screen: the earliest appointment whose
   * slot starts after `now` and whose status is still live. `now` is taken at
   * call time, never from the request, so a cached response can never report a
   * slot in the past as upcoming.
   */
  async findNextAppointment(
    current: AuthenticatedSession,
  ): Promise<Record<string, unknown>> {
    await this.authorizeOwn(current, 'appointment:read:own', 'appointment.read.own');
    const record = await this.appointments.findNextUpcoming({
      patientProfileId: current.aggregate.profile.profileId,
      now: new Date(),
    });
    if (record === undefined) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'No upcoming appointment was found');
    }
    return serializeAppointment(record);
  }

  /**
   * Devices currently assigned to the patient (open assignments only), newest
   * first. A patient can hold multiple open device assignments — the at-most-one
   * rule is per device, not per patient — so this can return more than one.
   *
   * Used by the mobile app's watch-sync flow: the patient needs to know the
   * deviceId to POST readings to the existing ingestion endpoint. The patient is
   * the session, the permission is `device:read:own` (seeded in 0045), and the
   * device id never comes from the request.
   */
  async listOwnDevices(
    current: AuthenticatedSession,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const query = parseList(queryValue);
    await this.authorizeOwn(current, 'device:read:own', 'device.read.own');
    const cursor = query.cursor === undefined ? undefined : decodeCollectionCursor(query.cursor);
    const records = await this.devices.listOwnDevices({
      patientProfileId: current.aggregate.profile.profileId,
      ...(cursor === undefined ? {} : { afterCreatedAt: cursor.createdAt, afterDeviceId: cursor.id }),
      limit: query.page_size + 1,
    });
    return collectionPage(records, query.page_size, (record) => ({
      createdAt: record.createdAt.toISOString(),
      id: record.deviceId,
    }), serializeDevice);
  }

  /**
   * One device assigned to the patient (open assignment only). The device id is
   * in the path; if it is not an open assignment of this patient the response is
   * a concealing 404, same rule `listOwnDevices` follows.
   */
  async getOwnDevice(
    current: AuthenticatedSession,
    deviceId: string,
  ): Promise<Record<string, unknown>> {
    await this.authorizeOwn(current, 'device:read:own', 'device.read.own');
    const record = await this.devices.getOwnDevice(
      current.aggregate.profile.profileId,
      deviceId,
    );
    if (record === undefined) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
    }
    return serializeDevice(record);
  }

  /**
   * Assigns an unassigned IoT device in the patient's organization to the
   * patient themselves. Requires `device:assign:own` (granted to patient in 0061).
   *
   * The device must be in the patient's organization and have no open
   * assignment. If it is already assigned to the patient, the existing device
   * is returned as a success so retries are idempotent. The device version is
   * read from the backend when the request omits `expected_version`, because
   * the patient has not yet read the device and cannot hold a stale version.
   */
  async assignOwnDevice(
    current: AuthenticatedSession,
    deviceIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    await this.authorizeOwn(current, 'device:assign:own', 'device.assign.own');
    const active = activeMembership(current);
    if (active === undefined) {
      throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    const deviceId = parseDeviceId(deviceIdValue);
    const request = parseOwnAssign(bodyValue);

    const device = await this.devices.getById(active.organizationId, deviceId);
    if (device === undefined) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
    }
    if (device.activeAssignment !== null) {
      if (device.activeAssignment.patientProfileId === current.aggregate.profile.profileId) {
        return serializeDevice(device);
      }
      throw problem(409, 'DEVICE_ALREADY_ASSIGNED', 'Device already has an open assignment');
    }
    if (device.state === 'suspended' || device.state === 'retired') {
      throw problem(409, 'DEVICE_NOT_ASSIGNABLE', 'A suspended or retired device cannot be assigned');
    }

    const expectedVersion = request.expected_version ?? device.version;
    const result = await this.devices.assign({
      organizationId: active.organizationId,
      deviceId,
      patientProfileId: current.aggregate.profile.profileId,
      actorProfileId: current.aggregate.profile.profileId,
      actor: selfActor(current),
      expectedVersion,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') return serializeDevice(result);
    return this.assignOwnFailure(result);
  }

  /**
   * Releases a device currently assigned to the patient. Requires
   * `device:release:own` (granted to patient in 0061).
   *
   * The device must be assigned to the patient; a device assigned to anyone
   * else or with no open assignment is reported as a concealing 404.
   */
  async releaseOwnDevice(
    current: AuthenticatedSession,
    deviceIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    await this.authorizeOwn(current, 'device:release:own', 'device.release.own');
    const active = activeMembership(current);
    if (active === undefined) {
      throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    const deviceId = parseDeviceId(deviceIdValue);
    const request = parseOwnRelease(bodyValue);

    const device = await this.devices.getById(active.organizationId, deviceId);
    if (device === undefined || device.activeAssignment === null) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
    }
    if (device.activeAssignment.patientProfileId !== current.aggregate.profile.profileId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
    }

    const result = await this.devices.release({
      organizationId: active.organizationId,
      deviceId,
      actorProfileId: current.aggregate.profile.profileId,
      actor: selfActor(current),
      expectedVersion: request.expected_version,
      reasonCode: request.reason_code,
      now: new Date(),
      correlationId: correlationId(),
      patientProfileId: current.aggregate.profile.profileId,
    });
    if (typeof result !== 'string') return serializeDevice(result);
    return this.releaseOwnFailure(result);
  }

  private assignOwnFailure(
    result: Exclude<AssignDeviceResult, DeviceRecord>,
  ): never {
    switch (result) {
      case 'not_found':
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
      case 'version_conflict':
        throw problem(409, 'DEVICE_VERSION_CONFLICT', 'Device version is stale');
      case 'device_not_assignable':
        throw problem(409, 'DEVICE_NOT_ASSIGNABLE', 'A suspended or retired device cannot be assigned');
      case 'already_assigned':
        throw problem(409, 'DEVICE_ALREADY_ASSIGNED', 'Device already has an open assignment');
      case 'patient_not_eligible':
        throw problem(422, 'VALIDATION_FAILED', 'The patient profile is not eligible for a device assignment');
      case 'care_assignment_required':
        throw problem(403, 'PERMISSION_DENIED', 'Device assignment is not permitted');
      case 'actor_session_invalid':
        throw problem(401, 'APP_SESSION_INVALID', 'The session is no longer valid');
      case 'actor_permission_denied':
        throw problem(403, 'PERMISSION_DENIED', 'Device assignment is not permitted');
      case 'actor_step_up_required':
        throw problem(403, 'STEP_UP_REQUIRED', 'A current MFA step-up is required');
    }
  }

  private releaseOwnFailure(
    result: Exclude<ReleaseDeviceResult, DeviceRecord>,
  ): never {
    switch (result) {
      case 'not_found':
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
      case 'version_conflict':
        throw problem(409, 'DEVICE_VERSION_CONFLICT', 'Device version is stale');
      case 'not_assigned':
      case 'care_assignment_required':
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
      case 'actor_session_invalid':
        throw problem(401, 'APP_SESSION_INVALID', 'The session is no longer valid');
      case 'actor_permission_denied':
        throw problem(403, 'PERMISSION_DENIED', 'Device release is not permitted');
      case 'actor_step_up_required':
        throw problem(403, 'STEP_UP_REQUIRED', 'A current MFA step-up is required');
    }
  }

  /**
   * Own-scope read authority. The `:own` permission is decidable from the
   * session alone — the owner is the actor — so `PermissionGuard` has already
   * rejected a caller without the grant. This is the same decision made again
   * with the audit trail the guard cannot write for a clinical object, and it is
   * what makes the route safe if the decorator is ever removed. It mirrors
   * `ReadingsService.authorizeOwnRead` exactly.
   */
  private async authorizeOwn(
    current: AuthenticatedSession,
    permission: string,
    action: string,
  ): Promise<AuthenticatedSession> {
    const profileId = current.aggregate.profile.profileId;
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, 'profile', profileId, action, 403, 'PERMISSION_DENIED',
        'Profile onboarding is incomplete',
      );
    }
    const active = activeMembership(current);
    if (active === undefined || active.status !== 'active') {
      return this.deny(
        current, 'profile', profileId, action, 403, 'MEMBERSHIP_INACTIVE',
        'An active membership is required',
      );
    }
    const decision = evaluatePermission(active.permissions, permission, {
      actorProfileId: profileId,
      ownerProfileId: profileId,
    });
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      return this.deny(
        current, 'profile', profileId, action, 403, code,
        'Access is not permitted for this membership',
      );
    }
    return this.authorization.touch(current);
  }

  private async deny(
    current: AuthenticatedSession,
    objectType: 'profile',
    objectId: string,
    action: string,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    const requestCorrelationId = correlationId();
    await this.readings.recordDenial(
      null,
      objectType,
      objectId,
      current.aggregate.profile.profileId,
      action,
      code,
      requestCorrelationId,
    );
    throw problem(status, code, title, requestCorrelationId);
  }
}

function activeMembership(current: AuthenticatedSession) {
  return current.aggregate.memberships.find(
    (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
  );
}

function parseDeviceId(value: string): string {
  if (!UUID_V7.test(value)) throw validationFailed();
  return value.toLowerCase();
}

function parseOwnAssign(value: unknown): OwnAssignDeviceRequest {
  const result = ownAssignDeviceSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseOwnRelease(value: unknown): OwnReleaseDeviceRequest {
  const result = ownReleaseDeviceSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function selfActor(current: AuthenticatedSession): IotActorContext {
  return {
    kind: 'self',
    sessionId: current.aggregate.session.sessionId,
    tokenHash: current.tokenHash,
  };
}

function parseList(value: unknown): OwnCollectionListQuery {
  const result = ownCollectionListSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseAlerts(value: unknown): OwnHealthAlertsQuery {
  const result = ownHealthAlertsQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

/**
 * Shared newest-first collection page. Fetches `limit + 1` rows so a single
 * overflow row proves there is another page without a separate count, slices the
 * page to the requested size, and encodes the last row's sort key as the opaque
 * cursor. The cursor serializer is per-collection because each list orders on a
 * different column, but the page envelope shape is identical.
 */
function collectionPage<T>(
  records: readonly T[],
  pageSize: number,
  cursorFor: (record: T) => { createdAt: string; id: string },
  serialize: (record: T) => Record<string, unknown>,
): Record<string, unknown> {
  const hasMore = records.length > pageSize;
  const page = hasMore ? records.slice(0, pageSize) : records;
  const last = page.at(-1);
  return {
    data: page.map(serialize),
    page: {
      has_more: hasMore,
      next_cursor: hasMore && last !== undefined ? encodeCursor(cursorFor(last)) : null,
    },
  };
}

function encodeCursor(value: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCollectionCursor(value: string): { createdAt: Date; id: string } {
  return decodeCursor(value, 'createdAt');
}

function decodeAlertCursor(value: string): { observedAt: Date; alertId: string } {
  const cursor = decodeCursor(value, 'createdAt');
  return { observedAt: cursor.createdAt, alertId: cursor.id };
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeCursor(value: string, instantField: string): { createdAt: Date; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (typeof decoded !== 'object' || decoded === null) throw new Error();
    const candidate = decoded as Record<string, unknown>;
    const instantValue = candidate[instantField];
    const idValue = candidate['id'];
    if (typeof instantValue !== 'string' || typeof idValue !== 'string') throw new Error();
    if (!UUID_V7.test(idValue)) throw new Error();
    const createdAt = new Date(instantValue);
    if (!Number.isFinite(createdAt.getTime())) throw new Error();
    return { createdAt, id: idValue };
  } catch {
    throw validationFailed();
  }
}
