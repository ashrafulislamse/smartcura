import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  PROFILE_CHANGED_EVENT_TYPE,
  PROFILE_CHANGED_EVENT_VERSION,
} from './events.js';

export type RoleId = 'patient' | 'doctor' | 'driver' | 'pharmacy' | 'emergency' | 'admin' | 'super_admin';
export type SessionClientType = 'patient_flutter' | 'doctor_flutter' | 'driver_flutter' | 'web_portal';

export interface SessionProfileRecord {
  readonly profileId: string;
  readonly firebaseUid: string;
  readonly status: 'pending' | 'active' | 'suspended' | 'deactivated';
  readonly displayName: string;
  readonly email: string;
  readonly phoneE164: string | null;
  readonly preferredLocale: string;
  readonly timezone: string;
  readonly onboardingCompletedAt: Date | null;
  readonly avatarUrl: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SessionMembershipRecord {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly roleId: RoleId;
  readonly status: 'applied' | 'invited' | 'active' | 'suspended' | 'revoked' | 'expired';
  readonly verificationStatus: 'not_submitted' | 'pending_review' | 'changes_requested' | 'approved' | 'rejected' | 'suspended' | 'expired' | null;
  readonly siteIds: string[];
  readonly permissions: string[];
}

export interface AppSessionRecord {
  readonly sessionId: string;
  readonly profileId: string;
  readonly activeMembershipId: string | null;
  readonly activeRole: RoleId | null;
  readonly tokenHash: string;
  readonly csrfHash: string;
  readonly status: 'active' | 'idle_expired' | 'absolute_expired' | 'revoked' | 'membership_ended';
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly stepUpValidUntil: Date | null;
}

export interface SessionAggregate {
  readonly profile: SessionProfileRecord;
  readonly memberships: SessionMembershipRecord[];
  readonly session: AppSessionRecord;
}

export type SessionCreationResult = SessionAggregate | 'profile_blocked';

export interface CreateAppSessionInput {
  readonly sessionId: string;
  readonly firebaseUid: string;
  readonly email: string;
  readonly displayName: string;
  readonly requestedRole: RoleId | null;
  readonly clientType: SessionClientType;
  readonly deviceName: string;
  readonly tokenHash: string;
  readonly csrfHash: string;
  readonly stepUpValidUntil: Date | null;
  readonly now: Date;
  readonly correlationId: string;
}

export interface SessionRotationInput {
  readonly sessionId: string;
  readonly currentTokenHash: string;
  readonly currentCsrfHash: string;
  readonly nextTokenHash: string;
  readonly nextCsrfHash: string;
  readonly now: Date;
  readonly correlationId: string;
}

interface SessionRow extends QueryResultRow, AppSessionRecord {}
interface ProfileRow extends QueryResultRow, SessionProfileRecord {}
interface MembershipRow extends QueryResultRow, SessionMembershipRecord {}

export class SessionRepository {
  constructor(private readonly database: PostgresConnection) {}

  async create(input: CreateAppSessionInput): Promise<SessionCreationResult> {
    return this.database.transaction(async (client) => {
      const profile = await this.upsertProfile(client, input);
      if (profile.status === 'suspended' || profile.status === 'deactivated') {
        await client.query(
          `INSERT INTO audit_logs
           (audit_id, actor_profile_id, action, object_type, object_id, reason,
            correlation_id, metadata)
           VALUES (uuidv7(), $1, 'session.create.denied', 'profile', $1,
            'APP_SESSION_INVALID', $2, $3)`,
          [profile.profileId, input.correlationId, { profile_status: profile.status }],
        );
        return 'profile_blocked';
      }
      const memberships = await this.loadMemberships(client, profile.profileId);
      const activeMembership = selectInitialMembership(
        memberships,
        input.requestedRole,
        input.stepUpValidUntil !== null,
      );
      const limits = sessionLimits(activeMembership?.roleId ?? null);
      const idleExpiresAt = addMinutes(input.now, limits.idleMinutes);
      const absoluteExpiresAt = addMinutes(input.now, limits.absoluteMinutes);

      const result = await client.query<SessionRow>(
        `INSERT INTO app_sessions
         (session_id, profile_id, active_membership_id, token_hash, csrf_hash,
          client_type, device_name, last_activity_at, idle_expires_at, absolute_expires_at,
          step_up_valid_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING session_id AS "sessionId", profile_id AS "profileId",
          active_membership_id AS "activeMembershipId", $12::text AS "activeRole",
          token_hash AS "tokenHash", csrf_hash AS "csrfHash", status,
          created_at AS "createdAt", last_activity_at AS "lastActivityAt",
          idle_expires_at AS "idleExpiresAt", absolute_expires_at AS "absoluteExpiresAt",
          step_up_valid_until AS "stepUpValidUntil"`,
        [
          input.sessionId, profile.profileId, activeMembership?.membershipId ?? null,
          input.tokenHash, input.csrfHash, input.clientType, input.deviceName,
          input.now, idleExpiresAt, absoluteExpiresAt, input.stepUpValidUntil,
          activeMembership?.roleId ?? null,
        ],
      );
      const session = result.rows[0]!;
      await this.appendEvent(client, session, 'session.created', input.correlationId, {
        client_type: input.clientType,
      });
      return { profile, memberships, session };
    });
  }

