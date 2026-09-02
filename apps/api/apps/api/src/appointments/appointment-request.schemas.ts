import { z } from 'zod';
import {
  APPOINTMENT_CANCELLATION_REASON_CODES,
  APPOINTMENT_MODES,
  APPOINTMENT_NO_SHOW_REASON_CODES,
  APPOINTMENT_STATUSES,
  AVAILABILITY_EXCEPTION_REASON_CODES,
} from '@smartcura/database/appointments';

const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

/** `HH:MM` or `HH:MM:SS` local wall-clock time, as stored in a `time` column. */
const localTime = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/);

/** Calendar date with no zone, validated as a real date rather than a shape. */
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
});

/**
 * Absolute instant with an explicit offset. A bare local timestamp is rejected:
 * a slot window means nothing without a zone, and guessing the server's zone
 * would shift every returned slot for a client in another one.
 */
const instant = z.string().min(20).max(40).refine((value) => {
  if (!/[Zz]$|[+-][01][0-9]:[0-5][0-9]$/.test(value)) return false;
  return Number.isFinite(new Date(value).getTime());
});

export const idempotencyKeySchema = z.string().trim().min(16).max(128)
  .regex(/^[A-Za-z0-9._~-]+$/);

export const membershipPathSchema = z.object({
  membershipId: uuidV7,
}).strict();

export const organizationPathSchema = z.object({
  organizationId: uuidV7,
}).strict();

export const slotPathSchema = z.object({
  slotId: uuidV7,
}).strict();

export const appointmentPathSchema = z.object({
  appointmentId: uuidV7,
}).strict();

const minutesOfDay = (value: string): number => {
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
};

export const availabilityRuleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start_time: localTime,
  end_time: localTime,
  slot_duration_minutes: z.number().int().min(5).max(240),
  timezone: z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+._-]+)*$/),
  effective_from: calendarDate,
  effective_to: calendarDate.nullable().default(null),
}).strict()
  // The same three window invariants the database enforces, checked here so a
  // malformed rule set is a 422 with a field context rather than a constraint
  // violation surfacing as a 500.
  .refine((rule) => minutesOfDay(rule.end_time) > minutesOfDay(rule.start_time))
  .refine((rule) =>
    (minutesOfDay(rule.end_time) - minutesOfDay(rule.start_time)) %
      rule.slot_duration_minutes === 0)
  .refine((rule) => rule.effective_to === null || rule.effective_to >= rule.effective_from);

/**
 * A full replacement of the doctor's rule set. PUT semantics are deliberate: a
 * partial patch over a recurrence set has no safe merge rule, and two clients
 * patching different days would each believe they owned the schedule.
 */
export const replaceAvailabilityRulesSchema = z.object({
  rules: z.array(availabilityRuleSchema).max(50),
  expected_version: z.number().int().min(0),
  horizon_days: z.number().int().min(1).max(120).default(28),
}).strict();

export const recordAvailabilityExceptionSchema = z.object({
  exception_date: calendarDate,
  is_unavailable: z.boolean(),
  replacement_start_time: localTime.nullable().default(null),
  replacement_end_time: localTime.nullable().default(null),
  reason_code: z.enum(AVAILABILITY_EXCEPTION_REASON_CODES),
  expected_version: z.number().int().min(0),
}).strict()
  .refine((exception) => exception.is_unavailable
    ? exception.replacement_start_time === null && exception.replacement_end_time === null
    : exception.replacement_start_time !== null && exception.replacement_end_time !== null)
  .refine((exception) =>
    exception.replacement_start_time === null || exception.replacement_end_time === null ||
    minutesOfDay(exception.replacement_end_time) >
      minutesOfDay(exception.replacement_start_time));

/** Whole days between two calendar dates, both parsed as UTC midnight. */
const daySpan = (from: string, to: string): number =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/**
 * Regenerates the slot horizon over a stated inclusive date range. The span is
 * capped at the same 120 days a rule replacement may generate, so this endpoint
 * cannot materialise more capacity than the path that defines it.
 */
export const generateAvailabilitySlotsSchema = z.object({
  from_date: calendarDate,
  to_date: calendarDate,
}).strict()
  .refine((range) => daySpan(range.from_date, range.to_date) >= 0)
  .refine((range) => daySpan(range.from_date, range.to_date) <= 120);

