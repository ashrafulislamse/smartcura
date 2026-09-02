import { Inject, Injectable } from '@nestjs/common';
import {
  SessionRepository,
  type RoleId,
  type SessionAggregate,
  type SessionRotationInput,
} from '@smartcura/database';
import {
  IdentityTokenVerificationError,
  type IdentityTokenVerifier,
  type VerifiedIdentity,
} from '@smartcura/identity';
import { createUuidV7 } from '@smartcura/observability';
import type { ApiConfig } from '../config.js';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { correlationId, problem, sessionInvalid } from '../platform/problems.js';
import { API_CONFIG, IDENTITY_TOKEN_VERIFIER } from '../tokens.js';
import {
  createSessionSchema,
  selectActiveRoleSchema,
  stepUpSchema,
} from './session-request.schemas.js';
import {
  createOpaqueSecret,
  deriveCsrfToken,
  extractBearer,
  hashSecret,
  sessionCookie,
} from './session-security.js';

export interface SessionCommandResult {
  readonly body: Record<string, unknown>;
  readonly setCookie?: string;
}

@Injectable()
export class SessionsService {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(IDENTITY_TOKEN_VERIFIER) private readonly identityVerifier: IdentityTokenVerifier,
    private readonly sessions: SessionRepository,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  async create(authorization: string | undefined, value: unknown): Promise<SessionCommandResult> {
    const request = parse(createSessionSchema, value);
    const identity = await this.verifyIdentity(authorization);
    const now = new Date();
    const secrets = nextSecrets(this.config.csrfSecret);
    const recentAuthentication = now.getTime() - identity.authTime.getTime() <= 300_000;
    const aggregate = await this.sessions.create({
      sessionId: createUuidV7(),
      firebaseUid: identity.uid,
      email: identity.email,
      displayName: displayNameFromEmail(identity.email),
      requestedRole: request.requested_role ?? null,
      clientType: request.client_type,
      deviceName: request.device_name,
      tokenHash: secrets.tokenHash,
      csrfHash: secrets.csrfHash,
      stepUpValidUntil: identity.mfaSatisfied && recentAuthentication
        ? new Date(now.getTime() + 300_000)
        : null,
      now,
      correlationId: correlationId(),
    });
    if (aggregate === 'profile_blocked') throw sessionInvalid();
    return {
      body: bootstrapResponse(aggregate, secrets.csrf, now),
      setCookie: sessionCookie(secrets.token),
    };
  }

  async current(current: AuthenticatedSession): Promise<SessionCommandResult> {
    const touched = await this.authorization.touch(current);
    const csrf = deriveCsrfToken(touched.token, this.config.csrfSecret);
    return { body: bootstrapResponse(touched.aggregate, csrf, new Date()) };
  }

  async refresh(
    authorization: string | undefined,
    current: AuthenticatedSession,
  ): Promise<SessionCommandResult> {
    const identity = await this.verifyIdentity(authorization);
    if (identity.uid !== current.aggregate.profile.firebaseUid) {
      await this.deny(current, 'session.refresh', 401, 'AUTH_TOKEN_INVALID', 'Identity does not match session');
    }
    const secrets = nextSecrets(this.config.csrfSecret);
    const aggregate = await this.sessions.refresh(rotationInput(current, secrets, new Date()));
    if (aggregate === undefined) throw sessionInvalid();
    return {
      body: bootstrapResponse(aggregate, secrets.csrf, new Date()),
      setCookie: sessionCookie(secrets.token),
    };
  }

  async stepUp(
    authorization: string | undefined,
    current: AuthenticatedSession,
    value: unknown,
  ): Promise<SessionCommandResult> {
    const request = parse(stepUpSchema, value);
    const identity = await this.verifyIdentity(authorization);
    if (identity.uid !== current.aggregate.profile.firebaseUid) {
      await this.deny(current, 'session.step_up', 401, 'AUTH_TOKEN_INVALID', 'Identity does not match session');
    }
    const now = new Date();
    if (now.getTime() - identity.authTime.getTime() > 300_000 || !identity.mfaSatisfied) {
      await this.deny(
        current,
        'session.step_up',
        403,
        'STEP_UP_REQUIRED',
        'Recent reauthentication with MFA is required',
      );
    }
    const secrets = nextSecrets(this.config.csrfSecret);
    const validUntil = new Date(now.getTime() + 300_000);
    const aggregate = await this.sessions.stepUp(
      rotationInput(current, secrets, now),
      validUntil,
      request.reason,
    );
    if (aggregate === undefined) throw sessionInvalid();
    return {
      body: {
        session_id: aggregate.session.sessionId,
        valid_until: validUntil.toISOString(),
        csrf_token: secrets.csrf,
      },
      setCookie: sessionCookie(secrets.token),
    };
  }

