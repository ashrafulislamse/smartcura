import {
  Body, Controller, Get, Headers, HttpCode, Param, Put, Query, Res,
} from '@nestjs/common';
import {
  AuthenticatedOnly, CurrentSession, type AuthenticatedSession, RequireCsrf,
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { DoctorDiscoveryService } from './doctor-discovery.service.js';

@AuthenticatedOnly()
@Controller('doctors')
export class DoctorDiscoveryController {
  constructor(private readonly discovery: DoctorDiscoveryService) {}

  @Get()
  async search(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response); return this.discovery.search(current, query);
  }

  @Get(':membershipId')
  async get(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response); return this.discovery.get(current, membershipId);
  }

  @Get(':membershipId/reviews')
  async reviews(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response); return this.discovery.listReviews(current, membershipId, query);
  }
}

@AuthenticatedOnly()
@Controller('appointments/:appointmentId/doctor-review')
export class AppointmentDoctorReviewController {
  constructor(private readonly discovery: DoctorDiscoveryService) {}

  @Put()
  @HttpCode(200)
  @RequireCsrf('doctor_review.save')
  async save(
    @CurrentSession() current: AuthenticatedSession,
    @Param('appointmentId') appointmentId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON content type is required');
    }
    return this.discovery.saveReview(current, appointmentId, body);
  }
}
