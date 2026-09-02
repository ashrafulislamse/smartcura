import {
  Body, Controller, Get, Headers, HttpCode, Post, Query, Res,
} from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession,
  RequireCsrf,
  type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { problem, validationFailed } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { DoctorAiService } from './doctor-ai.service.js';

/**
 * Doctor AI assistant endpoints.
 *
 * Two routes, both `@AuthenticatedOnly()` with assignment-scoped authorization
 * resolved in the service (not `@RequirePermission`, because the authority
 * depends on the acting membership being a doctor and, for the assistant, on an
 * active care assignment for the optional `patient_profile_id` — neither of
 * which the shared `PermissionGuard` can decide). This matches the pattern
 * `DoctorController`, `DoctorDevicesController` and `DoctorTemplatesController`
 * already use for the doctor surface.
 *
 * `@RequireCsrf` is on the POST (a state-changing route that calls an external
 * AI provider and writes an audit row) and absent on the GET (a read). The
 * `test/csrf-coverage.test.ts` suite enforces that every mutation declares a
 * CSRF action; this route declares `doctor_ai.assistant`.
 *
 * `Idempotency-Key` is MANDATORY on the POST: calling an external AI provider
 * costs money and is not side-effect-free, so a retry must return the stored
 * response rather than calling the provider again. The key format is validated
 * here (matching the `requireIdempotencyKey` helper in
 * `DoctorTemplatesController`) and the claim/replay/reuse logic is in the
 * service, which follows the same two-transaction pattern as
 * `ClinicalTemplateRepository` but inline because the generic idempotency
 * helpers are not exported as a subpath from `@smartcura/database`.
 *
 * `noStore` is set on both responses: an AI response is a real-time
 * decision-support answer that must not be cached by an intermediary, and an
 * artifacts list is PHI-adjacent and changes as new artifacts are generated.
 */
@AuthenticatedOnly()
@Controller('doctor/ai')
export class DoctorAiController {
  constructor(private readonly service: DoctorAiService) {}

  /**
   * Synchronous clinical decision-support call.
   *
   * The doctor submits a clinical question (optionally scoped to an assigned
   * patient or a consultation they own) and receives an AI response in the same
   * request. If the AI provider is not configured (`SMARTCURA_AI_PROVIDER` is
   * neither `openai` nor `cloudflare`, or `SMARTCURA_AI_API_KEY` is absent), the service answers
   * `501 NOT_IMPLEMENTED` — it does NOT fabricate a response.
   *
   * `Idempotency-Key` is mandatory and validated here; the service claims it
   * inside a short transaction before the external call, and completes it with
   * the response afterwards. A replay returns the stored response verbatim.
   */
  @Post('assistant')
  @HttpCode(200)
  @RequireCsrf('doctor_ai.assistant')
  async assistant(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.service.assistant(current, requireIdempotencyKey(idempotencyKey), body);
  }

  /**
   * Lists AI artifacts for the doctor's actively-assigned patients.
   *
   * The authorization is assignment-based (the same `care_assignments` join
   * `AiRepository.findAuthorizedArtifact` uses), so a doctor sees artifacts only
   * for patients under their own care. If the `ai_artifacts` table is
   * unreachable the service returns an empty list, not an error — a missing
   * table is an absence, not a fault.
   */
  @Get('artifacts')
  async artifacts(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.service.artifacts(current, query);
  }
}

/**
 * Rejects a body whose media type was not declared as JSON. Nest would otherwise
 * hand the handler an empty object for an unparsed body, which a `.strict()`
 * schema turns into a confusing VALIDATION_FAILED instead of the accurate 415.
 * This is the same helper every other controller in this codebase uses.
 */
function requireJson(contentType: string | undefined): void {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
}

/**
 * Validates the `Idempotency-Key` header format. The format matches the
 * `idempotencyKeySchema` in `appointment-request.schemas.ts` and the
 * `requireIdempotencyKey` helper in `DoctorTemplatesController`: 16–128 chars
 * from the URL-safe alphabet. A missing or malformed key is a 422
 * VALIDATION_FAILED, not a 400, matching the project convention for schema
 * failures.
 */
function requireIdempotencyKey(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9._~-]{16,128}$/.test(value)) {
    throw validationFailed();
  }
  return value;
}
