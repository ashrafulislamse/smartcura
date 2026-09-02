/**
 * Re-proves an actor's authority INSIDE the mutation transaction, while the
 * relevant rows are locked.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * The HTTP guards already checked the session, the profile, the membership, the
 * permission grant and the step-up. That check is only a fast rejection: between
 * the guard and the write, the session can be revoked, the administrative
 * membership suspended, the verification suspended or the step-up can expire.
 * Acting on the guard's answer alone is a time-of-check-to-time-of-use hazard, so
 * every condition is proved again here, under lock, immediately before the write.
 *
 * WHY IT IS A SHARED MODULE
 * -------------------------
 * `MembershipRepository` established this pattern with a private copy of the same
 * queries. The verification and stored-object repositories need byte-identical
 * behaviour - a weaker re-check in one repository would be the weakest link for
 * the whole platform - so the logic is factored out here rather than copied a
 * third time. The types are imported from `membership-repository.ts` so there is
 * exactly one definition of what an actor context is.
 *
 * FOLLOW-UP recorded in HANDOFF-0012.md: `MembershipRepository.revalidateActor`
 * should delegate to this module so only one implementation survives. That edit
 * is deliberately not made here because that file is the reference template and
 * is owned by another change in flight.
 */

import type { PoolClient, QueryResultRow } from 'pg';
import type {
  ActorAuthorizationContext,
  ActorRevalidationFailure,
} from './membership-repository.js';

interface AdministrativeActorRow extends QueryResultRow {
  readonly profileStatus: string;
  readonly onboardingCompletedAt: Date | null;
  readonly membershipStatus: string;
  readonly membershipOrganizationId: string;
  readonly roleId: string;
  readonly stepUpValidUntil: Date | null;
  readonly hasPermission: boolean;
}

interface SelfActorRow extends QueryResultRow {
  readonly profileStatus: string;
  readonly onboardingCompletedAt: Date | null;
}

/**
 * Proves the actor may still act, in this organization, right now.
 *
 * Returns `undefined` when the actor is still authorised, or the specific
 * failure so the caller can map it to a status code. Rows are locked
 * `FOR UPDATE` so the proof cannot be invalidated between this check and the
 * write that follows it in the same transaction.
 */
export async function revalidateActor(
  client: PoolClient,
  actor: ActorAuthorizationContext,
  organizationId: string,
  now: Date,
): Promise<ActorRevalidationFailure | undefined> {
  if (actor.kind === 'self') return revalidateSelfActor(client, actor, now);

  const result = await client.query<AdministrativeActorRow>(
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
  if (row.roleId !== 'admin' && row.roleId !== 'super_admin') return 'actor_permission_denied';
  // An organization administrator is confined to their own organization; only a
  // platform administrator acts across organizations.
  if (row.roleId === 'admin' && row.membershipOrganizationId !== organizationId) {
    return 'actor_permission_denied';
  }
  if (!row.hasPermission) return 'actor_permission_denied';
  if (
    actor.requireStepUp &&
    (row.stepUpValidUntil === null || row.stepUpValidUntil <= now)
  ) return 'actor_step_up_required';
  return undefined;
}

/**
 * Self-service actor: no administrative membership, permission grant or step-up
 * to re-prove, only a live session belonging to an active, onboarded profile.
 * Ownership of the target row is checked separately by the caller, under the same
 * transaction, because what counts as "own" differs per aggregate.
 */
async function revalidateSelfActor(
  client: PoolClient,
  actor: Extract<ActorAuthorizationContext, { kind: 'self' }>,
  now: Date,
): Promise<ActorRevalidationFailure | undefined> {
  const result = await client.query<SelfActorRow>(
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
