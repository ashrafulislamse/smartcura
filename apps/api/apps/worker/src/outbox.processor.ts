import { Injectable, Logger } from '@nestjs/common';
import { formatSafeLog } from '@smartcura/observability';
import {
  CARE_ASSIGNMENT_CHANGED_EVENT_TYPE,
  CARE_ASSIGNMENT_CHANGED_EVENT_VERSION,
  CONSENT_CHANGED_EVENT_TYPE,
  CONSENT_CHANGED_EVENT_VERSION,
  DOCTOR_REVIEW_CHANGED_EVENT_TYPE,
  DOCTOR_REVIEW_CHANGED_EVENT_VERSION,
  FILE_SCAN_COMPLETED_EVENT_TYPE,
  FILE_SCAN_COMPLETED_EVENT_VERSION,
  FILE_SCAN_REQUESTED_EVENT_TYPE,
  FILE_SCAN_REQUESTED_EVENT_VERSION,
  APPOINTMENT_CHANGED_EVENT_TYPE,
  APPOINTMENT_CHANGED_EVENT_VERSION,
  APPOINTMENT_PAYMENT_REQUESTED_EVENT_TYPE,
  APPOINTMENT_PAYMENT_REQUESTED_EVENT_VERSION,
  CONSULTATION_CHANGED_EVENT_TYPE,
  CONSULTATION_CHANGED_EVENT_VERSION,
  MESSAGE_CREATED_EVENT_TYPE,
  MESSAGE_CREATED_EVENT_VERSION,
  RECEIPT_UPDATED_EVENT_TYPE,
  RECEIPT_UPDATED_EVENT_VERSION,
  PRESCRIPTION_CHANGED_EVENT_TYPE,
  PRESCRIPTION_CHANGED_EVENT_VERSION,
  PRESCRIPTION_PDF_REQUESTED_EVENT_TYPE,
  PRESCRIPTION_PDF_REQUESTED_EVENT_VERSION,
  PHARMACY_PRESCRIPTION_INTAKE_EVENT_TYPE,
  PHARMACY_PRESCRIPTION_INTAKE_EVENT_VERSION,
  NOTIFICATION_PUSH_REQUESTED_EVENT_TYPE,
  NOTIFICATION_PUSH_REQUESTED_EVENT_VERSION,
  NOTIFICATION_EMAIL_REQUESTED_EVENT_TYPE,
  NOTIFICATION_EMAIL_REQUESTED_EVENT_VERSION,
  AI_GENERATION_REQUESTED_EVENT_TYPE,
  AI_GENERATION_REQUESTED_EVENT_VERSION,
  AI_ARTIFACT_CHANGED_EVENT_TYPE,
  AI_ARTIFACT_CHANGED_EVENT_VERSION,
  PHARMACY_ORDER_CHANGED_EVENT_TYPE,
  PHARMACY_ORDER_CHANGED_EVENT_VERSION,
  DISPATCH_ASSIGNMENT_CHANGED_EVENT_TYPE,
  DISPATCH_ASSIGNMENT_CHANGED_EVENT_VERSION,
  DISPATCH_OFFER_EXPIRED_EVENT_TYPE,
  DISPATCH_OFFER_EXPIRED_EVENT_VERSION,
  EMERGENCY_EVENT_CHANGED_EVENT_TYPE,
  EMERGENCY_EVENT_CHANGED_EVENT_VERSION,
  EMERGENCY_DISPATCH_CHANGED_EVENT_TYPE,
  EMERGENCY_DISPATCH_CHANGED_EVENT_VERSION,
  EMERGENCY_RESOLVED_EVENT_TYPE,
  EMERGENCY_RESOLVED_EVENT_VERSION,
  BREAK_GLASS_ACTIVATED_EVENT_TYPE,
  BREAK_GLASS_ACTIVATED_EVENT_VERSION,
  BREAK_GLASS_TERMINATED_EVENT_TYPE,
  BREAK_GLASS_TERMINATED_EVENT_VERSION,
  EMERGENCY_EVENT_STATUSES as EMERGENCY_EVENT_STATUS_VALUES,
  TRIAGE_PRIORITIES as TRIAGE_PRIORITY_VALUES,
  EMERGENCY_UNIT_STATUSES as EMERGENCY_UNIT_STATUS_VALUES,
  EMERGENCY_RESOLUTION_TYPES as EMERGENCY_RESOLUTION_TYPE_VALUES,
  LEDGER_ENTRY_POSTED_EVENT_TYPE,
  LEDGER_ENTRY_POSTED_EVENT_VERSION,
  PAYOUT_RUN_CHANGED_EVENT_TYPE,
  PAYOUT_RUN_CHANGED_EVENT_VERSION,
  SUPPORT_TICKET_CHANGED_EVENT_TYPE,
  SUPPORT_TICKET_CHANGED_EVENT_VERSION,
  EXPORT_JOB_CHANGED_EVENT_TYPE,
  EXPORT_JOB_CHANGED_EVENT_VERSION,
  LEDGER_ENTRY_KINDS as LEDGER_ENTRY_KIND_VALUES,
  PAYOUT_RUN_STATUSES as PAYOUT_RUN_STATUS_VALUES,
  SUPPORT_TICKET_STATUSES as SUPPORT_TICKET_STATUS_VALUES,
  EXPORT_JOB_STATUSES as EXPORT_JOB_STATUS_VALUES,
  AVAILABILITY_CHANGED_EVENT_TYPE,
  AVAILABILITY_CHANGED_EVENT_VERSION,
  DEVICE_CHANGED_EVENT_TYPE,
  DEVICE_CHANGED_EVENT_VERSION,
  DOCTOR_DETAIL_CHANGED_EVENT_TYPE,
  DOCTOR_DETAIL_CHANGED_EVENT_VERSION,
  HEALTH_ALERT_CHANGED_EVENT_TYPE,
  HEALTH_ALERT_CHANGED_EVENT_VERSION,
  MEMBERSHIP_CHANGED_EVENT_TYPE,
  MEMBERSHIP_CHANGED_EVENT_VERSION,
  PROFILE_CHANGED_EVENT_TYPE,
  PROFILE_CHANGED_EVENT_VERSION,
  PROFILE_DETAIL_CHANGED_EVENT_TYPE,
  PROFILE_DETAIL_CHANGED_EVENT_VERSION,
  VERIFICATION_DOCUMENT_CHANGED_EVENT_TYPE,
  VERIFICATION_DOCUMENT_CHANGED_EVENT_VERSION,
  VITAL_READING_CHANGED_EVENT_TYPE,
  VITAL_READING_CHANGED_EVENT_VERSION,
  type ClaimedOutboxEvent,
} from '@smartcura/database';
import {
  BROADCAST_DISPATCH_REQUESTED_EVENT_TYPE,
  BROADCAST_DISPATCH_REQUESTED_EVENT_VERSION,
  Stage11Repository,
} from '@smartcura/database/stage11';
import { PrivateFileScanHandler } from './private-file-scan.handler.js';
import { AppointmentPaymentHandler } from './appointment-payment.handler.js';
import { NotificationPushHandler } from './notification-push.handler.js';
import { NotificationEmailHandler } from './notification-email.handler.js';
import { PrescriptionPdfHandler } from './prescription-pdf.handler.js';
import { AiGenerationHandler } from './ai-generation.handler.js';
import { ChatEventPublisher } from './chat-event.publisher.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/**
 * `Date.prototype.toISOString` output, which is what every producer writes. A
 * looser check would accept a local-time string, and a subscriber that treats it
 * as UTC would misplace a reading by the offset.
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
/**
 * Structured lowercase reason codes only, matching the database CHECK that gates
 * the same value on the row. Free text on a reason field is the likeliest route
 * for clinical detail to reach a widely fanned-out event.
 */
