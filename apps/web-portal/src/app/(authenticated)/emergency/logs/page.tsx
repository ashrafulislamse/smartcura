'use client';

/**
 * Emergency log, wired to GET /emergencies with active_only=false.
 *
 * THIS PAGE IS ABOUT DURATIONS, because that is what a log is useful for. The stage
 * timestamps — created, triaged, dispatched, on scene, resolved — are recorded once when
 * each stage is first reached, so the intervals between them are real measurements rather
 * than something recomputed at resolution time. Time-to-dispatch and total handling time
 * are shown per event.
 *
 * `false_alarm` and `cancelled` are shown as OUTCOMES rather than hidden. An emergency
 * service needs to see its false-alarm rate; suppressing those rows would make the log
 * flatter to read and less honest.
 *
 * As on the live queue, there is no distance and no vitals: proximity cannot be computed
 * without PostGIS, and a vitals snapshot is a per-event read rather than list data.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  PRIORITY_STYLE,
  STATUS_STYLE,
  TERMINAL_STATUSES,
  formatDuration,
  formatInstant,
  humaniseCode,
  listEmergencyEvents,
  minutesBetween,
  shortId,
} from '@/lib/api/emergency';
import TopBar from '@/components/layout/TopBar';

type Outcome = 'all' | 'resolved' | 'cancelled' | 'false_alarm';

const OUTCOMES: ReadonlyArray<{ key: Outcome; label: string }> = [
  { key: 'all', label: 'All events' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'false_alarm', label: 'False alarm' },
];

/** Median rather than mean: one outlier should not move the headline figure. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}

export default function EmergencyLogPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [outcome, setOutcome] = useState<Outcome>('all');

  const { data, isLoading, error, reload } = useApiResource(
    (signal) =>
      listEmergencyEvents({
        status: outcome === 'all' ? undefined : outcome,
        activeOnly: false,
        limit: 100,
        signal,
      }),
    [outcome],
  );

  const events = useMemo(() => data?.data ?? [], [data]);

  const closed = useMemo(() => events.filter((event) => TERMINAL_STATUSES.has(event.status)), [events]);
  const falseAlarms = useMemo(
    () => events.filter((event) => event.status === 'false_alarm').length,
    [events],
  );

  const medianToDispatch = useMemo(
    () =>
      median(
        events
          .map((event) => minutesBetween(event.created_at, event.dispatched_at))
          .filter((value): value is number => value !== null),
      ),
    [events],
  );
  const medianHandling = useMemo(
    () =>
      median(
        events
          .map((event) => minutesBetween(event.created_at, event.resolved_at))
          .filter((value): value is number => value !== null),
      ),
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
      <TopBar breadcrumbs={[{ label: 'Emergency' }, { label: 'Log' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Emergency Log</h1>
            <p className="text-slate-500 mt-1">
              Durations are measured between recorded stage instants, not recomputed at resolution.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { icon: 'list', tint: 'text-blue-600', label: 'Events', value: String(events.length), note: 'In view' },
              { icon: 'check_circle', tint: 'text-green-600', label: 'Closed', value: String(closed.length), note: 'Resolved, cancelled or false' },
              { icon: 'local_shipping', tint: 'text-amber-600', label: 'Median dispatch', value: formatDuration(medianToDispatch), note: 'Raised to unit sent' },
              { icon: 'timer', tint: 'text-slate-600', label: 'Median handling', value: formatDuration(medianHandling), note: 'Raised to resolved' },
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

          {falseAlarms > 0 && (
            // Surfaced rather than hidden: a false-alarm rate is something an emergency
            // service needs to know about itself.
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700" role="status">
              <span className="font-bold">
                {falseAlarms} of {events.length} events in view were false alarms.
              </span>{' '}
              These are kept in the log deliberately.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map((option) => (
              <button
                key={option.key}
                onClick={() => setOutcome(option.key)}
                className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  outcome === option.key
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
            loadingLabel="Loading the emergency log…"
            forbiddenTitle="You cannot view the emergency log"
            errorTitle="Could not load the emergency log"
            emptyTitle="No events for this outcome"
            emptyBody="Events appear here once they have been raised."
            emptyIcon="history"
          />

          {!isLoading && !error && events.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Emergency events with measured stage durations</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Event</th>
                    <th scope="col" className="px-5 py-3">Priority</th>
                    <th scope="col" className="px-5 py-3">Outcome</th>
                    <th scope="col" className="px-5 py-3">Raised</th>
                    <th scope="col" className="px-5 py-3 text-right">To dispatch</th>
                    <th scope="col" className="px-5 py-3 text-right">To resolve</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {events.map((event) => {
                    const toDispatch = minutesBetween(event.created_at, event.dispatched_at);
                    const toResolve = minutesBetween(event.created_at, event.resolved_at);
                    const open = !TERMINAL_STATUSES.has(event.status);
                    return (
                      <tr
                        key={event.emergency_event_id}
                        onClick={() => router.push(`/emergency/dispatch/${event.emergency_event_id}`)}
                        className={`cursor-pointer hover:bg-slate-50 transition-colors ${
                          open ? 'bg-amber-50/20' : ''
                        }`}
                      >
                        <td className="px-5 py-3">
                          <span className="font-bold text-slate-900">
                            {humaniseCode(event.category_code)}
                          </span>
                          <span className="block text-xs text-slate-400">
                            <code>{shortId(event.emergency_event_id)}</code> · patient{' '}
                            {shortId(event.patient_profile_id)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                              PRIORITY_STYLE[event.triage_priority] ?? PRIORITY_STYLE.unknown
                            }`}
                          >
                            {humaniseCode(event.triage_priority)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                              STATUS_STYLE[event.status] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                            }`}
                          >
                            {humaniseCode(event.status)}
                          </span>
                          {open && <span className="block text-xs text-amber-700 mt-1">still open</span>}
                        </td>
                        <td className="px-5 py-3 text-slate-500">{formatInstant(event.created_at)}</td>
                        <td className="px-5 py-3 text-right text-slate-700">
                          {formatDuration(toDispatch)}
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-slate-900">
                          {formatDuration(toResolve)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && !error && events.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{events.length}</span> event
              {events.length === 1 ? '' : 's'}
              {events.length === 100 && ' (server limit reached; filter by outcome)'}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
