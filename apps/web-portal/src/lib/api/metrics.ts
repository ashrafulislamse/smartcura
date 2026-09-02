/**
 * Dashboard aggregates, backed by GET /admin/metrics.
 *
 * EVERY GROUP IS OPTIONAL, and that is the whole point of the shape. A group the caller lacks
 * permission for is ABSENT rather than zero, because a zero would assert something false while
 * still revealing that the group exists, and would be indistinguishable from a genuinely empty
 * organization. `readable_groups` names what is present so a page can tell a refused group from
 * one this build does not implement.
 *
 * There is no "today" here. A calendar day needs a timezone and an organization stores none, so
 * the window is the next 24 hours — unambiguous, and the more useful figure operationally.
 */

import type { AdminMetricsResponse } from '@/types/contracts';
import { apiRequest } from './client';

export type MetricGroup = 'appointments' | 'emergencies' | 'support' | 'doctors' | 'revenue';

export function readAdminMetrics(signal?: AbortSignal): Promise<AdminMetricsResponse> {
  return apiRequest<AdminMetricsResponse>({ method: 'GET', path: '/admin/metrics', signal });
}

/**
 * The permission each group needs, mirrored from the service purely so the page can EXPLAIN an
 * absence rather than silently omit a card. It is not used to decide anything — the server
 * already decided, and duplicating that decision here would be a second source of truth.
 */
export const GROUP_PERMISSION: Record<MetricGroup, string> = {
  appointments: 'appointment:read:organization',
  emergencies: 'emergency.event:read:site',
  support: 'support.ticket:manage:organization',
  doctors: 'doctor_detail:read:global',
  revenue: 'ledger:read:organization',
};

export const GROUP_LABEL: Record<MetricGroup, string> = {
  appointments: 'Appointments',
  emergencies: 'Emergencies',
  support: 'Support',
  doctors: 'Doctors',
  revenue: 'Revenue',
};
