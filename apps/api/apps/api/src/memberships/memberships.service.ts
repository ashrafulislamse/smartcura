import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  MembershipRepository,
  type ActorAuthorizationContext,
  type CreateMembershipResult,
  type MembershipAdministrationRecord,
} from '@smartcura/database';
import { evaluatePermission } from '@smartcura/policy';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  createMembershipInvitationSchema,
  createSelfMembershipSchema,
  idempotencyKeySchema,
  listMembershipsQuerySchema,
  membershipPathSchema,
  transitionMembershipSchema,
  type ListMembershipsQuery,
  type TransitionMembershipRequest,
} from './membership-request.schemas.js';

/** Replay window for a membership `Idempotency-Key`. */
const IDEMPOTENCY_TTL_MS = 86_400_000;

/**
 * Permission a membership administrator must hold for an action. A super
 * administrator acts globally; an organization administrator is confined to the
 * organization their membership belongs to.
 */
function requiredMembershipPermission(
  roleId: string,
  action: 'read' | 'invite' | 'transition',
): string {
  return roleId === 'super_admin'
    ? `membership:${action}:global`
    : `membership:${action}:organization`;
}

/**
 * Describes the actor so the repository can re-prove authority under lock in the
 * same transaction as the write. The HTTP guards already checked these
 * conditions, but that check is only a fast rejection: between the guard and the
 * write the session can be revoked, the administrative membership suspended, or
 * the step-up can expire.
 */
function administrativeActor(
  authorized: AuthenticatedSession,
  actorRoleId: string,
  action: 'invite' | 'transition',
): ActorAuthorizationContext {
  const active = activeMembership(authorized);
  if (active === undefined) throw new Error('Authorized membership context is missing');
  return {
    kind: 'administrative',
    sessionId: authorized.aggregate.session.sessionId,
    tokenHash: authorized.tokenHash,
    membershipId: active.membershipId,
    requiredPermission: requiredMembershipPermission(actorRoleId, action),
    requireStepUp: true,
  };
}

