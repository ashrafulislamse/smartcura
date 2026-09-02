import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizationMemberships, profiles } from './schema.js';

/**
 * WP-05: doctor availability, generated slots, holds, booking, simulated
 * payment, cancellation and reschedule-as-replacement.
 *
 * These tables live in their own module because `schema.ts` is under concurrent
 * edit; `schema.ts` re-exports this module (see HANDOFF-0013.md). Column
 * definitions here mirror `drizzle/0013_availability_and_appointments.sql`
 * exactly, with two deliberate exceptions drizzle cannot express, both of which
 * exist only in the migration:
 *   * the `appointment_slots_no_overlapping_booking` EXCLUDE constraint, and
 *   * the append-only and slot-release-guard triggers.
 * Those are the load-bearing halves of the no-double-booking invariant, so they
 * are documented here to keep the omission visible rather than silent.
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const appointmentSlotState = pgEnum('appointment_slot_state', [
  'open', 'held', 'booked', 'closed',
]);
export const appointmentMode = pgEnum('appointment_mode', [
  'video', 'audio', 'chat', 'in_person',
]);
export const appointmentStatus = pgEnum('appointment_status', [
  'pending_payment', 'confirmed', 'checked_in', 'in_progress',
  'cancelled', 'completed', 'no_show', 'rescheduled',
]);
export const appointmentPaymentProvider = pgEnum('appointment_payment_provider', [
  'simulated',
]);
export const appointmentPaymentState = pgEnum('appointment_payment_state', [
  'pending', 'captured', 'refunded', 'failed',
]);

/**
 * Recurring weekly availability for a doctor MEMBERSHIP, not a profile: a
 * working pattern belongs to the organization it is worked in. Rules are
 * declarative input to slot generation and hold no booking state.
 */
