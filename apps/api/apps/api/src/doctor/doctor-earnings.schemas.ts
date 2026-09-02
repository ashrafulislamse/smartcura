import { z } from 'zod';

/**
 * Schemas for the doctor-scoped earnings endpoint.
 *
 * GET /doctor/earnings is a read-only summary of the current doctor's payout
 * history. The query is optionally cursor-paginated for the recent entries
 * list, matching the convention in `workstream-f.schemas.ts` and
 * `iot-request.schemas.ts`.
 */

/**
 * Query parameters for GET /doctor/earnings.
 *
 * `cursor` is the opaque keyset pagination cursor for the recent entries list.
 * `page_size` bounds the number of recent entries returned and is capped at
 * 100, matching the IoT and workstream-f conventions.
 */
export const earningsQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    page_size: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type EarningsQuery = z.infer<typeof earningsQuerySchema>;
