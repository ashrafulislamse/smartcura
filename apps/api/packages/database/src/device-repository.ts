import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  DEVICE_CHANGED_EVENT_TYPE,
  DEVICE_CHANGED_EVENT_VERSION,
} from './iot-events.js';
import {
  revalidateIotActor,
  type IotActorContext,
  type IotActorFailure,
} from './iot-actor.js';

export type DeviceTypeValue =
  'vitals_monitor' | 'ecg' | 'thermometer' | 'pulse_oximeter' | 'simulator' | 'phone';
export type DeviceStateValue = 'provisioned' | 'active' | 'suspended' | 'retired';
export type DeviceCredentialTypeValue = 'mqtt_password' | 'client_certificate';

/**
 * Structured, PHI-free reasons for releasing a device from a patient. Free text is
 * deliberately not accepted: release reasons land in broadly retained audit logs
 * and in an append-only assignment history, and operators cannot be relied upon
 * to keep clinical detail out of an open string field.
 */
export const DEVICE_RELEASE_REASON_CODES = [
  'administrative_request',
  'device_replaced',
  'device_fault',
  'patient_discharged',
  'assignment_correction',
  'security_incident',
  'offboarding',
] as const;

export type DeviceReleaseReasonCode = typeof DEVICE_RELEASE_REASON_CODES[number];

export interface DeviceAssignmentRecord {
  readonly assignmentId: string;
  readonly patientProfileId: string;
  readonly assignedByProfileId: string;
  readonly assignedAt: Date;
}

export interface DeviceRecord {
  readonly deviceId: string;
  readonly organizationId: string;
  readonly deviceType: DeviceTypeValue;
  readonly serialNumber: string;
  readonly hardwareRevision: string | null;
  readonly firmwareVersion: string | null;
  readonly state: DeviceStateValue;
  readonly provisionedAt: Date;
  readonly lastSeenAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly activeAssignment: DeviceAssignmentRecord | null;
}

/**
 * A replayed idempotent request returns the byte-for-byte response stored when
 * the original request succeeded. Reloading current state instead would let a
 * replay observe later mutations, which breaks the guarantee the
 * `Idempotency-Key` header makes to the client.
 */
export interface DeviceResponseSnapshot {
  readonly status: 201;
  readonly body: Record<string, unknown>;
}

export interface RegisterDeviceInput {
  readonly organizationId: string;
  readonly actorProfileId: string;
  readonly actor: IotActorContext;
  readonly deviceType: DeviceTypeValue;
  readonly serialNumber: string;
  readonly hardwareRevision: string | null;
  readonly firmwareVersion: string | null;
  readonly credentialType: DeviceCredentialTypeValue;
  /**
   * SHA-256 digest of the provisioning secret, 64 lowercase hex characters. The
   * plaintext never reaches this layer: the caller hashes it, returns it to the
   * operator once, and forgets it.
   */
  readonly credentialSecretHash: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly idempotencyTtlMs: number;
  readonly now: Date;
  readonly correlationId: string;
}

export type RegisterDeviceResult =
  | { readonly record: DeviceRecord; readonly replayed: false }
  | { readonly snapshot: DeviceResponseSnapshot; readonly replayed: true }
  | 'organization_not_found'
  | 'serial_number_conflict'
  | 'idempotency_reused'
  | IotActorFailure;

export interface ListDevicesInput {
  readonly organizationId: string;
  readonly afterCreatedAt?: Date | undefined;
  readonly afterDeviceId?: string | undefined;
  readonly state?: DeviceStateValue | undefined;
  readonly limit: number;
}

/**
 * Own-scope device listing: a patient reading devices assigned to THEM. The
 * patient id is never taken from the request — the service reads it from the
 * session — so there is no substitution surface. The join is on the OPEN
 * assignment only, matching `deviceProjection()` exactly.
 */
export interface ListOwnDevicesInput {
  readonly patientProfileId: string;
  readonly afterCreatedAt?: Date | undefined;
  readonly afterDeviceId?: string | undefined;
  readonly limit: number;
}

