/**
 * Workstream F: organization-scoped surfaces that don't fit a single domain.
 *
 * Patient directory, verification queue, and audit logs are all org-scoped read
 * endpoints grouped under the backend's workstream-f controller. They share an
 * organization-id path parameter and require the same `membership:manage:organization`
 * or `verification.document:read:organization` permission.
 *
 * TYPES. The queue and patient records use generated contract enums rather than
 * bare strings, so the compiler catches an invented status or document kind the
 * way it caught `not_required` and `pending` in the verification vocabulary (see
 * the trap entry in AGENTS.md). `VerificationDocumentView` is the full per-document
 * record from the generated contract; the queue row is a projection of it.
 */
import type {
  ProfileStatus,
  ReviewVerificationDocumentRequest,
  RoleId,
  VerificationDocumentKind,
  VerificationDocumentListResponse,
  VerificationDocumentView,
  VerificationFileDownloadResponse,
  VerificationStatus,
} from '@/types/contracts';
import { apiRequest } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatientDirectoryRecord {
  profile_id: string;
  membership_id: string;
  display_name: string;
  email: string;
  phone_e164: string | null;
  status: ProfileStatus;
  joined_at: string;
}

export interface PatientDirectoryResponse {
  data: PatientDirectoryRecord[];
}

/**
 * A row in the organization verification queue. This is the projection the
 * `GET /organizations/{id}/verification-queue` endpoint returns — enough to
 * triage without the full file metadata. The detail page fetches the complete
 * `VerificationDocumentView` via `listVerificationDocuments`.
 */
export interface VerificationQueueRecord {
  document_id: string;
  membership_id: string;
  profile_id: string;
  display_name: string;
  role_id: RoleId;
  document_kind: VerificationDocumentKind;
  status: VerificationStatus;
  submitted_at: string;
  version: number;
}

export interface VerificationQueueResponse {
  data: VerificationQueueRecord[];
}

export interface AuditLogRecord {
  audit_id: string;
  actor_profile_id: string;
  action: string;
  object_type: string;
  object_id: string;
  reason: string | null;
  correlation_id: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export interface AuditLogResponse {
  data: AuditLogRecord[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') search.set(key, String(value));
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

// ---------------------------------------------------------------------------
// Patient directory
// ---------------------------------------------------------------------------

export function listOrganizationPatients(
  organizationId: string,
  options: { search?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PatientDirectoryResponse> {
  return apiRequest<PatientDirectoryResponse>({
    method: 'GET',
    path: `/organizations/${organizationId}/patients${query({ search: options.search, limit: options.limit })}`,
    signal: options.signal,
  });
}

export function readOrganizationPatient(
  organizationId: string,
  patientProfileId: string,
  signal?: AbortSignal,
): Promise<PatientDirectoryRecord> {
  return apiRequest<PatientDirectoryRecord>({
    method: 'GET',
    path: `/organizations/${organizationId}/patients/${patientProfileId}`,
    signal,
  });
}

// ---------------------------------------------------------------------------
// Verification queue + review
// ---------------------------------------------------------------------------

export function listVerificationQueue(
  organizationId: string,
  options: { status?: VerificationStatus; limit?: number; signal?: AbortSignal } = {},
): Promise<VerificationQueueResponse> {
  return apiRequest<VerificationQueueResponse>({
    method: 'GET',
    path: `/organizations/${organizationId}/verification-queue${query({ status: options.status, limit: options.limit })}`,
    signal: options.signal,
  });
}

/**
 * Fetch the full verification documents for one membership. The detail/review
 * page uses this to get the complete `VerificationDocumentView` (file metadata,
 * scan state, downloadability) that the queue row deliberately withholds.
 */
export function listVerificationDocuments(
  membershipId: string,
  options: { pageSize?: number; signal?: AbortSignal } = {},
): Promise<VerificationDocumentListResponse> {
  return apiRequest<VerificationDocumentListResponse>({
    method: 'GET',
    path: `/memberships/${membershipId}/verification-documents${query({ page_size: options.pageSize })}`,
    signal: options.signal,
  });
}

/**
 * Fetch a single verification document by id. The detail/review page uses this
 * to resolve one document directly, rather than loading the membership's whole
 * list and finding by id (which fails past the first page of documents).
 */
export function readVerificationDocument(
  membershipId: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<VerificationDocumentView> {
  return apiRequest<VerificationDocumentView>({
    method: 'GET',
    path: `/memberships/${membershipId}/verification-documents/${encodeURIComponent(documentId)}`,
    signal,
  });
}

/**
 * Record a reviewer decision on a verification document.
 * Calls `PUT /organizations/{orgId}/verification-documents/{documentId}/status`.
 * Requires CSRF and MFA step-up. `expected_version` makes a repeated review
 * a 409 conflict rather than a second decision.
 */
export function reviewVerificationDocument(
  organizationId: string,
  documentId: string,
  body: ReviewVerificationDocumentRequest,
): Promise<VerificationDocumentView> {
  return apiRequest<VerificationDocumentView>({
    method: 'PUT',
    path: `/organizations/${organizationId}/verification-documents/${documentId}/status`,
    body,
    csrf: true,
  });
}

/**
 * Requests a short-lived download URL for a verification file. The URL expires at `expires_at`,
 * so the caller must open it immediately rather than storing it.
 */
export function downloadVerificationDocument(
  membershipId: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<VerificationFileDownloadResponse> {
  return apiRequest<VerificationFileDownloadResponse>({
    method: 'GET',
    path: `/memberships/${membershipId}/verification-documents/${encodeURIComponent(documentId)}/download`,
    signal,
  });
}

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

export function listAuditLogs(
  organizationId: string,
  options: { action?: string; objectType?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<AuditLogResponse> {
  return apiRequest<AuditLogResponse>({
    method: 'GET',
    path: `/organizations/${organizationId}/audit-logs${query({ action: options.action, object_type: options.objectType, limit: options.limit })}`,
    signal: options.signal,
  });
}
