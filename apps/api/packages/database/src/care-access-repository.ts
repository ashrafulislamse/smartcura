import type { PoolClient, QueryResultRow } from 'pg';
import { revalidateActor } from './actor-revalidation.js';
import {
  CARE_ASSIGNMENT_CHANGED_EVENT_TYPE,
  CARE_ASSIGNMENT_CHANGED_EVENT_VERSION,
  CONSENT_CHANGED_EVENT_TYPE,
  CONSENT_CHANGED_EVENT_VERSION,
} from './care-access-events.js';
import { PostgresConnection } from './connection.js';
import type {
  ActorAuthorizationContext,
  ActorRevalidationFailure,
} from './membership-repository.js';

export const CONSENT_SCOPES = [
  'profile_contact', 'clinical_record', 'medication', 'iot_reading',
  'ai_artifact', 'full_record',
] as const;
export type ConsentScopeValue = typeof CONSENT_SCOPES[number];

export const CONSENT_REVOCATION_REASONS = [
  'grantor_request', 'grantee_request', 'admin_action', 'superseded',
  'policy_violation', 'membership_ended',
] as const;
export type ConsentRevocationReason = typeof CONSENT_REVOCATION_REASONS[number];

export const CARE_ASSIGNMENT_END_REASONS = [
  'care_completed', 'patient_request', 'clinician_request',
  'administrative_request', 'membership_ended', 'assignment_correction',
] as const;
export type CareAssignmentEndReason = typeof CARE_ASSIGNMENT_END_REASONS[number];
export type CareAssignmentStatusValue = 'active' | 'completed' | 'revoked' | 'expired';

