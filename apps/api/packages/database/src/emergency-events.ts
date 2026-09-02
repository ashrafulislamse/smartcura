/**
 * WP-12 emergency event contracts.
 *
 * Emergency payloads are MINIMUM DATA. An emergency event fans out to operations
 * dashboards and security notification, so a clinical detail placed here would travel
 * further than any other payload in the system. Coordinates, addresses, patient names
 * and triage narrative are deliberately absent: consumers that need them must read
 * through an authorized path that logs the access.
 */

export const EMERGENCY_EVENT_CHANGED_EVENT_TYPE = 'emergency.event.changed.v1';
export const EMERGENCY_EVENT_CHANGED_EVENT_VERSION = 1;

export const EMERGENCY_DISPATCH_CHANGED_EVENT_TYPE = 'emergency.dispatch.changed.v1';
export const EMERGENCY_DISPATCH_CHANGED_EVENT_VERSION = 1;

export const EMERGENCY_RESOLVED_EVENT_TYPE = 'emergency.event.resolved.v1';
export const EMERGENCY_RESOLVED_EVENT_VERSION = 1;

/**
 * Break-glass activation is a SECURITY event, not a clinical one. Policy requires
 * immediate security/operations notification through the outbox, and it carries the
 * reason code but never the reason detail, which is free text an actor supplied.
 */
export const BREAK_GLASS_ACTIVATED_EVENT_TYPE = 'security.break_glass.activated.v1';
export const BREAK_GLASS_ACTIVATED_EVENT_VERSION = 1;

export const BREAK_GLASS_TERMINATED_EVENT_TYPE = 'security.break_glass.terminated.v1';
export const BREAK_GLASS_TERMINATED_EVENT_VERSION = 1;

export const EMERGENCY_EVENT_STATUSES = [
  'created', 'triaged', 'dispatching', 'unit_assigned', 'responding',
  'on_scene', 'transporting', 'resolved', 'cancelled', 'false_alarm',
] as const;
export type EmergencyEventStatus = typeof EMERGENCY_EVENT_STATUSES[number];

export const TRIAGE_PRIORITIES = ['unknown', 'low', 'medium', 'high', 'critical'] as const;
export type TriagePriority = typeof TRIAGE_PRIORITIES[number];

export const EMERGENCY_UNIT_STATUSES = [
  'available', 'reserved', 'en_route', 'on_scene', 'transporting', 'out_of_service',
] as const;
export type EmergencyUnitStatus = typeof EMERGENCY_UNIT_STATUSES[number];

export const EMERGENCY_RESOLUTION_TYPES = [
  'treated_on_scene', 'transported', 'cancelled_by_requester',
  'false_alarm', 'duplicate', 'other',
] as const;
export type EmergencyResolutionType = typeof EMERGENCY_RESOLUTION_TYPES[number];

/**
 * Exact minimum payload keys, asserted by the worker. Adding a key here is a contract
 * change; adding one at a call site is a leak.
 */
export const EMERGENCY_EVENT_CHANGED_KEYS = [
  'emergency_event_id', 'status', 'triage_priority', 'organization_id',
] as const;

export const EMERGENCY_DISPATCH_CHANGED_KEYS = [
  'emergency_dispatch_id', 'emergency_event_id', 'emergency_unit_id', 'status',
] as const;

export const EMERGENCY_RESOLVED_KEYS = [
  'emergency_event_id', 'resolution_type', 'response_duration_seconds',
] as const;

export const BREAK_GLASS_ACTIVATED_KEYS = [
  'break_glass_grant_id', 'actor_membership_id', 'patient_profile_id',
  'emergency_event_id', 'reason_code', 'expires_at',
] as const;

export const BREAK_GLASS_TERMINATED_KEYS = [
  'break_glass_grant_id', 'termination_reason_code', 'accessed_resource_count',
] as const;
