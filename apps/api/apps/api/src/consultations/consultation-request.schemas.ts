import { z } from 'zod';
import { NOTIFICATION_CATEGORIES } from '@smartcura/database/consultations';

const uuidV7 = z.string().uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const reasonCode = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const expectedVersion = z.number().int().min(0);
const content = z.record(z.string(), z.unknown()).refine(
  (value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 65_536,
  'Clinical note content exceeds 65536 bytes',
);

export const consultationTransitionSchema = z.object({
  status: z.enum(['ready', 'in_progress', 'completed', 'cancelled']),
  outcome_code: reasonCode.nullable().default(null),
  expected_version: expectedVersion,
}).strict();
export const clinicalNoteCreateSchema = z.object({ content }).strict();
export const clinicalNoteUpdateSchema = z.object({
  content, expected_version: expectedVersion,
}).strict();
export const clinicalNoteTransitionSchema = z.object({
  status: z.enum(['signed', 'discarded']), expected_version: expectedVersion,
}).strict();
export const clinicalNoteAmendSchema = z.object({
  content, expected_version: expectedVersion,
}).strict();
export const messageCreateSchema = z.discriminatedUnion('message_type', [
  z.object({
    message_type: z.literal('text'), text_content: z.string().trim().min(1).max(4000),
    client_correlation_id: uuidV7,
  }).strict(),
  z.object({
    message_type: z.literal('file'), file_object_id: uuidV7,
    client_correlation_id: uuidV7,
  }).strict(),
]);
export const collectionListSchema = z.object({
  cursor: z.string().min(1).max(1024).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export const messageListSchema = z.object({
  cursor: z.string().min(1).max(1024).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export const messageReadSchema = z.object({
  through_sequence_no: z.number().int().min(1),
}).strict();
const prescriptionItem = z.object({
  medication_reference: z.string().trim().min(1).max(128).nullable().default(null),
  medication_text: z.string().trim().min(1).max(240).nullable().default(null),
  dose_value: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/).refine((value) => Number(value) > 0),
  dose_unit: z.string().trim().min(1).max(32),
  route_code: reasonCode,
  frequency_code: reasonCode.nullable().default(null),
  frequency_text: z.string().trim().min(1).max(160).nullable().default(null),
  duration_days: z.number().int().min(1).max(365),
  patient_instructions: z.string().trim().min(1).max(2000).nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.medication_reference === null && value.medication_text === null) {
    context.addIssue({ code: 'custom', message: 'Medication reference or text is required' });
  }
  if (value.frequency_code === null && value.frequency_text === null) {
    context.addIssue({ code: 'custom', message: 'Frequency code or text is required' });
  }
});
const diagnosis = z.string().trim().max(1000).nullable().default(null);
export const prescriptionCreateSchema = z.object({
  items: z.array(prescriptionItem).min(1).max(50),
  diagnosis,
}).strict();
export const prescriptionUpdateSchema = z.object({
  items: z.array(prescriptionItem).min(1).max(50), expected_version: expectedVersion,
  diagnosis,
}).strict();
export const prescriptionSignSchema = z.object({
  status: z.enum(['signed', 'discarded']), expected_version: expectedVersion,
  expires_at: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();
export const prescriptionSupersedeSchema = z.object({
  items: z.array(prescriptionItem).min(1).max(50), expected_version: expectedVersion,
  diagnosis,
  expires_at: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();
export const prescriptionCancelSchema = z.object({
  reason_code: reasonCode, expected_version: expectedVersion,
}).strict();
export const notificationListSchema = z.object({
  cursor: z.string().min(1).max(1024).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
  unread: z.enum(['true', 'false']).optional(),
}).strict();
export const notificationPreferenceSchema = z.object({
  category: z.enum(['account_security', 'appointments', 'consultations', 'messages', 'prescriptions', 'vitals_alerts', 'ai_review', 'delivery', 'emergency', 'system']),
  channel: z.enum(['in_app', 'push', 'email']), enabled: z.boolean(),
  quiet_hours_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().default(null),
  quiet_hours_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().default(null),
  timezone: z.string().min(1).max(64).default('Asia/Kuala_Lumpur'),
}).strict().superRefine((value, context) => {
  if ((value.quiet_hours_start === null) !== (value.quiet_hours_end === null)) {
    context.addIssue({ code: 'custom', message: 'Quiet-hour start and end must be supplied together' });
  }
  if (value.channel === 'in_app' && !value.enabled) {
    context.addIssue({ code: 'custom', message: 'In-app notifications cannot be disabled' });
  }
});

export const registerPushDeviceSchema = z.object({
  platform: z.enum(['android', 'ios', 'web']),
  token: z.string().min(16).max(4096),
}).strict();

export type PrescriptionItemRequest = z.infer<typeof prescriptionItem>;
