import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import type { RoleId } from './session-repository.js';

export type ManagedMembershipStatus = 'active' | 'suspended' | 'revoked';
export type CreatableMembershipStatus = 'applied' | 'invited' | 'active';

/**
 * Canonical event contract for every membership mutation. The payload must match
 * `MembershipChangedData` in the AsyncAPI document exactly, which declares
 * `additionalProperties: false`, so no extra keys may be added here. Contextual
 * detail belongs in the audit log, not in the published event.
 */
export const MEMBERSHIP_CHANGED_EVENT_TYPE = 'membership.changed.v1';
export const MEMBERSHIP_CHANGED_EVENT_VERSION = 1;

/**
 * Structured, PHI-free reasons for an administrative membership transition.
 * Free text is deliberately not accepted: transition reasons land in broadly
 * retained audit logs, and operators cannot be relied upon to keep clinical
 * detail out of an open string field.
 */
export const MEMBERSHIP_TRANSITION_REASON_CODES = [
  'administrative_request',
  'verification_revoked',
  'verification_approved',
  'policy_violation',
  'security_incident',
  'duplicate_membership',
  'offboarding',
  'data_correction',
  'organization_closed',
] as const;

export type MembershipTransitionReasonCode = typeof MEMBERSHIP_TRANSITION_REASON_CODES[number];

/**
 * Everything needed to re-prove the actor's authority *inside* the mutation
 * transaction. Checking authorization in the HTTP layer alone is a
 * time-of-check-to-time-of-use hazard: the actor's session can be revoked, their
 * membership suspended, or their step-up expire between the guard and the write.
 */
export type ActorAuthorizationContext =
  /**
   * Self-service enrolment. The actor acts only on their own profile, so there is
   * no administrative membership, permission grant or step-up to re-prove — only
   * a live session belonging to an active, onboarded profile.
   */
  | {
      readonly kind: 'self';
      readonly sessionId: string;
      readonly tokenHash: string;
    }
  /** Administrative action against another profile's membership. */
  | {
      readonly kind: 'administrative';
      readonly sessionId: string;
      readonly tokenHash: string;
      readonly membershipId: string;
      readonly requiredPermission: string;
      readonly requireStepUp: boolean;
    };

export type ActorRevalidationFailure =
  | 'actor_session_invalid'
  | 'actor_permission_denied'
  | 'actor_step_up_required';

export interface CreateMembershipInput {
  readonly organizationId: string;
  readonly targetProfileId: string;
  readonly actorProfileId: string;
  readonly actor: ActorAuthorizationContext;
  readonly roleId: Exclude<RoleId, 'super_admin'>;
  readonly status: CreatableMembershipStatus;
  readonly verificationStatus: 'not_submitted' | null;
  readonly siteIds: readonly string[];
  readonly operationId: 'membership.self.create' | 'membership.invitation.create';
  readonly action: 'membership.enrolled' | 'membership.applied' | 'membership.invited';
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly idempotencyTtlMs: number;
  readonly now: Date;
  readonly correlationId: string;
}

/**
 * A replayed idempotent request returns the byte-for-byte response that was
 * stored when the original request succeeded. Reloading current state instead
 * would let a replay observe later mutations, which breaks the guarantee the
 * `Idempotency-Key` header makes to the client.
 */
export interface MembershipResponseSnapshot {
  readonly status: 201;
  readonly body: Record<string, unknown>;
}

export type CreateMembershipResult =
  | { readonly record: MembershipAdministrationRecord; readonly replayed: false }
  | { readonly snapshot: MembershipResponseSnapshot; readonly replayed: true }
  | 'organization_not_found'
  | 'profile_not_eligible'
  | 'sites_invalid'
  | 'already_exists'
  | 'idempotency_reused'
  | ActorRevalidationFailure;

