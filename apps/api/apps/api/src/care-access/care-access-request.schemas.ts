import { z } from 'zod';
import {
  CARE_ASSIGNMENT_END_REASONS,
  CONSENT_REVOCATION_REASONS,
  CONSENT_SCOPES,
  type CareAssignmentStatusValue,
} from '@smartcura/database';

export const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
const instant = z.string().min(20).max(40).refine((value) =>
  /[Zz]$|[+-][01][0-9]:[0-5][0-9]$/.test(value) &&
  Number.isFinite(new Date(value).getTime()),
);
const CARE_ASSIGNMENT_STATUSES = [
  'active', 'completed', 'revoked', 'expired',
] as const satisfies readonly CareAssignmentStatusValue[];

export const createConsentGrantSchema = z.object({
  grantee_profile_id: uuidV7.nullable().default(null),
  grantee_membership_id: uuidV7.nullable().default(null),
  scope: z.enum(CONSENT_SCOPES),
  purpose: z.string().trim().min(3).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{2,159}$/),
  expires_at: instant.nullable().default(null),
}).strict().refine(
  (value) => (value.grantee_profile_id === null) !== (value.grantee_membership_id === null),
  { message: 'Exactly one grantee must be supplied' },
);

export const revokeConsentGrantSchema = z.object({
  expected_version: z.number().int().min(0),
  reason: z.enum(CONSENT_REVOCATION_REASONS),
}).strict();

export const createCareAssignmentSchema = z.object({
  clinician_membership_id: uuidV7,
  patient_profile_id: uuidV7,
}).strict();

export const endCareAssignmentSchema = z.object({
  expected_version: z.number().int().min(0),
  status: z.enum(['completed', 'revoked']),
  reason: z.enum(CARE_ASSIGNMENT_END_REASONS),
}).strict().refine(
  (value) => value.status === 'completed'
    ? value.reason === 'care_completed'
    : value.reason !== 'care_completed',
  { message: 'The end reason is incompatible with the requested status' },
);

export const listCareAssignmentsSchema = z.object({
  organization_id: uuidV7.optional(),
  status: z.enum(CARE_ASSIGNMENT_STATUSES).optional(),
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const listConsentGrantsSchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const organizationPathSchema = z.object({ organizationId: uuidV7 }).strict();
export const consentPathSchema = z.object({ consentId: uuidV7 }).strict();
export const assignmentPathSchema = z.object({ assignmentId: uuidV7 }).strict();

export type CreateConsentGrantRequest = z.infer<typeof createConsentGrantSchema>;
export type ListConsentGrantsQuery = z.infer<typeof listConsentGrantsSchema>;
export type ListCareAssignmentsQuery = z.infer<typeof listCareAssignmentsSchema>;
