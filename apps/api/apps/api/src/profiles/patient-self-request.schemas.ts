import { z } from 'zod';
import type { HealthAlertStateValue } from '@smartcura/database/iot';
import { releaseDeviceSchema } from '../iot/iot-request.schemas.js';

const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

/**
 * A simple cursor-paginated collection list, the same shape
 * `collectionListSchema` uses for the doctor-workspace lists. `page_size` is
 * bounded and an excess is REFUSED rather than silently clamped, the rule every
 * list in this service follows.
 */
export const ownCollectionListSchema = z.object({
  cursor: z.string().min(1).max(1024).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

/**
 * Own health alerts, optionally narrowed to one state. The vocabulary is the
 * same `health_alert_state` pgEnum the assigned-scope `listHealthAlertsQuerySchema`
 * narrows on, derived from the canonical `HealthAlertStateValue` type rather than
 * retyped, so an invented state cannot compile.
 */
const HEALTH_ALERT_STATES = [
  'open', 'acknowledged', 'escalated', 'resolved', 'dismissed',
] as const satisfies readonly HealthAlertStateValue[];

export const ownHealthAlertsQuerySchema = z.object({
  state: z.enum(HEALTH_ALERT_STATES).optional(),
  cursor: z.string().min(1).max(1024).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export type OwnCollectionListQuery = z.infer<typeof ownCollectionListSchema>;
export type OwnHealthAlertsQuery = z.infer<typeof ownHealthAlertsQuerySchema>;

/**
 * Patient self-assign of an unassigned IoT device. The patient is always the
 * actor's own profile, so the body only needs the optimistic-concurrency check.
 * `expected_version` is optional: when absent the service reads the current
 * version from the unassigned device before assigning, which is safe because the
 * patient has not yet read the device and cannot hold a stale version.
 */
export const ownAssignDeviceSchema = z.object({
  expected_version: z.number().int().min(0).optional(),
}).strict();

export const ownReleaseDeviceSchema = releaseDeviceSchema;

export type OwnAssignDeviceRequest = z.infer<typeof ownAssignDeviceSchema>;
export type OwnReleaseDeviceRequest = z.infer<typeof ownReleaseDeviceSchema>;