export interface ConsentGrantRecord {
  readonly consentId: string;
  readonly organizationId: string;
  readonly grantorProfileId: string;
  readonly granteeProfileId: string | null;
  readonly granteeMembershipId: string | null;
  readonly scope: ConsentScopeValue;
  readonly purpose: string;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revocationReason: ConsentRevocationReason | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CareAssignmentRecord {
  readonly assignmentId: string;
  readonly organizationId: string;
  readonly clinicianMembershipId: string;
  readonly patientProfileId: string;
  readonly status: CareAssignmentStatusValue;
  readonly assignedAt: Date;
  readonly endedAt: Date | null;
  readonly endedReason: CareAssignmentEndReason | null;
  readonly assignedByMembershipId: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ListConsentGrantsInput {
  readonly grantorProfileId: string;
  readonly beforeGrantedAt?: Date;
  readonly beforeConsentId?: string;
  readonly limit: number;
}

export interface CreateConsentGrantInput {
  readonly organizationId: string;
  readonly grantorProfileId: string;
  readonly actorMembershipId: string;
  readonly actor: ActorAuthorizationContext;
  readonly granteeProfileId: string | null;
  readonly granteeMembershipId: string | null;
  readonly scope: ConsentScopeValue;
  readonly purpose: string;
  readonly expiresAt: Date | null;
  readonly now: Date;
  readonly correlationId: string;
}

export type CreateConsentGrantResult = ConsentGrantRecord |
  'organization_not_found' | 'grantor_not_eligible' | 'grantee_not_eligible' |
  'duplicate_active_grant' | ActorRevalidationFailure;

export interface RevokeConsentGrantInput {
  readonly consentId: string;
  readonly organizationId: string;
  readonly grantorProfileId: string;
  readonly actorMembershipId: string;
  readonly actor: ActorAuthorizationContext;
  readonly expectedVersion: number;
  readonly reason: ConsentRevocationReason;
  readonly now: Date;
  readonly correlationId: string;
}
export type RevokeConsentGrantResult = ConsentGrantRecord |
  'not_found' | 'version_conflict' | 'already_inactive' | ActorRevalidationFailure;

export type CareAssignmentListScope =
  | { readonly kind: 'patient'; readonly patientProfileId: string }
  | { readonly kind: 'clinician'; readonly clinicianMembershipId: string }
  | { readonly kind: 'organization'; readonly organizationId: string };

export interface ListCareAssignmentsInput {
  readonly scope: CareAssignmentListScope;
  readonly status?: CareAssignmentStatusValue;
  readonly beforeAssignedAt?: Date;
  readonly beforeAssignmentId?: string;
  readonly limit: number;
}

export interface CreateCareAssignmentInput {
  readonly organizationId: string;
  readonly clinicianMembershipId: string;
  readonly patientProfileId: string;
  readonly actorProfileId: string;
  readonly actorMembershipId: string;
  readonly actor: ActorAuthorizationContext;
  readonly now: Date;
  readonly correlationId: string;
}
export type CreateCareAssignmentResult = CareAssignmentRecord |
  'organization_not_found' | 'clinician_not_eligible' | 'patient_not_eligible' |
  'already_assigned' | ActorRevalidationFailure;

export interface EndCareAssignmentInput {
  readonly organizationId: string;
  readonly assignmentId: string;
  readonly actorProfileId: string;
  readonly actor: ActorAuthorizationContext;
  readonly expectedVersion: number;
  readonly status: 'completed' | 'revoked';
  readonly reason: CareAssignmentEndReason;
  readonly now: Date;
  readonly correlationId: string;
}
export type EndCareAssignmentResult = CareAssignmentRecord |
  'not_found' | 'version_conflict' | 'already_inactive' | ActorRevalidationFailure;

interface ConsentRow extends QueryResultRow, ConsentGrantRecord {}
interface AssignmentRow extends QueryResultRow, CareAssignmentRecord {}

export class CareAccessRepository {
  constructor(private readonly database: PostgresConnection) {}

  async listConsentGrants(input: ListConsentGrantsInput): Promise<ConsentGrantRecord[]> {
    const result = await this.database.query<ConsentRow>(
      `${consentProjection()}
       WHERE consent.grantor_profile_id = $1
         AND ($2::timestamptz IS NULL OR
           (consent.granted_at, consent.consent_id) < ($2, $3::uuid))
       ORDER BY consent.granted_at DESC, consent.consent_id DESC
       LIMIT $4`,
      [input.grantorProfileId, input.beforeGrantedAt ?? null,
        input.beforeConsentId ?? null, input.limit],
    );
    return result.rows;
  }

  async createConsentGrant(input: CreateConsentGrantInput): Promise<CreateConsentGrantResult> {
    return this.database.transaction(async (client) => {
      if (!(await organizationExists(client, input.organizationId))) {
        return 'organization_not_found';
      }
      const actorFailure = await revalidateActor(client, input.actor, input.organizationId, input.now);
      if (actorFailure !== undefined) return actorFailure;
      if (!(await patientMembershipEligible(
        client, input.actorMembershipId, input.grantorProfileId, input.organizationId,
      ))) return 'grantor_not_eligible';
      if (!(await consentGranteeEligible(client, input))) return 'grantee_not_eligible';

      const inserted = await client.query<{ readonly consentId: string }>(
        `INSERT INTO consent_grants
         (consent_id, organization_id, grantor_profile_id, grantee_profile_id,
          grantee_membership_id, scope, purpose, granted_at, expires_at, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $7)
         ON CONFLICT DO NOTHING RETURNING consent_id AS "consentId"`,
        [input.organizationId, input.grantorProfileId, input.granteeProfileId,
          input.granteeMembershipId, input.scope, input.purpose, input.now, input.expiresAt],
      );
      const consentId = inserted.rows[0]?.consentId;
      if (consentId === undefined) return 'duplicate_active_grant';
      const record = await loadConsent(client, consentId, true);
      if (record === undefined) throw new Error('Created consent grant could not be loaded');
      await recordAudit(client, {
        organizationId: record.organizationId,
        actorProfileId: input.grantorProfileId,
        action: 'consent.granted',
        objectType: 'consent_grant', objectId: record.consentId,
        reason: null, correlationId: input.correlationId,
        metadata: { scope: record.scope, version: record.version },
      });
      await appendConsentEvent(client, record, input.correlationId, input.now);
      return record;
    });
  }

  async revokeConsentGrant(input: RevokeConsentGrantInput): Promise<RevokeConsentGrantResult> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateActor(client, input.actor, input.organizationId, input.now);
      if (actorFailure !== undefined) return actorFailure;
      if (!(await patientMembershipEligible(
        client, input.actorMembershipId, input.grantorProfileId, input.organizationId,
      ))) return 'actor_permission_denied';
      const current = await loadConsent(client, input.consentId, true);
      if (
        current === undefined || current.organizationId !== input.organizationId ||
        current.grantorProfileId !== input.grantorProfileId
      ) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      if (current.revokedAt !== null || (current.expiresAt !== null && current.expiresAt <= input.now)) {
        return 'already_inactive';
      }
      await client.query(
        `UPDATE consent_grants SET revoked_at = $2, revocation_reason = $3,
         version = version + 1, updated_at = $2
         WHERE consent_id = $1 AND version = $4`,
        [input.consentId, input.now, input.reason, input.expectedVersion],
      );
      const updated = await loadConsent(client, input.consentId, true);
      if (updated === undefined) throw new Error('Consent grant disappeared during revocation');
      await recordAudit(client, {
        organizationId: updated.organizationId,
        actorProfileId: input.grantorProfileId,
        action: 'consent.revoked', objectType: 'consent_grant', objectId: updated.consentId,
        reason: input.reason, correlationId: input.correlationId,
        metadata: { scope: updated.scope, version: updated.version },
      });
      await appendConsentEvent(client, updated, input.correlationId, input.now);
      return updated;
    });
  }

  async listCareAssignments(input: ListCareAssignmentsInput): Promise<CareAssignmentRecord[]> {
    const [predicate, ownerId] = input.scope.kind === 'patient'
      ? ['assignment.patient_profile_id = $1', input.scope.patientProfileId]
      : input.scope.kind === 'clinician'
        ? ['assignment.clinician_membership_id = $1', input.scope.clinicianMembershipId]
        : ['assignment.organization_id = $1', input.scope.organizationId];
    const result = await this.database.query<AssignmentRow>(
      `${assignmentProjection()} WHERE ${predicate}
       AND ($2::text IS NULL OR assignment.status = $2::care_assignment_status)
       AND ($3::timestamptz IS NULL OR
         (assignment.assigned_at, assignment.assignment_id) < ($3, $4::uuid))
       ORDER BY assignment.assigned_at DESC, assignment.assignment_id DESC LIMIT $5`,
      [ownerId, input.status ?? null, input.beforeAssignedAt ?? null,
        input.beforeAssignmentId ?? null, input.limit],
    );
    return result.rows;
  }

  async createCareAssignment(input: CreateCareAssignmentInput): Promise<CreateCareAssignmentResult> {
    return this.database.transaction(async (client) => {
      if (!(await organizationExists(client, input.organizationId))) {
        return 'organization_not_found';
      }
      const actorFailure = await revalidateActor(client, input.actor, input.organizationId, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const clinician = await client.query(
        `SELECT membership_id FROM organization_memberships
         WHERE membership_id = $1 AND organization_id = $2 AND role_id = 'doctor'
           AND status = 'active' AND verification_status = 'approved' FOR SHARE`,
        [input.clinicianMembershipId, input.organizationId],
      );
      if (clinician.rowCount !== 1) return 'clinician_not_eligible';
      const patient = await client.query(
        `SELECT profile.profile_id FROM profiles AS profile
         JOIN organization_memberships AS membership
           ON membership.profile_id = profile.profile_id
          AND membership.organization_id = $2
          AND membership.role_id = 'patient' AND membership.status = 'active'
         WHERE profile.profile_id = $1 AND profile.status = 'active'
           AND profile.onboarding_completed_at IS NOT NULL FOR SHARE OF profile, membership`,
        [input.patientProfileId, input.organizationId],
      );
      if (patient.rowCount !== 1) return 'patient_not_eligible';
      const inserted = await client.query<{ readonly assignmentId: string }>(
        `INSERT INTO care_assignments
         (assignment_id, organization_id, clinician_membership_id, patient_profile_id,
          assigned_at, assigned_by_membership_id, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $4)
         ON CONFLICT DO NOTHING RETURNING assignment_id AS "assignmentId"`,
        [input.organizationId, input.clinicianMembershipId, input.patientProfileId,
          input.now, input.actorMembershipId],
      );
      const assignmentId = inserted.rows[0]?.assignmentId;
      if (assignmentId === undefined) return 'already_assigned';
      const record = await loadAssignment(client, input.organizationId, assignmentId, true);
      if (record === undefined) throw new Error('Created care assignment could not be loaded');
      await recordAudit(client, {
        organizationId: record.organizationId, actorProfileId: input.actorProfileId,
        action: 'care_assignment.created', objectType: 'care_assignment',
        objectId: record.assignmentId, reason: null, correlationId: input.correlationId,
        metadata: { status: record.status, version: record.version },
      });
      await appendAssignmentEvent(client, record, input.correlationId, input.now);
      return record;
    });
  }

  async endCareAssignment(input: EndCareAssignmentInput): Promise<EndCareAssignmentResult> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateActor(client, input.actor, input.organizationId, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const current = await loadAssignment(client, input.organizationId, input.assignmentId, true);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      if (current.status !== 'active') return 'already_inactive';
      await client.query(
        `UPDATE care_assignments SET status = $3, ended_at = $2, ended_reason = $4,
         version = version + 1, updated_at = $2
         WHERE assignment_id = $1 AND organization_id = $5 AND version = $6`,
        [input.assignmentId, input.now, input.status, input.reason,
          input.organizationId, input.expectedVersion],
      );
      const updated = await loadAssignment(client, input.organizationId, input.assignmentId, true);
      if (updated === undefined) throw new Error('Care assignment disappeared while ending');
      await recordAudit(client, {
        organizationId: updated.organizationId, actorProfileId: input.actorProfileId,
        action: 'care_assignment.ended', objectType: 'care_assignment',
        objectId: updated.assignmentId, reason: input.reason, correlationId: input.correlationId,
        metadata: { status: updated.status, version: updated.version },
      });
      await appendAssignmentEvent(client, updated, input.correlationId, input.now);
      return updated;
    });
  }

  async recordDenial(
    organizationId: string | null, objectType: 'consent_grant' | 'care_assignment',
    objectId: string | null, actorProfileId: string, action: string,
    code: string, correlationId: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(), CASE WHEN $1::uuid IS NOT NULL AND EXISTS
        (SELECT 1 FROM organizations WHERE organization_id = $1::uuid)
        THEN $1::uuid ELSE NULL END, $2, $3, $4, $5, $6, $7, $8)`,
      [organizationId, actorProfileId, action, objectType, objectId, code,
        correlationId, { denial_code: code }],
    );
  }
}

export function serializeConsentGrant(record: ConsentGrantRecord, now = new Date()): Record<string, unknown> {
  return {
    id: record.consentId, organization_id: record.organizationId,
    grantor_profile_id: record.grantorProfileId,
    grantee_profile_id: record.granteeProfileId,
    grantee_membership_id: record.granteeMembershipId,
    scope: record.scope, purpose: record.purpose,
    status: consentStatus(record, now), granted_at: record.grantedAt.toISOString(),
    expires_at: record.expiresAt?.toISOString() ?? null,
    revoked_at: record.revokedAt?.toISOString() ?? null,
    revocation_reason: record.revocationReason, version: record.version,
    created_at: record.createdAt.toISOString(), updated_at: record.updatedAt.toISOString(),
  };
}

export function serializeCareAssignment(record: CareAssignmentRecord): Record<string, unknown> {
  return {
    id: record.assignmentId, organization_id: record.organizationId,
    clinician_membership_id: record.clinicianMembershipId,
    patient_profile_id: record.patientProfileId, status: record.status,
    assigned_at: record.assignedAt.toISOString(),
    ended_at: record.endedAt?.toISOString() ?? null,
    ended_reason: record.endedReason,
    assigned_by_membership_id: record.assignedByMembershipId,
    version: record.version, created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export function consentStatus(record: ConsentGrantRecord, now: Date): 'active' | 'revoked' | 'expired' {
  if (record.revokedAt !== null) return 'revoked';
  if (record.expiresAt !== null && record.expiresAt <= now) return 'expired';
  return 'active';
}

function consentProjection(): string {
  return `SELECT consent.consent_id AS "consentId", consent.organization_id AS "organizationId",
   consent.grantor_profile_id AS "grantorProfileId",
   consent.grantee_profile_id AS "granteeProfileId",
   consent.grantee_membership_id AS "granteeMembershipId", consent.scope,
   consent.purpose, consent.granted_at AS "grantedAt", consent.expires_at AS "expiresAt",
   consent.revoked_at AS "revokedAt", consent.revocation_reason AS "revocationReason",
   consent.version, consent.created_at AS "createdAt", consent.updated_at AS "updatedAt"
   FROM consent_grants AS consent`;
}

function assignmentProjection(): string {
  return `SELECT assignment.assignment_id AS "assignmentId",
   assignment.organization_id AS "organizationId",
   assignment.clinician_membership_id AS "clinicianMembershipId",
   assignment.patient_profile_id AS "patientProfileId", assignment.status,
   assignment.assigned_at AS "assignedAt", assignment.ended_at AS "endedAt",
   assignment.ended_reason AS "endedReason",
   assignment.assigned_by_membership_id AS "assignedByMembershipId",
   assignment.version, assignment.created_at AS "createdAt",
   assignment.updated_at AS "updatedAt" FROM care_assignments AS assignment`;
}

async function loadConsent(client: PoolClient, consentId: string, lock: boolean): Promise<ConsentGrantRecord | undefined> {
  const result = await client.query<ConsentRow>(
    `${consentProjection()} WHERE consent.consent_id = $1${lock ? ' FOR UPDATE OF consent' : ''}`,
    [consentId],
  );
  return result.rows[0];
}

async function loadAssignment(
  client: PoolClient, organizationId: string, assignmentId: string, lock: boolean,
): Promise<CareAssignmentRecord | undefined> {
  const result = await client.query<AssignmentRow>(
    `${assignmentProjection()} WHERE assignment.organization_id = $1
     AND assignment.assignment_id = $2${lock ? ' FOR UPDATE OF assignment' : ''}`,
    [organizationId, assignmentId],
  );
  return result.rows[0];
}

async function organizationExists(client: PoolClient, organizationId: string): Promise<boolean> {
  const result = await client.query(
    'SELECT organization_id FROM organizations WHERE organization_id = $1 FOR SHARE',
    [organizationId],
  );
  return result.rowCount === 1;
}

async function patientMembershipEligible(
  client: PoolClient, membershipId: string, profileId: string, organizationId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT membership_id FROM organization_memberships
     WHERE membership_id = $1 AND profile_id = $2 AND organization_id = $3
       AND role_id = 'patient' AND status = 'active' FOR SHARE`,
    [membershipId, profileId, organizationId],
  );
  return result.rowCount === 1;
}

