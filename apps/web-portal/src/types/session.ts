/**
 * Backend application session contracts.
 *
 * These types mirror `smartcura-backend/packages/contracts/openapi/openapi.json`
 * (SessionBootstrapResponse and friends) exactly. Field names use the backend's
 * snake_case wire format and all timestamps stay ISO-8601 strings; they are never
 * converted to `Date` so that the portal cannot invent its own session authority.
 */

/** Canonical backend role ids (underscore form, not hyphenated). */
export type RoleId =
  | 'patient'
  | 'doctor'
  | 'driver'
  | 'pharmacy'
  | 'emergency'
  | 'admin'
  | 'super_admin';

export const ROLE_IDS: readonly RoleId[] = [
  'patient',
  'doctor',
  'driver',
  'pharmacy',
  'emergency',
  'admin',
  'super_admin',
] as const;

export type ProfileStatus = 'pending' | 'active' | 'suspended' | 'deactivated';

export type MembershipStatus =
  | 'applied'
  | 'invited'
  | 'active'
  | 'suspended'
  | 'revoked'
  | 'expired';

export type VerificationStatus =
  | 'not_submitted'
  | 'pending_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'expired';

export type AppSessionStatus =
  | 'active'
  | 'idle_expired'
  | 'absolute_expired'
  | 'revoked'
  | 'membership_ended';

export type ClientType =
  | 'patient_flutter'
  | 'doctor_flutter'
  | 'driver_flutter'
  | 'web_portal';

/** The single authoritative gate for what the portal may render. */
export type BootstrapState =
  | 'profile_required'
  | 'verification_pending'
  | 'role_selection_required'
  | 'ready';

/** Permission string in `resource:action[:scope]` form as issued by the backend. */
export type BackendPermission = string;

export interface Profile {
  id: string;
  status: ProfileStatus;
  display_name: string;
  email: string;
  phone_e164: string | null;
  preferred_locale: string;
  timezone: string;
  /** ISO-8601 timestamp or null. */
  onboarding_completed_at: string | null;
  /** ISO-8601 timestamp. */
  created_at: string;
  /** ISO-8601 timestamp. */
  updated_at: string;
}

export interface Membership {
  id: string;
  organization_id: string;
  site_ids: string[];
  role: RoleId;
  status: MembershipStatus;
  verification_status: VerificationStatus | null;
  permissions: BackendPermission[];
}

export interface SessionView {
  id: string;
  status: AppSessionStatus;
  profile_id: string;
  active_role: RoleId | null;
  /** ISO-8601 timestamp. */
  created_at: string;
  /** ISO-8601 timestamp. */
  last_activity_at: string;
  /** ISO-8601 timestamp; server-owned idle deadline. */
  idle_expires_at: string;
  /** ISO-8601 timestamp; server-owned absolute deadline. */
  absolute_expires_at: string;
  /** ISO-8601 timestamp or null. */
  step_up_valid_until: string | null;
}

export interface SessionBootstrapResponse {
  bootstrap_state: BootstrapState;
  csrf_token: string;
  profile: Profile;
  memberships: Membership[];
  session: SessionView;
}

export interface CreateSessionRequest {
  client_type: ClientType;
  device_name: string;
  requested_role?: RoleId | null;
}

export interface SelectActiveRoleRequest {
  membership_id: string;
}

export type StepUpReason =
  | 'role_switch'
  | 'prescription_sign'
  | 'break_glass'
  | 'controlled_substance'
  | 'payout'
  | 'withdrawal'
  | 'security_change'
  | 'dependant_access_change';

export interface StepUpRequest {
  reason: StepUpReason;
}

export interface StepUpResponse {
  session_id: string;
  /** ISO-8601 timestamp until which the step-up remains valid. */
  valid_until: string;
  csrf_token: string;
}

export type ProblemCode =
  | 'AUTH_TOKEN_INVALID'
  | 'APP_SESSION_INVALID'
  | 'MEMBERSHIP_INACTIVE'
  | 'PERMISSION_DENIED'
  | 'OBJECT_ACCESS_DENIED'
  | 'CONSENT_REQUIRED'
  | 'STEP_UP_REQUIRED'
  | 'BREAK_GLASS_REQUIRED'
  | 'RESOURCE_NOT_FOUND'
  | 'MEMBERSHIP_ALREADY_EXISTS'
  | 'MEMBERSHIP_VERSION_CONFLICT'
  | 'MEMBERSHIP_TRANSITION_INVALID'
  | 'MEMBERSHIP_SELF_MODIFICATION_DENIED'
  | 'LAST_ADMIN_REQUIRED'
  | 'ROLE_SWITCH_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface FieldViolation {
  field: string;
  code: string;
  message: string;
}

/** RFC 9457 `application/problem+json` payload returned by the backend. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string | null;
  instance?: string | null;
  code: ProblemCode;
  correlation_id: string;
  errors?: FieldViolation[];
}

/** Memberships the backend considers eligible for active-role selection. */
export function isEligibleMembership(membership: Membership): boolean {
  if (membership.status !== 'active') return false;
  if (!roleRequiresVerification(membership.role)) return true;
  return membership.verification_status === 'approved';
}

export function roleRequiresVerification(role: RoleId): boolean {
  return role === 'doctor' || role === 'driver' || role === 'pharmacy' || role === 'emergency';
}