export interface AssignDeviceInput {
  readonly organizationId: string;
  readonly deviceId: string;
  readonly patientProfileId: string;
  readonly actorProfileId: string;
  readonly actor: IotActorContext;
  readonly expectedVersion: number;
  readonly now: Date;
  readonly correlationId: string;
  /**
   * When set, the caller is a clinician acting under a care assignment (doctor),
   * not an administrator. The care assignment is re-proved with a FOR SHARE lock
   * inside the same transaction as the device assignment, so a concurrent
   * revocation cannot slip in between the HTTP-layer check and the write.
   * When absent, the admin path is unchanged.
   */
  readonly clinicianMembershipId?: string;
}

export type AssignDeviceResult = DeviceRecord |
  'not_found' | 'version_conflict' | 'device_not_assignable' |
  'patient_not_eligible' | 'already_assigned' | 'care_assignment_required' |
  IotActorFailure;

export interface ReleaseDeviceInput {
  readonly organizationId: string;
  readonly deviceId: string;
  readonly actorProfileId: string;
  readonly actor: IotActorContext;
  readonly expectedVersion: number;
  readonly reasonCode: DeviceReleaseReasonCode;
  readonly now: Date;
  readonly correlationId: string;
  /**
   * When set, the caller is a clinician acting under a care assignment (doctor).
   * The care assignment for the device's current patient is re-proved with a
   * FOR SHARE lock inside the transaction, matching the assign path. When
   * absent, the admin path is unchanged.
   */
  readonly clinicianMembershipId?: string;
  /**
   * When set, the caller is the patient the device must be assigned to. A device
   * assigned to any other patient is rejected as `not_assigned`, so a patient
   * self-release cannot accidentally close another patient's assignment.
   */
  readonly patientProfileId?: string;
}

export type ReleaseDeviceResult = DeviceRecord |
  'not_found' | 'version_conflict' | 'not_assigned' |
  'care_assignment_required' | IotActorFailure;

interface DeviceRow extends QueryResultRow {
  readonly deviceId: string;
  readonly organizationId: string;
  readonly deviceType: DeviceTypeValue;
  readonly serialNumber: string;
  readonly hardwareRevision: string | null;
  readonly firmwareVersion: string | null;
  readonly state: DeviceStateValue;
  readonly provisionedAt: Date;
  readonly lastSeenAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly assignmentId: string | null;
  readonly patientProfileId: string | null;
  readonly assignedByProfileId: string | null;
  readonly assignedAt: Date | null;
}

interface IdempotencyRow extends QueryResultRow {
  readonly requestHash: string;
  readonly state: string;
  readonly responseStatus: number | null;
  readonly responseBody: Record<string, unknown> | null;
  readonly expired: boolean;
}

const DEVICE_REGISTER_OPERATION = 'device.register';

