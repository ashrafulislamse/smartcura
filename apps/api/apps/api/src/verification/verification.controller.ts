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
  Res,
} from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession,
  type AuthenticatedSession,
  RequireCsrf,
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { PrivateFilesService } from './private-files.service.js';
import { VerificationService } from './verification.service.js';

/**
 * Verification documents for one membership.
 *
 * `@AuthenticatedOnly()` rather than `@RequirePermission(...)`, for the same
 * reason `MembershipsController` and `DoctorDetailsController` defer: the
 * permission depends on the relationship between the caller and the target.
 * Submission needs `verification.document:submit:own` on the TARGET membership -
 * which is deliberately not the session's active membership, because an applied
 * doctor has no active membership yet - while a read may instead be satisfied by
 * an administrator's organization authority. `PermissionGuard` evaluates a single
 * static requirement against the active membership only, so it cannot express
 * either rule. The service denies by default and audits every refusal.
 *
 * Every response is `no-store`: the bodies carry storage keys, checksums and, on
 * submission, a signed upload capability. A shared cache holding any of that is a
 * disclosure, not a performance win.
 */
@AuthenticatedOnly()
@Controller('memberships/:membershipId/verification-documents')
export class VerificationController {
  constructor(
    private readonly verification: VerificationService,
    private readonly privateFiles: PrivateFilesService,
  ) {}

  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.verification.list(current, membershipId, query);
  }

  /**
   * Reserves the document and returns a short-lived upload target. 201 because a
   * document row and a pending stored-object row are created; the bytes are not
   * here yet and nothing is reviewable until `finalize` proves them.
   */
  @Post()
  @HttpCode(201)
  @RequireCsrf('verification.document.request')
  async requestUpload(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.verification.requestUpload(current, membershipId, idempotencyKey, body);
  }

  /**
   * Confirms the uploaded bytes. 200, not 201: the document already exists and
   * this only settles whether its object is trustworthy.
   */
  /**
   * 200: finalize settles whether an EXISTING document's object is trustworthy and
   * creates nothing, unlike `requestUpload` above which is genuinely 201.
   */
  @Post(':documentId/finalize')
  @HttpCode(200)
  @RequireCsrf('verification.document.finalize')
  async finalize(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Param('documentId') documentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.verification.finalize(
      current, membershipId, documentId, idempotencyKey, body,
    );
  }

  /** Reads one verification document by id, after owner-or-reviewer authorization. */
  @Get(':documentId')
  async read(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.verification.get(current, membershipId, documentId);
  }

  /** Mints a 60-second GET capability only after linked-resource authorization. */
  @Get(':documentId/download')
  async download(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.privateFiles.downloadVerificationDocument(current, membershipId, documentId);
  }
}

/**
 * The reviewer's decision, addressed by ORGANIZATION rather than by membership.
 *
 * The authority being exercised is the organization's, so the URL names it: that
 * is what lets the service refuse a document whose organization is not the one
 * the caller just proved authority over. No `Idempotency-Key` here, matching the
 * repository: `expected_version` already makes a repeated decision a version
 * conflict rather than a second review.
 */
@AuthenticatedOnly()
@Controller('organizations/:organizationId/verification-documents')
export class VerificationReviewController {
  constructor(private readonly verification: VerificationService) {}

  @Put(':documentId/status')
  @RequireCsrf('verification.document.review')
  async review(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Param('documentId') documentId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.verification.review(current, organizationId, documentId, body);
  }
}

/**
 * Rejects a body whose media type was not declared as JSON. Nest hands the
 * handler an empty object for an unparsed body, which a `.strict()` schema turns
 * into a confusing VALIDATION_FAILED instead of the accurate 415.
 */
function requireJson(contentType: string | undefined): void {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON content type is required');
  }
}
