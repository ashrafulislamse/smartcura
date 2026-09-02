/**
 * WP-05 public surface: availability and appointments.
 *
 * This barrel exists only because `src/index.ts` is under concurrent edit and
 * cannot be touched by this change. It is published as the `@smartcura/database`
 * `./appointments` subpath so the API can consume WP-05 today. Once `index.ts`
 * re-exports these modules (see HANDOFF-0013.md) the subpath becomes redundant
 * and the API imports can move to the package root; nothing else changes.
 */
export {
  AvailabilityRepository,
  AVAILABILITY_CHANGED_EVENT_TYPE,
  AVAILABILITY_CHANGED_EVENT_VERSION,
  AVAILABILITY_CHANGE_KINDS,
  AVAILABILITY_EXCEPTION_REASON_CODES,
  revalidateSchedulingActor,
  serializeAvailabilityException,
  serializeAvailabilityRule,
  serializeAvailabilitySlot,
  type AvailabilityChangeKind,
  type AvailabilityExceptionReasonCode,
  type AvailabilityExceptionRecord,
  type AvailabilityRuleInput,
  type AvailabilityRuleRecord,
  type AvailabilitySlotRecord,
  type ListAvailableSlotsInput,
  type RecordAvailabilityExceptionInput,
  type RecordAvailabilityExceptionResult,
  type RecordAvailabilityExceptionSuccess,
  type ReplaceAvailabilityRulesInput,
  type ReplaceAvailabilityRulesResult,
  type ReplaceAvailabilityRulesSuccess,
  type SchedulingActor,
  type SchedulingActorContext,
  type SchedulingActorFailure,
} from './availability-repository.js';
export {
  AvailabilityScheduleRepository,
  serializeSlotGeneration,
  type AvailabilityRuleSetView,
  type AvailabilitySlotGenerationSnapshot,
  type GenerateAvailabilitySlotsInput,
  type GenerateAvailabilitySlotsResult,
  type GenerateAvailabilitySlotsSuccess,
  type SearchOpenSlotsInput,
} from './availability-schedule-repository.js';
export {
  AppointmentRepository,
  APPOINTMENT_CANCELLATION_REASON_CODES,
  APPOINTMENT_CHANGED_EVENT_TYPE,
  APPOINTMENT_CHANGED_EVENT_VERSION,
  APPOINTMENT_MODES,
  APPOINTMENT_NO_SHOW_REASON_CODES,
  APPOINTMENT_STATUSES,
  appointmentTransitionAllowed,
  serializeAppointment,
  type AppointmentCancellationReasonCode,
  type AppointmentMode,
  type AppointmentNoShowReasonCode,
  type AppointmentPaymentWorkItem,
  type AppointmentRecord,
  type AppointmentResponseSnapshot,
  type AppointmentStatus,
  type BookAppointmentInput,
  type BookAppointmentResult,
  type HoldSlotInput,
  type HoldSlotResult,
  type ListAppointmentsInput,
  type RescheduleAppointmentInput,
  type RescheduleAppointmentResult,
  type SettleAppointmentPaymentInput,
  type SettleAppointmentPaymentResult,
  type SlotHoldRecord,
  type UpdateAppointmentStatusInput,
  type UpdateAppointmentStatusResult,
} from './appointment-repository.js';
export * from './schema-appointments.js';

export {
  APPOINTMENT_PAYMENT_REQUESTED_EVENT_TYPE,
  APPOINTMENT_PAYMENT_REQUESTED_EVENT_VERSION,
} from './appointment-payment-events.js';
