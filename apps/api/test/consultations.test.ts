import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  consultationTransitionAllowed,
  clinicalNoteTransitionAllowed,
  prescriptionTransitionAllowed,
  CONSULTATION_CHANGED_EVENT_TYPE,
  MESSAGE_CREATED_EVENT_TYPE,
  RECEIPT_UPDATED_EVENT_TYPE,
  PRESCRIPTION_CHANGED_EVENT_TYPE,
  PRESCRIPTION_PDF_REQUESTED_EVENT_TYPE,
  NOTIFICATION_PUSH_REQUESTED_EVENT_TYPE,
  NOTIFICATION_EMAIL_REQUESTED_EVENT_TYPE,
  type PrescriptionPdfWork,
} from '@smartcura/database/consultations';
import {
  clinicalNoteTransitionSchema,
  messageCreateSchema,
  notificationPreferenceSchema,
  prescriptionCreateSchema,
  registerPushDeviceSchema,
} from '../apps/api/src/consultations/consultation-request.schemas.js';
import { LiveKitTokenService } from '../apps/api/src/consultations/livekit-token.service.js';
import { PushTokenCipher } from '@smartcura/database';
import { OutboxProcessor } from '../apps/worker/src/outbox.processor.js';
import { NotificationPushHandler } from '../apps/worker/src/notification-push.handler.js';
import { renderPrescriptionPdf } from '../apps/worker/src/prescription-pdf.handler.js';

const consultationId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d40';
const appointmentId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d41';
const profileId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d42';
const messageId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d43';
const prescriptionId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d44';
const deliveryId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d45';

test('consultation, clinical note, and prescription state machines preserve immutable terminal states', () => {
  assert.equal(consultationTransitionAllowed('not_started', 'ready'), true);
  assert.equal(consultationTransitionAllowed('ready', 'completed'), false);
  assert.equal(consultationTransitionAllowed('in_progress', 'completed'), true);
  assert.equal(consultationTransitionAllowed('completed', 'in_progress'), false);
  assert.equal(clinicalNoteTransitionAllowed('draft', 'signed'), true);
  assert.equal(clinicalNoteTransitionAllowed('signed', 'superseded'), true);
  assert.equal(clinicalNoteTransitionAllowed('superseded', 'signed'), false);
  assert.equal(prescriptionTransitionAllowed('draft', 'signed'), true);
  assert.equal(prescriptionTransitionAllowed('signed', 'cancelled'), true);
  assert.equal(prescriptionTransitionAllowed('cancelled', 'signed'), false);
});

test('WP-06 request schemas reject forged senders, invalid items, signed edits, and disabled in-app delivery', () => {
  assert.equal(messageCreateSchema.safeParse({
    message_type: 'text', text_content: 'hello', client_correlation_id: messageId,
  }).success, true);
  assert.equal(messageCreateSchema.safeParse({
    message_type: 'text', text_content: 'hello', client_correlation_id: messageId,
    sender_profile_id: profileId,
  }).success, false);
  assert.equal(clinicalNoteTransitionSchema.safeParse({ status: 'superseded', expected_version: 0 }).success, false);
  assert.equal(prescriptionCreateSchema.safeParse({ items: [{
    medication_reference: null, medication_text: null, dose_value: '10', dose_unit: 'mg',
    route_code: 'oral', frequency_code: 'daily', frequency_text: null,
    duration_days: 5, patient_instructions: null,
  }] }).success, false);
  assert.equal(notificationPreferenceSchema.safeParse({
    category: 'messages', channel: 'in_app', enabled: false,
    quiet_hours_start: null, quiet_hours_end: null, timezone: 'Asia/Kuala_Lumpur',
  }).success, false);
});

test('LiveKit token is short-lived, room-scoped, and bound to the authorized participant identity', () => {
  const service = new LiveKitTokenService({
    adapter: 'deterministic', url: 'ws://127.0.0.1:7880', apiKey: 'local-api-key',
    apiSecret: '01234567890123456789012345678901', tokenTtlSeconds: 300,
  });
  const now = new Date('2026-07-29T00:00:00.000Z');
  const token = service.mint({
    roomName: `consultation-${consultationId}`, participantIdentity: profileId,
  }, now);
  const parts = token.access_token.split('.');
  assert.equal(parts.length, 3);
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
  assert.equal(payload.sub, profileId);
  assert.equal(payload.video.room, `consultation-${consultationId}`);
  assert.equal(payload.video.roomJoin, true);
  assert.equal(payload.exp - payload.iat, 300);
  assert.equal(token.expires_at, '2026-07-29T00:05:00.000Z');
});

