/**
 * Shared backend request boundary for every portal API call.
 *
 * WHY THIS EXISTS SEPARATELY FROM session-client.ts. The session client already had a
 * correct `request()` — Problem Details parsing, `credentials: 'include'`, an
 * in-memory CSRF token, `cache: 'no-store'` — but it was private to that module. Every
 * other page therefore had no way to call the API without reimplementing those rules,
 * and reimplementing them is how a page ends up storing a CSRF token in localStorage or
 * silently swallowing a problem+json body.
 *
 * There is exactly ONE csrf token in the process, owned here. `session-client.ts`
 * re-exports the accessors so existing imports keep working and there is no second
 * copy of the token to drift.
 *
 * The base path is relative on purpose: the Next.js rewrite proxies `/api/v1/*` to the
 * backend origin so the `__Host-smartcura_session` cookie stays valid, which it cannot
 * be across origins.
 */

import type { ProblemDetails } from '@/types/session';

export const CSRF_HEADER = 'X-CSRF-Token';
export const DEFAULT_API_BASE_URL = '/api/v1';

/** In-memory only. Never localStorage, sessionStorage or a cookie. */
let csrfToken: string | null = null;

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function clearCsrfToken(): void {
  csrfToken = null;
}

export function apiBaseUrl(): string {
  // The backend session cookie is __Host- + SameSite=Strict, so it is only sent
  // on same-origin requests. The portal therefore always proxies API calls through
  // /api/v1/* (see next.config.js). An absolute NEXT_PUBLIC_API_URL would break the
  // cookie by sending requests to a different origin, so it is intentionally ignored.
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (configured && !configured.startsWith('http://') && !configured.startsWith('https://')) {
    return configured;
  }
  return DEFAULT_API_BASE_URL;
}

export type ApiErrorCode = string | 'NETWORK_ERROR' | 'CLIENT_ERROR';

/** Carries the backend problem+json body so a page can react to the code, not the text. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly title: string;
  readonly correlationId: string | null;
  readonly problem: ProblemDetails | null;

  constructor(init: {
    status: number;
    code: ApiErrorCode;
    title: string;
    detail?: string | null;
    correlationId?: string | null;
    problem?: ProblemDetails | null;
  }) {
    super(init.detail || init.title);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.correlationId = init.correlationId ?? null;
    this.problem = init.problem ?? null;
  }

  /** True when re-authenticating is what the user needs to do. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** True when the account is authenticated but lacks the authority. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /**
   * True when a recent step-up is required. Distinguished from an ordinary 403 because
   * the remedy is different: re-authenticate rather than request access.
   */
  get needsStepUp(): boolean {
    return this.status === 403 && this.code === 'STEP_UP_REQUIRED';
  }

  /** True when an optimistic write lost to a concurrent one and should be re-read. */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProblemDetails>;
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.status === 'number' &&
    typeof candidate.code === 'string' &&
    typeof candidate.correlation_id === 'string'
  );
}

export interface ApiRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** Identity provider token, forwarded as `Authorization: Bearer <token>`. */
  identityToken?: string;
  body?: unknown;
  /** Mutations must carry the CSRF header the backend's integrity guard validates. */
  csrf?: boolean;
  /** Replayed writes must send the same key to get the stored response back. */
  idempotencyKey?: string;
  contentType?: string;
  signal?: AbortSignal;
}

export async function apiRequest<T>(options: ApiRequestOptions): Promise<T> {
  const headers = new Headers({ Accept: 'application/json, application/problem+json' });
  if (options.body !== undefined) {
    headers.set('Content-Type', options.contentType ?? 'application/json');
  }
  if (options.identityToken) headers.set('Authorization', `Bearer ${options.identityToken}`);
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  if (options.csrf) {
    if (!csrfToken) {
      // Failing here is better than sending a mutation the backend will reject: the
      // cause is a missing session bootstrap, and that is what the message says.
      throw new ApiError({
        status: 0,
        code: 'CLIENT_ERROR',
        title: 'Missing in-memory CSRF token',
        detail: 'The application session must be bootstrapped before performing a mutation.',
      });
    }
    headers.set(CSRF_HEADER, csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${options.path}`, {
      method: options.method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      title: 'Cannot reach the SmartCura API',
      detail: error instanceof Error ? error.message : 'The network request failed.',
    });
  }

  const correlationId = response.headers.get('X-Correlation-ID');
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
  let payload: unknown;
  if (contentType.includes('json')) {
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    // A 401 means the cookie is gone or rotated, so the paired token is worthless.
    if (response.status === 401) csrfToken = null;
    if (isProblemDetails(payload)) {
      throw new ApiError({
        status: payload.status,
        code: payload.code,
        title: payload.title,
        detail: payload.detail ?? payload.title,
        correlationId: payload.correlation_id,
        problem: payload,
      });
    }
    throw new ApiError({
      status: response.status,
      code: 'CLIENT_ERROR',
      title: `Request failed with status ${response.status}`,
      correlationId,
    });
  }

  return payload as T;
}
