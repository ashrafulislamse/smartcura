import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, index, integer, jsonb, numeric, pgEnum, pgTable,
  primaryKey, text, time, timestamp, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';
import { appointments } from './schema-appointments.js';
import { organizationMemberships, organizations, profiles, storedObjects } from './schema.js';

const id = (name: string) => uuid(name).notNull().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const consultationStatus = pgEnum('consultation_status', [
  'not_started', 'ready', 'in_progress', 'completed', 'cancelled',
]);
export const clinicalNoteStatus = pgEnum('clinical_note_status', [
  'draft', 'signed', 'superseded', 'discarded',
]);
export const prescriptionStatus = pgEnum('prescription_status', [
  'draft', 'signed', 'superseded', 'cancelled', 'expired', 'discarded',
]);
export const conversationStatus = pgEnum('conversation_status', ['active', 'closed']);
export const messageType = pgEnum('message_type', ['text', 'file', 'system']);
export const NOTIFICATION_CHANNELS = ['in_app', 'push', 'email'] as const;
export type NotificationChannel = typeof NOTIFICATION_CHANNELS[number];
export const notificationChannel = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const notificationDeliveryStatus = pgEnum('notification_delivery_status', [
  'queued', 'processing', 'delivered', 'failed', 'suppressed',
]);
export const notificationCategory = pgEnum('notification_category', [
  'account_security', 'appointments', 'consultations', 'messages', 'prescriptions',
  'vitals_alerts', 'ai_review', 'delivery', 'emergency', 'system',
]);
export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type NotificationPriority = typeof NOTIFICATION_PRIORITIES[number];
export const notificationPriority = pgEnum('notification_priority', NOTIFICATION_PRIORITIES);
export const generatedDocumentStatus = pgEnum('generated_document_status', [
  'pending', 'ready', 'failed',
]);

export const consultations = pgTable('consultations', {
  consultationId: id('consultation_id').primaryKey(),
  appointmentId: uuid('appointment_id').notNull().references(() => appointments.appointmentId),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  patientProfileId: uuid('patient_profile_id').notNull().references(() => profiles.profileId),
  doctorMembershipId: uuid('doctor_membership_id').notNull().references(() => organizationMemberships.membershipId),
  status: consultationStatus('status').notNull().default('not_started'),
  outcomeCode: varchar('outcome_code', { length: 64 }),
  version: integer('version').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('consultations_appointment_uq').on(table.appointmentId),
  index('consultations_patient_created_idx').on(table.patientProfileId, table.createdAt, table.consultationId),
  index('consultations_doctor_created_idx').on(table.doctorMembershipId, table.createdAt, table.consultationId),
  check('consultations_version_check', sql`${table.version} >= 0`),
]);

