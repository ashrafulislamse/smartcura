/**
 * Emergency dispatch surface: the live queue and the historical log.
 *
 * WHAT THE QUEUE DELIBERATELY DOES NOT CARRY, and why it matters for the pages built on it:
 *
 * - NO VITALS. A vitals snapshot is a per-event read. Embedding it in a queue would widen
 *   PHI exposure to every row an operator merely scrolls past, for no dispatch benefit.
 * - NO DISTANCE. Proximity cannot be computed at all: the pinned PostgreSQL image ships no
 *   PostGIS, so coordinates are bounded numerics and there is no spatial index. Showing a
 *   distance would mean inventing one. Coordinates and the address text are shown instead.
 * - NO PATIENT NAME. Only `patient_profile_id`, and no endpoint resolves a profile name.
 *
 * ORDERING IS THE SERVER'S. Active events first, then critical before low, then oldest
 * first within a priority. Do not re-sort by recency in a page: that would put a new
 * low-priority call above a critical one that has been waiting, which is the opposite of
 * triage and the reason the ordering exists.
 */

import type {
  AdvanceEmergencyRequest,
  CommunicationRecorded,
  EmergencyDispatchCreated,
  EmergencyEventList,
  EmergencyEventView,
  EmergencyResolution,
  EmergencyUnitList,
  EmergencyUnitStatus,
  RecordCommunicationRequest,
  RecordTriageRequest,
  ReserveUnitRequest,
  ResolveEmergencyRequest,
  TriageRecorded,
} from '@/types/contracts';
import { apiRequest } from './client';

export type { EmergencyUnitStatus };

export type EmergencyEventStatus =
  | 'created'
  | 'triaged'
  | 'dispatching'
  | 'unit_assigned'
  | 'responding'
  | 'on_scene'
  | 'transporting'
  | 'resolved'
  | 'cancelled'
  | 'false_alarm';

export type TriagePriority = 'unknown' | 'low' | 'medium' | 'high' | 'critical';

/** Statuses where the event is over. Mirrors the server's `active_only` predicate. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'resolved',
  'cancelled',
  'false_alarm',
]);

export function listEmergencyEvents(
  options: {
    status?: EmergencyEventStatus;
    triagePriority?: TriagePriority;
    /** Server default is true. Pass false for the historical log. */
    activeOnly?: boolean;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<EmergencyEventList> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.triagePriority) params.set('triage_priority', options.triagePriority);
  if (options.activeOnly !== undefined) params.set('active_only', String(options.activeOnly));
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const encoded = params.toString();
  return apiRequest<EmergencyEventList>({
    method: 'GET',
    path: `/emergencies${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

export function listEmergencyUnits(
  options: { status?: EmergencyUnitStatus; limit?: number; signal?: AbortSignal } = {},
): Promise<EmergencyUnitList> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const encoded = params.toString();
  return apiRequest<EmergencyUnitList>({
    method: 'GET',
    path: `/emergency-units${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

/** Minutes between two instants, or null when either is absent. */
export function readEmergencyEvent(eventId: string, signal?: AbortSignal): Promise<EmergencyEventView> {
  return apiRequest<EmergencyEventView>({ method: 'GET', path: `/emergencies/${encodeURIComponent(eventId)}`, signal });
}

export function recordTriage(eventId: string, body: RecordTriageRequest): Promise<TriageRecorded> {
  return apiRequest<TriageRecorded>({ method: 'POST', path: `/emergencies/${encodeURIComponent(eventId)}/triage`, body, csrf: true });
}

export function reserveEmergencyUnit(eventId: string, body: ReserveUnitRequest): Promise<EmergencyDispatchCreated> {
  return apiRequest<EmergencyDispatchCreated>({ method: 'POST', path: `/emergencies/${encodeURIComponent(eventId)}/dispatch`, body, csrf: true });
}

export function advanceEmergency(eventId: string, body: AdvanceEmergencyRequest): Promise<import('@/types/contracts').EmergencyEventState> {
  return apiRequest({ method: 'PUT', path: `/emergencies/${encodeURIComponent(eventId)}/status`, body, csrf: true });
}

export function resolveEmergency(eventId: string, body: ResolveEmergencyRequest): Promise<EmergencyResolution> {
  return apiRequest<EmergencyResolution>({ method: 'POST', path: `/emergencies/${encodeURIComponent(eventId)}/resolution`, body, csrf: true });
}

export function recordEmergencyCommunication(eventId: string, body: RecordCommunicationRequest): Promise<CommunicationRecorded> {
  return apiRequest<CommunicationRecorded>({ method: 'POST', path: `/emergencies/${encodeURIComponent(eventId)}/communications`, body, csrf: true });
}

export function minutesBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 60_000);
}

/** Minutes elapsed since an instant. Used for events that are still open. */
export function minutesSince(from: string): number | null {
  const start = Date.parse(from);
  if (Number.isNaN(start)) return null;
  return Math.round((Date.now() - start) / 60_000);
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * A coordinate pair as a plain string, or null when either half is missing.
 *
 * Half a pair is not a location, which is why the schema permits both to be null together
 * but a page must not render one on its own.
 */
export function coordinates(latitude: string | null, longitude: string | null): string | null {
  if (!latitude || !longitude) return null;
  return `${latitude}, ${longitude}`;
}

export function humaniseCode(code: string): string {
  return code.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

export function shortId(value: string | null): string {
  return value ? value.slice(0, 8) : '—';
}

export function formatInstant(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

export const PRIORITY_STYLE: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-100',
  high: 'bg-orange-50 text-orange-700 border-orange-100',
  medium: 'bg-amber-50 text-amber-700 border-amber-100',
  low: 'bg-slate-50 text-slate-700 border-slate-100',
  unknown: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const STATUS_STYLE: Record<string, string> = {
  created: 'bg-red-50 text-red-700 border-red-100',
  triaged: 'bg-orange-50 text-orange-700 border-orange-100',
  dispatching: 'bg-amber-50 text-amber-700 border-amber-100',
  unit_assigned: 'bg-blue-50 text-blue-700 border-blue-100',
  responding: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  on_scene: 'bg-purple-50 text-purple-700 border-purple-100',
  transporting: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  resolved: 'bg-green-50 text-green-700 border-green-100',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  false_alarm: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const UNIT_STATUS_STYLE: Record<string, string> = {
  available: 'bg-green-50 text-green-700 border-green-100',
  reserved: 'bg-blue-50 text-blue-700 border-blue-100',
  en_route: 'bg-amber-50 text-amber-700 border-amber-100',
  on_scene: 'bg-purple-50 text-purple-700 border-purple-100',
  transporting: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  out_of_service: 'bg-slate-100 text-slate-600 border-slate-200',
};
