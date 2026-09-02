import { z } from 'zod';

const uuidV7 = z.string().uuid()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

/**
 * A patient turn.
 *
 * `.strict()` is load-bearing here: it rejects a client-supplied `role`,
 * `model_id`, `confidence`, `risk_level` or `review_status`. Provenance and review
 * state are server facts, and accepting any of them from a request would let a
 * client mint an artifact that looks doctor-approved.
 */
export const submitAiTurnSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  artifact_type: z.enum(['symptom_summary', 'care_navigation', 'health_summary', 'daily_summary', 'trend_analysis']),
  client_correlation_id: uuidV7,
}).strict();

export const reviewAiArtifactSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  rationale_code: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  expected_version: z.number().int().min(0),
}).strict();

export type SubmitAiTurnRequest = z.infer<typeof submitAiTurnSchema>;
export type ReviewAiArtifactRequest = z.infer<typeof reviewAiArtifactSchema>;
