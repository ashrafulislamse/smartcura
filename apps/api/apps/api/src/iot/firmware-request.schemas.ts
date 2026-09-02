import { z } from 'zod';
import {
  DEVICE_HARDWARE_PROFILES,
  FIRMWARE_EVENT_OUTCOMES,
  FIRMWARE_ROLLOUT_STATUSES,
  type DeviceHardwareProfileValue,
  type FirmwareEventOutcomeValue,
  type FirmwareRolloutStatusValue,
} from '@smartcura/database/iot';
import { uuidV7Schema } from './iot-request.schemas.js';

/**
 * WP-07b request schemas for the firmware OTA surface.
 *
 * Every enum is DERIVED from the const array the repository exports, so a
 * vocabulary added to the data layer cannot be silently unaccepted here. The
 * repository re-proves the same set against `device_firmware_events_outcome_check`
 * and the rollout status enum, which is the second line of defence.
 */

const HARDWARE_PROFILES = [...DEVICE_HARDWARE_PROFILES] as [
  DeviceHardwareProfileValue,
  ...DeviceHardwareProfileValue[],
];

const ROLLOUT_STATUSES = [...FIRMWARE_ROLLOUT_STATUSES] as [
  FirmwareRolloutStatusValue,
  ...FirmwareRolloutStatusValue[],
];

const EVENT_OUTCOMES = [...FIRMWARE_EVENT_OUTCOMES] as [
  FirmwareEventOutcomeValue,
  ...FirmwareEventOutcomeValue[],
];

/**
 * Absolute instant with an explicit offset, mirroring the `instant` validator
 * in `iot-request.schemas.ts`. A bare local timestamp is rejected: a device
 * reporting from another zone would otherwise shift its event time, and the
 * append-only trail would record the wrong moment.
 */
const instant = z.string().min(20).max(40).refine((value) => {
  if (!/[Zz]$|[+-][01][0-9]:[0-5][0-9]$/.test(value)) return false;
  return Number.isFinite(new Date(value).getTime());
});

/**
 * Path segment for a hardware profile. Validated against the enum so a typo
 * (e.g. `smartcura-esp32-v1`) is a 422 rather than a silent empty result that
 * looks like "no firmware published".
 */
export const hardwareProfilePathSchema = z.object({
  hardwareProfile: z.enum(HARDWARE_PROFILES),
}).strict();

export const firmwareVersionIdPathSchema = z.object({
  firmwareVersionId: uuidV7Schema,
}).strict();

export const deviceIdPathSchema = z.object({
  deviceId: uuidV7Schema,
}).strict();

/**
 * Version check. `current_version` is optional: a device that cannot report its
 * running version is always offered the latest, and a patient app checking on
 * behalf of a device with a null `firmware_version` sends nothing.
 */
export const firmwareVersionCheckQuerySchema = z.object({
  current_version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
}).strict();

/**
 * Rollout creation. `organization_id` names the target because firmware
 * management is a GLOBAL permission: the super-admin selects which organization
 * receives the campaign. `scheduled_at` is required iff the status is
 * `scheduled`, mirroring `firmware_rollouts_scheduled_check`.
 */
export const createFirmwareRolloutSchema = z.object({
  firmware_version_id: uuidV7Schema,
  organization_id: uuidV7Schema,
  status: z.enum(ROLLOUT_STATUSES).default('draft'),
  scheduled_at: instant.nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.status === 'scheduled' && value.scheduled_at === null) {
    context.addIssue({
      code: 'custom', path: ['scheduled_at'],
      message: 'A scheduled rollout must name a scheduled_at instant',
    });
  }
  if (value.status !== 'scheduled' && value.scheduled_at !== null) {
    context.addIssue({
      code: 'custom', path: ['scheduled_at'],
      message: 'Only a scheduled rollout may carry a scheduled_at instant',
    });
  }
});

/**
 * A device-reported firmware event. `rollout_id` is nullable because a device
 * may check for updates outside any campaign (the version-check endpoint), and
 * `detail_code` is nullable because only `failed` and `rejected` outcomes carry
 * a reason. `occurred_at` is optional and defaults to the server's now when
 * absent, so a device without a synced clock can still report.
 */
export const recordFirmwareEventSchema = z.object({
  firmware_version_id: uuidV7Schema,
  rollout_id: uuidV7Schema.nullable().default(null),
  outcome: z.enum(EVENT_OUTCOMES),
  detail_code: z.string().min(1).max(64).nullable().default(null),
  occurred_at: instant.optional(),
}).strict();

export type FirmwareVersionCheckQuery = z.infer<typeof firmwareVersionCheckQuerySchema>;
export type CreateFirmwareRolloutRequest = z.infer<typeof createFirmwareRolloutSchema>;
export type RecordFirmwareEventRequest = z.infer<typeof recordFirmwareEventSchema>;
