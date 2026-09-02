/**
 * Doctor-scoped summary, analytics, device and earnings surfaces.
 *
 * SCOPE IS THE CALLER'S ACTIVE DOCTOR MEMBERSHIP, never a parameter. The backend resolves
 * the doctor from the session, so every function below is `/doctor/*` and takes no
 * organization or site id. This is the point: the previous dashboard and IoT pages reached
 * for `/admin/metrics` (organization-wide) and `/organizations/:id/devices` (every device
 * in the org), which a doctor membership is not entitled to read and which would have shown
 * other doctors' patients even if it were. These endpoints project exactly the caller's
 * caseload.
 *
 * EVERY GROUP IS OPTIONAL, and that is the whole point of the shape. A group whose backing
 * query fails is OMITTED rather than returned as zero, because a zero would assert something
 * false (the count is known to be zero) while still revealing that the group exists.
 * `readable_groups` names the fields that were successfully computed, so a page can tell a
 * refused group from one this build does not implement — and a card whose group is absent
 * is hidden, not shown as "0".
 *
 * MONEY IS INTEGER SEN throughout. `formatSen` from `./finance` is the only place a display
 * string is produced, so a rounding choice cannot quietly differ between two pages showing
 * the same figure.
 */

import type {
  DeviceState,
  DeviceType,
  DoctorAnalyticsResponse,
  DoctorDashboardResponse,
  DoctorDeviceList,
  DoctorEarnings,
} from '@/types/contracts';
import { apiRequest } from './client';

/**
 * The dashboard group names the backend may report in `readable_groups`, mirrored here purely
 * so a page can EXPLAIN an absence (a card whose group is missing) rather than silently hide
 * it. Declared once as an `as const` array so the label map below is exhaustive: an invented
 * group name cannot compile, which is the mistake that let `not_required` and `pending` slip
 * in elsewhere.
 */
export const DOCTOR_DASHBOARD_GROUPS = [
  'today_appointments',
  'upcoming_appointments',
  'assigned_patients',
  'pending_notes',
  'unread_notifications',
  'active_iot_alerts',
] as const;

export type DoctorDashboardGroup = (typeof DOCTOR_DASHBOARD_GROUPS)[number];

export const DOCTOR_DASHBOARD_GROUP_LABEL: Record<DoctorDashboardGroup, string> = {
  today_appointments: "Today's appointments",
  upcoming_appointments: 'Upcoming appointments',
  assigned_patients: 'Assigned patients',
  pending_notes: 'Pending notes',
  unread_notifications: 'Unread notifications',
  active_iot_alerts: 'Active IoT alerts',
};

/**
 * The analytics group names, declared for the same reason as the dashboard ones: an exhaustive
 * label map so a missing projection is explained rather than silently omitted.
 */
export const DOCTOR_ANALYTICS_GROUPS = [
  'appointment_status_breakdown',
  'patient_count_trend',
  'rating_summary',
  'monthly_earnings_projection',
] as const;

export type DoctorAnalyticsGroup = (typeof DOCTOR_ANALYTICS_GROUPS)[number];

export const DOCTOR_ANALYTICS_GROUP_LABEL: Record<DoctorAnalyticsGroup, string> = {
  appointment_status_breakdown: 'Appointment status breakdown',
  patient_count_trend: 'Patient count trend',
  rating_summary: 'Rating summary',
  monthly_earnings_projection: 'Monthly earnings projection',
};

/** Aggregate summary for the active doctor. GET /doctor/dashboard. */
export function readDoctorDashboard(signal?: AbortSignal): Promise<DoctorDashboardResponse> {
  return apiRequest<DoctorDashboardResponse>({ method: 'GET', path: '/doctor/dashboard', signal });
}

/** 30-day analytics for the active doctor. GET /doctor/analytics. */
export function readDoctorAnalytics(signal?: AbortSignal): Promise<DoctorAnalyticsResponse> {
  return apiRequest<DoctorAnalyticsResponse>({ method: 'GET', path: '/doctor/analytics', signal });
}

/**
 * IoT devices assigned to the doctor's active patients only. GET /doctor/devices.
 *
 * This is NOT the organization-wide device list. The backend filters to devices whose active
 * assignment belongs to a patient the caller's doctor membership is assigned to, so a doctor
 * never sees another doctor's patients' devices.
 */
export function listDoctorDevices(
  options: {
    state?: DeviceState;
    deviceType?: DeviceType;
    cursor?: string;
    pageSize?: number;
    signal?: AbortSignal;
  } = {},
): Promise<DoctorDeviceList> {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.deviceType) params.set('device_type', options.deviceType);
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const encoded = params.toString();
  return apiRequest<DoctorDeviceList>({
    method: 'GET',
    path: `/doctor/devices${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

/**
 * The current doctor's payout balance and recent payout items. GET /doctor/earnings.
 *
 * `balance_sen` and `total_earned_sen` are projections from the postings; no stored balance
 * exists to disagree with them. The items are the doctor's rows from payout runs, not the
 * driver-withdrawal surface the previous page reached for.
 */
export function readDoctorEarnings(
  options: { cursor?: string; pageSize?: number; signal?: AbortSignal } = {},
): Promise<DoctorEarnings> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const encoded = params.toString();
  return apiRequest<DoctorEarnings>({
    method: 'GET',
    path: `/doctor/earnings${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}
