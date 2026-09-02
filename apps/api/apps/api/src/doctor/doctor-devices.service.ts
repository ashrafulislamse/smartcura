import { Injectable } from '@nestjs/common';
import {
  DeviceRepository,
  serializeDevice,
  type AssignDeviceResult,
  type DeviceRecord,
  type IotActorContext,
  type ReleaseDeviceResult,
} from '@smartcura/database/iot';
import { VitalReadingRepository } from '@smartcura/database/iot';
import { PostgresConnection } from '@smartcura/database';
import { evaluatePermission } from '@smartcura/policy';
import { problem, validationFailed } from '../platform/problems.js';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import type { SessionMembershipRecord } from '@smartcura/database';
import { z } from 'zod';
import {
  assignDeviceSchema,
  devicePathSchema,
  releaseDeviceSchema,
} from '../iot/iot-request.schemas.js';
import { deviceListQuerySchema, type DeviceListQuery } from './doctor-devices.schemas.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Doctor-scoped IoT device service.
 *
 * GET /doctor/devices returns the IoT devices assigned to the current doctor's
 * ACTIVE patients only — not the whole organization's devices. The scope is
 * derived entirely from the session: the active doctor membership is resolved
 * from `current.aggregate.session.activeMembershipId`, and the patient set is
 * the set of `patient_profile_id` values on `care_assignments` rows where
 * `clinician_membership_id` is that membership and `status = 'active'`.
 *
 * POST /doctor/devices/:deviceId/assignments and .../release let a doctor
 * assign or release a device to/from a patient under their own active care.
 * The `device:assign:assigned` permission (seeded in 0046) authorises this,
 * and the DeviceRepository re-proves the care assignment with a FOR SHARE
 * lock inside the write transaction (TOCTOU closure).
 *
 * GET /doctor/available-devices lists devices in the doctor's organization
 * that have no open assignment and are in a assignable state (provisioned or
 * active), so the doctor can pick one to assign.
 *
 * AUTHORIZATION mirrors `DoctorService.doctor()` and
 * `WorkstreamFService.assignedPatients`: the caller must hold an active
 * membership with `role_id = 'doctor'` and the
 * `profile_detail:read:assigned` permission. Assign/release additionally
 * require `device:assign:assigned`. A non-doctor membership or a revoked
 * membership is refused with 403.
 */
@Injectable()
export class DoctorDevicesService {
  constructor(
    private readonly database: PostgresConnection,
    private readonly deviceRepo: DeviceRepository,
    private readonly readings: VitalReadingRepository,
  ) {}