async function consentGranteeEligible(client: PoolClient, input: CreateConsentGrantInput): Promise<boolean> {
  if ((input.granteeProfileId === null) === (input.granteeMembershipId === null)) return false;
  if (input.granteeProfileId !== null) {
    if (input.granteeProfileId === input.grantorProfileId) return false;
    const result = await client.query(
      `SELECT profile.profile_id FROM profiles AS profile
       WHERE profile.profile_id = $1 AND profile.status = 'active'
         AND profile.onboarding_completed_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM organization_memberships AS membership
           WHERE membership.profile_id = profile.profile_id
             AND membership.organization_id = $2 AND membership.status = 'active')
       FOR SHARE OF profile`,
      [input.granteeProfileId, input.organizationId],
    );
    return result.rowCount === 1;
  }
  const result = await client.query(
    `SELECT membership_id FROM organization_memberships
     WHERE membership_id = $1 AND organization_id = $2 AND status = 'active'
       AND role_id IN ('doctor', 'pharmacy', 'emergency')
       AND verification_status = 'approved' FOR SHARE`,
    [input.granteeMembershipId, input.organizationId],
  );
  return result.rowCount === 1;
}

interface AuditInput {
  readonly organizationId: string;
  readonly actorProfileId: string;
  readonly action: string;
  readonly objectType: 'consent_grant' | 'care_assignment';
  readonly objectId: string;
  readonly reason: string | null;
  readonly correlationId: string;
  readonly metadata: Record<string, unknown>;
}

