'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import { advanceEmergency, readEmergencyEvent, recordEmergencyCommunication, reserveEmergencyUnit } from '@/lib/api/emergency';
import { activateBreakGlass } from '@/lib/api/break-glass';
import { ApiError } from '@/lib/api/client';

export default function DispatchCommandPage() {
  const id = String(useParams().id);
  const router = useRouter();
  const { data, isLoading, error, reload } = useApiResource(signal => readEmergencyEvent(id, signal), [id]);
  const [unit, setUnit] = useState('');
  const [version, setVersion] = useState('0');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [breakGlassError, setBreakGlassError] = useState<ApiError | null>(null);
  const [breakGlassLoading, setBreakGlassLoading] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setSaving(true);
    try {
      await fn();
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const handleBreakGlass = async () => {
    setBreakGlassLoading(true);
    setBreakGlassError(null);
    try {
      const grant = await activateBreakGlass({
        emergency_event_id: id,
        reason_code: 'patient_care',
        reason_detail: 'Emergency response',
      });
      // Pass the event id and expiry through query params so the break-glass page
      // can show the countdown and redirect back here on terminate. Neither the
      // grant nor the disclosure response carries the event id back.
      const params = new URLSearchParams({ event: id });
      if (grant.expires_at) params.set('expires', grant.expires_at);
      router.push(`/emergency/break-glass/${grant.break_glass_grant_id}?${params.toString()}`);
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected error' });
      setBreakGlassError(apiError);
      // A step-up requirement redirects the operator to the 2FA flow rather
      // than showing an inline error, because the remedy is re-authentication.
      if (apiError.needsStepUp) {
        router.push('/2fa');
      }
    } finally {
      setBreakGlassLoading(false);
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-8 bg-[#F9FAFB]">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Emergency dispatch</h1>
        <ResourceState
          isLoading={isLoading}
          error={error}
          isEmpty={!data}
          onRetry={reload}
          loadingLabel="Loading event…"
          forbiddenTitle="You cannot view this emergency"
          errorTitle="Could not load emergency"
          emptyTitle="Emergency not found"
          emptyBody="The event is unavailable."
          emptyIcon="emergency"
        />
        {data && (
          <div className="mt-6 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs text-slate-500">Event</p>
              <p className="font-mono text-sm">{data.emergency_event_id}</p>
              <p className="mt-3">{data.category_code} · <b>{data.triage_priority}</b> · {data.status}</p>
              <p className="text-xs text-slate-500 mt-2">Version {data.version}</p>
            </div>

            {/* Break-glass: view the patient's record under emergency disclosure */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h2 className="font-bold">Patient record</h2>
              <p className="text-sm text-slate-500">
                Activate a break-glass grant to view this patient's record, vitals and
                health alerts under emergency PHI disclosure. All access is audited.
              </p>
              <button
                disabled={breakGlassLoading}
                onClick={handleBreakGlass}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 font-bold text-white disabled:opacity-50 hover:bg-red-700"
              >
                <span className="material-symbols-outlined text-[20px]">crisis_alert</span>
                {breakGlassLoading ? 'Activating...' : 'Break Glass — View Patient Record'}
              </button>
              {breakGlassError && !breakGlassError.needsStepUp && (
                <p className="text-sm text-red-600 mt-2">
                  {breakGlassError.title}: {breakGlassError.message}
                </p>
              )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h2 className="font-bold">Dispatch or advance</h2>
              <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Emergency unit ID" className="w-full rounded border px-3 py-2" />
              <input value={version} onChange={e => setVersion(e.target.value)} placeholder="Expected version" className="w-full rounded border px-3 py-2" />
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={!unit || saving}
                  onClick={() => run(() => reserveEmergencyUnit(id, { emergency_unit_id: unit, expected_version: Number(version) }))}
                  className="rounded bg-red-600 px-4 py-2 font-bold text-white disabled:opacity-50"
                >
                  Reserve unit
                </button>
                {(['dispatching', 'responding', 'on_scene', 'transporting'] as const).map(status => (
                  <button
                    key={status}
                    disabled={saving}
                    onClick={() => run(() => advanceEmergency(id, { status, expected_version: Number(version) }))}
                    className="rounded border px-3 py-2 text-sm font-bold"
                  >
                    {status.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h2 className="font-bold">Record communication</h2>
              <input value={message} onChange={e => setMessage(e.target.value)} placeholder="Structured summary code" className="w-full rounded border px-3 py-2" />
              <button
                disabled={!message || saving}
                onClick={() => run(() => recordEmergencyCommunication(id, { channel: 'radio', direction: 'outbound', summary_code: message }))}
                className="rounded bg-[#1e3fae] px-4 py-2 font-bold text-white disabled:opacity-50"
              >
                Record radio update
              </button>
            </div>

            {/*
              Resolution link: the resolution page exists and is wired to
              POST /emergencies/{id}/resolution, but nothing else links to it. Shown only
              for late-stage events (on_scene, transporting) that are ready for closure.
              Earlier stages need triage and dispatch first.
            */}
            {(data.status === 'on_scene' || data.status === 'transporting') && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
                <h2 className="font-bold">Close this event</h2>
                <p className="text-sm text-slate-500">
                  Record an auditable resolution — treated on scene, transported, cancelled,
                  false alarm, duplicate, or other.
                </p>
                <button
                  onClick={() => router.push(`/emergency/resolution/${id}`)}
                  className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 font-bold text-white hover:bg-green-800"
                >
                  <span className="material-symbols-outlined text-[20px]">check_circle</span>
                  Resolve event
                </button>
              </div>
            )}

            <button onClick={() => router.push('/emergency')} className="text-sm font-bold text-[#1e3fae]">
              Back to queue
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