export const consultationStatusHistory = pgTable('consultation_status_history', {
  historyId: id('history_id').primaryKey(),
  consultationId: uuid('consultation_id').notNull().references(() => consultations.consultationId),
  previousStatus: consultationStatus('previous_status'),
  status: consultationStatus('status').notNull(),
  reasonCode: varchar('reason_code', { length: 64 }),
  actorProfileId: uuid('actor_profile_id').notNull().references(() => profiles.profileId),
  correlationId: uuid('correlation_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('consultation_history_consultation_idx').on(table.consultationId, table.occurredAt, table.historyId)]);

export const conversations = pgTable('conversations', {
  conversationId: id('conversation_id').primaryKey(),
  consultationId: uuid('consultation_id').notNull().references(() => consultations.consultationId),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  status: conversationStatus('status').notNull().default('active'),
  nextSequenceNo: bigint('next_sequence_no', { mode: 'number' }).notNull().default(1),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex('conversations_consultation_uq').on(table.consultationId)]);

export const conversationParticipants = pgTable('conversation_participants', {
  conversationId: uuid('conversation_id').notNull().references(() => conversations.conversationId),
  profileId: uuid('profile_id').notNull().references(() => profiles.profileId),
  membershipId: uuid('membership_id').references(() => organizationMemberships.membershipId),
  participantKind: varchar('participant_kind', { length: 16 }).notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  mutedAt: timestamp('muted_at', { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.conversationId, table.profileId] })]);

export const messages = pgTable('messages', {
  messageId: id('message_id').primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.conversationId),
  senderProfileId: uuid('sender_profile_id').notNull().references(() => profiles.profileId),
  sequenceNo: bigint('sequence_no', { mode: 'number' }).notNull(),
  clientCorrelationId: uuid('client_correlation_id').notNull(),
  messageType: messageType('message_type').notNull(),
  textContent: text('text_content'),
  fileObjectId: uuid('file_object_id').references(() => storedObjects.objectId),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('messages_conversation_sequence_uq').on(table.conversationId, table.sequenceNo),
  uniqueIndex('messages_sender_correlation_uq').on(table.conversationId, table.senderProfileId, table.clientCorrelationId),
  index('messages_conversation_cursor_idx').on(table.conversationId, table.sequenceNo, table.messageId),
]);

export const messageReceipts = pgTable('message_receipts', {
  messageId: uuid('message_id').notNull().references(() => messages.messageId),
  profileId: uuid('profile_id').notNull().references(() => profiles.profileId),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.messageId, table.profileId] })]);