  async devices(
    current: AuthenticatedSession,
    queryValue: unknown,
  ): Promise<{
    data: ReturnType<typeof deviceResponse>[];
    page: { has_more: boolean; next_cursor: string | null };
  }> {
    const active = this.doctor(current);
    const query = parseList(queryValue);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const records = await listDoctorDevices(this.database, {
      clinicianMembershipId: active.membershipId,
      ...(query.state === undefined ? {} : { state: query.state }),
      ...(query.device_type === undefined ? {} : { deviceType: query.device_type }),
      afterCreatedAt: cursor?.createdAt,
      afterDeviceId: cursor?.deviceId,
      limit: query.page_size + 1,
    });
    const hasMore = records.length > query.page_size;
    const page = hasMore ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return {
      data: page.map(deviceResponse),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeCursor(last) : null,
      },
    };
  }

  /**
   * Devices in the doctor's organization with no open assignment, available for
   * assignment to one of their patients. Only `provisioned` or `active` devices
   * are returned — a suspended or retired device is not assignable. Uses the
   * full `serializeDevice` projection (including `version`, which the assign
   * body requires as `expected_version`).
   */
  async availableDevices(
    current: AuthenticatedSession,
    queryValue: unknown,
  ): Promise<{
    data: ReturnType<typeof serializeDevice>[];
    page: { has_more: boolean; next_cursor: string | null };
  }> {
    const active = this.doctor(current);
    const query = parseList(queryValue);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const records = await this.deviceRepo.listAvailableDevices({
      organizationId: active.organizationId,
      afterCreatedAt: cursor?.createdAt,
      afterDeviceId: cursor?.deviceId,
      limit: query.page_size + 1,
    });
    const hasMore = records.length > query.page_size;
    const page = hasMore ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return {
      data: page.map(serializeDevice),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeFullCursor(last) : null,
      },
    };
  }

  /**
   * Assign a device to a patient the doctor is actively assigned to.
   *
   * The care assignment is checked HERE (concealment: 404 if the doctor has no
   * active care assignment to the named patient) AND re-proved with a FOR SHARE
   * lock inside the DeviceRepository.assign transaction. The dual check closes
   * the TOCTOU gap and prevents probing: a doctor who names a patient they do
   * not treat learns nothing about whether the patient exists.
   */
  async assignDevice(
    current: AuthenticatedSession,
    deviceIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const active = this.doctor(current);
    const deviceId = parseDevicePath(deviceIdValue);
    const request = parseAssign(bodyValue);

    // Concealment: a doctor naming a patient they do not treat gets 404, not 403,
    // so the route cannot be walked to discover which patients exist.
    const assigned = await this.readings.hasActiveCareAssignment(
      active.membershipId,
      request.patient_profile_id,
    );
    if (!assigned) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Patient was not found');
    }

    const decision = evaluatePermission(
      active.permissions,
      'device:assign:assigned',
      {
        actorProfileId: current.aggregate.profile.profileId,
        membershipOrganizationId: active.organizationId,
        assigned: true,
      },
    );
    if (!decision.allowed) {
      throw problem(403, 'PERMISSION_DENIED', 'Device assignment is not permitted');
    }

    const result = await this.deviceRepo.assign({
      organizationId: active.organizationId,
      deviceId,
      patientProfileId: request.patient_profile_id,
      actorProfileId: current.aggregate.profile.profileId,
      actor: clinicianActor(current, active, 'device:assign:assigned'),
      expectedVersion: request.expected_version,
      now: new Date(),
      correlationId: crypto.randomUUID(),
      clinicianMembershipId: active.membershipId,
    });
    if (typeof result !== 'string') return serializeDevice(result);
    return this.assignFailure(result);
  }

  /**
   * Release a device from the patient it is currently assigned to, provided that
   * patient is under the doctor's active care.
   *
   * The device is loaded first to discover its current open assignment's
   * `patient_profile_id`, which the doctor must have an active care assignment
     to. The repository re-proves this with a FOR SHARE lock inside the release
     * transaction.
   */
  async releaseDevice(
    current: AuthenticatedSession,
    deviceIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const active = this.doctor(current);
    const deviceId = parseDevicePath(deviceIdValue);
    const request = parseRelease(bodyValue);

    // Load the device to find its current open assignment's patient. A device
    // in another organization is reported as absent, not forbidden.
    const device = await this.deviceRepo.getById(active.organizationId, deviceId);
    if (device === undefined) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
    }
    if (device.activeAssignment === null) {
      throw problem(409, 'DEVICE_NOT_ASSIGNED', 'Device has no open assignment to release');
    }

    const assigned = await this.readings.hasActiveCareAssignment(
      active.membershipId,
      device.activeAssignment.patientProfileId,
    );
    if (!assigned) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
    }

    const decision = evaluatePermission(
      active.permissions,
      'device:assign:assigned',
      {
        actorProfileId: current.aggregate.profile.profileId,
        membershipOrganizationId: active.organizationId,
        assigned: true,
      },
    );
    if (!decision.allowed) {
      throw problem(403, 'PERMISSION_DENIED', 'Device release is not permitted');
    }

    const result = await this.deviceRepo.release({
      organizationId: active.organizationId,
      deviceId,
      actorProfileId: current.aggregate.profile.profileId,
      actor: clinicianActor(current, active, 'device:assign:assigned'),
      expectedVersion: request.expected_version,
      reasonCode: request.reason_code,
      now: new Date(),
      correlationId: crypto.randomUUID(),
      clinicianMembershipId: active.membershipId,
    });
    if (typeof result !== 'string') return serializeDevice(result);
    return this.releaseFailure(result);
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

  private assignFailure(result: Extract<AssignDeviceResult, string>): never {
    switch (result) {
      case 'not_found':
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
      case 'version_conflict':
        throw problem(409, 'DEVICE_VERSION_CONFLICT', 'Device version is stale');
      case 'device_not_assignable':
        throw problem(409, 'DEVICE_NOT_ASSIGNABLE',
          'A suspended or retired device cannot be assigned to a patient');
      case 'already_assigned':
        throw problem(409, 'DEVICE_ALREADY_ASSIGNED',
          'Device already has an open assignment');
      case 'patient_not_eligible':
        throw problem(422, 'VALIDATION_FAILED',
          'The named patient profile is not eligible for a device assignment');
      case 'care_assignment_required':
        // The care assignment was revoked between the HTTP check and the write.
        // Conceal as 404 rather than revealing the patient exists.
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Patient was not found');
      default:
        throw problem(403, 'PERMISSION_DENIED', 'Device assignment is not permitted');
    }
  }

  private releaseFailure(result: Extract<ReleaseDeviceResult, string>): never {
    switch (result) {
      case 'not_found':
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
      case 'version_conflict':
        throw problem(409, 'DEVICE_VERSION_CONFLICT', 'Device version is stale');
      case 'not_assigned':
        throw problem(409, 'DEVICE_NOT_ASSIGNED',
          'Device has no open assignment to release');
      case 'care_assignment_required':
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found');
      default:
        throw problem(403, 'PERMISSION_DENIED', 'Device release is not permitted');
    }
  }
}

