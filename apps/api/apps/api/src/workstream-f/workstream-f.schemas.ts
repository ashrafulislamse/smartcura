import { z } from 'zod';
const limit = z.coerce.number().int().min(1).max(100).default(50);
const filter = z.string().trim().min(1).max(128).optional();
export const patientQuerySchema = z.object({ search: filter, limit }).strict();
export const assignedPatientQuerySchema = z.object({ search: filter, cursor: z.string().min(1).max(512).optional(), page_size: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export const verificationQuerySchema = z.object({ status: z.enum(['pending_review','changes_requested','approved','rejected','suspended','expired']).optional(), limit }).strict();
export const auditQuerySchema = z.object({ action: filter, object_type: filter, limit }).strict();
export const uuidSchema = z.string().uuid();