const REASON_CODE = /^[a-z][a-z0-9_]{1,62}$/;

const MEMBERSHIP_ROLES = new Set([
  'patient', 'doctor', 'driver', 'pharmacy', 'emergency', 'admin', 'super_admin',
]);
const MEMBERSHIP_STATUSES = new Set([
  'applied', 'invited', 'active', 'suspended', 'revoked', 'expired',
]);
const PROFILE_STATUSES = new Set(['pending', 'active', 'suspended', 'deactivated']);
const PROFILE_DETAIL_KINDS = new Set([
  'address', 'emergency_contact', 'allergy', 'condition',
]);
const PROFILE_DETAIL_CHANGES = new Set(['created', 'updated', 'removed']);
// A doctor detail row is only ever created or updated; it is never removed, so
// `removed` is deliberately not accepted here.
const DOCTOR_DETAIL_CHANGES = new Set(['created', 'updated']);
const VERIFICATION_DOCUMENT_KINDS = new Set([
  'medical_license', 'national_id', 'driving_licence', 'vehicle_registration',
  'pharmacy_licence', 'qualification_certificate', 'professional_indemnity',
]);
const VERIFICATION_STATUSES = new Set([
  'not_submitted', 'pending_review', 'changes_requested', 'approved',
  'rejected', 'suspended', 'expired',
]);
const AVAILABILITY_CHANGES = new Set([
  'rules_replaced', 'exception_recorded', 'slots_generated',
]);
const APPOINTMENT_STATUSES = new Set([
  'pending_payment', 'confirmed', 'checked_in', 'in_progress',
  'cancelled', 'completed', 'no_show', 'rescheduled',
]);
const DEVICE_TYPES = new Set([
  'vitals_monitor', 'ecg', 'thermometer', 'pulse_oximeter', 'simulator',
]);
const DEVICE_STATES = new Set(['provisioned', 'active', 'suspended', 'retired']);
// The implemented `vital_metric` labels, which differ from the older speculative
// `iot.reading_recorded.v1` vocabulary in the same contract document.
const VITAL_METRICS = new Set([
  'heart_rate', 'oxygen_saturation', 'body_temperature', 'systolic_bp', 'diastolic_bp',
  'respiratory_rate', 'ecg_voltage', 'blood_pressure', 'blood_glucose', 'body_weight',
]);
const VITAL_READING_QUALITIES = new Set(['valid', 'suspect', 'invalid', 'unknown']);
const HEALTH_ALERT_SEVERITIES = new Set(['info', 'warning', 'critical']);
const HEALTH_ALERT_STATES = new Set([
  'open', 'acknowledged', 'escalated', 'resolved', 'dismissed',
]);
const CONSENT_SCOPES = new Set([
  'profile_contact', 'clinical_record', 'medication', 'iot_reading',
  'ai_artifact', 'full_record',
]);
const CONSENT_STATUSES = new Set(['active', 'revoked', 'expired']);
const CARE_ASSIGNMENT_STATUSES = new Set(['active', 'completed', 'revoked', 'expired']);
const DOCTOR_REVIEW_CHANGES = new Set(['created', 'updated']);
const FILE_SCAN_STATES = new Set(['clean', 'infected', 'scan_failed']);
const CONSULTATION_STATES = new Set(['not_started', 'ready', 'in_progress', 'completed', 'cancelled']);
const PRESCRIPTION_STATES = new Set(['draft', 'signed', 'superseded', 'cancelled', 'expired', 'discarded']);
const MESSAGE_TYPES = new Set(['text', 'file', 'system']);
const AI_ARTIFACT_TYPES = new Set([
  'symptom_summary', 'care_navigation', 'health_summary', 'risk_flag', 'forecast', 'anomaly',
]);
const AI_REVIEW_STATUSES = new Set([
  'pending_review', 'approved', 'rejected', 'superseded',
]);
const PHARMACY_ORDER_STATES = new Set([
  'received', 'awaiting_validation', 'validated', 'stock_reserved', 'fulfilling',
  'ready_for_dispatch', 'dispatched', 'delivered', 'delivery_exception', 'returned',
  'rejected', 'cancelled',
]);
const DISPATCH_ASSIGNMENT_STATES = new Set([
  'assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up',
  'en_route_dropoff', 'arrived_dropoff', 'completed', 'cancelled', 'failed',
]);