@Injectable()
export class MembershipsService {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  async list(
    current: AuthenticatedSession,
    organizationIdValue: string,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parsePath({ organizationId: organizationIdValue }).organizationId;
    const query = parseListQuery(queryValue);
    const authorized = await this.authorize(current, organizationId, 'read', null);
    const actor = activeMembership(authorized);
    if (actor === undefined) throw new Error('Authorized membership context is missing');
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const records = await this.memberships.list({
      organizationId,
      ...(cursor === undefined ? {} : {
        afterCreatedAt: cursor.createdAt,
        afterMembershipId: cursor.membershipId,
      }),
      includeSuperAdmin: actor.roleId === 'super_admin',
      limit: query.page_size + 1,
    });
    const hasMore = records.length > query.page_size;
    const page = hasMore ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return {
      data: page.map(membershipResponse),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeCursor(last) : null,
      },
    };
  }

  async createSelf(
    current: AuthenticatedSession,
    organizationIdValue: string,
    idempotencyKeyValue: string | undefined,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parsePath({ organizationId: organizationIdValue }).organizationId;
    const idempotencyKey = parseIdempotencyKey(idempotencyKeyValue);
    const request = parseCreateSelf(bodyValue);
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, organizationId, null, 'membership.self.create',
        403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete',
      );
    }
    const authorized = await this.authorization.touch(current);
    const professional = request.role !== 'patient';
    const result = await this.memberships.create({
      organizationId,
      targetProfileId: authorized.aggregate.profile.profileId,
      actorProfileId: authorized.aggregate.profile.profileId,
      roleId: request.role,
      status: professional ? 'applied' : 'active',
      verificationStatus: professional ? 'not_submitted' : null,
      siteIds: request.site_ids,
      operationId: 'membership.self.create',
      action: professional ? 'membership.applied' : 'membership.enrolled',
      idempotencyKey,
      requestHash: creationHash({ organizationId, profileId: authorized.aggregate.profile.profileId, ...request }),
      idempotencyTtlMs: IDEMPOTENCY_TTL_MS,
      // Re-proved under lock inside the write transaction, not trusted from here.
      actor: {
        kind: 'self',
        sessionId: authorized.aggregate.session.sessionId,
        tokenHash: authorized.tokenHash,
      },
      now: new Date(),
      correlationId: correlationId(),
    });
    return this.creationResult(authorized, organizationId, 'membership.self.create', result);
  }

  async createInvitation(
    current: AuthenticatedSession,
    organizationIdValue: string,
    idempotencyKeyValue: string | undefined,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parsePath({ organizationId: organizationIdValue }).organizationId;
    const idempotencyKey = parseIdempotencyKey(idempotencyKeyValue);
    const request = parseCreateInvitation(bodyValue);
    const authorized = await this.authorize(current, organizationId, 'invite', null);
    const active = activeMembership(authorized);
    if (active === undefined) throw new Error('Authorized membership context is missing');
    if (
      authorized.aggregate.session.stepUpValidUntil === null ||
      authorized.aggregate.session.stepUpValidUntil <= new Date()
    ) {
      return this.deny(
        authorized, organizationId, null, 'membership.invitation.create',
        403, 'STEP_UP_REQUIRED', 'A current MFA step-up is required',
      );
    }
    if (request.role === 'admin' && active.roleId !== 'super_admin') {
      return this.deny(
        authorized, organizationId, null, 'membership.invitation.create',
        403, 'PERMISSION_DENIED', 'Only a platform administrator may invite an administrator',
      );
    }
    const professional = requiresVerification(request.role);
    const result = await this.memberships.create({
      organizationId,
      targetProfileId: request.profile_id,
      actorProfileId: authorized.aggregate.profile.profileId,
      roleId: request.role,
      status: 'invited',
      verificationStatus: professional ? 'not_submitted' : null,
      siteIds: request.site_ids,
      operationId: 'membership.invitation.create',
      action: 'membership.invited',
      idempotencyKey,
      requestHash: creationHash({ organizationId, ...request }),
      idempotencyTtlMs: IDEMPOTENCY_TTL_MS,
      actor: administrativeActor(authorized, active.roleId, 'invite'),
      now: new Date(),
      correlationId: correlationId(),
    });
    return this.creationResult(authorized, organizationId, 'membership.invitation.create', result);
  }

  async transition(
    current: AuthenticatedSession,
    organizationIdValue: string,
    membershipIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const path = parsePath({
      organizationId: organizationIdValue,
      membershipId: membershipIdValue,
    });
    const request = parseTransition(bodyValue);
    const authorized = await this.authorize(
      current,
      path.organizationId,
      'transition',
      path.membershipId!,
    );
    const active = activeMembership(authorized);
    if (active === undefined) throw new Error('Authorized membership context is missing');
    if (
      authorized.aggregate.session.stepUpValidUntil === null ||
      authorized.aggregate.session.stepUpValidUntil <= new Date()
    ) {
      return this.deny(
        authorized, path.organizationId, path.membershipId!,
        'membership.transition', 403, 'STEP_UP_REQUIRED',
        'A current MFA step-up is required',
      );
    }
    const result = await this.memberships.transition({
      organizationId: path.organizationId,
      membershipId: path.membershipId!,
      actorProfileId: authorized.aggregate.profile.profileId,
      actorRoleId: active.roleId as 'admin' | 'super_admin',
      actor: administrativeActor(authorized, active.roleId, 'transition'),
      nextStatus: request.status,
      expectedVersion: request.expected_version,
      reasonCode: request.reason_code,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') return membershipResponse(result);
    return this.transitionFailure(authorized, path.organizationId, path.membershipId!, result);
  }

  private async creationResult(
    current: AuthenticatedSession,
    organizationId: string,
    action: string,
    result: CreateMembershipResult,
  ): Promise<Record<string, unknown>> {
    if (typeof result !== 'string') {
      // A replay returns the response stored with the original request, so the
      // client observes the same body even if the membership changed since.
      return result.replayed ? result.snapshot.body : membershipResponse(result.record);
    }
    switch (result) {
      case 'actor_session_invalid':
        return this.deny(
          current, organizationId, null, action,
          401, 'APP_SESSION_INVALID', 'The session is no longer valid',
        );
      case 'actor_permission_denied':
        return this.deny(
          current, organizationId, null, action,
          403, 'PERMISSION_DENIED', 'Membership administration is not permitted',
        );
      case 'actor_step_up_required':
        return this.deny(
          current, organizationId, null, action,
          403, 'STEP_UP_REQUIRED', 'A current MFA step-up is required',
        );
      case 'organization_not_found':
        return this.deny(
          current, organizationId, null, action,
          404, 'RESOURCE_NOT_FOUND', 'Organization was not found',
        );
      case 'profile_not_eligible':
        return this.deny(
          current, organizationId, null, action,
          action === 'membership.self.create' ? 403 : 404,
          action === 'membership.self.create' ? 'PERMISSION_DENIED' : 'RESOURCE_NOT_FOUND',
          action === 'membership.self.create'
            ? 'Profile onboarding is incomplete'
            : 'Target profile was not found',
        );
      case 'sites_invalid':
        return this.deny(
          current, organizationId, null, action,
          422, 'VALIDATION_FAILED', 'One or more sites are invalid for the organization',
        );
      case 'already_exists':
        return this.deny(
          current, organizationId, null, action,
          409, 'MEMBERSHIP_ALREADY_EXISTS', 'Membership already exists',
        );
      case 'idempotency_reused':
        return this.deny(
          current, organizationId, null, action,
          409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused',
        );
    }
  }

  private async authorize(
    current: AuthenticatedSession,
    organizationId: string,
    action: 'read' | 'invite' | 'transition',
    membershipId: string | null,
  ): Promise<AuthenticatedSession> {
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, organizationId, membershipId, `membership.${action}`,
        403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete',
      );
    }
    const active = activeMembership(current);
    if (active === undefined || (active.roleId !== 'admin' && active.roleId !== 'super_admin')) {
      return this.deny(
        current, organizationId, membershipId, `membership.${action}`,
        403, 'PERMISSION_DENIED', 'Membership administration is not permitted',
      );
    }
    const requiredPermission = active.roleId === 'super_admin'
      ? `membership:${action}:global`
      : `membership:${action}:organization`;
    const decision = evaluatePermission(active.permissions, requiredPermission, {
      actorProfileId: current.aggregate.profile.profileId,
      membershipOrganizationId: active.organizationId,
      resourceOrganizationId: organizationId,
      globalAllowed: active.roleId === 'super_admin',
    });
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      return this.deny(
        current, organizationId, membershipId, `membership.${action}`,
        403, code, 'Membership administration is not permitted',
      );
    }
    return this.authorization.touch(current);
  }

  private async transitionFailure(
    current: AuthenticatedSession,
    organizationId: string,
    membershipId: string,
    result: Exclude<Awaited<ReturnType<MembershipRepository['transition']>>, MembershipAdministrationRecord>,
  ): Promise<never> {
    switch (result) {
      case 'not_found':
        return this.deny(
          current, organizationId, membershipId, 'membership.transition',
          404, 'RESOURCE_NOT_FOUND', 'Membership was not found',
        );
      case 'version_conflict':
        return this.deny(
          current, organizationId, membershipId, 'membership.transition',
          409, 'MEMBERSHIP_VERSION_CONFLICT', 'Membership version is stale',
        );
      case 'transition_invalid':
        return this.deny(
          current, organizationId, membershipId, 'membership.transition',
          409, 'MEMBERSHIP_TRANSITION_INVALID', 'Membership transition is invalid',
        );
      case 'self_modification_denied':
        return this.deny(
          current, organizationId, membershipId, 'membership.transition',
          403, 'MEMBERSHIP_SELF_MODIFICATION_DENIED', 'Self-modification is not permitted',
        );
      case 'last_admin_required':
        return this.deny(
          current, organizationId, membershipId, 'membership.transition',
          409, 'LAST_ADMIN_REQUIRED', 'At least one active administrator is required',
        );
      case 'reactivation_blocked':
        return this.deny(
          current, organizationId, membershipId, 'membership.transition',
          409, 'MEMBERSHIP_TRANSITION_INVALID', 'Membership cannot be reactivated',
        );
      case 'actor_session_invalid':
        return this.deny(
          current, organizationId, membershipId, 'membership.transition',
          401, 'APP_SESSION_INVALID', 'The session is no longer valid',
        );
      case 'actor_permission_denied':
        return this.deny(
          current, organizationId, membershipId, 'membership.transition',
          403, 'PERMISSION_DENIED', 'Membership administration is not permitted',
        );
      case 'actor_step_up_required':
        return this.deny(
          current, organizationId, membershipId, 'membership.transition',
          403, 'STEP_UP_REQUIRED', 'A current MFA step-up is required',
        );
    }
  }
  private async deny(
    current: AuthenticatedSession,
    organizationId: string,
    membershipId: string | null,
    action: string,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    const requestCorrelationId = correlationId();
    await this.memberships.recordDenial(
      organizationId,
      membershipId,
      current.aggregate.profile.profileId,
      action,
      code,
      requestCorrelationId,
    );
    throw problem(status, code, title, requestCorrelationId);
  }
}