export interface MembershipAdministrationRecord {
  readonly membershipId: string;
  readonly profileId: string;
  readonly organizationId: string;
  readonly roleId: RoleId;
  readonly status: 'applied' | 'invited' | 'active' | 'suspended' | 'revoked' | 'expired';
  readonly verificationStatus: string | null;
  readonly profileStatus: 'pending' | 'active' | 'suspended' | 'deactivated';
  readonly onboardingCompletedAt: Date | null;
  readonly siteIds: string[];
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ListMembershipsInput {
  readonly organizationId: string;
  readonly afterCreatedAt?: Date;
  readonly afterMembershipId?: string;
  readonly includeSuperAdmin: boolean;
  readonly limit: number;
}

export interface TransitionMembershipInput {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly actorProfileId: string;
  readonly actorRoleId: 'admin' | 'super_admin';
  readonly actor: ActorAuthorizationContext;
  readonly nextStatus: ManagedMembershipStatus;
  readonly expectedVersion: number;
  readonly reasonCode: MembershipTransitionReasonCode;
  readonly now: Date;
  readonly correlationId: string;
}

export type TransitionMembershipResult = MembershipAdministrationRecord |
  'not_found' | 'version_conflict' | 'transition_invalid' |
  'self_modification_denied' | 'last_admin_required' | 'reactivation_blocked' |
  ActorRevalidationFailure;

interface MembershipRow extends QueryResultRow, MembershipAdministrationRecord {}
interface SessionIdRow extends QueryResultRow { readonly sessionId: string }
interface IdempotencyRow extends QueryResultRow {
  readonly requestHash: string;
  readonly state: string;
  readonly responseStatus: number | null;
  readonly responseBody: Record<string, unknown> | null;
  readonly expired: boolean;
}
interface ActorRow extends QueryResultRow {
  readonly profileId: string;
  readonly profileStatus: string;
  readonly onboardingCompletedAt: Date | null;
  readonly membershipStatus: string;
  readonly membershipOrganizationId: string;
  readonly roleId: string;
  readonly verificationStatus: string | null;
  readonly stepUpValidUntil: Date | null;
  readonly hasPermission: boolean;
}

export class MembershipRepository {
  constructor(private readonly database: PostgresConnection) {}

  async create(input: CreateMembershipInput): Promise<CreateMembershipResult> {
    return this.database.transaction(async (client) => {
      // Locks the organization first so every membership mutation in an
      // organization takes locks in the same order (organization, then actor,
      // then target). Inconsistent ordering here previously risked deadlocks
      // against the last-administrator check.
      const organization = await client.query(
        `SELECT organization_id FROM organizations WHERE organization_id = $1 FOR UPDATE`,
        [input.organizationId],
      );
      if (organization.rowCount !== 1) return 'organization_not_found';

      const actorFailure = await this.revalidateActor(
        client, input.actor, input.organizationId, input.now,
      );
      if (actorFailure !== undefined) return actorFailure;

      const existingKey = await this.loadIdempotency(client, input, true);
      if (existingKey !== undefined && !existingKey.expired) {
        return this.resolveIdempotency(input, existingKey);
      }
      if (existingKey?.expired === true) {
        // An expired key carries no replay guarantee any more, so the row is
        // reclaimed rather than blocking the caller forever.
        await this.deleteIdempotency(client, input);
      }
      const profile = await client.query<{
        readonly status: string;
        readonly onboardingCompletedAt: Date | null;
      }>(
        `SELECT status, onboarding_completed_at AS "onboardingCompletedAt"
         FROM profiles WHERE profile_id = $1 FOR SHARE`,
        [input.targetProfileId],
      );
      const target = profile.rows[0];
      if (
        target === undefined || target.status === 'suspended' || target.status === 'deactivated' ||
        (input.operationId === 'membership.self.create' &&
          (target.status !== 'active' || target.onboardingCompletedAt === null))
      ) return 'profile_not_eligible';
      if (!await this.sitesBelongToOrganization(client, input.organizationId, input.siteIds)) {
        return 'sites_invalid';
      }

      const claimed = await client.query(
        `INSERT INTO idempotency_keys
         (organization_id, actor_profile_id, operation_id, idempotency_key,
          request_hash, state, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'processing', $6)
         ON CONFLICT (organization_id, actor_profile_id, operation_id, idempotency_key)
         DO NOTHING RETURNING idempotency_key`,
        [
          input.organizationId, input.actorProfileId, input.operationId,
          input.idempotencyKey, input.requestHash,
          new Date(input.now.getTime() + input.idempotencyTtlMs),
        ],
      );
      if (claimed.rowCount !== 1) {
        const raced = await this.loadIdempotency(client, input, true);
        if (raced === undefined) throw new Error('Idempotency claim disappeared');
        return this.resolveIdempotency(input, raced);
      }

      const inserted = await client.query<{ readonly membershipId: string }>(
        `INSERT INTO organization_memberships
         (membership_id, profile_id, organization_id, role_id, status,
          verification_status, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6)
         ON CONFLICT (profile_id, organization_id, role_id) DO NOTHING
         RETURNING membership_id AS "membershipId"`,
        [
          input.targetProfileId, input.organizationId, input.roleId,
          input.status, input.verificationStatus, input.now,
        ],
      );
      const membershipId = inserted.rows[0]?.membershipId;
      if (membershipId === undefined) {
        await this.completeIdempotency(client, input, 409, {
          code: 'MEMBERSHIP_ALREADY_EXISTS',
        });
        return 'already_exists';
      }
      for (const siteId of input.siteIds) {
        await client.query(
          `INSERT INTO membership_sites (membership_id, site_id, organization_id)
           VALUES ($1, $2, $3)`,
          [membershipId, siteId, input.organizationId],
        );
      }
      const record = await this.loadForUpdate(client, input.organizationId, membershipId);
      if (record === undefined) throw new Error('Created membership could not be loaded');
      await this.recordCreation(client, record, input);
      // Stores the exact response body so a replay never observes later state.
      await this.completeIdempotency(client, input, 201, serializeMembership(record));
      return { record, replayed: false };
    });
  }

