/**
 * Directory surface: the approved-doctor directory and organization membership
 * administration.
 *
 * A NOTE THAT SHAPES EVERY PAGE BUILT ON THIS. Only two endpoints in the whole API expose
 * another person's name: this doctor directory, and the emergency break-glass disclosure.
 * `Profile` carries `display_name` and `email` but is reachable only as `/profiles/me`.
 * So a membership list can show a role, a status and a verification state, but it CANNOT
 * show who the person is — and no amount of client work changes that. Pages must show the
 * identifier rather than inventing a name, and a page whose entire purpose is to identify
 * people should not be built on memberships at all until an endpoint resolves names.
 */

import type {
  CreateMembershipInvitationRequest,
  DoctorDirectoryItem,
  DoctorDirectoryPage,
  DoctorProfessionalDetail,
  DoctorReviewPage,
  MembershipAdministrationListResponse,
  MembershipAdministrationView,
  MembershipStatus,
  ProfileStatus,
  RoleId,
  TransitionMembershipStatusRequest,
  UnknownEnumValue,
  VerificationStatus,
} from '@/types/contracts';
import { apiRequest } from './client';

export type { MembershipStatus, ProfileStatus, RoleId, VerificationStatus };

export type DoctorSort = 'soonest' | 'rating' | 'fee';

/**
 * One approved doctor's profile, read by membership.
 *
 * The read-one endpoint returns the directory item plus a `reviews_preview`; the portal's
 * generated `DoctorProfile` type is currently a bare `string`, so the page consumes the
 * shared directory-item shape, which is exactly what the endpoint's base object is.
 */
export function getDoctor(
  membershipId: string,
  signal?: AbortSignal,
): Promise<DoctorDirectoryItem> {
  return apiRequest<DoctorDirectoryItem>({
    method: 'GET',
    path: `/doctors/${encodeURIComponent(membershipId)}`,
    signal,
  });
}