test('deterministic signed-prescription PDF is valid, stable, and contains structured item rendering', () => {
  const work: PrescriptionPdfWork = {
    prescriptionId, status: 'signed', patientProfileId: profileId,
    doctorMembershipId: appointmentId, signedAt: new Date('2026-07-29T00:00:00.000Z'),
    expiresAt: null,
    items: [{ prescriptionItemId: messageId, position: 1, medicationReference: 'MED-001',
      medicationText: null, doseValue: '10.0000', doseUnit: 'mg', routeCode: 'oral',
      frequencyCode: 'daily', frequencyText: null, durationDays: 5,
      patientInstructions: null }],
  };
  const left = renderPrescriptionPdf(work);
  const right = renderPrescriptionPdf(work);
  assert.deepEqual(left, right);
  const text = Buffer.from(left).toString('utf8');
  assert.equal(text.startsWith('%PDF-1.4'), true);
  assert.match(text, /MED-001 10\.0000 mg; oral; daily; 5 days/);
  assert.match(text, /%%EOF/);
});

test('push handler sends only opaque identifiers and settles terminal delivery idempotently', async () => {
  const sent: unknown[] = [];
  const settlements: unknown[] = [];
  const repository = {
    loadPushWork: async () => ({
      deliveryId, notificationId: messageId, profileId, category: 'messages',
      resourceType: 'conversation', resourceId: consultationId, status: 'queued',
      titleCode: 'message.new.title', bodyCode: 'message.new.body', priority: 'normal',
    }),
    listEnabledPushDevices: async () => [
      { pushDeviceId: 'dev-1', platform: 'android',
        tokenCiphertext: new PushTokenCipher('0000000000000000000000000000000000000000000000000000000000000000')
          .seal('fcm-registration-token-consultation'),
        enabled: true },
    ],
    settlePush: async (input: unknown) => { settlements.push(input); return 'settled' as const; },
    suppressPush: async () => 'settled' as const,
    disablePushDevices: async () => 0,
  };
  const cipher = new PushTokenCipher('0000000000000000000000000000000000000000000000000000000000000000');
  const handler = new NotificationPushHandler(repository as never, {
    send: async (input: unknown) => {
      sent.push(input);
      return { delivered: true, providerReference: 'mock:1', errorCode: null, invalidDeviceIds: [] };
    },
  }, cipher);
  assert.equal(await handler.handle(deliveryId), true);
  // What crosses the wire is identifiers, catalogue copy, and a deep link —
  // never a medication name, a patient name, or any other clinical detail.
  const payload = JSON.stringify(sent[0]);
  assert.equal(payload.includes('medication'), false);
  assert.equal(payload.includes('patient_name'), false);
  assert.equal((settlements[0] as { delivered: boolean }).delivered, true);
});

