/**
 * Application session store.
 *
 * The backend is the only authority. Nothing here is persisted: no zustand
 * persist middleware, no localStorage, no sessionStorage. State is a projection
 * of the last `SessionBootstrapResponse` the API returned, and permissions come
 * exclusively from the membership the backend reports as selected. The CSRF token
 * lives in memory only, mirroring the session client.
 */

import { create } from 'zustand';
import {
  SessionApiError,
  clearCsrfToken,
  createSession as createBackendSession,
  getCurrentSession,
  refreshSession,
  revokeCurrentSession,
  selectActiveRole,
  stepUpSession,
} from '@/lib/api/session-client';
import {
  canAccessRoute as canAccessRouteForRole,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  type Permission,
} from '@/lib/rbac';
import type {
  BackendPermission,
  BootstrapState,
  ClientType,
  Membership,
  Profile,
  RoleId,
  SessionBootstrapResponse,
  SessionView,
  StepUpReason,
} from '@/types/session';
import { isEligibleMembership } from '@/types/session';

export type AuthStatus = 'uninitialized' | 'loading' | 'authenticated' | 'anonymous' | 'error';

export const DEFAULT_DEVICE_NAME = 'SmartCura Web Portal';

export interface AuthErrorState {
  status: number;
  code: string;
  title: string;
  correlationId: string | null;
  message: string;
}

export interface AuthState {
  status: AuthStatus;
  /** Authoritative gate reported by the backend. */
  bootstrapState: BootstrapState | null;
  profile: Profile | null;
  memberships: Membership[];
  activeMembershipId: string | null;
  session: SessionView | null;
  /** In-memory only; mirrors the session client's token. */
  csrfToken: string | null;
  error: AuthErrorState | null;
  /** Raw payload of the last bootstrap response, for screens that need it whole. */
  bootstrap: SessionBootstrapResponse | null;

  initialize: () => Promise<void>;
  createSession: (
    idToken: string,
    clientType?: ClientType,
    deviceName?: string,
  ) => Promise<SessionBootstrapResponse>;
  refresh: (idToken: string) => Promise<SessionBootstrapResponse>;
  stepUp: (idToken: string, reason: StepUpReason) => Promise<void>;
  selectMembership: (membershipId: string) => Promise<SessionBootstrapResponse>;
  logout: () => Promise<void>;

  /** Permission checks, backed only by the active membership's backend permissions. */
  checkPermission: (permission: Permission) => boolean;
  checkAnyPermission: (permissions: Permission[]) => boolean;
  checkAllPermissions: (permissions: Permission[]) => boolean;
  canAccessRoute: (route: string) => boolean;
}

const anonymousState = {
  status: 'anonymous' as AuthStatus,
  bootstrapState: null,
  profile: null,
  memberships: [] as Membership[],
  activeMembershipId: null,
  session: null,
  csrfToken: null,
  error: null,
  bootstrap: null,
};

function toAuthError(error: unknown): AuthErrorState {
  if (error instanceof SessionApiError) {
    return {
      status: error.status,
      code: error.code,
      title: error.title,
      correlationId: error.correlationId,
      message: error.message,
    };
  }
  return {
    status: 0,
    code: 'CLIENT_ERROR',
    title: 'Unexpected session error',
    correlationId: null,
    message: error instanceof Error ? error.message : 'An unexpected session error occurred.',
  };
}

/**
 * Resolves which membership the backend considers active. The bootstrap payload
 * reports `session.active_role`, so an explicitly selected membership id wins and
 * otherwise the role is matched when it is unambiguous.
 */
function resolveActiveMembershipId(
  response: SessionBootstrapResponse,
  preferredId: string | null,
): string | null {
  const activeRole = response.session.active_role;
  if (activeRole === null) return null;
  const candidates = response.memberships.filter(
    membership => membership.role === activeRole && isEligibleMembership(membership),
  );
  if (preferredId) {
    const preferred = candidates.find(membership => membership.id === preferredId);
    if (preferred) return preferred.id;
  }
  return candidates.length === 1 ? candidates[0].id : null;
}

type BootstrapProjection = Pick<
  AuthState,
  | 'status'
  | 'bootstrapState'
  | 'profile'
  | 'memberships'
  | 'activeMembershipId'
  | 'session'
  | 'csrfToken'
  | 'error'
  | 'bootstrap'
>;

function applyBootstrap(
  response: SessionBootstrapResponse,
  preferredMembershipId: string | null,
): BootstrapProjection {
  return {
    status: 'authenticated',
    bootstrapState: response.bootstrap_state,
    profile: response.profile,
    memberships: response.memberships,
    activeMembershipId: resolveActiveMembershipId(response, preferredMembershipId),
    session: response.session,
    csrfToken: response.csrf_token,
    error: null,
    bootstrap: response,
  };
}

function activeMembershipOf(state: AuthState): Membership | null {
  if (!state.activeMembershipId) return null;
  return state.memberships.find(membership => membership.id === state.activeMembershipId) ?? null;
}

