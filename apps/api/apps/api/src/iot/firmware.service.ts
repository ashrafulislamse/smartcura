import { Injectable } from '@nestjs/common';
import {
  FirmwareRepository,
  compareSemver,
  serializeDeviceFirmwareEvent,
  serializeFirmwareRollout,
  serializeFirmwareVersion,
  type DeviceHardwareProfileValue,
} from '@smartcura/database/iot';
import {
  ObjectStorageRequestError,
  supportsPresignedOperations,
  type ObjectStorageProvider,
  type PresignedObjectOperation,
} from '@smartcura/storage';
import type { ApiConfig } from '../config.js';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  createFirmwareRolloutSchema,
  deviceIdPathSchema,
  firmwareVersionCheckQuerySchema,
  firmwareVersionIdPathSchema,
  hardwareProfilePathSchema,
  recordFirmwareEventSchema,
  type CreateFirmwareRolloutRequest,
  type FirmwareVersionCheckQuery,
  type RecordFirmwareEventRequest,
} from './firmware-request.schemas.js';

/** Lifetime of a firmware download capability, in seconds. */
const DOWNLOAD_EXPIRY_SECONDS = 300;

/**
 * Firmware OTA: version check, download URL minting, rollout administration and
 * the device-reported event trail.
 *
 * The version check and download routes are available to any authenticated
 * caller — a patient app checks on behalf of a device, and a device fetches its
 * own update. Rollout creation is gated by the `iot.firmware:manage:global`
 * permission at the route guard, so this service only touches the session to
 * revalidate it. The download URL is a presigned capability minted from the
 * object store, never a streamed byte range through the API: the artifact is
 * large and the device fetches it directly from storage.
 */
@Injectable()
export class FirmwareService {
  constructor(
    private readonly firmware: FirmwareRepository,
    private readonly authorization: SessionAuthorizationService,
    private readonly storage: ObjectStorageProvider,
    private readonly config: ApiConfig,
  ) {}

  /**
   * Compares the caller's current firmware against the latest published for a
   * hardware profile. A device that reports no `current_version` (or one the
   * registry has nothing newer than) is told an update is available whenever any
   * version exists, so a freshly flashed or unknown device pulls the current
   * build. When no firmware has been published for the profile, `latest_version`
   * is null and `update_available` is false.
   */
  async checkVersion(
    current: AuthenticatedSession,
    hardwareProfileValue: string,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    await this.authorization.touch(current);
    const hardwareProfile = parseHardwareProfile(hardwareProfileValue);
    const query = parseCheckQuery(queryValue);
    const latest = await this.firmware.getLatestVersion(hardwareProfile);
    if (latest === undefined) {
      return {
        hardware_profile: hardwareProfile,
        current_version: query.current_version ?? null,
        latest_version: null,
        update_available: false,
        firmware_version: null,
      };
    }
    const currentVersion = query.current_version ?? null;
    const updateAvailable =
      currentVersion === null || compareSemver(latest.version, currentVersion) > 0;
    return {
      hardware_profile: hardwareProfile,
      current_version: currentVersion,
      latest_version: latest.version,
      update_available: updateAvailable,
      firmware_version: updateAvailable ? serializeFirmwareVersion(latest) : null,
    };
  }

