import { Injectable } from '@nestjs/common';
import {
  AiRepository,
  serializeAiArtifact,
} from '@smartcura/database/ai';
import type { ClinicalActorContext } from '@smartcura/database/consultations';
import type { ZodType } from 'zod';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  reviewAiArtifactSchema,
  submitAiTurnSchema,
} from './ai-request.schemas.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AiService {
  constructor(private readonly ai: AiRepository) {}

  async startConversation(current: AuthenticatedSession) {
    const active = this.active(current);
    const actor = this.actor(current, 'patient', 'ai.conversation:manage:own');
    const result = await this.ai.startConversation({
      organizationId: active.organizationId, actor,
      now: new Date(), correlationId: correlationId(),
    });
    if (typeof result === 'string') return this.failure(result);
    return { conversation_id: result.conversationId, status: result.status };
  }

  /**
   * Accepts a patient turn and returns the QUEUED generation.
   *
   * No model output is returned synchronously, because the provider call happens
   * after commit. A client polls the artifact, which also means a slow or failing
   * provider cannot hold an HTTP request or a database lock open.
   */
  async submitTurn(current: AuthenticatedSession, conversationIdValue: string, value: unknown) {
    const request = parse(submitAiTurnSchema, value);
    const actor = this.actor(current, 'patient', 'ai.generation:create:own');
    const result = await this.ai.submitTurn({
      conversationId: id(conversationIdValue),
      content: request.content,
      clientCorrelationId: request.client_correlation_id,
      artifactType: request.artifact_type,
      actor, now: new Date(), correlationId: correlationId(),
    });
    if (typeof result === 'string') return this.failure(result);
    return {
      generation_id: result.generationId,
      sequence_no: result.sequenceNo,
      status: 'queued',
    };
  }

  async getArtifact(current: AuthenticatedSession, artifactIdValue: string) {
    const active = this.active(current);
    const permission = active.roleId === 'patient'
      ? 'ai.artifact:read:own' : 'ai.artifact:read:assigned';
    this.requirePermission(active.permissions, permission);
    const record = await this.ai.findAuthorizedArtifact(
      id(artifactIdValue), current.aggregate.profile.profileId,
      active.roleId === 'doctor' ? active.membershipId : null,
    );
    // Concealed as absent: whether an AI artifact exists for another patient is
    // itself sensitive, so denial and absence are indistinguishable.
    if (record === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Artifact was not found');
    return serializeAiArtifact(record);
  }

  /**
   * Resolves a generation_id to its completed artifact. Returns 404 while the
   * generation is still queued/running, so a client can poll until the artifact
   * is ready.
   */
  async getArtifactByGeneration(current: AuthenticatedSession, generationIdValue: string) {
    const active = this.active(current);
    const permission = active.roleId === 'patient'
      ? 'ai.artifact:read:own' : 'ai.artifact:read:assigned';
    this.requirePermission(active.permissions, permission);
    const record = await this.ai.findArtifactByGeneration(
      id(generationIdValue), current.aggregate.profile.profileId,
      active.roleId === 'doctor' ? active.membershipId : null,
    );
    if (record === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Artifact was not found');
    return serializeAiArtifact(record);
  }

  async review(current: AuthenticatedSession, artifactIdValue: string, value: unknown) {
    const request = parse(reviewAiArtifactSchema, value);
    const active = this.active(current);
    const actor = this.actor(current, 'doctor', 'ai.artifact:review:assigned');
    const result = await this.ai.review({
      artifactId: id(artifactIdValue),
      decision: request.decision,
      rationaleCode: request.rationale_code,
      expectedVersion: request.expected_version,
      reviewerMembershipId: active.membershipId,
      actor, now: new Date(), correlationId: correlationId(),
    });
    if (typeof result === 'string') return this.failure(result);
    return serializeAiArtifact(result);
  }

  private active(current: AuthenticatedSession) {
    const active = current.aggregate.memberships.find(
      (entry) => entry.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined || active.status !== 'active') {
      throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    if (current.aggregate.profile.status !== 'active' ||
        current.aggregate.profile.onboardingCompletedAt === null) {
      throw problem(403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete');
    }
    return active;
  }

  private requirePermission(permissions: readonly string[], permission: string) {
    if (!permissions.includes(permission)) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
  }

  private actor(
    current: AuthenticatedSession, roleId: 'patient' | 'doctor', permission: string,
  ): ClinicalActorContext {
    const active = this.active(current);
    if (active.roleId !== roleId) throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    this.requirePermission(active.permissions, permission);
    return {
      sessionId: current.aggregate.session.sessionId,
      tokenHash: current.tokenHash,
      profileId: current.aggregate.profile.profileId,
      membershipId: active.membershipId,
      roleId,
      requiredPermission: permission,
    };
  }

  private failure(value: string): never {
    if (value === 'not_found' || value === 'not_owner' || value === 'not_reviewer') {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Artifact was not found');
    }
    if (value === 'actor_session_invalid') {
      throw problem(401, 'APP_SESSION_INVALID', 'Application session is invalid');
    }
    if (value === 'actor_permission_denied') {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    if (value === 'actor_step_up_required') {
      throw problem(403, 'STEP_UP_REQUIRED', 'Fresh authentication is required');
    }
    if (value === 'version_conflict') {
      throw problem(409, 'AI_ARTIFACT_VERSION_CONFLICT', 'The artifact changed');
    }
    if (value === 'conversation_closed') {
      throw problem(409, 'AI_CONVERSATION_CLOSED', 'The conversation is closed');
    }
    if (value === 'model_unavailable') {
      throw problem(503, 'AI_MODEL_UNAVAILABLE', 'No governed model or prompt template is available');
    }
    throw problem(409, 'AI_REVIEW_TRANSITION_INVALID', 'Review transition is not allowed');
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function id(value: string): string {
  if (!UUID_V7.test(value)) throw validationFailed();
  return value;
}
