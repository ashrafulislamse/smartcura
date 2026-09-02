import { Controller, Get, Query, Res } from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession,
  type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { DoctorEarningsService } from './doctor-earnings.service.js';

/**
 * Doctor-scoped earnings endpoint.
 *
 * GET /doctor/earnings returns the current doctor's payout history: a balance
 * projected over paid payout items, a cumulative total earned, and a page of
 * recent entries. The scope is derived entirely from the session (the active
 * doctor membership), never from the request, so no `organization_id` or
 * `payee_membership_id` query parameter is accepted and the scope cannot be
 * widened.
 *
 * The class is decorated with `@AuthenticatedOnly()` rather than
 * `@RequirePermission` because the authorization is membership-scoped, not
 * permission-scoped: the service resolves the active doctor membership and
 * checks `role_id = 'doctor'` and the `profile_detail:read:assigned` permission
 * itself, matching the pattern `DoctorController` and
 * `WorkstreamFController` use for `doctor/patients`.
 *
 * `noStore` is set so an earnings response — which carries financial figures —
 * is never cached by an intermediary. A cached response would serve balance
 * information to a caller whose authorization was never evaluated, and the
 * figures are projections that go stale the moment a payout item settles.
 */
@Controller()
@AuthenticatedOnly()
export class DoctorEarningsController {
  constructor(private readonly service: DoctorEarningsService) {}

  @Get('doctor/earnings')
  earnings(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.service.earnings(current, query);
  }
}