export class DeviceRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * Registers a device and its credential digest, then audits and publishes, all
   * in one transaction. Lock order is fixed at organization, then actor, then
   * device — the same order `assign` and `release` take, so concurrent device
   * mutations in one organization cannot deadlock against each other.
   */
  async register(input: RegisterDeviceInput): Promise<RegisterDeviceResult> {
    return this.database.transaction(async (client) => {
      const organization = await client.query(
        `SELECT organization_id FROM organizations WHERE organization_id = $1 FOR UPDATE`,
        [input.organizationId],
      );
      if (organization.rowCount !== 1) return 'organization_not_found';

      const actorFailure = await revalidateIotActor(
        client, input.actor, input.organizationId, input.now,
      );
      if (actorFailure !== undefined) return actorFailure;

      const existingKey = await this.loadIdempotency(client, input, true);
      if (existingKey !== undefined && !existingKey.expired) {
        return resolveIdempotency(input, existingKey);
      }
      if (existingKey?.expired === true) {
        // An expired key carries no replay guarantee any more, so the row is
        // reclaimed rather than blocking the caller forever.
        await this.deleteIdempotency(client, input);
      }
      const claimed = await client.query(
        `INSERT INTO idempotency_keys
         (organization_id, actor_profile_id, operation_id, idempotency_key,
          request_hash, state, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'processing', $6)
         ON CONFLICT (organization_id, actor_profile_id, operation_id, idempotency_key)
         DO NOTHING RETURNING idempotency_key`,
        [
          input.organizationId, input.actorProfileId, DEVICE_REGISTER_OPERATION,
          input.idempotencyKey, input.requestHash,
          new Date(input.now.getTime() + input.idempotencyTtlMs),
        ],
      );
      if (claimed.rowCount !== 1) {
        const raced = await this.loadIdempotency(client, input, true);
        if (raced === undefined) throw new Error('Idempotency claim disappeared');
        return resolveIdempotency(input, raced);
      }

      const inserted = await client.query<{ readonly deviceId: string }>(
        `INSERT INTO devices
         (device_id, organization_id, device_type, serial_number,
          hardware_revision, firmware_version, state, provisioned_at, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, 'provisioned', $6, $6)
         ON CONFLICT (organization_id, serial_number) DO NOTHING
         RETURNING device_id AS "deviceId"`,
        [
          input.organizationId, input.deviceType, input.serialNumber,
          input.hardwareRevision, input.firmwareVersion, input.now,
        ],
      );
      const deviceId = inserted.rows[0]?.deviceId;
      if (deviceId === undefined) {
        await this.completeIdempotency(client, input, 409, {
          code: 'DEVICE_SERIAL_NUMBER_CONFLICT',
        });
        return 'serial_number_conflict';
      }
      await client.query(
        `INSERT INTO device_credentials
         (credential_id, device_id, credential_type, secret_hash, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4)`,
        [deviceId, input.credentialType, input.credentialSecretHash, input.now],
      );
      const record = await this.loadForUpdate(client, input.organizationId, deviceId);
      if (record === undefined) throw new Error('Registered device could not be loaded');
      await this.recordAudit(client, record, {
        action: 'device.registered',
        actorProfileId: input.actorProfileId,
        correlationId: input.correlationId,
        reason: null,
        metadata: {
          device_type: record.deviceType,
          state: record.state,
          credential_type: input.credentialType,
          version: record.version,
        },
      });
      await appendDeviceChangedEvent(client, record, input.correlationId, input.now);
      // Stores the exact response body so a replay never observes later state.
      await this.completeIdempotency(client, input, 201, serializeDevice(record));
      return { record, replayed: false };
    });
  }

  /**
   * Deterministic keyset pagination on `(created_at, device_id)`. Both columns are
   * needed: `created_at` alone is not unique, so a page boundary that fell between
   * two devices created in the same millisecond would either repeat or skip a row.
   */
  async list(input: ListDevicesInput): Promise<DeviceRecord[]> {
    const result = await this.database.query<DeviceRow>(
      `${deviceProjection()}
       WHERE device.organization_id = $1
         AND ($2::timestamptz IS NULL OR
           (device.created_at, device.device_id) > ($2, $3::uuid))
         AND ($4::text IS NULL OR device.state = $4::device_state)
       ORDER BY device.created_at, device.device_id
       LIMIT $5`,
      [
        input.organizationId,
        input.afterCreatedAt ?? null,
        input.afterDeviceId ?? null,
        input.state ?? null,
        input.limit,
      ],
    );
    return result.rows.map(toDeviceRecord);
  }

  /**
   * Devices assigned to one patient (open assignments only), newest first.
   * Deterministic keyset pagination on `(created_at, device_id)`, the same
   * ordering `list` uses. A patient can hold multiple open assignments — the
   * at-most-one rule is per device, not per patient — so this can return more
   * than one row.
   */
  async listOwnDevices(input: ListOwnDevicesInput): Promise<DeviceRecord[]> {
    const result = await this.database.query<DeviceRow>(
      `${deviceProjection()}
       WHERE assignment.patient_profile_id = $1
         AND assignment.released_at IS NULL
         AND ($2::timestamptz IS NULL OR
           (device.created_at, device.device_id) > ($2, $3::uuid))
       ORDER BY device.created_at, device.device_id
       LIMIT $4`,
      [
        input.patientProfileId,
        input.afterCreatedAt ?? null,
        input.afterDeviceId ?? null,
        input.limit,
      ],
    );
    return result.rows.map(toDeviceRecord);
  }

  /**
   * One device assigned to the patient (open assignment only). Returns undefined
   * when the device is unknown, not assigned to this patient, or its assignment has
   * been released. This is the read-one counterpart of `listOwnDevices` and uses
   * the same projection.
   */
  async getOwnDevice(
    patientProfileId: string,
    deviceId: string,
  ): Promise<DeviceRecord | undefined> {
    const result = await this.database.query<DeviceRow>(
      `${deviceProjection()}
       WHERE assignment.patient_profile_id = $1
         AND assignment.released_at IS NULL
         AND device.device_id = $2`,
      [patientProfileId, deviceId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toDeviceRecord(row);
  }

  /**
   * Devices in an organization with NO open assignment, i.e. available for
   * assignment. The LEFT JOIN produces NULL assignment columns when no open
   * assignment exists, so the filter is `assignment.assignment_id IS NULL`.
   * Only `provisioned` or `active` devices are returned: a suspended or
   * retired device is not assignable. Same keyset ordering as `list`.
   */
  async listAvailableDevices(input: ListDevicesInput): Promise<DeviceRecord[]> {
    const result = await this.database.query<DeviceRow>(
      `${deviceProjection()}
       WHERE device.organization_id = $1
         AND assignment.assignment_id IS NULL
         AND device.state IN ('provisioned', 'active')
         AND ($2::timestamptz IS NULL OR
           (device.created_at, device.device_id) > ($2, $3::uuid))
       ORDER BY device.created_at, device.device_id
       LIMIT $4`,
      [
        input.organizationId,
        input.afterCreatedAt ?? null,
        input.afterDeviceId ?? null,
        input.limit,
      ],
    );
    return result.rows.map(toDeviceRecord);
  }

  async getById(organizationId: string, deviceId: string): Promise<DeviceRecord | undefined> {
    const result = await this.database.query<DeviceRow>(
      `${deviceProjection()}
       WHERE device.organization_id = $1 AND device.device_id = $2`,
      [organizationId, deviceId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toDeviceRecord(row);
  }

  /**
   * Opens an assignment. At most one may be open per device; that is enforced by
   * the partial unique index `device_assignments_active_uq`, so the explicit
   * check below is a friendly error path, not the safety mechanism.
   */
  async assign(input: AssignDeviceInput): Promise<AssignDeviceResult> {
    return this.database.transaction(async (client) => {
      const organization = await client.query(
        `SELECT organization_id FROM organizations WHERE organization_id = $1 FOR UPDATE`,
        [input.organizationId],
      );
      if (organization.rowCount !== 1) return 'not_found';

      const actorFailure = await revalidateIotActor(
        client, input.actor, input.organizationId, input.now,
      );
      if (actorFailure !== undefined) return actorFailure;

      const current = await this.loadForUpdate(client, input.organizationId, input.deviceId);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      // A suspended or retired device must not be handed to a patient: readings
      // from it would be accepted by a path that believes the device is trusted.
      if (current.state === 'suspended' || current.state === 'retired') {
        return 'device_not_assignable';
      }
      if (current.activeAssignment !== null) return 'already_assigned';

      const patient = await client.query<{
        readonly status: string;
        readonly onboardingCompletedAt: Date | null;
      }>(
        `SELECT status, onboarding_completed_at AS "onboardingCompletedAt"
         FROM profiles WHERE profile_id = $1 FOR SHARE`,
        [input.patientProfileId],
      );
      const target = patient.rows[0];
      if (
        target === undefined || target.status !== 'active' ||
        target.onboardingCompletedAt === null
      ) return 'patient_not_eligible';

      // A clinician (doctor) may only assign to a patient under their own active
      // care. The FOR SHARE lock pins the care_assignments row for the rest of
      // the transaction, so a concurrent revocation cannot slip in between this
      // check and the assignment insert. An administrator path skips this: no
      // clinicianMembershipId was supplied.
      if (input.clinicianMembershipId !== undefined) {
        const careAssignment = await client.query(
          `SELECT assignment_id FROM care_assignments
            WHERE clinician_membership_id = $1 AND patient_profile_id = $2
              AND status = 'active'
            ORDER BY assignment_id
            FOR SHARE`,
          [input.clinicianMembershipId, input.patientProfileId],
        );
        if (careAssignment.rows.length === 0) return 'care_assignment_required';
      }

      const assignment = await client.query<{ readonly assignmentId: string }>(
        `INSERT INTO device_assignments
         (assignment_id, device_id, organization_id, patient_profile_id,
          assigned_by_profile_id, assigned_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING assignment_id AS "assignmentId"`,
        [
          input.deviceId, input.organizationId, input.patientProfileId,
          input.actorProfileId, input.now,
        ],
      );
      // The index rejected a concurrent assignment that committed between the
      // read above and this insert. Reporting the conflict is correct; silently
      // succeeding would leave the caller believing it owns the device.
      if (assignment.rowCount !== 1) return 'already_assigned';

      await client.query(
        `UPDATE devices
         SET state = CASE WHEN state = 'provisioned' THEN 'active'::device_state ELSE state END,
             version = version + 1, updated_at = $2
         WHERE device_id = $1 AND version = $3`,
        [input.deviceId, input.now, input.expectedVersion],
      );
      const updated = await this.loadForUpdate(client, input.organizationId, input.deviceId);
      if (updated === undefined) throw new Error('Device disappeared during assignment');
      await this.recordAudit(client, updated, {
        action: 'device.assigned',
        actorProfileId: input.actorProfileId,
        correlationId: input.correlationId,
        reason: null,
        metadata: {
          assignment_id: assignment.rows[0]?.assignmentId ?? null,
          patient_profile_id: input.patientProfileId,
          state: updated.state,
          version: updated.version,
        },
      });
      await appendDeviceChangedEvent(client, updated, input.correlationId, input.now);
      return updated;
    });
  }

  /** Closes the open assignment. History is appended to, never rewritten. */
  async release(input: ReleaseDeviceInput): Promise<ReleaseDeviceResult> {
    return this.database.transaction(async (client) => {
      const organization = await client.query(
        `SELECT organization_id FROM organizations WHERE organization_id = $1 FOR UPDATE`,
        [input.organizationId],
      );
      if (organization.rowCount !== 1) return 'not_found';

      const actorFailure = await revalidateIotActor(
        client, input.actor, input.organizationId, input.now,
      );
      if (actorFailure !== undefined) return actorFailure;

      const current = await this.loadForUpdate(client, input.organizationId, input.deviceId);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      const active = current.activeAssignment;
      if (active === null) return 'not_assigned';
      if (
        input.patientProfileId !== undefined &&
        active.patientProfileId !== input.patientProfileId
      ) return 'not_assigned';

      // A clinician (doctor) may only release a device assigned to a patient under
      // their own active care. The FOR SHARE lock pins the care_assignments row for
      // the rest of the transaction, matching the assign path's TOCTOU closure.
      if (input.clinicianMembershipId !== undefined) {
        const careAssignment = await client.query(
          `SELECT assignment_id FROM care_assignments
            WHERE clinician_membership_id = $1 AND patient_profile_id = $2
              AND status = 'active'
            ORDER BY assignment_id
            FOR SHARE`,
          [input.clinicianMembershipId, active.patientProfileId],
        );
        if (careAssignment.rows.length === 0) return 'care_assignment_required';
      }

      const released = await client.query(
        `UPDATE device_assignments
         SET released_at = $2, release_reason = $3
         WHERE assignment_id = $1 AND released_at IS NULL`,
        [active.assignmentId, input.now, input.reasonCode],
      );
      if (released.rowCount !== 1) return 'not_assigned';
      await client.query(
        `UPDATE devices SET version = version + 1, updated_at = $2
         WHERE device_id = $1 AND version = $3`,
        [input.deviceId, input.now, input.expectedVersion],
      );
      const updated = await this.loadForUpdate(client, input.organizationId, input.deviceId);
      if (updated === undefined) throw new Error('Device disappeared during release');
      await this.recordAudit(client, updated, {
        action: 'device.released',
        actorProfileId: input.actorProfileId,
        correlationId: input.correlationId,
        reason: input.reasonCode,
        metadata: {
          assignment_id: active.assignmentId,
          patient_profile_id: active.patientProfileId,
          version: updated.version,
        },
      });
      await appendDeviceChangedEvent(client, updated, input.correlationId, input.now);
      return updated;
    });
  }

  /**
   * Audits a refusal. Denials are recorded with the same structured shape as
   * successes so a permission problem is visible in the audit trail instead of
   * only in an HTTP response the operator never sees.
   */
  async recordDenial(
    organizationId: string,
    deviceId: string | null,
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
        $2, $3, 'device', $4, $5, $6, $7)`,
      [organizationId, actorProfileId, action, deviceId, code, correlationId, {
        denial_code: code,
      }],
    );
  }

  private async loadForUpdate(
    client: PoolClient,
    organizationId: string,
    deviceId: string,
  ): Promise<DeviceRecord | undefined> {
    const result = await client.query<DeviceRow>(
      `${deviceProjection()}
       WHERE device.organization_id = $1 AND device.device_id = $2
       FOR UPDATE OF device`,
      [organizationId, deviceId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toDeviceRecord(row);
  }

  private async recordAudit(
    client: PoolClient,
    device: DeviceRecord,
    entry: {
      readonly action: string;
      readonly actorProfileId: string;
      readonly correlationId: string;
      readonly reason: string | null;
      readonly metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, $3, 'device', $4, $5, $6, $7)`,
      [
        device.organizationId, entry.actorProfileId, entry.action, device.deviceId,
        entry.reason, entry.correlationId, entry.metadata,
      ],
    );
  }

  private async loadIdempotency(
    client: PoolClient,
    input: RegisterDeviceInput,
    lock = false,
  ): Promise<IdempotencyRow | undefined> {
    const result = await client.query<IdempotencyRow>(
      `SELECT request_hash AS "requestHash", state,
       response_status AS "responseStatus", response_body AS "responseBody",
       (expires_at <= $5) AS expired
       FROM idempotency_keys
       WHERE organization_id = $1 AND actor_profile_id = $2
         AND operation_id = $3 AND idempotency_key = $4
       ${lock ? 'FOR UPDATE' : ''}`,
      [
        input.organizationId, input.actorProfileId, DEVICE_REGISTER_OPERATION,
        input.idempotencyKey, input.now,
      ],
    );
    return result.rows[0];
  }

  private async deleteIdempotency(
    client: PoolClient,
    input: RegisterDeviceInput,
  ): Promise<void> {
    await client.query(
      `DELETE FROM idempotency_keys
       WHERE organization_id = $1 AND actor_profile_id = $2
         AND operation_id = $3 AND idempotency_key = $4`,
      [
        input.organizationId, input.actorProfileId, DEVICE_REGISTER_OPERATION,
        input.idempotencyKey,
      ],
    );
  }

  private async completeIdempotency(
    client: PoolClient,
    input: RegisterDeviceInput,
    responseStatus: 201 | 409,
    responseBody: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `UPDATE idempotency_keys
       SET state = 'completed', response_status = $5, response_body = $6,
           updated_at = $7
       WHERE organization_id = $1 AND actor_profile_id = $2
         AND operation_id = $3 AND idempotency_key = $4`,
      [
        input.organizationId, input.actorProfileId, DEVICE_REGISTER_OPERATION,
        input.idempotencyKey, responseStatus, responseBody, input.now,
      ],
    );
  }
}

