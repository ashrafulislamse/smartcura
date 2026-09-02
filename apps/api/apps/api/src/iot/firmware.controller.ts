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
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { FirmwareService } from './firmware.service.js';

/**
 * Firmware OTA: version check, download URL, rollout administration and the
 * device-reported event trail.
 *
 * The version-check and download routes are open to any authenticated caller —
 * a patient app checks on behalf of a device, and a device fetches its own
 * update. Rollout creation is `iot.firmware:manage:global`, which the
 * `PermissionGuard` decides from the session alone (owner = actor, global
 * scope), so it can be a static `@RequirePermission` rather than a service-level
 * decision like the organization-scoped device routes.
 *
 * Every GET is `no-store`: a version-check response or a download URL is a
 * short-lived, per-caller capability and must never be served from a shared
 * cache. Every state-changing route declares `@RequireCsrf`, satisfying the
 * CSRF-coverage guard.
 */
@AuthenticatedOnly()
@Controller()
export class FirmwareController {
  constructor(private readonly firmware: FirmwareService) {}

  /**
   * Version check. Returns the latest firmware for a hardware profile and
   * whether the caller's `current_version` is behind it. A device polls this on
   * boot and periodically; a patient app calls it per device to surface an
   * "update available" badge.
   */
  @Get('firmware/versions/:hardwareProfile')
  async checkVersion(
    @CurrentSession() current: AuthenticatedSession,
    @Param('hardwareProfile') hardwareProfile: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.firmware.checkVersion(current, hardwareProfile, query);
  }

  /**
   * Mints a short-lived presigned download URL for a firmware binary. The
   * device fetches the artifact directly from object storage and verifies the
   * `sha256` against the registry before flashing.
   */
  @Get('firmware/versions/:firmwareVersionId/download')
  async getDownloadUrl(
    @CurrentSession() current: AuthenticatedSession,
    @Param('firmwareVersionId') firmwareVersionId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.firmware.getDownloadUrl(current, firmwareVersionId);
  }

  /**
   * Creates a rollout directing one firmware version at one organization.
   * Super-admin only: firmware management is a global permission that no
   * organization administrator may hold, so the policy engine denies every
   * non-super-admin caller at the guard and the service need not re-prove it.
   */
  @Post('firmware/rollouts')
  @HttpCode(201)
  @RequireCsrf('firmware.rollout.create')
  @RequirePermission('iot.firmware:manage:global', 'firmware.rollout.create')
  async createRollout(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.firmware.createRollout(current, body);
  }

  /**
   * Records a device-reported firmware event (offered, downloading, installed,
   * failed, rejected). The device id is in the path; the firmware version,
   * optional rollout and outcome are in the body. Appends to the append-only
   * `device_firmware_events` trail.
   */
  @Post('devices/:deviceId/firmware-events')
  @HttpCode(201)
  @RequireCsrf('device.firmware.event')
  async recordFirmwareEvent(
    @CurrentSession() current: AuthenticatedSession,
    @Param('deviceId') deviceId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.firmware.recordFirmwareEvent(current, deviceId, body);
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
