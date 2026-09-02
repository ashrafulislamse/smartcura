import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession,
  type AuthenticatedSession,
  RequireCsrf,
} from '../platform/request-authorization.js';
import { MembershipsService } from './memberships.service.js';

@AuthenticatedOnly()
@Controller('organizations/:organizationId/memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Query() query: unknown,
  ): Promise<Record<string, unknown>> {
    return this.memberships.list(current, organizationId, query);
  }

  @Post('self')
  @HttpCode(201)
  @RequireCsrf('membership.self.create')
  async createSelf(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.memberships.createSelf(
      current, organizationId, idempotencyKey, body,
    );
  }

  @Post('invitations')
  @HttpCode(201)
  @RequireCsrf('membership.invitation.create')
  async createInvitation(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.memberships.createInvitation(
      current, organizationId, idempotencyKey, body,
    );
  }

  @Put(':membershipId/status')
  @RequireCsrf('membership.transition')
  async transition(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.memberships.transition(current, organizationId, membershipId, body);
  }
}
