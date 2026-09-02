import { Body, Controller, Get, Headers, Param, Put, Res } from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession,
  type AuthenticatedSession,
  RequireCsrf,
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { DoctorDetailsService } from './doctor-details.service.js';

/**
 * Doctor professional detail, addressed by membership.
 *
 * `@AuthenticatedOnly()` rather than `@RequirePermission(...)` because the
 * required permission depends on the relationship between the caller and the
 * target membership: own-membership writes need `doctor_detail:write:own`, and
 * reads of anyone else's listing need `doctor_detail:read:global`. That is a
 * per-request decision, so it is made in the service, exactly as
 * `MembershipsController` defers to `MembershipsService`. The service denies by
 * default and audits every refusal.
 */
@AuthenticatedOnly()
@Controller('memberships/:membershipId/doctor-details')
export class DoctorDetailsController {
  constructor(private readonly doctorDetails: DoctorDetailsService) {}

  @Get()
  async get(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    // Professional detail is not patient data, but it is addressed by membership
    // and a shared cache keyed only on the URL would serve it to a caller whose
    // authorization was never evaluated.
    noStore(response);
    return this.doctorDetails.get(current, membershipId);
  }

  /**
   * Create-or-replace. `expected_version: 0` creates; any other value must match
   * the stored version. PUT rather than PATCH because the specialty and language
   * sets are replaced wholesale, and a partial update of a set is ambiguous.
   */
  @Put()
  @RequireCsrf('doctor_detail.save')
  async save(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON content type is required');
    }
    return this.doctorDetails.save(current, membershipId, body);
  }
}
