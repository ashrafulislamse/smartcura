import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  DOCTOR_DETAIL_CHANGED_EVENT_TYPE,
  DOCTOR_DETAIL_CHANGED_EVENT_VERSION,
  type DoctorDetailReasonCode,
} from './profile-detail-events.js';

/**
 * Professional detail for a doctor MEMBERSHIP: biography, experience,
 * consultation fee, availability, specialties and languages.
 *
 * The aggregate is keyed on `membership_id`, not `profile_id`, because one person
 * may practise in several organizations and a fee, biography and availability
 * flag belong to the organization they practise in. Every write therefore also
 * carries `organization_id`, and the composite foreign key
 * `doctor_professional_details_membership_org_fk` makes an organization mismatch
 * a constraint violation rather than an application bug.
 *
 * Mutation shape follows `membership-repository.ts`: one transaction, fixed lock
 * order (membership row, then detail row), the actor's authority re-proved under
 * lock, an expected-version check, one `audit_logs` row and one `outbox_events`
 * row.
 *
 * There is no delete. A doctor who stops practising sets
 * `accepts_new_patients = false`, or their membership is revoked through the
 * membership aggregate. Deleting the detail row would orphan the specialty and
 * language children and erase the fee that past consultations were priced
 * against.
 */

/** Re-proved inside the write transaction; see `revalidateActor`. */
export interface DoctorDetailActor {
  readonly sessionId: string;
  readonly tokenHash: string;
}

export type DoctorDetailFailure =
  | 'actor_session_invalid'
  | 'membership_not_found'
  | 'membership_not_doctor'
  | 'version_conflict';

export interface DoctorDetailRecord {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly profileId: string;
  readonly membershipStatus: string;
  readonly verificationStatus: string | null;
  readonly biography: string | null;
  readonly yearsExperience: number;
  /** Integer MYR sen. Never a float, never another currency. */
  readonly consultationFeeSen: number;
  readonly currency: 'MYR';
  readonly acceptsNewPatients: boolean;
  readonly specialties: DoctorSpecialty[];
  readonly languages: string[];
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DoctorSpecialty {
  readonly code: string;
  readonly isPrimary: boolean;
}

export interface SaveDoctorDetailInput {
  readonly membershipId: string;
  readonly actorProfileId: string;
  readonly actor: DoctorDetailActor;
  readonly biography: string | null;
  readonly yearsExperience: number;
  readonly consultationFeeSen: number;
  readonly acceptsNewPatients: boolean;
  readonly specialties: readonly DoctorSpecialty[];
  readonly languages: readonly string[];
  /**
   * `0` creates the row; any other value must match the stored version. A
   * create-or-replace endpoint needs a single unambiguous rule for "I expect
   * there to be nothing there yet", and 0 is the version a fresh row is born
   * with.
   */
  readonly expectedVersion: number;
  /** Structured and PHI-free; see `DOCTOR_DETAIL_REASON_CODES`. */
  readonly reasonCode: DoctorDetailReasonCode;
  readonly now: Date;
  readonly correlationId: string;
}

export type SaveDoctorDetailResult = DoctorDetailRecord | DoctorDetailFailure;

interface DetailRow extends QueryResultRow {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly profileId: string;
  readonly membershipStatus: string;
  readonly verificationStatus: string | null;
  readonly biography: string | null;
  readonly yearsExperience: number;
  /**
   * `bigint` arrives from node-postgres as a string, because not every int8 fits
   * a JS number. It is projected as text and converted once, in `toRecord`, after
   * a safe-integer check — silently truncating a fee would be a money bug.
   */
  readonly consultationFeeSen: string;
  readonly currency: string;
  readonly acceptsNewPatients: boolean;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
interface SpecialtyRow extends QueryResultRow {
  readonly code: string;
  readonly isPrimary: boolean;
}
interface LanguageRow extends QueryResultRow { readonly code: string }
interface MembershipRow extends QueryResultRow {
  readonly organizationId: string;
  readonly profileId: string;
  readonly roleId: string;
  readonly status: string;
}

export class DoctorDetailRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * Reads one doctor's professional detail. Authorization is the caller's job:
   * this returns the row for any membership, and the service decides whether the
   * requester holds `doctor_detail:read:global` or owns the membership.
   */
  async findByMembershipId(membershipId: string): Promise<DoctorDetailRecord | undefined> {
    const detail = await this.database.query<DetailRow>(
      `${detailProjection()} WHERE detail.membership_id = $1`,
      [membershipId],
    );
    const row = detail.rows[0];
    if (row === undefined) return undefined;
    const specialties = await this.database.query<SpecialtyRow>(
      specialtyQuery(), [membershipId],
    );
    const languages = await this.database.query<LanguageRow>(
      languageQuery(), [membershipId],
    );
    return toRecord(row, specialties.rows, languages.rows.map((language) => language.code));
  }

