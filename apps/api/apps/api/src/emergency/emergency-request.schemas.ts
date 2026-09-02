import { EMERGENCY_EVENT_STATUSES, EMERGENCY_UNIT_STATUSES, TRIAGE_PRIORITIES } from '@smartcura/database/emergency';
import { z } from 'zod';
import { VITAL_METRIC_UNITS } from '@smartcura/database/iot';

/**
 * Metrics are DERIVED from the canonical unit table, exactly as the IoT request schemas
 * do it, so a renamed metric cannot leave a stale copy behind here.
 */
const VITAL_METRICS = Object.keys(VITAL_METRIC_UNITS) as [
  keyof typeof VITAL_METRIC_UNITS, ...(keyof typeof VITAL_METRIC_UNITS)[],
];

const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
const code = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const expectedVersion = z.number().int().min(0);

/** Decimal strings end to end, matching the numeric columns. */
const latitude = z.string().regex(/^-?(?:90(?:\.0{1,6})?|[1-8]?\d(?:\.\d{1,6})?)$/);
const longitude = z.string()
  .regex(/^-?(?:180(?:\.0{1,6})?|1[0-7]\d(?:\.\d{1,6})?|\d{1,2}(?:\.\d{1,6})?)$/);

/**
 * The SOS command.
 *
 * `patient_profile_id` is accepted because a bystander or family member may raise an
 * event for someone else, but the service still verifies the relationship: it is not
 * enough to name any profile. The reporter is always taken from the session.
 */
export const raiseEmergencySchema = z.object({
  organization_id: uuidV7,
  site_id: uuidV7.nullable().default(null),
  patient_profile_id: uuidV7.nullable().default(null),
  category_code: code,
  latitude: latitude.nullable().default(null),
  longitude: longitude.nullable().default(null),
  address_text: z.string().trim().min(1).max(500).nullable().default(null),
  // DERIVED from the canonical vocabulary rather than retyped. A hand-written list
  // here used the pre-WP-07 names `spo2`/`good`, which the contract test caught and
  // which would have failed at insert time against the renamed database enums. The
  // unit is checked against the canonical unit for the metric for the same reason.
  vitals: z.array(z.object({
    metric: z.enum(VITAL_METRICS),
    value: z.string().regex(/^-?\d{1,8}(\.\d{1,4})?$/),
    unit: z.string().regex(/^[A-Za-z%/_[\]°]{1,16}$/),
    quality: z.enum(['valid', 'suspect', 'invalid', 'unknown']),
    measured_at: z.string().datetime({ offset: true }),
  }).strict().refine(
    (reading) => reading.unit === VITAL_METRIC_UNITS[reading.metric],
    { message: 'the unit must be the canonical unit for the metric' },
  )).max(16).default([]),
}).strict().refine(
  (value) => (value.latitude === null) === (value.longitude === null),
  { message: 'latitude and longitude must be supplied together' },
);

export const recordTriageSchema = z.object({
  // `unknown` is the absence of assessment, so it is not an assessable outcome.
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  protocol_code: code,
  reason_code: code,
  expected_version: expectedVersion,
}).strict();

export const reserveUnitSchema = z.object({
  emergency_unit_id: uuidV7,
  manual_override: z.boolean().default(false),
  override_reason_code: code.nullable().default(null),
  expected_version: expectedVersion,
}).strict().refine(
  // Mirrors the database CHECK, so an unexplained override is refused as a validation
  // failure rather than surfacing a constraint violation as a 500.
  (value) => (value.manual_override
    ? value.override_reason_code !== null
    : value.override_reason_code === null),
  { message: 'a manual override requires a reason code, and only an override may carry one' },
);

export const advanceEmergencySchema = z.object({
  status: z.enum(['dispatching', 'responding', 'on_scene', 'transporting',
    'resolved', 'cancelled', 'false_alarm']),
  reason_code: code.nullable().default(null),
  expected_version: expectedVersion,
}).strict().refine(
  (value) => (value.status === 'cancelled' || value.status === 'false_alarm'
    ? value.reason_code !== null : true),
  { message: 'a cancelled or false-alarm outcome requires a reason code' },
);

export const resolveEmergencySchema = z.object({
  resolution_type: z.enum(['treated_on_scene', 'transported', 'cancelled_by_requester',
    'false_alarm', 'duplicate', 'other']),
  notes: z.string().trim().min(1).max(4000),
  outcome_code: code.nullable().default(null),
  expected_version: expectedVersion,
}).strict();

export const recordCommunicationSchema = z.object({
  channel: z.enum(['voice', 'sms', 'in_app', 'radio']),
  direction: z.enum(['inbound', 'outbound']),
  // Structured summary only: verbatim call content would put unbounded clinical
  // narrative into a table that is read under break-glass.
  summary_code: code,
}).strict();

/**
 * Break-glass activation.
 *
 * `grant_minutes` is bounded here and again by a database CHECK. A renewal must name the
 * grant it supersedes AND carry a fresh reason, because policy requires a new
 * reason/event record per renewal rather than an extension of an existing window.
 */
export const activateBreakGlassSchema = z.object({
  emergency_event_id: uuidV7,
  reason_code: code,
  reason_detail: z.string().trim().min(1).max(2000).nullable().default(null),
  renews_grant_id: uuidV7.nullable().default(null),
  grant_minutes: z.number().int().min(1).max(15).default(15),
}).strict();

export const terminateBreakGlassSchema = z.object({
  reason_code: code,
}).strict();

export const reviewBreakGlassSchema = z.object({
  outcome: z.enum(['justified', 'unjustified', 'inconclusive']),
  notes: z.string().trim().min(1).max(4000),
}).strict();

export type RaiseEmergencyRequest = z.infer<typeof raiseEmergencySchema>;
export type RecordTriageRequest = z.infer<typeof recordTriageSchema>;
export type ReserveUnitRequest = z.infer<typeof reserveUnitSchema>;
export type AdvanceEmergencyRequest = z.infer<typeof advanceEmergencySchema>;
export type ResolveEmergencyRequest = z.infer<typeof resolveEmergencySchema>;
export type RecordCommunicationRequest = z.infer<typeof recordCommunicationSchema>;
export type ActivateBreakGlassRequest = z.infer<typeof activateBreakGlassSchema>;
export type ReviewBreakGlassRequest = z.infer<typeof reviewBreakGlassSchema>;

/**
 * Dispatch queue filters. Vocabularies are DERIVED from the canonical exports rather
 * than retyped: hand-copying an enum is how `waiting_requester` became
 * `waiting_on_requester` elsewhere in this codebase on the first attempt.
 */
export const listEmergenciesSchema = z.object({
  status: z.enum(EMERGENCY_EVENT_STATUSES as unknown as [string, ...string[]]).optional(),
  triage_priority: z.enum(TRIAGE_PRIORITIES as unknown as [string, ...string[]]).optional(),
  /** Default true: an operator opening the queue wants what is still happening. */
  active_only: z.enum(['true', 'false']).default('true'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

/**
 * Fleet roster filters. The status vocabulary is DERIVED from the canonical
 * `EMERGENCY_UNIT_STATUSES` export, not retyped — hand-copying an enum is how
 * `waiting_requester` became `waiting_on_requester` elsewhere in this codebase.
 */
export const listEmergencyUnitsSchema = z.object({
  status: z.enum(EMERGENCY_UNIT_STATUSES as unknown as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