/**
 * Declarative payload contract for each handled event, mirroring the AsyncAPI
 * schemas. Every schema there sets `additionalProperties: false`, so the exact
 * field set is part of the contract and is enforced here.
 */
interface PayloadContract {
  readonly version: number;
  readonly fields: readonly {
    readonly name: string;
    readonly check: (value: unknown) => boolean;
  }[];
}

const uuidField = (name: string) => ({
  name,
  check: (value: unknown) => typeof value === 'string' && UUID_V7.test(value),
});
const enumField = (name: string, allowed: ReadonlySet<string>) => ({
  name,
  check: (value: unknown) => typeof value === 'string' && allowed.has(value),
});
const booleanField = (name: string) => ({
  name,
  check: (value: unknown) => typeof value === 'boolean',
});
/**
 * A nullable enum. The key must still be PRESENT — `payloadMatches` counts keys,
 * and an omitted "previous status" is a producer bug, not a first transition.
 */
const nullableEnumField = (name: string, allowed: ReadonlySet<string>) => ({
  name,
  check: (value: unknown) => value === null || (typeof value === 'string' && allowed.has(value)),
});
/** Nullable structured reason code; see `REASON_CODE` for why free text is refused. */
const nullableReasonCodeField = (name: string) => ({
  name,
  check: (value: unknown) => value === null || (typeof value === 'string' && REASON_CODE.test(value)),
});
/**
 * An ISO-8601 instant carried as a JSON string, because `jsonb` has no date type
 * and a subscriber cannot order events on an ambiguous local timestamp.
 */
