'use client';

/**
 * Emergency break-glass patient record.
 *
 * This page is the PHI disclosure surface opened after an operator activates a
 * break-glass grant from the dispatch page. It shows the patient's identity,
 * allergies, active conditions, recent vital readings and open health alerts —
 * all read-only, all scoped to the grant, and all no-store at the backend.
 *
 * The grant has a bounded expiry. The status bar counts down to `expires_at`
 * and offers a "Terminate Break-Glass" button that ends the grant early and
 * returns the operator to the dispatch page for the originating event. The
 * event id is passed through as a query parameter because neither the grant
 * nor the disclosure response carries it back.
 *
 * THREE INDEPENDENT FETCHES. The patient record, vitals and alerts are separate
 * endpoints because they are independent surfaces with independent permission
 * semantics. A failure in one does not blank the others — the page renders
 * whatever succeeded and shows the error inline for what failed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import StatCard from '@/components/ui/stat-card';
import SectionCard from '@/components/ui/section-card';
import Badge from '@/components/ui/badge';
import FilterPills from '@/components/ui/filter-pills';
import type { BadgeTone } from '@/components/ui/badge';
import { ApiError } from '@/lib/api/client';
import {
  readBreakGlassAlerts,
  readBreakGlassPatientRecord,
  readBreakGlassVitals,
  reviewBreakGlassGrant,
  terminateBreakGlass,
} from '@/lib/api/break-glass';
import type {
  HealthAlert,
  HealthAlertSeverity,
  HealthAlertState,
  UnknownEnumValue,
  VitalMetric,
  VitalReading,
} from '@/types/contracts';
import { shortId, humaniseCode, formatInstant } from '@/lib/api/directory';

/** The known members of an enum, excluding the forward-compatibility escape hatch. */
type Known<T> = Exclude<T, UnknownEnumValue>;

/* -------------------------------------------------------------------------- */
/* Vocabulary maps (exhaustive over known enum members)                        */
/* -------------------------------------------------------------------------- */

const VITAL_METRICS: ReadonlyArray<Known<VitalMetric>> = [
  'heart_rate',
  'oxygen_saturation',
  'body_temperature',
  'systolic_bp',
  'diastolic_bp',
  'respiratory_rate',
  'ecg_voltage',
  'blood_pressure',
  'blood_glucose',
  'body_weight',
];

const VITAL_METRIC_LABEL: Record<Known<VitalMetric>, string> = {
  heart_rate: 'Heart rate',
  oxygen_saturation: 'SpO2',
  body_temperature: 'Temperature',
  systolic_bp: 'Systolic BP',
  diastolic_bp: 'Diastolic BP',
  respiratory_rate: 'Respiratory rate',
  ecg_voltage: 'ECG',
  blood_pressure: 'Blood pressure',
  blood_glucose: 'Blood glucose',
  body_weight: 'Body weight',
};

function metricShortLabel(metric: string): string {
  return VITAL_METRIC_LABEL[metric as Known<VitalMetric>] ?? humaniseCode(metric);
}

function severityTone(severity: HealthAlertSeverity): BadgeTone {
  switch (severity) {
    case 'critical': return 'red';
    case 'warning': return 'amber';
    case 'info': return 'blue';
    default: return 'slate';
  }
}

function alertStateTone(state: HealthAlertState): BadgeTone {
  switch (state) {
    case 'open': return 'red';
    case 'acknowledged': return 'amber';
    case 'escalated': return 'orange';
    case 'resolved': return 'green';
    case 'dismissed': return 'slate';
    default: return 'slate';
  }
}

function allergySeverityTone(severity: string): BadgeTone {
  switch (severity) {
    case 'life_threatening': return 'red';
    case 'severe': return 'orange';
    case 'moderate': return 'amber';
    case 'mild': return 'slate';
    default: return 'slate';
  }
}

