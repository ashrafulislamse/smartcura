import type { PoolClient } from 'pg';

/**
 * Everything needed to re-prove an actor's authority *inside* the mutation
 * transaction, following `MembershipRepository`'s discipline. Checking
 * authorization only in the HTTP layer is a time-of-check-to-time-of-use hazard:
 * between the guard and the write, the session can be revoked, the membership
 * suspended, the permission grant removed, or the step-up can expire.
 *
 * This is deliberately a separate module from `membership-repository.ts` so the
 * device and reading repositories can share one implementation, and so the
 * membership variant's hard requirement of an `admin`/`super_admin` role is not
 * imposed on device flows. Here the ROLE is irrelevant and the specific
 * permission grant is what decides, which is what makes a per-action grant
 * meaningful.
 */
export type IotActorContext =
  /**
   * The actor acts only on their own data (their own readings, their own
   * device's ingestion). There is no administrative membership or step-up to
   * re-prove, only a live session belonging to an active, onboarded profile.
   */
  | {
      readonly kind: 'self';
      readonly sessionId: string;
      readonly tokenHash: string;
    }
  /** Action taken under an organization membership and an explicit grant. */
  | {
      readonly kind: 'membership';
      readonly sessionId: string;
      readonly tokenHash: string;
      readonly membershipId: string;
      readonly requiredPermission: string;
      readonly requireStepUp: boolean;
    }
  /**
   * THE DEVICE ITSELF. Added for MQTT ingestion, which previously had no representable actor
   * at all: both other kinds require a live `app_sessions` row, and an ESP32 has none.
   *
   * WHAT THIS PROVES AND WHAT IT DOES NOT. The bridge holds ONE broker connection under its
   * own service credential, so it never sees an individual device's password — the broker
   * authenticated that on the device's own connection and bound it to the topic by ACL. This
   * actor therefore proves the narrower thing it honestly can: that the named device still has
   * a LIVE, unrevoked MQTT credential and belongs to the organization being written into.
   * Possession of the secret is delegated to the broker, and that delegation is the security
   * assumption of this path.
   *
   * It is still worth re-proving inside the transaction. An MQTT session can outlive a
   * revocation by hours, so a check only at CONNECT would let a revoked device keep publishing
   * for the life of its socket.
   */
  | {
      readonly kind: 'device';
      readonly deviceId: string;
    };

export type IotActorFailure =
  | 'actor_session_invalid'
  | 'actor_permission_denied'
  | 'actor_step_up_required';

interface MembershipActorRow {
  readonly profileStatus: string;
  readonly onboardingCompletedAt: Date | null;
  readonly membershipStatus: string;
  readonly membershipOrganizationId: string;
  readonly roleId: string;
  readonly stepUpValidUntil: Date | null;
  readonly hasPermission: boolean;
}

/**
 * Re-proves the actor's authority while holding locks, immediately before the
 * mutation. Every condition the HTTP guards checked is checked again: live
 * session, active profile with completed onboarding, active membership, the
 * organization the resource belongs to, the specific permission grant, and a
 * current step-up where one is required.
 *
 * `super_admin` is the single role exempt from the organization match, mirroring
 * the global membership authority introduced in migration 0009.
/**
 * Re-proves a DEVICE's authority inside the mutation transaction.
 *
 * Asserts that the device still holds a live, unrevoked MQTT credential and belongs to the
 * organization being written into. Possession of the secret was proved by the broker on the
 * device's own connection; this closes the separate hole where an MQTT session outlives a
 * revocation and keeps publishing for the life of its socket.
 *
 * A revoked, credential-less, foreign or absent device all produce ONE indistinguishable
 * answer, so a publisher cannot learn which of those it is.
 */
async function revalidateDeviceActor(
  client: PoolClient,
  actor: Extract<IotActorContext, { kind: 'device' }>,
  organizationId: string,
): Promise<IotActorFailure | undefined> {
  const result = await client.query<{ readonly matches: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM device_credentials AS credential
         JOIN devices AS device ON device.device_id = credential.device_id
        WHERE credential.device_id = $1
          AND credential.credential_type = 'mqtt_password'
          AND credential.revoked_at IS NULL
          AND device.organization_id = $2
     ) AS matches`,
    [actor.deviceId, organizationId],
  );
  return result.rows[0]?.matches === true ? undefined : 'actor_session_invalid';
}

export async function revalidateIotActor(
  client: PoolClient,
  actor: IotActorContext,
  organizationId: string,
  now: Date,
): Promise<IotActorFailure | undefined> {
  if (actor.kind === 'self') return revalidateSelfActor(client, actor, now);
  if (actor.kind === 'device') return revalidateDeviceActor(client, actor, organizationId);
  const result = await client.query<MembershipActorRow>(
    `SELECT profile.status AS "profileStatus",
     profile.onboarding_completed_at AS "onboardingCompletedAt",
     membership.status AS "membershipStatus",
     membership.organization_id AS "membershipOrganizationId",
     membership.role_id AS "roleId",
     session.step_up_valid_until AS "stepUpValidUntil",
     EXISTS (SELECT 1 FROM role_permissions
       WHERE role_id = membership.role_id AND permission_id = $4) AS "hasPermission"
     FROM app_sessions AS session
     JOIN profiles AS profile ON profile.profile_id = session.profile_id
     JOIN organization_memberships AS membership
       ON membership.membership_id = $3 AND membership.profile_id = session.profile_id
     WHERE session.session_id = $1 AND session.token_hash = $2
       AND session.status = 'active'
       AND session.idle_expires_at > $5 AND session.absolute_expires_at > $5
     FOR UPDATE OF session, membership`,
    [actor.sessionId, actor.tokenHash, actor.membershipId, actor.requiredPermission, now],
  );
  const row = result.rows[0];
  if (row === undefined) return 'actor_session_invalid';
  if (row.profileStatus !== 'active' || row.onboardingCompletedAt === null) {
    return 'actor_session_invalid';
  }
  if (row.membershipStatus !== 'active') return 'actor_permission_denied';
  if (row.roleId !== 'super_admin' && row.membershipOrganizationId !== organizationId) {
    return 'actor_permission_denied';
  }
  if (!row.hasPermission) return 'actor_permission_denied';
  if (
    actor.requireStepUp &&
    (row.stepUpValidUntil === null || row.stepUpValidUntil <= now)
  ) return 'actor_step_up_required';
  return undefined;
}

/** Locks and revalidates a self-service actor's session and profile. */
async function revalidateSelfActor(
  client: PoolClient,
  actor: Extract<IotActorContext, { kind: 'self' }>,
  now: Date,
): Promise<IotActorFailure | undefined> {
  const result = await client.query<{
    readonly profileStatus: string;
    readonly onboardingCompletedAt: Date | null;
  }>(
    `SELECT profile.status AS "profileStatus",
     profile.onboarding_completed_at AS "onboardingCompletedAt"
     FROM app_sessions AS session
     JOIN profiles AS profile ON profile.profile_id = session.profile_id
     WHERE session.session_id = $1 AND session.token_hash = $2
       AND session.status = 'active'
       AND session.idle_expires_at > $3 AND session.absolute_expires_at > $3
     FOR UPDATE OF session`,
    [actor.sessionId, actor.tokenHash, now],
  );
  const row = result.rows[0];
  if (row === undefined) return 'actor_session_invalid';
  if (row.profileStatus !== 'active' || row.onboardingCompletedAt === null) {
    return 'actor_session_invalid';
  }
  return undefined;
}
