/**
 * WP-07a: IoT device registry, credential digests, assignment history, vital
 * reading ingestion and threshold-driven health alerts.
 *
 * This file exists separately from `schema.ts` because that file is being edited
 * concurrently. `schema.ts` is expected to re-export everything declared here
 * (see `HANDOFF-0014.md`), which is what keeps `@smartcura/database`'s public
 * surface unchanged in shape.
 *
 * DRIZZLE INTROSPECTION CAVEAT — read before trusting a drift check.
 * `vital_readings` is declared here as an ordinary table, but migration
 * `0014_iot_devices_and_readings.sql` creates it as `PARTITIONED BY RANGE
 * (recorded_at)` with three monthly partitions plus a default partition.
 * drizzle-kit cannot express declarative partitioning, so a generated diff will
 * always want to "fix" the partitioned parent. Never regenerate this table from
 * the drizzle snapshot. Every object drizzle cannot see is listed in the handoff.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations, profiles } from './schema.js';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const deviceType = pgEnum('device_type', [
  'vitals_monitor', 'ecg', 'thermometer', 'pulse_oximeter', 'simulator',
]);
export const deviceState = pgEnum('device_state', [
  'provisioned', 'active', 'suspended', 'retired',
]);
export const deviceCredentialType = pgEnum('device_credential_type', [
  'mqtt_password', 'client_certificate',
]);
export const vitalMetric = pgEnum('vital_metric', [
  'heart_rate', 'oxygen_saturation', 'body_temperature', 'systolic_bp', 'diastolic_bp',
  'respiratory_rate', 'ecg_voltage', 'blood_pressure', 'blood_glucose', 'body_weight',
]);
export const vitalReadingQuality = pgEnum('vital_reading_quality', [
  'valid', 'suspect', 'invalid', 'unknown',
]);
export const healthThresholdComparator = pgEnum('health_threshold_comparator', [
  'lt', 'lte', 'gt', 'gte',
]);
export const healthAlertSeverity = pgEnum('health_alert_severity', [
  'info', 'warning', 'critical',
]);
export const healthAlertState = pgEnum('health_alert_state', [
  'open', 'acknowledged', 'escalated', 'resolved', 'dismissed',
]);

/**
 * A physical or simulated device owned by one organization. `state` is the
 * device lifecycle, not its connectivity: a reachable but suspended device must
 * not be able to ingest, and connectivity is expressed by `last_seen_at`.
 */
