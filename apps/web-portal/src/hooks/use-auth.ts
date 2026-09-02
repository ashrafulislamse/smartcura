'use client';

import { useCallback, useEffect, useMemo } from 'react';
import {
  canAccessRoute as canAccessRouteForRole,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  type Permission,
} from '@/lib/rbac';
import { useAuthStore, type AuthErrorState, type AuthStatus } from '@/store/authStore';
import type { AuthenticatedUser } from '@/types/auth';
import type {
  BackendPermission,
  BootstrapState,
  Membership,
  Profile,
  RoleId,
  SessionView,
} from '@/types/session';
import { isEligibleMembership } from '@/types/session';

export interface UseAuthResult {
  /** Authoritative status from the backend bootstrap. */
  status: AuthStatus;
  bootstrapState: BootstrapState | null;
  profile: Profile | null;
  session: SessionView | null;
  memberships: Membership[];
  activeMembership: Membership | null;
  activeRole: RoleId | null;
  /** Permissions exactly as issued by the backend for the selected membership. */
  permissions: BackendPermission[];
  /** Display view for existing screens; null until a membership is selected. */
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: AuthErrorState | null;
  checkPermission: (permission: Permission) => boolean;
  checkAnyPermission: (permissions: Permission[]) => boolean;
  checkAllPermissions: (permissions: Permission[]) => boolean;
  canAccessRoute: (route: string) => boolean;
}

export function useAuth(): UseAuthResult {
  const status = useAuthStore(state => state.status);
  const bootstrapState = useAuthStore(state => state.bootstrapState);
  const profile = useAuthStore(state => state.profile);
  const memberships = useAuthStore(state => state.memberships);
  const session = useAuthStore(state => state.session);
  const activeMembershipId = useAuthStore(state => state.activeMembershipId);
  const error = useAuthStore(state => state.error);
  const initialize = useAuthStore(state => state.initialize);

  // Hydrate exactly once; the store de-duplicates concurrent callers.
  useEffect(() => {
    void initialize();
  }, [initialize]);

  const activeMembership = useMemo<Membership | null>(() => {
    if (!activeMembershipId) return null;
    return memberships.find(membership => membership.id === activeMembershipId) ?? null;
  }, [activeMembershipId, memberships]);

  const permissions = useMemo<BackendPermission[]>(
    () => activeMembership?.permissions ?? [],
    [activeMembership],
  );

  const user = useMemo<AuthenticatedUser | null>(() => {
    if (!profile || !activeMembership) return null;
    return {
      id: profile.id,
      email: profile.email,
      name: profile.display_name,
      roles: Array.from(new Set(memberships.filter(isEligibleMembership).map(m => m.role))),
      activeRole: activeMembership.role,
      permissions,
      status: profile.status,
    };
  }, [activeMembership, memberships, permissions, profile]);

  const checkPermission = useCallback(
    (permission: Permission) => hasPermission(permissions, permission),
    [permissions],
  );
  const checkAnyPermission = useCallback(
    (required: Permission[]) => hasAnyPermission(permissions, required),
    [permissions],
  );
  const checkAllPermissions = useCallback(
    (required: Permission[]) => hasAllPermissions(permissions, required),
    [permissions],
  );
  const canAccessRoute = useCallback(
    (route: string) =>
      activeMembership ? canAccessRouteForRole(route, activeMembership.role, permissions) : false,
    [activeMembership, permissions],
  );

  return {
    status,
    bootstrapState,
    profile,
    session,
    memberships,
    activeMembership,
    activeRole: activeMembership?.role ?? session?.active_role ?? null,
    permissions,
    user,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'uninitialized' || status === 'loading',
    error,
    checkPermission,
    checkAnyPermission,
    checkAllPermissions,
    canAccessRoute,
  };
}
