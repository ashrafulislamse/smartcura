import { Injectable } from '@nestjs/common';
import {
  DoctorDetailRepository,
  type DoctorDetailFailure,
  type DoctorDetailRecord,
} from '@smartcura/database/doctor-detail-repository';
import { evaluatePermission } from '@smartcura/policy';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  doctorDetailPathSchema,
  saveDoctorDetailSchema,
} from './profile-detail-request.schemas.js';

/** Read any doctor's published professional detail. */
const READ_ANY = 'doctor_detail:read:global';
/** Maintain the professional detail of your own doctor membership. */
const WRITE_OWN = 'doctor_detail:write:own';

/**
 * Doctor professional detail, addressed by membership.
 *
 * AUTHORIZATION IS DENY-BY-DEFAULT.
 *
 * Writes: the target membership must be the actor's own active membership and the
 * actor must hold `doctor_detail:write:own`. A biography and a fee are the
 * practitioner's own professional statements, so nobody edits them on a doctor's
 * behalf through this endpoint; an administrator correcting a listing is a
 * separate, separately audited capability.
 *
 * Reads: `doctor_detail:read:global` covers any membership, because this detail is
 * published professional information a patient needs in order to choose a
 * clinician. A doctor reading their OWN row is allowed on the strength of
 * `doctor_detail:write:own` — a permission to publish a statement necessarily
 * includes reading back what was published, and inventing a sixth permission for
 * it would add a grant nobody can explain.
 *
 * A membership the caller may not read is reported as 404, never 403. A 403 would
 * confirm that the membership exists, which is itself information about a person.
 */
@Injectable()
export class DoctorDetailsService {
  constructor(
    private readonly doctorDetails: DoctorDetailRepository,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  async get(
    current: AuthenticatedSession,
    membershipIdValue: string,
  ): Promise<Record<string, unknown>> {
    const membershipId = parsePath(membershipIdValue);
    const permissions = activePermissions(current);
    const record = await this.doctorDetails.findByMembershipId(membershipId);
    const readsAny = record !== undefined && record.membershipStatus === 'active' &&
      record.verificationStatus === 'approved' && evaluatePermission(permissions, READ_ANY, {
      actorProfileId: current.aggregate.profile.profileId,
      // `global` here means the platform doctor directory, not administrative
      // reach over patient data: the scope is satisfied by holding the grant.
      globalAllowed: true,
    }).allowed;
    const readsOwn = record !== undefined &&
      record.profileId === current.aggregate.profile.profileId &&
      evaluatePermission(permissions, WRITE_OWN, {
        actorProfileId: current.aggregate.profile.profileId,
        ownerProfileId: record.profileId,
      }).allowed;
    if (!readsAny && !readsOwn) {
      return this.deny(
        current, membershipId, 'doctor_detail.read',
        404, 'RESOURCE_NOT_FOUND', 'Doctor detail was not found',
      );
    }
    if (record === undefined) {
      return this.deny(
        current, membershipId, 'doctor_detail.read',
        404, 'RESOURCE_NOT_FOUND', 'Doctor detail was not found',
      );
    }
    return doctorDetailResponse(record);
  }

  async save(
    current: AuthenticatedSession,
    membershipIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const membershipId = parsePath(membershipIdValue);
    const request = parseSave(bodyValue);
    const active = activeMembership(current);
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, membershipId, 'doctor_detail.save',
        403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete',
      );
    }
    // The target must be the membership the session is acting through. Comparing
    // against the ACTIVE membership rather than "any membership this profile
    // holds" keeps a doctor from editing their clinic-B listing while operating in
    // clinic A, where a different organization's authority applies.
    if (active === undefined || active.membershipId !== membershipId) {
      return this.deny(
        current, membershipId, 'doctor_detail.save',
        404, 'RESOURCE_NOT_FOUND', 'Doctor detail was not found',
      );
    }
    const decision = evaluatePermission(active.permissions, WRITE_OWN, {
      actorProfileId: current.aggregate.profile.profileId,
      ownerProfileId: current.aggregate.profile.profileId,
    });
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      return this.deny(
        current, membershipId, 'doctor_detail.save',
        403, code, 'Maintaining doctor professional detail is not permitted',
      );
    }
    const authorized = await this.authorization.touch(current);
    const result = await this.doctorDetails.save({
      membershipId,
      actorProfileId: authorized.aggregate.profile.profileId,
      // Re-proved under lock inside the write transaction, not trusted from here.
      actor: {
        sessionId: authorized.aggregate.session.sessionId,
        tokenHash: authorized.tokenHash,
      },
      biography: request.biography,
      yearsExperience: request.years_experience,
      consultationFeeSen: request.consultation_fee_sen,
      acceptsNewPatients: request.accepts_new_patients,
      specialties: request.specialties.map((specialty) => ({
        code: specialty.code,
        isPrimary: specialty.is_primary,
      })),
      languages: request.languages,
      expectedVersion: request.expected_version,
      reasonCode: request.reason_code,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') return doctorDetailResponse(result);
    return this.saveFailure(authorized, membershipId, result);
  }

  private async saveFailure(
    current: AuthenticatedSession,
    membershipId: string,
    result: DoctorDetailFailure,
  ): Promise<never> {
    switch (result) {
      case 'actor_session_invalid':
        return this.deny(
          current, membershipId, 'doctor_detail.save',
          401, 'APP_SESSION_INVALID', 'Application session is invalid',
        );
      case 'membership_not_found':
      // Reported identically to a missing membership on purpose: the caller must
      // not learn the role or status of a membership they do not own.
      case 'membership_not_doctor':
        return this.deny(
          current, membershipId, 'doctor_detail.save',
          404, 'RESOURCE_NOT_FOUND', 'Doctor detail was not found',
        );
      case 'version_conflict':
        return this.deny(
          current, membershipId, 'doctor_detail.save',
          409, 'RESOURCE_VERSION_CONFLICT', 'Doctor detail version is stale',
        );
    }
  }

  private async deny(
    current: AuthenticatedSession,
    membershipId: string | null,
    action: string,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    const requestCorrelationId = correlationId();
    await this.doctorDetails.recordDenial(
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

/**
 * Permissions of the active membership, or none. A profile with no active
 * membership has no professional authority at all, which is the correct default
 * for a directory read as much as for a write.
 */
function activePermissions(current: AuthenticatedSession): readonly string[] {
  const active = activeMembership(current);
  return active === undefined || active.status !== 'active' ? [] : active.permissions;
}

function parsePath(value: string): string {
  const result = doctorDetailPathSchema.safeParse({ membershipId: value });
  if (!result.success) throw validationFailed();
  return result.data.membershipId;
}

function parseSave(value: unknown) {
  const result = saveDoctorDetailSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function doctorDetailResponse(record: DoctorDetailRecord): Record<string, unknown> {
  return {
    membership_id: record.membershipId,
    organization_id: record.organizationId,
    profile_id: record.profileId,
    biography: record.biography,
    years_experience: record.yearsExperience,
    // Integer sen plus an explicit currency. A decimal ringgit field would invite
    // a float on the client, which is how rounding errors reach an invoice.
    consultation_fee_sen: record.consultationFeeSen,
    currency: record.currency,
    accepts_new_patients: record.acceptsNewPatients,
    specialties: record.specialties.map((specialty) => ({
      code: specialty.code,
      is_primary: specialty.isPrimary,
    })),
    languages: record.languages,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}
