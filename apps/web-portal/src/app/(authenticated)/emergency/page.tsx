'use client';

/**
 * Live emergency dispatch queue, wired to GET /emergencies.
 *
 * THE ORDER IS THE SERVER'S AND MUST NOT BE CHANGED. Active events first, then critical
 * before low, then oldest first within a priority. Re-sorting by recency would put a new
 * low-priority call above a critical one that has been waiting, which is the opposite of
 * triage. The list is rendered exactly as returned.
 *
 * RECONCILIATION WITH THE MOCK, recorded because two removals are substantive rather than
 * cosmetic. `mockEmergencyCalls` carried a patient NAME and avatar, a DISTANCE, and live
 * VITALS. None of the three is available:
 *   - the queue carries `patient_profile_id` only, and no endpoint resolves a profile name;
 *   - distance cannot be computed at all, because the pinned PostgreSQL image ships no
 *     PostGIS and there is no spatial index — showing one would mean inventing it;
 *   - vitals are deliberately excluded from the queue, since embedding a snapshot would
 *     expose PHI for every row an operator scrolls past.
 *
 * What replaces them is better for dispatch: real elapsed time since the call was raised,
 * and the actual stage the event has reached.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  PRIORITY_STYLE,
  STATUS_STYLE,
  coordinates,
  formatDuration,
  humaniseCode,
  listEmergencyEvents,
  minutesBetween,
  minutesSince,
  shortId,
  type TriagePriority,
} from '@/lib/api/emergency';
import TopBar from '@/components/layout/TopBar';

const PRIORITIES: ReadonlyArray<{ key: 'all' | TriagePriority; label: string }> = [
  { key: 'all', label: 'All priorities' },
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
  { key: 'unknown', label: 'Not triaged' },
];

export default function EmergencyQueuePage() {
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

  // Rendered in server order. No client sort.
  const events = useMemo(() => data?.data ?? [], [data]);

  const critical = useMemo(
    () => events.filter((event) => event.triage_priority === 'critical').length,
    [events],
  );
  const awaitingTriage = useMemo(
    () => events.filter((event) => event.triaged_at === null).length,
    [events],
  );
  const awaitingDispatch = useMemo(
    () => events.filter((event) => event.dispatched_at === null).length,
    [events],
  );

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Emergency' }, { label: 'Live queue' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                Emergency Queue
              </h1>
              <p className="text-slate-500 mt-1">
                Ordered by clinical urgency, oldest first within a priority. Not by recency.
              </p>
            </div>
            <button
              onClick={reload}
              className="px-4 py-2.5 border border-slate-200 bg-white rounded-lg font-bold text-sm text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'emergency', tint: 'text-red-600', label: 'Critical', value: String(critical), note: 'Highest triage priority' },
              { icon: 'help', tint: 'text-orange-600', label: 'Untriaged', value: String(awaitingTriage), note: 'No triage recorded yet' },
              { icon: 'local_shipping', tint: 'text-amber-600', label: 'Undispatched', value: String(awaitingDispatch), note: 'No unit sent yet' },
            ].map((card) => (
              <div key={card.label} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className={`material-symbols-outlined ${card.tint} text-2xl`}>{card.icon}</span>
                  <span className="text-xs font-bold text-slate-500">{card.label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">{isLoading ? '—' : card.value}</p>
                <p className="text-xs text-slate-500 mt-1">{card.note}</p>
              </div>
            ))}
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
            loadingLabel="Loading the dispatch queue…"
            forbiddenTitle="You cannot view the emergency queue"
            errorTitle="Could not load the dispatch queue"
            emptyTitle="No active emergencies"
            emptyBody="Resolved and cancelled events are in the log."
            emptyIcon="check_circle"
          />

          {!isLoading && !error && events.length > 0 && (
            <div className="flex flex-col gap-3">
              {events.map((event) => {
                const waiting = minutesSince(event.created_at);
                const toDispatch = minutesBetween(event.created_at, event.dispatched_at);
                const position = coordinates(event.latitude, event.longitude);
                return (
                  <button
                    key={event.emergency_event_id}
                    onClick={() => router.push(`/emergency/dispatch/${event.emergency_event_id}`)}
                    className={`text-left bg-white rounded-xl border shadow-sm p-5 hover:shadow-md transition-shadow ${
                      event.triage_priority === 'critical' ? 'border-red-300' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex-1 min-w-[260px]">
                        <div className="flex items-center gap-2 flex-wrap">
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

                        <p className="text-sm text-slate-600 mt-2">
                          {event.address_text ?? (position ? `Coordinates ${position}` : 'No location recorded')}
                        </p>
                        {event.address_text && position && (
                          <p className="text-xs text-slate-400 mt-0.5">{position}</p>
                        )}

                        <p className="text-xs text-slate-400 mt-2">
                          {/* An identifier, not a name: no endpoint resolves a profile name. */}
                          patient {shortId(event.patient_profile_id)} · reported by{' '}
                          {shortId(event.reported_by_profile_id)}
                          {event.reason_code ? ` · ${event.reason_code}` : ''}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-xs font-bold text-slate-500">Waiting</p>
                        <p
                          className={`text-2xl font-bold ${
                            (waiting ?? 0) > 30 ? 'text-red-700' : 'text-slate-900'
                          }`}
                        >
                          {formatDuration(waiting)}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          {event.dispatched_at
                            ? `dispatched in ${formatDuration(toDispatch)}`
                            : 'not dispatched'}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!isLoading && !error && events.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{events.length}</span> active event
              {events.length === 1 ? '' : 's'}
              {events.length === 100 && ' (server limit reached; filter by priority)'}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
