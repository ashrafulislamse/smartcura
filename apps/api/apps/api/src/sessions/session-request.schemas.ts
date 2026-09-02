import { z } from 'zod';

export const roleIdSchema = z.enum([
  'patient', 'doctor', 'driver', 'pharmacy', 'emergency', 'admin', 'super_admin',
]);

export const createSessionSchema = z.object({
  client_type: z.enum(['patient_flutter', 'doctor_flutter', 'driver_flutter', 'web_portal']),
  device_name: z.string().trim().min(1).max(120),
  requested_role: roleIdSchema.nullish(),
}).strict();

export const selectActiveRoleSchema = z.object({
  membership_id: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  ),
}).strict();

export const stepUpSchema = z.object({
  reason: z.enum([
    'role_switch', 'prescription_sign', 'break_glass', 'controlled_substance',
    'payout', 'withdrawal', 'security_change', 'dependant_access_change',
    // Stage 11 added three step-up-requiring actions. Without their own reasons all
    // three had to be filed as 'security_change', making the audit trail less specific
    // than policy-matrix.md claims.
    'custom_role_change', 'maintenance_change', 'dead_letter_replay',
  ]),
}).strict();

export type CreateSessionBody = z.infer<typeof createSessionSchema>;
export type SelectActiveRoleBody = z.infer<typeof selectActiveRoleSchema>;
export type StepUpBody = z.infer<typeof stepUpSchema>;