  /**
   * Re-proves the actor's authority while holding locks, immediately before the
   * mutation. Every condition the HTTP guards checked is checked again here:
   * live session, active profile with completed onboarding, active administrative
   * membership, organization scope, the specific permission grant, and a current
   * step-up where one is required.
   */
  private async revalidateActor(
    client: PoolClient,
    actor: ActorAuthorizationContext,
    organizationId: string,
    now: Date,
  ): Promise<ActorRevalidationFailure | undefined> {
    if (actor.kind === 'self') return this.revalidateSelfActor(client, actor, now);
    const result = await client.query<ActorRow>(
      `SELECT profile.profile_id AS "profileId", profile.status AS "profileStatus",
       profile.onboarding_completed_at AS "onboardingCompletedAt",
       membership.status AS "membershipStatus",
       membership.organization_id AS "membershipOrganizationId",
       membership.role_id AS "roleId",
       membership.verification_status AS "verificationStatus",
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

  /** Locks and revalidates a self-service actor's session and profile. */
  private async revalidateSelfActor(
    client: PoolClient,
    actor: Extract<ActorAuthorizationContext, { kind: 'self' }>,
    now: Date,
  ): Promise<ActorRevalidationFailure | undefined> {
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

  async list(input: ListMembershipsInput): Promise<MembershipAdministrationRecord[]> {
    const result = await this.database.query<MembershipRow>(
      `${membershipProjection()}
       WHERE membership.organization_id = $1
         AND ($2::timestamptz IS NULL OR
           (membership.created_at, membership.membership_id) > ($2, $3::uuid))
         AND ($4::boolean OR membership.role_id <> 'super_admin')
       ORDER BY membership.created_at, membership.membership_id
       LIMIT $5`,
      [
        input.organizationId,
        input.afterCreatedAt ?? null,
        input.afterMembershipId ?? null,
        input.includeSuperAdmin,
        input.limit,
      ],
    );
    return result.rows;
  }

  async transition(input: TransitionMembershipInput): Promise<TransitionMembershipResult> {
    return this.database.transaction(async (client) => {
      // Same fixed lock order as create(): organization, then actor, then target.
      // Serialising on the organization row also makes the last-administrator
      // check race-free without locking an unordered set of administrator rows.
      const organization = await client.query(
        `SELECT organization_id FROM organizations WHERE organization_id = $1 FOR UPDATE`,
        [input.organizationId],
      );
      if (organization.rowCount !== 1) return 'not_found';

      const actorFailure = await this.revalidateActor(
        client, input.actor, input.organizationId, input.now,
      );
      if (actorFailure !== undefined) return actorFailure;

      const current = await this.loadForUpdate(
        client,
        input.organizationId,
        input.membershipId,
      );
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      if (current.roleId === 'super_admin' && input.actorRoleId !== 'super_admin') {
        return 'not_found';
      }
      // Authority checks precede the idempotent no-op so an unauthorised actor is
      // never told the outcome of a state they were not allowed to inspect.
      if (current.profileId === input.actorProfileId) return 'self_modification_denied';
      if (current.status === input.nextStatus) return current;
      if (!transitionAllowed(current.status, input.nextStatus)) return 'transition_invalid';
      if (input.nextStatus === 'active' && !reactivationAllowed(current)) {
        return 'reactivation_blocked';
      }
      if (
        current.status === 'active' && input.nextStatus !== 'active' &&
        (current.roleId === 'admin' || current.roleId === 'super_admin') &&
        await this.isLastActiveAdministrator(client, current)
      ) return 'last_admin_required';

      const affectedSessions = await client.query<SessionIdRow>(
        `SELECT session_id AS "sessionId" FROM app_sessions
         WHERE active_membership_id = $1 AND status = 'active'
         FOR UPDATE`,
        [current.membershipId],
      );
      await client.query(
        `UPDATE organization_memberships
         SET status = $2, version = version + 1, updated_at = $3
         WHERE membership_id = $1 AND version = $4`,
        [current.membershipId, input.nextStatus, input.now, current.version],
      );
      const updated = await this.loadForUpdate(
        client,
        input.organizationId,
        input.membershipId,
      );
      if (updated === undefined) throw new Error('Membership disappeared during transition');
      await this.recordSuccess(client, current, updated, affectedSessions.rows, input);
      return updated;
    });
  }
  async recordDenial(
    organizationId: string,
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
        CASE WHEN EXISTS (SELECT 1 FROM organizations WHERE organization_id = $1)
          THEN $1::uuid ELSE NULL END,
        $2, $3, 'organization_membership', $4, $5, $6, $7)`,
      [organizationId, actorProfileId, action, membershipId, code, correlationId, {
        denial_code: code,
      }],
    );
  }

