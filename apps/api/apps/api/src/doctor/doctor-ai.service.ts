import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { PostgresConnection } from '@smartcura/database';
import {
  serializeAiArtifact,
  type AiArtifactRecord,
} from '@smartcura/database/ai';
import type { QueryResultRow } from 'pg';
import type { ZodType } from 'zod';
import { z } from 'zod';
import type { ApiConfig } from '../config.js';
import {
  type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import { API_CONFIG } from '../tokens.js';

/**
 * Doctor AI assistant service.
 *
 * This service powers two doctor-facing endpoints that are distinct from the
 * existing patient-facing AI pipeline in `src/ai/`:
 *
 *   - `POST /doctor/ai/assistant` is a SYNCHRONOUS clinical decision-support
 *     call. A doctor submits a clinical question (optionally scoped to a patient
 *     they are actively assigned to or a consultation they own) and receives a
 *     response from the configured AI provider in the same request. This is
 *     unlike the patient pipeline, which queues a generation and returns a
 *     `202` immediately, because a doctor using decision support needs the
 *     answer now, not after a worker poll.
 *
 *   - `GET /doctor/ai/artifacts` lists the AI artifacts already produced for the
 *     doctor's actively-assigned patients, using the same assignment-based
 *     authorization the existing `AiRepository.findAuthorizedArtifact` uses.
 *
 * THE HONEST 501 PRINCIPLE. If the AI provider is not configured — meaning
 * `SMARTCURA_AI_PROVIDER` is neither `openai` nor `cloudflare` or `SMARTCURA_AI_API_KEY` is absent —
 * the assistant endpoint answers `501 NOT_IMPLEMENTED` with an explicit message.
 * It does NOT fabricate a response, does NOT fall back to a mock, and does NOT
 * pretend the feature exists. The `mock` provider is for tests and the offline
 * demo only; a doctor-facing decision-support answer from a deterministic mock
 * would be the most dangerous kind of fabrication because it looks authoritative.
 *
 * EXTERNAL CALLS NEVER HOLD A DATABASE LOCK. The idempotency key is claimed in
 * one transaction, the provider call happens outside any transaction, and the
 * idempotency completion + audit row land in a second transaction. If the
 * provider call fails the claimed key is reclaimed so a retry with the same key
 * is not stuck in `processing` until the TTL expires.
 */

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV7 = z.string().uuid().regex(UUID_V7);

/**
 * The doctor's clinical question. `patient_profile_id` and `consultation_id` are
 * optional: a doctor may ask a general clinical question not tied to a specific
 * patient, or scope it to a patient they are assigned to, or to a consultation
 * they are conducting.
 *
 * `.strict()` is load-bearing: it rejects any client-supplied `model`,
 * `provider`, `temperature` or `system_prompt`. The model and provider are
 * server facts derived from configuration, not from the request, so a client
 * cannot steer the assistant to a different (possibly less safe) model.
 */
export const doctorAiAssistantSchema = z.object({
  patient_profile_id: uuidV7.optional(),
  consultation_id: uuidV7.optional(),
  prompt: z.string().trim().min(1).max(8000),
}).strict();

export type DoctorAiAssistantRequest = z.infer<typeof doctorAiAssistantSchema>;

/**
 * Query for the artifacts list. `patient_profile_id` optionally narrows to one
 * assigned patient; the assignment is still re-proved server-side, so a
 * patient_id the doctor is not assigned to is treated as an empty result, not
 * an error (whether an artifact exists for another patient is itself sensitive,
 * matching the concealment convention in `AiService.getArtifact`).
 */
export const doctorAiArtifactsQuerySchema = z.object({
  patient_profile_id: uuidV7.optional(),
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export type DoctorAiArtifactsQuery = z.infer<typeof doctorAiArtifactsQuerySchema>;

/** Replay window for a doctor AI assistant `Idempotency-Key`. */
const IDEMPOTENCY_TTL_MS = 86_400_000;
/** Operation id written to the `idempotency_keys` table. */
const IDEMPOTENCY_OPERATION = 'doctor_ai.assistant';

/**
 * The doctor-facing system prompt. This is deliberately distinct from the
 * patient-facing prompt in `OpenAiLlmProvider.buildMessages`: the patient
 * prompt tells the model it is non-diagnostic and must only summarise reported
 * symptoms and suggest care navigation. The doctor prompt acknowledges the actor
 * is a licensed clinician who can reason about differentials, but still keeps
 * the model in a decision-SUPPORT role rather than a decision-MAKER role.
 */
const DOCTOR_SYSTEM_PROMPT = [
  'You are a clinical decision-support assistant for a licensed doctor.',
  'The doctor is responsible for all clinical decisions; your role is to provide',
  'concise, evidence-based reasoning, differential considerations, and relevant',
  'clinical guidance. Do not make definitive diagnoses or prescribe treatment.',
  'Always remind the doctor that clinical judgement remains theirs.',
  'When information is insufficient, say so explicitly rather than speculating.',
].join(' ');

interface IdempotencyRow extends QueryResultRow {
  readonly requestHash: string;
  readonly state: string;
  readonly responseStatus: number | null;
  readonly responseBody: Record<string, unknown> | null;
  readonly expired: boolean;
}

interface ArtifactRow extends QueryResultRow, AiArtifactRecord {}

interface ExistsRow extends QueryResultRow {
  readonly exists: boolean;
}

interface ChatCompletionResponse {
  readonly choices: readonly {
    readonly message: { readonly content: string | null };
  }[];
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
  };
}

type IdempotencyClaim =
  | { readonly kind: 'claimed' }
  | { readonly kind: 'replay'; readonly body: Record<string, unknown> }
  | { readonly kind: 'reused' }
  | { readonly kind: 'in_progress' };

@Injectable()
export class DoctorAiService {
  constructor(
    private readonly database: PostgresConnection,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  // -----------------------------------------------------------------------
  // POST /doctor/ai/assistant
  // -----------------------------------------------------------------------

  async assistant(
    current: AuthenticatedSession,
    idempotencyKey: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const request = parse(doctorAiAssistantSchema, body);
    const doctor = this.doctor(current);
    const profileId = current.aggregate.profile.profileId;

    // Authorization before capability: a doctor who is not assigned to the
    // patient gets 403 regardless of whether AI is configured, so the 501
    // does not leak the feature's availability to an unauthorized actor.
    if (request.patient_profile_id !== undefined) {
      await this.requireCareAssignment(doctor.membershipId, request.patient_profile_id);
    }
    if (request.consultation_id !== undefined) {
      await this.requireConsultation(doctor.membershipId, request.consultation_id);
    }

    if (!this.aiConfigured()) {
      throw problem(
        501,
        'NOT_IMPLEMENTED',
        'The AI assistant is not configured for this deployment. ' +
          'Set SMARTCURA_AI_PROVIDER=openai|cloudflare and SMARTCURA_AI_API_KEY to enable it.',
      );
    }

    const requestHash = hashRequest({
      prompt: request.prompt,
      patient_profile_id: request.patient_profile_id ?? null,
      consultation_id: request.consultation_id ?? null,
      doctor_membership_id: doctor.membershipId,
    });
    const now = new Date();
    const correlationIdValue = correlationId();

    // --- Transaction 1: claim the idempotency key (or detect replay/reuse) ---
    const claim = await this.claimIdempotency(
      doctor.organizationId, profileId, idempotencyKey, requestHash, now,
    );
    if (claim.kind === 'replay') return claim.body;
    if (claim.kind === 'reused') {
      throw problem(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused with a different request body');
    }
    if (claim.kind === 'in_progress') {
      throw problem(409, 'IDEMPOTENCY_IN_PROGRESS', 'An idempotent request with this key is still processing');
    }

    // --- External call: the AI provider (outside any transaction) ---
    let aiResponse: { content: string; promptTokens: number; completionTokens: number; latencyMs: number };
    try {
      aiResponse = await this.callProvider(request.prompt);
    } catch (error) {
      // Reclaim the key so a retry with the same key is not stuck in
      // `processing` until the TTL expires. The error is re-thrown so the
      // global exception filter maps it to a Problem Details response.
      await this.reclaimIdempotency(doctor.organizationId, profileId, idempotencyKey);
      throw error;
    }

    // --- Transaction 2: complete idempotency + audit log ---
    const responseBody: Record<string, unknown> = {
      response: aiResponse.content,
      provider: this.config.ai.provider,
      model: this.config.ai.model,
      patient_profile_id: request.patient_profile_id ?? null,
      consultation_id: request.consultation_id ?? null,
      prompt_tokens: aiResponse.promptTokens,
      completion_tokens: aiResponse.completionTokens,
      latency_ms: aiResponse.latencyMs,
      correlation_id: correlationIdValue,
    };

    await this.completeIdempotencyAndAudit(
      doctor.organizationId, profileId, idempotencyKey,
      responseBody, request, now, correlationIdValue,
    );

    return responseBody;
  }

  // -----------------------------------------------------------------------
  // GET /doctor/ai/artifacts
  // -----------------------------------------------------------------------

  async artifacts(
    current: AuthenticatedSession,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const query = parse(doctorAiArtifactsQuerySchema, queryValue);
    const doctor = this.doctor(current);

    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const limit = query.page_size + 1;

    // The `ai_artifacts` table exists in this schema (see `ai-repository.ts`
    // and the migrations that create it). The query is wrapped so that if the
    // table is unreachable — e.g. a partial migration on a fresh environment —
    // the endpoint returns an empty list rather than a 500. The task spec says
    // a missing table is not an error, and an empty list is the honest shape
    // for "no artifacts for your assigned patients."
    let rows: ArtifactRow[];
    try {
      rows = await this.queryArtifacts(
        doctor.membershipId, query.patient_profile_id, cursor, limit,
      );
    } catch {
      return { data: [], page: { has_more: false, next_cursor: null } };
    }

    const hasMore = rows.length > query.page_size;
    const page = hasMore ? rows.slice(0, query.page_size) : rows;
    const last = page.at(-1);
    return {
      data: page.map(serializeAiArtifact),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeCursor(last) : null,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Authorization helpers
  // -----------------------------------------------------------------------

  /**
   * Resolves the active doctor membership from the session. Mirrors the
   * `doctor()` helper in `DoctorTemplatesService`: same checks (active
   * membership, active profile, completed onboarding, `role_id = 'doctor'`),
   * same error codes.
   */
  private doctor(current: AuthenticatedSession) {
    const active = current.aggregate.memberships.find(
      (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined || active.status !== 'active') {
      throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      throw problem(403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete');
    }
    if (active.roleId !== 'doctor') {
      throw problem(403, 'PERMISSION_DENIED', 'Doctor authority is required');
    }
    return active;
  }

  /**
   * Verifies the doctor holds an active care assignment for the patient.
   * Uses the same `care_assignments` query the `AiRepository.findAuthorizedArtifact`
   * uses inline: `clinician_membership_id` + `patient_profile_id` + `status = 'active'`.
   * A failure is 403, not 404, because the doctor is authenticated and the
   * authorization boundary is the assignment relationship.
   */
  private async requireCareAssignment(
    doctorMembershipId: string, patientProfileId: string,
  ): Promise<void> {
    const result = await this.database.query<ExistsRow>(
      `SELECT EXISTS (
         SELECT 1 FROM care_assignments
         WHERE clinician_membership_id = $1
           AND patient_profile_id = $2
           AND status = 'active'
       ) AS exists`,
      [doctorMembershipId, patientProfileId],
    );
    if (!result.rows[0]?.exists) {
      throw problem(403, 'PERMISSION_DENIED', 'No active care assignment for this patient');
    }
  }

  /**
   * Verifies the consultation belongs to the acting doctor. Uses the same
   * `doctor_membership_id` check as `ConsultationRepository.findAuthorized`.
   * A consultation the doctor is not conducting is 404 (concealed as absent),
   * matching the convention that whether a consultation exists between two
   * other people is itself sensitive.
   */
  private async requireConsultation(
    doctorMembershipId: string, consultationId: string,
  ): Promise<void> {
    const result = await this.database.query<ExistsRow>(
      `SELECT EXISTS (
         SELECT 1 FROM consultations
         WHERE consultation_id = $1 AND doctor_membership_id = $2
       ) AS exists`,
      [consultationId, doctorMembershipId],
    );
    if (!result.rows[0]?.exists) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Consultation was not found');
    }
  }

  // -----------------------------------------------------------------------
  // AI provider call
  // -----------------------------------------------------------------------

  /**
   * Whether a real AI provider is configured. The `mock` provider is for tests
   * and the offline demo only; a doctor-facing decision-support answer from a
   * deterministic mock would look authoritative and be fabricated, which is the
   * exact outcome the 501 guard exists to prevent.
   */
  private aiConfigured(): boolean {
    return (this.config.ai.provider === 'openai' || this.config.ai.provider === 'cloudflare') && this.config.ai.apiKey !== undefined;
  }

  /**
   * Calls the OpenAI-compatible `/chat/completions` endpoint synchronously.
   *
   * This is a direct `fetch` rather than a call through `OpenAiLlmProvider`
   * because the existing provider's system prompt is patient-facing ("You only
   * summarize what the patient reported"), whereas the doctor assistant needs a
   * decision-support prompt that acknowledges the actor is a clinician. The
   * safety constraint — the model supports but does not replace clinical
   * judgement — is preserved in the `DOCTOR_SYSTEM_PROMPT`.
   *
   * `stream: false` is set explicitly because some OpenAI-compatible gateways
   * default to streaming, which would return SSE frames instead of a single
   * JSON body.
   */
  private async callProvider(prompt: string): Promise<{
    content: string; promptTokens: number; completionTokens: number; latencyMs: number;
  }> {
    const apiKey = this.config.ai.apiKey;
    if (apiKey === undefined) throw problem(503, 'AI_MODEL_UNAVAILABLE', 'AI API key is not configured');
    const startedAt = performance.now();
    const baseUrl = this.config.ai.baseUrl.replace(/\/$/, '');

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.ai.model,
        messages: [
          { role: 'system', content: DOCTOR_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        stream: false,
      }),
    });

    if (!response.ok) {
      const respBody = await response.text().catch(() => '');
      throw problem(
        503,
        'AI_MODEL_UNAVAILABLE',
        `AI provider returned an error (status ${response.status}): ${respBody.slice(0, 500)}`,
      );
    }

    // The response may be a standard OpenAI shape or wrapped by a gateway in a
    // `data` field (see `OpenAiLlmProvider` for the same unwrap logic).
    const json = await response.json() as ChatCompletionResponse & {
      readonly data?: ChatCompletionResponse | null;
    };
    const data: ChatCompletionResponse = json.data ?? json;
    const content = data.choices[0]?.message?.content;
    if (content === undefined || content === null || content.trim().length === 0) {
      throw problem(503, 'AI_MODEL_UNAVAILABLE', 'AI provider returned an empty response');
    }

    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      content,
      promptTokens: data.usage?.prompt_tokens ?? estimateTokens(prompt),
      completionTokens: data.usage?.completion_tokens ?? estimateTokens(content),
      latencyMs,
    };
  }

  // -----------------------------------------------------------------------
  // Idempotency (two-transaction pattern for an external call)
  // -----------------------------------------------------------------------

  /**
   * Claims the idempotency key inside a short transaction. Returns the claim
   * verdict: `claimed` (proceed), `replay` (return stored response), `reused`
   * (key bound to a different body), or `in_progress` (another request holds
   * the key). This mirrors `ClinicalTemplateRepository.beginIdempotency` but is
   * inline because the generic idempotency helpers are not exported as a
   * subpath from `@smartcura/database`.
   */
  private async claimIdempotency(
    organizationId: string, profileId: string,
    idempotencyKey: string, requestHash: string, now: Date,
  ): Promise<IdempotencyClaim> {
    return this.database.transaction(async (client) => {
      const existing = await client.query<IdempotencyRow>(
        `SELECT request_hash AS "requestHash", state,
           response_status AS "responseStatus", response_body AS "responseBody",
           (expires_at <= $5) AS expired
         FROM idempotency_keys
         WHERE organization_id = $1 AND actor_profile_id = $2
           AND operation_id = $3 AND idempotency_key = $4
         FOR UPDATE`,
        [organizationId, profileId, IDEMPOTENCY_OPERATION, idempotencyKey, now],
      );
      const row = existing.rows[0];
      if (row !== undefined) {
        if (row.expired) {
          await client.query(
            `DELETE FROM idempotency_keys
             WHERE organization_id = $1 AND actor_profile_id = $2
               AND operation_id = $3 AND idempotency_key = $4`,
            [organizationId, profileId, IDEMPOTENCY_OPERATION, idempotencyKey],
          );
        } else if (row.requestHash !== requestHash) {
          return { kind: 'reused' as const };
        } else if (row.state === 'completed' && row.responseBody !== null) {
          return { kind: 'replay' as const, body: row.responseBody };
        } else {
          return { kind: 'in_progress' as const };
        }
      }
      const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);
      const claimed = await client.query(
        `INSERT INTO idempotency_keys
           (organization_id, actor_profile_id, operation_id, idempotency_key,
            request_hash, state, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'processing', $6)
         ON CONFLICT (organization_id, actor_profile_id, operation_id, idempotency_key)
         DO NOTHING RETURNING idempotency_key`,
        [organizationId, profileId, IDEMPOTENCY_OPERATION, idempotencyKey, requestHash, expiresAt],
      );
      if (claimed.rowCount !== 1) return { kind: 'in_progress' as const };
      return { kind: 'claimed' as const };
    });
  }

  /**
   * Completes the idempotency key and writes the audit row in one transaction.
   * The audit records that the interaction happened and which patient it
   * concerned, without storing the prompt or response content (which may carry
   * PHI). The `reason` is a short code, matching the convention in
   * `ai-repository.ts` and `clinical-template-repository.ts`.
   */
  private async completeIdempotencyAndAudit(
    organizationId: string, profileId: string, idempotencyKey: string,
    responseBody: Record<string, unknown>,
    request: DoctorAiAssistantRequest, now: Date, correlationIdValue: string,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `UPDATE idempotency_keys
         SET state = 'completed', response_status = $5,
           response_body = $6::jsonb, updated_at = $7
         WHERE organization_id = $1 AND actor_profile_id = $2
           AND operation_id = $3 AND idempotency_key = $4`,
        [
          organizationId, profileId, IDEMPOTENCY_OPERATION, idempotencyKey,
          200, JSON.stringify(responseBody), now,
        ],
      );
      await client.query(
        `INSERT INTO audit_logs
           (audit_id, organization_id, actor_profile_id, action, object_type,
            object_id, reason, correlation_id, occurred_at)
         VALUES (uuidv7(), $1, $2, $3, 'doctor_ai_interaction', $4, $5, $6, $7)`,
        [
          organizationId, profileId, 'doctor_ai.assistant',
          request.patient_profile_id ?? null,
          'clinical_decision_support',
          correlationIdValue, now,
        ],
      );
    });
  }

  /**
   * Reclaims a claimed key after the external call failed, so a retry with the
   * same key is not blocked until the TTL expires. Uses a plain `DELETE`
   * (not a transaction) because there is nothing else to atomically pair with
   * the delete: the external call already failed and was thrown.
   */
  private async reclaimIdempotency(
    organizationId: string, profileId: string, idempotencyKey: string,
  ): Promise<void> {
    await this.database.query(
      `DELETE FROM idempotency_keys
       WHERE organization_id = $1 AND actor_profile_id = $2
         AND operation_id = $3 AND idempotency_key = $4
         AND state = 'processing'`,
      [organizationId, profileId, IDEMPOTENCY_OPERATION, idempotencyKey],
    );
  }

  // -----------------------------------------------------------------------
  // Artifacts query
  // -----------------------------------------------------------------------

  /**
   * Queries `ai_artifacts` for the doctor's actively-assigned patients, using
   * the same `EXISTS (care_assignments ... status = 'active')` authorization
   * pattern as `AiRepository.findAuthorizedArtifact`. An optional
   * `patient_profile_id` narrows to one patient (still re-proved via the
   * assignment join, so a patient the doctor is not assigned to returns
   * nothing, not an error).
   *
   * Ordered by `created_at DESC, artifact_id DESC` (most recent first), which
   * is the relevance ordering the AGENTS.md list convention prefers over
   * recency-without-rationale.
   */
  private async queryArtifacts(
    doctorMembershipId: string,
    patientProfileId: string | undefined,
    cursor: { afterCreatedAt: Date; afterArtifactId: string } | undefined,
    limit: number,
  ): Promise<ArtifactRow[]> {
    const artifactProjection = `artifact_id AS "artifactId", generation_id AS "generationId",
      patient_profile_id AS "patientProfileId", organization_id AS "organizationId",
      artifact_type AS "artifactType", version_no AS "versionNo",
      review_status AS "reviewStatus", risk_level AS "riskLevel", confidence::text AS confidence,
      content, model_id AS "modelId", prompt_template_id AS "promptTemplateId",
      replaces_artifact_id AS "replacesArtifactId", version,
      created_at AS "createdAt", updated_at AS "updatedAt"`;

    const params: unknown[] = [doctorMembershipId];
    let patientFilter = '';
    if (patientProfileId !== undefined) {
      params.push(patientProfileId);
      patientFilter = `AND artifact.patient_profile_id = $${params.length}`;
    }
    let cursorFilter = '';
    if (cursor !== undefined) {
      params.push(cursor.afterCreatedAt, cursor.afterArtifactId);
      cursorFilter = `AND (artifact.created_at, artifact.artifact_id) < ($${params.length - 1}, $${params.length})`;
    }
    params.push(limit);

    const result = await this.database.query<ArtifactRow>(
      `SELECT ${artifactProjection} FROM ai_artifacts artifact
       WHERE EXISTS (
         SELECT 1 FROM care_assignments assignment
         WHERE assignment.clinician_membership_id = $1
           AND assignment.patient_profile_id = artifact.patient_profile_id
           AND assignment.status = 'active'
       )
       ${patientFilter}
       ${cursorFilter}
       ORDER BY artifact.created_at DESC, artifact.artifact_id DESC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows;
  }
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function hashRequest(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

interface Cursor {
  readonly afterCreatedAt: Date;
  readonly afterArtifactId: string;
}

function encodeCursor(record: AiArtifactRecord): string {
  return Buffer.from(
    JSON.stringify({
      created_at: record.createdAt.toISOString(),
      artifact_id: record.artifactId,
    }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: string): Cursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof decoded.created_at !== 'string' || typeof decoded.artifact_id !== 'string') throw new Error();
    if (!UUID_V7.test(decoded.artifact_id)) throw new Error();
    const afterCreatedAt = new Date(decoded.created_at);
    if (!Number.isFinite(afterCreatedAt.getTime())) throw new Error();
    return { afterCreatedAt, afterArtifactId: decoded.artifact_id };
  } catch {
    throw validationFailed();
  }
}
