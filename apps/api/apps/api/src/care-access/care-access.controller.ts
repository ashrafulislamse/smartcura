import {
  Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res,
} from '@nestjs/common';
import {
  AuthenticatedOnly, CurrentSession, type AuthenticatedSession, RequireCsrf,
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { CareAccessService } from './care-access.service.js';

@AuthenticatedOnly()
@Controller('consents')
export class ConsentGrantsController {
  constructor(private readonly careAccess: CareAccessService) {}

  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.careAccess.listConsents(current, query);
  }

  @Post()
  @HttpCode(201)
  @RequireCsrf('consent.create')
  async create(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response); requireJson(contentType);
    return this.careAccess.createConsent(current, body);
  }

  @Post(':consentId/revoke')
  @HttpCode(200)
  @RequireCsrf('consent.revoke')
  async revoke(
    @CurrentSession() current: AuthenticatedSession,
    @Param('consentId') consentId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response); requireJson(contentType);
    return this.careAccess.revokeConsent(current, consentId, body);
  }
}

@AuthenticatedOnly()
@Controller('care-assignments')
export class CareAssignmentsController {
  constructor(private readonly careAccess: CareAccessService) {}

  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.careAccess.listAssignments(current, query);
  }
}

@AuthenticatedOnly()
@Controller('organizations/:organizationId/care-assignments')
export class OrganizationCareAssignmentsController {
  constructor(private readonly careAccess: CareAccessService) {}

  @Post()
  @HttpCode(201)
  @RequireCsrf('care_assignment.create')
  async create(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response); requireJson(contentType);
    return this.careAccess.createAssignment(current, organizationId, body);
  }

  @Post(':assignmentId/end')
  @HttpCode(200)
  @RequireCsrf('care_assignment.end')
  async end(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Param('assignmentId') assignmentId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response); requireJson(contentType);
    return this.careAccess.endAssignment(current, organizationId, assignmentId, body);
  }
}

function requireJson(contentType: string | undefined): void {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON content type is required');
  }
}
