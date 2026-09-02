/**
 * Canonical published event identifiers.
 *
 * These live in their own module because more than one repository publishes the
 * same event, and importing them from a repository would create a cycle. Each
 * constant pairs with a schema in the AsyncAPI document; every schema there sets
 * `additionalProperties: false`, so a payload must carry exactly the declared
 * fields or the worker rejects it.
 */

/** Any change to a profile's status or attributes. */
export const PROFILE_CHANGED_EVENT_TYPE = 'profile.changed.v1';
export const PROFILE_CHANGED_EVENT_VERSION = 1;
