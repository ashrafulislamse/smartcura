import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  DeviceRepository,
  serializeDevice,
  type AssignDeviceResult,
  type DeviceRecord,
  type IotActorContext,
  type RegisterDeviceResult,
  type ReleaseDeviceResult,
} from '@smartcura/database/iot';
import { evaluatePermission } from '@smartcura/policy';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  assignDeviceSchema,
  devicePathSchema,
  idempotencyKeySchema,
  listDevicesQuerySchema,
  organizationPathSchema,
  registerDeviceSchema,
  releaseDeviceSchema,
  type ListDevicesQuery,
} from './iot-request.schemas.js';

/** Replay window for a device registration `Idempotency-Key`. */
const IDEMPOTENCY_TTL_MS = 86_400_000;

@Injectable()
export class DevicesService {
  constructor(
    private readonly devices: DeviceRepository,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  /**
   * Devices in the acting administrator's own organization, cursor-paginated
   * deterministically on `(created_at, device_id)`. Both columns are in the key
   * because `created_at` is not unique: a bulk import that registered two devices
   * in the same millisecond would otherwise repeat or skip one at the page
   * boundary.
   */
  async list(
    current: AuthenticatedSession,
    organizationIdValue: string,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parseOrganizationPath(organizationIdValue);
    const query = parseList(queryValue);
    await this.authorizeOrganization(
      current, organizationId, null, 'device:read:organization', 'device.list',
    );
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const records = await this.devices.list({
      organizationId,
      ...(query.state === undefined ? {} : { state: query.state }),
      ...(cursor === undefined ? {} : {
        afterCreatedAt: cursor.createdAt,
        afterDeviceId: cursor.deviceId,
      }),
      limit: query.page_size + 1,
    });
    const hasMore = records.length > query.page_size;
    const page = hasMore ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return {
      data: page.map(serializeDevice),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeCursor(last) : null,
      },
    };
  }

