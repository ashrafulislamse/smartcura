import { z } from 'zod';
import {
  DEVICE_RELEASE_REASON_CODES,
  VITAL_METRIC_BOUNDS,
  VITAL_METRIC_UNITS,
  type DeviceCredentialTypeValue,
  type DeviceStateValue,
  type DeviceTypeValue,
  type HealthAlertStateValue,
  type VitalMetricValue,
  type VitalReadingQualityValue,
} from '@smartcura/database/iot';

const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

/**
 * Absolute instant with an explicit offset. A bare local timestamp is rejected: a
 * reading time means nothing without a zone, and guessing the server's zone would
 * shift a device's whole buffer when it uploads from another one — straight into
 * the wrong `vital_readings` partition.
 */
const instant = z.string().min(20).max(40).refine((value) => {
  if (!/[Zz]$|[+-][01][0-9]:[0-5][0-9]$/.test(value)) return false;
  return Number.isFinite(new Date(value).getTime());
});

/**
 * The metric list is DERIVED from `VITAL_METRIC_UNITS` rather than retyped, so a
 * metric added to the data layer cannot be silently unaccepted here. The data
 * layer exports the canonical unit and bound tables but no metric tuple, so the
 * key set is the single source of truth available.
 */
const VITAL_METRICS = Object.keys(VITAL_METRIC_UNITS) as [
  VitalMetricValue,
  ...VitalMetricValue[],
];

/**
 * These three lists exist as literals because the data layer exports them only as
 * union TYPES (`DeviceStateValue`, `DeviceTypeValue`, `DeviceCredentialTypeValue`,
 * `VitalReadingQualityValue`, `HealthAlertStateValue`) with no runtime tuple to
 * derive from, unlike `DEVICE_RELEASE_REASON_CODES`. They are annotated with the
 * corresponding type so a divergence from the enum in migration 0014 fails to
 * compile instead of failing at request time.
 */
const DEVICE_STATES = [
  'provisioned', 'active', 'suspended', 'retired',
] as const satisfies readonly DeviceStateValue[];
const DEVICE_TYPES = [
  'vitals_monitor', 'ecg', 'thermometer', 'pulse_oximeter', 'simulator', 'phone',
] as const satisfies readonly DeviceTypeValue[];
const DEVICE_CREDENTIAL_TYPES = [
  'mqtt_password', 'client_certificate',
] as const satisfies readonly DeviceCredentialTypeValue[];
const VITAL_READING_QUALITIES = [
  'valid', 'suspect', 'invalid', 'unknown',
] as const satisfies readonly VitalReadingQualityValue[];
const HEALTH_ALERT_STATES = [
  'open', 'acknowledged', 'escalated', 'resolved', 'dismissed',
] as const satisfies readonly HealthAlertStateValue[];

/**
 * Exported so a decoded pagination cursor's identifier is validated by the same
 * rule as one that arrived in a path segment. A tampered cursor is then a
 * validation failure rather than an unchecked value reaching a query.
 */
export const uuidV7Schema = uuidV7;

export const idempotencyKeySchema = z.string().trim().min(16).max(128)
  .regex(/^[A-Za-z0-9._~-]+$/);

export const organizationPathSchema = z.object({
  organizationId: uuidV7,
}).strict();

export const devicePathSchema = z.object({
  deviceId: uuidV7,
}).strict();

export const patientProfilePathSchema = z.object({
  patientProfileId: uuidV7,
}).strict();

export const healthAlertPathSchema = z.object({
  alertId: uuidV7,
}).strict();

