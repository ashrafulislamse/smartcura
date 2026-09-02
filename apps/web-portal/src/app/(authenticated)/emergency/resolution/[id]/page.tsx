'use client';

/**
 * Emergency resolution form. Pre-fetches the event so the optimistic-concurrency version
 * is auto-populated — a manual "0" would 409 on the first attempt for any event that has
 * already been triaged or dispatched (which increments the version).
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import { readEmergencyEvent, resolveEmergency, shortId } from '@/lib/api/emergency';
import TopBar from '@/components/layout/TopBar';

const types = ['treated_on_scene', 'transported', 'cancelled_by_requester', 'false_alarm', 'duplicate', 'other'] as const;

export default function EmergencyResolutionPage() {
  const id = String(useParams().id);
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();

  const resource = useApiResource((signal) => readEmergencyEvent(id, signal), [id]);
  const event = resource.data ?? null;

  const [type, setType] = useState<(typeof types)[number]>('treated_on_scene');
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState('');
  const [version, setVersion] = useState('0');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Auto-populate the version from the fetched event. A user may still override it
  // if they have a newer read, but the default is the current server value, not "0".
  useEffect(() => {
    if (event) setVersion(String(event.version));
  }, [event]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await resolveEmergency(id, {
        resolution_type: type,
        notes,
        outcome_code: outcome || null,
        expected_version: Number(version),
      });
      router.push('/emergency');
    } catch {
      setError('Resolution could not be recorded. The event version may have changed — re-read and try again.');
      setSaving(false);
    }
  }

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Emergency' }, { label: 'Resolution' }, { label: shortId(id) }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">
          <ResourceState
            isLoading={resource.isLoading}
            error={resource.error}
            isEmpty={false}
            onRetry={resource.reload}
            loadingLabel="Loading the event…"
            forbiddenTitle="You cannot resolve this event"
            errorTitle="Could not load the event"
            emptyTitle=""
            emptyBody=""
            emptyIcon=""
          />

          {event && !resource.error && (
            <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Emergency resolution</h1>
                <p className="text-sm text-slate-500 mt-1">
                  Close event <code className="text-slate-700">{shortId(id)}</code> with an auditable resolution.
                </p>
                <p className="text-xs text-slate-400 mt-2">
                  Status: {event.status} · version {event.version}
                </p>
              </div>

              <label className="block text-sm font-semibold text-slate-700">
                Resolution type
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                >
                  {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>

              <label className="block text-sm font-semibold text-slate-700">
                Expected version
                <input
                  type="number"
                  min="0"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
              </label>

              <label className="block text-sm font-semibold text-slate-700">
                Outcome code (optional)
                <input
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
              </label>

              <label className="block text-sm font-semibold text-slate-700">
                Resolution notes
                <textarea
                  required
                  minLength={1}
                  maxLength={4000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  rows={6}
                />
              </label>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                disabled={saving}
                className="rounded-lg bg-[#1e3fae] px-5 py-2.5 font-bold text-white disabled:opacity-50"
              >
                {saving ? 'Submitting…' : 'Submit resolution'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