export const clinicalNotes = pgTable('clinical_notes', {
  noteId: id('note_id').primaryKey(),
  consultationId: uuid('consultation_id').notNull().references(() => consultations.consultationId),
  authorMembershipId: uuid('author_membership_id').notNull().references(() => organizationMemberships.membershipId),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  versionNo: integer('version_no').notNull(),
  status: clinicalNoteStatus('status').notNull().default('draft'),
  content: jsonb('content').notNull().$type<Record<string, unknown>>(),
  replacesNoteId: uuid('replaces_note_id'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('clinical_notes_consultation_version_uq').on(table.consultationId, table.versionNo),
  uniqueIndex('clinical_notes_replacement_uq').on(table.replacesNoteId),
  index('clinical_notes_consultation_created_idx').on(table.consultationId, table.createdAt, table.noteId),
]);

export const prescriptions = pgTable('prescriptions', {
  prescriptionId: id('prescription_id').primaryKey(),
  consultationId: uuid('consultation_id').notNull().references(() => consultations.consultationId),
  patientProfileId: uuid('patient_profile_id').notNull().references(() => profiles.profileId),
  doctorMembershipId: uuid('doctor_membership_id').notNull().references(() => organizationMemberships.membershipId),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  status: prescriptionStatus('status').notNull().default('draft'),
  replacesPrescriptionId: uuid('replaces_prescription_id'),
  diagnosis: varchar('diagnosis', { length: 1000 }),
  cancellationReasonCode: varchar('cancellation_reason_code', { length: 64 }),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  documentObjectId: uuid('document_object_id').references(() => storedObjects.objectId, { onDelete: 'set null' }),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('prescriptions_replacement_uq').on(table.replacesPrescriptionId),
  index('prescriptions_patient_created_idx').on(table.patientProfileId, table.createdAt, table.prescriptionId),
  index('prescriptions_doctor_created_idx').on(table.doctorMembershipId, table.createdAt, table.prescriptionId),
]);

export const prescriptionItems = pgTable('prescription_items', {
  prescriptionItemId: id('prescription_item_id').primaryKey(),
  prescriptionId: uuid('prescription_id').notNull().references(() => prescriptions.prescriptionId),
  position: integer('position').notNull(),
  medicationReference: varchar('medication_reference', { length: 128 }),
  medicationText: varchar('medication_text', { length: 240 }),
  doseValue: numeric('dose_value', { precision: 12, scale: 4 }).notNull(),
  doseUnit: varchar('dose_unit', { length: 32 }).notNull(),
  routeCode: varchar('route_code', { length: 64 }).notNull(),
  frequencyCode: varchar('frequency_code', { length: 64 }),
  frequencyText: varchar('frequency_text', { length: 160 }),
  durationDays: integer('duration_days').notNull(),
  patientInstructions: text('patient_instructions'),
}, (table) => [uniqueIndex('prescription_items_position_uq').on(table.prescriptionId, table.position)]);

export const prescriptionStatusHistory = pgTable('prescription_status_history', {
  historyId: id('history_id').primaryKey(),
  prescriptionId: uuid('prescription_id').notNull().references(() => prescriptions.prescriptionId),
  previousStatus: prescriptionStatus('previous_status'),
  status: prescriptionStatus('status').notNull(),
  reasonCode: varchar('reason_code', { length: 64 }),
  actorProfileId: uuid('actor_profile_id').notNull().references(() => profiles.profileId),
  correlationId: uuid('correlation_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export const prescriptionDocuments = pgTable('prescription_documents', {
  prescriptionId: uuid('prescription_id').primaryKey().references(() => prescriptions.prescriptionId),
  status: generatedDocumentStatus('status').notNull().default('pending'),
  objectKey: varchar('object_key', { length: 512 }), sha256: varchar('sha256', { length: 64 }),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
  failureCode: varchar('failure_code', { length: 64 }), updatedAt: updatedAt(),
});

export const notifications = pgTable('notifications', {
  notificationId: id('notification_id').primaryKey(),
  profileId: uuid('profile_id').notNull().references(() => profiles.profileId),
  category: notificationCategory('category').notNull(),
  resourceType: varchar('resource_type', { length: 64 }).notNull(),
  resourceId: uuid('resource_id').notNull(),
  titleCode: varchar('title_code', { length: 64 }).notNull(),
  bodyCode: varchar('body_code', { length: 64 }).notNull(),
  priority: notificationPriority('priority').notNull().default('normal'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }), createdAt: createdAt(),
}, (table) => [
  index('notifications_profile_cursor_idx').on(table.profileId, table.createdAt, table.notificationId),
  index('notifications_profile_unread_idx').on(table.profileId, table.createdAt, table.notificationId),
]);

export const notificationPreferences = pgTable('notification_preferences', {
  profileId: uuid('profile_id').notNull().references(() => profiles.profileId),
  category: notificationCategory('category').notNull(),
  channel: notificationChannel('channel').notNull(), enabled: boolean('enabled').notNull().default(true),
  quietHoursStart: time('quiet_hours_start'), quietHoursEnd: time('quiet_hours_end'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kuala_Lumpur'), updatedAt: updatedAt(),
}, (table) => [primaryKey({ columns: [table.profileId, table.category, table.channel] })]);

export const pushDevices = pgTable('push_devices', {
  pushDeviceId: id('push_device_id').primaryKey(),
  profileId: uuid('profile_id').notNull().references(() => profiles.profileId),
  platform: varchar('platform', { length: 16 }).notNull(),
  tokenCiphertext: text('token_ciphertext').notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('push_devices_token_hash_uq').on(table.tokenHash),
  index('push_devices_profile_enabled_idx').on(table.profileId, table.enabled, table.pushDeviceId),
]);

export const notificationDeliveries = pgTable('notification_deliveries', {
  deliveryId: id('delivery_id').primaryKey(),
  notificationId: uuid('notification_id').notNull().references(() => notifications.notificationId),
  channel: notificationChannel('channel').notNull(),
  status: notificationDeliveryStatus('status').notNull().default('queued'),
  providerReference: varchar('provider_reference', { length: 128 }), attempts: integer('attempts').notNull().default(0),
  lastErrorCode: varchar('last_error_code', { length: 64 }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('notification_deliveries_notification_channel_uq').on(table.notificationId, table.channel),
  index('notification_deliveries_work_idx').on(table.status, table.updatedAt, table.deliveryId),
]);
