import { Injectable } from '@nestjs/common';
import { WorkstreamFRepository, type PatientDirectoryRecord, type AssignedPatientRecord, type VerificationQueueRecord, type AuditLogRecord } from '@smartcura/database';
import { problem, validationFailed } from '../platform/problems.js';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import { patientQuerySchema, assignedPatientQuerySchema, verificationQuerySchema, auditQuerySchema, uuidSchema } from './workstream-f.schemas.js';

@Injectable()
export class WorkstreamFService {
  constructor(private readonly repository: WorkstreamFRepository) {}
  private admin(current: AuthenticatedSession, permission: string) {
    const active = current.aggregate.memberships.find((m) => m.membershipId === current.aggregate.session.activeMembershipId);
    if (!active || active.status !== 'active' || (!active.permissions.includes(permission) && !active.permissions.includes('audit:read:global') && !active.permissions.includes('system.security:*:global'))) throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    return active;
  }
  private organization(current: AuthenticatedSession, organizationId: string, permission: string) {
    const a = this.admin(current, permission);
    if (a.organizationId !== organizationId && !a.roleId.includes('super_admin')) throw problem(404, 'RESOURCE_NOT_FOUND', 'Organization was not found');
    return a;
  }
  async patients(current: AuthenticatedSession, organizationId: string, value: unknown) { const q = patientQuerySchema.safeParse(value); if (!q.success) throw validationFailed(); const a = this.organization(current, organizationId, 'membership:manage:organization'); return { data: (await this.repository.listPatients(a.organizationId, q.data.search, q.data.limit)).map(patientResponse) }; }
  async patient(current: AuthenticatedSession, organizationId: string, id: string) { const profileId = uuidSchema.safeParse(id); if (!profileId.success) throw validationFailed(); const a = this.organization(current, organizationId, 'membership:manage:organization'); const row = await this.repository.findPatient(a.organizationId, id); if (!row) throw problem(404, 'RESOURCE_NOT_FOUND', 'Patient was not found'); return patientResponse(row); }
  async assignedPatients(current: AuthenticatedSession, value: unknown) {
    const q = assignedPatientQuerySchema.safeParse(value); if (!q.success) throw validationFailed();
    const active = current.aggregate.memberships.find((m) => m.membershipId === current.aggregate.session.activeMembershipId);
    if (!active || active.status !== 'active' || active.roleId !== 'doctor' || !active.permissions.includes('profile_detail:read:assigned')) throw problem(403, 'PERMISSION_DENIED', 'Doctor assignment authority is required');
    const cursor = q.data.cursor === undefined ? undefined : decodeAssignedCursor(q.data.cursor);
    const rows = await this.repository.listAssignedPatients(active.membershipId, q.data.search, cursor, q.data.page_size + 1);
    const more = rows.length > q.data.page_size; const data = more ? rows.slice(0, q.data.page_size) : rows; const last = data.at(-1);
    return { data: data.map(assignedPatientResponse), page: { has_more: more, next_cursor: more && last ? encodeAssignedCursor(last) : null } };
  }
  async assignedPatient(current: AuthenticatedSession, id: string) {
    const parsed = uuidSchema.safeParse(id); if (!parsed.success) throw validationFailed();
    const active = current.aggregate.memberships.find((m) => m.membershipId === current.aggregate.session.activeMembershipId);
    if (!active || active.status !== 'active' || active.roleId !== 'doctor' || !active.permissions.includes('profile_detail:read:assigned')) throw problem(403, 'PERMISSION_DENIED', 'Doctor assignment authority is required');
    const row = await this.repository.findAssignedPatient(active.membershipId, id); if (!row) throw problem(404, 'RESOURCE_NOT_FOUND', 'Patient was not found'); return assignedPatientResponse(row);
  }
  async verification(current: AuthenticatedSession, organizationId: string, value: unknown) { const q = verificationQuerySchema.safeParse(value); if (!q.success) throw validationFailed(); const a = this.organization(current, organizationId, 'verification.document:read:organization'); return { data: (await this.repository.listVerificationQueue(a.organizationId, q.data.status, q.data.limit)).map(verificationResponse) }; }
  async audit(current: AuthenticatedSession, organizationId: string, value: unknown) { const q = auditQuerySchema.safeParse(value); if (!q.success) throw validationFailed(); const a = this.organization(current, organizationId, 'audit:read:organization'); return { data: (await this.repository.listAuditLogs(a.organizationId, q.data.action, q.data.object_type, q.data.limit)).map(auditResponse) }; }
}
function patientResponse(r: PatientDirectoryRecord) { return { profile_id:r.profileId, membership_id:r.membershipId, display_name:r.displayName, email:r.email, phone_e164:r.phoneE164, status:r.status, joined_at:r.joinedAt.toISOString() }; }
function assignedPatientResponse(r: AssignedPatientRecord) { return { profile_id:r.profileId, display_name:r.displayName, email:r.email, phone_e164:r.phoneE164, preferred_locale:r.preferredLocale, timezone:r.timezone, status:r.status, assigned_at:r.assignedAt.toISOString() }; }
function encodeAssignedCursor(r: AssignedPatientRecord): string { return Buffer.from(JSON.stringify({ assigned_at:r.assignedAt.toISOString(), profile_id:r.profileId })).toString('base64url'); }
function decodeAssignedCursor(value: string): { assignedAt: Date; profileId: string } { try { const v = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>; if (typeof v.assigned_at !== 'string' || typeof v.profile_id !== 'string' || !uuidSchema.safeParse(v.profile_id).success) throw new Error(); const d = new Date(v.assigned_at); if (!Number.isFinite(d.getTime())) throw new Error(); return { assignedAt:d, profileId:v.profile_id }; } catch { throw validationFailed(); } }
function verificationResponse(r: VerificationQueueRecord) { return { document_id:r.documentId, membership_id:r.membershipId, profile_id:r.profileId, display_name:r.displayName, role_id:r.roleId, document_kind:r.documentKind, status:r.status, submitted_at:r.submittedAt.toISOString(), version:r.version }; }
function auditResponse(r: AuditLogRecord) { return { audit_id:r.auditId, actor_profile_id:r.actorProfileId, action:r.action, object_type:r.objectType, object_id:r.objectId, reason:r.reason, correlation_id:r.correlationId, metadata:r.metadata, occurred_at:r.occurredAt.toISOString() }; }
