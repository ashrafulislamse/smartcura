import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  AI_ARTIFACT_CHANGED_EVENT_TYPE,
  AI_ARTIFACT_CHANGED_EVENT_VERSION,
  AI_GENERATION_REQUESTED_EVENT_TYPE,
  AI_GENERATION_REQUESTED_EVENT_VERSION,
} from './ai-events.js';
import {
  evaluateSafety, safetyBlocks,
  type AiArtifactType, type AiProvider, type AiRiskLevel, type KnowledgeCitation,
  type LlmProvider, type SafetyFinding,
} from './ai-provider.js';
import { type HealthContext, HealthContextBuilder } from './health-context.js';
import {
  type RichLongitudinalAnalysis, LongitudinalAnalyzer,
} from './longitudinal-analysis.js';
import {
  type PatientRiskProfile, type AnomalyReport,
  RiskScoringEngine, AdvancedAnomalyDetector,
} from './risk-scoring.js';
import {
  revalidateClinicalActor,
  type ClinicalActorContext,
  type ClinicalActorFailure,
} from './clinical-actor.js';

export const AI_REVIEW_STATUSES = [
  'pending_review', 'approved', 'rejected', 'superseded',
] as const;
export type AiReviewStatus = typeof AI_REVIEW_STATUSES[number];
export type AiGenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked';

