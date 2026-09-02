import { z } from 'zod';
import type {
  DeviceStateValue,
  DeviceTypeValue,
} from '@smartcura/database/iot';

/**
 * Schemas for the doctor-scoped IoT device list endpoint.
 *
 * The device state and device type lists are declared as `as const` arrays
 * annotated with the corresponding generated type, so a divergence from the
 * enum in the database fails to compile instead of failing at request time.
 * This matches the convention in `iot-request.schemas.ts`.
 */

/**
 * The device lifecycle states, annotated against `DeviceStateValue` so an
 * invented state cannot compile. `state` is the lifecycle, not connectivity:
 * reachability is `last_seen_at`, which only ingestion writes.
 */
const DEVICE_STATES = [
  'provisioned', 'active', 'suspended', 'retired',
] as const satisfies readonly DeviceStateValue[];

/**
 * The device types, annotated against `DeviceTypeValue` so an invented type
 * cannot compile.
 */
const DEVICE_TYPES = [
  'vitals_monitor', 'ecg', 'thermometer', 'pulse_oximeter', 'simulator', 'phone',
] as const satisfies readonly DeviceTypeValue[];

/**
 * Query parameters for GET /doctor/devices.
 *
 * `state` optionally narrows the list to one lifecycle state. `cursor` is the
 * opaque keyset pagination cursor. `page_size` is bounded 1–100, matching the
 * IoT devices endpoint convention.
 */
export const deviceListQuerySchema = z
  .object({
    state: z.enum(DEVICE_STATES).optional(),
    device_type: z.enum(DEVICE_TYPES).optional(),
    cursor: z.string().min(1).max(512).optional(),
    page_size: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type DeviceListQuery = z.infer<typeof deviceListQuerySchema>;
