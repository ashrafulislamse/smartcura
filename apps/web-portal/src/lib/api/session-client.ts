/**
 * Backend application session client.
 *
 * Every call targets the NestJS API at NEXT_PUBLIC_API_URL with
 * `credentials: 'include'` so the `__Host-smartcura_session` cookie (HttpOnly,
 * server-owned) travels with the request. The CSRF token returned by the backend
 * is kept in module memory only — never localStorage, sessionStorage or cookies —
 * and is replayed in the `X-CSRF-Token` header the backend's RequestIntegrityGuard
 * validates for every mutation.
 */

import type {
  ClientType,
  CreateSessionRequest,
  ProblemCode,
  ProblemDetails,
  SelectActiveRoleRequest,
  SessionBootstrapResponse,
  StepUpReason,
  StepUpRequest,
  StepUpResponse,
} from '@/types/session';

/** Header name required by the backend CSRF guard (`x-csrf-token`). */
/**
 * The request plumbing, the CSRF token and the Problem Details mapping now live in
 * ./client.ts so every other page uses the same rules rather than reimplementing them.
 * Re-exported here so existing imports of this module keep working, and so there is
 * only ONE token in the process with no second copy to drift.
 */
export {
  CSRF_HEADER,
  DEFAULT_API_BASE_URL,
  apiBaseUrl,
  clearCsrfToken,
  getCsrfToken,
} from './client';

import {
  ApiError,
  apiRequest,
  clearCsrfToken as clearToken,
  setCsrfToken,
} from './client';

/** Retained name for the session surface; ApiError is the shared type. */
export { ApiError as SessionApiError };
export type SessionErrorCode = ApiError['code'];

const request = <T,>(options: Parameters<typeof apiRequest>[0]): Promise<T> =>
  apiRequest<T>(options);

const DEFAULT_DEVICE_NAME = 'SmartCura Web Portal';
function rememberCsrf<T extends { csrf_token: string }>(response: T): T {
  setCsrfToken(response.csrf_token);
  return response;
}

/** GET /sessions/current — authoritative bootstrap for an existing cookie session. */
export async function getCurrentSession(): Promise<SessionBootstrapResponse> {
  return rememberCsrf(
    await request<SessionBootstrapResponse>({ method: 'GET', path: '/sessions/current' }),
  );
}

/** POST /sessions — exchanges an identity token for an application session. */
export async function createSession(
  identityToken: string,
  clientType: ClientType = 'web_portal',
  deviceName: string = DEFAULT_DEVICE_NAME,
): Promise<SessionBootstrapResponse> {
  const body: CreateSessionRequest = { client_type: clientType, device_name: deviceName };
  return rememberCsrf(
    await request<SessionBootstrapResponse>({
      method: 'POST',
      path: '/sessions',
      identityToken,
      body,
    }),
  );
}

/** POST /sessions/refresh — rotates the session token, requires a current identity token. */
export async function refreshSession(identityToken: string): Promise<SessionBootstrapResponse> {
  return rememberCsrf(
    await request<SessionBootstrapResponse>({
      method: 'POST',
      path: '/sessions/refresh',
      identityToken,
      csrf: true,
    }),
  );
}

/** POST /sessions/step-up — requires recent MFA reauthentication at the identity provider. */
export async function stepUpSession(
  reason: StepUpReason,
  identityToken: string,
): Promise<StepUpResponse> {
  const body: StepUpRequest = { reason };
  return rememberCsrf(
    await request<StepUpResponse>({
      method: 'POST',
      path: '/sessions/step-up',
      identityToken,
      body,
      csrf: true,
    }),
  );
}

/** PUT /sessions/current/active-role — selects the one active membership. */
export async function selectActiveRole(membershipId: string): Promise<SessionBootstrapResponse> {
  const body: SelectActiveRoleRequest = { membership_id: membershipId };
  return rememberCsrf(
    await request<SessionBootstrapResponse>({
      method: 'PUT',
      path: '/sessions/current/active-role',
      body,
      csrf: true,
    }),
  );
}

/** DELETE /sessions/current — server-side revocation; clears the session cookie. */
export async function revokeCurrentSession(): Promise<void> {
  try {
    await request<void>({ method: 'DELETE', path: '/sessions/current', csrf: true });
  } finally {
    clearToken();
  }
}