  /**
   * Create-or-replace, in one transaction.
   *
   * Specialties and languages are replaced wholesale rather than diffed. A diff
   * would need its own ordering and conflict rules for two child tables whose
   * only content is a code, and "the set the doctor submitted is the set that is
   * stored" is both simpler to reason about and impossible to leave half-applied.
   */
  async save(input: SaveDoctorDetailInput): Promise<SaveDoctorDetailResult> {
    return this.database.transaction(async (client) => {
      // Fixed lock order: membership first, then the detail row. The membership
      // is also the row that proves the actor may write here at all, so locking
      // it first closes the window in which a revocation lands between the check
      // and the write.
      const membership = await client.query<MembershipRow>(
        `SELECT organization_id AS "organizationId", profile_id AS "profileId",
         role_id AS "roleId", status
         FROM organization_memberships WHERE membership_id = $1 FOR UPDATE`,
        [input.membershipId],
      );
      const owner = membership.rows[0];
      if (owner === undefined) return 'membership_not_found';

      const actorFailure = await this.revalidateActor(client, input, owner.profileId);
      if (actorFailure !== undefined) return actorFailure;

      // Deliberately reported as `membership_not_found` upstream: an actor who
      // does not own this membership must not learn its role or status from the
      // error they get back.
      if (owner.roleId !== 'doctor') return 'membership_not_doctor';
      if (owner.status !== 'active') return 'membership_not_doctor';

      const current = await client.query<{ readonly version: number }>(
        `SELECT version FROM doctor_professional_details
         WHERE membership_id = $1 FOR UPDATE`,
        [input.membershipId],
      );
      const existingVersion = current.rows[0]?.version;
      if (existingVersion === undefined) {
        if (input.expectedVersion !== 0) return 'version_conflict';
        await client.query(
          `INSERT INTO doctor_professional_details
           (membership_id, organization_id, biography, years_experience,
            consultation_fee_sen, currency, accepts_new_patients, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'MYR', $6, $7)`,
          [
            input.membershipId, owner.organizationId, input.biography,
            input.yearsExperience, input.consultationFeeSen,
            input.acceptsNewPatients, input.now,
          ],
        );
      } else {
        if (existingVersion !== input.expectedVersion) return 'version_conflict';
        const updated = await client.query(
          `UPDATE doctor_professional_details
           SET biography = $2, years_experience = $3, consultation_fee_sen = $4,
               accepts_new_patients = $5, version = version + 1, updated_at = $6
           WHERE membership_id = $1 AND version = $7`,
          [
            input.membershipId, input.biography, input.yearsExperience,
            input.consultationFeeSen, input.acceptsNewPatients, input.now,
            input.expectedVersion,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new Error('Concurrent doctor detail update was not serialized');
        }
      }

      await this.replaceSpecialties(client, input, owner.organizationId);
      await this.replaceLanguages(client, input, owner.organizationId);

      const record = await this.loadForUpdate(client, input.membershipId);
      if (record === undefined) throw new Error('Saved doctor detail could not be loaded');
      await this.record(client, record, input, existingVersion === undefined);
      return record;
    });
  }

  /**
   * Denial audit trail, mirroring `MembershipRepository.recordDenial`. Recorded
   * outside any transaction so a refused attempt survives the rollback of the
   * mutation it was refused for.
   */
  async recordDenial(
    membershipId: string | null,
    actorProfileId: string,
    action: string,
    code: string,
    correlationId: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(),
        (SELECT organization_id FROM organization_memberships
         WHERE membership_id = $1),
        $2, $3, 'doctor_professional_detail', $1, $4, $5, $6)`,
      [membershipId, actorProfileId, action, code, correlationId, {
        denial_code: code,
      }],
    );
  }

  /**
   * Re-proves the actor under lock: a live session, belonging to the profile that
   * owns the target membership, on a profile that is active and onboarded.
   *
   * Ownership is re-checked here and not only in the service because the service
   * check is a fast rejection. Between the guard and this write the session can be
   * revoked or the membership reassigned, and a fee or biography written by
   * someone else's session would be attributed to this doctor forever.
   */
  private async revalidateActor(
    client: PoolClient,
    input: SaveDoctorDetailInput,
    ownerProfileId: string,
  ): Promise<'actor_session_invalid' | undefined> {
    if (input.actorProfileId !== ownerProfileId) return 'actor_session_invalid';
    const result = await client.query<{
      readonly profileStatus: string;
      readonly onboardingCompletedAt: Date | null;
    }>(
      `SELECT profile.status AS "profileStatus",
       profile.onboarding_completed_at AS "onboardingCompletedAt"
       FROM app_sessions AS session
       JOIN profiles AS profile ON profile.profile_id = session.profile_id
       WHERE session.session_id = $1 AND session.token_hash = $2
         AND session.profile_id = $3
         AND session.status = 'active'
         AND session.idle_expires_at > $4 AND session.absolute_expires_at > $4
       FOR UPDATE OF session`,
      [input.actor.sessionId, input.actor.tokenHash, ownerProfileId, input.now],
    );
    const row = result.rows[0];
    if (row === undefined) return 'actor_session_invalid';
    // A doctor publishing a fee and biography is a post-onboarding act, unlike a
    // patient recording an emergency contact, so an incomplete onboarding is
    // rejected here rather than tolerated.
    if (row.profileStatus !== 'active' || row.onboardingCompletedAt === null) {
      return 'actor_session_invalid';
    }
    return undefined;
  }

  private async replaceSpecialties(
    client: PoolClient,
    input: SaveDoctorDetailInput,
    organizationId: string,
  ): Promise<void> {
    await client.query(
      `DELETE FROM doctor_professional_specialties WHERE membership_id = $1`,
      [input.membershipId],
    );
    // Inserted in code order so the lock sequence on the child table is
    // deterministic across concurrent saves for different doctors.
    for (const specialty of [...input.specialties].sort(byCode)) {
      await client.query(
        `INSERT INTO doctor_professional_specialties
         (membership_id, organization_id, specialty_code, is_primary)
         VALUES ($1, $2, $3, $4)`,
        [input.membershipId, organizationId, specialty.code, specialty.isPrimary],
      );
    }
  }

  private async replaceLanguages(
    client: PoolClient,
    input: SaveDoctorDetailInput,
    organizationId: string,
  ): Promise<void> {
    await client.query(
      `DELETE FROM doctor_professional_languages WHERE membership_id = $1`,
      [input.membershipId],
    );
    for (const code of [...input.languages].sort()) {
      await client.query(
        `INSERT INTO doctor_professional_languages
         (membership_id, organization_id, language_code)
         VALUES ($1, $2, $3)`,
        [input.membershipId, organizationId, code],
      );
    }
  }

  private async loadForUpdate(
    client: PoolClient,
    membershipId: string,
  ): Promise<DoctorDetailRecord | undefined> {
    const detail = await client.query<DetailRow>(
      `${detailProjection()} WHERE detail.membership_id = $1 FOR UPDATE OF detail`,
      [membershipId],
    );
    const row = detail.rows[0];
    if (row === undefined) return undefined;
    const specialties = await client.query<SpecialtyRow>(specialtyQuery(), [membershipId]);
    const languages = await client.query<LanguageRow>(languageQuery(), [membershipId]);
    return toRecord(row, specialties.rows, languages.rows.map((language) => language.code));
  }

  /**
   * Single writer for the audit row and the published event.
   *
   * Neither carries a biography. A biography is free text a doctor typed, and
   * free text is exactly what must not enter a broadly retained audit log or an
   * event payload — a practitioner describing their special interest in a
   * condition can name a patient's condition. Counts and flags go instead.
   */
  private async record(
    client: PoolClient,
    record: DoctorDetailRecord,
    input: SaveDoctorDetailInput,
    created: boolean,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, $3, 'doctor_professional_detail', $4, $5, $6, $7)`,
      [
        record.organizationId,
        input.actorProfileId,
        created ? 'doctor_detail.created' : 'doctor_detail.updated',
        record.membershipId,
        input.reasonCode,
        input.correlationId,
        {
          version: record.version,
          accepts_new_patients: record.acceptsNewPatients,
          consultation_fee_sen: record.consultationFeeSen,
          specialty_count: record.specialties.length,
          language_count: record.languages.length,
        },
      ],
    );
    await client.query(
      `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, payload, correlation_id, occurred_at)
       VALUES (uuidv7(), $1, $2, 'doctor_detail', $3, $4, $5, $6, $7)`,
      [
        DOCTOR_DETAIL_CHANGED_EVENT_TYPE,
        DOCTOR_DETAIL_CHANGED_EVENT_VERSION,
        record.membershipId,
        record.version,
        // Must match `DoctorDetailChangedData` in the AsyncAPI document, which
        // sets additionalProperties: false. `accepts_new_patients` is included
        // because a directory cache has to know availability flipped; the
        // biography and fee are not, so a subscriber refetches for content.
        {
          membership_id: record.membershipId,
          organization_id: record.organizationId,
          change: created ? 'created' : 'updated',
          accepts_new_patients: record.acceptsNewPatients,
        },
        input.correlationId,
        input.now,
      ],
    );
  }
}