const timestampField = (name: string) => ({
  name,
  check: (value: unknown) => typeof value === 'string' && ISO_TIMESTAMP.test(value),
});
/**
 * A non-negative count. `typeof value === 'number'` alone would admit a float or
 * NaN from a mis-serialized aggregate, which no consumer could act on.
 */
const countField = (name: string) => ({
  name,
  check: (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0,
});

/** A required structured reason code; the nullable variant already exists above. */
const reasonCodeField = (name: string) => ({
  name,
  check: (value: unknown) => typeof value === 'string' && /^[a-z][a-z0-9_]{1,62}$/.test(value),
});

/**
 * A SIGNED integer. `countField` rejects negatives, which is right for a count and wrong
 * for money: a ledger amount is signed by design, so reusing the count check would reject
 * every credit.
 */
const integerField = (name: string) => ({
  name,
  check: (value: unknown) => typeof value === 'number' && Number.isInteger(value),
});

/**
 * WP-12 and WP-13 vocabularies, DERIVED from the frozen enum exports rather than retyped.
 * A retyped copy is how `spo2` survived a rename once already.
 */
const EMERGENCY_EVENT_STATUSES = new Set<string>(EMERGENCY_EVENT_STATUS_VALUES);
const TRIAGE_PRIORITIES = new Set<string>(TRIAGE_PRIORITY_VALUES);
const EMERGENCY_UNIT_STATUSES = new Set<string>(EMERGENCY_UNIT_STATUS_VALUES);
const EMERGENCY_RESOLUTION_TYPES = new Set<string>(EMERGENCY_RESOLUTION_TYPE_VALUES);
const LEDGER_ENTRY_KINDS = new Set<string>(LEDGER_ENTRY_KIND_VALUES);
const PAYOUT_RUN_STATUSES = new Set<string>(PAYOUT_RUN_STATUS_VALUES);
const SUPPORT_TICKET_STATUSES = new Set<string>(SUPPORT_TICKET_STATUS_VALUES);
const EXPORT_JOB_STATUSES = new Set<string>(EXPORT_JOB_STATUS_VALUES);

const CONTRACTS = new Map<string, PayloadContract>([
  [BROADCAST_DISPATCH_REQUESTED_EVENT_TYPE, {
    version: BROADCAST_DISPATCH_REQUESTED_EVENT_VERSION,
    fields: [uuidField('broadcast_message_id')],
  }],
  [MEMBERSHIP_CHANGED_EVENT_TYPE, {
    version: MEMBERSHIP_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('membership_id'),
      uuidField('profile_id'),
      enumField('role', MEMBERSHIP_ROLES),
      enumField('status', MEMBERSHIP_STATUSES),
    ],
  }],
  [PROFILE_CHANGED_EVENT_TYPE, {
    version: PROFILE_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('profile_id'),
      enumField('status', PROFILE_STATUSES),
      booleanField('onboarding_completed'),
    ],
  }],
  [PROFILE_DETAIL_CHANGED_EVENT_TYPE, {
    version: PROFILE_DETAIL_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('profile_id'),
      enumField('detail_kind', PROFILE_DETAIL_KINDS),
      uuidField('detail_id'),
      enumField('change', PROFILE_DETAIL_CHANGES),
    ],
  }],
  [DOCTOR_DETAIL_CHANGED_EVENT_TYPE, {
    version: DOCTOR_DETAIL_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('membership_id'),
      uuidField('organization_id'),
      enumField('change', DOCTOR_DETAIL_CHANGES),
      booleanField('accepts_new_patients'),
    ],
  }],
  [VERIFICATION_DOCUMENT_CHANGED_EVENT_TYPE, {
    version: VERIFICATION_DOCUMENT_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('document_id'),
      uuidField('membership_id'),
      enumField('document_kind', VERIFICATION_DOCUMENT_KINDS),
      enumField('status', VERIFICATION_STATUSES),
    ],
  }],
  [AVAILABILITY_CHANGED_EVENT_TYPE, {
    version: AVAILABILITY_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('membership_id'),
      uuidField('organization_id'),
      enumField('change', AVAILABILITY_CHANGES),
      countField('slot_count'),
    ],
  }],
  [APPOINTMENT_CHANGED_EVENT_TYPE, {
    version: APPOINTMENT_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('appointment_id'),
      uuidField('patient_profile_id'),
      uuidField('doctor_membership_id'),
      // A booking has no prior status, so null is valid here but the key is not
      // optional; the reason code is null on every transition that needs none.
      nullableEnumField('previous_status', APPOINTMENT_STATUSES),
      enumField('status', APPOINTMENT_STATUSES),
      nullableReasonCodeField('reason_code'),
    ],
  }],
  [APPOINTMENT_PAYMENT_REQUESTED_EVENT_TYPE, {
    version: APPOINTMENT_PAYMENT_REQUESTED_EVENT_VERSION,
    fields: [uuidField('payment_id')],
  }],
  [CONSULTATION_CHANGED_EVENT_TYPE, {
    version: CONSULTATION_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('consultation_id'),
      uuidField('appointment_id'),
      nullableEnumField('previous_status', CONSULTATION_STATES),
      enumField('status', CONSULTATION_STATES),
    ],
  }],
  [MESSAGE_CREATED_EVENT_TYPE, {
    version: MESSAGE_CREATED_EVENT_VERSION,
    fields: [
      uuidField('conversation_id'), uuidField('message_id'), uuidField('sender_profile_id'),
      { name: 'sequence_no', check: (value: unknown) =>
        typeof value === 'number' && Number.isInteger(value) && value >= 1 },
      enumField('message_type', MESSAGE_TYPES),
    ],
  }],
  [RECEIPT_UPDATED_EVENT_TYPE, {
    version: RECEIPT_UPDATED_EVENT_VERSION,
    fields: [
      uuidField('conversation_id'), uuidField('profile_id'),
      { name: 'through_sequence_no', check: (value: unknown) =>
        typeof value === 'number' && Number.isInteger(value) && value >= 1 },
    ],
  }],
  [PRESCRIPTION_CHANGED_EVENT_TYPE, {
    version: PRESCRIPTION_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('prescription_id'), uuidField('patient_profile_id'),
      nullableEnumField('previous_status', PRESCRIPTION_STATES),
      enumField('status', PRESCRIPTION_STATES),
    ],
  }],
  [PRESCRIPTION_PDF_REQUESTED_EVENT_TYPE, {
    version: PRESCRIPTION_PDF_REQUESTED_EVENT_VERSION,
    fields: [uuidField('prescription_id')],
  }],
  [PHARMACY_PRESCRIPTION_INTAKE_EVENT_TYPE, {
    version: PHARMACY_PRESCRIPTION_INTAKE_EVENT_VERSION,
    fields: [uuidField('prescription_id')],
  }],
  [NOTIFICATION_PUSH_REQUESTED_EVENT_TYPE, {
    version: NOTIFICATION_PUSH_REQUESTED_EVENT_VERSION,
    fields: [uuidField('delivery_id')],
  }],
  [NOTIFICATION_EMAIL_REQUESTED_EVENT_TYPE, {
    version: NOTIFICATION_EMAIL_REQUESTED_EVENT_VERSION,
    fields: [uuidField('delivery_id')],
  }],
  [AI_GENERATION_REQUESTED_EVENT_TYPE, {
    version: AI_GENERATION_REQUESTED_EVENT_VERSION,
    fields: [uuidField('generation_id')],
  }],
  [PHARMACY_ORDER_CHANGED_EVENT_TYPE, {
    version: PHARMACY_ORDER_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('pharmacy_order_id'),
      nullableEnumField('previous_status', PHARMACY_ORDER_STATES),
      enumField('status', PHARMACY_ORDER_STATES),
      nullableReasonCodeField('reason_code'),
    ],
  }],
  [DISPATCH_ASSIGNMENT_CHANGED_EVENT_TYPE, {
    version: DISPATCH_ASSIGNMENT_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('assignment_id'),
      uuidField('dispatch_job_id'),
      nullableEnumField('previous_status', DISPATCH_ASSIGNMENT_STATES),
      enumField('status', DISPATCH_ASSIGNMENT_STATES),
    ],
  }],
  [DISPATCH_OFFER_EXPIRED_EVENT_TYPE, {
    version: DISPATCH_OFFER_EXPIRED_EVENT_VERSION,
    fields: [uuidField('offer_id'), uuidField('dispatch_job_id')],
  }],
  // WP-12 and WP-13. An event type the worker does not know stays unprocessed FOREVER,
  // which real execution exposed as a growing backlog rather than any visible failure —
  // the appointments suite caught it only because it asserts an empty outbox.
  [EMERGENCY_EVENT_CHANGED_EVENT_TYPE, {
    version: EMERGENCY_EVENT_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('emergency_event_id'),
      enumField('status', EMERGENCY_EVENT_STATUSES),
      enumField('triage_priority', TRIAGE_PRIORITIES),
      uuidField('organization_id'),
    ],
  }],
  [EMERGENCY_DISPATCH_CHANGED_EVENT_TYPE, {
    version: EMERGENCY_DISPATCH_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('emergency_dispatch_id'),
      uuidField('emergency_event_id'),
      uuidField('emergency_unit_id'),
      enumField('status', EMERGENCY_UNIT_STATUSES),
    ],
  }],
  [EMERGENCY_RESOLVED_EVENT_TYPE, {
    version: EMERGENCY_RESOLVED_EVENT_VERSION,
    fields: [
      uuidField('emergency_event_id'),
      enumField('resolution_type', EMERGENCY_RESOLUTION_TYPES),
      integerField('response_duration_seconds'),
    ],
  }],
  [BREAK_GLASS_ACTIVATED_EVENT_TYPE, {
    version: BREAK_GLASS_ACTIVATED_EVENT_VERSION,
    fields: [
      uuidField('break_glass_grant_id'),
      uuidField('actor_membership_id'),
      uuidField('patient_profile_id'),
      uuidField('emergency_event_id'),
      reasonCodeField('reason_code'),
      timestampField('expires_at'),
    ],
  }],
  [BREAK_GLASS_TERMINATED_EVENT_TYPE, {
    version: BREAK_GLASS_TERMINATED_EVENT_VERSION,
    fields: [
      uuidField('break_glass_grant_id'),
      reasonCodeField('termination_reason_code'),
      integerField('accessed_resource_count'),
    ],
  }],
  [LEDGER_ENTRY_POSTED_EVENT_TYPE, {
    version: LEDGER_ENTRY_POSTED_EVENT_VERSION,
    fields: [
      uuidField('ledger_entry_id'),
      enumField('kind', LEDGER_ENTRY_KINDS),
      integerField('amount_sen'),
    ],
  }],
  [PAYOUT_RUN_CHANGED_EVENT_TYPE, {
    version: PAYOUT_RUN_CHANGED_EVENT_VERSION,
    fields: [uuidField('payout_run_id'), enumField('status', PAYOUT_RUN_STATUSES)],
  }],
  [SUPPORT_TICKET_CHANGED_EVENT_TYPE, {
    version: SUPPORT_TICKET_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('support_ticket_id'),
      enumField('status', SUPPORT_TICKET_STATUSES),
    ],
  }],
  [EXPORT_JOB_CHANGED_EVENT_TYPE, {
    version: EXPORT_JOB_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('export_job_id'),
      enumField('status', EXPORT_JOB_STATUSES),
      reasonCodeField('dataset_code'),
    ],
  }],
  [AI_ARTIFACT_CHANGED_EVENT_TYPE, {
    version: AI_ARTIFACT_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('artifact_id'),
      uuidField('patient_profile_id'),
      enumField('artifact_type', AI_ARTIFACT_TYPES),
      nullableEnumField('previous_review_status', AI_REVIEW_STATUSES),
      enumField('review_status', AI_REVIEW_STATUSES),
    ],
  }],
  [DEVICE_CHANGED_EVENT_TYPE, {
    version: DEVICE_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('device_id'),
      uuidField('organization_id'),
      enumField('device_type', DEVICE_TYPES),
      enumField('state', DEVICE_STATES),
    ],
  }],
  [VITAL_READING_CHANGED_EVENT_TYPE, {
    version: VITAL_READING_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('reading_id'),
      uuidField('device_id'),
      uuidField('patient_profile_id'),
      enumField('metric', VITAL_METRICS),
      enumField('quality', VITAL_READING_QUALITIES),
      // The measured value is absent by design, so `recorded_at` is the only way
      // a subscriber can order or window what it refetches.
      timestampField('recorded_at'),
    ],
  }],
  [CONSENT_CHANGED_EVENT_TYPE, {
    version: CONSENT_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('consent_id'),
      uuidField('grantor_profile_id'),
      enumField('scope', CONSENT_SCOPES),
      enumField('status', CONSENT_STATUSES),
    ],
  }],
  [CARE_ASSIGNMENT_CHANGED_EVENT_TYPE, {
    version: CARE_ASSIGNMENT_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('assignment_id'),
      uuidField('patient_profile_id'),
      uuidField('clinician_membership_id'),
      enumField('status', CARE_ASSIGNMENT_STATUSES),
    ],
  }],
  [DOCTOR_REVIEW_CHANGED_EVENT_TYPE, {
    version: DOCTOR_REVIEW_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('review_id'),
      uuidField('doctor_membership_id'),
      { name: 'rating', check: (value: unknown) =>
        typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 },
      enumField('change', DOCTOR_REVIEW_CHANGES),
    ],
  }],
  [FILE_SCAN_REQUESTED_EVENT_TYPE, {
    version: FILE_SCAN_REQUESTED_EVENT_VERSION,
    fields: [uuidField('object_id')],
  }],
  [FILE_SCAN_COMPLETED_EVENT_TYPE, {
    version: FILE_SCAN_COMPLETED_EVENT_VERSION,
    fields: [
      uuidField('object_id'),
      enumField('scan_state', FILE_SCAN_STATES),
      booleanField('downloadable'),
    ],
  }],
  [HEALTH_ALERT_CHANGED_EVENT_TYPE, {
    version: HEALTH_ALERT_CHANGED_EVENT_VERSION,
    fields: [
      uuidField('alert_id'),
      uuidField('patient_profile_id'),
      enumField('metric', VITAL_METRICS),
      enumField('severity', HEALTH_ALERT_SEVERITIES),
      enumField('state', HEALTH_ALERT_STATES),
    ],
  }],
]);

