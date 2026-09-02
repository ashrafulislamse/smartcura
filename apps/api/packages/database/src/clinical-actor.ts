import type { PoolClient, QueryResultRow } from 'pg';

export interface ClinicalActorContext {
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly profileId: string;
  readonly membershipId: string;
  readonly roleId: 'patient' | 'doctor';
  readonly requiredPermission: string;
  readonly requireStepUp?: boolean;
}

export type ClinicalActorFailure =
  | 'actor_session_invalid'
  | 'actor_permission_denied'
  | 'actor_step_up_required';

interface ActorRow extends QueryResultRow {
  readonly profileId: string;
  readonly profileStatus: string;
  readonly onboardingCompletedAt: Date | null;
  readonly membershipStatus: string;
  readonly roleId: string;
  readonly stepUpValidUntil: Date | null;
  readonly hasPermission: boolean;
}

export async function revalidateClinicalActor(
  client: PoolClient,
  actor: ClinicalActorContext,
  now: Date,
): Promise<ClinicalActorFailure | undefined> {
  const result = await client.query<ActorRow>(
    `SELECT profile.profile_id AS "profileId", profile.status AS "profileStatus",
       profile.onboarding_completed_at AS "onboardingCompletedAt",
       membership.status AS "membershipStatus", membership.role_id AS "roleId",
       session.step_up_valid_until AS "stepUpValidUntil",
       EXISTS (SELECT 1 FROM role_permissions permission
         WHERE permission.role_id = membership.role_id
           AND permission.permission_id = $4) AS "hasPermission"
     FROM app_sessions session
     JOIN profiles profile ON profile.profile_id = session.profile_id
     JOIN organization_memberships membership
       ON membership.membership_id = $3 AND membership.profile_id = session.profile_id
     WHERE session.session_id = $1 AND session.token_hash = $2
       AND session.status = 'active'
       AND session.idle_expires_at > $5 AND session.absolute_expires_at > $5
     FOR UPDATE OF session, membership`,
    [actor.sessionId, actor.tokenHash, actor.membershipId, actor.requiredPermission, now],
  );
  const row = result.rows[0];
  if (row === undefined || row.profileId !== actor.profileId || row.profileStatus !== 'active' ||
      row.onboardingCompletedAt === null) return 'actor_session_invalid';
  if (row.membershipStatus !== 'active' || row.roleId !== actor.roleId || !row.hasPermission) {
    return 'actor_permission_denied';
  }
  if (actor.requireStepUp === true &&
      (row.stepUpValidUntil === null || row.stepUpValidUntil <= now)) {
    return 'actor_step_up_required';
  }
  return undefined;
}