export const availabilityRules = pgTable('availability_rules', {
  ruleId: uuid('rule_id').primaryKey(),
  membershipId: uuid('membership_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  weekday: smallint('weekday').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  slotDurationMinutes: smallint('slot_duration_minutes').notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kuala_Lumpur'),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({
    name: 'availability_rules_membership_org_fk',
    columns: [table.membershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  uniqueIndex('availability_rules_membership_slot_uq')
    .on(table.membershipId, table.weekday, table.startTime, table.effectiveFrom)
    .where(sql`is_active`),
  index('availability_rules_membership_active_idx').on(
    table.membershipId, table.isActive, table.weekday,
  ),
  check('availability_rules_version_check', sql`${table.version} >= 0`),
  check('availability_rules_weekday_check', sql`${table.weekday} >= 0 AND ${table.weekday} <= 6`),
  check('availability_rules_window_check', sql`${table.endTime} > ${table.startTime}`),
  check('availability_rules_duration_check', sql`${table.slotDurationMinutes} >= 5 AND ${table.slotDurationMinutes} <= 240`),
  // The window must divide exactly into whole slots, otherwise generation must
  // choose between a short trailing slot and discarding time, and the two
  // choices produce different slot sets for one rule.
  check('availability_rules_window_divisible_check', sql`(EXTRACT(EPOCH FROM (${table.endTime} - ${table.startTime}))::integer % (${table.slotDurationMinutes} * 60)) = 0`),
  check('availability_rules_effective_order_check', sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`),
  check('availability_rules_timezone_check', sql`${table.timezone} ~ '^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+._-]+)*$'`),
]);

/**
 * Per-date override of the recurring pattern: either the day is unavailable, or
 * it is replaced by exactly one different window. Both facts live in one row so
 * a date cannot be closed and replaced at the same time.
 */
export const availabilityExceptions = pgTable('availability_exceptions', {
  exceptionId: uuid('exception_id').primaryKey(),
  membershipId: uuid('membership_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  exceptionDate: date('exception_date').notNull(),
  isUnavailable: boolean('is_unavailable').notNull().default(true),
  replacementStartTime: time('replacement_start_time'),
  replacementEndTime: time('replacement_end_time'),
  reasonCode: varchar('reason_code', { length: 64 }).notNull(),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({
    name: 'availability_exceptions_membership_org_fk',
    columns: [table.membershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  uniqueIndex('availability_exceptions_membership_date_uq').on(
    table.membershipId, table.exceptionDate,
  ),
  index('availability_exceptions_date_idx').on(table.exceptionDate),
  check('availability_exceptions_version_check', sql`${table.version} >= 0`),
  // Structured lowercase reason code, never operator free text: exception
  // reasons reach audit logs and patient-facing copy.
  check('availability_exceptions_reason_code_check', sql`${table.reasonCode} ~ '^[a-z][a-z0-9_]{1,62}$'`),
  check('availability_exceptions_replacement_check', sql`(${table.isUnavailable} = true AND ${table.replacementStartTime} IS NULL AND ${table.replacementEndTime} IS NULL) OR (${table.isUnavailable} = false AND ${table.replacementStartTime} IS NOT NULL AND ${table.replacementEndTime} IS NOT NULL AND ${table.replacementEndTime} > ${table.replacementStartTime})`),
]);

/**
 * A generated, bookable instant. Slots are materialised rather than computed per
 * request because a hold and a booking must attach to a row that can be locked,
 * versioned and constrained.
 *
 * `appointment_slots_live_start_uq` is what makes generation idempotent, and the
 * `appointment_slots_no_overlapping_booking` EXCLUDE constraint in the migration
 * is what makes overlapping bookings for one doctor impossible.
 */
export const appointmentSlots = pgTable('appointment_slots', {
  slotId: uuid('slot_id').primaryKey(),
  membershipId: uuid('membership_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  state: appointmentSlotState('state').notNull().default('open'),
  heldUntil: timestamp('held_until', { withTimezone: true }),
  heldByProfileId: uuid('held_by_profile_id').references(() => profiles.profileId),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({
    name: 'appointment_slots_membership_org_fk',
    columns: [table.membershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  uniqueIndex('appointment_slots_id_membership_org_uq').on(
    table.slotId, table.membershipId, table.organizationId,
  ),
  uniqueIndex('appointment_slots_live_start_uq')
    .on(table.membershipId, table.startsAt)
    .where(sql`state <> 'closed'`),
  index('appointment_slots_membership_window_idx').on(
    table.membershipId, table.startsAt, table.slotId,
  ),
  index('appointment_slots_organization_window_idx').on(
    table.organizationId, table.startsAt, table.slotId,
  ),
  index('appointment_slots_state_window_idx').on(table.state, table.startsAt),
  index('appointment_slots_hold_expiry_idx')
    .on(table.heldUntil)
    .where(sql`state = 'held'`),
  check('appointment_slots_version_check', sql`${table.version} >= 0`),
  check('appointment_slots_window_check', sql`${table.endsAt} > ${table.startsAt}`),
  check('appointment_slots_hold_check', sql`(${table.state} = 'held' AND ${table.heldUntil} IS NOT NULL AND ${table.heldByProfileId} IS NOT NULL) OR (${table.state} <> 'held' AND ${table.heldUntil} IS NULL AND ${table.heldByProfileId} IS NULL)`),
]);

/**
 * One appointment per slot, enforced by `appointments_slot_uq`.
 *
 * A reschedule never mutates the original's time: it cancels the original with
 * status `rescheduled`, links `replaced_by_appointment_id`, and books a separate
 * replacement row against a separate slot.
 */
export const appointments = pgTable('appointments', {
  appointmentId: uuid('appointment_id').primaryKey(),
  slotId: uuid('slot_id').notNull(),
  patientProfileId: uuid('patient_profile_id').notNull().references(() => profiles.profileId),
  doctorMembershipId: uuid('doctor_membership_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  mode: appointmentMode('mode').notNull(),
  status: appointmentStatus('status').notNull().default('pending_payment'),
  feeSen: bigint('fee_sen', { mode: 'number' }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('MYR'),
  cancellationReasonCode: varchar('cancellation_reason_code', { length: 64 }),
  replacedByAppointmentId: uuid('replaced_by_appointment_id'),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({
    name: 'appointments_doctor_membership_org_fk',
    columns: [table.doctorMembershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  // The appointment's slot, doctor and organization must agree. A plain slot
  // reference would allow booking another doctor's slot and recording it against
  // this doctor, which the overlap constraint could not see.
  foreignKey({
    name: 'appointments_slot_doctor_org_fk',
    columns: [table.slotId, table.doctorMembershipId, table.organizationId],
    foreignColumns: [
      appointmentSlots.slotId, appointmentSlots.membershipId, appointmentSlots.organizationId,
    ],
  }),
  foreignKey({
    name: 'appointments_replaced_by_appointment_id_appointments_appointment_id_fk',
    columns: [table.replacedByAppointmentId],
    foreignColumns: [table.appointmentId],
  }),
  // One slot, at most one appointment, for every writer, forever.
  uniqueIndex('appointments_slot_uq').on(table.slotId),
  uniqueIndex('appointments_review_participants_org_uq').on(
    table.appointmentId, table.doctorMembershipId,
    table.patientProfileId, table.organizationId,
  ),
  uniqueIndex('appointments_replacement_uq')
    .on(table.replacedByAppointmentId)
    .where(sql`replaced_by_appointment_id IS NOT NULL`),
  index('appointments_patient_created_idx').on(
    table.patientProfileId, table.createdAt, table.appointmentId,
  ),
  index('appointments_patient_live_slot_idx')
    .on(table.patientProfileId, table.slotId)
    .where(sql`status IN ('pending_payment','confirmed','checked_in','in_progress')`),
  index('appointments_doctor_created_idx').on(
    table.doctorMembershipId, table.createdAt, table.appointmentId,
  ),
  index('appointments_organization_created_idx').on(
    table.organizationId, table.createdAt, table.appointmentId,
  ),
  index('appointments_created_idx').on(table.createdAt, table.appointmentId),
  check('appointments_version_check', sql`${table.version} >= 0`),
  check('appointments_fee_check', sql`${table.feeSen} >= 0`),
  check('appointments_currency_check', sql`${table.currency} = 'MYR'`),
  check('appointments_cancellation_reason_check', sql`(${table.status} IN ('cancelled', 'no_show', 'rescheduled')) = (${table.cancellationReasonCode} IS NOT NULL)`),
  check('appointments_cancellation_reason_code_check', sql`${table.cancellationReasonCode} IS NULL OR ${table.cancellationReasonCode} ~ '^[a-z][a-z0-9_]{1,62}$'`),
  check('appointments_replacement_status_check', sql`(${table.status} = 'rescheduled') = (${table.replacedByAppointmentId} IS NOT NULL)`),
  check('appointments_replacement_self_check', sql`${table.replacedByAppointmentId} IS NULL OR ${table.replacedByAppointmentId} <> ${table.appointmentId}`),
]);

/**
 * Append-only transition log. The migration installs
 * `appointment_status_history_reject_mutation`, which rejects UPDATE and DELETE
 * following the `audit_logs_reject_mutation` precedent: cancellation reasons and
 * no-show findings are disputed by real people, so the sequence must be
 * immutable even to a privileged writer.
 */
export const appointmentStatusHistory = pgTable('appointment_status_history', {
  historyId: uuid('history_id').primaryKey(),
  appointmentId: uuid('appointment_id').notNull().references(() => appointments.appointmentId),
  previousStatus: appointmentStatus('previous_status'),
  status: appointmentStatus('status').notNull(),
  reasonCode: varchar('reason_code', { length: 64 }),
  actorProfileId: uuid('actor_profile_id').references(() => profiles.profileId),
  correlationId: uuid('correlation_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [
  index('appointment_status_history_appointment_idx').on(
    table.appointmentId, table.occurredAt, table.historyId,
  ),
  check('appointment_status_history_reason_code_check', sql`${table.reasonCode} IS NULL OR ${table.reasonCode} ~ '^[a-z][a-z0-9_]{1,62}$'`),
  check('appointment_status_history_progress_check', sql`${table.previousStatus} IS NULL OR ${table.previousStatus} <> ${table.status}`),
]);

/**
 * Simulated payment only. No card data, no provider token, no external call: the
 * provider enum has exactly one value so a real provider cannot be recorded here
 * before its integration is designed and reviewed.
 */
export const appointmentPayments = pgTable('appointment_payments', {
  paymentId: uuid('payment_id').primaryKey(),
  appointmentId: uuid('appointment_id').notNull().references(() => appointments.appointmentId),
  amountSen: bigint('amount_sen', { mode: 'number' }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('MYR'),
  provider: appointmentPaymentProvider('provider').notNull().default('simulated'),
  state: appointmentPaymentState('state').notNull().default('pending'),
  idempotencyReference: varchar('idempotency_reference', { length: 128 }).notNull(),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('appointment_payments_appointment_uq').on(table.appointmentId),
  uniqueIndex('appointment_payments_provider_reference_uq').on(
    table.provider, table.idempotencyReference,
  ),
  check('appointment_payments_version_check', sql`${table.version} >= 0`),
  // A payment row exists only for a positive amount; a zero-fee appointment has
  // no payment aggregate at all.
  check('appointment_payments_amount_check', sql`${table.amountSen} > 0`),
  check('appointment_payments_currency_check', sql`${table.currency} = 'MYR'`),
  check('appointment_payments_idempotency_reference_check', sql`${table.idempotencyReference} ~ '^[A-Za-z0-9._~-]{16,128}$'`),
]);