let initializePromise: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'uninitialized',
  bootstrapState: null,
  profile: null,
  memberships: [],
  activeMembershipId: null,
  session: null,
  csrfToken: null,
  error: null,
  bootstrap: null,

  initialize: async () => {
    if (get().status !== 'uninitialized') return;
    if (!initializePromise) {
      set({ status: 'loading', error: null });
      initializePromise = (async () => {
        try {
          const response = await getCurrentSession();
          set(applyBootstrap(response, get().activeMembershipId));
        } catch (error) {
          clearCsrfToken();
          if (error instanceof SessionApiError && (error.status === 401 || error.status === 403)) {
            set({ ...anonymousState });
            return;
          }
          set({ ...anonymousState, status: 'error', error: toAuthError(error) });
        }
      })().finally(() => {
        initializePromise = null;
      });
    }
    await initializePromise;
  },

  createSession: async (idToken, clientType = 'web_portal', deviceName = DEFAULT_DEVICE_NAME) => {
    set({ status: 'loading', error: null });
    try {
      const response = await createBackendSession(idToken, clientType, deviceName);
      set(applyBootstrap(response, null));
      return response;
    } catch (error) {
      clearCsrfToken();
      set({ ...anonymousState, status: 'error', error: toAuthError(error) });
      throw error;
    }
  },

  refresh: async idToken => {
    set({ error: null });
    try {
      const response = await refreshSession(idToken);
      set(applyBootstrap(response, get().activeMembershipId));
      return response;
    } catch (error) {
      const authError = toAuthError(error);
      if (authError.status === 401 || authError.code === 'APP_SESSION_INVALID') {
        clearCsrfToken();
        set({ ...anonymousState });
      } else {
        set({ error: authError });
      }
      throw error;
    }
  },

  stepUp: async (idToken, reason) => {
    set({ error: null });
    try {
      const result = await stepUpSession(reason, idToken);
      const { bootstrap, session } = get();
      const nextSession = session
        ? { ...session, step_up_valid_until: result.valid_until }
        : session;
      set({
        csrfToken: result.csrf_token,
        session: nextSession,
        bootstrap: bootstrap
          ? {
              ...bootstrap,
              csrf_token: result.csrf_token,
              session: { ...bootstrap.session, step_up_valid_until: result.valid_until },
            }
          : bootstrap,
      });
    } catch (error) {
      const authError = toAuthError(error);
      if (authError.status === 401 || authError.code === 'APP_SESSION_INVALID') {
        clearCsrfToken();
        set({ ...anonymousState });
      } else {
        set({ error: authError });
      }
      throw error;
    }
  },

  selectMembership: async membershipId => {
    set({ error: null });
    try {
      const response = await selectActiveRole(membershipId);
      set(applyBootstrap(response, membershipId));
      return response;
    } catch (error) {
      const authError = toAuthError(error);
      if (authError.status === 401 || authError.code === 'APP_SESSION_INVALID') {
        clearCsrfToken();
        set({ ...anonymousState });
      } else {
        set({ error: authError });
      }
      throw error;
    }
  },

  logout: async () => {
    let revokeError: unknown;
    try {
      if (get().status === 'authenticated') await revokeCurrentSession();
    } catch (error) {
      revokeError = error;
    } finally {
      clearCsrfToken();
      set({ ...anonymousState });
    }
    if (revokeError instanceof SessionApiError && revokeError.status !== 401) throw revokeError;
  },

  checkPermission: permission => hasPermission(selectPermissions(get()), permission),
  checkAnyPermission: permissions => hasAnyPermission(selectPermissions(get()), permissions),
  checkAllPermissions: permissions => hasAllPermissions(selectPermissions(get()), permissions),
  canAccessRoute: route => {
    const state = get();
    const membership = activeMembershipOf(state);
    if (!membership) return false;
    return canAccessRouteForRole(route, membership.role, selectPermissions(state));
  },
}));

/* Selectors — all derived strictly from the backend bootstrap payload. */

export function selectBootstrapState(state: AuthState): BootstrapState | null {
  return state.bootstrapState;
}

export function selectProfile(state: AuthState): Profile | null {
  return state.profile;
}

export function selectMemberships(state: AuthState): Membership[] {
  return state.memberships;
}

export function selectSession(state: AuthState): SessionView | null {
  return state.session;
}

export function selectActiveMembership(state: AuthState): Membership | null {
  return activeMembershipOf(state);
}

/** Permissions are only ever the selected membership's backend permissions. */
export function selectPermissions(state: AuthState): BackendPermission[] {
  return activeMembershipOf(state)?.permissions ?? [];
}

export function selectActiveRoleId(state: AuthState): RoleId | null {
  return activeMembershipOf(state)?.role ?? state.session?.active_role ?? null;
}

export function selectEligibleMemberships(state: AuthState): Membership[] {
  return state.memberships.filter(isEligibleMembership);
}