function byCode(left: DoctorSpecialty, right: DoctorSpecialty): number {
  return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
}

function toRecord(
  row: DetailRow,
  specialties: readonly SpecialtyRow[],
  languages: readonly string[],
): DoctorDetailRecord {
  const feeSen = Number(row.consultationFeeSen);
  // The column check constraint caps the fee well inside the safe-integer range,
  // so a value outside it means the row was written by something that bypassed
  // the constraint. Failing loudly beats returning a rounded price.
  if (!Number.isSafeInteger(feeSen) || feeSen < 0) {
    throw new Error('Doctor consultation fee is not a safe integer number of sen');
  }
  if (row.currency !== 'MYR') {
    throw new Error(`Unsupported doctor consultation currency: ${row.currency}`);
  }
  return {
    membershipId: row.membershipId,
    organizationId: row.organizationId,
    profileId: row.profileId,
    membershipStatus: row.membershipStatus,
    verificationStatus: row.verificationStatus,
    biography: row.biography,
    yearsExperience: row.yearsExperience,
    consultationFeeSen: feeSen,
    currency: 'MYR',
    acceptsNewPatients: row.acceptsNewPatients,
    specialties: specialties.map((specialty) => ({
      code: specialty.code,
      isPrimary: specialty.isPrimary,
    })),
    languages: [...languages],
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function detailProjection(): string {
  return `SELECT detail.membership_id AS "membershipId",
   detail.organization_id AS "organizationId",
   membership.profile_id AS "profileId",
   membership.status AS "membershipStatus",
   membership.verification_status AS "verificationStatus",
   detail.biography, detail.years_experience AS "yearsExperience",
   detail.consultation_fee_sen::text AS "consultationFeeSen",
   detail.currency, detail.accepts_new_patients AS "acceptsNewPatients",
   detail.version, detail.created_at AS "createdAt", detail.updated_at AS "updatedAt"
   FROM doctor_professional_details detail
   JOIN organization_memberships membership
     ON membership.membership_id = detail.membership_id
    AND membership.organization_id = detail.organization_id`;
}

function specialtyQuery(): string {
  return `SELECT specialty_code AS code, is_primary AS "isPrimary"
   FROM doctor_professional_specialties
   WHERE membership_id = $1
   ORDER BY is_primary DESC, specialty_code`;
}

function languageQuery(): string {
  return `SELECT language_code AS code FROM doctor_professional_languages
   WHERE membership_id = $1 ORDER BY language_code`;
}