  private async loadIdempotency(
    client: PoolClient,
    input: CreateMembershipInput,
    lock = false,
  ): Promise<IdempotencyRow | undefined> {
    const result = await client.query<IdempotencyRow>(
      `SELECT request_hash AS "requestHash", state,
       response_status AS "responseStatus", response_body AS "responseBody",
       (expires_at <= $5) AS expired
       FROM idempotency_keys
       WHERE organization_id = $1 AND actor_profile_id = $2
         AND operation_id = $3 AND idempotency_key = $4
       ${lock ? 'FOR UPDATE' : ''}`,
      [
        input.organizationId, input.actorProfileId, input.operationId,
        input.idempotencyKey, input.now,
      ],
    );
    return result.rows[0];
  }

  private async deleteIdempotency(
    client: PoolClient,
    input: CreateMembershipInput,
  ): Promise<void> {
    await client.query(
      `DELETE FROM idempotency_keys
       WHERE organization_id = $1 AND actor_profile_id = $2
         AND operation_id = $3 AND idempotency_key = $4`,
      [input.organizationId, input.actorProfileId, input.operationId, input.idempotencyKey],
    );
  }

  /**
   * Replays the stored response verbatim. Deliberately does not read the
   * membership again: a replay must reproduce the original outcome even if the
   * membership has since been suspended, revoked or re-versioned.
   */
  private resolveIdempotency(
    input: CreateMembershipInput,
    existing: IdempotencyRow,
  ): CreateMembershipResult {
    if (existing.requestHash !== input.requestHash) return 'idempotency_reused';
    if (existing.state !== 'completed') return 'idempotency_reused';
    if (existing.responseStatus === 409) return 'already_exists';
    const body = existing.responseBody;
    if (existing.responseStatus !== 201 || body === null || body['id'] === undefined) {
      return 'idempotency_reused';
    }
    return { snapshot: { status: 201, body }, replayed: true };
  }

