/**
 * Appointments.
 *
 * SCOPE IS DERIVED FROM THE CALLER'S ROLE, not from a parameter. The repository picks exactly
 * one predicate — patient, doctor, or organization — so a patient sees their own bookings, a
 * doctor sees theirs, and an administrator sees the organization's. There is no request field
 * that widens this, which is why the page offers no scope selector.
 *
 * NAMES ARE NOT AVAILABLE HERE. An `Appointment` carries `patient_profile_id` and
 * `doctor_membership_id`, and only the doctor is resolvable — via the approved-doctor
 * directory, the one endpoint that returns another person's name. The patient is shown by
 * identifier because nothing resolves it.
 */

import type {
  Appointment,
  AppointmentListResponse,
  AppointmentMode,
  AppointmentPaymentState,
  AppointmentStatus,
  Consultation,
  ConsultationRoomToken,
  ConsultationTransitionRequest,
  UnknownEnumValue,
} from '@/types/contracts';
import { apiRequest } from './client';

export type { AppointmentMode, AppointmentPaymentState, AppointmentStatus };

type KnownStatus = Exclude<AppointmentStatus, UnknownEnumValue>;
type KnownMode = Exclude<AppointmentMode, UnknownEnumValue>;
type KnownPaymentState = Exclude<AppointmentPaymentState, UnknownEnumValue>;

/**
 * The statuses that still involve a live commitment. Named once so a page counting today's
 * workload cannot drift from the vocabulary — the mistake that made a broadcast statistic
 * read zero permanently.
 *
 * `rescheduled` is deliberately absent: the row is superseded and `replaced_by_appointment_id`
 * points at the booking that now matters, so counting it would double-count the same slot.
 */
export const ACTIVE_APPOINTMENT_STATUSES: readonly KnownStatus[] = [
  'pending_payment',
  'confirmed',
  'checked_in',
  'in_progress',
];

/** Statuses that are over, whatever the outcome. */
export const CLOSED_APPOINTMENT_STATUSES: readonly KnownStatus[] = [
  'cancelled',
  'completed',
  'no_show',
  'rescheduled',
];

export function listAppointments(
  options: { status?: AppointmentStatus; pageSize?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<AppointmentListResponse> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  if (options.cursor) params.set('cursor', options.cursor);
  const encoded = params.toString();
  return apiRequest<AppointmentListResponse>({
    method: 'GET',
    path: `/appointments${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

/**
 * Read one appointment by id. The server declines to confirm a record the caller cannot read,
 * answering 404 rather than 403, so a "not found" here may also mean "not yours".
 */
export function getAppointment(
  appointmentId: string,
  signal?: AbortSignal,
): Promise<Appointment> {
  return apiRequest<Appointment>({
    method: 'GET',
    path: `/appointments/${encodeURIComponent(appointmentId)}`,
    signal,
  });
}

export type AppointmentTransition =
  | { readonly status: 'cancelled'; readonly reason_code: string; readonly expected_version: number }
  | { readonly status: 'checked_in' | 'in_progress' | 'completed'; readonly expected_version: number }
  | { readonly status: 'no_show'; readonly reason_code: string; readonly expected_version: number };

export function transitionAppointment(
  appointmentId: string,
  body: AppointmentTransition,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Appointment> {
  return apiRequest<Appointment>({
    method: 'PUT',
    path: `/appointments/${encodeURIComponent(appointmentId)}/status`,
    body,
    csrf: true,
    idempotencyKey,
    signal,
  });
}

export function createConsultation(
  appointmentId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Consultation> {
  return apiRequest<Consultation>({
    method: 'POST',
    path: `/appointments/${encodeURIComponent(appointmentId)}/consultation`,
    csrf: true,
    idempotencyKey,
    signal,
  });
}

export function getConsultation(
  consultationId: string,
  signal?: AbortSignal,
): Promise<Consultation> {
  return apiRequest<Consultation>({
    method: 'GET',
    path: `/consultations/${encodeURIComponent(consultationId)}`,
    signal,
  });
}

export function transitionConsultation(
  consultationId: string,
  body: ConsultationTransitionRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Consultation> {
  return apiRequest<Consultation>({
    method: 'PUT',
    path: `/consultations/${encodeURIComponent(consultationId)}/status`,
    body,
    csrf: true,
    idempotencyKey,
    signal,
  });
}

export function createConsultationRoomToken(
  consultationId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ConsultationRoomToken> {
  return apiRequest<ConsultationRoomToken>({
    method: 'POST',
    path: `/consultations/${encodeURIComponent(consultationId)}/room-token`,
    csrf: true,
    idempotencyKey,
    signal,
  });
}

export const APPOINTMENT_STATUS_STYLE: Record<KnownStatus, string> = {
  pending_payment: 'bg-amber-50 text-amber-700 border-amber-100',
  confirmed: 'bg-blue-50 text-blue-700 border-blue-100',
  checked_in: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  in_progress: 'bg-purple-50 text-purple-700 border-purple-100',
  cancelled: 'bg-red-50 text-red-700 border-red-100',
  completed: 'bg-green-50 text-green-700 border-green-100',
  no_show: 'bg-orange-50 text-orange-700 border-orange-100',
  rescheduled: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const APPOINTMENT_MODE_ICON: Record<KnownMode, string> = {
  video: 'videocam',
  audio: 'call',
  chat: 'chat',
  in_person: 'person',
};

export const PAYMENT_STATE_STYLE: Record<KnownPaymentState, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-100',
  captured: 'bg-green-50 text-green-700 border-green-100',
  refunded: 'bg-slate-100 text-slate-600 border-slate-200',
  failed: 'bg-red-50 text-red-700 border-red-100',
};
