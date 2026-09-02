import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import type { SessionProfileRecord } from './session-repository.js';
import {
  PROFILE_CHANGED_EVENT_TYPE,
  PROFILE_CHANGED_EVENT_VERSION,
} from './events.js';

export interface UpdateOwnProfileInput {
  readonly profileId: string;
  readonly displayName?: string;
  readonly phoneE164?: string | null;
  readonly preferredLocale?: string;
  readonly timezone?: string;
  readonly completeOnboarding?: true;
  readonly now: Date;
  readonly correlationId: string;
}

export type UpdateOwnProfileResult =
  | SessionProfileRecord
  | 'profile_blocked'
  | 'profile_not_found';

interface ProfileRow extends QueryResultRow, SessionProfileRecord {}

export class ProfileRepository {
  constructor(private readonly database: PostgresConnection) {}

  async findById(profileId: string): Promise<SessionProfileRecord | undefined> {
    const result = await this.database.query<ProfileRow>(
      `${profileProjection()} FROM profiles WHERE profile_id = $1`,
      [profileId],
    );
    return result.rows[0];
  }

  async updateOwn(input: UpdateOwnProfileInput): Promise<UpdateOwnProfileResult> {
    return this.database.transaction(async (client) => {
      const current = await this.lockProfile(client, input.profileId);
      if (current === undefined) return 'profile_not_found';
      if (current.status === 'suspended' || current.status === 'deactivated') {
        return 'profile_blocked';
      }

      const next = nextProfile(current, input);
      if (next.changedFields.length === 0) return current;
      const updated = await this.persist(client, current, next, input);
      await this.recordChange(client, current, updated, next.changedFields, input);
      return updated;
    });
  }

  async setAvatar(profileId: string, bytes: Buffer | null, mediaType: string | null): Promise<void> {
    await this.database.query(
      `UPDATE profiles SET avatar_bytes = $2, avatar_media_type = $3, updated_at = NOW() WHERE profile_id = $1`,
      [profileId, bytes, mediaType],
    );
  }
  private async lockProfile(
    client: PoolClient,
    profileId: string,
  ): Promise<SessionProfileRecord | undefined> {
    const result = await client.query<ProfileRow>(
      `${profileProjection()} FROM profiles WHERE profile_id = $1 FOR UPDATE`,
      [profileId],
    );
    return result.rows[0];
  }

  private async persist(
    client: PoolClient,
    current: SessionProfileRecord,
    next: NextProfile,
    input: UpdateOwnProfileInput,
  ): Promise<SessionProfileRecord> {
    const result = await client.query<ProfileRow>(
      `UPDATE profiles SET display_name = $2, phone_e164 = $3,
       preferred_locale = $4, timezone = $5, status = $6,
       onboarding_completed_at = $7, version = version + 1, updated_at = $8
       WHERE profile_id = $1 AND version = $9
       RETURNING profile_id AS "profileId", firebase_uid AS "firebaseUid", status,
        display_name AS "displayName", email, phone_e164 AS "phoneE164",
        preferred_locale AS "preferredLocale", timezone,
        onboarding_completed_at AS "onboardingCompletedAt",
        CASE WHEN avatar_bytes IS NOT NULL
          THEN 'data:' || avatar_media_type || ';base64,' || encode(avatar_bytes, 'base64')
          ELSE NULL
        END AS "avatarUrl",
        version, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        input.profileId, next.displayName, next.phoneE164, next.preferredLocale,
        next.timezone, next.status, next.onboardingCompletedAt, input.now, current.version,
      ],
    );
    const updated = result.rows[0];
    if (updated === undefined) throw new Error('Concurrent profile update was not serialized');
    return updated;
  }

  private async recordChange(
    client: PoolClient,
    previous: SessionProfileRecord,
    updated: SessionProfileRecord,
    changedFields: readonly string[],
    input: UpdateOwnProfileInput,
  ): Promise<void> {
    const activated = previous.status === 'pending' && updated.status === 'active';
    const action = activated ? 'profile.onboarding.complete' : 'profile.update';
    const metadata = { changed_fields: changedFields, resulting_status: updated.status };
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, actor_profile_id, action, object_type, object_id,
        correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, 'profile', $1, $3, $4)`,
      [input.profileId, action, input.correlationId, metadata],
    );
    await client.query(
      `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, payload, correlation_id, occurred_at)
       VALUES (uuidv7(), $1, $2, 'profile', $3, $4, $5, $6, $7)`,
      [
        PROFILE_CHANGED_EVENT_TYPE,
        PROFILE_CHANGED_EVENT_VERSION,
        input.profileId,
        updated.version,
        // Must match `ProfileChangedData` in the AsyncAPI document, which sets
        // additionalProperties: false. Field-level detail stays in the audit log
        // so the published event carries no profile content.
        {
          profile_id: input.profileId,
          status: updated.status,
          onboarding_completed: updated.onboardingCompletedAt !== null,
        },
        input.correlationId,
        input.now,
      ],
    );
  }

}
interface NextProfile {
  readonly displayName: string;
  readonly phoneE164: string | null;
  readonly preferredLocale: string;
  readonly timezone: string;
  readonly status: SessionProfileRecord['status'];
  readonly onboardingCompletedAt: Date | null;
  readonly changedFields: readonly string[];
}

function nextProfile(
  current: SessionProfileRecord,
  input: UpdateOwnProfileInput,
): NextProfile {
  const displayName = input.displayName ?? current.displayName;
  const phoneE164 = input.phoneE164 !== undefined ? input.phoneE164 : current.phoneE164;
  const preferredLocale = input.preferredLocale ?? current.preferredLocale;
  const timezone = input.timezone ?? current.timezone;
  const completesNow = input.completeOnboarding === true && current.onboardingCompletedAt === null;
  const status = input.completeOnboarding === true && current.status === 'pending'
    ? 'active'
    : current.status;
  const onboardingCompletedAt = completesNow ? input.now : current.onboardingCompletedAt;
  const changedFields: string[] = [];
  if (displayName !== current.displayName) changedFields.push('display_name');
  if (phoneE164 !== current.phoneE164) changedFields.push('phone_e164');
  if (preferredLocale !== current.preferredLocale) changedFields.push('preferred_locale');
  if (timezone !== current.timezone) changedFields.push('timezone');
  if (status !== current.status) changedFields.push('status');
  if (onboardingCompletedAt !== current.onboardingCompletedAt) {
    changedFields.push('onboarding_completed_at');
  }
  return {
    displayName,
    phoneE164,
    preferredLocale,
    timezone,
    status,
    onboardingCompletedAt,
    changedFields: Object.freeze(changedFields),
  };
}

function profileProjection(): string {
  return `SELECT profile_id AS "profileId", firebase_uid AS "firebaseUid", status,
   display_name AS "displayName", email, phone_e164 AS "phoneE164",
   preferred_locale AS "preferredLocale", timezone,
   onboarding_completed_at AS "onboardingCompletedAt",
   CASE WHEN avatar_bytes IS NOT NULL
     THEN 'data:' || avatar_media_type || ';base64,' || encode(avatar_bytes, 'base64')
     ELSE NULL
   END AS "avatarUrl",
   version, created_at AS "createdAt", updated_at AS "updatedAt"`;
}
