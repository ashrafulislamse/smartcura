/**
 * Canonical published event identifiers and structured reason codes for WP-04a
 * extended profile data.
 *
 * These live in their own module for the same reason `events.ts` exists: more
 * than one repository and the worker's contract table reference them, and
 * importing them from a repository would create a cycle. Each constant pairs with
 * a schema in the AsyncAPI document; every schema there sets
 * `additionalProperties: false`, so a payload must carry exactly the declared
 * fields or the worker rejects it and the event dead-letters.
 *
 * They are not added to `events.ts` because that file is being edited
 * concurrently. `HANDOFF-0011.md` lists the exports to surface from
 * `index.ts`.
 */

/** Any change to one extended profile detail row (address, contact, allergy, condition). */
export const PROFILE_DETAIL_CHANGED_EVENT_TYPE = 'profile_detail.changed.v1';
export const PROFILE_DETAIL_CHANGED_EVENT_VERSION = 1;

/** Any change to a doctor membership's professional detail. */
export const DOCTOR_DETAIL_CHANGED_EVENT_TYPE = 'doctor_detail.changed.v1';
export const DOCTOR_DETAIL_CHANGED_EVENT_VERSION = 1;

/**
 * Which kind of detail row changed. Deliberately coarse: the event says that a
 * patient's address list changed, never what the address is. Subscribers refetch
 * through the authorized REST endpoint, which is the only place the object policy
 * is applied.
 */
export const PROFILE_DETAIL_KINDS = [
  'address',
  'emergency_contact',
  'allergy',
  'condition',
] as const;

export type ProfileDetailKind = typeof PROFILE_DETAIL_KINDS[number];

/** The shape of the change, not its content. */
export const PROFILE_DETAIL_CHANGE_TYPES = ['created', 'updated', 'removed'] as const;

export type ProfileDetailChangeType = typeof PROFILE_DETAIL_CHANGE_TYPES[number];

/**
 * Structured, PHI-free reasons for a change to an extended profile detail row.
 *
 * Free text is deliberately not accepted, following the
 * `MEMBERSHIP_TRANSITION_REASON_CODES` precedent. These reason codes land in
 * broadly retained audit logs, and an open string field on a form that sits next
 * to an allergy or condition is the single most likely route for clinical detail
 * to leak into them. A patient explaining *why* they removed a condition would be
 * describing their own health in an audit row.
 */
export const PROFILE_DETAIL_REASON_CODES = [
  'patient_self_service',
  'data_correction',
  'duplicate_removed',
  'no_longer_applicable',
  'superseded',
  'clinician_advice',
] as const;

export type ProfileDetailReasonCode = typeof PROFILE_DETAIL_REASON_CODES[number];

/**
 * Structured reasons for a doctor professional detail change. Separate from the
 * profile detail codes because the vocabularies have nothing in common: no
 * clinical reason applies to a fee or biography, and sharing one enum would offer
 * the wrong options on both forms.
 */
export const DOCTOR_DETAIL_REASON_CODES = [
  'practitioner_update',
  'data_correction',
  'fee_revision',
  'availability_change',
  'credential_update',
] as const;

export type DoctorDetailReasonCode = typeof DOCTOR_DETAIL_REASON_CODES[number];
