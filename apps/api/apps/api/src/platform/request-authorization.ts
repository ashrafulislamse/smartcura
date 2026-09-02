import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SessionRepository,
  type SessionAggregate,
} from '@smartcura/database';
import { evaluatePermission } from '@smartcura/policy';
import type { ApiConfig } from '../config.js';
import { extractSessionCookie, hashSecret, secretMatchesHash } from '../sessions/session-security.js';
import { API_CONFIG } from '../tokens.js';
import { correlationId, problem, sessionInvalid } from './problems.js';

const PUBLIC_ROUTE = 'smartcura:public-route';
const AUTHENTICATED_ONLY = 'smartcura:authenticated-only';
const CSRF_ACTION = 'smartcura:csrf-action';
const PERMISSION_REQUIREMENT = 'smartcura:permission-requirement';

export interface AuthenticatedSession {
  readonly token: string;
  readonly tokenHash: string;
  readonly aggregate: SessionAggregate;
}

interface RequestLike {
  readonly headers: Record<string, string | readonly string[] | undefined>;
  smartcuraSession?: AuthenticatedSession;
}

interface PermissionRequirement {
  readonly permission: string;
  readonly action: string;
  readonly allowDuringOnboarding: boolean;
  readonly allowWithoutActiveMembership: boolean;
}

export const PublicRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE, true);

export const AuthenticatedOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTHENTICATED_ONLY, true);

export const RequireCsrf = (action: string): MethodDecorator =>
  SetMetadata(CSRF_ACTION, action);

export function RequirePermission(
  permission: string,
  action: string,
  options: {
    readonly allowDuringOnboarding?: boolean;
    readonly allowWithoutActiveMembership?: boolean;
  } = {},
): MethodDecorator {
  const requirement: PermissionRequirement = Object.freeze({
    permission,
    action,
    allowDuringOnboarding: options.allowDuringOnboarding === true,
    allowWithoutActiveMembership: options.allowWithoutActiveMembership === true,
  });
  return SetMetadata(PERMISSION_REQUIREMENT, requirement);
}
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => {
    const current = context.switchToHttp().getRequest<RequestLike>().smartcuraSession;
    if (current === undefined) throw sessionInvalid();
    return current;
  },
);

@Injectable()
export class SessionAuthorizationService {
  constructor(private readonly sessions: SessionRepository) {}

  async authenticate(cookieHeader: string | undefined): Promise<AuthenticatedSession> {
    const token = extractSessionCookie(cookieHeader);
    if (token === undefined) throw sessionInvalid();
    const tokenHash = hashSecret(token);
    const aggregate = await this.sessions.getActiveByTokenHash(tokenHash, new Date(), false);
    if (aggregate === undefined) throw sessionInvalid();
    return Object.freeze({ token, tokenHash, aggregate });
  }

  async touch(current: AuthenticatedSession): Promise<AuthenticatedSession> {
    const aggregate = await this.sessions.getActiveByTokenHash(
      current.tokenHash,
      new Date(),
      true,
    );
    if (aggregate === undefined) throw sessionInvalid();
    return Object.freeze({ ...current, aggregate });
  }

  async requireCsrf(
    value: string | undefined,
    current: AuthenticatedSession,
    action: string,
  ): Promise<void> {
    if (
      value === undefined || value.length < 32 ||
      !secretMatchesHash(value, current.aggregate.session.csrfHash)
    ) {
      await this.deny(current, action, 403, 'PERMISSION_DENIED', 'CSRF validation failed');
    }
  }

  async authorize(
    current: AuthenticatedSession,
    requirement: PermissionRequirement,
  ): Promise<void> {
    if (
      current.aggregate.profile.status !== 'active' &&
      !requirement.allowDuringOnboarding
    ) {
      return this.deny(
        current, requirement.action, 403, 'PERMISSION_DENIED',
        'Profile onboarding is incomplete',
      );
    }
    const active = current.aggregate.memberships.find(
      (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined) {
      if (requirement.allowWithoutActiveMembership) return;
      return this.deny(
        current, requirement.action, 403, 'MEMBERSHIP_INACTIVE',
        'An active membership is required',
      );
    }
    if (active.status !== 'active') {
      await this.deny(
        current, requirement.action, 403, 'MEMBERSHIP_INACTIVE',
        'An active membership is required',
      );
    }
    const decision = evaluatePermission(active.permissions, requirement.permission, {
      actorProfileId: current.aggregate.profile.profileId,
      ownerProfileId: current.aggregate.profile.profileId,
    });
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      await this.deny(current, requirement.action, 403, code, 'Access is not permitted');
    }
  }
  async deny(
    current: AuthenticatedSession,
    action: string,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    const requestCorrelationId = correlationId();
    await this.sessions.recordDenial(current.aggregate, action, code, requestCorrelationId);
    throw problem(status, code, title, requestCorrelationId);
  }
}

@Injectable()
export class SessionAuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(), context.getClass(),
    ]) === true;
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<RequestLike>();
    request.smartcuraSession = await this.authorization.authenticate(header(request, 'cookie'));
    return true;
  }
}

@Injectable()
export class RequestIntegrityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: SessionAuthorizationService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<string>(CSRF_ACTION, [
      context.getHandler(), context.getClass(),
    ]);
    if (action === undefined) return true;
    const request = context.switchToHttp().getRequest<RequestLike>();
    const current = requireAttachedSession(request);
    const origin = header(request, 'origin');
    const browserRequest = header(request, 'sec-fetch-site') !== undefined ||
      header(request, 'sec-fetch-mode') !== undefined;
    if (
      (browserRequest && origin === undefined) ||
      (origin !== undefined && !this.config.allowedOrigins.includes(origin))
    ) {
      await this.authorization.deny(
        current, action, 403, 'PERMISSION_DENIED', 'Request origin is not allowed',
      );
    }
    await this.authorization.requireCsrf(header(request, 'x-csrf-token'), current, action);
    return true;
  }
}
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(), context.getClass(),
    ]) === true;
    if (isPublic) return true;
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY, [
      context.getHandler(), context.getClass(),
    ]) === true;
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSION_REQUIREMENT,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<RequestLike>();
    const current = requireAttachedSession(request);
    if (requirement === undefined) {
      if (authenticatedOnly) return true;
      return this.authorization.deny(
        current, 'route.authorization.missing', 403, 'PERMISSION_DENIED',
        'Route authorization policy is missing',
      );
    }
    await this.authorization.authorize(current, requirement);
    request.smartcuraSession = await this.authorization.touch(current);
    return true;
  }
}

function requireAttachedSession(request: RequestLike): AuthenticatedSession {
  if (request.smartcuraSession === undefined) throw sessionInvalid();
  return request.smartcuraSession;
}

function header(request: RequestLike, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : value?.[0];
}
