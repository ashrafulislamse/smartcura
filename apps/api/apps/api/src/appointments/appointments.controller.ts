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
import { Throttle } from '@nestjs/throttler';
import {
  AuthenticatedOnly,
  CurrentSession,
  type AuthenticatedSession,
  RequireCsrf,
  RequirePermission,
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { AppointmentsService } from './appointments.service.js';
import { AvailabilityService } from './availability.service.js';

/**
 * Appointment reads and lifecycle transitions, addressed by appointment.
 *
 * The controller is deliberately thin. Booking one slot exactly once is a database
 * guarantee re-proved under lock by `AppointmentRepository`, so there is no
 * read-then-write, no availability pre-check and no fee arithmetic anywhere in
 * this layer: any of those would be a time-of-check-to-time-of-use window and
 * would let two patients both pass a controller check for one slot. The handlers'
 * only jobs are to hand the raw body through for schema validation, to pass
 * `Idempotency-Key` through verbatim so a replay returns the stored response
 * instead of acting again, and to mark every response `no-store`.
 *
 * `@RequirePermission` is present on the routes whose authority is `own` scoped
 * and fixed regardless of the request body — holding and rescheduling — so the
 * shared guard can reject them before any work happens. It is absent on the reads
 * and on the status transition, where the required permission depends on the
 * caller's role or the requested target state:
 *
 * - reads resolve to `appointment:read:own`, `appointment:read:assigned` or
 *   `appointment:read:organization` depending on the acting membership;
 * - a status change to `cancelled` needs `appointment:cancel:own` (patient) while
 *   `completed` and `no_show` need `appointment:complete:assigned` (assigned
 *   doctor), which is only known once the body is parsed.
 *
 * `PermissionGuard` evaluates object policy with owner context only, so an
 * `assigned`, `organization` or role-dependent requirement cannot be decided there
 * at all. `AppointmentsService` makes those decisions with the full context, denies
 * by default and audits every refusal — the same division of labour
 * `MembershipsController` and `DoctorDetailsController` already use.
 */
@AuthenticatedOnly()
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  /**
   * Takes a short-lived hold so a patient can finish checking out without losing
   * the slot. 200, not 201: a hold creates no appointment and has no address of its
   * own, and it expires by itself. A hold is never proof of bookability — the
   * booking transaction re-proves the doctor and the slot under lock.
   */
  @Post('slots/:slotId/hold')
  @HttpCode(200)
  @RequireCsrf('appointment.slot.hold')
  @RequirePermission('appointment:book:own', 'appointment.slot.hold')
  // Holding a slot is a cheap, repeatable write that a script could use to
  // lock up a doctor's calendar. 10 holds per 60 seconds per profile is well
  // above any legitimate checkout flow.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async hold(
    @CurrentSession() current: AuthenticatedSession,
    @Param('slotId') slotId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.appointments.hold(current, slotId);
  }

  /**
   * Lists appointments in the one scope the acting membership is entitled to: own
   * as a patient, assigned as a doctor, organization as an administrator. There is
   * no cross-scope fallback and no way to ask for someone else's scope.
   */
  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.appointments.list(current, query);
  }

  /**
   * Reads one appointment. Authorized to the patient it belongs to or the doctor
   * it is assigned to; an appointment outside the caller's scope is reported as
   * 404 rather than 403, because whether an appointment exists between two other
   * people is itself sensitive and a 403 would confirm it.
   */
  @Get(':appointmentId')
  async get(
    @CurrentSession() current: AuthenticatedSession,
    @Param('appointmentId') appointmentId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.appointments.get(current, appointmentId);
  }

  /**
   * Cancels, completes or records non-attendance. The target state and its
   * structured reason code come from the body, `expected_version` carries the
   * optimistic concurrency check, and the service routes the request to the
   * permission that state requires: cancellation is the patient's, completion and
   * non-attendance are the assigned doctor's. No role holds both.
   */
  @Put(':appointmentId/status')
  @RequireCsrf('appointment.status.update')
  async updateStatus(
    @CurrentSession() current: AuthenticatedSession,
    @Param('appointmentId') appointmentId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.appointments.updateStatus(current, appointmentId, body);
  }

  /**
   * Reschedules by replacement: the original moves to `rescheduled` and keeps its
   * time, fee and payment, and a new appointment is created against the new slot in
   * the same transaction. 201 because a new appointment is created, and
   * `Idempotency-Key` is mandatory for the same reason as booking.
   */
  @Post(':appointmentId/reschedule')
  @HttpCode(201)
  @RequireCsrf('appointment.reschedule')
  @RequirePermission('appointment:cancel:own', 'appointment.reschedule')
  // Rescheduling creates a replacement appointment, so it shares the booking
  // budget. 10 per 60 seconds per profile.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reschedule(
    @CurrentSession() current: AuthenticatedSession,
    @Param('appointmentId') appointmentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.appointments.reschedule(current, appointmentId, idempotencyKey, body);
  }
}

/**
 * Booking and bookable-capacity search, addressed by organization in the same
 * shape `MembershipsController` uses.
 *
 * Booking is addressed by organization because an appointment is created inside
 * one: the slot, the doctor membership and the fee all belong to it, and the
 * database refuses to cross that boundary. The identifier in the path is checked
 * against the acting membership's own organization and a mismatch is concealed as
 * 404, so the route cannot be walked to discover which organizations exist.
 *
 * The slot search carries no `@RequirePermission`: it is authorized by
 * `availability:read:global`, whose object policy needs a `globalAllowed` context
 * the shared `PermissionGuard` does not supply, so a guard requirement would deny
 * every caller. The decision is made in the service, with that context, denying by
 * default and auditing every refusal.
 */
@AuthenticatedOnly()
@Controller('organizations/:organizationId')
export class OrganizationAppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * Bookable slots in the organization, optionally narrowed to one doctor, over a
   * bounded window and cursor-paginated on `(starts_at, slot_id)`. Nothing here
   * identifies a patient, a hold owner or an appointment: it is published capacity
   * only, filtered to doctors a booking would actually accept.
   */
  @Get('appointment-slots')
  async searchSlots(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.availability.searchSlots(current, organizationId, query);
  }

  /**
   * Books an appointment from a held or open slot.
   *
   * `Idempotency-Key` is mandatory and passed straight through: the repository
   * claims the key inside the booking transaction, so a retried request returns the
   * original response snapshot verbatim and never produces a second appointment.
   * The body carries no price — the fee comes from the doctor's own record, read
   * under lock in the same transaction.
   */
  @Post('appointments')
  @HttpCode(201)
  @RequireCsrf('appointment.book')
  @RequirePermission('appointment:book:own', 'appointment.book')
  // Booking is profile-keyed and idempotency-protected, but a tighter budget
  // caps denial-of-service attempts that create and cancel appointments to
  // disrupt a doctor's schedule. 10 per 60 seconds per profile.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async book(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.appointments.book(current, organizationId, idempotencyKey, body);
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
