'use client';

import { useCallback, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import StatCard from '@/components/ui/stat-card';
import SectionCard from '@/components/ui/section-card';
import ChartCard from '@/components/ui/chart-card';
import Badge from '@/components/ui/badge';
import type { BadgeTone } from '@/components/ui/badge';
import FilterPills from '@/components/ui/filter-pills';
import { ApiError } from '@/lib/api/client';
import {
  acknowledgeHealthAlert,
  listPatientHealthAlerts,
  listPatientVitalReadings,
  transitionHealthAlert,
} from '@/lib/api/iot';
import type {
  HealthAlert,
  HealthAlertSeverity,
  HealthAlertState,
  TransitionHealthAlertRequest,
  VitalMetric,
  VitalReading,
  VitalReadingQuality,
} from '@/types/contracts';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';

/**
 * The metrics we chart. The backend's `VitalMetric` vocabulary is broader (it includes
 * `systolic_bp`, `diastolic_bp`, `respiratory_rate`, `ecg_voltage`, `blood_glucose` and
 * `body_weight`), but these four are the ones the summary cards and the multi-line chart are
 * designed for. Other metrics still appear in the table; they just are not charted on a single
 * shared Y-axis because their units differ too widely to share a scale.
 */
type ChartMetric = 'heart_rate' | 'oxygen_saturation' | 'body_temperature' | 'blood_pressure';

type MetricFilterKey = 'all' | ChartMetric;

const FILTER_TABS: ReadonlyArray<{ key: MetricFilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'heart_rate', label: 'Heart rate' },
  { key: 'oxygen_saturation', label: 'SpO2' },
  { key: 'body_temperature', label: 'Temperature' },
  { key: 'blood_pressure', label: 'Blood pressure' },
];

// Map the backend metric names to the friendly labels the UI shows. Keyed over the chart
// metrics only; the table renders the raw metric name humanised.
const METRIC_LABEL: Record<ChartMetric, string> = {
  heart_rate: 'Heart rate',
  oxygen_saturation: 'SpO2',
  body_temperature: 'Temperature',
  blood_pressure: 'Blood pressure',
};

// recharts line colours per the design system.
const METRIC_COLOUR: Record<ChartMetric, string> = {
  heart_rate: '#ef4444',
  oxygen_saturation: '#3b82f6',
  body_temperature: '#f59e0b',
  blood_pressure: '#8b5cf6',
};

const METRIC_ICON: Record<ChartMetric, string> = {
  heart_rate: 'favorite',
  oxygen_saturation: 'water_drop',
  body_temperature: 'thermostat',
  blood_pressure: 'monitor_heart',
};

// Normal ranges for the "abnormal" row highlight. A reading outside these bounds is flagged.
function isAbnormal(metric: string, value: number): boolean {
  switch (metric) {
    case 'heart_rate': return value < 60 || value > 100;
    case 'oxygen_saturation': return value < 95;
    case 'body_temperature': return value < 36 || value > 38;
    case 'systolic_bp': return value < 90 || value > 140;
    case 'diastolic_bp': return value < 60 || value > 90;
    default: return false;
  }
}

// Switch-based tone map. The generated quality enum includes UnknownEnumValue (a branded
// string), which cannot index a Record<Exclude<...>, ...>, so a switch with a default
// fallback is the type-safe pattern: the compiler exhausts the known members and the
// default handles the forward-compatibility escape hatch.
function qualityTone(quality: VitalReadingQuality): 'green' | 'amber' | 'red' | 'slate' {
  switch (quality) {
    case 'valid': return 'green';
    case 'suspect': return 'amber';
    case 'invalid': return 'red';
    case 'unknown': return 'slate';
    default: return 'slate';
  }
}

function metricIcon(metric: string): string {
  switch (metric) {
    case 'heart_rate': return 'favorite';
    case 'oxygen_saturation': return 'water_drop';
    case 'body_temperature': return 'thermostat';
    case 'systolic_bp':
    case 'diastolic_bp':
    case 'blood_pressure': return 'monitor_heart';
    case 'respiratory_rate': return 'air';
    case 'ecg_voltage': return 'ecg_heart';
    case 'blood_glucose': return 'bloodtype';
    case 'body_weight': return 'monitor_weight';
    default: return 'monitor_heart';
  }
}

