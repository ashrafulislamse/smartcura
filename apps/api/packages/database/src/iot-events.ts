/**
 * Canonical published event identifiers for WP-07a.
 *
 * These live in their own module for the same reason `events.ts` does: more than
 * one repository publishes them, and importing them from a repository would
 * create a cycle. Each constant pairs with a schema in the AsyncAPI document, and
 * every schema there sets `additionalProperties: false`, so a payload must carry
 * exactly the declared fields or the worker rejects it and it dead-letters. The
 * required AsyncAPI additions are listed in `HANDOFF-0014.md`.
 *
 * Naming follows the canonical `<aggregate>.changed.v1` form. Note that the
 * AsyncAPI document already carries two older, differently named IoT messages
 * (`iot.reading_recorded.v1`, `health.alert_changed.v1`) whose enum vocabularies
 * predate this migration; the handoff records the reconciliation that the
 * contract owner has to make.
 */

/** Registration, state change, assignment or release of a device. */
export const DEVICE_CHANGED_EVENT_TYPE = 'device.changed.v1';
export const DEVICE_CHANGED_EVENT_VERSION = 1;

/**
 * One accepted vital reading. Deliberately carries no measured value: the value
 * is clinical data, and an event stream is fanned out far more widely than an
 * authorized HTTP read.
 */
export const VITAL_READING_CHANGED_EVENT_TYPE = 'vital_reading.changed.v1';
export const VITAL_READING_CHANGED_EVENT_VERSION = 1;

/** A health alert opened, acknowledged or resolved. */
export const HEALTH_ALERT_CHANGED_EVENT_TYPE = 'health_alert.changed.v1';
export const HEALTH_ALERT_CHANGED_EVENT_VERSION = 1;