  async getActiveByTokenHash(
    tokenHash: string,
    now: Date,
    touch: boolean,
  ): Promise<SessionAggregate | undefined> {
    return this.database.transaction(async (client) => {
      const selected = await client.query<SessionRow>(
        `${sessionSelectSql()}
         WHERE session.token_hash = $1 AND session.status = 'active'
           AND (session.active_membership_id IS NULL OR ${activeMembershipEligibleSql()})
         FOR UPDATE OF session`,
        [tokenHash],
      );
      let session = selected.rows[0];
      if (session === undefined) return undefined;
      if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) {
        const status = session.absoluteExpiresAt <= now ? 'absolute_expired' : 'idle_expired';
        await client.query(
          `UPDATE app_sessions SET status = $2, updated_at = $3
           WHERE session_id = $1 AND status = 'active'`,
          [session.sessionId, status, now],
        );
        return undefined;
      }
      if (touch) {
        const idle = addMinutes(now, sessionLimits(session.activeRole).idleMinutes);
        const nextIdle = idle < session.absoluteExpiresAt ? idle : session.absoluteExpiresAt;
        const touched = await client.query<SessionRow>(
          `${sessionSelectSql()}
           WHERE session.session_id = $1`,
          [session.sessionId],
        );
        await client.query(
          `UPDATE app_sessions SET last_activity_at = $2, idle_expires_at = $3, updated_at = $2
           WHERE session_id = $1`,
          [session.sessionId, now, nextIdle],
        );
        session = {
          ...touched.rows[0]!,
          lastActivityAt: now,
          idleExpiresAt: nextIdle,
        };
      }
      return this.loadAggregate(client, session);
    });
  }

  async refresh(input: SessionRotationInput): Promise<SessionAggregate | undefined> {
    return this.rotate(input, 'session.refreshed');
  }

  async stepUp(
    input: SessionRotationInput,
    validUntil: Date,
    reason: string,
  ): Promise<SessionAggregate | undefined> {
    return this.rotate(input, 'session.step_up', undefined, validUntil, { reason });
  }

