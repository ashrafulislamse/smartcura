import type { QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';

export interface PatientDirectoryRecord { profileId: string; displayName: string; email: string; phoneE164: string | null; status: string; membershipId: string; joinedAt: Date; }
export interface AssignedPatientRecord { profileId: string; displayName: string; email: string; phoneE164: string | null; preferredLocale: string; timezone: string; status: string; assignedAt: Date; }
export interface VerificationQueueRecord { documentId: string; membershipId: string; profileId: string; displayName: string; roleId: string; documentKind: string; status: string; submittedAt: Date; version: number; }
export interface AuditLogRecord { auditId: string; actorProfileId: string | null; action: string; objectType: string; objectId: string | null; reason: string | null; correlationId: string; metadata: Record<string, unknown>; occurredAt: Date; }
interface PatientRow extends QueryResultRow, PatientDirectoryRecord {}
interface AssignedPatientRow extends QueryResultRow, AssignedPatientRecord {}
interface VerificationRow extends QueryResultRow, VerificationQueueRecord {}
interface AuditRow extends QueryResultRow, AuditLogRecord {}

export class WorkstreamFRepository {
  constructor(private readonly database: PostgresConnection) {}

  async listPatients(organizationId: string, search: string | undefined, limit: number): Promise<PatientDirectoryRecord[]> {
    const result = await this.database.query<PatientRow>(
      `SELECT membership.membership_id AS "membershipId", profile.profile_id AS "profileId",
       profile.display_name AS "displayName", profile.email, profile.phone_e164 AS "phoneE164",
       profile.status, membership.created_at AS "joinedAt"
       FROM organization_memberships membership JOIN profiles profile ON profile.profile_id = membership.profile_id
       WHERE membership.organization_id = $1 AND membership.role_id = 'patient' AND membership.status <> 'revoked'
       AND ($2::text IS NULL OR profile.display_name ILIKE '%' || $2 || '%' OR profile.email ILIKE '%' || $2 || '%')
       ORDER BY profile.display_name, profile.profile_id LIMIT $3`, [organizationId, search ?? null, limit]);
    return result.rows;
  }

  async findPatient(organizationId: string, profileId: string): Promise<PatientDirectoryRecord | undefined> {
    const result = await this.database.query<PatientRow>(
      `SELECT membership.membership_id AS "membershipId", profile.profile_id AS "profileId",
       profile.display_name AS "displayName", profile.email, profile.phone_e164 AS "phoneE164",
       profile.status, membership.created_at AS "joinedAt"
       FROM organization_memberships membership JOIN profiles profile ON profile.profile_id = membership.profile_id
       WHERE membership.organization_id = $1 AND membership.profile_id = $2
         AND membership.role_id = 'patient' AND membership.status <> 'revoked'
       ORDER BY membership.created_at DESC LIMIT 1`, [organizationId, profileId]);
    return result.rows[0];
  }

  async listAssignedPatients(clinicianMembershipId: string, search: string | undefined, after: { assignedAt: Date; profileId: string } | undefined, limit: number): Promise<AssignedPatientRecord[]> {
    const result = await this.database.query<AssignedPatientRow>(
      `SELECT profile.profile_id AS "profileId", profile.display_name AS "displayName",
       profile.email, profile.phone_e164 AS "phoneE164", profile.preferred_locale AS "preferredLocale",
       profile.timezone, profile.status, assignment.assigned_at AS "assignedAt"
       FROM care_assignments assignment
       JOIN profiles profile ON profile.profile_id = assignment.patient_profile_id
       WHERE assignment.clinician_membership_id = $1 AND assignment.status = 'active'
       AND ($2::text IS NULL OR profile.display_name ILIKE '%' || $2 || '%' OR profile.email ILIKE '%' || $2 || '%')
       AND ($3::timestamptz IS NULL OR (assignment.assigned_at, profile.profile_id) < ($3, $4::uuid))
       ORDER BY assignment.assigned_at DESC, profile.profile_id DESC LIMIT $5`,
      [clinicianMembershipId, search ?? null, after?.assignedAt ?? null, after?.profileId ?? null, limit],
    );
    return result.rows;
  }

  async findAssignedPatient(clinicianMembershipId: string, profileId: string): Promise<AssignedPatientRecord | undefined> {
    const result = await this.database.query<AssignedPatientRow>(
      `SELECT profile.profile_id AS "profileId", profile.display_name AS "displayName",
       profile.email, profile.phone_e164 AS "phoneE164", profile.preferred_locale AS "preferredLocale",
       profile.timezone, profile.status, assignment.assigned_at AS "assignedAt"
       FROM care_assignments assignment
       JOIN profiles profile ON profile.profile_id = assignment.patient_profile_id
       WHERE assignment.clinician_membership_id = $1 AND assignment.patient_profile_id = $2
         AND assignment.status = 'active' LIMIT 1`, [clinicianMembershipId, profileId]);
    return result.rows[0];
  }

  async listVerificationQueue(organizationId: string, status: string | undefined, limit: number): Promise<VerificationQueueRecord[]> {
    const result = await this.database.query<VerificationRow>(
      `SELECT document.document_id AS "documentId", document.membership_id AS "membershipId",
       membership.profile_id AS "profileId", profile.display_name AS "displayName",
       membership.role_id AS "roleId", document.document_kind AS "documentKind",
       document.status, document.submitted_at AS "submittedAt", document.version
       FROM verification_documents document
       JOIN organization_memberships membership ON membership.membership_id = document.membership_id
       JOIN profiles profile ON profile.profile_id = membership.profile_id
       WHERE document.organization_id = $1 AND ($2::text IS NULL OR document.status = $2::verification_status)
       ORDER BY CASE WHEN document.status = 'pending_review' THEN 0 ELSE 1 END,
         document.submitted_at, document.document_id LIMIT $3`, [organizationId, status ?? null, limit]);
    return result.rows;
  }

  async listAuditLogs(organizationId: string, action: string | undefined, objectType: string | undefined, limit: number): Promise<AuditLogRecord[]> {
    const result = await this.database.query<AuditRow>(
      `SELECT audit_id AS "auditId", actor_profile_id AS "actorProfileId", action,
       object_type AS "objectType", object_id AS "objectId", reason,
       correlation_id AS "correlationId", metadata, occurred_at AS "occurredAt"
       FROM audit_logs WHERE organization_id = $1
       AND ($2::text IS NULL OR action = $2) AND ($3::text IS NULL OR object_type = $3)
       ORDER BY occurred_at DESC, audit_id DESC LIMIT $4`, [organizationId, action ?? null, objectType ?? null, limit]);
    return result.rows;
  }
}
