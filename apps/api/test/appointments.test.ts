import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  APPOINTMENT_PAYMENT_REQUESTED_EVENT_TYPE,
  APPOINTMENT_CHANGED_EVENT_TYPE,
  appointmentTransitionAllowed,
  type AppointmentPaymentWorkItem,
  type AppointmentRecord,
} from '../packages/database/src/appointments.js';
import {
  bookAppointmentSchema,
  rescheduleAppointmentSchema,
  updateAppointmentStatusSchema,
} from '../apps/api/src/appointments/appointment-request.schemas.js';
import {
  AppointmentPaymentHandler,
  DeterministicAppointmentPaymentProvider,
} from '../apps/worker/src/appointment-payment.handler.js';
import { OutboxProcessor } from '../apps/worker/src/outbox.processor.js';
import { evaluatePermission } from '../packages/policy/src/permission-policy.js';

const appointmentId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d30';
const patientId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d31';
const doctorId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d32';
const paymentId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d33';
const start = new Date('2026-07-30T02:00:00.000Z');
const end = new Date('2026-07-30T02:30:00.000Z');

test('appointment commands expose canonical audio/check-in/start vocabulary and reject client prices', () => {
  assert.equal(bookAppointmentSchema.safeParse({ slot_id: appointmentId, mode: 'audio' }).success, true);
  assert.equal(bookAppointmentSchema.safeParse({
    slot_id: appointmentId, mode: 'video', fee_sen: 1,
  }).success, false);
  assert.equal(updateAppointmentStatusSchema.safeParse({
    status: 'checked_in', expected_version: 1,
  }).success, true);
  assert.equal(updateAppointmentStatusSchema.safeParse({
    status: 'in_progress', expected_version: 2,
  }).success, true);
  assert.equal(updateAppointmentStatusSchema.safeParse({
    status: 'completed', expected_version: 3, reason_code: 'done',
  }).success, false);
  assert.equal(rescheduleAppointmentSchema.safeParse({
    slot_id: paymentId, mode: 'audio', expected_version: 1,
  }).success, true);
});

test('canonical lifecycle is role-specific and time-aware', () => {
  const confirmed = record('confirmed');
  assert.equal(appointmentTransitionAllowed(
    confirmed, 'checked_in', 'patient', new Date(start.getTime() - 60_000),
  ), true);
  assert.equal(appointmentTransitionAllowed(
    confirmed, 'in_progress', 'doctor', start,
  ), false);
  assert.equal(appointmentTransitionAllowed(
    { ...confirmed, status: 'checked_in' }, 'in_progress', 'doctor', start,
  ), true);
  // Starting and completing carry NO time window. An earlier version required
  // `now >= starts_at`, which is absent from the enum-state catalogue and blocked a
  // real workflow: the patient has checked in and the doctor is free, so the
  // consultation begins a few minutes early. Real end-to-end verification failed on
  // exactly that case, since its fixtures book future slots.
  const early = new Date(start.getTime() - 300_000);
  assert.equal(appointmentTransitionAllowed(
    { ...confirmed, status: 'checked_in' }, 'in_progress', 'doctor', early,
  ), true);
  assert.equal(appointmentTransitionAllowed(
    { ...confirmed, status: 'in_progress' }, 'completed', 'doctor', early,
  ), true);
  // State and role still gate it: a doctor cannot start an appointment nobody
  // checked into, and a patient cannot start one at all.
  assert.equal(appointmentTransitionAllowed(
    { ...confirmed, status: 'checked_in' }, 'in_progress', 'patient', early,
  ), false);
  assert.equal(appointmentTransitionAllowed(
    { ...confirmed, status: 'in_progress' }, 'completed', 'doctor', start,
  ), true);
  assert.equal(appointmentTransitionAllowed(
    confirmed, 'no_show', 'doctor', new Date(start.getTime() - 1),
  ), false);
  assert.equal(appointmentTransitionAllowed(confirmed, 'no_show', 'doctor', start), true);
  assert.equal(appointmentTransitionAllowed(confirmed, 'cancelled', 'patient', start), false);
  assert.equal(appointmentTransitionAllowed(
    confirmed, 'cancelled', 'doctor', new Date(start.getTime() - 1),
  ), true);
});

test('appointment permissions preserve own, assigned, organization, and explicit global scopes', () => {
  assert.equal(evaluatePermission(
    ['appointment:check_in:own'], 'appointment:check_in:own',
    { actorProfileId: patientId, ownerProfileId: patientId },
  ).allowed, true);
  assert.equal(evaluatePermission(
    ['appointment:start:assigned'], 'appointment:start:assigned',
    { actorProfileId: doctorId, assigned: false },
  ).allowed, false);
  assert.equal(evaluatePermission(
    ['appointment:read:organization'], 'appointment:read:organization',
    { actorProfileId: doctorId, membershipOrganizationId: appointmentId,
      resourceOrganizationId: paymentId },
  ).allowed, false);
  assert.equal(evaluatePermission(
    ['appointment:read:global'], 'appointment:read:global',
    { actorProfileId: doctorId, globalAllowed: false },
  ).allowed, false);
  assert.equal(evaluatePermission(
    ['appointment:read:global'], 'appointment:read:global',
    { actorProfileId: doctorId, globalAllowed: true },
  ).allowed, true);
});