export const listDevicesQuerySchema = z.object({
  state: z.enum(DEVICE_STATES).optional(),
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

/**
 * Device registration.
 *
 * `provisioning_secret` is the PLAINTEXT credential the client chooses for the
 * broker. It is accepted here, hashed to a SHA-256 digest in the service, and
 * discarded: nothing downstream — repository input, stored row, audit metadata,
 * idempotency request fingerprint, response body or log line — ever sees the
 * plaintext again. Its shape is constrained only enough to reject a value too
 * weak to be a broker credential; it is never compared, echoed or parsed.
 *
 * The serial number pattern is the same one `devices_serial_number_check`
 * enforces. Matching it here turns a mis-cased or space-padded label into a
 * VALIDATION_FAILED with a field context instead of a constraint violation
 * surfacing as a 500.
 */
export const registerDeviceSchema = z.object({
  device_type: z.enum(DEVICE_TYPES),
  serial_number: z.string().regex(/^[A-Z0-9][A-Z0-9-]{3,63}$/),
  hardware_revision: z.string().min(1).max(32).nullable().default(null),
  firmware_version: z.string().min(1).max(32).nullable().default(null),
  credential_type: z.enum(DEVICE_CREDENTIAL_TYPES),
  provisioning_secret: z.string().min(32).max(512).regex(/^[\x21-\x7e]+$/),
}).strict();

export const assignDeviceSchema = z.object({
  patient_profile_id: uuidV7,
  expected_version: z.number().int().min(0),
}).strict();

/**
 * Release carries a structured, PHI-free reason code and never operator free
 * text: the reason lands in a broadly retained audit log and in append-only
 * assignment history, where clinical detail typed into an open field can never be
 * withdrawn.
 */
export const releaseDeviceSchema = z.object({
  expected_version: z.number().int().min(0),
  reason_code: z.enum(DEVICE_RELEASE_REASON_CODES),
}).strict();

/**
 * One reading as a device reports it.
 *
 * `boot_id` and `sequence_number` are the packet identity the ingest claim ledger
 * deduplicates on, so they are mandatory and non-negative: a wrapped or tampered
 * counter makes the identity untrustworthy, and the database check rejects it
 * anyway.
 *
 * The unit and value range are validated against the metric rather than accepted
 * as free-form. A heart rate labelled `Cel` is not a formatting mistake — it
 * would be charted as a temperature — and both rules mirror
 * `vital_readings_unit_check` and `vital_readings_value_range_check`, so a
 * self-contradictory body is a 422 here rather than a constraint violation that
 * aborts the whole batch.
 */
const ingestReadingSchema = z.object({
  boot_id: z.number().int().min(0),
  sequence_number: z.number().int().min(0),
  metric: z.enum(VITAL_METRICS),
  value: z.number().finite(),
  unit: z.string().min(1).max(16),
  recorded_at: instant,
  quality: z.enum(VITAL_READING_QUALITIES),
}).strict()
  .refine(
    (reading) => reading.unit === VITAL_METRIC_UNITS[reading.metric],
    { message: 'unit does not match the expected UCUM unit for this metric' },
  )
  .refine(
    (reading) => {
      const bounds = VITAL_METRIC_BOUNDS[reading.metric];
      return reading.value >= bounds.min && reading.value <= bounds.max;
    },
    { message: 'value is outside the accepted range for this metric' },
  );

/**
 * A batch upload. The lower bound of one rejects an empty submission, which is
 * indistinguishable from a client bug; the upper bound of 200 keeps one
 * transaction — claims, readings, rollups, threshold evaluation and outbox rows —
 * inside a predictable amount of work, since a device replaying an offline buffer
 * would otherwise send its whole day in a single statement.
 */
export const ingestVitalReadingsSchema = z.object({
  readings: z.array(ingestReadingSchema).min(1).max(200),
}).strict();

/**
 * Reading history. The time window is optional but the patient is never a query
 * parameter on the own-readings route: the profile always comes from the session,
 * because a readable patient identifier in a query string is an invitation to
 * substitute someone else's.
 */
export const listReadingsQuerySchema = z.object({
  metric: z.enum(VITAL_METRICS).optional(),
  device_id: uuidV7.optional(),
  from: instant.optional(),
  to: instant.optional(),
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict()
  .refine((query) =>
    query.from === undefined || query.to === undefined ||
    new Date(query.to) > new Date(query.from));

export const listHealthAlertsQuerySchema = z.object({
  state: z.enum(HEALTH_ALERT_STATES).optional(),
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const acknowledgeHealthAlertSchema = z.object({
  expected_version: z.number().int().min(0),
}).strict();

/**
 * Escalation, resolution and dismissal. `escalated_to_membership_id` is only
 * meaningful for an escalation: naming a recipient while resolving would record a
 * hand-off that never happened.
 */
export const transitionHealthAlertSchema = z.object({
  state: z.enum(['escalated', 'resolved', 'dismissed']),
  reason_code: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  escalated_to_membership_id: uuidV7.nullable().default(null),
  expected_version: z.number().int().min(0),
}).strict().superRefine((value, context) => {
  if (value.state !== 'escalated' && value.escalated_to_membership_id !== null) {
    context.addIssue({
      code: 'custom', path: ['escalated_to_membership_id'],
      message: 'Only an escalation may name a recipient membership',
    });
  }
});

export type ListDevicesQuery = z.infer<typeof listDevicesQuerySchema>;
export type RegisterDeviceRequest = z.infer<typeof registerDeviceSchema>;
export type AssignDeviceRequest = z.infer<typeof assignDeviceSchema>;
export type ReleaseDeviceRequest = z.infer<typeof releaseDeviceSchema>;
export type IngestVitalReadingsRequest = z.infer<typeof ingestVitalReadingsSchema>;
export type ListReadingsQuery = z.infer<typeof listReadingsQuerySchema>;
export type ListHealthAlertsQuery = z.infer<typeof listHealthAlertsQuerySchema>;
export type AcknowledgeHealthAlertRequest = z.infer<typeof acknowledgeHealthAlertSchema>;
export type TransitionHealthAlertRequest = z.infer<typeof transitionHealthAlertSchema>;
