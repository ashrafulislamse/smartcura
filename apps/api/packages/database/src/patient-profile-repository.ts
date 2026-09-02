import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  PROFILE_DETAIL_CHANGED_EVENT_TYPE,
  PROFILE_DETAIL_CHANGED_EVENT_VERSION,
  type ProfileDetailChangeType,
  type ProfileDetailKind,
  type ProfileDetailReasonCode,
} from './profile-detail-events.js';

/**
 * Extended patient profile data: addresses, emergency contacts, allergies and
 * conditions.
 *
 * Every mutation in this repository follows the shape established by
 * `membership-repository.ts`:
 *   1. one transaction per mutation, never a read-then-write across two;
 *   2. a fixed lock order — the owning profile row first, then the detail row —
 *      so concurrent mutations on one profile cannot deadlock each other;
 *   3. the actor's authority is re-proved under lock, because the HTTP guard ran
 *      earlier and the session can be revoked or the profile suspended in
 *      between (a time-of-check-to-time-of-use hazard);
 *   4. optimistic concurrency through the row's `version`, so a stale writer is
 *      rejected instead of silently overwriting a concurrent edit;
 *   5. one `audit_logs` row and one `outbox_events` row, written inside the same
 *      transaction as the change.
 *
 * DELETE SEMANTICS, stated deliberately per table:
 *   * `patient_allergies` and `patient_conditions` are SOFT deleted (`deleted_at`).
 *     A clinician may already have prescribed against a recorded allergy, so the
 *     fact that it existed is clinical history and destroying it destroys
 *     evidence.
 *   * `patient_addresses` and `patient_emergency_contacts` are HARD deleted. A
 *     removed emergency contact must genuinely stop being called, and a retained
 *     archived row invites a dispatch path that forgets the archive predicate.
 *     The audit log carries the removal.
 *
 * NO PHI leaves this module in an audit `reason`, audit `metadata` or event
 * payload. Substances, condition names, reactions and notes never appear:
 * identifiers, structured enums and counts do. Subscribers that need content
 * refetch through the authorized REST endpoint, which is the only place the
 * object policy is applied.
 */

/**
 * Everything needed to re-prove a self-service actor's authority *inside* the
 * mutation transaction. There is no administrative variant: this repository only
 * ever serves a profile acting on its own rows, and modelling a second actor kind
 * would create a code path that could reach another profile's data.
 */
export interface SelfDetailActor {
  readonly sessionId: string;
  readonly tokenHash: string;
}

export type DetailActorFailure = 'actor_session_invalid' | 'profile_blocked';

export type DetailMutationFailure =
  | DetailActorFailure
  | 'not_found'
  | 'version_conflict'
  | 'duplicate';

export interface PatientDetailMutationContext {
  readonly profileId: string;
  readonly actor: SelfDetailActor;
  /** Structured and PHI-free; see `PROFILE_DETAIL_REASON_CODES`. */
  readonly reasonCode: ProfileDetailReasonCode;
  readonly now: Date;
  readonly correlationId: string;
}

export interface PatientAddressFields {
  readonly label: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly postcode: string;
  readonly countryCode: string;
  readonly isPrimary: boolean;
  /**
   * Decimal strings, not numbers. The column is `numeric` and node-postgres
   * hands numerics back as strings; parsing them into a JS float here would
   * reintroduce exactly the representation error the column type avoids.
   */
  readonly latitude: string | null;
  readonly longitude: string | null;
}

export interface PatientEmergencyContactFields {
  readonly name: string;
  readonly relationship: string;
  readonly phoneE164: string;
  readonly isPrimary: boolean;
}

export interface PatientAllergyFields {
  readonly substance: string;
  readonly reaction: string | null;
  readonly severity: 'mild' | 'moderate' | 'severe' | 'life_threatening';
  readonly recordedAt: Date;
  readonly notedByProfileId: string | null;
}

