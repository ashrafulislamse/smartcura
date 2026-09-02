import type { PoolClient, QueryResultRow } from 'pg';
import { revalidateActor } from './actor-revalidation.js';
import { PostgresConnection } from './connection.js';
import {
  DOCTOR_REVIEW_CHANGED_EVENT_TYPE,
  DOCTOR_REVIEW_CHANGED_EVENT_VERSION,
  type DoctorReviewTag,
} from './doctor-discovery-events.js';
import type { ActorAuthorizationContext, ActorRevalidationFailure } from './membership-repository.js';

export type DoctorDirectorySort = 'soonest' | 'rating' | 'fee';
export interface DoctorDirectoryCursor {
  readonly sortValue: Date | number | null;
  readonly membershipId: string;
}
export interface SearchDoctorsInput {
  readonly query?: string;
  readonly specialty?: string;
  readonly language?: string;
  readonly maxFeeSen?: number;
  readonly minRating?: number;
  readonly acceptsNewPatients?: boolean;
  readonly sort: DoctorDirectorySort;
  readonly cursor?: DoctorDirectoryCursor;
  readonly limit: number;
}
export interface DoctorDirectoryRecord {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly profileId: string;
  readonly displayName: string;
  readonly practiceName: string;
  readonly biography: string | null;
  readonly yearsExperience: number;
  readonly consultationFeeSen: number;
  readonly currency: 'MYR';
  readonly acceptsNewPatients: boolean;
  readonly specialties: readonly string[];
  readonly primarySpecialty: string | null;
  readonly languages: readonly string[];
  readonly ratingAverage: number;
  readonly reviewCount: number;
  readonly nextAvailableAt: Date | null;
}
interface DirectoryRow extends QueryResultRow {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly profileId: string;
  readonly displayName: string;
  readonly practiceName: string;
  readonly biography: string | null;
  readonly yearsExperience: number;
  readonly consultationFeeSen: string;
  readonly currency: string;
  readonly acceptsNewPatients: boolean;
  readonly specialties: string[];
  readonly primarySpecialty: string | null;
  readonly languages: string[];
  readonly ratingAverage: number;
  readonly reviewCount: number;
  readonly nextAvailableAt: Date | null;
}

export interface DoctorReviewRecord {
  readonly reviewId: string;
  readonly appointmentId: string;
  readonly organizationId: string;
  readonly doctorMembershipId: string;
  readonly patientProfileId: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly tags: readonly DoctorReviewTag[];
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
interface ReviewRow extends QueryResultRow, DoctorReviewRecord {}

export interface ListDoctorReviewsInput {
  readonly doctorMembershipId: string;
  readonly beforeCreatedAt?: Date;
  readonly beforeReviewId?: string;
  readonly rating?: number;
  readonly limit: number;
}
export interface SaveDoctorReviewInput {
  readonly appointmentId: string;
  readonly patientProfileId: string;
  readonly actorMembershipId: string;
  readonly actor: ActorAuthorizationContext;
  readonly rating: number;
  readonly comment: string | null;
  readonly tags: readonly DoctorReviewTag[];
  readonly expectedVersion: number;
  readonly now: Date;
  readonly correlationId: string;
}
export type SaveDoctorReviewResult =
  | { readonly record: DoctorReviewRecord; readonly replayed: boolean }
  | 'appointment_not_found'
  | 'appointment_not_completed'
  | 'patient_membership_ineligible'
  | 'version_conflict'
  | ActorRevalidationFailure;

export class DoctorDiscoveryRepository {
  constructor(private readonly database: PostgresConnection) {}