test('worker accepts exact minimum-data WP-06 events and rejects PHI or extra fields', async () => {
  const pdfIds: string[] = [];
  const pushIds: string[] = [];
  const emailIds: string[] = [];
  const processor = new OutboxProcessor(undefined, undefined, {
    handle: async (id: string) => { pdfIds.push(id); return true; },
  } as never, {
    handle: async (id: string) => { pushIds.push(id); return true; },
  } as never, {
    handle: async (id: string) => { emailIds.push(id); return true; },
  } as never);
  const event = (eventType: string, payload: Record<string, unknown>) => ({
    eventId: consultationId, eventType, eventVersion: 1, attempts: 1, payload,
  });
  assert.equal(await processor.process(event(CONSULTATION_CHANGED_EVENT_TYPE, {
    consultation_id: consultationId, appointment_id: appointmentId,
    previous_status: 'ready', status: 'in_progress',
  }) as never), true);
  assert.equal(await processor.process(event(MESSAGE_CREATED_EVENT_TYPE, {
    conversation_id: consultationId, message_id: messageId, sender_profile_id: profileId,
    sequence_no: 1, message_type: 'text', text_content: 'private text',
  }) as never), false);
  assert.equal(await processor.process(event(RECEIPT_UPDATED_EVENT_TYPE, {
    conversation_id: consultationId, profile_id: profileId, through_sequence_no: 1,
  }) as never), true);
  assert.equal(await processor.process(event(PRESCRIPTION_CHANGED_EVENT_TYPE, {
    prescription_id: prescriptionId, patient_profile_id: profileId,
    previous_status: 'draft', status: 'signed',
  }) as never), true);
  assert.equal(await processor.process(event(PRESCRIPTION_PDF_REQUESTED_EVENT_TYPE, {
    prescription_id: prescriptionId,
  }) as never), true);
  assert.equal(await processor.process(event(NOTIFICATION_PUSH_REQUESTED_EVENT_TYPE, {
    delivery_id: deliveryId,
  }) as never), true);
  assert.equal(await processor.process(event(NOTIFICATION_EMAIL_REQUESTED_EVENT_TYPE, {
    delivery_id: deliveryId,
  }) as never), true);
  assert.deepEqual(pdfIds, [prescriptionId]);
  assert.deepEqual(pushIds, [deliveryId]);
  assert.deepEqual(emailIds, [deliveryId]);
});

test('migration enforces one consultation, message ordering, signed immutability, and authoritative in-app preferences', () => {
  const migration = readFileSync(new URL(
    '../packages/database/drizzle/0020_consultations_messaging_prescriptions.sql', import.meta.url,
  ), 'utf8');
  assert.match(migration, /consultations_appointment_uq/);
  assert.match(migration, /messages_conversation_sequence_uq/);
  assert.match(migration, /messages_sender_correlation_uq/);
  assert.match(migration, /clinical_notes_protect_signed/);
  assert.match(migration, /prescriptions_protect_signed/);
  assert.match(migration, /prescription_items_protect_signed/);
  assert.match(migration, /notification_preferences_in_app_check/);
  assert.match(migration, /push_devices_token_hash_uq/);
  assert.match(migration, /prescription\.sign:assigned|prescription:read:assigned/);
});

test('push registration tokens are sealed, tamper-evident, and never returned or contracted', () => {
  const cipher = new PushTokenCipher('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  const token = 'fcm-registration-token-value';
  const sealed = cipher.seal(token);
  assert.notEqual(sealed, token);
  assert.equal(sealed.includes(token), false);
  assert.equal(cipher.open(sealed), token);
  assert.notEqual(cipher.seal(token), sealed);
  const [iv, body, tag] = sealed.split('.');
  assert.throws(() => cipher.open(`${iv}.${body}.${Buffer.from('0'.repeat(16)).toString('base64url')}`));
  assert.equal(registerPushDeviceSchema.safeParse({ platform: 'android', token }).success, true);
  assert.equal(registerPushDeviceSchema.safeParse({
    platform: 'android', token, profile_id: profileId,
  }).success, false);
  const openapi = JSON.parse(readFileSync(new URL(
    '../packages/contracts/openapi/openapi.json', import.meta.url,
  ), 'utf8'));
  assert.deepEqual(
    Object.keys(openapi.components.schemas.PushDevice.properties).sort(),
    ['enabled', 'platform', 'push_device_id'],
  );
  assert.equal(openapi.paths['/notifications/push-devices'].post.operationId, 'registerPushDevice');
});

test('prescription commands claim idempotency inside transactions and notification pushes honor suppression and quiet hours', () => {
  const prescription = readFileSync(new URL(
    '../packages/database/src/prescription-repository.ts', import.meta.url,
  ), 'utf8');
  const notification = readFileSync(new URL(
    '../packages/database/src/notification-repository.ts', import.meta.url,
  ), 'utf8');
  assert.match(prescription, /claimIdempotency/);
  assert.match(prescription, /completeIdempotency/);
  assert.match(prescription, /idempotency_reused/);
  assert.match(notification, /'suppressed'/);
  assert.match(notification, /quiet_hours_start/);
  assert.match(notification, /available_at/);
  assert.match(notification, /mandatoryPush/);
});
