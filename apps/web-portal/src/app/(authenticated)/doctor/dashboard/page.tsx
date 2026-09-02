'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  readDoctorDashboard,
  DOCTOR_DASHBOARD_GROUPS,
  DOCTOR_DASHBOARD_GROUP_LABEL,
  type DoctorDashboardGroup,
} from '@/lib/api/doctor-api';
import { listDoctorPatients, type DoctorAssignedPatient } from '@/lib/api/doctor-patients';
import { listPatientVitalReadings } from '@/lib/api/iot';
import { formatInstant, humaniseCode, shortId, initials } from '@/lib/api/directory';
import { ApiError } from '@/lib/api/client';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import SectionCard from '@/components/ui/section-card';
import ChartCard from '@/components/ui/chart-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { VitalReading, VitalMetric } from '@/types/contracts';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

/**
 * KPI card metadata. Each dashboard group maps to a Material Symbol icon, an accent colour
 * and a short human note. The key set is exhaustive over the generated group vocabulary, so
 * an invented group cannot be rendered.
 */
const KPI_META: Readonly<
  Record<Exclude<DoctorDashboardGroup, 'upcoming_appointments'>, { icon: string; tone: string; note: string }>
> = {
  today_appointments: { icon: 'event', tone: 'bg-blue-50 text-blue-600', note: 'Bookings for today' },
  assigned_patients: { icon: 'groups', tone: 'bg-teal-50 text-teal-600', note: 'In your caseload' },
  pending_notes: { icon: 'edit_note', tone: 'bg-amber-50 text-amber-600', note: 'Notes to complete' },
  unread_notifications: { icon: 'notifications', tone: 'bg-purple-50 text-purple-600', note: 'Unread for you' },
  active_iot_alerts: { icon: 'monitor_heart', tone: 'bg-red-50 text-red-600', note: 'Need attention' },
};

const MODE_ICON: Readonly<Record<string, string>> = {
  video: 'videocam',
  audio: 'call',
  chat: 'chat',
  in_person: 'person',
};

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  pending_payment: 'amber',
  confirmed: 'blue',
  checked_in: 'indigo',
  in_progress: 'purple',
  cancelled: 'red',
  completed: 'green',
  no_show: 'orange',
  rescheduled: 'slate',
};

/** Heart rate, SpO₂ and temperature classification for the monitoring cards. */
function classifyVital(metric: VitalMetric, value: number): { label: string; color: string; tone: BadgeTone } {
  switch (metric) {
    case 'heart_rate': {
      if (value < 60) return { label: 'Low', color: 'text-amber-600', tone: 'amber' };
      if (value > 100) return { label: 'High', color: 'text-red-600', tone: 'red' };
      return { label: 'Normal', color: 'text-emerald-600', tone: 'green' };
    }
    case 'oxygen_saturation': {
      if (value < 95) return { label: 'Low', color: 'text-red-600', tone: 'red' };
      return { label: 'Normal', color: 'text-emerald-600', tone: 'green' };
    }
    case 'body_temperature': {
      if (value < 36.1) return { label: 'Low', color: 'text-amber-600', tone: 'amber' };
      if (value > 37.2) return { label: 'High', color: 'text-red-600', tone: 'red' };
      return { label: 'Normal', color: 'text-emerald-600', tone: 'green' };
    }
    default:
      return { label: 'Recorded', color: 'text-slate-600', tone: 'slate' };
  }
}

function vitalIcon(metric: VitalMetric): string {
  switch (metric) {
    case 'heart_rate':
      return 'favorite';
    case 'oxygen_saturation':
      return 'air';
    case 'body_temperature':
      return 'thermometer';
    default:
      return 'monitor_heart';
  }
}

function vitalLabel(metric: VitalMetric): string {
  switch (metric) {
    case 'heart_rate':
      return 'Heart Rate';
    case 'oxygen_saturation':
      return 'SpO₂';
    case 'body_temperature':
      return 'Temperature';
    default:
      return 'Vital';
  }
}

function vitalUnit(metric: VitalMetric, fallback: string): string {
  switch (metric) {
    case 'heart_rate':
      return '/min';
    case 'oxygen_saturation':
      return '%';
    case 'body_temperature':
      return '°C';
    default:
      return fallback;
  }
}

function formatTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatTodayDate(): string {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** A tiny SVG sparkline for the monitoring cards. */
function MiniSparkline({ data, color }: { data: readonly number[]; color: string }) {
  if (data.length < 2) {
    return <div className="h-8 w-full rounded bg-slate-50" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 120;
  const height = 32;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-full overflow-visible" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(' ')}
      />
    </svg>
  );
}

export default function DoctorDashboard() {
  const router = useRouter();
  const { user, profile, isLoading: authLoading } = useAuth();

  const dashboard = useApiResource(readDoctorDashboard, []);
  const patients = useApiResource((signal) => listDoctorPatients({ pageSize: 100, signal }), []);

  const displayName = profile?.display_name ?? user?.name ?? 'Doctor';

  const summary = dashboard.data;
  const groups = summary?.data;
  const readable = new Set<string>(summary?.readable_groups ?? []);
  const hasGroup = (name: DoctorDashboardGroup) => readable.has(name) && groups?.[name] !== undefined;

  const upcoming = useMemo(() => groups?.upcoming_appointments ?? [], [groups]);
  const sortedUpcoming = useMemo(
    () => [...upcoming].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [upcoming],
  );

  const todayAppointments = useMemo(
    () =>
      sortedUpcoming.filter((a) => {
        const d = new Date(a.starts_at);
        return !Number.isNaN(d.getTime()) && isSameDay(d, new Date());
      }),
    [sortedUpcoming],
  );

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    patients.data?.data.forEach((p: DoctorAssignedPatient) => map.set(p.profile_id, p.display_name));
    return map;
  }, [patients.data]);

  const nextPatientId = sortedUpcoming[0]?.patient_profile_id ?? '';
  const nextPatientName = nameMap.get(nextPatientId) ?? '';

  // Manual vitals fetch so it can be skipped cleanly when there is no next patient.
  const [vitals, setVitals] = useState<readonly VitalReading[] | null>(null);
  const [vitalsLoading, setVitalsLoading] = useState(false);
  const [vitalsError, setVitalsError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!nextPatientId) {
      setVitals(null);
      setVitalsLoading(false);
      setVitalsError(null);
      return;
    }
    const controller = new AbortController();
    setVitalsLoading(true);
    setVitalsError(null);
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    listPatientVitalReadings(nextPatientId, { from, to: now.toISOString(), limit: 200, signal: controller.signal })
      .then((res) => setVitals(res.data))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setVitalsError(caught instanceof ApiError ? caught : null);
      })
      .finally(() => setVitalsLoading(false));
    return () => controller.abort();
  }, [nextPatientId]);

  const hrTrendData = useMemo(() => {
    return (vitals ?? [])
      .filter((r) => r.metric === 'heart_rate')
      .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
      .map((r) => ({
        label: formatDateShort(r.recorded_at),
        time: formatTime(r.recorded_at),
        value: r.value,
      }));
  }, [vitals]);

  useEffect(() => {
    if (user && user.activeRole !== 'doctor') router.replace('/dashboard');
  }, [user, router]);

  if (authLoading || !user) return <PageLoader label="Loading your dashboard..." />;
  if (user.activeRole !== 'doctor') return null;

  const kpiGroups = DOCTOR_DASHBOARD_GROUPS.filter(
    (name) => name !== 'upcoming_appointments',
  ) as readonly Exclude<DoctorDashboardGroup, 'upcoming_appointments'>[];

  const latestHeartRate = vitals?.filter((r) => r.metric === 'heart_rate').sort(
    (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
  )[0];
  const latestSpO2 = vitals?.filter((r) => r.metric === 'oxygen_saturation').sort(
    (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
  )[0];
  const latestTemp = vitals?.filter((r) => r.metric === 'body_temperature').sort(
    (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
  )[0];

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Dashboard' }]} />

      <div className="flex-1 overflow-y-auto p-6 lg:p-8 scroll-smooth">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
          <ResourceState
            isLoading={dashboard.isLoading}
            error={dashboard.error}
            isEmpty={!dashboard.isLoading && !dashboard.error && !summary}
            onRetry={dashboard.reload}
            loadingLabel="Loading your practice summary..."
            errorTitle="Could not load your dashboard"
            forbiddenTitle="You cannot view this dashboard"
            emptyTitle="Dashboard unavailable"
            emptyBody="The backend returned no dashboard summary for this membership."
            emptyIcon="dashboard"
          />

          {summary && (
            <>
              {/* Greeting hero */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e3fae] to-[#0f2470] p-6 sm:p-8 shadow-lg text-white">
                <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                  <div>
                    <p className="text-blue-100 font-medium">{greeting()},</p>
                    <h1 className="text-2xl sm:text-3xl font-extrabold mt-1 tracking-tight">Dr. {displayName}</h1>
                    <p className="text-blue-200 text-sm mt-1">{formatTodayDate()}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => router.push('/notifications')}
                      className="relative p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
                      aria-label="Notifications"
                    >
                      <span className="material-symbols-outlined">notifications</span>
                      {hasGroup('unread_notifications') && (groups!.unread_notifications as number) > 0 && (
                        <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold border-2 border-[#1e3fae]">
                          {(groups!.unread_notifications as number) > 9 ? '9+' : groups!.unread_notifications}
                        </span>
                      )}
                    </button>
                    <div className="flex items-center gap-3">
                      <div className="text-right hidden sm:block">
                        <p className="text-sm font-bold">{displayName}</p>
                        <p className="text-xs text-blue-200">Doctor</p>
                      </div>
                      <div className="size-12 rounded-full bg-white/20 border-2 border-white/30 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                        {initials(displayName)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* KPI grid */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {kpiGroups.map((name) => {
                  if (!hasGroup(name)) return null;
                  const meta = KPI_META[name];
                  const value = groups![name] as number;
                  return (
                    <button
                      key={name}
                      onClick={() => {
                        if (name === 'today_appointments') router.push('/doctor/appointments');
                        if (name === 'assigned_patients') router.push('/doctor/patients');
                        if (name === 'pending_notes') router.push('/doctor/notes');
                        if (name === 'unread_notifications') router.push('/notifications');
                        if (name === 'active_iot_alerts') router.push('/doctor/patients');
                      }}
                      className="group text-left bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md hover:border-blue-200 transition-all"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <span
                          className={cn(
                            'material-symbols-outlined text-2xl p-2.5 rounded-xl',
                            meta.tone,
                          )}
                        >
                          {meta.icon}
                        </span>
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                          {DOCTOR_DASHBOARD_GROUP_LABEL[name]}
                        </span>
                      </div>
                      <p className="text-3xl font-extrabold text-slate-900 tracking-tight group-hover:text-[#1e3fae] transition-colors">
                        {value}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{meta.note}</p>
                    </button>
                  );
                })}
              </section>

              {/* Main workspace */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Left column: appointments + trend */}
                <div className="xl:col-span-2 flex flex-col gap-6">
                  <SectionCard
                    title="Today's Appointments"
                    action={
                      <button
                        onClick={() => router.push('/doctor/appointments')}
                        className="text-sm font-bold text-[#1e3fae] hover:text-[#0f2470] flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-base">calendar_month</span>
                        View Calendar
                      </button>
                    }
                  >
                    {todayAppointments.length === 0 ? (
                      <div className="text-center py-10">
                        <span className="material-symbols-outlined text-slate-300 text-5xl">event_busy</span>
                        <h3 className="font-bold text-slate-900 mt-3">No appointments today</h3>
                        <p className="text-sm text-slate-500 mt-1">Your schedule is clear. New bookings will appear here.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto -mx-6 px-6">
                        <table className="w-full min-w-[600px]">
                          <thead>
                            <tr className="border-b border-slate-100 text-left">
                              <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Time</th>
                              <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Patient</th>
                              <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Type</th>
                              <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Status</th>
                              <th className="pb-3 text-xs font-bold text-slate-500 uppercase tracking-wide text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {todayAppointments.map((row) => {
                              const modeIcon = MODE_ICON[row.mode] ?? 'help';
                              const statusTone = STATUS_TONE[row.status] ?? 'slate';
                              const patientName = nameMap.get(row.patient_profile_id) ?? `Patient ${shortId(row.patient_profile_id)}`;
                              return (
                                <tr key={row.appointment_id} className="hover:bg-slate-50/60 transition-colors">
                                  <td className="py-4">
                                    <p className="text-sm font-bold text-slate-900">{formatTime(row.starts_at)}</p>
                                    <p className="text-xs text-slate-400">{formatDateShort(row.starts_at)}</p>
                                  </td>
                                  <td className="py-4">
                                    <p className="text-sm font-bold text-slate-900">{patientName}</p>
                                    <p className="text-xs text-slate-400">{shortId(row.patient_profile_id)}</p>
                                  </td>
                                  <td className="py-4">
                                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                                      <span className="material-symbols-outlined text-sm">{modeIcon}</span>
                                      {humaniseCode(row.mode)}
                                    </span>
                                  </td>
                                  <td className="py-4">
                                    <Badge tone={statusTone}>{humaniseCode(row.status)}</Badge>
                                  </td>
                                  <td className="py-4 text-right">
                                    <button
                                      onClick={() => router.push(`/doctor/appointments/${row.appointment_id}`)}
                                      className="inline-flex items-center gap-1 text-xs font-bold text-[#1e3fae] hover:text-[#0f2470] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                                    >
                                      Manage
                                      <span className="material-symbols-outlined text-sm">chevron_right</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </SectionCard>

                  <ChartCard
                    title="7-Day Heart Rate Trend"
                    action={
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                        <span className="material-symbols-outlined text-sm">favorite</span>
                        Heart Rate
                      </span>
                    }
                    height="h-[260px]"
                  >
                    {hrTrendData.length < 2 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center">
                        <span className="material-symbols-outlined text-slate-300 text-5xl">show_chart</span>
                        <h3 className="font-bold text-slate-900 mt-3">Not enough data</h3>
                        <p className="text-sm text-slate-500 mt-1">At least two heart-rate readings are needed to draw a trend.</p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={hrTrendData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
                          <defs>
                            <linearGradient id="hrGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11, fill: '#64748b' }}
                            tickLine={false}
                            axisLine={{ stroke: '#cbd5e1' }}
                            minTickGap={24}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: '#64748b' }}
                            tickLine={false}
                            axisLine={{ stroke: '#cbd5e1' }}
                            width={40}
                            domain={['auto', 'auto']}
                          />
                          <Tooltip
                            contentStyle={{
                              borderRadius: '0.75rem',
                              border: '1px solid #e2e8f0',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                              fontSize: '0.875rem',
                            }}
                            labelStyle={{ color: '#334155', fontWeight: 700 }}
                            formatter={(value: number) => [`${value} /min`, 'Heart Rate']}
                          />
                          <Area
                            type="monotone"
                            dataKey="value"
                            stroke="#ef4444"
                            strokeWidth={2.5}
                            fill="url(#hrGradient)"
                            dot={{ r: 3, fill: '#ef4444', strokeWidth: 0 }}
                            activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </ChartCard>
                </div>

                {/* Right column: monitoring + schedule + AI */}
                <div className="flex flex-col gap-6">
                  <SectionCard
                    title="Patient Monitoring"
                    action={
                      nextPatientName ? (
                        <span className="text-xs font-bold text-slate-500 truncate max-w-[140px]">{nextPatientName}</span>
                      ) : null
                    }
                  >
                    {vitalsLoading ? (
                      <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-1 gap-4">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="h-[124px] rounded-xl bg-slate-100 animate-pulse" />
                        ))}
                      </div>
                    ) : vitalsError ? (
                      <div className="text-center py-6">
                        <p className="text-sm text-red-600">Could not load vitals.</p>
                        <button
                          onClick={() => window.location.reload()}
                          className="mt-2 text-xs font-bold text-[#1e3fae] hover:underline"
                        >
                          Retry
                        </button>
                      </div>
                    ) : !latestHeartRate && !latestSpO2 && !latestTemp ? (
                      <div className="text-center py-8">
                        <span className="material-symbols-outlined text-slate-300 text-4xl">monitor_heart</span>
                        <h3 className="font-bold text-slate-900 mt-2 text-sm">No live vitals</h3>
                        <p className="text-xs text-slate-500 mt-1">
                          {nextPatientName
                            ? 'The next patient has no recent vitals.'
                            : 'Bookings with connected devices will show live vitals here.'}
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-1 gap-4">
                        {[latestHeartRate, latestSpO2, latestTemp]
                          .filter((r): r is VitalReading => !!r)
                          .map((reading) => {
                            const status = classifyVital(reading.metric, reading.value);
                            const metric = reading.metric;
                            const icon = vitalIcon(metric);
                            const label = vitalLabel(metric);
                            const unit = vitalUnit(metric, reading.unit);
                            const color =
                              metric === 'heart_rate'
                                ? '#ef4444'
                                : metric === 'oxygen_saturation'
                                  ? '#0ea5e9'
                                  : '#f59e0b';
                            const trendValues = (vitals ?? [])
                              .filter((r) => r.metric === metric)
                              .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
                              .map((r) => r.value);
                            return (
                              <div
                                key={metric}
                                className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow"
                              >
                                <div className="flex items-center gap-3 mb-3">
                                  <span
                                    className="material-symbols-outlined text-xl p-2 rounded-lg"
                                    style={{ color, backgroundColor: `${color}15` }}
                                  >
                                    {icon}
                                  </span>
                                  <span className="text-sm font-bold text-slate-700">{label}</span>
                                </div>
                                <div className="flex items-end gap-1.5 mb-2">
                                  <span className="text-2xl font-extrabold text-slate-900 tracking-tight">
                                    {metric === 'oxygen_saturation' ? Math.round(reading.value) : reading.value.toFixed(1)}
                                  </span>
                                  <span className="text-xs text-slate-500 mb-1">{unit}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <span className={cn('size-2 rounded-full', status.color.replace('text-', 'bg-'))} />
                                    <span className={cn('text-xs font-bold', status.color)}>{status.label}</span>
                                  </div>
                                  <div className="w-16">
                                    <MiniSparkline data={trendValues} color={color} />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard
                    title="Today's Schedule"
                    action={
                      <button
                        onClick={() => router.push('/doctor/appointments')}
                        className="text-xs font-bold text-[#1e3fae] hover:text-[#0f2470]"
                      >
                        View full schedule
                      </button>
                    }
                  >
                    {sortedUpcoming.length === 0 ? (
                      <div className="text-center py-8">
                        <span className="material-symbols-outlined text-slate-300 text-4xl">schedule</span>
                        <h3 className="font-bold text-slate-900 mt-2 text-sm">No upcoming slots</h3>
                        <p className="text-xs text-slate-500 mt-1">Your schedule is empty for the next 24 hours.</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {sortedUpcoming.slice(0, 5).map((appt) => {
                          const patientName = nameMap.get(appt.patient_profile_id) ?? `Patient ${shortId(appt.patient_profile_id)}`;
                          return (
                            <div
                              key={appt.appointment_id}
                              className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                              onClick={() => router.push(`/doctor/appointments/${appt.appointment_id}`)}
                            >
                              <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
                              <div className="w-14 shrink-0">
                                <p className="text-sm font-bold text-slate-900">{formatTime(appt.starts_at)}</p>
                              </div>
                              <p className="text-sm font-semibold text-slate-700 truncate">{patientName}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </SectionCard>

                  {/* AI support card */}
                  <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e3fae] to-[#0f2470] p-6 text-white shadow-lg">
                    <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2.5 rounded-xl bg-white/15">
                          <span className="material-symbols-outlined text-2xl">auto_awesome</span>
                        </div>
                        <h3 className="text-lg font-extrabold">AI Support</h3>
                      </div>
                      <p className="text-sm text-blue-100 leading-relaxed">
                        Summarize patient visits, draft clinical notes, review AI artifacts, and more.
                      </p>
                      <p className="text-xs text-blue-200 mt-1 font-medium">Non-diagnostic · Human review required</p>
                      <button
                        onClick={() => router.push('/doctor/ai/assistant')}
                        className="mt-5 w-full bg-white text-[#0f2470] font-extrabold text-sm py-3 px-4 rounded-xl hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
                      >
                        <span className="material-symbols-outlined text-base">psychology</span>
                        Open AI Assistant
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