// Abnormal thresholds for highlighting a reading row. Conservative: only flag
// values clearly outside the normal adult range. This is display logic, not
// clinical decision support.
function isAbnormalReading(metric: string, value: number): boolean {
  switch (metric) {
    case 'heart_rate': return value < 50 || value > 120;
    case 'oxygen_saturation': return value < 92;
    case 'body_temperature': return value < 35.5 || value > 38.0;
    case 'systolic_bp': return value < 90 || value > 160;
    case 'diastolic_bp': return value < 50 || value > 100;
    case 'respiratory_rate': return value < 12 || value > 25;
    case 'blood_glucose': return value < 3.9 || value > 10.0;
    default: return false;
  }
}

function countdown(expiresAt: string): string {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return '—';
  const remaining = expiry - Date.now();
  if (remaining <= 0) return 'Expired';
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** The outcomes a retrospective review may record, declared once so the picker cannot drift. */
const REVIEW_OUTCOMES: ReadonlyArray<'justified' | 'unjustified' | 'inconclusive'> = [
  'justified',
  'unjustified',
  'inconclusive',
];

export default function BreakGlassPatientRecordPage() {
  const router = useRouter();
  const params = useParams<{ grantId: string }>();
  const searchParams = useSearchParams();
  const grantId = params.grantId;
  const eventId = searchParams.get('event');

  const [metricFilter, setMetricFilter] = useState<string>('all');
  const [alertStateFilter, setAlertStateFilter] = useState<string>('all');
  const [isTerminating, setIsTerminating] = useState(false);
  const [terminateError, setTerminateError] = useState<ApiError | null>(null);

  // Retrospective review state. Shown only when the grant is expired/terminated,
  // because the review is a post-hoc oversight decision, not an in-flight action.
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [reviewOutcome, setReviewOutcome] =
    useState<'justified' | 'unjustified' | 'inconclusive'>('justified');
  const [reviewNotes, setReviewNotes] = useState('');
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<ApiError | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState(false);

  // Patient record
  const recordResource = useApiResource(
    (signal) => readBreakGlassPatientRecord(grantId, signal),
    [grantId],
  );

  // Vital readings
  const vitalsResource = useApiResource(
    (signal) =>
      readBreakGlassVitals(grantId, {
        metric: metricFilter === 'all' ? undefined : (metricFilter as VitalMetric),
        pageSize: 50,
        signal,
      }),
    [grantId, metricFilter],
  );

  // Health alerts
  const alertsResource = useApiResource(
    (signal) =>
      readBreakGlassAlerts(grantId, {
        state: alertStateFilter === 'all' ? undefined : (alertStateFilter as HealthAlertState),
        pageSize: 50,
        signal,
      }),
    [grantId, alertStateFilter],
  );

  // Tick the countdown every second. The expiry is a point in time, so this
  // is the one place a re-render without new data is correct.
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const record = recordResource.data;
  const readings = useMemo(() => vitalsResource.data?.data ?? [], [vitalsResource.data]);
  const alerts = useMemo(() => alertsResource.data?.data ?? [], [alertsResource.data]);

  // Summary cards: latest value for each of the three critical metrics.
  const latestHeartRate = useMemo(() => findLatest(readings, 'heart_rate'), [readings]);
  const latestSpO2 = useMemo(() => findLatest(readings, 'oxygen_saturation'), [readings]);
  const latestTemp = useMemo(() => findLatest(readings, 'body_temperature'), [readings]);

  const handleTerminate = useCallback(async () => {
    setIsTerminating(true);
    setTerminateError(null);
    try {
      await terminateBreakGlass(grantId, { reason_code: 'patient_care' });
      if (eventId) {
        router.push(`/emergency/dispatch/${eventId}`);
      } else {
        router.push('/emergency');
      }
    } catch (caught) {
      setTerminateError(
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected error' }),
      );
    } finally {
      setIsTerminating(false);
    }
  }, [grantId, eventId, router]);

  const handleReview = useCallback(async () => {
    if (isReviewing) return;
    const notes = reviewNotes.trim();
    if (notes === '') {
      setReviewError(
        new ApiError({
          status: 0,
          code: 'CLIENT_ERROR',
          title: 'Notes are required',
          detail: 'A retrospective review must include notes explaining the outcome.',
        }),
      );
      return;
    }
    setIsReviewing(true);
    setReviewError(null);
    setReviewSuccess(false);
    try {
      await reviewBreakGlassGrant(grantId, { outcome: reviewOutcome, notes });
      setReviewSuccess(true);
      setIsReviewOpen(false);
      setReviewNotes('');
    } catch (caught) {
      setReviewError(
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected error' }),
      );
    } finally {
      setIsReviewing(false);
    }
  }, [grantId, reviewOutcome, reviewNotes, isReviewing]);

  // The page needs a grant expiry for the countdown. The disclosure does not
  // carry it, but the activate response does — and the dispatch page passes
  // it through as a query param so this page can show the countdown without
  // a separate fetch.
  const expiresAt = searchParams.get('expires');

  // A grant is reviewable once it has expired or been terminated. The page
  // derives expiry from the `expires` query param passed by the dispatch page.
  const grantExpired = expiresAt ? countdown(expiresAt) === 'Expired' : false;

  if (recordResource.isLoading) return <PageLoader label="Loading break-glass patient record..." />;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[
        { label: 'Emergency' },
        { label: 'Break-Glass' },
        { label: 'Patient Record' },
      ]} />
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">

          {/* Grant status bar */}
          <div className={`rounded-xl border p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
            grantExpired
              ? 'bg-red-50 border-red-200'
              : 'bg-amber-50 border-amber-200'
          }`}>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-amber-600 text-2xl">crisis_alert</span>
              <div>
                <h2 className="font-bold text-slate-900">
                  {grantExpired ? 'Break-glass access expired' : 'Break-glass access active'}
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Grant <code>{shortId(grantId)}</code>
                  {expiresAt && <> · {grantExpired ? 'expired' : <>expires in <span className="font-bold">{countdown(expiresAt)}</span></>}</>}
                </p>
              </div>
            </div>
            {!grantExpired && (
              <button
                type="button"
                disabled={isTerminating}
                onClick={handleTerminate}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[20px]">lock_clock</span>
                {isTerminating ? 'Terminating...' : 'Terminate Break-Glass'}
              </button>
            )}
          </div>

          {terminateError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4" role="alert">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600">error</span>
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900">{terminateError.title}</h3>
                  <p className="text-sm text-slate-600 mt-1">{terminateError.message}</p>
                </div>
              </div>
            </div>
          )}

          {/* Retrospective review — shown only when the grant is expired/terminated. */}
          {grantExpired && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div>
                  <h2 className="font-bold text-slate-900">Retrospective review</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Record an oversight decision on this break-glass grant. Admin, step-up required.
                  </p>
                </div>
                {!isReviewOpen && !reviewSuccess && (
                  <button
                    type="button"
                    onClick={() => {
                      setReviewError(null);
                      setReviewOutcome('justified');
                      setReviewNotes('');
                      setIsReviewOpen(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1a3694] transition-colors shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[20px]">rate_review</span>
                    Record review
                  </button>
                )}
              </div>

              {reviewSuccess && (
                <div className="mt-2 rounded-xl bg-green-50 border border-green-100 p-4">
                  <p className="text-sm font-bold text-green-700">
                    Review recorded. The oversight decision has been logged.
                  </p>
                </div>
              )}

              {isReviewOpen && (
                <div className="mt-4 flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-bold text-slate-700">Outcome</span>
                    <select
                      value={reviewOutcome}
                      onChange={(e) =>
                        setReviewOutcome(
                          e.target.value as 'justified' | 'unjustified' | 'inconclusive',
                        )
                      }
                      disabled={isReviewing}
                      className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
                    >
                      {REVIEW_OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {humaniseCode(o)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-bold text-slate-700">Notes</span>
                    <textarea
                      rows={4}
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      disabled={isReviewing}
                      placeholder="Explain the basis for this outcome…"
                      className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm resize-none"
                    />
                  </label>

                  {reviewError && !reviewError.needsStepUp && (
                    <div
                      className="rounded-lg border border-red-200 bg-red-50 p-3"
                      role="alert"
                    >
                      <p className="text-sm font-bold text-red-700">{reviewError.title}</p>
                      <p className="text-xs text-red-600 mt-1">{reviewError.message}</p>
                    </div>
                  )}

                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setIsReviewOpen(false);
                        setReviewError(null);
                      }}
                      disabled={isReviewing}
                      className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleReview}
                      disabled={isReviewing}
                      className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#1a3694] disabled:opacity-50"
                    >
                      {isReviewing ? 'Recording…' : 'Submit review'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Patient record */}
          <ResourceState
            isLoading={recordResource.isLoading}
            error={recordResource.error}
            isEmpty={!recordResource.isLoading && !recordResource.error && !record}
            onRetry={recordResource.reload}
            loadingLabel="Loading patient record..."
            forbiddenTitle="You cannot view this patient record"
            errorTitle="Could not load the patient record"
            emptyTitle="Patient record unavailable"
            emptyBody="No patient record was returned for this break-glass grant."
            emptyIcon="person_off"
          />

          {record && !recordResource.error && (
            <>
              {/* Patient identity header */}
              <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex items-center gap-4">
                  <div className="size-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-3xl">person</span>
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                      {record.display_name}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                      Patient ID: <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">{shortId(record.patient_profile_id)}</code>
                    </p>
                  </div>
                </div>
              </section>

              {/* Allergies */}
              <SectionCard title="Allergies">
                {record.allergies.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4 text-center">No known allergies recorded.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {record.allergies.map((allergy, index) => {
                      const substance = String(allergy.substance ?? 'Unknown');
                      const severity = String(allergy.severity ?? 'unknown');
                      const reaction = allergy.reaction ? String(allergy.reaction) : null;
                      return (
                        <div key={index} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900">{substance}</p>
                            {reaction && <p className="text-xs text-slate-500 mt-0.5">Reaction: {reaction}</p>}
                          </div>
                          <Badge tone={allergySeverityTone(severity)}>{humaniseCode(severity)}</Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>

              {/* Active conditions */}
              <SectionCard title="Active Conditions">
                {record.active_conditions.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4 text-center">No active conditions recorded.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {record.active_conditions.map((condition, index) => {
                      const name = String(condition.condition_name ?? 'Unknown condition');
                      const status = String(condition.status ?? 'unknown');
                      return (
                        <div key={index} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4">
                          <p className="font-bold text-slate-900">{name}</p>
                          <Badge tone={status === 'active' ? 'orange' : status === 'in_remission' ? 'green' : 'slate'}>
                            {humaniseCode(status)}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {/* Vital readings */}
          <SectionCard title="Vital Readings">
            <div className="flex flex-col gap-4">
              {/* Summary cards: latest HR / SpO2 / Temp */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard
                  icon="favorite"
                  label="Latest HR"
                  value={latestHeartRate ? `${latestHeartRate.value} ${latestHeartRate.unit}` : '—'}
                  tone={latestHeartRate && isAbnormalReading('heart_rate', latestHeartRate.value) ? 'red' : 'blue'}
                  note={latestHeartRate ? formatInstant(latestHeartRate.recorded_at) : undefined}
                />
                <StatCard
                  icon="water_drop"
                  label="Latest SpO2"
                  value={latestSpO2 ? `${latestSpO2.value} ${latestSpO2.unit}` : '—'}
                  tone={latestSpO2 && isAbnormalReading('oxygen_saturation', latestSpO2.value) ? 'red' : 'teal'}
                  note={latestSpO2 ? formatInstant(latestSpO2.recorded_at) : undefined}
                />
                <StatCard
                  icon="thermostat"
                  label="Latest Temp"
                  value={latestTemp ? `${latestTemp.value} ${latestTemp.unit}` : '—'}
                  tone={latestTemp && isAbnormalReading('body_temperature', latestTemp.value) ? 'red' : 'amber'}
                  note={latestTemp ? formatInstant(latestTemp.recorded_at) : undefined}
                />
              </div>

              {/* Metric filter */}
              <FilterPills
                tabs={[
                  { key: 'all', label: 'All metrics' },
                  ...VITAL_METRICS.map((m) => ({ key: m, label: metricShortLabel(m) })),
                ]}
                activeKey={metricFilter}
                onSelect={setMetricFilter}
              />

              {vitalsResource.error ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
                  <p className="text-sm font-bold text-red-700">Could not load vital readings</p>
                  <p className="text-xs text-red-600 mt-1">{vitalsResource.error.message}</p>
                </div>
              ) : vitalsResource.isLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3fae] mx-auto"></div>
                  <p className="text-sm text-slate-500 mt-2">Loading readings...</p>
                </div>
              ) : readings.length === 0 ? (
                <div className="text-center py-8">
                  <span className="material-symbols-outlined text-slate-300 text-5xl">monitor_heart</span>
                  <p className="text-sm text-slate-500 mt-2">No vital readings available.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="p-3">Metric</th>
                        <th className="p-3">Value</th>
                        <th className="p-3">Quality</th>
                        <th className="p-3">Recorded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {readings.map((reading) => {
                        const abnormal = isAbnormalReading(reading.metric, reading.value);
                        return (
                          <tr key={reading.id} className={abnormal ? 'bg-red-50' : 'hover:bg-slate-50/40'}>
                            <td className="p-3 font-bold text-slate-900">{metricShortLabel(reading.metric)}</td>
                            <td className={`p-3 font-bold ${abnormal ? 'text-red-700' : 'text-slate-900'}`}>
                              {reading.value} {reading.unit}
                              {abnormal && <span className="material-symbols-outlined text-red-500 text-[16px] ml-1 align-middle">warning</span>}
                            </td>
                            <td className="p-3">
                              <Badge tone={reading.quality === 'valid' ? 'green' : reading.quality === 'suspect' ? 'amber' : 'slate'}>
                                {humaniseCode(reading.quality)}
                              </Badge>
                            </td>
                            <td className="p-3 text-xs text-slate-500">{formatInstant(reading.recorded_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Health alerts */}
          <SectionCard title="Health Alerts">
            <div className="flex flex-col gap-4">
              <FilterPills
                tabs={[
                  { key: 'all', label: 'All states' },
                  { key: 'open', label: 'Open' },
                  { key: 'acknowledged', label: 'Acknowledged' },
                  { key: 'escalated', label: 'Escalated' },
                  { key: 'resolved', label: 'Resolved' },
                ]}
                activeKey={alertStateFilter}
                onSelect={setAlertStateFilter}
              />

              {alertsResource.error ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
                  <p className="text-sm font-bold text-red-700">Could not load health alerts</p>
                  <p className="text-xs text-red-600 mt-1">{alertsResource.error.message}</p>
                </div>
              ) : alertsResource.isLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3fae] mx-auto"></div>
                  <p className="text-sm text-slate-500 mt-2">Loading alerts...</p>
                </div>
              ) : alerts.length === 0 ? (
                <div className="text-center py-8">
                  <span className="material-symbols-outlined text-slate-300 text-5xl">notifications_off</span>
                  <p className="text-sm text-slate-500 mt-2">No health alerts for this patient.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {alerts.map((alert) => (
                    <AlertCard key={alert.id} alert={alert} />
                  ))}
                </div>
              )}
            </div>
          </SectionCard>

          {/* Back link */}
          <button
            onClick={() => eventId ? router.push(`/emergency/dispatch/${eventId}`) : router.push('/emergency')}
            className="text-sm font-bold text-[#1e3fae] hover:underline inline-flex items-center gap-1 self-start"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to dispatch
          </button>
        </div>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

function findLatest(readings: ReadonlyArray<VitalReading>, metric: string): VitalReading | null {
  let latest: VitalReading | null = null;
  for (const r of readings) {
    if (r.metric !== metric) continue;
    if (!latest || Date.parse(r.recorded_at) > Date.parse(latest.recorded_at)) {
      latest = r;
    }
  }
  return latest;
}

function AlertCard({ alert }: { alert: HealthAlert }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-bold text-slate-900">{metricShortLabel(alert.metric)}</p>
          <Badge tone={severityTone(alert.severity)}>{humaniseCode(alert.severity)}</Badge>
          <Badge tone={alertStateTone(alert.state)}>{humaniseCode(alert.state)}</Badge>
        </div>
        <p className="text-sm text-slate-600 mt-1">
          Observed value: <span className="font-bold">{alert.observed_value}</span>
        </p>
        <p className="text-xs text-slate-500 mt-1">Observed at {formatInstant(alert.observed_at)}</p>
      </div>
    </div>
  );
}
