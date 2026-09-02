import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { type AuthenticatedSession } from './request-authorization.js';
import { problem } from './problems.js';

/**
 * Rate-limit guard: per-route throttling with a profile-aware key.
 *
 * WHY THIS EXISTS. The default `ThrottlerGuard` keys every request by IP, so two
 * clinicians behind one NAT share a budget and one profile behind a VPN rotation
 * gets a fresh budget per egress IP. For an authenticated healthcare API the actor
 * identity is the meaningful unit, so authenticated requests are keyed by the
 * profile id the `SessionAuthenticationGuard` already attached to the request.
 * Unauthenticated routes (sign-in, health) keep the IP-based key because there is
 * no identity yet, and sign-in is exactly the route that needs IP-level protection.
 *
 * GUARD ORDER. This guard is registered AFTER `SessionAuthenticationGuard` and
 * `RequestIntegrityGuard` and BEFORE `PermissionGuard`, so the session is already
 * resolved when the tracker runs. A request that fails authentication is rejected
 * before rate limiting is evaluated, which keeps the counters clean of noise from
 * unauthenticated probes that would never have reached a handler anyway.
 *
 * 429 FORMAT. The default throttler throws a bare `ThrottlerException` whose body
 * is a string. The API's global exception filter would map that to a generic
 * `VALIDATION_FAILED` problem because it only inspects the status code, losing the
 * structured `application/problem+json` shape every other error in this system
 * uses. Overriding `throwThrottlingException` emits a `ProblemDetailsException`
 * with `code: TOO_MANY_REQUESTS` so the 429 is indistinguishable in shape from any
 * other rejection a client handles.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    // `smartcuraSession` is attached by `SessionAuthenticationGuard`. When present,
    // the caller is authenticated and the profile id is the stable identity a rate
    // limit should key on — it survives IP changes (VPN, mobile roaming) and is
    // not shared across users behind one NAT. When absent (public routes such as
    // `POST /sessions`), fall back to the IP so unauthenticated abuse is still
    // bounded.
    const session = req.smartcuraSession as AuthenticatedSession | undefined;
    if (session !== undefined) {
      return `profile:${session.aggregate.profile.profileId}`;
    }
    return (req.ip as string | undefined) ?? 'unknown';
  }

  protected override async throwThrottlingException(): Promise<never> {
    throw problem(429, 'TOO_MANY_REQUESTS', 'Rate limit exceeded');
  }
}