  private async completeIdempotency(
    client: PoolClient,
    input: CreateMembershipInput,
    responseStatus: 201 | 409,
    responseBody: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `UPDATE idempotency_keys
       SET state = 'completed', response_status = $5, response_body = $6,
           updated_at = $7
       WHERE organization_id = $1 AND actor_profile_id = $2
         AND operation_id = $3 AND idempotency_key = $4`,
      [
        input.organizationId, input.actorProfileId, input.operationId,
        input.idempotencyKey, responseStatus, responseBody, input.now,
      ],
    );
  }

  private async sitesBelongToOrganization(
    client: PoolClient,
    organizationId: string,
    siteIds: readonly string[],
  ): Promise<boolean> {
    if (siteIds.length === 0) return true;
    // FOR KEY SHARE pins each site row for the rest of the transaction so a
    // concurrent delete or organization change cannot invalidate the membership
    // site rows written immediately afterwards.
    const result = await client.query<{ readonly count: number }>(
      `SELECT count(*)::integer AS count FROM (
         SELECT site_id FROM sites
         WHERE organization_id = $1 AND site_id = ANY($2::uuid[])
         ORDER BY site_id
         FOR KEY SHARE
       ) AS locked_sites`,
      [organizationId, siteIds],
    );
    return result.rows[0]?.count === siteIds.length;
  }

