'use client';

/**
 * Emergency map — location-focused view of active emergencies, wired to GET /emergencies.
 *
 * NO MAP LIBRARY IS INSTALLED (no leaflet, no mapbox-gl in package.json). Rather than
 * drawing fake map tiles with hardcoded pins — which is what the mock did — this page
 * presents the same real data the queue carries, organised by location. Each card shows
 * the address, coordinates, priority, status, and elapsed waiting time, and links to the
 * dispatch command page. A visual map is a follow-up that requires adding a dependency.
 *
 * RECONCILIATION WITH THE MOCK: the mock carried patient names ("Jane Doe", "John Smith"),
 * fake unit pins ("Unit A-42"), live vitals ("Patient HR 120 bpm"), invented distances
 * ("1.2 miles"), and a hospital capacity panel. None of that is available:
 *   - the list carries `patient_profile_id` only, and no endpoint resolves a name;
 *   - distance cannot be computed without PostGIS (no spatial index);
 *   - vitals are deliberately excluded from the queue (PHI exposure);
 *   - no endpoint enumerates units or hospital capacity.
 * What replaces them is the real address and coordinates the event carries, plus the
 * actual stage and waiting time — the same honest data the live queue shows.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import {
  PRIORITY_STYLE,
  STATUS_STYLE,
  TERMINAL_STATUSES,
  coordinates,
  formatDuration,
  humaniseCode,
  listEmergencyEvents,
  minutesSince,
  shortId,
  type TriagePriority,
} from '@/lib/api/emergency';

const PRIORITIES: ReadonlyArray<{ key: 'all' | TriagePriority; label: string }> = [
  { key: 'all', label: 'All priorities' },
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
  { key: 'unknown', label: 'Not triaged' },
];

export default function EmergencyMapPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [priority, setPriority] = useState<'all' | TriagePriority>('all');

  const { data, isLoading, error, reload } = useApiResource(
    (signal) =>
      listEmergencyEvents({
        triagePriority: priority === 'all' ? undefined : priority,
        activeOnly: true,
        limit: 100,
        signal,
      }),
    [priority],
  );

  const events = useMemo(() => data?.data ?? [], [data]);

  // Events that carry location data, separated from those that do not.
  const located = useMemo(() => events.filter((e) => coordinates(e.latitude, e.longitude) !== null), [events]);
  const unlocated = useMemo(() => events.filter((e) => coordinates(e.latitude, e.longitude) === null), [events]);

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Emergency' }, { label: 'Response map' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                Response Map
              </h1>
              <p className="text-slate-500 mt-1">
                Active emergencies by location. No map tiles — real addresses and coordinates.
              </p>
            </div>
            <button
              onClick={reload}
              className="px-4 py-2.5 border border-slate-200 bg-white rounded-lg font-bold text-sm text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((option) => (
              <button
                key={option.key}
                onClick={() => setPriority(option.key)}
                className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  priority === option.key
                    ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={events.length === 0}
            onRetry={reload}
            loadingLabel="Loading active emergencies…"
            forbiddenTitle="You cannot view the emergency map"
            errorTitle="Could not load emergencies"
            emptyTitle="No active emergencies"
            emptyBody="Resolved and cancelled events are in the log."
            emptyIcon="map"
          />

          {!isLoading && !error && located.length > 0 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-bold text-slate-900">
                Located events
                <span className="text-sm font-normal text-slate-500 ml-2">{located.length}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {located.map((event) => {
                  const waiting = minutesSince(event.created_at);
                  const position = coordinates(event.latitude, event.longitude);
                  return (
                    <button
                      key={event.emergency_event_id}
                      onClick={() => router.push(`/emergency/dispatch/${event.emergency_event_id}`)}
                      className={`text-left bg-white rounded-xl border shadow-sm p-5 hover:shadow-md transition-shadow ${
                        event.triage_priority === 'critical' ? 'border-red-300' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                            PRIORITY_STYLE[event.triage_priority] ?? PRIORITY_STYLE.unknown
                          }`}
                        >
                          {humaniseCode(event.triage_priority)}
                        </span>
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                            STATUS_STYLE[event.status] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                          }`}
                        >
                          {humaniseCode(event.status)}
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {humaniseCode(event.category_code)}
                        </span>
                      </div>

                      <div className="flex items-start gap-2 mb-2">
                        <span className="material-symbols-outlined text-[20px] text-slate-400 mt-0.5">
                          location_on
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-700 font-medium">
                            {event.address_text ?? 'No address recorded'}
                          </p>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">{position}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                        <p className="text-xs text-slate-400">
                          {/* An identifier, not a name: no endpoint resolves a profile name. */}
                          patient {shortId(event.patient_profile_id)}
                        </p>
                        <div className="text-right">
                          <span className="text-xs font-bold text-slate-500">Waiting</span>
                          <p
                            className={`text-lg font-bold ${
                              (waiting ?? 0) > 30 ? 'text-red-700' : 'text-slate-900'
                            }`}
                          >
                            {formatDuration(waiting)}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!isLoading && !error && unlocated.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-bold text-slate-900">
                No location data
                <span className="text-sm font-normal text-slate-500 ml-2">{unlocated.length}</span>
              </h2>
              <p className="text-sm text-slate-500">
                These events were raised without coordinates or an address. They are still active
                and appear in the queue.
              </p>
              <div className="flex flex-col gap-2">
                {unlocated.map((event) => (
                  <button
                    key={event.emergency_event_id}
                    onClick={() => router.push(`/emergency/dispatch/${event.emergency_event_id}`)}
                    className="text-left bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                          PRIORITY_STYLE[event.triage_priority] ?? PRIORITY_STYLE.unknown
                        }`}
                      >
                        {humaniseCode(event.triage_priority)}
                      </span>
                      <span className="text-sm font-bold text-slate-900">
                        {humaniseCode(event.category_code)}
                      </span>
                      <span className="text-xs text-slate-400">
                        · patient {shortId(event.patient_profile_id)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isLoading && !error && events.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{events.length}</span> active event
              {events.length === 1 ? '' : 's'}
              {located.length < events.length && ` · ${located.length} with location data`}
              {events.length === 100 && ' (server limit reached; filter by priority)'}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
