import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession,
  RequireCsrf,
  type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { DoctorDevicesService } from './doctor-devices.service.js';

/**
 * Doctor-scoped IoT device endpoints.
 *
 * GET /doctor/devices returns the IoT devices assigned to the current doctor's
 * active patients only — not the whole organization's devices. The scope is
 * derived entirely from the session (the active doctor membership), never from
 * the request, so a `site_id` or `organization_id` query parameter is not
 * accepted and cannot widen the scope.
 *
 * GET /doctor/available-devices lists devices in the doctor's organization that
 * have no open assignment and are in an assignable state, so the doctor can pick
 * one to assign to a patient.
 *
 * POST /doctor/devices/:deviceId/assignments and .../release let a doctor
 * assign or release a device to/from a patient under their own active care. The
 * `device:assign:assigned` permission (seeded in 0046) authorises this, and the
 * DeviceRepository re-proves the care assignment with a FOR SHARE lock inside
 * the write transaction.
 *
 * The class is decorated with `@AuthenticatedOnly()` rather than
 * `@RequirePermission` because the authorization is assignment-scoped, not
 * permission-scoped: the service resolves the active doctor membership and
 * checks `role_id = 'doctor'` and the `profile_detail:read:assigned` permission
 * itself, matching the pattern `DoctorController` and
 * `WorkstreamFController` use for `doctor/patients`.
 *
 * `noStore` is set so a device list — which carries a serial number and the
 * patient a device is currently bound to — is never cached by an intermediary.
 * A cached response would serve PHI to a caller whose authorization was never
 * evaluated.
 */
@Controller()
@AuthenticatedOnly()
export class DoctorDevicesController {
  constructor(private readonly service: DoctorDevicesService) {}

  @Get('doctor/devices')
  devices(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.service.devices(current, query);
  }

  @Get('doctor/available-devices')
  availableDevices(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.service.availableDevices(current, query);
  }

  @Post('doctor/devices/:deviceId/assignments')
  @HttpCode(200)
  @RequireCsrf('device.assign')
  async assignDevice(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('deviceId') deviceId: string,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.service.assignDevice(current, deviceId, body);
  }

  @Post('doctor/devices/:deviceId/assignments/release')
  @HttpCode(200)
  @RequireCsrf('device.release')
  async releaseDevice(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('deviceId') deviceId: string,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.service.releaseDevice(current, deviceId, body);
  }
}
