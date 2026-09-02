'use client';

/**
 * Emergency triage form. Pre-fetches the event so the optimistic-concurrency version
 * is auto-populated — a manual "0" would 409 on the first attempt for any event that
 * has already been modified (triage, dispatch, and status changes all increment it).
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import { readEmergencyEvent, recordTriage, shortId } from '@/lib/api/emergency';
import TopBar from '@/components/layout/TopBar';

const priorities = ['low', 'medium', 'high', 'critical'] as const;

function EmergencyTriageForm() {
  const router = useRouter();
  const params = useSearchParams();
  const eventId = params.get('event');
  const { user, isLoading: isAuthLoading } = useAuth();

  const resource = useApiResource(
    (signal) => (eventId ? readEmergencyEvent(eventId, signal) : Promise.resolve(null)),
    [eventId],
  );
  const event = resource.data ?? null;

  const [priority, setPriority] = useState<(typeof priorities)[number]>('high');
  const [protocol, setProtocol] = useState('standard_emergency');
  const [reason, setReason] = useState('clinical_assessment');
  const [version, setVersion] = useState('0');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');

  // Auto-populate the version from the fetched event. A user may still override it.
  useEffect(() => {
    if (event) setVersion(String(event.version));
  }, [event]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setState('saving');
    try {
      await recordTriage(eventId, {
        priority,
        protocol_code: protocol,
        reason_code: reason,
        expected_version: Number(version),
      });
      router.push(`/emergency/dispatch/${eventId}`);
    } catch {
      setState('error');
    }
  };

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Emergency' }, { label: 'Triage' }, { label: eventId ? shortId(eventId) : '—' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">
          {!eventId && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h1 className="text-2xl font-bold text-slate-900">Emergency triage</h1>
              <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                Open triage from an emergency event to provide its identifier.
              </p>
            </div>
          )}

          {eventId && (
            <ResourceState
              isLoading={resource.isLoading}
              error={resource.error}
              isEmpty={false}
              onRetry={resource.reload}
              loadingLabel="Loading the event…"
              forbiddenTitle="You cannot triage this event"
              errorTitle="Could not load the event"
              emptyTitle=""
              emptyBody=""
              emptyIcon=""
            />
          )}

          {eventId && !resource.error && (
            <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Emergency triage</h1>
                <p className="text-sm text-slate-500 mt-1">Record a priority and the evidence supporting it.</p>
                {event && (
                  <p className="text-xs text-slate-400 mt-2">
                    Status: {event.status} · version {event.version}
                  </p>
                )}
              </div>

              <label className="block text-sm font-semibold text-slate-700">
                Event ID
                <input
                  value={eventId}
                  disabled
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
              </label>

              <label className="block text-sm font-semibold text-slate-700">
                Expected version
                <input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
              </label>

              <label className="block text-sm font-semibold text-slate-700">
                Protocol code
                <input
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
              </label>

              <label className="block text-sm font-semibold text-slate-700">
                Reason code
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
              </label>

              <label className="block text-sm font-semibold text-slate-700">
                Priority
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as typeof priority)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                >
                  {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>

              {state === 'error' && (
                <p className="text-sm text-red-600">
                  Triage could not be recorded. The event version may have changed — re-read and try again.
                </p>
              )}

              <button
                disabled={!eventId || state === 'saving'}
                className="rounded-lg bg-[#1e3fae] px-5 py-2.5 font-bold text-white disabled:opacity-50"
              >
                {state === 'saving' ? 'Saving…' : 'Record triage'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

export default function EmergencyTriagePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    }>
      <EmergencyTriageForm />
    </Suspense>
  );
}