  private async recordCreation(
    client: PoolClient,
    membership: MembershipAdministrationRecord,
    input: CreateMembershipInput,
  ): Promise<void> {
    const metadata = {
      target_profile_id: membership.profileId,
      target_role: membership.roleId,
      status: membership.status,
      site_ids: membership.siteIds,
      version: membership.version,
    };
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, $3, 'organization_membership', $4, $5, $6)`,
      [
        membership.organizationId, input.actorProfileId, input.action,
        membership.membershipId, input.correlationId, metadata,
      ],
    );
    await this.appendMembershipChangedEvent(client, membership, input.correlationId, input.now);
  }

  /**
   * Single writer for the published membership event. The payload is restricted to
   * the four fields `MembershipChangedData` declares, because that schema sets
   * `additionalProperties: false` — any extra key would fail contract validation
   * and dead-letter in the worker. Richer context stays in the audit log.
   */
  private async appendMembershipChangedEvent(
    client: PoolClient,
    membership: MembershipAdministrationRecord,
    correlationId: string,
    occurredAt: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, payload, correlation_id, occurred_at)
       VALUES (uuidv7(), $1, $2, 'membership', $3, $4, $5, $6, $7)`,
      [
        MEMBERSHIP_CHANGED_EVENT_TYPE,
        MEMBERSHIP_CHANGED_EVENT_VERSION,
        membership.membershipId,
        membership.version,
        {
          membership_id: membership.membershipId,
          profile_id: membership.profileId,
          role: membership.roleId,
          status: membership.status,
        },
        correlationId,
        occurredAt,
      ],
    );
  }

  private async loadForUpdate(
    client: PoolClient,
    organizationId: string,
    membershipId: string,
  ): Promise<MembershipAdministrationRecord | undefined> {
    const result = await client.query<MembershipRow>(
      `${membershipProjection()}
       WHERE membership.organization_id = $1 AND membership.membership_id = $2
       FOR UPDATE OF membership`,
      [organizationId, membershipId],
    );
    return result.rows[0];
  }

  private async isLastActiveAdministrator(
    client: PoolClient,
    membership: MembershipAdministrationRecord,
  ): Promise<boolean> {
    const values: unknown[] = [membership.roleId];
    const organizationClause = membership.roleId === 'admin'
      ? 'AND organization_id = $2'
      : '';
    if (membership.roleId === 'admin') values.push(membership.organizationId);
    // The organization row is already locked for the whole transaction, so this
    // count is stable. Rows are still read in a deterministic order to keep the
    // lock sequence predictable for the global (super_admin) case.
    const result = await client.query<{ membershipId: string }>(
      `SELECT membership_id AS "membershipId" FROM organization_memberships
       WHERE role_id = $1 AND status = 'active' ${organizationClause}
       ORDER BY membership_id
       FOR UPDATE`,
      values,
    );
    return result.rows.length <= 1;
  }

  private async recordSuccess(
    client: PoolClient,
    previous: MembershipAdministrationRecord,
    updated: MembershipAdministrationRecord,
    affectedSessions: readonly SessionIdRow[],
    input: TransitionMembershipInput,
  ): Promise<void> {
    const action = `membership.${transitionAction(previous.status, input.nextStatus)}`;
    const metadata = {
      previous_status: previous.status,
      next_status: updated.status,
      target_profile_id: updated.profileId,
      target_role: updated.roleId,
      version: updated.version,
      ended_session_count: affectedSessions.length,
    };
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, $3, 'organization_membership', $4, $5, $6, $7)`,
      [
        updated.organizationId, input.actorProfileId, action, updated.membershipId,
        input.reasonCode, input.correlationId, metadata,
      ],
    );
    await this.appendMembershipChangedEvent(client, updated, input.correlationId, input.now);
    for (const session of affectedSessions) {
      await client.query(
        `INSERT INTO session_events
         (event_id, session_id, event_type, actor_profile_id, correlation_id, metadata)
         VALUES (uuidv7(), $1, 'session.membership_ended', $2, $3, $4)`,
        [session.sessionId, input.actorProfileId, input.correlationId, {
          membership_id: updated.membershipId,
          membership_status: updated.status,
        }],
      );
    }
  }
}

/**
 * The single membership representation. Used both for live HTTP responses and for
 * the idempotency snapshot, so a replayed response is identical by construction.
 */
export function serializeMembership(
  record: MembershipAdministrationRecord,
): Record<string, unknown> {
  return {
    id: record.membershipId,
    profile_id: record.profileId,
    organization_id: record.organizationId,
    role: record.roleId,
    status: record.status,
    verification_status: record.verificationStatus,
    site_ids: record.siteIds,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function membershipProjection(): string {
  return `SELECT membership.membership_id AS "membershipId",
   membership.profile_id AS "profileId",
   membership.organization_id AS "organizationId",
   membership.role_id AS "roleId", membership.status,
   membership.verification_status AS "verificationStatus",
   profile.status AS "profileStatus",
   profile.onboarding_completed_at AS "onboardingCompletedAt",
   COALESCE((SELECT array_agg(ms.site_id::text ORDER BY ms.site_id)
    FROM membership_sites ms JOIN sites site ON site.site_id = ms.site_id
    WHERE ms.membership_id = membership.membership_id
      AND site.organization_id = membership.organization_id), ARRAY[]::text[]) AS "siteIds",
   membership.version,
   membership.created_at AS "createdAt", membership.updated_at AS "updatedAt"
   FROM organization_memberships membership
   JOIN profiles profile ON profile.profile_id = membership.profile_id`;
}
function transitionAllowed(
  current: MembershipAdministrationRecord['status'],
  next: ManagedMembershipStatus,
): boolean {
  return ((current === 'applied' || current === 'invited') &&
      (next === 'active' || next === 'revoked')) ||
    (current === 'active' && (next === 'suspended' || next === 'revoked')) ||
    (current === 'suspended' && (next === 'active' || next === 'revoked'));
}

function reactivationAllowed(membership: MembershipAdministrationRecord): boolean {
  if (
    membership.profileStatus !== 'active' ||
    membership.onboardingCompletedAt === null
  ) return false;
  if (
    requiresVerification(membership.roleId) &&
    membership.verificationStatus !== 'approved'
  ) return false;
  return !requiresSite(membership.roleId) || membership.siteIds.length > 0;
}

function requiresVerification(roleId: RoleId): boolean {
  return roleId === 'doctor' || roleId === 'driver' ||
    roleId === 'pharmacy' || roleId === 'emergency';
}

function requiresSite(roleId: RoleId): boolean {
  return roleId === 'pharmacy' || roleId === 'emergency';
}

function transitionAction(
  previous: MembershipAdministrationRecord['status'],
  status: ManagedMembershipStatus,
): string {
  switch (status) {
    case 'active': return previous === 'suspended' ? 'reactivated' : 'activated';
    case 'suspended': return 'suspended';
    case 'revoked': return 'revoked';
  }
}