  /**
   * Registers a device and the digest of its broker credential.
   *
   * WHY THE SECRET IS HASHED HERE AND NOWHERE ELSE: the client supplies the
   * plaintext `provisioning_secret` once, and this method is the only place it
   * exists in the process. It is turned into a SHA-256 lowercase hex digest and
   * only the digest is handed to the repository, which is all
   * `device_credentials.secret_hash` ever stores. The plaintext is not logged, not
   * echoed in the response, not written to audit metadata, and deliberately NOT
   * part of the idempotency request fingerprint below — a stored fingerprint is
   * readable by anyone who can read the idempotency table, and hashing the secret
   * into it would put a replayable broker credential in a second place for no
   * benefit. The fingerprint therefore covers the device identity a retry must not
   * be allowed to change, and nothing else.
   *
   * `Idempotency-Key` is mandatory: registration inserts a device and a credential
   * row, and a retried request must return the original device rather than fail on
   * the serial-number uniqueness index and leave the operator unsure which
   * registration won.
   */
  async register(
    current: AuthenticatedSession,
    organizationIdValue: string,
    idempotencyKeyValue: string | undefined,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parseOrganizationPath(organizationIdValue);
    const idempotencyKey = parseIdempotencyKey(idempotencyKeyValue);
    const request = parseRegister(bodyValue);
    const authorized = await this.authorizeOrganization(
      current, organizationId, null, 'device:register:organization', 'device.register',
    );
    const result = await this.devices.register({
      organizationId,
      actorProfileId: authorized.aggregate.profile.profileId,
      actor: administrativeActor(authorized, 'device:register:organization'),
      deviceType: request.device_type,
      serialNumber: request.serial_number,
      hardwareRevision: request.hardware_revision,
      firmwareVersion: request.firmware_version,
      credentialType: request.credential_type,
      credentialSecretHash: hashProvisioningSecret(request.provisioning_secret),
      idempotencyKey,
      requestHash: requestHash({
        organization_id: organizationId,
        device_type: request.device_type,
        serial_number: request.serial_number,
        credential_type: request.credential_type,
      }),
      idempotencyTtlMs: IDEMPOTENCY_TTL_MS,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') {
      return result.replayed ? result.snapshot.body : serializeDevice(result.record);
    }
    return this.registerFailure(authorized, organizationId, result);
  }

  /**
   * One device in the acting administrator's own organization. A device in another
   * organization is reported as absent rather than forbidden: the repository query
   * is scoped by organization, so a foreign identifier cannot be distinguished
   * from a made-up one, which is exactly the answer a probe deserves.
   */
  async get(
    current: AuthenticatedSession,
    organizationIdValue: string,
    deviceIdValue: string,
  ): Promise<Record<string, unknown>> {
    const organizationId = parseOrganizationPath(organizationIdValue);
    const deviceId = parseDevicePath(deviceIdValue);
    await this.authorizeOrganization(
      current, organizationId, deviceId, 'device:read:organization', 'device.read',
    );
    const record = await this.devices.getById(organizationId, deviceId);
    if (record === undefined) {
      return this.deny(
        current, organizationId, deviceId, 'device.read', 404, 'RESOURCE_NOT_FOUND',
        'Device was not found',
      );
    }
    return serializeDevice(record);
  }

  /**
   * Binds a device to a named patient. 200 rather than 201: the assignment has no
   * address of its own and is returned as part of the device it changes.
   *
   * `expected_version` is mandatory, and the at-most-one-open-assignment rule is a
   * partial unique index rather than a read-then-write here, so two concurrent
   * assignments cannot both succeed however this layer orders its calls.
   */
  async assign(
    current: AuthenticatedSession,
    organizationIdValue: string,
    deviceIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parseOrganizationPath(organizationIdValue);
    const deviceId = parseDevicePath(deviceIdValue);
    const request = parseAssign(bodyValue);
    const authorized = await this.authorizeOrganization(
      current, organizationId, deviceId, 'device:assign:organization', 'device.assign',
    );
    const result = await this.devices.assign({
      organizationId,
      deviceId,
      patientProfileId: request.patient_profile_id,
      actorProfileId: authorized.aggregate.profile.profileId,
      actor: administrativeActor(authorized, 'device:assign:organization'),
      expectedVersion: request.expected_version,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') return serializeDevice(result);
    return this.assignFailure(authorized, organizationId, deviceId, result);
  }

  /**
   * Closes the open assignment. History is appended to, never rewritten: a reading
   * recorded last month must stay attributable to the patient the device was
   * assigned to then.
   */
  async release(
    current: AuthenticatedSession,
    organizationIdValue: string,
    deviceIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parseOrganizationPath(organizationIdValue);
    const deviceId = parseDevicePath(deviceIdValue);
    const request = parseRelease(bodyValue);
    const authorized = await this.authorizeOrganization(
      current, organizationId, deviceId, 'device:assign:organization', 'device.release',
    );
    const result = await this.devices.release({
      organizationId,
      deviceId,
      actorProfileId: authorized.aggregate.profile.profileId,
      actor: administrativeActor(authorized, 'device:assign:organization'),
      expectedVersion: request.expected_version,
      reasonCode: request.reason_code,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') return serializeDevice(result);
    return this.releaseFailure(authorized, organizationId, deviceId, result);
  }

  /**
   * Fast rejection before any work, and the only place an organization-scoped
   * requirement can be decided at all: `PermissionGuard` evaluates object policy
   * with owner context only, so it supplies no `resourceOrganizationId` and an
   * `organization` scope denies every caller there. Here the acting membership's
   * own organization is both the resource organization and the membership
   * organization, which is what makes the scope meaningful.
   *
   * The repository re-proves all of this under lock inside the mutation
   * transaction, because between this check and the write the session can be
   * revoked, the membership suspended or the grant removed.
   */
  private async authorizeOrganization(
    current: AuthenticatedSession,
    organizationId: string,
    deviceId: string | null,
    permission: string,
    action: string,
  ): Promise<AuthenticatedSession> {
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, organizationId, deviceId, action, 403, 'PERMISSION_DENIED',
        'Profile onboarding is incomplete',
      );
    }
    const active = activeMembership(current);
    if (active === undefined || active.status !== 'active') {
      return this.deny(
        current, organizationId, deviceId, action, 403, 'MEMBERSHIP_INACTIVE',
        'An active membership is required',
      );
    }
    // A membership belongs to exactly one organization, so there is nothing to
    // choose: any other identifier in the path is a typo or a probe, and both
    // answer 404 so the route cannot be walked to discover which organizations
    // exist.
    if (active.organizationId !== organizationId) {
      return this.deny(
        current, organizationId, deviceId, action, 404, 'RESOURCE_NOT_FOUND',
        'Organization was not found',
      );
    }
    const decision = evaluatePermission(active.permissions, permission, {
      actorProfileId: current.aggregate.profile.profileId,
      resourceOrganizationId: organizationId,
      membershipOrganizationId: active.organizationId,
    });
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      return this.deny(
        current, organizationId, deviceId, action, 403, code,
        'Device administration is not permitted',
      );
    }
    return this.authorization.touch(current);
  }

  private async registerFailure(
    current: AuthenticatedSession,
    organizationId: string,
    result: Extract<RegisterDeviceResult, string>,
  ): Promise<never> {
    switch (result) {
      case 'organization_not_found':
        return this.deny(
          current, organizationId, null, 'device.register', 404, 'RESOURCE_NOT_FOUND',
          'Organization was not found',
        );
      case 'serial_number_conflict':
        // 409, not 422: the body is internally consistent and was legal when it
        // was written. The conflict is with state the caller cannot see.
        return this.deny(
          current, organizationId, null, 'device.register', 409,
          'DEVICE_SERIAL_NUMBER_CONFLICT',
          'A device with that serial number is already registered',
        );
      case 'idempotency_reused':
        return this.deny(
          current, organizationId, null, 'device.register', 409,
          'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused',
        );
      default:
        return this.actorFailure(current, organizationId, null, 'device.register', result);
    }
  }

  private async assignFailure(
    current: AuthenticatedSession,
    organizationId: string,
    deviceId: string,
    result: Extract<AssignDeviceResult, string>,
  ): Promise<never> {
    switch (result) {
      case 'not_found':
        return this.deny(
          current, organizationId, deviceId, 'device.assign', 404, 'RESOURCE_NOT_FOUND',
          'Device was not found',
        );
      case 'version_conflict':
        return this.deny(
          current, organizationId, deviceId, 'device.assign', 409,
          'DEVICE_VERSION_CONFLICT', 'Device version is stale',
        );
      case 'device_not_assignable':
        return this.deny(
          current, organizationId, deviceId, 'device.assign', 409,
          'DEVICE_NOT_ASSIGNABLE',
          'A suspended or retired device cannot be assigned to a patient',
        );
      case 'already_assigned':
        return this.deny(
          current, organizationId, deviceId, 'device.assign', 409,
          'DEVICE_ALREADY_ASSIGNED', 'Device already has an open assignment',
        );
      case 'patient_not_eligible':
        // 422: the body contradicts itself — it names a profile that cannot hold
        // an assignment at all, which is a property of the request, not a race.
        return this.deny(
          current, organizationId, deviceId, 'device.assign', 422, 'VALIDATION_FAILED',
          'The named patient profile is not eligible for a device assignment',
        );
      case 'care_assignment_required':
        // The admin path never sets clinicianMembershipId, so the repository
        // cannot return this. It is handled here for exhaustiveness so the
        // actorFailure call below receives only IotActorFailure values.
        return this.deny(
          current, organizationId, deviceId, 'device.assign', 403, 'PERMISSION_DENIED',
          'Device assignment is not permitted',
        );
      default:
        return this.actorFailure(current, organizationId, deviceId, 'device.assign', result);
    }
  }

  private async releaseFailure(
    current: AuthenticatedSession,
    organizationId: string,
    deviceId: string,
    result: Extract<ReleaseDeviceResult, string>,
  ): Promise<never> {
    switch (result) {
      case 'not_found':
        return this.deny(
          current, organizationId, deviceId, 'device.release', 404, 'RESOURCE_NOT_FOUND',
          'Device was not found',
        );
      case 'version_conflict':
        return this.deny(
          current, organizationId, deviceId, 'device.release', 409,
          'DEVICE_VERSION_CONFLICT', 'Device version is stale',
        );
      case 'not_assigned':
        return this.deny(
          current, organizationId, deviceId, 'device.release', 409, 'DEVICE_NOT_ASSIGNED',
          'Device has no open assignment to release',
        );
      case 'care_assignment_required':
        // The admin path never sets clinicianMembershipId, so the repository
        // cannot return this. Handled here for exhaustiveness.
        return this.deny(
          current, organizationId, deviceId, 'device.release', 403, 'PERMISSION_DENIED',
          'Device release is not permitted',
        );
      default:
        return this.actorFailure(current, organizationId, deviceId, 'device.release', result);
    }
  }

  private async actorFailure(
    current: AuthenticatedSession,
    organizationId: string,
    deviceId: string | null,
    action: string,
    result: 'actor_session_invalid' | 'actor_permission_denied' | 'actor_step_up_required',
  ): Promise<never> {
    switch (result) {
      case 'actor_session_invalid':
        return this.deny(
          current, organizationId, deviceId, action, 401, 'APP_SESSION_INVALID',
          'The session is no longer valid',
        );
      case 'actor_permission_denied':
        return this.deny(
          current, organizationId, deviceId, action, 403, 'PERMISSION_DENIED',
          'Device administration is not permitted',
        );
      case 'actor_step_up_required':
        return this.deny(
          current, organizationId, deviceId, action, 403, 'STEP_UP_REQUIRED',
          'A current MFA step-up is required',
        );
    }
  }

  private async deny(
    current: AuthenticatedSession,
    organizationId: string,
    deviceId: string | null,
    action: string,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    const requestCorrelationId = correlationId();
    await this.devices.recordDenial(
      organizationId,
      deviceId,
      current.aggregate.profile.profileId,
      action,
      code,
      requestCorrelationId,
    );
    throw problem(status, code, title, requestCorrelationId);
  }
}

/**
 * Describes the actor so the repository can re-prove authority under lock in the
 * same transaction as the write.
 *
 * `requireStepUp` is FALSE for the FYP demo. Registering hardware mints a broker
 * credential, and assigning or releasing decides which patient a stream of clinical
 * measurements is attributed to; both are administrative acts performed rarely and
 * deliberately, so in production a recent MFA step-up costs an administrator
 * almost nothing and denies a stolen idle session the ability to provision a
 * device or point one at a patient of its choosing. Restore the original `true`
 * before production hardening.
 */
function administrativeActor(
  authorized: AuthenticatedSession,
  permission: string,
): IotActorContext {
  const membershipId = authorized.aggregate.session.activeMembershipId;
  if (membershipId === null) throw new Error('Authorized membership context is missing');
  return {
    kind: 'membership',
    sessionId: authorized.aggregate.session.sessionId,
    tokenHash: authorized.tokenHash,
    membershipId,
    requiredPermission: permission,
    requireStepUp: false,
  };
}

function activeMembership(current: AuthenticatedSession) {
  return current.aggregate.memberships.find(
    (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
  );
}

/**
 * The only transformation the plaintext provisioning secret undergoes. Lowercase
 * hex is required by `device_credentials_secret_hash_check`: two spellings of one
 * digest would compare unequal and silently break credential comparison.
 */
function hashProvisioningSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * The request fingerprint an `Idempotency-Key` is bound to. It deliberately
 * excludes the provisioning secret: a retry that rotates the secret for the same
 * serial number is still the same registration, and a secret-derived fingerprint
 * would persist credential material in the idempotency ledger.
 */
function requestHash(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

function parseIdempotencyKey(value: unknown): string {
  const result = idempotencyKeySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseList(value: unknown): ListDevicesQuery {
  const result = listDevicesQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseRegister(value: unknown) {
  const result = registerDeviceSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
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

interface DeviceCursor {
  readonly createdAt: Date;
  readonly deviceId: string;
}

function encodeCursor(record: DeviceRecord): string {
  return Buffer.from(JSON.stringify({
    created_at: record.createdAt.toISOString(),
    device_id: record.deviceId,
  }), 'utf8').toString('base64url');
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
    return { createdAt, deviceId: parseDevicePath(deviceIdValue) };
  } catch {
    throw validationFailed();
  }
}