async function recordAudit(client: PoolClient, input: AuditInput): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
     (audit_id, organization_id, actor_profile_id, action, object_type,
      object_id, reason, correlation_id, metadata)
     VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.organizationId, input.actorProfileId, input.action, input.objectType,
      input.objectId, input.reason, input.correlationId, input.metadata],
  );
}

async function appendConsentEvent(
  client: PoolClient, record: ConsentGrantRecord, correlationId: string, now: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events
     (event_id, event_type, event_version, aggregate_type, aggregate_id,
      aggregate_version, payload, correlation_id, occurred_at)
     VALUES (uuidv7(), $1, $2, 'consent_grant', $3, $4, $5, $6, $7)`,
    [CONSENT_CHANGED_EVENT_TYPE, CONSENT_CHANGED_EVENT_VERSION, record.consentId,
      record.version, { consent_id: record.consentId, grantor_profile_id: record.grantorProfileId,
        scope: record.scope, status: consentStatus(record, now) }, correlationId, now],
  );
}

async function appendAssignmentEvent(
  client: PoolClient, record: CareAssignmentRecord, correlationId: string, now: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events
     (event_id, event_type, event_version, aggregate_type, aggregate_id,
      aggregate_version, payload, correlation_id, occurred_at)
     VALUES (uuidv7(), $1, $2, 'care_assignment', $3, $4, $5, $6, $7)`,
    [CARE_ASSIGNMENT_CHANGED_EVENT_TYPE, CARE_ASSIGNMENT_CHANGED_EVENT_VERSION,
      record.assignmentId, record.version, { assignment_id: record.assignmentId,
        patient_profile_id: record.patientProfileId,
        clinician_membership_id: record.clinicianMembershipId, status: record.status },
      correlationId, now],
  );
}
