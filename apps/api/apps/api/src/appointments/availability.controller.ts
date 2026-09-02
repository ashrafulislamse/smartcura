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
  RequirePermission,
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { AvailabilityService } from './availability.service.js';

/**
 * Doctor availability, addressed by membership in the same shape
 * `DoctorDetailsController` uses.
 *
 * Every route here carries `@RequirePermission(...:own, ...)`, including the
 * reads: a rule set is not published capacity but the doctor's own working
 * pattern plus the concurrency token that lets it be rewritten, and an `own`
 * scope is decidable from the session alone so the shared guard can reject
 * early. The membership in the path must still be the acting membership; only the
 * service can decide that, and it conceals a mismatch as a 404.
 *
 * Rule reads, rule writes, exceptions and generation all require
 * `availability:write:own`. The own-schedule slot read (GET availability-slots)
 * requires `availability:read:own` instead, so a doctor who can view but not
 * change their schedule is still admitted to the read.
 *
 * Bookable capacity is read elsewhere, through the organization slot search in
 * `OrganizationAppointmentsController`, which is authorized by
 * `availability:read:global` and returns no rules at all.
 *
 * Every response is `no-store`. A schedule is keyed only on the URL, and a shared
 * cache holding one would serve it to a caller whose authorization was never
 * evaluated.
 */
@AuthenticatedOnly()
@Controller('memberships/:membershipId')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  /**
   * The doctor's own rule set together with the revision to quote back as
   * `expected_version`. Reading it is what makes the replacement below safe to
   * attempt: without the revision a client can only guess and be rejected.
   */
  @Get('availability-rules')
  @RequirePermission('availability:write:own', 'availability.rules.read')
  async listRules(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.availability.listRules(current, membershipId);
  }

  /**
   * Replaces the whole weekly rule set and regenerates the slot horizon.
   *
   * WHY REPLACEMENT AND NOT A PARTIAL UPDATE: a recurrence set has no safe merge
   * rule. Two clients each patching a different weekday would both succeed, and
   * neither would have seen the other's day, so the resulting schedule is one
   * neither doctor authored — and it is immediately materialised into bookable
   * slots that patients can pay for. Sending the complete intended set makes the
   * submitted schedule the whole truth, and `expected_version` makes a lost
   * update a 409 rather than a silent overwrite. A caller wanting to change one
   * day reads the rules above, edits, and puts the set back.
   */
  @Put('availability-rules')
  @RequireCsrf('availability.rules.replace')
  @RequirePermission('availability:write:own', 'availability.rules.replace')
  async replaceRules(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.availability.replaceRules(current, membershipId, body);
  }

  /**
   * Records a per-date exception: the day is closed, or replaced by one different
   * window. Slots the exception invalidates are closed and a replacement window
   * regenerates the day. Booked capacity is never withdrawn silently — the
   * database refuses to release a slot with a live appointment on it, so the
   * doctor must cancel those appointments explicitly and be seen to do it.
   *
   * 201 even though the write is an upsert on `(membership, date)`: the response
   * body is the exception resource, and `expected_version` already tells the
   * caller which of create or replace they asked for.
   */
  @Post('availability-exceptions')
  @HttpCode(201)
  @RequireCsrf('availability.exception.record')
  @RequirePermission('availability:write:own', 'availability.exception.record')
  async recordException(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.availability.recordException(current, membershipId, body);
  }

  /**
   * Materialises slots from the existing rule set over a stated date range, for
   * the doctor who wants capacity published further out than the last
   * replacement reached.
   *
   * `Idempotency-Key` is mandatory. Generation is already idempotent in the
   * database, so the header is not what prevents duplicate slots; it is what lets
   * a retry report the original count instead of the honest zero a second
   * generation produces, which a client would otherwise read as failure.
   */
  @Post('availability-slots')
  @HttpCode(201)
  @RequireCsrf('availability.slots.generate')
  @RequirePermission('availability:write:own', 'availability.slots.generate')
  async generateSlots(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.availability.generateSlots(current, membershipId, idempotencyKey, body);
  }

  /**
   * Reads already-generated slots for the doctor's own schedule over a stated
   * date range. Every slot state — `open`, `held`, `booked`, `closed` — is
   * returned, not just the bookable `open` capacity the organization search
   * publishes, because a doctor reviewing their own schedule needs to see it as
   * it actually is. The membership in the path must be the acting membership; a
   * mismatch is concealed as a 404 by the service.
   */
  @Get('availability-slots')
  @RequirePermission('availability:read:own', 'availability.slots.read')
  async listOwnSlots(
    @CurrentSession() current: AuthenticatedSession,
    @Param('membershipId') membershipId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.availability.listOwnSlots(current, membershipId, query);
  }
}

/**
 * Rejects a body whose media type was not declared as JSON. Nest would otherwise
 * hand the handler an empty object for an unparsed body, which a `.strict()`
 * schema turns into a confusing VALIDATION_FAILED instead of the accurate 415.
 */
function requireJson(contentType: string | undefined): void {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON content type is required');
  }
}
