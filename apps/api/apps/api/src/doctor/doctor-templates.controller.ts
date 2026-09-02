import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query, Res,
} from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession,
  RequireCsrf,
  type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { problem, validationFailed } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { DoctorTemplatesService } from './doctor-templates.service.js';

/**
 * Doctor clinical-template CRUD.
 *
 * All routes are `AuthenticatedOnly` with CSRF on every state-changing route, matching
 * the `test/csrf-coverage.test.ts` expectation that every mutation declares
 * `@RequireCsrf`. Reads carry `noStore` so a cached template list never masks a
 * newly-archived row. `author_membership_id` is derived from the session, never the
 * request, so the routes take no `:membership_id` path segment.
 */
@AuthenticatedOnly()
@Controller('doctor/templates')
export class DoctorTemplatesController {
  constructor(private readonly service: DoctorTemplatesService) {}

  @Get()
  list(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.service.listTemplates(current, query);
  }

  @Get(':templateId')
  read(
    @CurrentSession() current: AuthenticatedSession,
    @Param('templateId') templateId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.service.getTemplate(current, templateId);
  }

  @Post()
  @HttpCode(201)
  @RequireCsrf('clinical_template.create')
  create(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    return this.service.createTemplate(current, requireIdempotencyKey(key), body);
  }

  @Put(':templateId')
  @RequireCsrf('clinical_template.update')
  update(
    @CurrentSession() current: AuthenticatedSession,
    @Param('templateId') templateId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    return this.service.updateTemplate(current, templateId, body);
  }

  /** Deletion is a soft archive so a consultation that referenced a template keeps resolving it. */
  @Delete(':templateId')
  @HttpCode(200)
  @RequireCsrf('clinical_template.archive')
  archive(
    @CurrentSession() current: AuthenticatedSession,
    @Param('templateId') templateId: string,
    @Query() query: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.service.archiveTemplate(current, templateId, query, requireIdempotencyKey(key));
  }
}

function requireJson(contentType: string | undefined): void {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9._~-]{16,128}$/.test(value)) throw validationFailed();
  return value;
}