/**
 * Dispatches claimed outbox events.
 *
 * Returning `false` means no handler accepted the event, which the runtime treats
 * as a retryable failure that ends in the dead-letter table. Every event type the
 * application writes must therefore appear here, including events whose only
 * effect today is internal — otherwise a correct write silently dead-letters.
 *
 * There is no external fan-out yet, so a contract-valid event is acknowledged
 * without a side effect. Validating regardless prevents a malformed payload from
 * being marked processed and concealing a producer bug. Acknowledgement is
 * naturally idempotent; a future consumer must dedupe on `event_id`.
 *
 * Outbox event audit (39 declared event types + 1 inline probe):
 *
 * A. Side-effect dispatch (9): file.object.scan-requested, appointment.payment-
 *    requested, prescription.pdf-requested, notification.push-requested,
 *    notification.email-requested, ai.generation-requested,
 *    content.broadcast-dispatch-requested, conversation.message-created,
 *    conversation.receipt-updated. These call a dedicated handler or publish to
 *    Redis pub/sub in process().
 * B. Contract-only (30): every other CONTRACTS entry. Validated against the
 *    payload contract and acknowledged (`return true`) with no external side
 *    effect. These record domain state changes for audit/replay without
 *    requiring downstream fan-out today: appointment.changed, consultation.
 *    changed, prescription.changed, pharmacy.prescription-intake, pharmacy.
 *    order-changed, consent.changed, care_assignment.changed, dispatch.
 *    assignment-changed, dispatch.offer-expired, doctor_review.changed,
 *    emergency.event.changed, emergency.dispatch.changed, emergency.event.
 *    resolved, security.break_glass.activated, security.break_glass.terminated,
 *    finance.ledger_entry.posted, finance.payout_run.changed, support.ticket.
 *    changed, admin.export_job.changed, device.changed, vital_reading.changed,
 *    health_alert.changed, profile_detail.changed, doctor_detail.changed,
 *    profile.changed, membership.changed, availability.changed, verification.
 *    document.changed, ai.artifact-changed, file.object.scan-completed.
 *    A future consumer can subscribe to these without changing the producer.
 * C. Dead (0): no declared event type lacks both a producer and a purpose.
 * D. Missing producer (0): every declared constant is written by a repository.
 * E. Missing handler (0): every declared constant has a CONTRACTS entry.
 *
 * `foundation.probe.v1` (1) is handled inline without a CONTRACTS entry; it is
 * a health-check probe, not a domain event.
 */