export function listDoctors(
  options: {
    q?: string;
    specialty?: string;
    language?: string;
    maxFeeSen?: number;
    minRating?: number;
    acceptsNewPatients?: boolean;
    sort?: DoctorSort;
    signal?: AbortSignal;
  } = {},
): Promise<DoctorDirectoryPage> {
  const params = new URLSearchParams();
  if (options.q) params.set('q', options.q);
  if (options.specialty) params.set('specialty', options.specialty);
  if (options.language) params.set('language', options.language);
  if (options.maxFeeSen !== undefined) params.set('max_fee_sen', String(options.maxFeeSen));
  if (options.minRating !== undefined) params.set('min_rating', String(options.minRating));
  if (options.acceptsNewPatients !== undefined) {
    params.set('accepts_new_patients', String(options.acceptsNewPatients));
  }
  if (options.sort) params.set('sort', options.sort);
  const encoded = params.toString();
  return apiRequest<DoctorDirectoryPage>({
    method: 'GET',
    path: `/doctors${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

/**
 * Organization memberships. The organization comes from the caller's own membership rather
 * than being chosen in the UI: a supplied id could only ever be the one they already reach.
 */
export function listMemberships(
  organizationId: string,
  signal?: AbortSignal,
): Promise<MembershipAdministrationListResponse> {
  return apiRequest<MembershipAdministrationListResponse>({
    method: 'GET',
    path: `/organizations/${organizationId}/memberships`,
    signal,
  });
}

// --------------------------------------------------------- doctor reviews

/** Lists anonymous verified-appointment reviews for an approved doctor. */
export function listDoctorReviews(
  membershipId: string,
  options: { cursor?: string; pageSize?: number; signal?: AbortSignal } = {},
): Promise<DoctorReviewPage> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  return apiRequest<DoctorReviewPage>({
    method: 'GET',
    path: `/doctors/${encodeURIComponent(membershipId)}/reviews${suffix}`,
    signal: options.signal,
  });
}

// --------------------------------------------------------- doctor professional details

/** Reads the professional detail for a doctor membership (own, or approved public view). */
export function readDoctorDetails(
  membershipId: string,
  signal?: AbortSignal,
): Promise<DoctorProfessionalDetail> {
  return apiRequest<DoctorProfessionalDetail>({
    method: 'GET',
    path: `/memberships/${encodeURIComponent(membershipId)}/doctor-details`,
    signal,
  });
}

/**
 * Creates or replaces own professional detail. Specialties and languages are replaced as a set.
 * The request body is the full `DoctorProfessionalDetail` shape (the PUT uses the same schema
 * as the GET response, with `expected_version` added for optimistic concurrency).
 */
export function updateDoctorDetails(
  membershipId: string,
  body: Omit<DoctorProfessionalDetail, 'membership_id'>,
): Promise<DoctorProfessionalDetail> {
  return apiRequest<DoctorProfessionalDetail>({
    method: 'PUT',
    path: `/memberships/${encodeURIComponent(membershipId)}/doctor-details`,
    body,
    csrf: true,
  });
}

// --------------------------------------------------------- membership admin mutations

/** Activates, suspends, reactivates or revokes a membership. Step-up required. */
export function transitionMembershipStatus(
  organizationId: string,
  membershipId: string,
  body: TransitionMembershipStatusRequest,
): Promise<MembershipAdministrationView> {
  return apiRequest<MembershipAdministrationView>({
    method: 'PUT',
    path: `/organizations/${organizationId}/memberships/${membershipId}/status`,
    body,
    csrf: true,
  });
}

/** Creates a membership invitation for an existing profile. Step-up required. */
export function createMembershipInvitation(
  organizationId: string,
  body: CreateMembershipInvitationRequest,
  idempotencyKey: string,
): Promise<MembershipAdministrationView> {
  return apiRequest<MembershipAdministrationView>({
    method: 'POST',
    path: `/organizations/${organizationId}/memberships/invitations`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Integer sen to a display string. Two fixed decimals, no locale rounding surprises. */
export function formatSen(amountSen: number, currency = 'MYR'): string {
  const negative = amountSen < 0;
  const absolute = Math.abs(amountSen);
  const major = Math.trunc(absolute / 100).toLocaleString('en-MY');
  const minor = String(absolute % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${currency} ${major}.${minor}`;
}

export function humaniseCode(code: string): string {
  return code.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

export function shortId(value: string | null): string {
  return value ? value.slice(0, 8) : '—';
}

export function formatInstant(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

/** Initials from a real name, for an avatar. Never called on an identifier. */
export function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

/**
 * Style maps keyed EXHAUSTIVELY over the generated enums rather than over strings I typed.
 *
 * This is the never-retype-an-enum rule, and it caught a real defect: I had originally
 * written `not_required` and `pending`, neither of which exists. The real values are
 * `not_submitted`, `pending_review`, `changes_requested`, `approved`, `rejected`,
 * `suspended` and `expired`. A hand-typed `Record<string, string>` accepted the invented
 * keys silently and would have rendered a default style forever, and a stat counting
 * `=== 'pending'` would have read zero permanently.
 *
 * `UnknownEnumValue` is the generated forward-compatibility escape hatch — a value the
 * server may add later — so it is excluded from the exhaustive key set and handled by the
 * lookup falling through at the call site.
 */
type KnownRole = Exclude<RoleId, UnknownEnumValue>;
type KnownMembershipStatus = Exclude<MembershipStatus, UnknownEnumValue>;
type KnownVerificationStatus = Exclude<VerificationStatus, UnknownEnumValue>;
type KnownProfileStatus = Exclude<ProfileStatus, UnknownEnumValue>;

export const ROLE_STYLE: Record<KnownRole, string> = {
  patient: 'bg-slate-50 text-slate-700 border-slate-100',
  doctor: 'bg-blue-50 text-blue-700 border-blue-100',
  driver: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  pharmacy: 'bg-teal-50 text-teal-700 border-teal-100',
  emergency: 'bg-red-50 text-red-700 border-red-100',
  admin: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  super_admin: 'bg-purple-50 text-purple-700 border-purple-100',
};

export const STATUS_STYLE: Record<KnownMembershipStatus, string> = {
  applied: 'bg-blue-50 text-blue-700 border-blue-100',
  invited: 'bg-amber-50 text-amber-700 border-amber-100',
  active: 'bg-green-50 text-green-700 border-green-100',
  suspended: 'bg-orange-50 text-orange-700 border-orange-100',
  revoked: 'bg-red-50 text-red-700 border-red-100',
  expired: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const VERIFICATION_STYLE: Record<KnownVerificationStatus, string> = {
  not_submitted: 'bg-slate-50 text-slate-600 border-slate-100',
  pending_review: 'bg-amber-50 text-amber-700 border-amber-100',
  changes_requested: 'bg-orange-50 text-orange-700 border-orange-100',
  approved: 'bg-green-50 text-green-700 border-green-100',
  rejected: 'bg-red-50 text-red-700 border-red-100',
  suspended: 'bg-orange-50 text-orange-700 border-orange-100',
  expired: 'bg-slate-100 text-slate-600 border-slate-200',
};

/**
 * The verification states that mean "a human still has to act". Named once here so a page
 * counting outstanding work cannot drift from the vocabulary, which is exactly how a stat
 * counting a non-existent `pending` would have silently read zero.
 */
export const VERIFICATION_AWAITING_ACTION: readonly KnownVerificationStatus[] = [
  'pending_review',
  'changes_requested',
];

/**
 * Profile lifecycle status — the `profiles.status` column, not verification.
 * `pending` means onboarding is incomplete; `active` is the normal state;
 * `suspended` and `deactivated` are administrative holds.
 */
export const PROFILE_STATUS_STYLE: Record<KnownProfileStatus, string> = {
  pending: 'bg-blue-50 text-blue-700 border-blue-100',
  active: 'bg-green-50 text-green-700 border-green-100',
  suspended: 'bg-orange-50 text-orange-700 border-orange-100',
  deactivated: 'bg-slate-100 text-slate-600 border-slate-200',
};

/** Roles that can act across the organization rather than within one site. */
export const PRIVILEGED_ROLES: readonly KnownRole[] = ['admin', 'super_admin'];
