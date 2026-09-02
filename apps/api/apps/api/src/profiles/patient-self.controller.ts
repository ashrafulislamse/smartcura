import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
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
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { problem } from '../platform/problems.js';
import { ReadingsService } from '../iot/readings.service.js';
import { PatientSelfService } from './patient-self.service.js';

/**
 * The authenticated patient's own clinical and scheduling history, addressed as
 * `/profiles/me/*`.
 *
 * Every route carries `@RequirePermission(...:read:own, ...)` because an `own`
 * scope is decidable from the session alone: the owner is the actor, so the
 * shared `PermissionGuard` can reject a caller without the grant before any
 * query runs. That is the structural difference from the `assigned`-scoped
 * patient routes in `PatientVitalReadingsController`, which carry no decorator
 * because an `assigned` scope needs a care assignment the guard cannot see.
 *
 * No route accepts a patient identifier in the path or query. The patient is
 * ALWAYS the session's own profile, read inside the service. An identifier in a
 * query string is the one value a caller can always change, so there is nothing
 * here to substitute — the same rule `OwnVitalReadingsController` follows.
 *
 * The two POST routes (`/devices/{deviceId}/assignments` and `/release`) are
 * state-changing, so they also declare `@RequireCsrf`. Every response is
 * `no-store`: a list keyed only on the URL would otherwise be served to a
 * caller whose authorization was never evaluated.
 */
@AuthenticatedOnly()
@Controller('profiles/me')
export class PatientSelfController {
  constructor(
    private readonly self: PatientSelfService,
    private readonly readings: ReadingsService,
  ) {}

  /**
   * The patient's own signed-or-active prescriptions, newest first. A draft is
   * excluded because it is the doctor's working copy the patient has not yet been
   * handed; `signed`, `superseded`, `cancelled` and `expired` are all included so
   * the medication history is complete.
   */
  @Get('prescriptions')
  @RequirePermission('prescription:read:own', 'prescription.read.own')
  async listOwnPrescriptions(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.self.listOwnPrescriptions(current, query);
  }

  /**
   * The patient's own past consultations, newest by `updated_at` so a
   * consultation that just completed surfaces first rather than being buried
   * under older open ones.
   */
  @Get('consultations')
  @RequirePermission('consultation:read:own', 'consultation.read.own')
  async listOwnConsultations(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.self.listOwnConsultations(current, query);
  }

  /**
   * The patient's own health alerts, newest first, optionally narrowed to one
   * state. At most one alert is live per patient, metric and threshold, so a
   * sustained breach appears once rather than once per reading.
   */
  @Get('health-alerts')
  @RequirePermission('alert:read:own', 'health_alert.read.own')
  async listOwnHealthAlerts(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.self.listOwnHealthAlerts(current, query);
  }

  /**
   * The patient's next upcoming appointment, or 404 if there is none. A
   * convenience aggregate for the home screen: the earliest appointment whose
   * slot starts after now and whose status is still live.
   */
  @Get('appointments/next')
  @RequirePermission('appointment:read:own', 'appointment.read.own')
  async findNextAppointment(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.self.findNextAppointment(current);
  }

  /**
   * Devices currently assigned to the patient (open assignments only), newest
   * first. The patient needs the deviceId to POST readings to the existing
   * ingestion endpoint, and `device:read:own` (seeded in 0045) lets them
   * discover it without holding the admin-only organization-scope grant.
   */
  @Get('devices')
  @RequirePermission('device:read:own', 'device.read.own')
  async listOwnDevices(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.self.listOwnDevices(current, query);
  }

  /**
   * One device assigned to the patient (open assignment only). Returns 404 when
   * the device is unknown, not assigned to this patient, or its assignment has
   * been released, so the route cannot be walked to discover another patient's
   * devices.
   */
  @Get('devices/:deviceId')
  @RequirePermission('device:read:own', 'device.read.own')
  async getOwnDevice(
    @CurrentSession() current: AuthenticatedSession,
    @Param('deviceId') deviceId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.self.getOwnDevice(current, deviceId);
  }

  /**
   * Assigns an unassigned IoT device in the patient's organization to the
   * patient themselves. Requires `device:assign:own` (granted to patient in 0061).
   * 200 rather than 201 because the assignment has no address of its own.
   */
  @Post('devices/:deviceId/assignments')
  @HttpCode(200)
  @RequirePermission('device:assign:own', 'device.assign.own')
  @RequireCsrf('device.assign')
  async assignOwnDevice(
    @CurrentSession() current: AuthenticatedSession,
    @Param('deviceId') deviceId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.self.assignOwnDevice(current, deviceId, body);
  }

  /**
   * Releases a device currently assigned to the patient. Requires
   * `device:release:own` (granted to patient in 0061). The open assignment row is
   * closed with a timestamp and a structured PHI-free reason code; the history
   * stays intact so past readings remain attributable to the patient.
   */
  @Post('devices/:deviceId/assignments/release')
  @HttpCode(200)
  @RequirePermission('device:release:own', 'device.release.own')
  @RequireCsrf('device.release')
  async releaseOwnDevice(
    @CurrentSession() current: AuthenticatedSession,
    @Param('deviceId') deviceId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.self.releaseOwnDevice(current, deviceId, body);
  }

  /**
   * Vital readings from one of the patient's own assigned devices. The device id
   * is in the path (not the query) so the route is a natural sub-resource of the
   * patient's device; the service merges it into the query before parsing so a
   * caller cannot substitute another device by tampering with query params.
   *
   * This route lives in PatientSelfController rather than OwnVitalReadingsController
   * because both share the `/profiles/me` base path. When two controllers mount
   * overlapping routes, Express matches them in module registration order, and the
   * broader `devices/:deviceId` route would otherwise swallow the more specific
   * `devices/:deviceId/vital-readings` route and return a 404 for the wrong reason.
   */
  @Get('devices/:deviceId/vital-readings')
  @RequirePermission('reading:read:own', 'reading.read.own')
  async listOwnDeviceReadings(
    @CurrentSession() current: AuthenticatedSession,
    @Param('deviceId') deviceId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    const merged = typeof query === 'object' && query !== null
      ? { ...query, device_id: deviceId }
      : { device_id: deviceId };
    return this.readings.listOwnReadings(current, merged);
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
