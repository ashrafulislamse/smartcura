import { Controller, Get, Res } from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession,
  type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { DoctorService } from './doctor.service.js';

/**
 * Doctor dashboard and analytics endpoints.
 *
 * Both routes are GET-only (no mutations), so `@RequireCsrf` is not applied — the CSRF
 * guard only runs on routes that declare a CSRF action. `noStore` is set on both so a
 * dashboard or analytics response is never cached by an intermediary: the counts are
 * projections of live data and a cached response would go stale the moment an
 * appointment is booked or a note is signed.
 *
 * The class is decorated with `@AuthenticatedOnly()` rather than `@RequirePermission`
 * because the authorization is assignment-scoped, not permission-scoped: the service
 * resolves the active doctor membership and checks `role_id = 'doctor'` and the
 * `profile_detail:read:assigned` permission itself, matching the pattern
 * `WorkstreamFController` uses for `doctor/patients`.
 */
@Controller()
@AuthenticatedOnly()
export class DoctorController {
  constructor(private readonly service: DoctorService) {}

  @Get('doctor/dashboard')
  dashboard(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.service.dashboard(current);
  }

  @Get('doctor/analytics')
  analytics(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.service.analytics(current);
  }
}