  async selectMembership(
    input: SessionRotationInput,
    membershipId: string,
  ): Promise<SessionAggregate | 'membership_inactive' | undefined> {
    return this.database.transaction(async (client) => {
      const current = await this.lockCurrent(client, input);
      if (current === undefined) return undefined;
      const membership = await client.query<MembershipRow>(
        `${membershipSelectSql()}
         WHERE membership.membership_id = $1
           AND membership.profile_id = $2
           AND membership.status = 'active'
         FOR UPDATE OF membership`,
        [membershipId, current.profileId],
      );
      const selected = membership.rows[0];
      if (selected === undefined) return 'membership_inactive';
      if (requiresVerification(selected.roleId) && selected.verificationStatus !== 'approved') {
        return 'membership_inactive';
      }
      if (
        requiresMfa(selected.roleId) &&
        (current.stepUpValidUntil === null || current.stepUpValidUntil <= input.now)
      ) {
        return 'membership_inactive';
      }
      const limits = sessionLimits(selected.roleId);
      const roleAbsolute = addMinutes(input.now, limits.absoluteMinutes);
      const nextAbsolute = roleAbsolute < current.absoluteExpiresAt
        ? roleAbsolute
        : current.absoluteExpiresAt;
      const idle = addMinutes(input.now, limits.idleMinutes);
      const nextIdle = idle < nextAbsolute ? idle : nextAbsolute;
      const updated = await client.query<SessionRow>(
        `UPDATE app_sessions SET token_hash = $4, csrf_hash = $5,
         active_membership_id = $6, idle_expires_at = $7,
         absolute_expires_at = $10, last_activity_at = $9, updated_at = $9
         WHERE session_id = $1 AND token_hash = $2 AND csrf_hash = $3
         RETURNING session_id AS "sessionId", profile_id AS "profileId",
          active_membership_id AS "activeMembershipId", $8::text AS "activeRole",
          token_hash AS "tokenHash", csrf_hash AS "csrfHash", status,
          created_at AS "createdAt", last_activity_at AS "lastActivityAt",
          idle_expires_at AS "idleExpiresAt", absolute_expires_at AS "absoluteExpiresAt",
          step_up_valid_until AS "stepUpValidUntil"`,
        [
          input.sessionId, input.currentTokenHash, input.currentCsrfHash,
          input.nextTokenHash, input.nextCsrfHash, membershipId, nextIdle, selected.roleId,
          input.now, nextAbsolute,
        ],
      );
      const session = updated.rows[0];
      if (session === undefined) return undefined;
      await this.appendEvent(client, session, 'session.active_membership_changed', input.correlationId, {
        membership_id: membershipId,
        role: selected.roleId,
      });
      return this.loadAggregate(client, session);
    });
  }