  async selectActiveRole(
    current: AuthenticatedSession,
    value: unknown,
  ): Promise<SessionCommandResult> {
    const request = parse(selectActiveRoleSchema, value);
    const now = new Date();
    const target = current.aggregate.memberships.find(
      (membership) => membership.membershipId === request.membership_id,
    );
    if (
      target === undefined || target.status !== 'active' ||
      (requiresVerification(target.roleId) && target.verificationStatus !== 'approved')
    ) {
      return this.deny(
        current,
        'session.active_role.select',
        403,
        'MEMBERSHIP_INACTIVE',
        'The selected membership is not eligible',
      );
    }
    const requiresStepUp = current.aggregate.session.activeMembershipId !== null ||
      requiresTotp(target.roleId);
    if (
      requiresStepUp &&
      (current.aggregate.session.stepUpValidUntil === null || current.aggregate.session.stepUpValidUntil <= now)
    ) {
      return this.deny(
        current,
        'session.active_role.select',
        403,
        'STEP_UP_REQUIRED',
        'Role switching requires recent step-up',
      );
    }
    const secrets = nextSecrets(this.config.csrfSecret);
    const aggregate = await this.sessions.selectMembership(
      rotationInput(current, secrets, now),
      request.membership_id,
    );
    if (aggregate === 'membership_inactive') {
      return this.deny(
        current,
        'session.active_role.select',
        403,
        'MEMBERSHIP_INACTIVE',
        'The selected membership is not active',
      );
    }
    if (aggregate === undefined) throw sessionInvalid();
    return {
      body: bootstrapResponse(aggregate, secrets.csrf, now),
      setCookie: sessionCookie(secrets.token),
    };
  }

  async revoke(current: AuthenticatedSession): Promise<void> {
    const revoked = await this.sessions.revoke(
      current.aggregate.session.sessionId,
      current.tokenHash,
      current.aggregate.session.csrfHash,
      new Date(),
      correlationId(),
    );
    if (!revoked) throw sessionInvalid();
  }

  private async deny(
    current: AuthenticatedSession,
    action: string,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    return this.authorization.deny(current, action, status, code, title);
  }

  private async verifyIdentity(authorization: string | undefined): Promise<VerifiedIdentity> {
    const token = extractBearer(authorization);
    if (token === undefined) throw authInvalid();
    try {
      const identity = await this.identityVerifier.verify(token);
      // SECURITY: For the FYP demo we accept Firebase email/password tokens
      // regardless of emailVerified status. New accounts are unverified by
      // default, and the demo app does not send verification emails. Re-enable
      // this check and add email verification flow before production hardening.
      // if (!identity.emailVerified) throw new IdentityTokenVerificationError();
      return identity;
    } catch (error) {
      if (error instanceof IdentityTokenVerificationError) throw authInvalid();
      throw error;
    }
  }
}

interface GeneratedSecrets {
  readonly token: string;
  readonly tokenHash: string;
  readonly csrf: string;
  readonly csrfHash: string;
}

function nextSecrets(csrfSecret: string): GeneratedSecrets {
  const token = createOpaqueSecret();
  const csrf = deriveCsrfToken(token, csrfSecret);
  return { token, tokenHash: hashSecret(token), csrf, csrfHash: hashSecret(csrf) };
}

function rotationInput(
  current: AuthenticatedSession,
  secrets: GeneratedSecrets,
  now: Date,
): SessionRotationInput {
  return {
    sessionId: current.aggregate.session.sessionId,
    currentTokenHash: current.tokenHash,
    currentCsrfHash: current.aggregate.session.csrfHash,
    nextTokenHash: secrets.tokenHash,
    nextCsrfHash: secrets.csrfHash,
    now,
    correlationId: correlationId(),
  };
}

