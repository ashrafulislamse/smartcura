import type {
  AcknowledgeHealthAlertRequest,
  DeviceListResponse,
  HealthAlert,
  HealthAlertListResponse,
  IngestVitalReadingsRequest,
  TransitionHealthAlertRequest,
  VitalReadingIngestOutcome,
  VitalReadingListResponse,
} from '@/types/contracts';
import { apiRequest } from './client';

export function listOrganizationDevices(organizationId: string, signal?: AbortSignal): Promise<DeviceListResponse> {
  return apiRequest<DeviceListResponse>({ method: 'GET', path: `/organizations/${encodeURIComponent(organizationId)}/devices`, signal });
}

export function listPatientVitalReading(patientProfileId: string, options: { from?: string; to?: string; limit?: number; signal?: AbortSignal } = {}): Promise<VitalReadingListResponse> {
  const query = new URLSearchParams();
  if (options.from) query.set('from', options.from);
  if (options.to) query.set('to', options.to);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest<VitalReadingListResponse>({ method: 'GET', path: `/patients/${encodeURIComponent(patientProfileId)}/vital-readings${suffix}`, signal: options.signal });
}

/** Alias for `listPatientVitalReading` — some pages import the plural form. */
export const listPatientVitalReadings = listPatientVitalReading;

/** Reads health alerts for an actively assigned patient (doctor-only, care-assignment-gated). */
export function listPatientHealthAlerts(
  patientProfileId: string,
  options: { state?: string; pageSize?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<HealthAlertListResponse> {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  if (options.cursor) params.set('cursor', options.cursor);
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  return apiRequest<HealthAlertListResponse>({
    method: 'GET',
    path: `/patients/${encodeURIComponent(patientProfileId)}/health-alerts${suffix}`,
    signal: options.signal,
  });
}

/** Acknowledges a health alert (doctor-only, no step-up by design). */
export function acknowledgeHealthAlert(
  alertId: string,
  body: AcknowledgeHealthAlertRequest,
): Promise<HealthAlert> {
  return apiRequest<HealthAlert>({
    method: 'POST',
    path: `/health-alerts/${encodeURIComponent(alertId)}/acknowledge`,
    body,
    csrf: true,
  });
}

/** Escalates, resolves or dismisses an assigned health alert. */
export function transitionHealthAlert(
  alertId: string,
  body: TransitionHealthAlertRequest,
): Promise<HealthAlert> {
  return apiRequest<HealthAlert>({
    method: 'PUT',
    path: `/health-alerts/${encodeURIComponent(alertId)}/state`,
    body,
    csrf: true,
  });
}

/** Submits a batch of vital readings from one device (admin-on-behalf or simulator). */
export function submitDeviceVitalReadings(
  organizationId: string,
  deviceId: string,
  body: IngestVitalReadingsRequest,
  idempotencyKey: string,
): Promise<VitalReadingIngestOutcome> {
  return apiRequest<VitalReadingIngestOutcome>({
    method: 'POST',
    path: `/organizations/${encodeURIComponent(organizationId)}/devices/${encodeURIComponent(deviceId)}/vital-readings`,
    body,
    csrf: true,
    idempotencyKey,
  });
}