/**
 * Single writer for the published device event. The payload is restricted to the
 * four fields `DeviceChangedData` declares, because that schema sets
 * `additionalProperties: false` — any extra key would fail contract validation
 * and dead-letter in the worker. Serial numbers and assignment detail stay in the
 * audit log, not in the published event.
 */
async function appendDeviceChangedEvent(
  client: PoolClient,
  device: DeviceRecord,
  correlationId: string,
  occurredAt: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events
     (event_id, event_type, event_version, aggregate_type, aggregate_id,
      aggregate_version, payload, correlation_id, occurred_at)
     VALUES (uuidv7(), $1, $2, 'device', $3, $4, $5, $6, $7)`,
    [
      DEVICE_CHANGED_EVENT_TYPE,
      DEVICE_CHANGED_EVENT_VERSION,
      device.deviceId,
      device.version,
      {
        device_id: device.deviceId,
        organization_id: device.organizationId,
        device_type: device.deviceType,
        state: device.state,
      },
      correlationId,
      occurredAt,
    ],
  );
}

/**
 * Replays the stored response verbatim. Deliberately does not read the device
 * again: a replay must reproduce the original outcome even if the device has
 * since been assigned, suspended or re-versioned.
 */
function resolveIdempotency(
  input: RegisterDeviceInput,
  existing: IdempotencyRow,
): RegisterDeviceResult {
  if (existing.requestHash !== input.requestHash) return 'idempotency_reused';
  if (existing.state !== 'completed') return 'idempotency_reused';
  if (existing.responseStatus === 409) return 'serial_number_conflict';
  const body = existing.responseBody;
  if (existing.responseStatus !== 201 || body === null || body['id'] === undefined) {
    return 'idempotency_reused';
  }
  return { snapshot: { status: 201, body }, replayed: true };
}

/**
 * The single device representation. Used both for live HTTP responses and for the
 * idempotency snapshot, so a replayed response is identical by construction.
 */
export function serializeDevice(record: DeviceRecord): Record<string, unknown> {
  return {
    id: record.deviceId,
    organization_id: record.organizationId,
    device_type: record.deviceType,
    serial_number: record.serialNumber,
    hardware_revision: record.hardwareRevision,
    firmware_version: record.firmwareVersion,
    state: record.state,
    provisioned_at: record.provisionedAt.toISOString(),
    last_seen_at: record.lastSeenAt?.toISOString() ?? null,
    active_assignment: record.activeAssignment === null ? null : {
      id: record.activeAssignment.assignmentId,
      patient_profile_id: record.activeAssignment.patientProfileId,
      assigned_by_profile_id: record.activeAssignment.assignedByProfileId,
      assigned_at: record.activeAssignment.assignedAt.toISOString(),
    },
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function toDeviceRecord(row: DeviceRow): DeviceRecord {
  const assignment: DeviceAssignmentRecord | null =
    row.assignmentId === null || row.patientProfileId === null ||
    row.assignedByProfileId === null || row.assignedAt === null
      ? null
      : {
          assignmentId: row.assignmentId,
          patientProfileId: row.patientProfileId,
          assignedByProfileId: row.assignedByProfileId,
          assignedAt: row.assignedAt,
        };
  return {
    deviceId: row.deviceId,
    organizationId: row.organizationId,
    deviceType: row.deviceType,
    serialNumber: row.serialNumber,
    hardwareRevision: row.hardwareRevision,
    firmwareVersion: row.firmwareVersion,
    state: row.state,
    provisionedAt: row.provisionedAt,
    lastSeenAt: row.lastSeenAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    activeAssignment: assignment,
  };
}

/**
 * The device projection always joins the OPEN assignment only. A device with a
 * long release history therefore still reports exactly one or zero current
 * patients, which the partial unique index guarantees.
 */
function deviceProjection(): string {
  return `SELECT device.device_id AS "deviceId",
   device.organization_id AS "organizationId",
   device.device_type AS "deviceType",
   device.serial_number AS "serialNumber",
   device.hardware_revision AS "hardwareRevision",
   device.firmware_version AS "firmwareVersion",
   device.state, device.provisioned_at AS "provisionedAt",
   device.last_seen_at AS "lastSeenAt", device.version,
   device.created_at AS "createdAt", device.updated_at AS "updatedAt",
   assignment.assignment_id AS "assignmentId",
   assignment.patient_profile_id AS "patientProfileId",
   assignment.assigned_by_profile_id AS "assignedByProfileId",
   assignment.assigned_at AS "assignedAt"
   FROM devices device
   LEFT JOIN device_assignments assignment
     ON assignment.device_id = device.device_id AND assignment.released_at IS NULL`;
}