function bootstrapResponse(
  aggregate: SessionAggregate,
  csrf: string,
  now: Date,
): Record<string, unknown> {
  return {
    bootstrap_state: bootstrapState(aggregate, now),
    csrf_token: csrf,
    profile: {
      id: aggregate.profile.profileId,
      status: aggregate.profile.status,
      display_name: aggregate.profile.displayName,
      email: aggregate.profile.email,
      phone_e164: aggregate.profile.phoneE164,
      preferred_locale: aggregate.profile.preferredLocale,
      timezone: aggregate.profile.timezone,
      onboarding_completed_at: aggregate.profile.onboardingCompletedAt?.toISOString() ?? null,
      created_at: aggregate.profile.createdAt.toISOString(),
      updated_at: aggregate.profile.updatedAt.toISOString(),
    },
    memberships: aggregate.memberships.map((membership) => ({
      id: membership.membershipId,
      organization_id: membership.organizationId,
      site_ids: membership.siteIds,
      role: membership.roleId,
      status: membership.status,
      verification_status: membership.verificationStatus,
      permissions: [...new Set(membership.permissions)].sort(),
    })),
    session: {
      id: aggregate.session.sessionId,
      status: aggregate.session.status,
      profile_id: aggregate.session.profileId,
      active_role: aggregate.session.activeRole,
      created_at: aggregate.session.createdAt.toISOString(),
      last_activity_at: aggregate.session.lastActivityAt.toISOString(),
      idle_expires_at: aggregate.session.idleExpiresAt.toISOString(),
      absolute_expires_at: aggregate.session.absoluteExpiresAt.toISOString(),
      step_up_valid_until: aggregate.session.stepUpValidUntil?.toISOString() ?? null,
    },
  };
}

function bootstrapState(
  aggregate: SessionAggregate,
  now: Date,
): 'profile_required' | 'verification_pending' | 'role_selection_required' | 'ready' {
  if (
    aggregate.profile.status !== 'active' ||
    aggregate.profile.onboardingCompletedAt === null
  ) return 'profile_required';
  const eligible = aggregate.memberships.filter(
    (membership) => membership.status === 'active' &&
      (!requiresVerification(membership.roleId) || membership.verificationStatus === 'approved'),
  );
  const selected = eligible.find(
    (membership) => membership.membershipId === aggregate.session.activeMembershipId,
  );
  if (selected === undefined) {
    const hasCurrentStepUp = aggregate.session.stepUpValidUntil !== null &&
      aggregate.session.stepUpValidUntil > now;
    const selectable = eligible.filter(
      (membership) => !requiresTotp(membership.roleId) || hasCurrentStepUp,
    );
    if (selectable.length > 0) return 'role_selection_required';
    return 'verification_pending';
  }
  if (
    requiresTotp(selected.roleId) &&
    (aggregate.session.stepUpValidUntil === null || aggregate.session.stepUpValidUntil <= now)
  ) {
    return 'verification_pending';
  }
  return 'ready';
}

function requiresVerification(role: RoleId): boolean {
  return role === 'doctor' || role === 'driver' || role === 'pharmacy' || role === 'emergency';
}

function requiresTotp(role: RoleId): boolean {
  // TOTP/MFA step-up is optional for the FYP demo. All roles can be
  // activated without MFA. The admin portal may optionally enforce TOTP
  // per-role from the UI in future. Restore the original role list before
  // production hardening:
  //   role === 'doctor' || role === 'pharmacy' || role === 'emergency' ||
  //   role === 'admin' || role === 'super_admin';
  return false;
}

function displayNameFromEmail(email: string): string {
  const candidate = email.split('@', 1)[0]?.trim() || 'Profile';
  return candidate.slice(0, 120);
}

function parse<Output>(
  schema: { safeParse(value: unknown): { success: true; data: Output } | { success: false } },
  value: unknown,
): Output {
  const result = schema.safeParse(value);
  if (!result.success) throw problem(422, 'VALIDATION_FAILED', 'Request validation failed');
  return result.data;
}

function authInvalid() {
  return problem(401, 'AUTH_TOKEN_INVALID', 'Identity token is invalid');
}