  async recordDenial(
    aggregate: SessionAggregate,
    action: string,
    code: string,
    correlationId: string,
  ): Promise<void> {
    const active = aggregate.memberships.find(
      (membership) => membership.membershipId === aggregate.session.activeMembershipId,
    );
    await this.database.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, $3, 'app_session', $4, $5, $6, $7)`,
      [
        active?.organizationId ?? null,
        aggregate.profile.profileId,
        action,
        aggregate.session.sessionId,
        code,
        correlationId,
        { active_membership_id: aggregate.session.activeMembershipId, denial_code: code },
      ],
    );
  }

  async revoke(
    sessionId: string,
    tokenHash: string,
    csrfHash: string,
    now: Date,
    correlationId: string,
  ): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const result = await client.query<SessionRow>(
        `${sessionSelectSql()}
         WHERE session.session_id = $1 AND session.token_hash = $2
           AND session.csrf_hash = $3 AND session.status = 'active'
         FOR UPDATE OF session`,
        [sessionId, tokenHash, csrfHash],
      );
      const session = result.rows[0];
      if (session === undefined) return false;
      await client.query(
        `UPDATE app_sessions SET status = 'revoked', revoked_at = $2,
         revocation_reason = 'user_logout', updated_at = $2 WHERE session_id = $1`,
        [sessionId, now],
      );
      await this.appendEvent(client, session, 'session.revoked', correlationId, {
        reason: 'user_logout',
      });
      return true;
    });
  }

  private async upsertProfile(
    client: PoolClient,
    input: CreateAppSessionInput,
  ): Promise<SessionProfileRecord> {
    const inserted = await client.query<ProfileRow>(
      `INSERT INTO profiles
       (profile_id, firebase_uid, display_name, email)
       VALUES (uuidv7(), $1, $2, $3)
       ON CONFLICT (firebase_uid) DO NOTHING
       RETURNING profile_id AS "profileId", firebase_uid AS "firebaseUid", status,
        display_name AS "displayName", email, phone_e164 AS "phoneE164",
        preferred_locale AS "preferredLocale", timezone,
        onboarding_completed_at AS "onboardingCompletedAt",
        CASE WHEN avatar_bytes IS NOT NULL
          THEN 'data:' || avatar_media_type || ';base64,' || encode(avatar_bytes, 'base64')
          ELSE NULL
        END AS "avatarUrl",
        version, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [input.firebaseUid, input.displayName, input.email],
    );
    const created = inserted.rows[0];
    if (created !== undefined) {
      await this.recordProfileIdentityChange(
        client, created, 'profile.create', 'profile.created',
        ['display_name', 'email'], input,
      );
      return created;
    }

    const selected = await client.query<ProfileRow>(
      `SELECT profile_id AS "profileId", firebase_uid AS "firebaseUid", status,
       display_name AS "displayName", email, phone_e164 AS "phoneE164",
       preferred_locale AS "preferredLocale", timezone,
       onboarding_completed_at AS "onboardingCompletedAt",
       CASE WHEN avatar_bytes IS NOT NULL
         THEN 'data:' || avatar_media_type || ';base64,' || encode(avatar_bytes, 'base64')
         ELSE NULL
       END AS "avatarUrl",
       version, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM profiles WHERE firebase_uid = $1 FOR UPDATE`,
      [input.firebaseUid],
    );
    const current = selected.rows[0];
    if (current === undefined) throw new Error('Identity profile disappeared during session creation');
    if (
      current.status === 'suspended' || current.status === 'deactivated' ||
      current.email === input.email
    ) return current;

    const updated = await client.query<ProfileRow>(
      `UPDATE profiles SET email = $2, version = version + 1, updated_at = $3
       WHERE profile_id = $1
       RETURNING profile_id AS "profileId", firebase_uid AS "firebaseUid", status,
        display_name AS "displayName", email, phone_e164 AS "phoneE164",
        preferred_locale AS "preferredLocale", timezone,
        onboarding_completed_at AS "onboardingCompletedAt",
        CASE WHEN avatar_bytes IS NOT NULL
          THEN 'data:' || avatar_media_type || ';base64,' || encode(avatar_bytes, 'base64')
          ELSE NULL
        END AS "avatarUrl",
        version, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [current.profileId, input.email, input.now],
    );
    const profile = updated.rows[0]!;
    await this.recordProfileIdentityChange(
      client, profile, 'profile.identity_email.update', 'profile.updated',
      ['email'], input,
    );
    return profile;
  }

  private async recordProfileIdentityChange(
    client: PoolClient,
    profile: SessionProfileRecord,
    action: string,
    _eventType: string,
    changedFields: readonly string[],
    input: CreateAppSessionInput,
  ): Promise<void> {
    const metadata = { changed_fields: changedFields, resulting_status: profile.status };
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, actor_profile_id, action, object_type, object_id,
        correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, 'profile', $1, $3, $4)`,
      [profile.profileId, action, input.correlationId, metadata],
    );
    // Publishes the same canonical `profile.changed.v1` event as the profile
    // repository. Per-cause event names and a `changed_fields` payload were
    // previously written here, which no consumer could validate against the
    // AsyncAPI contract; the specific cause stays in the audit row above.
    await client.query(
      `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, payload, correlation_id, occurred_at)
       VALUES (uuidv7(), $1, $2, 'profile', $3, $4, $5, $6, $7)`,
      [
        PROFILE_CHANGED_EVENT_TYPE,
        PROFILE_CHANGED_EVENT_VERSION,
        profile.profileId,
        profile.version,
        {
          profile_id: profile.profileId,
          status: profile.status,
          onboarding_completed: profile.onboardingCompletedAt !== null,
        },
        input.correlationId,
        input.now,
      ],
    );
  }

  private async rotate(
    input: SessionRotationInput,
    eventType: string,
    activeMembershipId?: string,
    stepUpValidUntil?: Date,
    metadata: Record<string, unknown> = {},
  ): Promise<SessionAggregate | undefined> {
    return this.database.transaction(async (client) => {
      const current = await this.lockCurrent(client, input);
      if (current === undefined) return undefined;
      const idle = addMinutes(input.now, sessionLimits(current.activeRole).idleMinutes);
      const nextIdle = idle < current.absoluteExpiresAt ? idle : current.absoluteExpiresAt;
      const result = await client.query<SessionRow>(
        `UPDATE app_sessions SET token_hash = $4, csrf_hash = $5,
         last_activity_at = $6, idle_expires_at = $7, updated_at = $6,
         active_membership_id = COALESCE($8, active_membership_id),
         step_up_valid_until = COALESCE($9, step_up_valid_until)
         WHERE session_id = $1 AND token_hash = $2 AND csrf_hash = $3
           AND status = 'active' AND idle_expires_at > $6 AND absolute_expires_at > $6
         RETURNING session_id AS "sessionId", profile_id AS "profileId",
          active_membership_id AS "activeMembershipId",
          (SELECT role_id FROM organization_memberships
           WHERE membership_id = app_sessions.active_membership_id) AS "activeRole",
          token_hash AS "tokenHash", csrf_hash AS "csrfHash", status,
          created_at AS "createdAt", last_activity_at AS "lastActivityAt",
          idle_expires_at AS "idleExpiresAt", absolute_expires_at AS "absoluteExpiresAt",
          step_up_valid_until AS "stepUpValidUntil"`,
        [
          input.sessionId, input.currentTokenHash, input.currentCsrfHash,
          input.nextTokenHash, input.nextCsrfHash, input.now, nextIdle,
          activeMembershipId ?? null, stepUpValidUntil ?? null,
        ],
      );
      const session = result.rows[0];
      if (session === undefined) return undefined;
      await this.appendEvent(client, session, eventType, input.correlationId, metadata);
      return this.loadAggregate(client, session);
    });
  }

  private async lockCurrent(
    client: PoolClient,
    input: SessionRotationInput,
  ): Promise<AppSessionRecord | undefined> {
    const result = await client.query<SessionRow>(
      `${sessionSelectSql()}
       WHERE session.session_id = $1 AND session.token_hash = $2
         AND session.csrf_hash = $3 AND session.status = 'active'
         AND (session.active_membership_id IS NULL OR ${activeMembershipEligibleSql()})
         AND session.idle_expires_at > $4 AND session.absolute_expires_at > $4
       FOR UPDATE OF session`,
      [input.sessionId, input.currentTokenHash, input.currentCsrfHash, input.now],
    );
    return result.rows[0];
  }

  private async loadAggregate(
    client: PoolClient,
    session: AppSessionRecord,
  ): Promise<SessionAggregate> {
    const profile = await this.loadProfile(client, session.profileId);
    const memberships = await this.loadMemberships(client, session.profileId);
    return { profile, memberships, session };
  }

  private async loadProfile(client: PoolClient, profileId: string): Promise<SessionProfileRecord> {
    const result = await client.query<ProfileRow>(
      `SELECT profile_id AS "profileId", firebase_uid AS "firebaseUid", status,
       display_name AS "displayName", email, phone_e164 AS "phoneE164",
       preferred_locale AS "preferredLocale", timezone,
       onboarding_completed_at AS "onboardingCompletedAt",
       CASE WHEN avatar_bytes IS NOT NULL
         THEN 'data:' || avatar_media_type || ';base64,' || encode(avatar_bytes, 'base64')
         ELSE NULL
       END AS "avatarUrl",
       version, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM profiles WHERE profile_id = $1`,
      [profileId],
    );
    return result.rows[0]!;
  }

  private async loadMemberships(
    client: PoolClient,
    profileId: string,
  ): Promise<SessionMembershipRecord[]> {
    const result = await client.query<MembershipRow>(
      `${membershipSelectSql()}
       WHERE membership.profile_id = $1
       ORDER BY membership.created_at, membership.membership_id`,
      [profileId],
    );
    return result.rows;
  }

  private async appendEvent(
    client: PoolClient,
    session: AppSessionRecord,
    eventType: string,
    correlationId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO session_events
       (event_id, session_id, event_type, actor_profile_id, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, $3, $4, $5)`,
      [session.sessionId, eventType, session.profileId, correlationId, metadata],
    );
  }
}

function sessionSelectSql(): string {
  return `SELECT session.session_id AS "sessionId", session.profile_id AS "profileId",
   session.active_membership_id AS "activeMembershipId",
   active_membership.role_id AS "activeRole", session.token_hash AS "tokenHash",
   session.csrf_hash AS "csrfHash", session.status,
   session.created_at AS "createdAt", session.last_activity_at AS "lastActivityAt",
   session.idle_expires_at AS "idleExpiresAt",
   session.absolute_expires_at AS "absoluteExpiresAt",
   session.step_up_valid_until AS "stepUpValidUntil"
   FROM app_sessions AS session
   LEFT JOIN organization_memberships AS active_membership
    ON active_membership.membership_id = session.active_membership_id`;
}

/**
 * Continuous eligibility of the membership a session currently has selected.
 *
 * Eligibility is re-evaluated on every authenticated request rather than only at
 * activation or role selection. Without this, an already-authenticated
 * professional would keep their effective permissions after their verification
 * was suspended or their last required site was removed, because nothing would
 * re-examine the membership until the next role switch.
 *
 * Requires the joined `active_membership` alias from `sessionSelectSql()`.
 */
function activeMembershipEligibleSql(): string {
  return `(active_membership.status = 'active'
   AND (active_membership.role_id NOT IN ('doctor', 'driver', 'pharmacy', 'emergency')
     OR active_membership.verification_status = 'approved')
   AND (active_membership.role_id NOT IN ('pharmacy', 'emergency')
     OR EXISTS (SELECT 1 FROM membership_sites AS eligible_site
       WHERE eligible_site.membership_id = active_membership.membership_id
         AND eligible_site.organization_id = active_membership.organization_id)))`;
}

function membershipSelectSql(): string {
  return `SELECT membership.membership_id AS "membershipId",
   membership.organization_id AS "organizationId", membership.role_id AS "roleId",
   membership.status, membership.verification_status AS "verificationStatus",
   ARRAY(SELECT membership_site.site_id::text FROM membership_sites AS membership_site
    WHERE membership_site.membership_id = membership.membership_id
    ORDER BY membership_site.site_id) AS "siteIds",
   ARRAY(SELECT effective.permission_id FROM (
     SELECT role_permission.permission_id FROM role_permissions AS role_permission
      WHERE role_permission.role_id = membership.role_id
     UNION
     SELECT custom_permission.permission_id FROM custom_role_permissions AS custom_permission
      WHERE custom_permission.custom_role_id = membership.custom_role_id
   ) AS effective ORDER BY effective.permission_id) AS permissions
   FROM organization_memberships AS membership`;
}

function selectInitialMembership(
  memberships: readonly SessionMembershipRecord[],
  requestedRole: RoleId | null,
  mfaSatisfied: boolean,
): SessionMembershipRecord | undefined {
  const active = memberships.filter((membership) =>
    membership.status === 'active' &&
    (!requiresVerification(membership.roleId) || membership.verificationStatus === 'approved') &&
    (!requiresMfa(membership.roleId) || mfaSatisfied));
  const candidates = requestedRole === null
    ? active
    : active.filter((membership) => membership.roleId === requestedRole);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function sessionLimits(role: RoleId | null): { idleMinutes: number; absoluteMinutes: number } {
  switch (role) {
    case 'super_admin': return { idleMinutes: 10, absoluteMinutes: 240 };
    case 'admin': return { idleMinutes: 15, absoluteMinutes: 480 };
    case 'emergency': return { idleMinutes: 30, absoluteMinutes: 480 };
    // FYP demo: extended timeouts so the doctor app does not log out between
    // screenshots and while the evaluator is reviewing the prototype. Revert to
    // production values (idle 15 / absolute 720) before real-world deployment.
    case 'doctor':
    case 'pharmacy': return { idleMinutes: 1440, absoluteMinutes: 10080 };
    case 'driver': return { idleMinutes: 30, absoluteMinutes: 720 };
    case 'patient':
    case null: return { idleMinutes: 60, absoluteMinutes: 720 };
  }
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function requiresVerification(role: RoleId): boolean {
  return role === 'doctor' || role === 'driver' || role === 'pharmacy' || role === 'emergency';
}

function requiresMfa(role: RoleId): boolean {
  // MFA step-up is optional for the FYP demo. All roles can be activated
  // without MFA. Restore the original role list before production hardening:
  //   role === 'doctor' || role === 'pharmacy' || role === 'emergency' ||
  //   role === 'admin' || role === 'super_admin';
  return false;
}
