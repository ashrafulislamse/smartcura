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
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { DevicesService } from './devices.service.js';

/**
 * Device administration, addressed by ORGANIZATION in the same shape
 * `MembershipsController` and `OrganizationAppointmentsController` use.
 *
 * A device is owned by exactly one organization: the composite
 * `device_assignments_device_org_fk` makes crossing that boundary impossible in
 * the database, so the URL names the organization whose authority is being
 * exercised. The identifier in the path must be the acting membership's own, and a
 * mismatch is concealed as 404 rather than 403, so the route cannot be walked to
 * discover which organizations exist.
 *
 * WHY NO `@RequirePermission` HERE, even though every requirement on this
 * controller is static: all four are `organization` scoped, and
 * `PermissionGuard` evaluates object policy with owner context only — it supplies
 * no `resourceOrganizationId`, so `scopeAllows('organization', ...)` is false for
 * every caller and a guard requirement would deny the whole controller. This is
 * the same reason `OrganizationAppointmentsController` leaves its
 * `availability:read:global` slot search to the service. `DevicesService` makes the
 * decision with the full context — active onboarded profile, active membership,
 * the organization match, then the specific grant — denies by default, and audits
 * every refusal through `DeviceRepository.recordDenial`. The repository then
 * re-proves the same authority under lock inside each mutation transaction.
 *
 * Every response is `no-store`. A device body carries its serial number and the
 * patient it is currently assigned to; a shared cache holding one would serve it
 * to a caller whose authorization was never evaluated.
 */
@AuthenticatedOnly()
@Controller('organizations/:organizationId/devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /**
   * Devices in the organization, optionally narrowed to one lifecycle state, and
   * cursor-paginated on `(created_at, device_id)`. `state` is the lifecycle, not
   * connectivity: reachability is `last_seen_at`, which only ingestion writes.
   */
  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.devices.list(current, organizationId, query);
  }

  /**
   * Registers a device and the digest of the credential it will present to the
   * broker. 201 because a device and a credential row are created.
   *
   * The body carries `provisioning_secret` in PLAINTEXT, and this is the only
   * request in which it ever appears. The service hashes it to SHA-256 lowercase
   * hex and passes only the digest onward; the plaintext is never stored, logged,
   * echoed in the response, or folded into the idempotency request fingerprint, so
   * a later disclosure of the database or of the idempotency ledger cannot be
   * replayed against the broker.
   *
   * `Idempotency-Key` is mandatory and passed through verbatim: the key is claimed
   * inside the registration transaction, so a retry returns the stored response of
   * the original request instead of colliding with the serial-number uniqueness
   * index and leaving the operator unsure which attempt won.
   */
  @Post()
  @HttpCode(201)
  @RequireCsrf('device.register')
  async register(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.devices.register(current, organizationId, idempotencyKey, body);
  }

  /**
   * Reads one device together with its open assignment, if any. A device belonging
   * to another organization is reported as 404: the lookup is scoped by
   * organization, so absence and concealment are indistinguishable by design.
   */
  @Get(':deviceId')
  async get(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.devices.get(current, organizationId, deviceId);
  }

  /**
   * Opens an assignment binding the device to a named patient. 200, not 201: the
   * assignment has no address of its own and the response is the device it
   * changed. `expected_version` carries the optimistic concurrency check; the
   * at-most-one-open-assignment rule is a partial unique index, so two concurrent
   * assignments cannot both succeed however this layer orders its work.
   */
  @Post(':deviceId/assignments')
  @HttpCode(200)
  @RequireCsrf('device.assign')
  async assign(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.devices.assign(current, organizationId, deviceId, body);
  }

  /**
   * Closes the open assignment. A sub-resource action rather than a DELETE on the
   * assignment: nothing is removed, the open row is closed with a timestamp and a
   * structured reason code and the history stays intact, because a reading recorded
   * last month must remain attributable to the patient the device was assigned to
   * then. No `Idempotency-Key` — `expected_version` already makes a repeated
   * release a version conflict rather than a second release.
   */
  @Post(':deviceId/assignments/release')
  @HttpCode(200)
  @RequireCsrf('device.release')
  async release(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.devices.release(current, organizationId, deviceId, body);
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
