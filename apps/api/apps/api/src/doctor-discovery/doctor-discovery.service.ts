import { Injectable } from '@nestjs/common';
import {
  DoctorDiscoveryRepository,
  directorySortValue,
  normalizeReviewTags,
  serializeDoctor,
  serializeDoctorReview,
  type ActorAuthorizationContext,
  type DoctorDirectoryRecord,
  type DoctorDirectorySort,
  type DoctorReviewRecord,
  type SaveDoctorReviewResult,
} from '@smartcura/database';
import { evaluatePermission } from '@smartcura/policy';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  doctorPathSchema,
  listDoctorReviewsSchema,
  reviewAppointmentPathSchema,
  saveDoctorReviewSchema,
  searchDoctorsSchema,
  type ListDoctorReviewsQuery,
  type SearchDoctorsQuery,
} from './doctor-discovery-request.schemas.js';

const DIRECTORY_READ = 'doctor_detail:read:global';
const REVIEW_READ = 'doctor_review:read:global';
const REVIEW_WRITE = 'doctor_review:write:own';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

@Injectable()
export class DoctorDiscoveryService {
  constructor(
    private readonly repository: DoctorDiscoveryRepository,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  async search(current: AuthenticatedSession, queryValue: unknown): Promise<Record<string, unknown>> {
    const query = parseSearch(queryValue);
    await this.authorizeGlobal(current, DIRECTORY_READ, 'doctor_directory.search');
    const cursor = query.cursor === undefined ? undefined : decodeDirectoryCursor(query.cursor, query.sort);
    const records = await this.repository.search({
      ...(query.q === undefined ? {} : { query: query.q }),
      ...(query.specialty === undefined ? {} : { specialty: query.specialty }),
      ...(query.language === undefined ? {} : { language: query.language }),
      ...(query.max_fee_sen === undefined ? {} : { maxFeeSen: query.max_fee_sen }),
      ...(query.min_rating === undefined ? {} : { minRating: query.min_rating }),
      ...(query.accepts_new_patients === undefined ? {} : {
        acceptsNewPatients: query.accepts_new_patients,
      }),
      sort: query.sort, ...(cursor === undefined ? {} : { cursor }),
      limit: query.page_size + 1,
    });
    const hasMore = records.length > query.page_size;
    const page = hasMore ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return {
      data: page.map(serializeDoctor),
      page: { has_more: hasMore, next_cursor: hasMore && last !== undefined
        ? encodeDirectoryCursor(last, query.sort) : null },
    };
  }

  async get(current: AuthenticatedSession, membershipIdValue: string): Promise<Record<string, unknown>> {
    const membershipId = parseDoctorId(membershipIdValue);
    await this.authorizeGlobal(current, DIRECTORY_READ, 'doctor_directory.read');
    const doctor = await this.repository.findApproved(membershipId);
    if (doctor === undefined) return this.notFound(current, membershipId, 'doctor_directory.read');
    const reviews = await this.repository.listReviews({ doctorMembershipId: membershipId, limit: 2 });
    return { ...serializeDoctor(doctor), reviews_preview: reviews.map(publicReview) };
  }

  async listReviews(
    current: AuthenticatedSession, membershipIdValue: string, queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const membershipId = parseDoctorId(membershipIdValue);
    const query = parseReviews(queryValue);
    await this.authorizeGlobal(current, REVIEW_READ, 'doctor_review.list');
    const doctor = await this.repository.findApproved(membershipId);
    if (doctor === undefined) return this.notFound(current, membershipId, 'doctor_review.list');
    const cursor = query.cursor === undefined ? undefined : decodeReviewCursor(query.cursor);
    const records = await this.repository.listReviews({
      doctorMembershipId: membershipId,
      ...(query.rating === undefined ? {} : { rating: query.rating }),
      ...(cursor === undefined ? {} : {
        beforeCreatedAt: cursor.createdAt, beforeReviewId: cursor.reviewId,
      }),
      limit: query.page_size + 1,
    });
    const hasMore = records.length > query.page_size;
    const page = hasMore ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return { data: page.map(publicReview), page: { has_more: hasMore,
      next_cursor: hasMore && last !== undefined ? encodeReviewCursor(last) : null } };
  }

  async saveReview(
    current: AuthenticatedSession, appointmentIdValue: string, bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const appointmentId = parseAppointmentId(appointmentIdValue);
    const request = saveDoctorReviewSchema.safeParse(bodyValue);
    if (!request.success) throw validationFailed();
    const active = requireActive(current);
    if (active.roleId !== 'patient') {
      return this.deny(current, null, 'doctor_review.save', 403,
        'PERMISSION_DENIED', 'Only the patient who completed the appointment may review it');
    }
    const decision = evaluatePermission(active.permissions, REVIEW_WRITE, {
      actorProfileId: current.aggregate.profile.profileId,
      ownerProfileId: current.aggregate.profile.profileId,
    });
    if (!decision.allowed) {
      return this.deny(current, null, 'doctor_review.save', 403,
        decision.reason === 'object_policy_denied' ? 'OBJECT_ACCESS_DENIED' : 'PERMISSION_DENIED',
        'Reviewing this appointment is not permitted');
    }
    const authorized = await this.authorization.touch(current);
    const refreshed = requireActive(authorized);
    const result = await this.repository.saveReview({
      appointmentId, patientProfileId: authorized.aggregate.profile.profileId,
      actorMembershipId: refreshed.membershipId, actor: selfActor(authorized),
      rating: request.data.rating, comment: request.data.comment,
      tags: normalizeReviewTags(request.data.tags),
      expectedVersion: request.data.expected_version,
      now: new Date(), correlationId: correlationId(),
    });
    if (typeof result !== 'string') {
      return { ...serializeDoctorReview(result.record), replayed: result.replayed };
    }
    return this.saveFailure(authorized, result);
  }

  private async authorizeGlobal(
    current: AuthenticatedSession, permission: string, action: string,
  ): Promise<void> {
    const active = requireActive(current);
    const decision = evaluatePermission(active.permissions, permission, {
      actorProfileId: current.aggregate.profile.profileId, globalAllowed: true,
    });
    if (!decision.allowed) {
      return this.deny(current, null, action, 403, 'PERMISSION_DENIED', 'Directory access is not permitted');
    }
    await this.authorization.touch(current);
  }

  private async saveFailure(
    current: AuthenticatedSession, result: Extract<SaveDoctorReviewResult, string>,
  ): Promise<never> {
    switch (result) {
      case 'appointment_not_found':
        return this.deny(current, null, 'doctor_review.save', 404,
          'RESOURCE_NOT_FOUND', 'Completed appointment was not found');
      case 'appointment_not_completed':
        return this.deny(current, null, 'doctor_review.save', 409,
          'REVIEW_APPOINTMENT_NOT_COMPLETED', 'Only a completed appointment may be reviewed');
      case 'version_conflict':
        return this.deny(current, null, 'doctor_review.save', 409,
          'DOCTOR_REVIEW_VERSION_CONFLICT', 'Doctor review version is stale');
      case 'actor_session_invalid':
        return this.deny(current, null, 'doctor_review.save', 401,
          'APP_SESSION_INVALID', 'Application session is invalid');
      case 'actor_step_up_required':
      case 'actor_permission_denied':
      case 'patient_membership_ineligible':
        return this.deny(current, null, 'doctor_review.save', 403,
          'PERMISSION_DENIED', 'Reviewing this appointment is not permitted');
    }
  }

  private notFound(current: AuthenticatedSession, membershipId: string, action: string): Promise<never> {
    return this.deny(current, membershipId, action, 404, 'RESOURCE_NOT_FOUND', 'Doctor was not found');
  }
  private async deny(
    current: AuthenticatedSession, membershipId: string | null, action: string,
    status: number, code: string, title: string,
  ): Promise<never> {
    const id = correlationId();
    await this.repository.recordDenial(membershipId, current.aggregate.profile.profileId, action, code, id);
    throw problem(status, code, title, id);
  }
}

function requireActive(current: AuthenticatedSession) {
  const active = current.aggregate.memberships.find((membership) =>
    membership.membershipId === current.aggregate.session.activeMembershipId,
  );
  if (active === undefined || active.status !== 'active') {
    throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
  }
  return active;
}
function selfActor(current: AuthenticatedSession): ActorAuthorizationContext {
  return { kind: 'self', sessionId: current.aggregate.session.sessionId, tokenHash: current.tokenHash };
}
function parseSearch(value: unknown): SearchDoctorsQuery {
  const result = searchDoctorsSchema.safeParse(value); if (!result.success) throw validationFailed(); return result.data;
}
function parseReviews(value: unknown): ListDoctorReviewsQuery {
  const result = listDoctorReviewsSchema.safeParse(value); if (!result.success) throw validationFailed(); return result.data;
}
function parseDoctorId(value: string): string {
  const result = doctorPathSchema.safeParse({ membershipId: value }); if (!result.success) throw validationFailed(); return result.data.membershipId;
}
function parseAppointmentId(value: string): string {
  const result = reviewAppointmentPathSchema.safeParse({ appointmentId: value }); if (!result.success) throw validationFailed(); return result.data.appointmentId;
}
function publicReview(record: DoctorReviewRecord): Record<string, unknown> {
  return { id: record.reviewId, rating: record.rating, comment: record.comment,
    tags: record.tags, created_at: record.createdAt.toISOString(), updated_at: record.updatedAt.toISOString() };
}
function encodeDirectoryCursor(record: DoctorDirectoryRecord, sort: DoctorDirectorySort): string {
  const value = directorySortValue(record, sort);
  return Buffer.from(JSON.stringify({ sort, value: value instanceof Date ? value.toISOString() : value,
    membership_id: record.membershipId })).toString('base64url');
}
function decodeDirectoryCursor(value: string, sort: DoctorDirectorySort) {
  try {
    const data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (data.sort !== sort || typeof data.membership_id !== 'string' ||
        !UUID_V7.test(data.membership_id)) throw new Error();
    if (sort === 'soonest' && data.value !== null && typeof data.value !== 'string') throw new Error();
    if (sort !== 'soonest' && typeof data.value !== 'number') throw new Error();
    const sortValue = sort === 'soonest'
      ? (data.value === null ? null : new Date(String(data.value)))
      : Number(data.value);
    if (sortValue instanceof Date ? !Number.isFinite(sortValue.getTime()) :
      sortValue !== null && !Number.isFinite(sortValue)) throw new Error();
    return { sortValue, membershipId: data.membership_id };
  } catch { throw validationFailed(); }
}
function encodeReviewCursor(record: DoctorReviewRecord): string {
  return Buffer.from(JSON.stringify({ created_at: record.createdAt.toISOString(), review_id: record.reviewId })).toString('base64url');
}
function decodeReviewCursor(value: string): { createdAt: Date; reviewId: string } {
  try {
    const data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof data.created_at !== 'string' || typeof data.review_id !== 'string' ||
        !UUID_V7.test(data.review_id)) throw new Error();
    const createdAt = new Date(data.created_at); if (!Number.isFinite(createdAt.getTime())) throw new Error();
    return { createdAt, reviewId: data.review_id };
  } catch { throw validationFailed(); }
}
