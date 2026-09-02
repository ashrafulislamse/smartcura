/**
 * Portal auth view models.
 *
 * Backend session contracts live in `@/types/session` and are re-exported here so
 * existing imports keep working. Role ids are the backend canonical ids
 * (`super_admin`, not `super-admin`) — the portal no longer rewrites them.
 */

import type { Permission } from '@/lib/rbac';
import type { ProfileStatus, RoleId } from '@/types/session';

export type {
  AppSessionStatus,
  BackendPermission,
  BootstrapState,
  ClientType,
  CreateSessionRequest,
  FieldViolation,
  Membership,
  MembershipStatus,
  ProblemCode,
  ProblemDetails,
  Profile,
  ProfileStatus,
  RoleId,
  SelectActiveRoleRequest,
  SessionBootstrapResponse,
  SessionView,
  StepUpReason,
  StepUpRequest,
  StepUpResponse,
  VerificationStatus,
} from '@/types/session';

/** Alias kept for call sites that distinguished backend ids from portal ids. */
export type BackendRoleId = RoleId;

/** Display-only view for portal screens, derived only from backend session data. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  roles: RoleId[];
  activeRole: RoleId;
  permissions: Permission[];
  status: ProfileStatus;
}