// ---------------------------------------------------------------------------
// Actor context — mirrors DevicesService.administrativeActor but for a doctor
// ---------------------------------------------------------------------------

/**
 * `requireStepUp` is FALSE for the FYP demo, matching the admin path's
 * relaxation in `DevicesService.administrativeActor`. Assigning a device to a
 * patient a doctor is already treating is a routine clinical act, not a
 * break-glass escalation. Restore `true` before production hardening.
 */
function clinicianActor(
  current: AuthenticatedSession,
  active: SessionMembershipRecord,
  permission: string,
): IotActorContext {
  return {
    kind: 'membership',
    sessionId: current.aggregate.session.sessionId,
    tokenHash: current.tokenHash,
    membershipId: active.membershipId,
    requiredPermission: permission,
    requireStepUp: false,
  };
}

// ---------------------------------------------------------------------------
// Repository-style query (kept in this file so no database/src file is touched)
// ---------------------------------------------------------------------------

/**
 * A device row scoped through the doctor's active care assignments.
 *
 * `patientProfileId` is the patient the device is currently assigned to (via
 * the open `device_assignments` row) who is also an active patient of the
 * doctor (via `care_assignments`). A device with no open assignment does not
 * appear: the doctor's authority over a device is transitive through the
 * patient it is bound to, and an unassigned device has no such binding.
 */
export interface DoctorDeviceRecord {
  readonly deviceId: string;
  readonly serialNumber: string;
  readonly deviceType: string;
  readonly state: string;
  readonly lastSeenAt: Date | null;
  readonly patientProfileId: string;
  readonly version: number;
  readonly createdAt: Date;
}

interface DoctorDeviceRow {
  readonly deviceId: string;
  readonly serialNumber: string;
  readonly deviceType: string;
  readonly state: string;
  readonly lastSeenAt: Date | null;
  readonly patientProfileId: string;
  readonly version: number;
  readonly createdAt: Date;
}

interface ListDoctorDevicesInput {
  readonly clinicianMembershipId: string;
  readonly state?: string | undefined;
  readonly deviceType?: string | undefined;
  readonly afterCreatedAt?: Date | undefined;
  readonly afterDeviceId?: string | undefined;
  readonly limit: number;
}

/**
 * Deterministic keyset pagination on `(device.created_at, device.device_id)`,
 * matching `DeviceRepository.list`. Both columns are needed because
 * `created_at` is not unique: a bulk import that registered two devices in the
 * same millisecond would otherwise repeat or skip one at the page boundary.
 *
 * The query joins:
 *   devices
 *   → device_assignments (open only, released_at IS NULL)
 *   → care_assignments (status = 'active', clinician_membership_id = doctor)
 *
 * DISTINCT because a device with one open assignment to a patient who has one
 * active care assignment to the doctor still produces one row per join path,
 * and `care_assignments_active_uq` guarantees at most one active assignment
 * per clinician/patient pair, so the DISTINCT is a safety net, not the
 * primary deduplication.
 */