export interface PatientConditionFields {
  readonly conditionName: string;
  readonly status: 'active' | 'resolved' | 'in_remission';
  /** ISO `YYYY-MM-DD`, or null. */
  readonly onsetDate: string | null;
  readonly resolvedDate: string | null;
  readonly notes: string | null;
}

export type CreateAddressInput = PatientDetailMutationContext & PatientAddressFields;
export type UpdateAddressInput = CreateAddressInput & {
  readonly addressId: string;
  readonly expectedVersion: number;
};
export type CreateEmergencyContactInput =
  PatientDetailMutationContext & PatientEmergencyContactFields;
export type UpdateEmergencyContactInput = CreateEmergencyContactInput & {
  readonly contactId: string;
  readonly expectedVersion: number;
};
export type CreateAllergyInput = PatientDetailMutationContext & PatientAllergyFields;
export type UpdateAllergyInput = CreateAllergyInput & {
  readonly allergyId: string;
  readonly expectedVersion: number;
};
export type CreateConditionInput = PatientDetailMutationContext & PatientConditionFields;
export type UpdateConditionInput = CreateConditionInput & {
  readonly conditionId: string;
  readonly expectedVersion: number;
};
export interface RemoveDetailInput extends PatientDetailMutationContext {
  readonly detailId: string;
  readonly expectedVersion: number;
}

