import type { QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';

/**
 * WP-07b: firmware registry, OTA rollouts and the append-only device firmware
 * event trail.
 *
 * The artifact bytes live in object storage; this repository owns the
 * authoritative metadata in PostgreSQL — the version string, the SHA-256 the
 * device must verify before flashing, the size, and the rollout campaigns that
 * direct a version at an organization. Device-reported outcomes are appended
 * to `device_firmware_events`, which a trigger refuses to mutate, so the update
 * history of a device is a complete and tamper-evident log.
 */

export type DeviceHardwareProfileValue = 'smartcura_esp32_v1';
export type FirmwareRolloutStatusValue =
  'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type FirmwareEventOutcomeValue =
  'offered' | 'downloading' | 'installed' | 'failed' | 'rejected';

/**
 * The outcome vocabulary a device may report. Derived here rather than retyped
 * so the repository and the request schema share one definition; the
 * `device_firmware_events_outcome_check` constraint enforces the same set in
 * the database.
 */
export const FIRMWARE_EVENT_OUTCOMES = [
  'offered', 'downloading', 'installed', 'failed', 'rejected',
] as const satisfies readonly FirmwareEventOutcomeValue[];

export const FIRMWARE_ROLLOUT_STATUSES = [
  'draft', 'scheduled', 'active', 'paused', 'completed', 'failed', 'cancelled',
] as const satisfies readonly FirmwareRolloutStatusValue[];

export const DEVICE_HARDWARE_PROFILES = [
  'smartcura_esp32_v1',
] as const satisfies readonly DeviceHardwareProfileValue[];

export interface FirmwareVersionRecord {
  readonly firmwareVersionId: string;
  readonly hardwareProfile: DeviceHardwareProfileValue;
  readonly version: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly releasedAt: Date | null;
  readonly createdAt: Date;
}

export interface FirmwareRolloutRecord {
  readonly rolloutId: string;
  readonly firmwareVersionId: string;
  readonly organizationId: string;
  readonly status: FirmwareRolloutStatusValue;
  readonly scheduledAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DeviceFirmwareEventRecord {
  readonly eventId: string;
  readonly deviceId: string;
  readonly rolloutId: string | null;
  readonly firmwareVersionId: string;
  readonly outcome: FirmwareEventOutcomeValue;
  readonly detailCode: string | null;
  readonly occurredAt: Date;
}

export interface CreateFirmwareVersionInput {
  readonly hardwareProfile: DeviceHardwareProfileValue;
  readonly version: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly releasedAt: Date | null;
  readonly now: Date;
}

export type CreateFirmwareVersionResult =
  | { readonly record: FirmwareVersionRecord; readonly replayed: false }
  | 'version_conflict'
  | 'sha_conflict';

export interface CreateFirmwareRolloutInput {
  readonly firmwareVersionId: string;
  readonly organizationId: string;
  readonly status: FirmwareRolloutStatusValue;
  readonly scheduledAt: Date | null;
  readonly now: Date;
}

export type CreateFirmwareRolloutResult =
  | FirmwareRolloutRecord
  | 'firmware_version_not_found'
  | 'live_rollout_conflict';

export interface RecordFirmwareEventInput {
  readonly deviceId: string;
  readonly rolloutId: string | null;
  readonly firmwareVersionId: string;
  readonly outcome: FirmwareEventOutcomeValue;
  readonly detailCode: string | null;
  readonly occurredAt: Date;
}

interface FirmwareVersionRow extends QueryResultRow {
  readonly firmwareVersionId: string;
  readonly hardwareProfile: DeviceHardwareProfileValue;
  readonly version: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly sizeBytes: string;
  readonly releasedAt: Date | null;
  readonly createdAt: Date;
}

interface FirmwareRolloutRow extends QueryResultRow {
  readonly rolloutId: string;
  readonly firmwareVersionId: string;
  readonly organizationId: string;
  readonly status: FirmwareRolloutStatusValue;
  readonly scheduledAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface DeviceFirmwareEventRow extends QueryResultRow {
  readonly eventId: string;
  readonly deviceId: string;
  readonly rolloutId: string | null;
  readonly firmwareVersionId: string;
  readonly outcome: FirmwareEventOutcomeValue;
  readonly detailCode: string | null;
  readonly occurredAt: Date;
}

const VERSION_COLUMNS = `firmware_version_id AS "firmwareVersionId",
  hardware_profile AS "hardwareProfile", version, object_key AS "objectKey",
  sha256, size_bytes AS "sizeBytes", released_at AS "releasedAt",
  created_at AS "createdAt"`;

const ROLLOUT_COLUMNS = `rollout_id AS "rolloutId",
  firmware_version_id AS "firmwareVersionId", organization_id AS "organizationId",
  status, scheduled_at AS "scheduledAt", version,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const EVENT_COLUMNS = `event_id AS "eventId", device_id AS "deviceId",
  rollout_id AS "rolloutId", firmware_version_id AS "firmwareVersionId",
  outcome, detail_code AS "detailCode", occurred_at AS "occurredAt"`;

export class FirmwareRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * The most recently published firmware for a hardware profile. "Latest" is
   * the row with the greatest `created_at` (the most recent upload), which for
   * a registry that only ever adds versions is the newest build. A device
   * compares this against its running version to decide whether an update is
   * available.
   */
  async getLatestVersion(
    hardwareProfile: DeviceHardwareProfileValue,
  ): Promise<FirmwareVersionRecord | undefined> {
    const result = await this.database.query<FirmwareVersionRow>(
      `SELECT ${VERSION_COLUMNS} FROM firmware_versions
       WHERE hardware_profile = $1
       ORDER BY created_at DESC, firmware_version_id DESC
       LIMIT 1`,
      [hardwareProfile],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toVersionRecord(row);
  }

  /**
   * One firmware version by id. Used to resolve the object key and checksum
   * before minting a download capability.
   */
  async getVersion(
    firmwareVersionId: string,
  ): Promise<FirmwareVersionRecord | undefined> {
    const result = await this.database.query<FirmwareVersionRow>(
      `SELECT ${VERSION_COLUMNS} FROM firmware_versions
       WHERE firmware_version_id = $1`,
      [firmwareVersionId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toVersionRecord(row);
  }

  /**
   * Registers a new firmware artifact. The (hardware_profile, version) pair and
   * the sha256 are each unique, so a re-upload of the same build is reported as
   * a conflict rather than silently overwriting the registry.
   */
  async createVersion(
    input: CreateFirmwareVersionInput,
  ): Promise<CreateFirmwareVersionResult> {
    try {
      const result = await this.database.query<FirmwareVersionRow>(
        `INSERT INTO firmware_versions
         (firmware_version_id, hardware_profile, version, object_key, sha256,
          size_bytes, released_at, created_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7)
         RETURNING ${VERSION_COLUMNS}`,
        [
          input.hardwareProfile, input.version, input.objectKey, input.sha256,
          input.sizeBytes, input.releasedAt, input.now,
        ],
      );
      return { record: toVersionRecord(result.rows[0]!), replayed: false };
    } catch (error) {
      const code = constraintCode(error);
      if (code === 'firmware_versions_profile_version_uq') return 'version_conflict';
      if (code === 'firmware_versions_sha_uq') return 'sha_conflict';
      throw error;
    }
  }

  /**
   * All rollouts, newest first, so an administrator can survey the campaigns in
   * flight. Ordered by creation (relevance) rather than recency of update.
   */
  async listRollouts(): Promise<readonly FirmwareRolloutRecord[]> {
    const result = await this.database.query<FirmwareRolloutRow>(
      `SELECT ${ROLLOUT_COLUMNS} FROM firmware_rollouts
       ORDER BY created_at DESC, rollout_id DESC`,
    );
    return result.rows.map(toRolloutRecord);
  }

  /**
   * Creates a rollout directing one firmware version at one organization. The
   * partial unique index `firmware_rollouts_live_uq` refuses a second live
   * campaign for the same (organization, firmware_version) pair, so two
   * concurrent deliveries of one build cannot both be active.
   */
  async createRollout(
    input: CreateFirmwareRolloutInput,
  ): Promise<CreateFirmwareRolloutResult> {
    try {
      const result = await this.database.query<FirmwareRolloutRow>(
        `INSERT INTO firmware_rollouts
         (rollout_id, firmware_version_id, organization_id, status, scheduled_at,
          version, created_at, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4, 0, $5, $5)
         RETURNING ${ROLLOUT_COLUMNS}`,
        [
          input.firmwareVersionId, input.organizationId, input.status,
          input.scheduledAt, input.now,
        ],
      );
      return toRolloutRecord(result.rows[0]!);
    } catch (error) {
      const code = constraintCode(error);
      if (code === 'firmware_rollouts_version_fk') return 'firmware_version_not_found';
      if (code === 'firmware_rollouts_live_uq') return 'live_rollout_conflict';
      throw error;
    }
  }

  /**
   * Appends a device-reported firmware event. The
   * `device_firmware_events_reject_mutation` trigger makes the table
   * append-only, so this is the only write path; a replay of the same event
   * produces a second row, which is the correct outcome for an idempotent
   * transport that cannot tell a replay from a fresh report.
   */
  async recordFirmwareEvent(
    input: RecordFirmwareEventInput,
  ): Promise<DeviceFirmwareEventRecord> {
    const result = await this.database.query<DeviceFirmwareEventRow>(
      `INSERT INTO device_firmware_events
       (event_id, device_id, rollout_id, firmware_version_id, outcome,
        detail_code, occurred_at)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6)
       RETURNING ${EVENT_COLUMNS}`,
      [
        input.deviceId, input.rolloutId, input.firmwareVersionId, input.outcome,
        input.detailCode, input.occurredAt,
      ],
    );
    return toEventRecord(result.rows[0]!);
  }
}

function toVersionRecord(row: FirmwareVersionRow): FirmwareVersionRecord {
  return {
    firmwareVersionId: row.firmwareVersionId,
    hardwareProfile: row.hardwareProfile,
    version: row.version,
    objectKey: row.objectKey,
    sha256: row.sha256,
    sizeBytes: Number(row.sizeBytes),
    releasedAt: row.releasedAt,
    createdAt: row.createdAt,
  };
}

function toRolloutRecord(row: FirmwareRolloutRow): FirmwareRolloutRecord {
  return {
    rolloutId: row.rolloutId,
    firmwareVersionId: row.firmwareVersionId,
    organizationId: row.organizationId,
    status: row.status,
    scheduledAt: row.scheduledAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEventRecord(row: DeviceFirmwareEventRow): DeviceFirmwareEventRecord {
  return {
    eventId: row.eventId,
    deviceId: row.deviceId,
    rolloutId: row.rolloutId,
    firmwareVersionId: row.firmwareVersionId,
    outcome: row.outcome,
    detailCode: row.detailCode,
    occurredAt: row.occurredAt,
  };
}

/**
 * Extracts the PostgreSQL constraint name from a driver error so a unique
 * violation or foreign key failure is reported as a typed result rather than a
 * 500. Mirrors the pattern every other repository in this package uses.
 */
function constraintCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  if (code !== '23505' && code !== '23503') return undefined;
  const constraint = (error as { readonly constraint?: unknown }).constraint;
  return typeof constraint === 'string' ? constraint : undefined;
}

/**
 * Inline snake_case serializer for a firmware version. The `object_key` is
 * deliberately omitted: it is a storage-internal pointer, and the only caller
 * that needs it is the download service, which reads it from the record before
 * minting the presigned URL.
 */
export function serializeFirmwareVersion(
  record: FirmwareVersionRecord,
): Record<string, unknown> {
  return {
    firmware_version_id: record.firmwareVersionId,
    hardware_profile: record.hardwareProfile,
    version: record.version,
    sha256: record.sha256,
    size_bytes: record.sizeBytes,
    released_at: record.releasedAt?.toISOString() ?? null,
    created_at: record.createdAt.toISOString(),
  };
}

export function serializeFirmwareRollout(
  record: FirmwareRolloutRecord,
): Record<string, unknown> {
  return {
    rollout_id: record.rolloutId,
    firmware_version_id: record.firmwareVersionId,
    organization_id: record.organizationId,
    status: record.status,
    scheduled_at: record.scheduledAt?.toISOString() ?? null,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export function serializeDeviceFirmwareEvent(
  record: DeviceFirmwareEventRecord,
): Record<string, unknown> {
  return {
    event_id: record.eventId,
    device_id: record.deviceId,
    rollout_id: record.rolloutId,
    firmware_version_id: record.firmwareVersionId,
    outcome: record.outcome,
    detail_code: record.detailCode,
    occurred_at: record.occurredAt.toISOString(),
  };
}

/**
 * Compares two `X.Y.Z` semantic version strings. Returns a positive number when
 * `left` is newer, a negative number when `right` is newer, and zero when they
 * are equal. A missing or malformed version sorts below any well-formed one so
 * a device that cannot report its version is always offered the latest.
 */
export function compareSemver(left: string, right: string): number {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? -1;
    const rightPart = rightParts[index] ?? -1;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }
  return 0;
}

function parseSemver(version: string): readonly number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) return [];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
