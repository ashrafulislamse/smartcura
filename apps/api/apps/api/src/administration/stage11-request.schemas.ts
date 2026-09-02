import { z } from 'zod';

const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
const expectedVersion = z.number().int().min(0);
const reasonCode = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const templateKey = z.string().regex(/^[a-z][a-z0-9_.]{1,62}$/);
const notificationCategory = z.enum([
  'account_security', 'appointments', 'consultations', 'messages', 'prescriptions',
  'vitals_alerts', 'ai_review', 'delivery', 'dispatch', 'emergency', 'system',
]);

export const listFaqsSchema = z.object({
  published_only: z.enum(['true', 'false']).default('false'),
}).strict();
export const createFaqSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(12_000),
}).strict();
export const updateFaqSchema = createFaqSchema.extend({ expected_version: expectedVersion }).strict();
export const setFaqStateSchema = z.object({
  publish_state: z.enum(['draft', 'published']), expected_version: expectedVersion,
}).strict();
export const archiveFaqSchema = z.object({ expected_version: expectedVersion }).strict();

export const createTemplateSchema = z.object({
  template_key: templateKey,
  category: notificationCategory,
  title_template: z.string().trim().min(1).max(200),
  body_template: z.string().trim().min(1).max(4000),
}).strict();
export const addTemplateVersionSchema = z.object({
  title_template: z.string().trim().min(1).max(200),
  body_template: z.string().trim().min(1).max(4000),
}).strict();
export const activateTemplateVersionSchema = z.object({
  version: z.number().int().min(1),
}).strict();

export const createBroadcastSchema = z.object({
  template_key: templateKey,
  template_version: z.number().int().min(1),
  audience: z.enum(['all', 'patients', 'staff']),
}).strict();
export const scheduleBroadcastSchema = z.object({
  scheduled_at: z.string().datetime({ offset: true }), expected_version: expectedVersion,
}).strict();
export const sendBroadcastSchema = z.object({ expected_version: expectedVersion }).strict();

export const createCustomRoleSchema = z.object({
  role_key: z.string().regex(/^[a-z][a-z0-9_]{1,46}$/),
  display_name: z.string().trim().min(1).max(80),
  base_role_id: z.enum(['patient', 'doctor', 'driver', 'pharmacy', 'emergency', 'admin']),
}).strict();
export const updateCustomRoleSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  active: z.boolean(),
  expected_version: expectedVersion,
}).strict();
export const replaceCustomRolePermissionsSchema = z.object({
  permission_ids: z.array(z.string().min(3).max(128)).max(200)
    .refine((values) => new Set(values).size === values.length),
  expected_version: expectedVersion,
}).strict();
export const assignCustomRoleSchema = z.object({
  custom_role_id: uuidV7.nullable(), expected_version: expectedVersion,
}).strict();

export const updateMaintenanceSchema = z.object({
  enabled: z.boolean(),
  reason_code: reasonCode.nullable().default(null),
  starts_at: z.string().datetime({ offset: true }).nullable().default(null),
  expected_version: expectedVersion,
}).strict().refine(
  (value) => value.enabled || (value.reason_code === null && value.starts_at === null),
  { message: 'disabled maintenance cannot retain a reason or start time' },
);

export const replayDeadLetterSchema = z.object({ reason_code: reasonCode }).strict();

export type CreateFaqRequest = z.infer<typeof createFaqSchema>;
export type CreateTemplateRequest = z.infer<typeof createTemplateSchema>;
export type CreateBroadcastRequest = z.infer<typeof createBroadcastSchema>;
export type CreateCustomRoleRequest = z.infer<typeof createCustomRoleSchema>;
