import { Injectable } from '@nestjs/common';
import {
  CareAccessRepository,
  serializeCareAssignment,
  serializeConsentGrant,
  type ActorAuthorizationContext,
  type CareAssignmentRecord,
  type CreateCareAssignmentResult,
  type CreateConsentGrantResult,
  type EndCareAssignmentResult,
  type RevokeConsentGrantResult,
} from '@smartcura/database';
import { evaluatePermission } from '@smartcura/policy';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  assignmentPathSchema,
  consentPathSchema,
  createCareAssignmentSchema,
  createConsentGrantSchema,
  endCareAssignmentSchema,
  listCareAssignmentsSchema,
  listConsentGrantsSchema,
  organizationPathSchema,
  revokeConsentGrantSchema,
  type ListCareAssignmentsQuery,
  type ListConsentGrantsQuery,
} from './care-access-request.schemas.js';

@Injectable()
export class CareAccessService {
  constructor(
    private readonly repository: CareAccessRepository,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  async listConsents(
    current: AuthenticatedSession, queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const query = parseListConsents(queryValue);
    const active = await this.authorizeOwn(current, 'consent.grant:read:own', 'consent.list');
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const records = await this.repository.listConsentGrants({
      grantorProfileId: current.aggregate.profile.profileId,
      ...(cursor === undefined ? {} : {
        beforeGrantedAt: cursor.instant, beforeConsentId: cursor.id,
      }),
      limit: query.page_size + 1,
    });
    return page(records, query.page_size, serializeConsentGrant, (record) => ({
      instant: record.grantedAt, id: record.consentId,
    }), active);
  }

  async createConsent(
    current: AuthenticatedSession, bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const request = createConsentGrantSchema.safeParse(bodyValue);
    if (!request.success) throw validationFailed();
    const active = await this.authorizeOwn(current, 'consent.grant:create:own', 'consent.create');
    const now = new Date();
    const expiresAt = request.data.expires_at === null ? null : new Date(request.data.expires_at);
    if (expiresAt !== null && expiresAt <= now) throw validationFailed();
    const result = await this.repository.createConsentGrant({
      organizationId: active.organizationId,
      grantorProfileId: current.aggregate.profile.profileId,
      actorMembershipId: active.membershipId,
      actor: selfActor(current),
      granteeProfileId: request.data.grantee_profile_id,
      granteeMembershipId: request.data.grantee_membership_id,
      scope: request.data.scope,
      purpose: request.data.purpose,
      expiresAt, now, correlationId: correlationId(),
    });
    if (typeof result !== 'string') return serializeConsentGrant(result, now);
    return this.createConsentFailure(current, active.organizationId, result);
  }

  async revokeConsent(
    current: AuthenticatedSession, consentIdValue: string, bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const consentId = parseId(consentPathSchema, { consentId: consentIdValue }, 'consentId');
    const request = revokeConsentGrantSchema.safeParse(bodyValue);
    if (!request.success) throw validationFailed();
    const active = await this.authorizeOwn(current, 'consent.grant:revoke:own', 'consent.revoke');
    const result = await this.repository.revokeConsentGrant({
      consentId, organizationId: active.organizationId,
      grantorProfileId: current.aggregate.profile.profileId,
      actorMembershipId: active.membershipId, actor: selfActor(current),
      expectedVersion: request.data.expected_version, reason: request.data.reason,
      now: new Date(), correlationId: correlationId(),
    });
    if (typeof result !== 'string') return serializeConsentGrant(result);
    return this.revokeConsentFailure(current, active.organizationId, consentId, result);
  }

  async listAssignments(
    current: AuthenticatedSession, queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const query = parseListAssignments(queryValue);
    const active = requireActive(current);
    const actorProfileId = current.aggregate.profile.profileId;
    let scope: Parameters<CareAccessRepository['listCareAssignments']>[0]['scope'];
    if (active.roleId === 'patient') {
      if (query.organization_id !== undefined) throw validationFailed();
      await this.authorize(current, 'care.assignment:read:own', 'care_assignment.list', {
        ownerProfileId: actorProfileId,
      });
      scope = { kind: 'patient', patientProfileId: actorProfileId };
    } else if (active.roleId === 'doctor') {
      if (query.organization_id !== undefined) throw validationFailed();
      await this.authorize(current, 'care.assignment:read:assigned', 'care_assignment.list', {
        assigned: true,
      });
      scope = { kind: 'clinician', clinicianMembershipId: active.membershipId };
    } else if (active.roleId === 'admin') {
      const organizationId = query.organization_id ?? active.organizationId;
      await this.authorize(current, 'care.assignment:read:organization', 'care_assignment.list', {
        resourceOrganizationId: organizationId,
        membershipOrganizationId: active.organizationId,
      });
      scope = { kind: 'organization', organizationId };
    } else if (active.roleId === 'super_admin') {
      if (query.organization_id === undefined) throw validationFailed();
      await this.authorize(current, 'care.assignment:read:global', 'care_assignment.list', {
        globalAllowed: true,
      });
      scope = { kind: 'organization', organizationId: query.organization_id };
    } else {
      return this.deny(current, null, 'care_assignment', null, 'care_assignment.list',
        403, 'PERMISSION_DENIED', 'Care assignments are not available to this role');
    }
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const records = await this.repository.listCareAssignments({
      scope, ...(query.status === undefined ? {} : { status: query.status }),
      ...(cursor === undefined ? {} : {
        beforeAssignedAt: cursor.instant, beforeAssignmentId: cursor.id,
      }),
      limit: query.page_size + 1,
    });
    return page(records, query.page_size, serializeCareAssignment, (record) => ({
      instant: record.assignedAt, id: record.assignmentId,
    }), active);
  }

  async createAssignment(
    current: AuthenticatedSession, organizationIdValue: string, bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parseOrganization(organizationIdValue);
    const request = createCareAssignmentSchema.safeParse(bodyValue);
    if (!request.success) throw validationFailed();
    const permission = administrativePermission(current, organizationId, 'create');
    const active = await this.authorizeAdministrative(current, organizationId, permission,
      'care_assignment.create');
    const result = await this.repository.createCareAssignment({
      organizationId, clinicianMembershipId: request.data.clinician_membership_id,
      patientProfileId: request.data.patient_profile_id,
      actorProfileId: current.aggregate.profile.profileId,
      actorMembershipId: active.membershipId,
      actor: administrativeActor(current, active.membershipId, permission),
      now: new Date(), correlationId: correlationId(),
    });
    if (typeof result !== 'string') return serializeCareAssignment(result);
    return this.createAssignmentFailure(current, organizationId, result);
  }

  async endAssignment(
    current: AuthenticatedSession, organizationIdValue: string,
    assignmentIdValue: string, bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parseOrganization(organizationIdValue);
    const assignmentId = parseId(
      assignmentPathSchema, { assignmentId: assignmentIdValue }, 'assignmentId',
    );
    const request = endCareAssignmentSchema.safeParse(bodyValue);
    if (!request.success) throw validationFailed();
    const permission = administrativePermission(current, organizationId, 'revoke');
    const active = await this.authorizeAdministrative(current, organizationId, permission,
      'care_assignment.end');
    const result = await this.repository.endCareAssignment({
      organizationId, assignmentId,
      actorProfileId: current.aggregate.profile.profileId,
      actor: administrativeActor(current, active.membershipId, permission),
      expectedVersion: request.data.expected_version, status: request.data.status,
      reason: request.data.reason, now: new Date(), correlationId: correlationId(),
    });
    if (typeof result !== 'string') return serializeCareAssignment(result);
    return this.endAssignmentFailure(current, organizationId, assignmentId, result);
  }

  private async authorizeOwn(current: AuthenticatedSession, permission: string, action: string) {
    const active = requireActive(current);
    if (active.roleId !== 'patient') {
      return this.deny(current, active.organizationId, 'consent_grant', null, action,
        403, 'PERMISSION_DENIED', 'Patient authority is required');
    }
    await this.authorize(current, permission, action, {
      ownerProfileId: current.aggregate.profile.profileId,
    });
    return this.authorization.touch(current).then(requireActive);
  }

  private async authorizeAdministrative(
    current: AuthenticatedSession, organizationId: string, permission: string, action: string,
  ) {
    const active = requireActive(current);
    await this.authorize(current, permission, action,
      active.roleId === 'super_admin'
        ? { globalAllowed: true }
        : { resourceOrganizationId: organizationId,
            membershipOrganizationId: active.organizationId },
    );
    const stepUp = current.aggregate.session.stepUpValidUntil;
    if (stepUp === null || stepUp <= new Date()) {
      return this.deny(current, organizationId, 'care_assignment', null, action,
        403, 'STEP_UP_REQUIRED', 'A current MFA step-up is required');
    }
    return this.authorization.touch(current).then(requireActive);
  }

  private async authorize(
    current: AuthenticatedSession, permission: string, action: string,
    context: Omit<Parameters<typeof evaluatePermission>[2], 'actorProfileId'>,
  ): Promise<void> {
    const active = requireActive(current);
    if (current.aggregate.profile.status !== 'active' ||
        current.aggregate.profile.onboardingCompletedAt === null || active.status !== 'active') {
      return this.deny(current, active.organizationId, 'care_assignment', null, action,
        403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    const decision = evaluatePermission(active.permissions, permission, {
      actorProfileId: current.aggregate.profile.profileId, ...context,
    });
    if (!decision.allowed) {
      return this.deny(current, active.organizationId, 'care_assignment', null, action,
        403, decision.reason === 'object_policy_denied' ? 'OBJECT_ACCESS_DENIED' : 'PERMISSION_DENIED',
        'Access is not permitted');
    }
  }

  private async createConsentFailure(
    current: AuthenticatedSession, organizationId: string, result: Extract<CreateConsentGrantResult, string>,
  ): Promise<never> {
    if (result === 'duplicate_active_grant') return this.deny(current, organizationId, 'consent_grant', null,
      'consent.create', 409, 'CONSENT_ALREADY_ACTIVE', 'An equivalent active consent grant already exists');
    if (result === 'organization_not_found' || result === 'grantee_not_eligible') return this.deny(current,
      organizationId, 'consent_grant', null, 'consent.create', 404, 'RESOURCE_NOT_FOUND', 'Consent grantee was not found');
    return this.actorFailure(current, organizationId, 'consent_grant', null, 'consent.create', result);
  }

  private async revokeConsentFailure(
    current: AuthenticatedSession, organizationId: string, consentId: string,
    result: Extract<RevokeConsentGrantResult, string>,
  ): Promise<never> {
    if (result === 'not_found') return this.deny(current, organizationId, 'consent_grant', consentId,
      'consent.revoke', 404, 'RESOURCE_NOT_FOUND', 'Consent grant was not found');
    if (result === 'version_conflict') return this.deny(current, organizationId, 'consent_grant', consentId,
      'consent.revoke', 409, 'CONSENT_VERSION_CONFLICT', 'Consent grant version is stale');
    if (result === 'already_inactive') return this.deny(current, organizationId, 'consent_grant', consentId,
      'consent.revoke', 409, 'CONSENT_NOT_ACTIVE', 'Consent grant is no longer active');
    return this.actorFailure(current, organizationId, 'consent_grant', consentId, 'consent.revoke', result);
  }

  private async createAssignmentFailure(
    current: AuthenticatedSession, organizationId: string, result: Extract<CreateCareAssignmentResult, string>,
  ): Promise<never> {
    if (result === 'already_assigned') return this.deny(current, organizationId, 'care_assignment', null,
      'care_assignment.create', 409, 'CARE_ASSIGNMENT_ALREADY_ACTIVE', 'An active care assignment already exists');
    if (result === 'organization_not_found' || result === 'clinician_not_eligible' || result === 'patient_not_eligible') {
      return this.deny(current, organizationId, 'care_assignment', null, 'care_assignment.create',
        404, 'RESOURCE_NOT_FOUND', 'Clinician or patient was not found');
    }
    return this.actorFailure(current, organizationId, 'care_assignment', null, 'care_assignment.create', result);
  }

  private async endAssignmentFailure(
    current: AuthenticatedSession, organizationId: string, assignmentId: string,
    result: Extract<EndCareAssignmentResult, string>,
  ): Promise<never> {
    if (result === 'not_found') return this.deny(current, organizationId, 'care_assignment', assignmentId,
      'care_assignment.end', 404, 'RESOURCE_NOT_FOUND', 'Care assignment was not found');
    if (result === 'version_conflict') return this.deny(current, organizationId, 'care_assignment', assignmentId,
      'care_assignment.end', 409, 'CARE_ASSIGNMENT_VERSION_CONFLICT', 'Care assignment version is stale');
    if (result === 'already_inactive') return this.deny(current, organizationId, 'care_assignment', assignmentId,
      'care_assignment.end', 409, 'CARE_ASSIGNMENT_NOT_ACTIVE', 'Care assignment is no longer active');
    return this.actorFailure(current, organizationId, 'care_assignment', assignmentId, 'care_assignment.end', result);
  }

  private async actorFailure(
    current: AuthenticatedSession, organizationId: string, objectType: 'consent_grant' | 'care_assignment',
    objectId: string | null, action: string,
    result: 'grantor_not_eligible' | 'actor_session_invalid' | 'actor_permission_denied' | 'actor_step_up_required',
  ): Promise<never> {
    if (result === 'actor_session_invalid') return this.deny(current, organizationId, objectType, objectId,
      action, 401, 'APP_SESSION_INVALID', 'The session is no longer valid');
    if (result === 'actor_step_up_required') return this.deny(current, organizationId, objectType, objectId,
      action, 403, 'STEP_UP_REQUIRED', 'A current MFA step-up is required');
    return this.deny(current, organizationId, objectType, objectId, action,
      403, 'PERMISSION_DENIED', 'Access is not permitted');
  }

  private async deny(
    current: AuthenticatedSession, organizationId: string | null,
    objectType: 'consent_grant' | 'care_assignment', objectId: string | null,
    action: string, status: number, code: string, title: string,
  ): Promise<never> {
    const id = correlationId();
    await this.repository.recordDenial(organizationId, objectType, objectId,
      current.aggregate.profile.profileId, action, code, id);
    throw problem(status, code, title, id);
  }
}

function requireActive(current: AuthenticatedSession) {
  const active = current.aggregate.memberships.find((membership) =>
    membership.membershipId === current.aggregate.session.activeMembershipId,
  );
  if (active === undefined || active.status !== 'active') throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
  return active;
}

function selfActor(current: AuthenticatedSession): ActorAuthorizationContext {
  return { kind: 'self', sessionId: current.aggregate.session.sessionId, tokenHash: current.tokenHash };
}
function administrativeActor(
  current: AuthenticatedSession, membershipId: string, requiredPermission: string,
): ActorAuthorizationContext {
  return { kind: 'administrative', sessionId: current.aggregate.session.sessionId,
    tokenHash: current.tokenHash, membershipId, requiredPermission, requireStepUp: true };
}
function administrativePermission(
  current: AuthenticatedSession, organizationId: string, action: 'create' | 'revoke',
): string {
  const active = requireActive(current);
  if (active.roleId === 'super_admin') return `care.assignment:${action}:global`;
  if (active.roleId === 'admin' && active.organizationId === organizationId) {
    return `care.assignment:${action}:organization`;
  }
  return `care.assignment:${action}:organization`;
}
function parseOrganization(value: string): string {
  const result = organizationPathSchema.safeParse({ organizationId: value });
  if (!result.success) throw validationFailed();
  return result.data.organizationId;
}
function parseId<T extends { safeParse(value: unknown): { success: boolean; data?: unknown } }>(
  schema: T, value: unknown, key: string,
): string {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed();
  return (result.data as Record<string, string>)[key]!;
}
function parseListConsents(value: unknown): ListConsentGrantsQuery {
  const result = listConsentGrantsSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}
function parseListAssignments(value: unknown): ListCareAssignmentsQuery {
  const result = listCareAssignmentsSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}
interface Cursor { readonly instant: Date; readonly id: string }
function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ instant: cursor.instant.toISOString(), id: cursor.id })).toString('base64url');
}
function decodeCursor(value: string): Cursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof decoded.instant !== 'string' || typeof decoded.id !== 'string') throw new Error();
    const instant = new Date(decoded.instant);
    if (!Number.isFinite(instant.getTime()) || !/^[0-9a-f-]{36}$/.test(decoded.id)) throw new Error();
    return { instant, id: decoded.id };
  } catch { throw validationFailed(); }
}
function page<T>(
  records: readonly T[], pageSize: number, serialize: (record: T) => Record<string, unknown>,
  cursorOf: (record: T) => Cursor, _active: unknown,
): Record<string, unknown> {
  const hasMore = records.length > pageSize;
  const data = hasMore ? records.slice(0, pageSize) : records;
  const last = data.at(-1);
  return { data: data.map(serialize), page: { has_more: hasMore,
    next_cursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null } };
}