function activeMembership(current: AuthenticatedSession) {
  return current.aggregate.memberships.find(
    (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
  );
}

function membershipResponse(record: MembershipAdministrationRecord): Record<string, unknown> {
  return {
    id: record.membershipId,
    profile_id: record.profileId,
    organization_id: record.organizationId,
    role: record.roleId,
    status: record.status,
    verification_status: record.verificationStatus,
    site_ids: record.siteIds,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function parsePath(value: unknown) {
  const result = membershipPathSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseListQuery(value: unknown): ListMembershipsQuery {
  const result = listMembershipsQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseTransition(value: unknown): TransitionMembershipRequest {
  const result = transitionMembershipSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseIdempotencyKey(value: unknown): string {
  const result = idempotencyKeySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseCreateSelf(value: unknown) {
  const result = createSelfMembershipSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseCreateInvitation(value: unknown) {
  const result = createMembershipInvitationSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function creationHash(value: Record<string, unknown>): string {
  const siteIds = Array.isArray(value['site_ids'])
    ? [...value['site_ids']].sort()
    : [];
  return createHash('sha256').update(JSON.stringify({ ...value, site_ids: siteIds })).digest('hex');
}

function requiresVerification(role: string): boolean {
  return role === 'doctor' || role === 'driver' || role === 'pharmacy' || role === 'emergency';
}

interface MembershipCursor {
  readonly createdAt: Date;
  readonly membershipId: string;
}
function encodeCursor(record: MembershipAdministrationRecord): string {
  return Buffer.from(JSON.stringify({
    created_at: record.createdAt.toISOString(),
    membership_id: record.membershipId,
  }), 'utf8').toString('base64url');
}

function decodeCursor(value: string): MembershipCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (typeof decoded !== 'object' || decoded === null) throw new Error();
    const candidate = decoded as Record<string, unknown>;
    const createdAtValue = candidate['created_at'];
    const membershipId = candidate['membership_id'];
    if (typeof createdAtValue !== 'string' || typeof membershipId !== 'string') throw new Error();
    const createdAt = new Date(createdAtValue);
    if (!Number.isFinite(createdAt.getTime())) throw new Error();
    const path = parsePath({
      organizationId: '00000000-0000-7000-8000-000000000000',
      membershipId,
    });
    return { createdAt, membershipId: path.membershipId! };
  } catch {
    throw validationFailed();
  }
}