/** Window cap for an organization-wide slot search, in milliseconds. */
const MAX_SLOT_SEARCH_WINDOW_MS = 62 * 86_400_000;

/**
 * Bookable slot search across an organization, optionally narrowed to one
 * doctor. The window is bounded because, unlike a single doctor's schedule, an
 * unbounded organization-wide range has no natural size and one request could
 * scan every slot the platform holds.
 */
export const searchAppointmentSlotsQuerySchema = z.object({
  membership_id: uuidV7.optional(),
  from: instant,
  to: instant,
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
}).strict()
  .refine((query) => new Date(query.to) > new Date(query.from))
  .refine((query) =>
    new Date(query.to).getTime() - new Date(query.from).getTime() <=
      MAX_SLOT_SEARCH_WINDOW_MS);

/**
 * Own-schedule slot read over a bounded window. Same window cap as the
 * organization-wide search: an unbounded own-schedule range has no natural
 * size and one request could scan every slot the doctor holds. Unlike the
 * organization search, no `membership_id` filter is needed — the path already
 * names the membership — and every slot state is returned, not just `open`,
 * because a doctor reviewing their own schedule needs to see held, booked and
 * closed slots as they actually are.
 */
export const listOwnAvailabilitySlotsQuerySchema = z.object({
  from: instant,
  to: instant,
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
}).strict()
  .refine((query) => new Date(query.to) > new Date(query.from))
  .refine((query) =>
    new Date(query.to).getTime() - new Date(query.from).getTime() <=
      MAX_SLOT_SEARCH_WINDOW_MS);

export const bookAppointmentSchema = z.object({
  slot_id: uuidV7,
  mode: z.enum(APPOINTMENT_MODES),
}).strict();

export const listAppointmentsQuerySchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  cursor: z.string().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

/**
 * Status changes carry a structured reason code per target state, never operator
 * free text, and never a code that belongs to a different outcome. `completed`
 * takes no reason at all: the database forbids one, because a completed
 * appointment has nothing to explain.
 */
export const updateAppointmentStatusSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('cancelled'),
    reason_code: z.enum(APPOINTMENT_CANCELLATION_REASON_CODES),
    expected_version: z.number().int().min(0),
  }).strict(),
  z.object({
    status: z.literal('checked_in'),
    expected_version: z.number().int().min(0),
  }).strict(),
  z.object({
    status: z.literal('in_progress'),
    expected_version: z.number().int().min(0),
  }).strict(),
  z.object({
    status: z.literal('no_show'),
    reason_code: z.enum(APPOINTMENT_NO_SHOW_REASON_CODES),
    expected_version: z.number().int().min(0),
  }).strict(),
  z.object({
    status: z.literal('completed'),
    expected_version: z.number().int().min(0),
  }).strict(),
]);

export const rescheduleAppointmentSchema = z.object({
  slot_id: uuidV7,
  mode: z.enum(APPOINTMENT_MODES).nullable().default(null),
  expected_version: z.number().int().min(0),
}).strict();

export type MembershipPath = z.infer<typeof membershipPathSchema>;
export type OrganizationPath = z.infer<typeof organizationPathSchema>;
export type ReplaceAvailabilityRulesRequest = z.infer<typeof replaceAvailabilityRulesSchema>;
export type RecordAvailabilityExceptionRequest = z.infer<typeof recordAvailabilityExceptionSchema>;
export type GenerateAvailabilitySlotsRequest = z.infer<typeof generateAvailabilitySlotsSchema>;
export type SearchAppointmentSlotsQuery = z.infer<typeof searchAppointmentSlotsQuerySchema>;
export type ListOwnAvailabilitySlotsQuery = z.infer<typeof listOwnAvailabilitySlotsQuerySchema>;
export type BookAppointmentRequest = z.infer<typeof bookAppointmentSchema>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
export type UpdateAppointmentStatusRequest = z.infer<typeof updateAppointmentStatusSchema>;
export type RescheduleAppointmentRequest = z.infer<typeof rescheduleAppointmentSchema>;