  async search(input: SearchDoctorsInput): Promise<DoctorDirectoryRecord[]> {
    const values: unknown[] = [];
    const bind = (value: unknown): string => { values.push(value); return `$${values.length}`; };
    const clauses = [
      `membership.role_id = 'doctor'`,
      `membership.status = 'active'`,
      `membership.verification_status = 'approved'`,
      `profile.status = 'active'`,
      `profile.onboarding_completed_at IS NOT NULL`,
    ];
    if (input.query !== undefined) {
      const p = bind(`%${input.query}%`);
      clauses.push(`(profile.display_name ILIKE ${p} OR COALESCE(detail.biography, '') ILIKE ${p}
        OR EXISTS (SELECT 1 FROM doctor_professional_specialties search_specialty
          WHERE search_specialty.membership_id = membership.membership_id
            AND search_specialty.specialty_code ILIKE ${p}))`);
    }
    if (input.specialty !== undefined) {
      const p = bind(input.specialty);
      clauses.push(`EXISTS (SELECT 1 FROM doctor_professional_specialties filter_specialty
        WHERE filter_specialty.membership_id = membership.membership_id
          AND filter_specialty.specialty_code = ${p})`);
    }
    if (input.language !== undefined) {
      const p = bind(input.language);
      clauses.push(`EXISTS (SELECT 1 FROM doctor_professional_languages filter_language
        WHERE filter_language.membership_id = membership.membership_id
          AND filter_language.language_code = ${p})`);
    }
    if (input.maxFeeSen !== undefined) clauses.push(`detail.consultation_fee_sen <= ${bind(input.maxFeeSen)}`);
    if (input.minRating !== undefined) clauses.push(`review_stats.rating_average >= ${bind(input.minRating)}`);
    if (input.acceptsNewPatients !== undefined) clauses.push(`detail.accepts_new_patients = ${bind(input.acceptsNewPatients)}`);

    const sort = directorySort(input.sort);
    if (input.cursor !== undefined) {
      const id = bind(input.cursor.membershipId);
      if (input.sort === 'soonest') {
        if (input.cursor.sortValue === null) {
          clauses.push(`next_slot.starts_at IS NULL AND membership.membership_id > ${id}`);
        } else {
          const value = bind(input.cursor.sortValue);
          clauses.push(`(next_slot.starts_at > ${value} OR next_slot.starts_at IS NULL
            OR (next_slot.starts_at = ${value} AND membership.membership_id > ${id}))`);
        }
      } else if (input.sort === 'rating') {
        const value = bind(input.cursor.sortValue);
        clauses.push(`(review_stats.rating_average < ${value}
          OR (review_stats.rating_average = ${value} AND membership.membership_id > ${id}))`);
      } else {
        const value = bind(input.cursor.sortValue);
        clauses.push(`(detail.consultation_fee_sen > ${value}
          OR (detail.consultation_fee_sen = ${value} AND membership.membership_id > ${id}))`);
      }
    }
    const limit = bind(input.limit);
    const result = await this.database.query<DirectoryRow>(
      `${directoryProjection()}
       WHERE ${clauses.join('\n AND ')}
       ORDER BY ${sort} LIMIT ${limit}`,
      values,
    );
    return result.rows.map(toDirectoryRecord);
  }

  async findApproved(membershipId: string): Promise<DoctorDirectoryRecord | undefined> {
    const result = await this.database.query<DirectoryRow>(
      `${directoryProjection()}
       WHERE membership.membership_id = $1
         AND membership.role_id = 'doctor' AND membership.status = 'active'
         AND membership.verification_status = 'approved'
         AND profile.status = 'active' AND profile.onboarding_completed_at IS NOT NULL`,
      [membershipId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toDirectoryRecord(row);
  }

  async listReviews(input: ListDoctorReviewsInput): Promise<DoctorReviewRecord[]> {
    const result = await this.database.query<ReviewRow>(
      `${reviewProjection()}
       WHERE review.doctor_membership_id = $1
         AND ($2::integer IS NULL OR review.rating = $2)
         AND ($3::timestamptz IS NULL OR
           (review.created_at, review.review_id) < ($3, $4::uuid))
       ORDER BY review.created_at DESC, review.review_id DESC LIMIT $5`,
      [input.doctorMembershipId, input.rating ?? null, input.beforeCreatedAt ?? null,
        input.beforeReviewId ?? null, input.limit],
    );
    return result.rows;
  }

  async saveReview(input: SaveDoctorReviewInput): Promise<SaveDoctorReviewResult> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateActor(client, input.actor, '', input.now);
      if (actorFailure !== undefined) return actorFailure;
      const appointmentResult = await client.query<{
        readonly appointmentId: string;
        readonly organizationId: string;
        readonly doctorMembershipId: string;
        readonly status: string;
      }>(
        `SELECT appointment_id AS "appointmentId", organization_id AS "organizationId",
         doctor_membership_id AS "doctorMembershipId", status
         FROM appointments WHERE appointment_id = $1 AND patient_profile_id = $2
         FOR UPDATE`,
        [input.appointmentId, input.patientProfileId],
      );
      const appointment = appointmentResult.rows[0];
      if (appointment === undefined) return 'appointment_not_found';
      if (appointment.status !== 'completed') return 'appointment_not_completed';
      const membership = await client.query(
        `SELECT membership_id FROM organization_memberships
         WHERE membership_id = $1 AND profile_id = $2 AND organization_id = $3
           AND role_id = 'patient' AND status = 'active' FOR SHARE`,
        [input.actorMembershipId, input.patientProfileId, appointment.organizationId],
      );
      if (membership.rowCount !== 1) return 'patient_membership_ineligible';
      const current = await client.query<ReviewRow>(
        `${reviewProjection()} WHERE review.appointment_id = $1 FOR UPDATE OF review`,
        [input.appointmentId],
      );
      const existing = current.rows[0];
      if (existing === undefined) {
        if (input.expectedVersion !== 0) return 'version_conflict';
        await client.query(
          `INSERT INTO doctor_reviews
           (review_id, appointment_id, organization_id, doctor_membership_id,
            patient_profile_id, rating, comment, tags, updated_at)
           VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8)`,
          [input.appointmentId, appointment.organizationId, appointment.doctorMembershipId,
            input.patientProfileId, input.rating, input.comment, input.tags, input.now],
        );
      } else {
        const samePayload = existing.rating === input.rating &&
          existing.comment === input.comment && sameTags(existing.tags, input.tags);
        if (input.expectedVersion === existing.version && samePayload) {
          return { record: existing, replayed: true };
        }
        if (existing.version !== input.expectedVersion) return 'version_conflict';
        await client.query(
          `UPDATE doctor_reviews SET rating = $2, comment = $3, tags = $4,
           version = version + 1, updated_at = $5
           WHERE review_id = $1 AND version = $6`,
          [existing.reviewId, input.rating, input.comment, input.tags,
            input.now, input.expectedVersion],
        );
      }
      const loaded = await client.query<ReviewRow>(
        `${reviewProjection()} WHERE review.appointment_id = $1 FOR UPDATE OF review`,
        [input.appointmentId],
      );
      const record = loaded.rows[0];
      if (record === undefined) throw new Error('Saved doctor review could not be loaded');
      await recordReviewChange(client, record, input.correlationId, input.now,
        existing === undefined ? 'created' : 'updated');
      return { record, replayed: false };
    });
  }

