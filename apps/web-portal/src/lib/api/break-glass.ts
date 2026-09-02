/**
 * Emergency break-glass surface.
 *
 * Break-glass is the emergency PHI disclosure mechanism: an operator activates
 * a grant tied to an emergency event, which authorises reading the patient's
 * record, vitals and health alerts WITHOUT prior consent — because the
 * emergency makes obtaining consent impractical. Every access is audited, and
 * the grant has a bounded expiry the caller must respect.
 *
 * The activate endpoint is the only mutation that mints a grant; the patient
 * record, vitals and alerts are read-only surfaces scoped to the grant id.
 * The grant is terminated by a separate status transition.
 *
 * All responses are no-store at the backend; this client adds no caching.
 */

import type {
  ActivateBreakGlassRequest,
  BreakGlassDisclosure,
  BreakGlassGrant,
  BreakGlassReviewed,
  BreakGlassTerminated,
  HealthAlertListResponse,
  HealthAlertState,
  ReviewBreakGlassRequest,
  TerminateBreakGlassRequest,
  VitalMetric,
  VitalReadingListResponse,
} from '@/types/contracts';
import { apiRequest } from './client';

/**
 * Activate a break-glass grant for an emergency event.
 * POST /break-glass/grants.
 */
export function activateBreakGlass(body: ActivateBreakGlassRequest): Promise<BreakGlassGrant> {
  return apiRequest<BreakGlassGrant>({
    method: 'POST',
    path: '/break-glass/grants',
    body,
    csrf: true,
  });
}

/**
 * Read the patient record disclosed under a break-glass grant.
 * GET /break-glass/grants/{grantId}/patient-record.
 */
export function readBreakGlassPatientRecord(grantId: string, signal?: AbortSignal): Promise<BreakGlassDisclosure> {
  return apiRequest<BreakGlassDisclosure>({
    method: 'GET',
    path: `/break-glass/grants/${encodeURIComponent(grantId)}/patient-record`,
    signal,
  });
}

/**
 * Read vital readings disclosed under a break-glass grant.
 * GET /break-glass/grants/{grantId}/vital-readings.
 */
export function readBreakGlassVitals(
  grantId: string,
  options: {
    metric?: VitalMetric;
    from?: string;
    to?: string;
    cursor?: string;
    pageSize?: number;
    signal?: AbortSignal;
  } = {},
): Promise<VitalReadingListResponse> {
  const params = new URLSearchParams();
  if (options.metric) params.set('metric', options.metric);
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const encoded = params.toString();
  return apiRequest<VitalReadingListResponse>({
    method: 'GET',
    path: `/break-glass/grants/${encodeURIComponent(grantId)}/vital-readings${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

/**
 * Read health alerts disclosed under a break-glass grant.
 * GET /break-glass/grants/{grantId}/health-alerts.
 */
export function readBreakGlassAlerts(
  grantId: string,
  options: {
    state?: HealthAlertState;
    cursor?: string;
    pageSize?: number;
    signal?: AbortSignal;
  } = {},
): Promise<HealthAlertListResponse> {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const encoded = params.toString();
  return apiRequest<HealthAlertListResponse>({
    method: 'GET',
    path: `/break-glass/grants/${encodeURIComponent(grantId)}/health-alerts${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

/**
 * Terminate a break-glass grant early.
 * PUT /break-glass/grants/{grantId}/status.
 */
export function terminateBreakGlass(grantId: string, body: TerminateBreakGlassRequest): Promise<BreakGlassTerminated> {
  return apiRequest<BreakGlassTerminated>({
    method: 'PUT',
    path: `/break-glass/grants/${encodeURIComponent(grantId)}/status`,
    body,
    csrf: true,
  });
}

/**
 * Records a retrospective review of a break-glass grant (admin). The outcome is one of
 * `justified`, `unjustified` or `inconclusive`, with free-text notes. Disjoint from
 * activation and termination — this is the post-hoc oversight decision.
 * POST /break-glass/grants/{grantId}/review.
 */
export function reviewBreakGlassGrant(grantId: string, body: ReviewBreakGlassRequest): Promise<BreakGlassReviewed> {
  return apiRequest<BreakGlassReviewed>({
    method: 'POST',
    path: `/break-glass/grants/${encodeURIComponent(grantId)}/review`,
    body,
    csrf: true,
  });
}