test('forward migrations separate enum commits and add patient/permission hardening', () => {
  const vocabulary = readFileSync(
    new URL('../packages/database/drizzle/0018_appointment_canonical_vocabulary.sql', import.meta.url),
    'utf8',
  );
  const hardening = readFileSync(
    new URL('../packages/database/drizzle/0019_appointment_lifecycle_hardening.sql', import.meta.url),
    'utf8',
  );
  const connection = readFileSync(
    new URL('../packages/database/src/connection.ts', import.meta.url),
    'utf8',
  );
  const repository = readFileSync(
    new URL('../packages/database/src/appointment-repository.ts', import.meta.url),
    'utf8',
  );
  assert.match(vocabulary, /ADD VALUE IF NOT EXISTS 'audio'/);
  assert.match(vocabulary, /ADD VALUE IF NOT EXISTS 'checked_in'/);
  assert.match(vocabulary, /ADD VALUE IF NOT EXISTS 'in_progress'/);
  assert.doesNotMatch(vocabulary, /CREATE INDEX|INSERT INTO permissions/);
  assert.match(hardening, /appointments_patient_live_slot_idx/);
  assert.match(hardening, /appointment_slots_organization_window_idx/);
  assert.match(hardening, /appointments_created_idx/);
  assert.match(hardening, /appointment:cancel:assigned/);
  assert.match(hardening, /appointment:read:global/);
  assert.match(hardening, /'pending_payment','confirmed','checked_in','in_progress'/);
  assert.match(connection, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  // Behaviour, not an exact expression: both contention SQLSTATEs are retried, and
  // exhausting the retries raises a distinguishable error so the API can answer a
  // stable retryable conflict instead of a 500.
  assert.match(connection, /40001/);
  assert.match(connection, /40P01/);
  assert.match(connection, /SerializationConflictError/);
  assert.equal(repository.match(/serializableTransaction/g)?.length, 2);
});

test('deterministic payment handler settles pending work and treats terminal delivery as idempotent', async () => {
  const work: AppointmentPaymentWorkItem = {
    paymentId,
    appointmentId,
    amountSen: 5000,
    currency: 'MYR',
    state: 'pending',
  };
  const settlements: unknown[] = [];
  const repository = {
    loadPaymentWorkItem: async () => work,
    settlePayment: async (input: unknown) => { settlements.push(input); return 'settled' as const; },
  };
  const handler = new AppointmentPaymentHandler(
    repository as never,
    new DeterministicAppointmentPaymentProvider(),
  );
  assert.equal(await handler.handle(paymentId), true);
  assert.equal((settlements[0] as { outcome: string }).outcome, 'captured');

  const terminal = new AppointmentPaymentHandler({
    loadPaymentWorkItem: async () => ({ ...work, state: 'captured' as const }),
    settlePayment: async () => { throw new Error('terminal event must not settle twice'); },
  } as never, new DeterministicAppointmentPaymentProvider());
  assert.equal(await terminal.handle(paymentId), true);
});

test('worker validates payment requests and canonical appointment states exactly', async () => {
  const handled: string[] = [];
  const processor = new OutboxProcessor(undefined, {
    handle: async (id: string) => { handled.push(id); return true; },
  } as AppointmentPaymentHandler);
  assert.equal(await processor.process({
    eventId: paymentId,
    eventType: APPOINTMENT_PAYMENT_REQUESTED_EVENT_TYPE,
    eventVersion: 1,
    attempts: 1,
    payload: { payment_id: paymentId },
  }), true);
  assert.deepEqual(handled, [paymentId]);
  assert.equal(await processor.process({
    eventId: paymentId,
    eventType: APPOINTMENT_PAYMENT_REQUESTED_EVENT_TYPE,
    eventVersion: 1,
    attempts: 1,
    payload: { payment_id: paymentId, amount_sen: 5000 },
  }), false);
  assert.equal(await processor.process({
    eventId: appointmentId,
    eventType: APPOINTMENT_CHANGED_EVENT_TYPE,
    eventVersion: 1,
    attempts: 1,
    payload: {
      appointment_id: appointmentId,
      patient_profile_id: patientId,
      doctor_membership_id: doctorId,
      previous_status: 'checked_in',
      status: 'in_progress',
      reason_code: null,
    },
  }), true);
});

function record(status: AppointmentRecord['status']): AppointmentRecord {
  return {
    appointmentId,
    slotId: paymentId,
    patientProfileId: patientId,
    doctorMembershipId: doctorId,
    organizationId: appointmentId,
    mode: 'audio',
    status,
    feeSen: 5000,
    currency: 'MYR',
    cancellationReasonCode: null,
    replacedByAppointmentId: null,
    startsAt: start,
    endsAt: end,
    paymentState: 'captured',
    version: 1,
    createdAt: new Date('2026-07-29T00:00:00.000Z'),
    updatedAt: new Date('2026-07-29T00:00:00.000Z'),
  };
}
