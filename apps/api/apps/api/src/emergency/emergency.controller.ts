import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession, RequireCsrf, RequirePermission, type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { EmergencyService } from './emergency.service.js';

/**
 * WP-12 emergency routes.
 *
 * The PermissionGuard is DEFAULT-DENY, so every controller must declare its
 * authorization or every route 403s with `route.authorization.missing`. It also cannot
 * evaluate `site` or `:assigned` scope, having no object context, so site and
 * organization relationships are enforced in the service and are NOT expressed here.
 */
@Controller('emergencies')
@AuthenticatedOnly()
export class EmergencyEventsController {
  constructor(private readonly emergency: EmergencyService) {}

  /** SOS. Own-scoped, or another patient through a live consent grant. */
  @Post()
  @RequireCsrf('emergency.sos_create')
  @RequirePermission('emergency.event:create:own', 'emergency.event.raise')
  async raise(@CurrentSession() current: AuthenticatedSession, @Body() body: unknown) {
    return this.emergency.raise(current, body);
  }

  /**
   * The dispatch queue, ordered by clinical urgency. Site scope is enforced in the
   * service, which takes the organization from the membership rather than the request.
   */
  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Query() query: unknown,
  ) {
    // A queue row carries a patient identifier and a location, so it is never cacheable.
    noStore(response);
    return this.emergency.listEvents(current, query);
  }

  @Get(':emergencyEventId')
  async read(@CurrentSession() current: AuthenticatedSession, @Param('emergencyEventId') eventId: string) {
    return this.emergency.read(current, eventId);
  }

  @Post(':emergencyEventId/triage')
  @RequireCsrf('emergency.triage_record')
  async triage(
    @CurrentSession() current: AuthenticatedSession,
    @Param('emergencyEventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.emergency.triage(current, eventId, body);
  }

  /** Atomic boundary 7: unit reservation and event transition in one transaction. */
  @Post(':emergencyEventId/dispatch')
  @RequireCsrf('emergency.dispatch_create')
  async dispatch(
    @CurrentSession() current: AuthenticatedSession,
    @Param('emergencyEventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.emergency.reserveUnit(current, eventId, body);
  }

  @Put(':emergencyEventId/status')
  @RequireCsrf('emergency.status_change')
  async advance(
    @CurrentSession() current: AuthenticatedSession,
    @Param('emergencyEventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.emergency.advance(current, eventId, body);
  }

  @Post(':emergencyEventId/resolution')
  @RequireCsrf('emergency.resolution_record')
  async resolve(
    @CurrentSession() current: AuthenticatedSession,
    @Param('emergencyEventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.emergency.resolve(current, eventId, body);
  }

  @Post(':emergencyEventId/communications')
  @RequireCsrf('emergency.communication_record')
  async communicate(
    @CurrentSession() current: AuthenticatedSession,
    @Param('emergencyEventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.emergency.recordCommunication(current, eventId, body);
  }
}

/**
 * Break-glass.
 *
 * Every response here is `no-store`: a minimum-necessary clinical projection read under
 * emergency authority must not be left in a shared cache after the grant expires.
 */
@Controller('break-glass')
@AuthenticatedOnly()
export class BreakGlassController {
  constructor(private readonly emergency: EmergencyService) {}

  @Post('grants')
  @RequireCsrf('break_glass.grant_create')
  async activate(@CurrentSession() current: AuthenticatedSession, @Res({ passthrough: true }) response: ResponseLike, @Body() body: unknown) {
    noStore(response);
    return this.emergency.activateBreakGlass(current, body);
  }

  @Get('grants/:grantId/patient-record')
  async read(@CurrentSession() current: AuthenticatedSession, @Res({ passthrough: true }) response: ResponseLike, @Param('grantId') grantId: string) {
    noStore(response);
    return this.emergency.readUnderBreakGlass(current, grantId);
  }

  /**
   * Vital readings under an active break-glass grant. Same `noStore` rule as the
   * patient-record read: clinical data read under emergency authority must not
   * be left in a shared cache after the grant expires.
   */
  @Get('grants/:grantId/vital-readings')
  async readVitals(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('grantId') grantId: string,
    @Query() query: unknown,
  ) {
    noStore(response);
    return this.emergency.readVitalsUnderBreakGlass(current, grantId, query);
  }

  /**
   * Health alerts under an active break-glass grant. Same `noStore` rule.
   */
  @Get('grants/:grantId/health-alerts')
  async readAlerts(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('grantId') grantId: string,
    @Query() query: unknown,
  ) {
    noStore(response);
    return this.emergency.readAlertsUnderBreakGlass(current, grantId, query);
  }

  @Put('grants/:grantId/status')
  @RequireCsrf('break_glass.grant_status')
  async terminate(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('grantId') grantId: string,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.emergency.terminateBreakGlass(current, grantId, body);
  }

  @Post('grants/:grantId/review')
  @RequireCsrf('break_glass.grant_review')
  async review(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('grantId') grantId: string,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.emergency.reviewBreakGlass(current, grantId, body);
  }
}

/**
 * Fleet roster.
 *
 * Site scope is enforced in the service (the guard cannot evaluate `:site` scope, having
 * no object context), so no `@RequirePermission` on the route — same convention as the
 * dispatch queue `@Get()` above.
 */
@Controller('emergency-units')
@AuthenticatedOnly()
export class EmergencyUnitsController {
  constructor(private readonly emergency: EmergencyService) {}

  /**
   * The unit roster for the caller's organization. `noStore` because a stale "available"
   * status could mislead a dispatcher into assigning a unit that has already been dispatched.
   */
  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Query() query: unknown,
  ) {
    noStore(response);
    return this.emergency.listUnits(current, query);
  }
}