  /**
   * Mints a short-lived presigned download URL for a firmware binary. The
   * capability is bound to the object key and an expiry; the device verifies the
   * `sha256` against the registry after downloading, so a tampered artifact is
   * rejected before the flash. A store that cannot presign answers 503 rather
   * than streaming gigabytes through the API.
   */
  async getDownloadUrl(
    current: AuthenticatedSession,
    firmwareVersionIdValue: string,
  ): Promise<Record<string, unknown>> {
    await this.authorization.touch(current);
    const firmwareVersionId = parseFirmwareVersionId(firmwareVersionIdValue);
    const version = await this.firmware.getVersion(firmwareVersionId);
    if (version === undefined) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Firmware version was not found', correlationId());
    }
    if (!supportsPresignedOperations(this.storage)) {
      throw problem(503, 'DEPENDENCY_UNAVAILABLE', 'Firmware storage is unavailable', correlationId());
    }
    const operation = await this.mintDownload(version.objectKey);
    return {
      firmware_version_id: version.firmwareVersionId,
      version: version.version,
      sha256: version.sha256,
      size_bytes: version.sizeBytes,
      download: operationResponse(operation),
    };
  }

  /**
   * Creates a rollout. The `iot.firmware:manage:global` requirement is enforced
   * by the route guard; this method revalidates the session, parses the body and
   * translates the repository's typed failure into a problem response.
   */
  async createRollout(
    current: AuthenticatedSession,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    await this.authorization.touch(current);
    const request = parseCreateRollout(bodyValue);
    const result = await this.firmware.createRollout({
      firmwareVersionId: request.firmware_version_id,
      organizationId: request.organization_id,
      status: request.status,
      scheduledAt: request.scheduled_at === null ? null : new Date(request.scheduled_at),
      now: new Date(),
    });
    if (typeof result === 'string') {
      switch (result) {
        case 'firmware_version_not_found':
          throw problem(
            404, 'RESOURCE_NOT_FOUND', 'Firmware version was not found', correlationId(),
          );
        case 'live_rollout_conflict':
          throw problem(
            409, 'FIRMWARE_ROLLOUT_CONFLICT',
            'A live rollout for this firmware version and organization already exists',
            correlationId(),
          );
      }
    }
    return serializeFirmwareRollout(result);
  }

  /**
   * Appends a device-reported firmware event. The device id is taken from the
   * path and the event details from the body; the foreign key to `devices`
   * refuses an unknown device, which surfaces as a 404.
   */
  async recordFirmwareEvent(
    current: AuthenticatedSession,
    deviceIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    await this.authorization.touch(current);
    const deviceId = parseDeviceId(deviceIdValue);
    const request = parseRecordEvent(bodyValue);
    try {
      const record = await this.firmware.recordFirmwareEvent({
        deviceId,
        rolloutId: request.rollout_id,
        firmwareVersionId: request.firmware_version_id,
        outcome: request.outcome,
        detailCode: request.detail_code,
        occurredAt: request.occurred_at === undefined ? new Date() : new Date(request.occurred_at),
      });
      return serializeDeviceFirmwareEvent(record);
    } catch (error) {
      const code = foreignKeyCode(error);
      if (code === 'device_firmware_events_device_fk') {
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Device was not found', correlationId());
      }
      if (code === 'device_firmware_events_version_fk' || code === 'device_firmware_events_rollout_fk') {
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Referenced firmware version or rollout was not found', correlationId());
      }
      throw error;
    }
  }

  /**
   * Mints the presigned download capability, translating a store transport
   * failure into a 503 so a transient outage is never a 500. The caller has
   * already narrowed `this.storage` with `supportsPresignedOperations`.
   */
  private async mintDownload(objectKey: string): Promise<PresignedObjectOperation> {
    if (!supportsPresignedOperations(this.storage)) {
      throw problem(503, 'DEPENDENCY_UNAVAILABLE', 'Firmware storage is unavailable', correlationId());
    }
    try {
      return await this.storage.createDownloadOperation(objectKey, DOWNLOAD_EXPIRY_SECONDS);
    } catch (error) {
      if (error instanceof ObjectStorageRequestError) {
        throw problem(503, 'DEPENDENCY_UNAVAILABLE', 'Firmware storage is unavailable', correlationId());
      }
      throw error;
    }
  }
}

function operationResponse(operation: PresignedObjectOperation): Record<string, unknown> {
  return {
    method: operation.method,
    url: operation.url.toString(),
    expires_at: operation.expiresAt.toISOString(),
    required_headers: { ...operation.requiredHeaders },
  };
}

function parseHardwareProfile(value: string): DeviceHardwareProfileValue {
  const result = hardwareProfilePathSchema.safeParse({ hardwareProfile: value });
  if (!result.success) throw validationFailed();
  return result.data.hardwareProfile;
}

function parseFirmwareVersionId(value: string): string {
  const result = firmwareVersionIdPathSchema.safeParse({ firmwareVersionId: value });
  if (!result.success) throw validationFailed();
  return result.data.firmwareVersionId;
}

function parseDeviceId(value: string): string {
  const result = deviceIdPathSchema.safeParse({ deviceId: value });
  if (!result.success) throw validationFailed();
  return result.data.deviceId;
}

function parseCheckQuery(value: unknown): FirmwareVersionCheckQuery {
  const result = firmwareVersionCheckQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseCreateRollout(value: unknown): CreateFirmwareRolloutRequest {
  const result = createFirmwareRolloutSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseRecordEvent(value: unknown): RecordFirmwareEventRequest {
  const result = recordFirmwareEventSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function foreignKeyCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  if (code !== '23503') return undefined;
  const constraint = (error as { readonly constraint?: unknown }).constraint;
  return typeof constraint === 'string' ? constraint : undefined;
}