function humaniseMetric(metric: string): string {
  return metric.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// Health alert severity/state → badge tone. Switches with a default are the
// type-safe pattern for the generated unions that include UnknownEnumValue.
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

interface ChartPoint {
  readonly recorded_at: string;
  readonly timestamp: number;
  readonly heart_rate: number | null;
  readonly oxygen_saturation: number | null;
  readonly body_temperature: number | null;
  readonly blood_pressure: number | null;
  readonly unit: string;
}

interface ChartTooltipPayloadEntry {
  readonly dataKey: string;
  readonly value: number | null;
  readonly color: string;
}

function ChartTooltipContent({ active, payload, label }: {
  active?: boolean;
  payload?: ReadonlyArray<ChartTooltipPayloadEntry>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-lg p-3 text-xs">
      <p className="font-bold text-slate-900 mb-2">{label}</p>
      {payload.map((entry) => {
        if (entry.value === null || entry.value === undefined) return null;
        const metric = entry.dataKey as ChartMetric;
        return (
          <div key={entry.dataKey} className="flex items-center gap-2 py-0.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-slate-600">{METRIC_LABEL[metric] ?? humaniseMetric(entry.dataKey)}</span>
            <span className="font-bold text-slate-900 ml-auto">{entry.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatTimeAxis(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function IoTHistoricalAnalysis() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const [metricFilter, setMetricFilter] = useState<MetricFilterKey>('all');
  const resource = useApiResource(
    (signal) => listPatientVitalReadings(params.id, { limit: 100, signal }),
    [params.id],
  );

  // Health alerts for this patient, loaded independently so an alert failure
  // does not blank the vital readings chart.
  const alerts = useApiResource(
    (signal) => listPatientHealthAlerts(params.id, { pageSize: 100, signal }),
    [params.id],
  );

  // ── Alert mutations ─────────────────────────────────────────────────────────
  const [ackBusyId, setAckBusyId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [writeError, setWriteError] = useState<ApiError | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<{
    alertId: string;
    action: 'escalated' | 'resolved' | 'dismissed';
  } | null>(null);

  // The transition modal reads the alert from the freshly loaded list so its
  // `expected_version` never goes stale after a 409 conflict + reload.
  const transitionAlert = useMemo(
    () => alerts.data?.data.find((a) => a.id === transitionTarget?.alertId) ?? null,
    [alerts.data, transitionTarget],
  );

  const handleAcknowledge = useCallback(
    async (alert: HealthAlert) => {
      if (ackBusyId) return;
      setAckBusyId(alert.id);
      setWriteError(null);
      try {
        await acknowledgeHealthAlert(alert.id, { expected_version: alert.version });
        alerts.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setWriteError(apiError);
        if (apiError.isConflict) alerts.reload();
      } finally {
        setAckBusyId(null);
      }
    },
    [ackBusyId, alerts],
  );

  const runTransition = useCallback(
    async (alert: HealthAlert, body: TransitionHealthAlertRequest) => {
      if (isTransitioning) return;
      setIsTransitioning(true);
      setWriteError(null);
      try {
        await transitionHealthAlert(alert.id, body);
        setTransitionTarget(null);
        alerts.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setWriteError(apiError);
        if (apiError.isConflict) alerts.reload();
      } finally {
        setIsTransitioning(false);
      }
    },
    [isTransitioning, alerts],
  );

  const readings = useMemo(() => resource.data?.data ?? [], [resource.data]);

  // Sort by recorded_at descending (most recent first) for the table.
  const sortedReadings = useMemo(
    () => [...readings].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)),
    [readings],
  );

  // Find the most recent reading for each charted metric for the summary cards.
  const latestByMetric = useMemo(() => {
    const map = new Map<string, VitalReading>();
    for (const r of [...readings].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))) {
      map.set(r.metric, r);
    }
    return map;
  }, [readings]);

  const latestHeartRate = latestByMetric.get('heart_rate');
  const latestSpo2 = latestByMetric.get('oxygen_saturation');
  const latestTemp = latestByMetric.get('body_temperature');

  // Build the chart data: one point per unique recorded_at, with each metric as a column.
  // This lets recharts draw multiple Lines sharing an X-axis. Blood pressure combines
  // systolic and diastolic into a single average so it shares the chart's scale.
  const chartData = useMemo<ChartPoint[]>(() => {
    const byTime = new Map<string, ChartPoint>();
    const ordered = [...readings].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
    for (const r of ordered) {
      const existing = byTime.get(r.recorded_at);
      const ts = Date.parse(r.recorded_at);
      let bpValue: number | null = null;
      if (r.metric === 'systolic_bp' || r.metric === 'diastolic_bp' || r.metric === 'blood_pressure') {
        bpValue = r.value;
      }
      byTime.set(r.recorded_at, {
        recorded_at: r.recorded_at,
        timestamp: ts,
        heart_rate: r.metric === 'heart_rate' ? r.value : existing?.heart_rate ?? null,
        oxygen_saturation: r.metric === 'oxygen_saturation' ? r.value : existing?.oxygen_saturation ?? null,
        body_temperature: r.metric === 'body_temperature' ? r.value : existing?.body_temperature ?? null,
        blood_pressure: bpValue !== null ? bpValue : existing?.blood_pressure ?? null,
        unit: r.unit,
      });
    }
    return Array.from(byTime.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [readings]);

  // Determine which metric lines to render based on the active filter.
  const visibleMetrics: ChartMetric[] = useMemo(() => {
    const present = new Set<ChartMetric>();
    for (const r of readings) {
      if (r.metric === 'heart_rate') present.add('heart_rate');
      else if (r.metric === 'oxygen_saturation') present.add('oxygen_saturation');
      else if (r.metric === 'body_temperature') present.add('body_temperature');
      else if (r.metric === 'systolic_bp' || r.metric === 'diastolic_bp' || r.metric === 'blood_pressure') present.add('blood_pressure');
    }
    if (metricFilter === 'all') return Array.from(present);
    return Array.from(present).filter((m) => m === metricFilter);
  }, [readings, metricFilter]);

  // The filtered table rows: when a specific metric is selected, narrow to it.
  const tableRows = useMemo(() => {
    if (metricFilter === 'all') return sortedReadings;
    if (metricFilter === 'blood_pressure') {
      return sortedReadings.filter(
        (r) => r.metric === 'systolic_bp' || r.metric === 'diastolic_bp' || r.metric === 'blood_pressure',
      );
    }
    return sortedReadings.filter((r) => r.metric === metricFilter);
  }, [sortedReadings, metricFilter]);

  const hasChartData = chartData.length > 0 && visibleMetrics.length > 0;

  if (isLoading || !user || user.activeRole !== 'doctor') {
    return <PageLoader label="Loading vital readings..." />;
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'IoT', href: '/doctor/iot/patients' }, { label: 'Vital Readings' }]} />
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          <button
            onClick={() => router.push('/doctor/iot/patients')}
            className="self-start inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-[#1e3fae] transition-colors"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Back to IoT Monitoring
          </button>

          <PageHeader
            title="Patient Vital Readings"
            subtitle={`Patient ID: ${shortId(params.id)}`}
          />

          {/* Summary stat cards */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon="favorite"
              label="Latest HR"
              value={latestHeartRate ? `${latestHeartRate.value}` : '—'}
              note={latestHeartRate ? `${latestHeartRate.unit} · ${formatTimeAxis(latestHeartRate.recorded_at)}` : 'No reading'}
              tone="red"
            />
            <StatCard
              icon="water_drop"
              label="Latest SpO2"
              value={latestSpo2 ? `${latestSpo2.value}` : '—'}
              note={latestSpo2 ? `${latestSpo2.unit} · ${formatTimeAxis(latestSpo2.recorded_at)}` : 'No reading'}
              tone="blue"
            />
            <StatCard
              icon="thermostat"
              label="Latest Temp"
              value={latestTemp ? `${latestTemp.value}` : '—'}
              note={latestTemp ? `${latestTemp.unit} · ${formatTimeAxis(latestTemp.recorded_at)}` : 'No reading'}
              tone="amber"
            />
            <StatCard
              icon="monitor_heart"
              label="Total readings"
              value={readings.length}
              tone="slate"
            />
          </section>

          <ResourceState
            isLoading={resource.isLoading}
            error={resource.error}
            isEmpty={!resource.isLoading && !resource.error && readings.length === 0}
            onRetry={resource.reload}
            loadingLabel="Loading vital readings..."
            forbiddenTitle="Readings unavailable"
            errorTitle="Vital readings could not be loaded"
            emptyTitle="No vital readings"
            emptyBody="This patient has no readings in the available range."
            emptyIcon="monitor_heart"
          />

          {readings.length > 0 && (
            <>
              <FilterPills
                tabs={FILTER_TABS}
                activeKey={metricFilter}
                onSelect={setMetricFilter}
              />

              {hasChartData && (
                <ChartCard title="Vital Signs Over Time" height="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="recorded_at"
                        tickFormatter={formatTimeAxis}
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        stroke="#cbd5e1"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        stroke="#cbd5e1"
                      />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend
                        formatter={(value: string) => METRIC_LABEL[value as ChartMetric] ?? humaniseMetric(value)}
                        wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                      />
                      {visibleMetrics.includes('heart_rate') && (
                        <Line type="monotone" dataKey="heart_rate" name="Heart rate" stroke={METRIC_COLOUR.heart_rate} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      )}
                      {visibleMetrics.includes('oxygen_saturation') && (
                        <Line type="monotone" dataKey="oxygen_saturation" name="SpO2" stroke={METRIC_COLOUR.oxygen_saturation} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      )}
                      {visibleMetrics.includes('body_temperature') && (
                        <Line type="monotone" dataKey="body_temperature" name="Temperature" stroke={METRIC_COLOUR.body_temperature} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      )}
                      {visibleMetrics.includes('blood_pressure') && (
                        <Line type="monotone" dataKey="blood_pressure" name="Blood pressure" stroke={METRIC_COLOUR.blood_pressure} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}

              {/* Readings table */}
              <SectionCard title="Readings" bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr className="text-xs font-bold text-slate-500 uppercase">
                        <th className="px-6 py-3">Recorded</th>
                        <th className="px-6 py-3">Metric</th>
                        <th className="px-6 py-3">Value</th>
                        <th className="px-6 py-3">Quality</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tableRows.map((r: VitalReading) => {
                        const abnormal = isAbnormal(r.metric, r.value);
                        return (
                          <tr
                            key={r.id}
                            className={abnormal ? 'bg-red-50/40 hover:bg-red-50/60' : 'hover:bg-slate-50'}
                          >
                            <td className="px-6 py-4 text-slate-600 whitespace-nowrap">
                              {new Date(r.recorded_at).toLocaleString()}
                            </td>
                            <td className="px-6 py-4">
                              <span className="inline-flex items-center gap-2">
                                <span className="material-symbols-outlined text-slate-400 text-base">{metricIcon(r.metric)}</span>
                                <span className="text-slate-700">{humaniseMetric(r.metric)}</span>
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`font-bold ${abnormal ? 'text-red-600' : 'text-slate-900'}`}>{r.value}</span>
                              <span className="text-slate-400 ml-1 text-xs">{r.unit}</span>
                            </td>
                            <td className="px-6 py-4">
                              <Badge tone={qualityTone(r.quality)}>{r.quality}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          )}

          {/* ── Health alerts ─────────────────────────────────────────────── */}
          <SectionCard
            title="Health alerts"
            action={
              <button
                type="button"
                onClick={() => alerts.reload()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                aria-label="Refresh alerts"
              >
                <span className="material-symbols-outlined text-base">refresh</span>
                Refresh
              </button>
            }
          >
            <ResourceState
              isLoading={alerts.isLoading}
              error={alerts.error}
              isEmpty={
                !alerts.isLoading &&
                !alerts.error &&
                (alerts.data?.data.length ?? 0) === 0
              }
              onRetry={alerts.reload}
              loadingLabel="Loading health alerts..."
              errorTitle="Could not load health alerts"
              forbiddenTitle="You cannot view these health alerts"
              emptyTitle="No health alerts"
              emptyBody="No threshold breaches have been raised for this patient."
              emptyIcon="notifications_active"
            />
            {alerts.data && alerts.data.data.length > 0 && (
              <div className="grid gap-3">
                {[...alerts.data.data]
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .map((alert) => {
                    const state = alert.state as HealthAlertState;
                    const isOpen = state === 'open';
                    const isAcknowledged = state === 'acknowledged';
                    const ackBusy = ackBusyId === alert.id;
                    return (
                      <div
                        key={alert.id}
                        className="rounded-lg border border-slate-200 p-4 flex flex-col gap-3 hover:bg-slate-50/60 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="material-symbols-outlined text-slate-400 text-xl shrink-0">
                              {metricIcon(alert.metric)}
                            </span>
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900 text-sm">
                                {humaniseMetric(alert.metric)}
                                <span className="text-slate-500 font-semibold ml-1.5">
                                  {alert.observed_value}
                                </span>
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                Observed {formatInstant(alert.observed_at)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge tone={severityTone(alert.severity)}>
                              {humaniseCode(alert.severity)}
                            </Badge>
                            <Badge tone={alertStateTone(state)}>
                              {humaniseCode(state)}
                            </Badge>
                          </div>
                        </div>

                        {(isOpen || isAcknowledged) && (
                          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-100">
                            {isOpen && (
                              <button
                                type="button"
                                onClick={() => handleAcknowledge(alert)}
                                disabled={ackBusyId !== null}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
                              >
                                <span className="material-symbols-outlined text-base">check</span>
                                {ackBusy ? 'Acknowledging...' : 'Acknowledge'}
                              </button>
                            )}
                            {isAcknowledged && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => { setWriteError(null); setTransitionTarget({ alertId: alert.id, action: 'escalated' }); }}
                                  disabled={isTransitioning}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 transition-colors disabled:opacity-50"
                                >
                                  <span className="material-symbols-outlined text-base">arrow_upward</span>
                                  Escalate
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setWriteError(null); setTransitionTarget({ alertId: alert.id, action: 'resolved' }); }}
                                  disabled={isTransitioning}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 transition-colors disabled:opacity-50"
                                >
                                  <span className="material-symbols-outlined text-base">task_alt</span>
                                  Resolve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setWriteError(null); setTransitionTarget({ alertId: alert.id, action: 'dismissed' }); }}
                                  disabled={isTransitioning}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
                                >
                                  <span className="material-symbols-outlined text-base">do_not_disturb_on</span>
                                  Dismiss
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                <p className="text-xs text-slate-400 mt-1">
                  {alerts.data.data.length} {alerts.data.data.length === 1 ? 'alert' : 'alerts'}
                  {alerts.data.page.has_more ? ' · more available' : ''}
                </p>
              </div>
            )}

            {writeError && !transitionTarget && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                <p className="text-sm font-bold text-red-700">
                  {writeError.isConflict ? 'Conflict — the alert changed' : writeError.title}
                </p>
                <p className="text-xs text-red-600 mt-1">{writeError.message}</p>
                {writeError.correlationId && (
                  <p className="text-xs text-red-400 mt-1">Reference: <code>{writeError.correlationId}</code></p>
                )}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {transitionTarget && transitionAlert && (
        <AlertTransitionModal
          alert={transitionAlert}
          action={transitionTarget.action}
          isSaving={isTransitioning}
          error={writeError}
          onClose={() => { setTransitionTarget(null); setWriteError(null); }}
          onSubmit={(body) => runTransition(transitionAlert, body)}
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Health alert transition modal                                               */
/* -------------------------------------------------------------------------- */

type AlertTransitionAction = 'escalated' | 'resolved' | 'dismissed';

interface AlertTransitionModalProps {
  alert: HealthAlert;
  action: AlertTransitionAction;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (body: TransitionHealthAlertRequest) => void;
}

const ACTION_LABEL: Record<AlertTransitionAction, string> = {
  escalated: 'Escalate',
  resolved: 'Resolve',
  dismissed: 'Dismiss',
};

function AlertTransitionModal({ alert, action, isSaving, error, onClose, onSubmit }: AlertTransitionModalProps) {
  const [reasonCode, setReasonCode] = useState('');
  const [escalatedTo, setEscalatedTo] = useState('');

  // Escalation requires a target membership; resolve/dismiss only need a reason.
  const canSubmit =
    !isSaving &&
    reasonCode.trim() !== '' &&
    (action !== 'escalated' || escalatedTo.trim() !== '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      state: action,
      reason_code: reasonCode.trim(),
      escalated_to_membership_id: action === 'escalated' ? escalatedTo.trim() : null,
      expected_version: alert.version,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">{ACTION_LABEL[action]} alert</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form id="alert-transition-form" onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
            <p><span className="font-bold">Metric:</span> {humaniseMetric(alert.metric)} · {alert.observed_value}</p>
            <p className="mt-1"><span className="font-bold">Severity:</span> {humaniseCode(alert.severity)}</p>
          </div>
          {action === 'escalated' && (
            <label className="flex flex-col gap-1">
              <span className="text-sm font-bold text-slate-700">Escalate to membership ID <span className="text-red-500">*</span></span>
              <input
                value={escalatedTo}
                onChange={(e) => setEscalatedTo(e.target.value)}
                placeholder="Paste a doctor membership UUID..."
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-mono"
                required
              />
              <span className="text-xs text-slate-400">The membership to hand this alert off to.</span>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-slate-700">Reason <span className="text-red-500">*</span></span>
            <input
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              placeholder="e.g. referred_to_cardiology, false_alarm, patient_reviewed"
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
              required
            />
            <span className="text-xs text-slate-400">A short reason code explaining this transition.</span>
          </label>
        </form>

        {error && (
          <div className="mx-6 mb-2 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
            <p className="text-sm font-bold text-red-700">
              {error.isConflict
                ? 'Conflict — the alert changed; reopen to retry'
                : error.isForbidden
                  ? 'You cannot transition this alert'
                  : error.title}
            </p>
            <p className="text-xs text-red-600 mt-1">{error.message}</p>
            {error.correlationId && (
              <p className="text-xs text-red-400 mt-1">Reference: <code>{error.correlationId}</code></p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 px-6 pb-6 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" form="alert-transition-form" disabled={!canSubmit} className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50">
            {isSaving ? `${ACTION_LABEL[action]}...` : ACTION_LABEL[action]}
          </button>
        </div>
      </div>
    </div>
  );
}