export const devices = pgTable('devices', {
  deviceId: uuid('device_id').primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  deviceType: deviceType('device_type').notNull(),
  serialNumber: varchar('serial_number', { length: 64 }).notNull(),
  hardwareRevision: varchar('hardware_revision', { length: 32 }),
  firmwareVersion: varchar('firmware_version', { length: 32 }),
  state: deviceState('state').notNull().default('provisioned'),
  provisionedAt: timestamp('provisioned_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('devices_organization_serial_uq').on(table.organizationId, table.serialNumber),
  // Target of every composite foreign key that must not cross an organization
  // boundary, following the `organization_memberships_id_org_uq` precedent.
  uniqueIndex('devices_id_organization_uq').on(table.deviceId, table.organizationId),
  index('devices_org_created_idx').on(table.organizationId, table.createdAt, table.deviceId),
  index('devices_org_state_idx').on(table.organizationId, table.state),
  check('devices_version_check', sql`${table.version} >= 0`),
  check('devices_serial_number_check', sql`${table.serialNumber} ~ '^[A-Z0-9][A-Z0-9-]{3,63}$'`),
  check('devices_last_seen_order_check', sql`${table.lastSeenAt} IS NULL OR ${table.lastSeenAt} >= ${table.provisionedAt}`),
]);

/**
 * Only the DIGEST of a device secret is ever stored, mirroring
 * `app_sessions.token_hash`: 64 lowercase hex characters of SHA-256. The
 * plaintext MQTT password or certificate fingerprint is shown once at
 * provisioning and is unrecoverable afterwards, so a database disclosure cannot
 * be replayed against the broker.
 */
export const deviceCredentials = pgTable('device_credentials', {
  credentialId: uuid('credential_id').primaryKey(),
  deviceId: uuid('device_id').notNull().references(() => devices.deviceId),
  credentialType: deviceCredentialType('credential_type').notNull(),
  secretHash: char('secret_hash', { length: 64 }).notNull(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('device_credentials_active_uq')
    .on(table.deviceId, table.credentialType)
    .where(sql`revoked_at IS NULL`),
  index('device_credentials_device_idx').on(table.deviceId),
  check('device_credentials_secret_hash_check', sql`${table.secretHash} ~ '^[0-9a-f]{64}$'`),
  check('device_credentials_rotated_order_check', sql`${table.rotatedAt} IS NULL OR ${table.rotatedAt} >= ${table.createdAt}`),
  check('device_credentials_revoked_order_check', sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`),
]);

/**
 * Append-only assignment history. A released assignment is closed with
 * `released_at`, never deleted: a reading recorded last month must remain
 * attributable to the patient the device was assigned to at that time, which is
 * impossible if history is rewritten.
 *
 * At most one OPEN assignment per device is enforced by
 * `device_assignments_active_uq`, a partial unique index on `device_id` where
 * `released_at IS NULL`. Application code cannot lose that race.
 */
export const deviceAssignments = pgTable('device_assignments', {
  assignmentId: uuid('assignment_id').primaryKey(),
  deviceId: uuid('device_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  patientProfileId: uuid('patient_profile_id').notNull().references(() => profiles.profileId),
  assignedByProfileId: uuid('assigned_by_profile_id').notNull().references(() => profiles.profileId),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releaseReason: varchar('release_reason', { length: 64 }),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({
    name: 'device_assignments_device_org_fk',
    columns: [table.deviceId, table.organizationId],
    foreignColumns: [devices.deviceId, devices.organizationId],
  }),
  uniqueIndex('device_assignments_active_uq')
    .on(table.deviceId)
    .where(sql`released_at IS NULL`),
  index('device_assignments_patient_idx').on(table.patientProfileId, table.assignedAt),
  index('device_assignments_device_time_idx').on(table.deviceId, table.assignedAt),
  check('device_assignments_released_order_check', sql`${table.releasedAt} IS NULL OR ${table.releasedAt} >= ${table.assignedAt}`),
  check('device_assignments_release_reason_check', sql`(${table.releasedAt} IS NULL) = (${table.releaseReason} IS NULL)`),
]);

/**
 * Raw scalar readings. Created by migration 0014 as `PARTITION BY RANGE
 * (recorded_at)`; drizzle cannot express that, so treat this declaration as the
 * column/constraint contract only.
 *
 * The primary key is `(recorded_at, reading_id)` rather than `reading_id` alone
 * because PostgreSQL requires every unique constraint on a partitioned table to
 * contain the partition key. `reading_id` is still a `uuidv7()`, so it is still
 * globally unique in practice; callers that address a single reading carry its
 * recorded time, matching `vitals-capacity-plan.md` section 5.1.
 */
export const vitalReadings = pgTable('vital_readings', {
  readingId: uuid('reading_id').notNull(),
  deviceId: uuid('device_id').notNull(),
  patientProfileId: uuid('patient_profile_id').notNull(),
  metric: vitalMetric('metric').notNull(),
  value: numeric('value', { precision: 12, scale: 4 }).notNull(),
  unit: varchar('unit', { length: 16 }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  bootId: bigint('boot_id', { mode: 'number' }).notNull(),
  sequenceNumber: bigint('sequence_number', { mode: 'number' }).notNull(),
  quality: vitalReadingQuality('quality').notNull().default('valid'),
}, (table) => [
  primaryKey({ name: 'vital_readings_pk', columns: [table.recordedAt, table.readingId] }),
  // Partition-local duplicate guard. The partition key MUST be part of any
  // unique index on a partitioned table, so `recorded_at` is included. The true
  // cross-partition guarantee lives in `vital_reading_ingest_claims`.
  uniqueIndex('vital_readings_dedupe_uq').on(
    table.deviceId, table.bootId, table.sequenceNumber, table.recordedAt,
  ),
  index('vital_readings_patient_metric_time_idx').on(
    table.patientProfileId, table.metric, table.recordedAt,
  ),
  index('vital_readings_device_time_idx').on(table.deviceId, table.recordedAt),
  check('vital_readings_boot_id_check', sql`${table.bootId} >= 0`),
  check('vital_readings_sequence_number_check', sql`${table.sequenceNumber} >= 0`),
  check('vital_readings_ingested_order_check', sql`${table.ingestedAt} >= ${table.recordedAt}`),
]);

/**
 * The dedupe ledger, and the ONLY object that makes an MQTT QoS-1 redelivery
 * incapable of creating a second reading row.
 *
 * `vital_readings` is partitioned, so PostgreSQL cannot enforce a unique key on
 * `(device_id, boot_id, sequence_number)` there — the key would have to include
 * `recorded_at`, which means a replay carrying a mutated timestamp could land in
 * a different partition and be accepted twice. This table is NOT partitioned, so
 * its primary key is a genuine global constraint. The claim is inserted in the
 * same transaction as the reading, so accepting a reading and claiming its
 * packet identity either both happen or neither does.
 */
export const vitalReadingIngestClaims = pgTable('vital_reading_ingest_claims', {
  deviceId: uuid('device_id').notNull().references(() => devices.deviceId),
  bootId: bigint('boot_id', { mode: 'number' }).notNull(),
  sequenceNumber: bigint('sequence_number', { mode: 'number' }).notNull(),
  readingId: uuid('reading_id').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  firstIngestedAt: timestamp('first_ingested_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({
    name: 'vital_reading_ingest_claims_pk',
    columns: [table.deviceId, table.bootId, table.sequenceNumber],
  }),
  index('vital_reading_ingest_claims_expiry_idx').on(table.expiresAt),
  check('vital_reading_ingest_claims_expiry_check', sql`${table.expiresAt} > ${table.firstIngestedAt}`),
]);

/**
 * Hourly rollups per device/patient/metric. `value_sum` and `sample_count` are
 * stored so the bucket can be extended incrementally and exactly; `value_avg` is
 * a generated column so no writer can ever record an average inconsistent with
 * the sum and count it was derived from.
 */
export const vitalReadingAggregates = pgTable('vital_reading_aggregates', {
  deviceId: uuid('device_id').notNull().references(() => devices.deviceId),
  patientProfileId: uuid('patient_profile_id').notNull().references(() => profiles.profileId),
  metric: vitalMetric('metric').notNull(),
  bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
  sampleCount: integer('sample_count').notNull(),
  valueSum: numeric('value_sum', { precision: 20, scale: 4 }).notNull(),
  valueMin: numeric('value_min', { precision: 12, scale: 4 }).notNull(),
  valueMax: numeric('value_max', { precision: 12, scale: 4 }).notNull(),
  valueAvg: numeric('value_avg', { precision: 20, scale: 6 })
    .generatedAlwaysAs(sql`("value_sum" / "sample_count")`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({
    name: 'vital_reading_aggregates_pk',
    columns: [table.deviceId, table.patientProfileId, table.metric, table.bucketStart],
  }),
  index('vital_reading_aggregates_patient_metric_idx').on(
    table.patientProfileId, table.metric, table.bucketStart,
  ),
  check('vital_reading_aggregates_sample_count_check', sql`${table.sampleCount} > 0`),
  check('vital_reading_aggregates_bounds_check', sql`${table.valueMin} <= ${table.valueMax}`),
  // The three-argument `date_trunc` is used deliberately: the two-argument
  // timestamptz form is only STABLE (it reads the session TimeZone) and
  // PostgreSQL refuses a non-IMMUTABLE expression in a CHECK constraint.
  check('vital_reading_aggregates_bucket_check', sql`${table.bucketStart} = date_trunc('hour', ${table.bucketStart}, 'UTC')`),
]);

/**
 * Alert thresholds, scoped either to the whole organization
 * (`patient_profile_id IS NULL`) or to one patient. A patient-scoped row wins
 * over the organization default for the same metric and comparator; that
 * precedence is resolved at evaluation time, not by deleting the default.
 */
export const healthAlertThresholds = pgTable('health_alert_thresholds', {
  thresholdId: uuid('threshold_id').primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  patientProfileId: uuid('patient_profile_id').references(() => profiles.profileId),
  metric: vitalMetric('metric').notNull(),
  comparator: healthThresholdComparator('comparator').notNull(),
  thresholdValue: numeric('threshold_value', { precision: 12, scale: 4 }).notNull(),
  severity: healthAlertSeverity('severity').notNull(),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('health_alert_thresholds_org_scope_uq')
    .on(table.organizationId, table.metric, table.comparator, table.severity)
    .where(sql`patient_profile_id IS NULL AND retired_at IS NULL`),
  uniqueIndex('health_alert_thresholds_patient_scope_uq')
    .on(table.organizationId, table.patientProfileId, table.metric, table.comparator, table.severity)
    .where(sql`patient_profile_id IS NOT NULL AND retired_at IS NULL`),
  index('health_alert_thresholds_lookup_idx').on(
    table.organizationId, table.metric, table.retiredAt,
  ),
  check('health_alert_thresholds_version_check', sql`${table.version} >= 0`),
]);

/**
 * A breach of one threshold by one reading. `observed_value` is clinical data and
 * deliberately never leaves this table in a published event payload.
 */
export const healthAlerts = pgTable('health_alerts', {
  alertId: uuid('alert_id').primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  patientProfileId: uuid('patient_profile_id').notNull().references(() => profiles.profileId),
  deviceId: uuid('device_id').notNull(),
  metric: vitalMetric('metric').notNull(),
  observedValue: numeric('observed_value', { precision: 12, scale: 4 }).notNull(),
  thresholdId: uuid('threshold_id').notNull().references(() => healthAlertThresholds.thresholdId),
  severity: healthAlertSeverity('severity').notNull(),
  state: healthAlertState('state').notNull().default('open'),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  acknowledgedByProfileId: uuid('acknowledged_by_profile_id').references(() => profiles.profileId),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({
    name: 'health_alerts_device_org_fk',
    columns: [table.deviceId, table.organizationId],
    foreignColumns: [devices.deviceId, devices.organizationId],
  }),
  // One live alert per patient/metric/threshold. Without this, a patient whose
  // reading stays above a threshold for an hour would generate sixty alerts and
  // bury the first one.
  uniqueIndex('health_alerts_live_uq')
    .on(table.patientProfileId, table.metric, table.thresholdId)
    .where(sql`state <> 'resolved'`),
  index('health_alerts_patient_state_idx').on(
    table.patientProfileId, table.state, table.observedAt, table.alertId,
  ),
  index('health_alerts_org_state_idx').on(table.organizationId, table.state, table.severity),
  check('health_alerts_version_check', sql`${table.version} >= 0`),
  check('health_alerts_acknowledged_pair_check', sql`(${table.acknowledgedAt} IS NULL) = (${table.acknowledgedByProfileId} IS NULL)`),
  check('health_alerts_acknowledged_state_check', sql`${table.acknowledgedAt} IS NULL OR ${table.state} IN ('acknowledged', 'resolved')`),
  check('health_alerts_resolved_state_check', sql`(${table.state} = 'resolved') = (${table.resolvedAt} IS NOT NULL)`),
  check('health_alerts_acknowledged_order_check', sql`${table.acknowledgedAt} IS NULL OR ${table.acknowledgedAt} >= ${table.observedAt}`),
  check('health_alerts_resolved_order_check', sql`${table.resolvedAt} IS NULL OR ${table.resolvedAt} >= ${table.observedAt}`),
]);

// ---------------------------------------------------------------------------
// WP-07b: firmware registry and OTA rollouts (migration 0022).
//
// The enums below were created by migration 0021 (`reading_source`,
// `device_connectivity_status`, `calibration_status`, `device_command_status`,
// `firmware_rollout_status`, `device_hardware_profile`). Only the two the
// firmware tables depend on are declared here so the Drizzle bindings can type
// the columns; the others are consumed by tables this file does not yet bind.
// ---------------------------------------------------------------------------

/**
 * Hardware profile a firmware artifact targets. A build for one board will not
 * flash cleanly onto another, so the registry keys every version by profile and
 * a device only ever fetches the line compiled for its own. Migration 0021
 * created the enum with the single SmartCura ESP32 revision.
 */
export const deviceHardwareProfile = pgEnum('device_hardware_profile', [
  'smartcura_esp32_v1',
]);

/**
 * Lifecycle of a firmware rollout. `draft` and `paused` hold back delivery;
 * `active` is what makes a version eligible for the version-check response;
 * `completed`, `failed` and `cancelled` are terminal.
 */
export const firmwareRolloutStatus = pgEnum('firmware_rollout_status', [
  'draft', 'scheduled', 'active', 'paused', 'completed', 'failed', 'cancelled',
]);

/**
 * The authoritative firmware registry. The binary artifact lives in object
 * storage under `object_key`; PostgreSQL owns the `sha256` so a tampered or
 * truncated download is detectable before the device commits the flash. The
 * version is a frozen `X.Y.Z` semantic string so ordering is comparable rather
 * than lexical guesswork.
 */
export const firmwareVersions = pgTable('firmware_versions', {
  firmwareVersionId: uuid('firmware_version_id').primaryKey(),
  hardwareProfile: deviceHardwareProfile('hardware_profile').notNull(),
  version: varchar('version', { length: 32 }).notNull(),
  objectKey: varchar('object_key', { length: 512 }).notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('firmware_versions_profile_version_uq').on(table.hardwareProfile, table.version),
  uniqueIndex('firmware_versions_sha_uq').on(table.sha256),
  check('firmware_versions_version_check', sql`${table.version} ~ '^[0-9]+\\.[0-9]+\\.[0-9]+$'`),
  check('firmware_versions_sha_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  check('firmware_versions_size_check', sql`${table.sizeBytes} > 0`),
]);

/**
 * A rollout directs one firmware version at one organization. At most one live
 * rollout per (organization, firmware_version) is enforced by a partial unique
 * index, so two concurrent campaigns cannot both claim to be delivering the same
 * build. `scheduled_at` is required iff the status is `scheduled`.
 */
export const firmwareRollouts = pgTable('firmware_rollouts', {
  rolloutId: uuid('rollout_id').primaryKey(),
  firmwareVersionId: uuid('firmware_version_id').notNull().references(() => firmwareVersions.firmwareVersionId),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  status: firmwareRolloutStatus('status').notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('firmware_rollouts_live_uq')
    .on(table.organizationId, table.firmwareVersionId)
    .where(sql`status IN ('draft', 'scheduled', 'active', 'paused')`),
  check('firmware_rollouts_version_check', sql`${table.version} >= 0`),
  check('firmware_rollouts_scheduled_check', sql`${table.status} <> 'scheduled' OR ${table.scheduledAt} IS NOT NULL`),
]);

/**
 * Append-only per-device firmware update trail. A device reports one row per
 * outcome as it progresses through an update (offered → downloading → installed
 * or failed/rejected). The `device_firmware_events_reject_mutation` trigger
 * refuses UPDATE and DELETE so the history cannot be rewritten.
 */
export const deviceFirmwareEvents = pgTable('device_firmware_events', {
  eventId: uuid('event_id').primaryKey(),
  deviceId: uuid('device_id').notNull().references(() => devices.deviceId),
  rolloutId: uuid('rollout_id').references(() => firmwareRollouts.rolloutId),
  firmwareVersionId: uuid('firmware_version_id').notNull().references(() => firmwareVersions.firmwareVersionId),
  outcome: varchar('outcome', { length: 32 }).notNull(),
  detailCode: varchar('detail_code', { length: 64 }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('device_firmware_events_device_idx').on(table.deviceId, table.occurredAt, table.eventId),
  check('device_firmware_events_outcome_check', sql`${table.outcome} IN ('offered', 'downloading', 'installed', 'failed', 'rejected')`),
]);