  async recordDenial(
    doctorMembershipId: string | null, actorProfileId: string, action: string,
    code: string, correlationId: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(), (SELECT organization_id FROM organization_memberships
         WHERE membership_id = $1), $2, $3, 'doctor_review', $1, $4, $5, $6)`,
      [doctorMembershipId, actorProfileId, action, code, correlationId,
        { denial_code: code }],
    );
  }
}

export function serializeDoctor(record: DoctorDirectoryRecord): Record<string, unknown> {
  return {
    membership_id: record.membershipId,
    organization_id: record.organizationId,
    display_name: record.displayName,
    image_url: null,
    practice_name: record.practiceName,
    biography: record.biography,
    years_experience: record.yearsExperience,
    consultation_fee_sen: record.consultationFeeSen,
    currency: record.currency,
    accepts_new_patients: record.acceptsNewPatients,
    verified: true,
    primary_specialty: record.primarySpecialty,
    specialties: record.specialties,
    languages: record.languages,
    rating_average: record.ratingAverage,
    review_count: record.reviewCount,
    next_available_at: record.nextAvailableAt?.toISOString() ?? null,
  };
}
export function serializeDoctorReview(record: DoctorReviewRecord): Record<string, unknown> {
  return {
    id: record.reviewId, appointment_id: record.appointmentId,
    doctor_membership_id: record.doctorMembershipId, rating: record.rating,
    comment: record.comment, tags: record.tags, version: record.version,
    created_at: record.createdAt.toISOString(), updated_at: record.updatedAt.toISOString(),
  };
}
export function directorySortValue(record: DoctorDirectoryRecord, sort: DoctorDirectorySort): Date | number | null {
  if (sort === 'soonest') return record.nextAvailableAt;
  if (sort === 'rating') return record.ratingAverage;
  return record.consultationFeeSen;
}
export function normalizeReviewTags(tags: readonly DoctorReviewTag[]): DoctorReviewTag[] {
  return [...new Set(tags)].sort();
}

function directoryProjection(): string {
  return `SELECT membership.membership_id AS "membershipId",
   membership.organization_id AS "organizationId", profile.profile_id AS "profileId",
   profile.display_name AS "displayName", organization.name AS "practiceName",
   detail.biography, detail.years_experience AS "yearsExperience",
   detail.consultation_fee_sen::text AS "consultationFeeSen", detail.currency,
   detail.accepts_new_patients AS "acceptsNewPatients",
   ARRAY(SELECT specialty.specialty_code FROM doctor_professional_specialties specialty
     WHERE specialty.membership_id = membership.membership_id
     ORDER BY specialty.is_primary DESC, specialty.specialty_code) AS specialties,
   (SELECT specialty.specialty_code FROM doctor_professional_specialties specialty
     WHERE specialty.membership_id = membership.membership_id AND specialty.is_primary
     LIMIT 1) AS "primarySpecialty",
   ARRAY(SELECT language.language_code FROM doctor_professional_languages language
     WHERE language.membership_id = membership.membership_id
     ORDER BY language.language_code) AS languages,
   review_stats.rating_average AS "ratingAverage",
   review_stats.review_count AS "reviewCount",
   next_slot.starts_at AS "nextAvailableAt"
   FROM organization_memberships membership
   JOIN profiles profile ON profile.profile_id = membership.profile_id
   JOIN organizations organization ON organization.organization_id = membership.organization_id
   JOIN doctor_professional_details detail
     ON detail.membership_id = membership.membership_id
    AND detail.organization_id = membership.organization_id
   LEFT JOIN LATERAL (
     SELECT COALESCE(AVG(review.rating), 0)::float8 AS rating_average,
       COUNT(review.review_id)::integer AS review_count
     FROM doctor_reviews review WHERE review.doctor_membership_id = membership.membership_id
   ) review_stats ON true
   LEFT JOIN LATERAL (
     SELECT slot.starts_at FROM appointment_slots slot
     WHERE slot.membership_id = membership.membership_id
       AND (slot.state = 'open' OR
         (slot.state = 'held' AND slot.held_until <= now()))
       AND slot.starts_at > now()
     ORDER BY slot.starts_at, slot.slot_id LIMIT 1
   ) next_slot ON true`;
}
function directorySort(sort: DoctorDirectorySort): string {
  if (sort === 'rating') return `review_stats.rating_average DESC, membership.membership_id`;
  if (sort === 'fee') return `detail.consultation_fee_sen, membership.membership_id`;
  return `next_slot.starts_at ASC NULLS LAST, membership.membership_id`;
}
function reviewProjection(): string {
  return `SELECT review.review_id AS "reviewId", review.appointment_id AS "appointmentId",
   review.organization_id AS "organizationId",
   review.doctor_membership_id AS "doctorMembershipId",
   review.patient_profile_id AS "patientProfileId", review.rating, review.comment,
   review.tags, review.version, review.created_at AS "createdAt",
   review.updated_at AS "updatedAt" FROM doctor_reviews review`;
}
function toDirectoryRecord(row: DirectoryRow): DoctorDirectoryRecord {
  const fee = Number(row.consultationFeeSen);
  if (!Number.isSafeInteger(fee) || fee < 0 || row.currency !== 'MYR') {
    throw new Error('Invalid doctor directory money projection');
  }
  return { ...row, consultationFeeSen: fee, currency: 'MYR',
    ratingAverage: Number(row.ratingAverage), reviewCount: Number(row.reviewCount) };
}
function sameTags(left: readonly DoctorReviewTag[], right: readonly DoctorReviewTag[]): boolean {
  const a = normalizeReviewTags(left); const b = normalizeReviewTags(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
async function recordReviewChange(
  client: PoolClient, record: DoctorReviewRecord, correlationId: string,
  now: Date, change: 'created' | 'updated',
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
     (audit_id, organization_id, actor_profile_id, action, object_type,
      object_id, reason, correlation_id, metadata)
     VALUES (uuidv7(), $1, $2, $3, 'doctor_review', $4, NULL, $5, $6)`,
    [record.organizationId, record.patientProfileId, `doctor_review.${change}`,
      record.reviewId, correlationId,
      { appointment_id: record.appointmentId, rating: record.rating, version: record.version,
        tag_count: record.tags.length }],
  );
  await client.query(
    `INSERT INTO outbox_events
     (event_id, event_type, event_version, aggregate_type, aggregate_id,
      aggregate_version, payload, correlation_id, occurred_at)
     VALUES (uuidv7(), $1, $2, 'doctor_review', $3, $4, $5, $6, $7)`,
    [DOCTOR_REVIEW_CHANGED_EVENT_TYPE, DOCTOR_REVIEW_CHANGED_EVENT_VERSION,
      record.reviewId, record.version, { review_id: record.reviewId,
        doctor_membership_id: record.doctorMembershipId,
        rating: record.rating, change }, correlationId, now],
  );
}
