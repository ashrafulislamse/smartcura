import { z } from 'zod';
import { MEMBERSHIP_TRANSITION_REASON_CODES } from '@smartcura/database';

const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

const siteIds = z.array(uuidV7).max(50).refine(
  (values) => new Set(values).size === values.length,
);

export const idempotencyKeySchema = z.string().trim().min(16).max(128)
  .regex(/^[A-Za-z0-9._~-]+$/);

export const createSelfMembershipSchema = z.object({
  role: z.enum(['patient', 'doctor', 'driver', 'pharmacy', 'emergency']),
  site_ids: siteIds,
}).strict();

export const createMembershipInvitationSchema = z.object({
  profile_id: uuidV7,
  role: z.enum(['patient', 'doctor', 'driver', 'pharmacy', 'emergency', 'admin']),
  site_ids: siteIds,
}).strict();

export const membershipPathSchema = z.object({
  organizationId: uuidV7,
  membershipId: uuidV7.optional(),
}).strict();

export const listMembershipsQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

/**
 * Transitions carry a structured reason code, never operator free text. Audit
 * rows are retained broadly and shared widely, so an open string field is an
 * unacceptable route for clinical detail to leak into them.
 */
export const transitionMembershipSchema = z.object({
  status: z.enum(['active', 'suspended', 'revoked']),
  reason_code: z.enum(MEMBERSHIP_TRANSITION_REASON_CODES),
  expected_version: z.number().int().min(0),
}).strict();

export type MembershipPath = z.infer<typeof membershipPathSchema>;
export type ListMembershipsQuery = z.infer<typeof listMembershipsQuerySchema>;
export type TransitionMembershipRequest = z.infer<typeof transitionMembershipSchema>;