@Injectable()
export class OutboxProcessor {
  readonly #logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly fileScans?: PrivateFileScanHandler,
    private readonly appointmentPayments?: AppointmentPaymentHandler,
    private readonly prescriptionPdfs?: PrescriptionPdfHandler,
    private readonly notificationPush?: NotificationPushHandler,
    private readonly notificationEmail?: NotificationEmailHandler,
    private readonly aiGenerations?: AiGenerationHandler,
    private readonly broadcasts?: Stage11Repository,
    private readonly chatPublisher?: ChatEventPublisher,
  ) {}

  async process(event: ClaimedOutboxEvent): Promise<boolean> {
    if (event.eventType === 'foundation.probe.v1' && event.eventVersion === 1) {
      return true;
    }
    const contract = CONTRACTS.get(event.eventType);
    if (contract === undefined) {
      this.#logger.error(formatSafeLog({
        event: 'outbox.handler_missing',
        event_id: event.eventId,
        event_type: event.eventType,
      }));
      return false;
    }
    if (contract.version !== event.eventVersion) {
      this.#logger.error(formatSafeLog({
        event: 'outbox.event_version_unsupported',
        event_id: event.eventId,
        event_type: event.eventType,
        event_version: event.eventVersion,
      }));
      return false;
    }
    if (!this.payloadMatches(contract, event.payload)) {
      this.#logger.error(formatSafeLog({
        event: 'outbox.payload_contract_violation',
        event_id: event.eventId,
        event_type: event.eventType,
      }));
      return false;
    }
    if (event.eventType === FILE_SCAN_COMPLETED_EVENT_TYPE) {
      const state = event.payload['scan_state'];
      const downloadable = event.payload['downloadable'];
      if ((state === 'clean') !== (downloadable === true)) {
        this.#logger.error(formatSafeLog({
          event: 'outbox.payload_contract_violation',
          event_id: event.eventId,
          event_type: event.eventType,
        }));
        return false;
      }
    }
    if (event.eventType === FILE_SCAN_REQUESTED_EVENT_TYPE) {
      const objectId = event.payload['object_id'];
      return typeof objectId === 'string' && this.fileScans !== undefined
        ? this.fileScans.handle(objectId)
        : false;
    }
    if (event.eventType === APPOINTMENT_PAYMENT_REQUESTED_EVENT_TYPE) {
      const paymentId = event.payload['payment_id'];
      return typeof paymentId === 'string' && this.appointmentPayments !== undefined
        ? this.appointmentPayments.handle(paymentId)
        : false;
    }
    if (event.eventType === PRESCRIPTION_PDF_REQUESTED_EVENT_TYPE) {
      const prescriptionId = event.payload['prescription_id'];
      return typeof prescriptionId === 'string' && this.prescriptionPdfs !== undefined
        ? this.prescriptionPdfs.handle(prescriptionId)
        : false;
    }
    if (event.eventType === NOTIFICATION_PUSH_REQUESTED_EVENT_TYPE) {
      const deliveryId = event.payload['delivery_id'];
      return typeof deliveryId === 'string' && this.notificationPush !== undefined
        ? this.notificationPush.handle(deliveryId)
        : false;
    }
    if (event.eventType === NOTIFICATION_EMAIL_REQUESTED_EVENT_TYPE) {
      const deliveryId = event.payload['delivery_id'];
      return typeof deliveryId === 'string' && this.notificationEmail !== undefined
        ? this.notificationEmail.handle(deliveryId)
        : false;
    }
    if (event.eventType === AI_GENERATION_REQUESTED_EVENT_TYPE) {
      const generationId = event.payload['generation_id'];
      return typeof generationId === 'string' && this.aiGenerations !== undefined
        ? this.aiGenerations.handle(generationId)
        : false;
    }
    if (event.eventType === BROADCAST_DISPATCH_REQUESTED_EVENT_TYPE) {
      const broadcastMessageId = event.payload['broadcast_message_id'];
      return typeof broadcastMessageId === 'string' && this.broadcasts !== undefined
        ? this.broadcasts.dispatchBroadcast(
            broadcastMessageId, event.correlationId ?? event.eventId, new Date(),
          )
        : false;
    }
    // Chat fan-out: a contract-valid message-created or receipt-updated event is
    // acknowledged (the outbox row completes) AND published to the Redis pub/sub
    // channel the API's WebSocket chat gateway subscribes to. The publish is a
    // best-effort side effect — a Redis outage degrades to no real-time push but
    // does not block outbox progression; clients refetch under policy for missed
    // events. The payload is the minimum-necessary projection: no message text,
    // which is clinical data an event stream fans out more widely than an
    // authorized read. This mirrors the AsyncAPI `messageCreated`/`receiptUpdated`
    // x-room `conversation:{conversation_id}` design.
    if (event.eventType === MESSAGE_CREATED_EVENT_TYPE && this.chatPublisher !== undefined) {
      await this.chatPublisher.publishMessageCreated({
        conversation_id: event.payload['conversation_id'] as string,
        message_id: event.payload['message_id'] as string,
        sender_profile_id: event.payload['sender_profile_id'] as string,
        sequence_no: event.payload['sequence_no'] as number,
        message_type: event.payload['message_type'] as 'text' | 'file' | 'system',
      });
    }
    if (event.eventType === RECEIPT_UPDATED_EVENT_TYPE && this.chatPublisher !== undefined) {
      await this.chatPublisher.publishReceiptUpdated({
        conversation_id: event.payload['conversation_id'] as string,
        profile_id: event.payload['profile_id'] as string,
        through_sequence_no: event.payload['through_sequence_no'] as number,
      });
    }
    return true;
  }

  private payloadMatches(contract: PayloadContract, payload: unknown): boolean {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const record = payload as Record<string, unknown>;
    if (Object.keys(record).length !== contract.fields.length) return false;
    return contract.fields.every((field) => field.check(record[field.name]));
  }
}