export interface AiArtifactRecord {
  readonly artifactId: string;
  readonly generationId: string;
  readonly patientProfileId: string;
  readonly organizationId: string;
  readonly artifactType: AiArtifactType;
  readonly versionNo: number;
  readonly reviewStatus: AiReviewStatus;
  readonly riskLevel: AiRiskLevel;
  readonly confidence: string | null;
  readonly content: Record<string, unknown>;
  readonly modelId: string;
  readonly promptTemplateId: string;
  readonly replacesArtifactId: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
interface ArtifactRow extends QueryResultRow, AiArtifactRecord {}
interface GenerationWorkRow extends QueryResultRow {
  readonly generationId: string;
  readonly conversationId: string | null;
  readonly patientProfileId: string;
  readonly organizationId: string;
  readonly artifactType: AiArtifactType;
  readonly modelId: string;
  readonly promptTemplateId: string;
  readonly promptTemplateKey: string;
  readonly promptTemplateVersion: number;
  readonly status: AiGenerationStatus;
}

export type AiFailure = ClinicalActorFailure | 'not_found' | 'not_owner' | 'not_reviewer' |
  'version_conflict' | 'invalid_transition' | 'conversation_closed' | 'model_unavailable';

/**
 * Review transitions. A rerun produces a new artifact; approving a replacement is
 * what supersedes the prior version, so `superseded` is never a reviewer's direct
 * verdict on a pending artifact.
 */
export function aiReviewTransitionAllowed(current: AiReviewStatus, next: AiReviewStatus): boolean {
  if (current === 'pending_review') return next === 'approved' || next === 'rejected';
  if (current === 'approved') return next === 'superseded';
  return false;
}

const artifactProjection = `artifact_id AS "artifactId", generation_id AS "generationId",
  patient_profile_id AS "patientProfileId", organization_id AS "organizationId",
  artifact_type AS "artifactType", version_no AS "versionNo",
  review_status AS "reviewStatus", risk_level AS "riskLevel", confidence::text AS confidence,
  content, model_id AS "modelId", prompt_template_id AS "promptTemplateId",
  replaces_artifact_id AS "replacesArtifactId", version,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export function serializeAiArtifact(record: AiArtifactRecord): Record<string, unknown> {
  return {
    artifact_id: record.artifactId,
    generation_id: record.generationId,
    patient_profile_id: record.patientProfileId,
    artifact_type: record.artifactType,
    version_no: record.versionNo,
    review_status: record.reviewStatus,
    risk_level: record.riskLevel,
    // Absent unless the producing model declares a calibrated score, which the
    // database trigger also enforces.
    confidence: record.confidence === null ? null : Number(record.confidence),
    content: record.content,
    model_id: record.modelId,
    prompt_template_id: record.promptTemplateId,
    replaces_artifact_id: record.replacesArtifactId,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export class AiRepository {
  constructor(
    private readonly database: PostgresConnection,
    private readonly provider: AiProvider = 'mock',
    private readonly healthContextBuilder: HealthContextBuilder | null = null,
    private readonly riskScoringEngine: RiskScoringEngine | null = null,
    private readonly anomalyDetector: AdvancedAnomalyDetector | null = null,
    private readonly longitudinalAnalyzer: LongitudinalAnalyzer | null = null,
  ) {}

  /** Starts or returns the patient's active conversation. */
  async startConversation(input: {
    organizationId: string; actor: ClinicalActorContext; now: Date; correlationId: string;
  }): Promise<{ conversationId: string; status: string } | AiFailure> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const existing = await client.query<{ conversationId: string; status: string }>(
        `SELECT conversation_id AS "conversationId", status FROM ai_conversations
         WHERE patient_profile_id = $1 AND status = 'active' LIMIT 1`,
        [input.actor.profileId],
      );
      if (existing.rows[0] !== undefined) return existing.rows[0];
      const created = await client.query<{ conversationId: string; status: string }>(
        `INSERT INTO ai_conversations (patient_profile_id, organization_id)
         VALUES ($1,$2) RETURNING conversation_id AS "conversationId", status`,
        [input.actor.profileId, input.organizationId],
      );
      return created.rows[0]!;
    });
  }

  /**
   * Appends a patient turn and enqueues a generation.
   *
   * The provider is NOT called here. External calls never happen inside a
   * transaction, so the turn, the queued generation and its outbox event commit
   * atomically and the worker performs the model call afterwards.
   */
  async submitTurn(input: {
    conversationId: string; content: string; clientCorrelationId: string;
    artifactType: AiArtifactType; actor: ClinicalActorContext;
    now: Date; correlationId: string;
  }): Promise<{ generationId: string; sequenceNo: number } | AiFailure> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const conversation = (await client.query<{
        patientProfileId: string; organizationId: string; status: string;
      }>(
        `SELECT patient_profile_id AS "patientProfileId",
           organization_id AS "organizationId", status
         FROM ai_conversations WHERE conversation_id = $1 FOR UPDATE`,
        [input.conversationId],
      )).rows[0];
      if (conversation === undefined) return 'not_found';
      if (conversation.patientProfileId !== input.actor.profileId) return 'not_owner';
      if (conversation.status !== 'active') return 'conversation_closed';

      const replay = (await client.query<{ sequenceNo: number }>(
        `SELECT sequence_no::integer AS "sequenceNo" FROM ai_messages
         WHERE conversation_id = $1 AND client_correlation_id = $2`,
        [input.conversationId, input.clientCorrelationId],
      )).rows[0];
      if (replay !== undefined) {
        const priorGeneration = (await client.query<{ generationId: string }>(
          `SELECT generation_id AS "generationId" FROM ai_generations
           WHERE conversation_id = $1 ORDER BY created_at DESC, generation_id DESC LIMIT 1`,
          [input.conversationId],
        )).rows[0];
        if (priorGeneration !== undefined) {
          return { generationId: priorGeneration.generationId, sequenceNo: replay.sequenceNo };
        }
      }

      const sequenceNo = (await client.query<{ sequenceNo: number }>(
        `UPDATE ai_conversations SET next_sequence_no = next_sequence_no + 1,
           version = version + 1, updated_at = $2
         WHERE conversation_id = $1
         RETURNING (next_sequence_no - 1)::integer AS "sequenceNo"`,
        [input.conversationId, input.now],
      )).rows[0]!.sequenceNo;
      // ASSERTION: the role is assigned by the server. A request cannot inject an
      // `assistant` or `system` turn, which is the cheapest prompt-injection route.
      await client.query(
        `INSERT INTO ai_messages
         (conversation_id, role, sequence_no, content, client_correlation_id, created_at)
         VALUES ($1,'patient',$2,$3,$4,$5)`,
        [input.conversationId, sequenceNo, input.content, input.clientCorrelationId, input.now],
      );
      const model = (await client.query<{ modelId: string }>(
        `SELECT model_id AS "modelId" FROM ai_models
         WHERE provider = $1 AND retired_at IS NULL ORDER BY created_at LIMIT 1`,
        [this.provider],
      )).rows[0];
      if (model === undefined) return 'model_unavailable';
      const template = (await client.query<{ promptTemplateId: string }>(
        `SELECT prompt_template_id AS "promptTemplateId" FROM prompt_templates
         WHERE artifact_type = $1 AND retired_at IS NULL
         ORDER BY version DESC LIMIT 1`,
        [input.artifactType],
      )).rows[0];
      if (template === undefined) return 'model_unavailable';
      const generation = (await client.query<{ generationId: string }>(
        `INSERT INTO ai_generations
         (conversation_id, patient_profile_id, organization_id, artifact_type, model_id,
          prompt_template_id, input_data_classes, requested_by_profile_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$2)
         RETURNING generation_id AS "generationId"`,
        [input.conversationId, conversation.patientProfileId, conversation.organizationId,
          input.artifactType, model.modelId, template.promptTemplateId,
          ['patient_reported_symptoms']],
      )).rows[0]!;
      await client.query(
        `INSERT INTO outbox_events
         (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
          payload,correlation_id,occurred_at)
         VALUES (uuidv7(),$1,$2,'ai_generation',$3,0,$4::jsonb,$5,$6)`,
        [AI_GENERATION_REQUESTED_EVENT_TYPE, AI_GENERATION_REQUESTED_EVENT_VERSION,
          generation.generationId,
          JSON.stringify({ generation_id: generation.generationId }),
          input.correlationId, input.now],
      );
      return { generationId: generation.generationId, sequenceNo };
    });
  }

  async loadGenerationWork(generationId: string): Promise<GenerationWorkRow | undefined> {
    return (await this.database.query<GenerationWorkRow>(
      `SELECT generation.generation_id AS "generationId",
         generation.conversation_id AS "conversationId",
         generation.patient_profile_id AS "patientProfileId",
         generation.organization_id AS "organizationId",
         generation.artifact_type AS "artifactType", generation.model_id AS "modelId",
         generation.prompt_template_id AS "promptTemplateId",
         template.template_key AS "promptTemplateKey", template.version AS "promptTemplateVersion",
         generation.status
       FROM ai_generations generation
       JOIN prompt_templates template
         ON template.prompt_template_id = generation.prompt_template_id
       WHERE generation.generation_id = $1`,
      [generationId],
    )).rows[0];
  }

  /**
   * Runs one queued generation and commits its outcome.
   *
   * The provider call happens BEFORE the transaction, so no external latency is
   * held under a database lock. The safety verdict decides whether an artifact is
   * created at all: a blocked candidate is retained for review but never becomes a
   * patient-visible artifact.
   */
  async runGeneration(input: {
    generationId: string; provider: LlmProvider; now: Date; correlationId: string;
    retrieve: (patientProfileId: string) => Promise<readonly KnowledgeCitation[]>;
  }): Promise<'succeeded' | 'blocked' | 'terminal' | 'not_found'> {
    const work = await this.loadGenerationWork(input.generationId);
    if (work === undefined) return 'not_found';
    if (work.status !== 'queued' && work.status !== 'running') return 'terminal';

    const turns = work.conversationId === null ? [] : (await this.database.query<{
      role: 'patient' | 'assistant'; content: string;
    }>(
      `SELECT role, content FROM ai_messages
       WHERE conversation_id = $1 AND role <> 'system'
       ORDER BY sequence_no`,
      [work.conversationId],
    )).rows;
    const citations = await input.retrieve(work.patientProfileId);
    // Build the authorised patient health context (Phase AI-2). The
    // patientProfileId always comes from the ai_generations work row, never
    // from user input — this is the cross-patient isolation guarantee.
    const healthContext: HealthContext | undefined =
      this.healthContextBuilder !== null
        ? await this.healthContextBuilder.build(work.patientProfileId, input.now)
        : undefined;
    // Phase AI-9: build risk scores, anomaly report, and rich longitudinal
    // analysis. Each module is optional so the pipeline remains backward-
    // compatible. All are scoped to the patientProfileId from the ai_generations
    // work row — cross-patient isolation is by construction.
    const riskProfile: PatientRiskProfile | undefined =
      this.riskScoringEngine !== null
        ? await this.riskScoringEngine.computeRiskProfile(work.patientProfileId, input.now)
        : undefined;
    const anomalyReport: AnomalyReport | undefined =
      this.anomalyDetector !== null
        ? await this.anomalyDetector.detect(work.patientProfileId, input.now)
        : undefined;
    const richLongitudinalAnalysis: RichLongitudinalAnalysis | undefined =
      this.longitudinalAnalyzer !== null
        ? await this.longitudinalAnalyzer.analyzeRich(work.patientProfileId, input.now)
        : undefined;
    const result = await input.provider.generate({
      artifactType: work.artifactType,
      turns,
      citations,
      promptTemplateKey: work.promptTemplateKey,
      promptTemplateVersion: work.promptTemplateVersion,
      healthContext,
      riskProfile,
      anomalyReport,
      richLongitudinalAnalysis,
    });
    const findings = evaluateSafety(result.content);
    const blocked = safetyBlocks(findings);

    return this.database.transaction(async (client) => {
      const locked = (await client.query<{ status: AiGenerationStatus }>(
        `SELECT status FROM ai_generations WHERE generation_id = $1 FOR UPDATE`,
        [input.generationId],
      )).rows[0];
      if (locked === undefined) return 'not_found';
      if (locked.status !== 'queued' && locked.status !== 'running') return 'terminal';

      await client.query(
        `INSERT INTO ai_candidates (generation_id, ordinal, content, blocked)
         VALUES ($1,1,$2::jsonb,$3)`,
        [input.generationId, JSON.stringify(result.content), blocked],
      );
      for (const finding of findings) {
        await this.recordSafety(client, input.generationId, finding, input.now);
      }
      await client.query(
        `INSERT INTO ai_usage
         (generation_id, model_id, organization_id, prompt_tokens, completion_tokens,
          latency_ms, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [input.generationId, work.modelId, work.organizationId, result.promptTokens,
          result.completionTokens, result.latencyMs, input.now],
      );
      if (blocked) {
        await client.query(
          `UPDATE ai_generations SET status = 'blocked', failure_code = 'safety_blocked',
             version = version + 1, updated_at = $2
           WHERE generation_id = $1`,
          [input.generationId, input.now],
        );
        return 'blocked';
      }
      const artifact = (await client.query<ArtifactRow>(
        `INSERT INTO ai_artifacts
         (generation_id, patient_profile_id, organization_id, artifact_type, version_no,
          risk_level, content, model_id, prompt_template_id)
         SELECT $1,$2,$3,$4,
           COALESCE(MAX(existing.version_no),0)+1,
           $5,$6::jsonb,$7,$8
         FROM ai_artifacts existing
         WHERE existing.patient_profile_id = $2 AND existing.artifact_type = $4
         RETURNING ${artifactProjection}`,
        [input.generationId, work.patientProfileId, work.organizationId, work.artifactType,
          result.riskLevel, JSON.stringify(result.content), work.modelId, work.promptTemplateId],
      )).rows[0]!;
      for (const citation of citations) {
        await client.query(
          `INSERT INTO ai_artifact_sources (artifact_id, chunk_id, rank, similarity)
           VALUES ($1,$2,$3,$4)`,
          [artifact.artifactId, citation.chunkId, citation.rank, citation.similarity],
        );
      }
      await client.query(
        `UPDATE ai_generations SET status = 'succeeded', version = version + 1, updated_at = $2
         WHERE generation_id = $1`,
        [input.generationId, input.now],
      );
      await this.publishArtifact(client, artifact, null, input.correlationId, input.now);
      return 'succeeded';
    });
  }

  async findAuthorizedArtifact(
    artifactId: string, profileId: string, reviewerMembershipId: string | null,
  ): Promise<AiArtifactRecord | undefined> {
    return (await this.database.query<ArtifactRow>(
      `SELECT ${artifactProjection} FROM ai_artifacts artifact
       WHERE artifact.artifact_id = $1 AND (
         artifact.patient_profile_id = $2
         OR ($3::uuid IS NOT NULL AND EXISTS (
           SELECT 1 FROM care_assignments assignment
           WHERE assignment.clinician_membership_id = $3::uuid
             AND assignment.patient_profile_id = artifact.patient_profile_id
             AND assignment.status = 'active'
         ))
       )`,
      [artifactId, profileId, reviewerMembershipId],
    )).rows[0];
  }

  /**
   * Resolves a generation to its completed artifact. Returns undefined while the
   * generation is still queued/running (no artifact row exists yet), so a client
   * can poll this method and distinguish "not ready" from "not found".
   */
  async findArtifactByGeneration(
    generationId: string, profileId: string, reviewerMembershipId: string | null,
  ): Promise<AiArtifactRecord | undefined> {
    return (await this.database.query<ArtifactRow>(
      `SELECT ${artifactProjection} FROM ai_artifacts
       WHERE generation_id = $1 AND (
         patient_profile_id = $2
         OR ($3::uuid IS NOT NULL AND EXISTS (
           SELECT 1 FROM care_assignments assignment
           WHERE assignment.clinician_membership_id = $3::uuid
             AND assignment.patient_profile_id = ai_artifacts.patient_profile_id
             AND assignment.status = 'active'
         ))
       )`,
      [generationId, profileId, reviewerMembershipId],
    )).rows[0];
  }

  /**
   * Records a doctor's immutable review verdict.
   *
   * Approving an artifact that replaces an earlier one supersedes the earlier
   * version in the same transaction, so exactly one approved version of an
   * artifact type is current at any time.
   */
  async review(input: {
    artifactId: string; decision: Extract<AiReviewStatus, 'approved' | 'rejected'>;
    rationaleCode: string; expectedVersion: number; reviewerMembershipId: string;
    actor: ClinicalActorContext; now: Date; correlationId: string;
  }): Promise<AiArtifactRecord | AiFailure> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const current = (await client.query<ArtifactRow>(
        `SELECT ${artifactProjection} FROM ai_artifacts WHERE artifact_id = $1 FOR UPDATE`,
        [input.artifactId],
      )).rows[0];
      if (current === undefined) return 'not_found';
      // Review authority requires an active care assignment, re-proved under lock:
      // holding the permission is not by itself a relationship with the patient.
      const assigned = await client.query(
        `SELECT assignment_id FROM care_assignments
         WHERE clinician_membership_id = $1 AND patient_profile_id = $2 AND status = 'active'
         ORDER BY assignment_id FOR SHARE`,
        [input.reviewerMembershipId, current.patientProfileId],
      );
      if (assigned.rows.length === 0) return 'not_reviewer';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      if (!aiReviewTransitionAllowed(current.reviewStatus, input.decision)) return 'invalid_transition';

      const updated = (await client.query<ArtifactRow>(
        `UPDATE ai_artifacts SET review_status = $2, version = version + 1, updated_at = $3
         WHERE artifact_id = $1 RETURNING ${artifactProjection}`,
        [input.artifactId, input.decision, input.now],
      )).rows[0]!;
      await client.query(
        `INSERT INTO ai_review_events
         (artifact_id, reviewer_membership_id, reviewer_profile_id, previous_status,
          decision, rationale_code, correlation_id, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [input.artifactId, input.reviewerMembershipId, input.actor.profileId,
          current.reviewStatus, input.decision, input.rationaleCode,
          input.correlationId, input.now],
      );
      if (input.decision === 'approved' && current.replacesArtifactId !== null) {
        const prior = (await client.query<ArtifactRow>(
          `SELECT ${artifactProjection} FROM ai_artifacts
           WHERE artifact_id = $1 AND review_status = 'approved' FOR UPDATE`,
          [current.replacesArtifactId],
        )).rows[0];
        if (prior !== undefined) {
          await client.query(
            `UPDATE ai_artifacts SET review_status = 'superseded',
               version = version + 1, updated_at = $2
             WHERE artifact_id = $1`,
            [prior.artifactId, input.now],
          );
          await client.query(
            `INSERT INTO ai_review_events
             (artifact_id, reviewer_membership_id, reviewer_profile_id, previous_status,
              decision, rationale_code, correlation_id, occurred_at)
             VALUES ($1,$2,$3,'approved','superseded','replaced_by_new_version',$4,$5)`,
            [prior.artifactId, input.reviewerMembershipId, input.actor.profileId,
              input.correlationId, input.now],
          );
        }
      }
      await this.audit(client, updated, input.actor.profileId,
        `ai_artifact.${input.decision}`, input.rationaleCode, input.correlationId, input.now);
      await this.publishArtifact(client, updated, current.reviewStatus, input.correlationId, input.now);
      return updated;
    });
  }

  private async recordSafety(
    client: PoolClient, generationId: string, finding: SafetyFinding, now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ai_safety_events
       (generation_id, severity, category_code, blocked, detail_code, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [generationId, finding.severity, finding.categoryCode, finding.blocked,
        finding.detailCode, now],
    );
  }

  private async publishArtifact(
    client: PoolClient, record: AiArtifactRecord, previous: AiReviewStatus | null,
    correlationId: string, now: Date,
  ): Promise<void> {
    // Minimum data only: no content, no summary text and no confidence. A
    // subscriber refetches through an authorized read.
    await client.query(
      `INSERT INTO outbox_events
       (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
        payload,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,'ai_artifact',$3,$4,$5::jsonb,$6,$7)`,
      [AI_ARTIFACT_CHANGED_EVENT_TYPE, AI_ARTIFACT_CHANGED_EVENT_VERSION,
        record.artifactId, record.version, JSON.stringify({
          artifact_id: record.artifactId,
          patient_profile_id: record.patientProfileId,
          artifact_type: record.artifactType,
          previous_review_status: previous,
          review_status: record.reviewStatus,
        }), correlationId, now],
    );
  }

  private async audit(
    client: PoolClient, record: AiArtifactRecord, actorProfileId: string,
    action: string, reason: string, correlationId: string, now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id,organization_id,actor_profile_id,action,object_type,object_id,
        reason,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,$3,'ai_artifact',$4,$5,$6,$7)`,
      [record.organizationId, actorProfileId, action, record.artifactId, reason,
        correlationId, now],
    );
  }
}
