import { z } from 'zod';

/**
 * Request validation schemas for the doctor clinical-template CRUD routes.
 *
 * Follows the patterns established in `consultation-request.schemas.ts`:
 *   * `content` is a JSON object bounded to 64 KiB to match the database CHECK
 *     constraint (`clinical_templates_content_size_check`), so a request can never
 *     carry a body the server would refuse at insert time;
 *   * `expected_version` is the optimistic-concurrency currency for mutations;
 *   * list queries use `cursor` + `page_size` pagination with bounded sizes, refusing
 *     an excess rather than silently clamping (the project list convention).
 */

const uuidV7 = z
  .string()
  .uuid()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

const expectedVersion = z.number().int().min(1);

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().min(1).max(2000).nullable().default(null);
const specialty = z.string().trim().min(1).max(120).nullable().default(null);

const content = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 65_536,
    'Template content exceeds 65536 bytes',
  );

export const clinicalTemplateCreateSchema = z
  .object({
    name,
    description,
    specialty,
    content,
  })
  .strict();

export const clinicalTemplateUpdateSchema = z
  .object({
    name,
    description,
    specialty,
    content,
    expected_version: expectedVersion,
  })
  .strict();

export const clinicalTemplateListSchema = z
  .object({
    search: z.string().trim().min(1).max(128).optional(),
    status: z.enum(['active', 'archived']).optional(),
    cursor: z.string().min(1).max(1024).optional(),
    page_size: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const uuidSchema = uuidV7;

export type ClinicalTemplateCreateRequest = z.infer<typeof clinicalTemplateCreateSchema>;
export type ClinicalTemplateUpdateRequest = z.infer<typeof clinicalTemplateUpdateSchema>;