async function listDoctorDevices(
  database: PostgresConnection,
  input: ListDoctorDevicesInput,
): Promise<DoctorDeviceRecord[]> {
  const result = await database.query<DoctorDeviceRow>(
    `SELECT DISTINCT
       device.device_id AS "deviceId",
       device.serial_number AS "serialNumber",
       device.device_type AS "deviceType",
       device.state,
       device.last_seen_at AS "lastSeenAt",
       device_assignment.patient_profile_id AS "patientProfileId",
       device.version,
       device.created_at AS "createdAt"
     FROM devices device
     JOIN device_assignments device_assignment
       ON device_assignment.device_id = device.device_id
       AND device_assignment.released_at IS NULL
     JOIN care_assignments care_assignment
       ON care_assignment.patient_profile_id = device_assignment.patient_profile_id
       AND care_assignment.status = 'active'
     WHERE care_assignment.clinician_membership_id = $1
       AND ($2::device_state IS NULL OR device.state = $2::device_state)
       AND ($3::device_type IS NULL OR device.device_type = $3::device_type)
       AND ($4::timestamptz IS NULL OR
         (device.created_at, device.device_id) > ($4, $5::uuid))
     ORDER BY device.created_at, device.device_id
     LIMIT $6`,
    [
      input.clinicianMembershipId,
      input.state ?? null,
      input.deviceType ?? null,
      input.afterCreatedAt ?? null,
      input.afterDeviceId ?? null,
      input.limit,
    ],
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Serialisation and cursor helpers
// ---------------------------------------------------------------------------

/**
 * Serialise a device to the response shape. `last_seen_at` is ISO-8601 or null
 * (the server never sends a formatted string). `patient_profile_id` is the
 * patient the device is currently assigned to — no name is resolved, because
 * `Profile` is reachable solely as `/profiles/me` and a name-resolution
 * endpoint does not exist yet (see AGENTS.md).
 */
function deviceResponse(r: DoctorDeviceRecord): Record<string, unknown> {
  return {
    id: r.deviceId,
    serial_number: r.serialNumber,
    device_type: r.deviceType,
    state: r.state,
    last_seen_at: r.lastSeenAt?.toISOString() ?? null,
    patient_profile_id: r.patientProfileId,
    version: r.version,
  };
}

interface DeviceCursor {
  readonly createdAt: Date;
  readonly deviceId: string;
}

function encodeCursor(record: DoctorDeviceRecord): string {
  return Buffer.from(
    JSON.stringify({
      created_at: record.createdAt.toISOString(),
      device_id: record.deviceId,
    }),
    'utf8',
  ).toString('base64url');
}

function encodeFullCursor(record: DeviceRecord): string {
  return Buffer.from(
    JSON.stringify({
      created_at: record.createdAt.toISOString(),
      device_id: record.deviceId,
    }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: string): DeviceCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (typeof decoded !== 'object' || decoded === null) throw new Error();
    const candidate = decoded as Record<string, unknown>;
    const createdAtValue = candidate['created_at'];
    const deviceIdValue = candidate['device_id'];
    if (typeof createdAtValue !== 'string' || typeof deviceIdValue !== 'string') {
      throw new Error();
    }
    const createdAt = new Date(createdAtValue);
    if (!Number.isFinite(createdAt.getTime())) throw new Error();
    const uuidParse = z.string().uuid().safeParse(deviceIdValue);
    if (!uuidParse.success) throw new Error();
    return { createdAt, deviceId: deviceIdValue };
  } catch {
    throw validationFailed();
  }
}

function parseList(value: unknown): DeviceListQuery {
  const result = deviceListQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseDevicePath(value: string): string {
  const result = devicePathSchema.safeParse({ deviceId: value });
  if (!result.success) throw validationFailed();
  return result.data.deviceId;
}

function parseAssign(value: unknown) {
  const result = assignDeviceSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseRelease(value: unknown) {
  const result = releaseDeviceSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}