export interface PatientAddressRecord extends PatientAddressFields {
  readonly addressId: string;
  readonly profileId: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PatientEmergencyContactRecord extends PatientEmergencyContactFields {
  readonly contactId: string;
  readonly profileId: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PatientAllergyRecord extends PatientAllergyFields {
  readonly allergyId: string;
  readonly profileId: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PatientConditionRecord extends PatientConditionFields {
  readonly conditionId: string;
  readonly profileId: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type AddressMutationResult = PatientAddressRecord | DetailMutationFailure;
export type EmergencyContactMutationResult =
  PatientEmergencyContactRecord | DetailMutationFailure;
export type AllergyMutationResult = PatientAllergyRecord | DetailMutationFailure;
export type ConditionMutationResult = PatientConditionRecord | DetailMutationFailure;
export type RemoveDetailResult = 'removed' | DetailMutationFailure;

interface AddressRow extends QueryResultRow, PatientAddressRecord {}
interface ContactRow extends QueryResultRow, PatientEmergencyContactRecord {}
interface AllergyRow extends QueryResultRow, PatientAllergyRecord {}
interface ConditionRow extends QueryResultRow, PatientConditionRecord {}
interface VersionRow extends QueryResultRow { readonly version: number }

/** Postgres unique-violation. A duplicate is a client error, not a server fault. */
const UNIQUE_VIOLATION = '23505';

export class PatientProfileRepository {
  constructor(private readonly database: PostgresConnection) {}

  // -------------------------------------------------------------------------
  // Addresses
  // -------------------------------------------------------------------------

  async listAddresses(profileId: string): Promise<PatientAddressRecord[]> {
    const result = await this.database.query<AddressRow>(
      `${addressProjection()} WHERE profile_id = $1
       ORDER BY is_primary DESC, created_at, address_id`,
      [profileId],
    );
    return result.rows;
  }

  async createAddress(input: CreateAddressInput): Promise<AddressMutationResult> {
    return this.mutate(input, async (client) => {
      if (input.isPrimary) await this.demoteAddresses(client, input, null);
      const inserted = await insertOrDuplicate(client, {
        text: `INSERT INTO patient_addresses
         (address_id, profile_id, label, line1, line2, city, state, postcode,
          country_code, is_primary, latitude, longitude, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING address_id AS "insertedId"`,
        values: [
          input.profileId, input.label, input.line1, input.line2, input.city,
          input.state, input.postcode, input.countryCode, input.isPrimary,
          input.latitude, input.longitude, input.now,
        ],
      });
      if (inserted === 'duplicate') return 'duplicate';
      const record = await this.loadAddress(client, input.profileId, inserted, true);
      if (record === undefined) throw new Error('Created address could not be loaded');
      await this.record(client, input, 'address', record.addressId, 'created', record.version);
      return record;
    });
  }

  async updateAddress(input: UpdateAddressInput): Promise<AddressMutationResult> {
    return this.mutate(input, async (client) => {
      const current = await this.loadAddress(client, input.profileId, input.addressId, true);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      if (input.isPrimary && !current.isPrimary) {
        await this.demoteAddresses(client, input, input.addressId);
      }
      const updated = await updateOrDuplicate<AddressRow>(client, {
        text: `UPDATE patient_addresses
         SET label = $3, line1 = $4, line2 = $5, city = $6, state = $7,
             postcode = $8, country_code = $9, is_primary = $10, latitude = $11,
             longitude = $12, version = version + 1, updated_at = $13
         WHERE address_id = $1 AND profile_id = $2 AND version = $14
         RETURNING ${addressColumns()}`,
        values: [
          input.addressId, input.profileId, input.label, input.line1, input.line2,
          input.city, input.state, input.postcode, input.countryCode, input.isPrimary,
          input.latitude, input.longitude, input.now, input.expectedVersion,
        ],
      });
      if (updated === 'duplicate') return 'duplicate';
      if (updated === undefined) throw new Error('Concurrent address update was not serialized');
      await this.record(client, input, 'address', updated.addressId, 'updated', updated.version);
      return updated;
    });
  }

  /**
   * Hard delete. See the delete-semantics note at the top of this file: an
   * address is contact data, and a removed one must not linger behind an archive
   * predicate that a future dispatch query might forget.
   *
   * A hard delete has no post-state to version, so the published event carries
   * `expectedVersion + 1`. Keeping the aggregate version monotonic matters to any
   * consumer ordering events per aggregate: reusing the pre-delete version would
   * make the removal look like a replay of the last update.
   */
  async removeAddress(input: RemoveDetailInput): Promise<RemoveDetailResult> {
    return this.mutate(input, async (client) => {
      const current = await this.loadAddress(client, input.profileId, input.detailId, true);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      await client.query(
        `DELETE FROM patient_addresses WHERE address_id = $1 AND profile_id = $2`,
        [input.detailId, input.profileId],
      );
      await this.record(
        client, input, 'address', input.detailId, 'removed', input.expectedVersion + 1,
      );
      return 'removed';
    });
  }

  // -------------------------------------------------------------------------
  // Emergency contacts
  // -------------------------------------------------------------------------

  async listEmergencyContacts(profileId: string): Promise<PatientEmergencyContactRecord[]> {
    const result = await this.database.query<ContactRow>(
      `${contactProjection()} WHERE profile_id = $1
       ORDER BY is_primary DESC, created_at, contact_id`,
      [profileId],
    );
    return result.rows;
  }

  async createEmergencyContact(
    input: CreateEmergencyContactInput,
  ): Promise<EmergencyContactMutationResult> {
    return this.mutate(input, async (client) => {
      if (input.isPrimary) await this.demoteContacts(client, input, null);
      const inserted = await insertOrDuplicate(client, {
        text: `INSERT INTO patient_emergency_contacts
         (contact_id, profile_id, name, relationship, phone_e164, is_primary, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6)
         RETURNING contact_id AS "insertedId"`,
        values: [
          input.profileId, input.name, input.relationship, input.phoneE164,
          input.isPrimary, input.now,
        ],
      });
      if (inserted === 'duplicate') return 'duplicate';
      const record = await this.loadContact(client, input.profileId, inserted, true);
      if (record === undefined) throw new Error('Created emergency contact could not be loaded');
      await this.record(
        client, input, 'emergency_contact', record.contactId, 'created', record.version,
      );
      return record;
    });
  }

  async updateEmergencyContact(
    input: UpdateEmergencyContactInput,
  ): Promise<EmergencyContactMutationResult> {
    return this.mutate(input, async (client) => {
      const current = await this.loadContact(client, input.profileId, input.contactId, true);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      if (input.isPrimary && !current.isPrimary) {
        await this.demoteContacts(client, input, input.contactId);
      }
      const updated = await updateOrDuplicate<ContactRow>(client, {
        text: `UPDATE patient_emergency_contacts
         SET name = $3, relationship = $4, phone_e164 = $5, is_primary = $6,
             version = version + 1, updated_at = $7
         WHERE contact_id = $1 AND profile_id = $2 AND version = $8
         RETURNING ${contactColumns()}`,
        values: [
          input.contactId, input.profileId, input.name, input.relationship,
          input.phoneE164, input.isPrimary, input.now, input.expectedVersion,
        ],
      });
      if (updated === 'duplicate') return 'duplicate';
      if (updated === undefined) throw new Error('Concurrent contact update was not serialized');
      await this.record(
        client, input, 'emergency_contact', updated.contactId, 'updated', updated.version,
      );
      return updated;
    });
  }

  /** Hard delete: a removed emergency contact must genuinely stop being called. */
  async removeEmergencyContact(input: RemoveDetailInput): Promise<RemoveDetailResult> {
    return this.mutate(input, async (client) => {
      const current = await this.loadContact(client, input.profileId, input.detailId, true);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      await client.query(
        `DELETE FROM patient_emergency_contacts WHERE contact_id = $1 AND profile_id = $2`,
        [input.detailId, input.profileId],
      );
      await this.record(
        client, input, 'emergency_contact', input.detailId, 'removed',
        input.expectedVersion + 1,
      );
      return 'removed';
    });
  }

  // -------------------------------------------------------------------------
  // Allergies
  // -------------------------------------------------------------------------

  async listAllergies(profileId: string): Promise<PatientAllergyRecord[]> {
    const result = await this.database.query<AllergyRow>(
      `${allergyProjection()} WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY recorded_at DESC, allergy_id`,
      [profileId],
    );
    return result.rows;
  }

  async createAllergy(input: CreateAllergyInput): Promise<AllergyMutationResult> {
    return this.mutate(input, async (client) => {
      const inserted = await insertOrDuplicate(client, {
        text: `INSERT INTO patient_allergies
         (allergy_id, profile_id, substance, reaction, severity, recorded_at,
          noted_by_profile_id, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7)
         RETURNING allergy_id AS "insertedId"`,
        values: [
          input.profileId, input.substance, input.reaction, input.severity,
          input.recordedAt, input.notedByProfileId, input.now,
        ],
      });
      if (inserted === 'duplicate') return 'duplicate';
      const record = await this.loadAllergy(client, input.profileId, inserted, true);
      if (record === undefined) throw new Error('Created allergy could not be loaded');
      await this.record(client, input, 'allergy', record.allergyId, 'created', record.version);
      return record;
    });
  }

  async updateAllergy(input: UpdateAllergyInput): Promise<AllergyMutationResult> {
    return this.mutate(input, async (client) => {
      const current = await this.loadAllergy(client, input.profileId, input.allergyId, true);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      const updated = await updateOrDuplicate<AllergyRow>(client, {
        text: `UPDATE patient_allergies
         SET substance = $3, reaction = $4, severity = $5, recorded_at = $6,
             noted_by_profile_id = $7, version = version + 1, updated_at = $8
         WHERE allergy_id = $1 AND profile_id = $2 AND deleted_at IS NULL
           AND version = $9
         RETURNING ${allergyColumns()}`,
        values: [
          input.allergyId, input.profileId, input.substance, input.reaction,
          input.severity, input.recordedAt, input.notedByProfileId, input.now,
          input.expectedVersion,
        ],
      });
      if (updated === 'duplicate') return 'duplicate';
      if (updated === undefined) throw new Error('Concurrent allergy update was not serialized');
      await this.record(client, input, 'allergy', updated.allergyId, 'updated', updated.version);
      return updated;
    });
  }

  /**
   * Soft delete. An allergy that a clinician has already seen or prescribed
   * against is clinical history; removing the row would erase the fact that it
   * was ever recorded, which is the evidence a later review depends on.
   */
  async removeAllergy(input: RemoveDetailInput): Promise<RemoveDetailResult> {
    return this.mutate(input, async (client) => {
      const current = await this.loadAllergy(client, input.profileId, input.detailId, true);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      const result = await client.query<VersionRow>(
        `UPDATE patient_allergies
         SET deleted_at = $3, version = version + 1, updated_at = $3
         WHERE allergy_id = $1 AND profile_id = $2 AND deleted_at IS NULL
           AND version = $4
         RETURNING version`,
        [input.detailId, input.profileId, input.now, input.expectedVersion],
      );
      const version = result.rows[0]?.version;
      if (version === undefined) throw new Error('Concurrent allergy delete was not serialized');
      await this.record(client, input, 'allergy', input.detailId, 'removed', version);
      return 'removed';
    });
  }

  // -------------------------------------------------------------------------
  // Conditions
  // -------------------------------------------------------------------------

  async listConditions(profileId: string): Promise<PatientConditionRecord[]> {
    const result = await this.database.query<ConditionRow>(
      `${conditionProjection()} WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC, condition_id`,
      [profileId],
    );
    return result.rows;
  }

  async createCondition(input: CreateConditionInput): Promise<ConditionMutationResult> {
    return this.mutate(input, async (client) => {
      const inserted = await insertOrDuplicate(client, {
        text: `INSERT INTO patient_conditions
         (condition_id, profile_id, condition_name, status, onset_date,
          resolved_date, notes, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7)
         RETURNING condition_id AS "insertedId"`,
        values: [
          input.profileId, input.conditionName, input.status, input.onsetDate,
          input.resolvedDate, input.notes, input.now,
        ],
      });
      if (inserted === 'duplicate') return 'duplicate';
      const record = await this.loadCondition(client, input.profileId, inserted, true);
      if (record === undefined) throw new Error('Created condition could not be loaded');
      await this.record(
        client, input, 'condition', record.conditionId, 'created', record.version,
      );
      return record;
    });
  }

  async updateCondition(input: UpdateConditionInput): Promise<ConditionMutationResult> {
    return this.mutate(input, async (client) => {
      const current = await this.loadCondition(client, input.profileId, input.conditionId, true);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      const updated = await updateOrDuplicate<ConditionRow>(client, {
        text: `UPDATE patient_conditions
         SET condition_name = $3, status = $4, onset_date = $5, resolved_date = $6,
             notes = $7, version = version + 1, updated_at = $8
         WHERE condition_id = $1 AND profile_id = $2 AND deleted_at IS NULL
           AND version = $9
         RETURNING ${conditionColumns()}`,
        values: [
          input.conditionId, input.profileId, input.conditionName, input.status,
          input.onsetDate, input.resolvedDate, input.notes, input.now,
          input.expectedVersion,
        ],
      });
      if (updated === 'duplicate') return 'duplicate';
      if (updated === undefined) throw new Error('Concurrent condition update was not serialized');
      await this.record(
        client, input, 'condition', updated.conditionId, 'updated', updated.version,
      );
      return updated;
    });
  }

  /** Soft delete, for the same reason as `removeAllergy`. */
  async removeCondition(input: RemoveDetailInput): Promise<RemoveDetailResult> {
    return this.mutate(input, async (client) => {
      const current = await this.loadCondition(client, input.profileId, input.detailId, true);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      const result = await client.query<VersionRow>(
        `UPDATE patient_conditions
         SET deleted_at = $3, version = version + 1, updated_at = $3
         WHERE condition_id = $1 AND profile_id = $2 AND deleted_at IS NULL
           AND version = $4
         RETURNING version`,
        [input.detailId, input.profileId, input.now, input.expectedVersion],
      );
      const version = result.rows[0]?.version;
      if (version === undefined) throw new Error('Concurrent condition delete was not serialized');
      await this.record(client, input, 'condition', input.detailId, 'removed', version);
      return 'removed';
    });
  }

  /**
   * Denial audit trail. Mirrors `MembershipRepository.recordDenial`: a refused
   * attempt on someone's health data is exactly the event a security review needs
   * to see, so it is recorded outside the failed transaction.
   *
   * `organization_id` is null because extended profile data is owned by a
   * platform-level profile, not by an organization.
   */
  async recordDenial(
    profileId: string,
    kind: ProfileDetailKind | null,
    detailId: string | null,
    action: string,
    code: string,
    correlationId: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_logs
       (audit_id, actor_profile_id, action, object_type, object_id, reason,
        correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7)`,
      [
        profileId, action, objectType(kind), detailId, code, correlationId,
        { denial_code: code, ...(kind === null ? {} : { detail_kind: kind }) },
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Shared internals
  // -------------------------------------------------------------------------

  /**
   * One transaction, fixed lock order, actor re-proved under lock.
   *
   * The profile row is locked FOR UPDATE before any detail row is touched. That
   * ordering does two jobs: it makes the lock sequence identical for every
   * mutation on a profile (so two concurrent edits queue instead of deadlocking),
   * and it serialises the "at most one primary" reassignment, which spans two
   * statements and would otherwise interleave.
   */
  private async mutate<Result>(
    context: PatientDetailMutationContext,
    operation: (client: PoolClient) => Promise<Result>,
  ): Promise<Result | DetailActorFailure> {
    return this.database.transaction(async (client) => {
      const failure = await this.revalidateActor(client, context);
      if (failure !== undefined) return failure;
      return operation(client);
    });
  }

  /**
   * Re-proves, while holding locks, every condition the HTTP guards checked: a
   * live session, that the session belongs to the profile being mutated, and a
   * profile that is not suspended or deactivated.
   *
   * The `session.profile_id = $3` predicate is the load-bearing one. It is what
   * makes cross-profile writes impossible even if a future controller passes an
   * attacker-supplied profile id, and it is checked here rather than only in the
   * service because the service's check is a fast rejection, not a guarantee.
   */
  private async revalidateActor(
    client: PoolClient,
    context: PatientDetailMutationContext,
  ): Promise<DetailActorFailure | undefined> {
    const result = await client.query<{ readonly profileStatus: string }>(
      `SELECT profile.status AS "profileStatus"
       FROM app_sessions AS session
       JOIN profiles AS profile ON profile.profile_id = session.profile_id
       WHERE session.session_id = $1 AND session.token_hash = $2
         AND session.profile_id = $3
         AND session.status = 'active'
         AND session.idle_expires_at > $4 AND session.absolute_expires_at > $4
       FOR UPDATE OF session, profile`,
      [context.actor.sessionId, context.actor.tokenHash, context.profileId, context.now],
    );
    const row = result.rows[0];
    if (row === undefined) return 'actor_session_invalid';
    // `pending` is accepted: addresses and emergency contacts are collected
    // during onboarding, before the profile becomes active.
    if (row.profileStatus !== 'active' && row.profileStatus !== 'pending') {
      return 'profile_blocked';
    }
    return undefined;
  }

  /**
   * Clears any existing primary address so the partial unique index cannot
   * reject the promotion. Runs under the profile lock taken in `mutate`, so no
   * concurrent writer can slip a second primary in between.
   */
  private async demoteAddresses(
    client: PoolClient,
    context: PatientDetailMutationContext,
    keepAddressId: string | null,
  ): Promise<void> {
    await client.query(
      `UPDATE patient_addresses
       SET is_primary = false, version = version + 1, updated_at = $2
       WHERE profile_id = $1 AND is_primary
         AND ($3::uuid IS NULL OR address_id <> $3)`,
      [context.profileId, context.now, keepAddressId],
    );
  }

  private async demoteContacts(
    client: PoolClient,
    context: PatientDetailMutationContext,
    keepContactId: string | null,
  ): Promise<void> {
    await client.query(
      `UPDATE patient_emergency_contacts
       SET is_primary = false, version = version + 1, updated_at = $2
       WHERE profile_id = $1 AND is_primary
         AND ($3::uuid IS NULL OR contact_id <> $3)`,
      [context.profileId, context.now, keepContactId],
    );
  }

  private async loadAddress(
    client: PoolClient,
    profileId: string,
    addressId: string,
    lock: boolean,
  ): Promise<PatientAddressRecord | undefined> {
    const result = await client.query<AddressRow>(
      `${addressProjection()} WHERE address_id = $1 AND profile_id = $2
       ${lock ? 'FOR UPDATE' : ''}`,
      [addressId, profileId],
    );
    return result.rows[0];
  }

  private async loadContact(
    client: PoolClient,
    profileId: string,
    contactId: string,
    lock: boolean,
  ): Promise<PatientEmergencyContactRecord | undefined> {
    const result = await client.query<ContactRow>(
      `${contactProjection()} WHERE contact_id = $1 AND profile_id = $2
       ${lock ? 'FOR UPDATE' : ''}`,
      [contactId, profileId],
    );
    return result.rows[0];
  }

  private async loadAllergy(
    client: PoolClient,
    profileId: string,
    allergyId: string,
    lock: boolean,
  ): Promise<PatientAllergyRecord | undefined> {
    const result = await client.query<AllergyRow>(
      `${allergyProjection()} WHERE allergy_id = $1 AND profile_id = $2
         AND deleted_at IS NULL
       ${lock ? 'FOR UPDATE' : ''}`,
      [allergyId, profileId],
    );
    return result.rows[0];
  }

  private async loadCondition(
    client: PoolClient,
    profileId: string,
    conditionId: string,
    lock: boolean,
  ): Promise<PatientConditionRecord | undefined> {
    const result = await client.query<ConditionRow>(
      `${conditionProjection()} WHERE condition_id = $1 AND profile_id = $2
         AND deleted_at IS NULL
       ${lock ? 'FOR UPDATE' : ''}`,
      [conditionId, profileId],
    );
    return result.rows[0];
  }

  /**
   * Single writer for both the audit row and the published event, so no mutation
   * path can record one without the other.
   *
   * The audit metadata carries identifiers, enums and versions only. A substance,
   * condition name, reaction or note would be clinical content in a broadly
   * retained log, which is the precise leak `PROFILE_DETAIL_REASON_CODES` exists
   * to prevent on the reason field.
   */
  private async record(
    client: PoolClient,
    context: PatientDetailMutationContext,
    kind: ProfileDetailKind,
    detailId: string,
    change: ProfileDetailChangeType,
    aggregateVersion: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, actor_profile_id, action, object_type, object_id, reason,
        correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7)`,
      [
        context.profileId,
        `profile_detail.${kind}.${change}`,
        objectType(kind),
        detailId,
        context.reasonCode,
        context.correlationId,
        { detail_kind: kind, change, version: aggregateVersion },
      ],
    );
    await client.query(
      `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, payload, correlation_id, occurred_at)
       VALUES (uuidv7(), $1, $2, 'profile_detail', $3, $4, $5, $6, $7)`,
      [
        PROFILE_DETAIL_CHANGED_EVENT_TYPE,
        PROFILE_DETAIL_CHANGED_EVENT_VERSION,
        detailId,
        aggregateVersion,
        // Must match `ProfileDetailChangedData` in the AsyncAPI document, which
        // sets additionalProperties: false. Four fields, none of them clinical:
        // the event says a list changed, and the subscriber refetches through the
        // authorized endpoint.
        {
          profile_id: context.profileId,
          detail_kind: kind,
          detail_id: detailId,
          change,
        },
        context.correlationId,
        context.now,
      ],
    );
  }
}

function objectType(kind: ProfileDetailKind | null): string {
  switch (kind) {
    case 'address': return 'patient_address';
    case 'emergency_contact': return 'patient_emergency_contact';
    case 'allergy': return 'patient_allergy';
    case 'condition': return 'patient_condition';
    case null: return 'patient_profile_detail';
  }
}

interface Statement {
  readonly text: string;
  readonly values: readonly unknown[];
}

/**
 * Runs an INSERT that may collide with a partial unique index and reports the
 * collision as a client-visible outcome. Catching the SQLSTATE is the only
 * race-free way to do this: a pre-check would leave a window in which a
 * concurrent insert claims the same slot.
 */
async function insertOrDuplicate(
  client: PoolClient,
  statement: Statement,
): Promise<string | 'duplicate'> {
  try {
    const result = await client.query<{ readonly insertedId: string }>(
      statement.text,
      [...statement.values],
    );
    const id = result.rows[0]?.insertedId;
    if (id === undefined) throw new Error('Insert returned no identifier');
    return id;
  } catch (error) {
    if (isUniqueViolation(error)) return 'duplicate';
    throw error;
  }
}

async function updateOrDuplicate<Row extends QueryResultRow>(
  client: PoolClient,
  statement: Statement,
): Promise<Row | 'duplicate' | undefined> {
  try {
    const result = await client.query<Row>(statement.text, [...statement.values]);
    return result.rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) return 'duplicate';
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    (error as { readonly code?: unknown }).code === UNIQUE_VIOLATION;
}

function addressColumns(): string {
  return `address_id AS "addressId", profile_id AS "profileId", label,
   line1 AS "line1", line2 AS "line2", city, state, postcode,
   country_code AS "countryCode", is_primary AS "isPrimary",
   latitude::text AS latitude, longitude::text AS longitude, version,
   created_at AS "createdAt", updated_at AS "updatedAt"`;
}

function addressProjection(): string {
  return `SELECT ${addressColumns()} FROM patient_addresses`;
}

function contactColumns(): string {
  return `contact_id AS "contactId", profile_id AS "profileId", name, relationship,
   phone_e164 AS "phoneE164", is_primary AS "isPrimary", version,
   created_at AS "createdAt", updated_at AS "updatedAt"`;
}

function contactProjection(): string {
  return `SELECT ${contactColumns()} FROM patient_emergency_contacts`;
}

function allergyColumns(): string {
  return `allergy_id AS "allergyId", profile_id AS "profileId", substance, reaction,
   severity, recorded_at AS "recordedAt",
   noted_by_profile_id AS "notedByProfileId", version,
   created_at AS "createdAt", updated_at AS "updatedAt"`;
}

function allergyProjection(): string {
  return `SELECT ${allergyColumns()} FROM patient_allergies`;
}

/**
 * `date` columns are projected with `to_char`, not the default parser. A bare
 * `date` comes back as a JS `Date` at local midnight, which shifts to the
 * previous day for any server running west of UTC. An onset date is a calendar
 * fact, so it stays a calendar string end to end.
 */
function conditionColumns(): string {
  return `condition_id AS "conditionId", profile_id AS "profileId",
   condition_name AS "conditionName", status,
   to_char(onset_date, 'YYYY-MM-DD') AS "onsetDate",
   to_char(resolved_date, 'YYYY-MM-DD') AS "resolvedDate", notes, version,
   created_at AS "createdAt", updated_at AS "updatedAt"`;
}

function conditionProjection(): string {
  return `SELECT ${conditionColumns()} FROM patient_conditions`;
}
