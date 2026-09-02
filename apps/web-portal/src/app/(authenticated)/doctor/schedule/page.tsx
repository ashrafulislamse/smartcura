'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge from '@/components/ui/badge';
import type { BadgeTone } from '@/components/ui/badge';
import { ApiError } from '@/lib/api/client';
import { listAppointments } from '@/lib/api/appointments';
import {
  generateAvailabilitySlots,
  getAvailabilityRules,
  listAvailabilitySlots,
  recordAvailabilityException,
  replaceAvailabilityRules,
} from '@/lib/api/availability';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';
import type {
  Appointment,
  AppointmentStatus,
  AvailabilityExceptionReasonCode,
  AvailabilityRule,
  AvailabilityRuleInput,
  AvailabilitySlot,
  GenerateAvailabilitySlotsRequest,
  RecordAvailabilityExceptionRequest,
  UnknownEnumValue,
} from '@/types/contracts';

// ── Calendar constants ────────────────────────────────────────────────────
// One hour = 60px, one 30-min slot = 30px. The visible window is 08:00–20:00,
// which covers a typical clinic day. Appointments outside this window are
// clamped to the grid edges so a 07:30 booking still shows at the top.
const START_HOUR = 8;
const END_HOUR = 20;
const HOUR_HEIGHT = 60; // px per hour
const TOTAL_HOURS = END_HOUR - START_HOUR;
const TOTAL_HEIGHT = TOTAL_HOURS * HOUR_HEIGHT; // 720px
const GRID_START_MIN = START_HOUR * 60;
const GRID_END_MIN = END_HOUR * 60;

// 0 = Sunday … 6 = Saturday, matching PostgreSQL EXTRACT(DOW) and the
// availability_rules.weekday CHECK constraint.
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns the Monday of the week containing `date` (local time, midnight). */
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7; // days since Monday (0=Mon … 6=Sun)
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Stable YYYY-MM-DD key from a Date, using local time. */
function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Parse a LocalTime string ("09:00" or "09:00:00") into hours/minutes. */
function parseTime(time: string): { hours: number; minutes: number } {
  const parts = time.split(':');
  return { hours: Number(parts[0]) ?? 0, minutes: Number(parts[1]) ?? 0 };
}

/** Pixel offset of a minute-of-day within the 08:00-anchored grid. */
function minutesToTop(minutes: number): number {
  return ((minutes - GRID_START_MIN) / 60) * HOUR_HEIGHT;
}

interface Layout {
  top: number;
  height: number;
}

/** Position + height for an appointment card, clamped to the grid window. */
function appointmentLayout(startsAt: string, endsAt: string): Layout {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = end.getHours() * 60 + end.getMinutes();
  const clampedStart = Math.max(startMin, GRID_START_MIN);
  const clampedEnd = Math.min(endMin, GRID_END_MIN);
  return {
    top: minutesToTop(clampedStart),
    height: Math.max(((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT, 18),
  };
}

/** Position + height for an availability-rule background block. */
function availabilityLayout(rule: AvailabilityRule): Layout {
  const s = parseTime(rule.start_time);
  const e = parseTime(rule.end_time);
  const startMin = s.hours * 60 + s.minutes;
  const endMin = e.hours * 60 + e.minutes;
  const clampedStart = Math.max(startMin, GRID_START_MIN);
  const clampedEnd = Math.min(endMin, GRID_END_MIN);
  return {
    top: minutesToTop(clampedStart),
    height: ((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT,
  };
}

/** Background class for an appointment card based on its status. */
function appointmentBgClass(status: AppointmentStatus): string {
  const known = status as Exclude<AppointmentStatus, string>;
  switch (known) {
    case 'pending_payment':
      return 'bg-[#1e3fae]/60';
    case 'confirmed':
    case 'checked_in':
      return 'bg-[#1e3fae]';
    case 'in_progress':
      return 'bg-[#5b21b6]';
    case 'completed':
      return 'bg-slate-500';
    case 'cancelled':
    case 'no_show':
      return 'bg-slate-400';
    case 'rescheduled':
      return 'bg-slate-300';
    default:
      return 'bg-slate-400';
  }
}

// ── Availability editor vocabulary ──────────────────────────────────────────

// The backend's `AvailabilityExceptionReasonCode` enum, declared once so the
// exception modal's <select> cannot drift from it. Keyed over the known members
// only; UnknownEnumValue is the generated forward-compatibility escape hatch.
type KnownExceptionReason = Exclude<AvailabilityExceptionReasonCode, UnknownEnumValue>;
const EXCEPTION_REASONS: ReadonlyArray<{ value: KnownExceptionReason; label: string }> = [
  { value: 'annual_leave', label: 'Annual leave' },
  { value: 'sick_leave', label: 'Sick leave' },
  { value: 'public_holiday', label: 'Public holiday' },
  { value: 'training', label: 'Training' },
  { value: 'administrative_block', label: 'Administrative block' },
  { value: 'clinic_closure', label: 'Clinic closure' },
  { value: 'schedule_correction', label: 'Schedule correction' },
  { value: 'emergency_cover', label: 'Emergency cover' },
];

// Slot state → badge tone. A switch with a default is the type-safe pattern for
// the generated union that includes UnknownEnumValue.
function slotStateTone(state: AvailabilitySlot['state']): BadgeTone {
  switch (state) {
    case 'open': return 'green';
    case 'held': return 'amber';
    case 'booked': return 'blue';
    case 'closed': return 'slate';
    default: return 'slate';
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function MySchedule() {
  const router = useRouter();
  const { user, isLoading: authLoading, activeMembership } = useAuth();
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(new Date()));

  const appointments = useApiResource(
    (signal) => listAppointments({ pageSize: 100, signal }),
    [],
  );
  const availability = useApiResource(
    (signal) =>
      activeMembership
        ? getAvailabilityRules(activeMembership.id, signal)
        : Promise.reject(new Error('No active membership')),
    [activeMembership],
  );

  // Generated bookable slots, loaded independently so a failed slot generation
  // does not blank the calendar or the rules.
  const slots = useApiResource(
    (signal) =>
      activeMembership
        ? listAvailabilitySlots(activeMembership.id, { pageSize: 100, signal })
        : Promise.reject(new Error('No active membership')),
    [activeMembership],
  );

  // ── Mutation state ────────────────────────────────────────────────────────
  // One busy flag + one error for the whole page because the three mutation
  // surfaces (rules editor, exception, slot generation) are mutually exclusive
  // modals — only one is open at a time.
  const [isSaving, setIsSaving] = useState(false);
  const [writeError, setWriteError] = useState<ApiError | null>(null);
  const [showRulesEditor, setShowRulesEditor] = useState(false);
  const [showException, setShowException] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);

  const runWrite = useCallback(
    async (
      operation: () => Promise<unknown>,
      afterSuccess: () => void,
      reloads: ReadonlyArray<() => void> = [],
    ) => {
      if (isSaving) return;
      setIsSaving(true);
      setWriteError(null);
      try {
        await operation();
        afterSuccess();
        reloads.forEach((reload) => reload());
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setWriteError(apiError);
        // A 409 means someone else wrote first: re-read so the next attempt uses
        // the fresh version, mirroring the optimistic-concurrency contract.
        if (apiError.isConflict) reloads.forEach((reload) => reload());
      } finally {
        setIsSaving(false);
      }
    },
    [isSaving],
  );

  // The seven day-columns for the displayed week (Mon … Sun).
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [weekStart],
  );

  // Group appointments by date so each column can render its own set.
  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const row of appointments.data?.data ?? []) {
      const key = dateKey(new Date(row.starts_at));
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    // Sort each day's appointments by start time.
    for (const list of map.values()) {
      list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    }
    return map;
  }, [appointments.data]);

  // Group availability rules by weekday for the background shading.
  const rulesByWeekday = useMemo(() => {
    const map = new Map<number, AvailabilityRule[]>();
    for (const rule of availability.data?.data ?? []) {
      if (!rule.is_active) continue;
      const list = map.get(rule.weekday);
      if (list) list.push(rule);
      else map.set(rule.weekday, [rule]);
    }
    return map;
  }, [availability.data]);

  const sortedRules = useMemo(
    () =>
      [...(availability.data?.data ?? [])].sort((a, b) => {
        if (a.weekday !== b.weekday) return a.weekday - b.weekday;
        return a.start_time.localeCompare(b.start_time);
      }),
    [availability.data],
  );

  // Current-time indicator: only on today's column, only if now is in the grid window.
  const now = new Date();
  const todayKey = dateKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNowLine =
    nowMin >= GRID_START_MIN && nowMin <= GRID_END_MIN && days.some((d) => dateKey(d) === todayKey);
  const nowTop = minutesToTop(nowMin);

  // Week range label for the header.
  const weekEnd = days[6]!;
  const weekLabel = `${days[0]!.toLocaleDateString('en-MY', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-MY', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  function prevWeek() {
    setWeekStart((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() - 7);
      return n;
    });
  }
  function nextWeek() {
    setWeekStart((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 7);
      return n;
    });
  }
  function thisWeek() {
    setWeekStart(getMondayOfWeek(new Date()));
  }

  if (authLoading || !user) {
    return (
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
        <PageLoader label="Loading schedule..." />
      </main>
    );
  }
  if (user.activeRole !== 'doctor') return null;

  return (
    <main className="flex-1 overflow-y-auto bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Schedule' }]} />
      <div className="p-8">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="My Schedule"
            subtitle="Your weekly appointments and availability rules."
            actions={
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-700 mr-2 hidden sm:inline">{weekLabel}</span>
                <button
                  onClick={prevWeek}
                  className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                  aria-label="Previous week"
                >
                  <span className="material-symbols-outlined text-lg">chevron_left</span>
                </button>
                <button
                  onClick={thisWeek}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Today
                </button>
                <button
                  onClick={nextWeek}
                  className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                  aria-label="Next week"
                >
                  <span className="material-symbols-outlined text-lg">chevron_right</span>
                </button>
              </div>
            }
          />

          {/* ── Week calendar ──────────────────────────────────────────── */}
          <SectionCard
            title={`Week of ${days[0]!.toLocaleDateString('en-MY', { month: 'long', day: 'numeric' })}`}
            bodyClassName="p-0 overflow-x-auto"
          >
            <div className="min-w-[760px]">
              {/* Day headers */}
              <div className="flex border-b border-slate-200">
                <div className="w-16 shrink-0" />
                {days.map((day, i) => {
                  const isToday = dateKey(day) === todayKey;
                  return (
                    <div
                      key={i}
                      className="flex-1 text-center py-3 border-l border-slate-100 first:border-l-0"
                    >
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                        {WEEKDAY_NAMES[(i + 1) % 7].slice(0, 3)}
                      </p>
                      <p
                        className={[
                          'text-lg font-bold mt-0.5',
                          isToday ? 'text-[#1e3fae]' : 'text-slate-900',
                        ].join(' ')}
                      >
                        {day.getDate()}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Calendar body */}
              <div className="flex relative">
                {/* Time labels */}
                <div className="w-16 shrink-0 relative" style={{ height: TOTAL_HEIGHT }}>
                  {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
                    <div
                      key={i}
                      className="absolute right-2 -translate-y-1/2 text-xs text-slate-400 font-medium"
                      style={{ top: i * HOUR_HEIGHT }}
                    >
                      {String(START_HOUR + i).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                <div className="flex-1 grid grid-cols-7 relative" style={{ height: TOTAL_HEIGHT }}>
                  {days.map((day, i) => {
                    const dayKey = dateKey(day);
                    const dbWeekday = (i + 1) % 7; // Mon=1 … Sun=0
                    const isToday = dayKey === todayKey;
                    const dayAppointments = appointmentsByDay.get(dayKey) ?? [];
                    const dayRules = rulesByWeekday.get(dbWeekday) ?? [];

                    return (
                      <div
                        key={i}
                        className={[
                          'relative border-l border-slate-100 first:border-l-0',
                          isToday ? 'bg-blue-50/30' : '',
                        ].join(' ')}
                        style={{ height: TOTAL_HEIGHT }}
                      >
                        {/* Hour grid lines */}
                        {Array.from({ length: TOTAL_HOURS + 1 }, (_, h) => (
                          <div
                            key={h}
                            className="absolute left-0 right-0 border-t border-slate-100"
                            style={{ top: h * HOUR_HEIGHT }}
                          />
                        ))}

                        {/* Half-hour grid lines (lighter) */}
                        {Array.from({ length: TOTAL_HOURS }, (_, h) => (
                          <div
                            key={`half-${h}`}
                            className="absolute left-0 right-0 border-t border-slate-50"
                            style={{ top: h * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                          />
                        ))}

                        {/* Availability shading */}
                        {dayRules.map((rule) => {
                          const layout = availabilityLayout(rule);
                          if (layout.height <= 0) return null;
                          return (
                            <div
                              key={rule.id}
                              className="absolute left-0 right-0 bg-[#1e3fae]/[0.04] border-x border-[#1e3fae]/10"
                              style={{ top: layout.top, height: layout.height }}
                            />
                          );
                        })}

                        {/* Appointment cards */}
                        {dayAppointments.map((row) => {
                          const layout = appointmentLayout(row.starts_at, row.ends_at);
                          return (
                            <button
                              key={row.id}
                              onClick={() => router.push(`/doctor/appointments/${row.id}`)}
                              className={[
                                'absolute left-0.5 right-0.5 rounded-md shadow-sm overflow-hidden text-white text-left transition-all hover:shadow-md hover:brightness-110 cursor-pointer',
                                appointmentBgClass(row.status),
                              ].join(' ')}
                              style={{ top: layout.top, height: layout.height }}
                              title={`${formatInstant(row.starts_at)} – ${formatInstant(row.ends_at)}\n${humaniseCode(row.status)}`}
                            >
                              <div className="p-1.5 leading-tight">
                                <p className="font-bold text-[11px] truncate">
                                  {shortId(row.patient_profile_id)}
                                </p>
                                {layout.height > 36 && (
                                  <p className="text-[10px] opacity-90 truncate">
                                    {humaniseCode(row.mode)}
                                  </p>
                                )}
                                {layout.height > 56 && (
                                  <p className="text-[10px] opacity-75 truncate mt-0.5">
                                    {formatInstant(row.starts_at).split(',')[1]?.trim() ?? ''}
                                  </p>
                                )}
                              </div>
                            </button>
                          );
                        })}

                        {/* Current-time indicator */}
                        {isToday && showNowLine && (
                          <div
                            className="absolute left-0 right-0 z-10 flex items-center"
                            style={{ top: nowTop }}
                          >
                            <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                            <div className="flex-1 h-0.5 bg-red-500" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Appointment loading/error state — separate from the calendar so the
              grid can still render availability shading while appointments load. */}
          {appointments.error && (
            <ResourceState
              isLoading={false}
              error={appointments.error}
              isEmpty={false}
              onRetry={appointments.reload}
              loadingLabel="Loading appointments..."
              errorTitle="Could not load appointments"
              forbiddenTitle="You cannot view appointments"
              emptyTitle=""
              emptyBody=""
              emptyIcon=""
            />
          )}

          {/* ── Availability rules ─────────────────────────────────────── */}
          <SectionCard
            title="Weekly availability rules"
            action={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setWriteError(null); setShowException(true); }}
                  disabled={!availability.data}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-base">event_busy</span>
                  Add exception
                </button>
                <button
                  type="button"
                  onClick={() => { setWriteError(null); setShowRulesEditor(true); }}
                  disabled={!availability.data}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border border-[#1e3fae] bg-[#1e3fae] text-white hover:bg-[#173080] transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-base">edit_calendar</span>
                  Edit rules
                </button>
              </div>
            }
          >
            <ResourceState
              isLoading={availability.isLoading}
              error={availability.error}
              isEmpty={
                !availability.isLoading &&
                !availability.error &&
                (availability.data?.data.length ?? 0) === 0
              }
              onRetry={availability.reload}
              loadingLabel="Loading availability..."
              errorTitle="Could not load availability"
              forbiddenTitle="You cannot view availability rules"
              emptyTitle="No availability rules"
              emptyBody="No weekly availability rules are configured for this doctor membership."
              emptyIcon="schedule"
            />
            {availability.data && sortedRules.length > 0 && (
              <div className="grid gap-3">
                {sortedRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center gap-4 p-4 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[#1e3fae] text-xl shrink-0">
                      calendar_today
                    </span>
                    <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-slate-400 uppercase font-bold tracking-wide">Day</p>
                        <p className="font-bold text-slate-900 text-sm mt-0.5">
                          {WEEKDAY_NAMES[rule.weekday] ?? `Weekday ${rule.weekday}`}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 uppercase font-bold tracking-wide">Hours</p>
                        <p className="font-bold text-slate-900 text-sm mt-0.5">
                          {rule.start_time} – {rule.end_time}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 uppercase font-bold tracking-wide">Slot duration</p>
                        <p className="font-bold text-slate-900 text-sm mt-0.5">
                          {rule.slot_duration_minutes} min
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 uppercase font-bold tracking-wide">Timezone</p>
                        <p className="font-bold text-slate-900 text-sm mt-0.5 truncate">
                          {rule.timezone}
                        </p>
                      </div>
                    </div>
                    <Badge tone={rule.is_active ? 'green' : 'slate'} className="shrink-0">
                      {rule.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                ))}
                <p className="text-xs text-slate-400 mt-2">
                  Revision {availability.data.version} · {sortedRules.length}{' '}
                  {sortedRules.length === 1 ? 'rule' : 'rules'}
                </p>
              </div>
            )}
          </SectionCard>

          {/* ── Generated bookable slots ─────────────────────────────────── */}
          <SectionCard
            title="Generated bookable slots"
            action={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setWriteError(null); setShowGenerate(true); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border border-[#1e3fae] bg-[#1e3fae] text-white hover:bg-[#173080] transition-colors"
                >
                  <span className="material-symbols-outlined text-base">auto_awesome</span>
                  Generate slots
                </button>
                <button
                  type="button"
                  onClick={() => slots.reload()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                  aria-label="Refresh slots"
                >
                  <span className="material-symbols-outlined text-base">refresh</span>
                  Refresh
                </button>
              </div>
            }
          >
            <ResourceState
              isLoading={slots.isLoading}
              error={slots.error}
              isEmpty={
                !slots.isLoading &&
                !slots.error &&
                (slots.data?.data.length ?? 0) === 0
              }
              onRetry={slots.reload}
              loadingLabel="Loading generated slots..."
              errorTitle="Could not load generated slots"
              forbiddenTitle="You cannot view your availability slots"
              emptyTitle="No generated slots"
              emptyBody="Generate slots from your weekly rules to populate a bookable horizon."
              emptyIcon="event_available"
            />
            {slots.data && slots.data.data.length > 0 && (
              <div className="grid gap-2">
                {[...slots.data.data]
                  .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                  .map((slot) => (
                    <div
                      key={slot.id}
                      className="flex items-center gap-4 p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[#1e3fae] text-lg shrink-0">
                        event_available
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900 text-sm">
                          {new Date(slot.starts_at).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(slot.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {' – '}
                          {new Date(slot.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <Badge tone={slotStateTone(slot.state)} className="shrink-0">
                        {humaniseCode(slot.state)}
                      </Badge>
                    </div>
                  ))}
                <p className="text-xs text-slate-400 mt-1">
                  {slots.data.data.length} {slots.data.data.length === 1 ? 'slot' : 'slots'}
                  {slots.data.page.has_more ? ' · more available' : ''}
                </p>
              </div>
            )}
          </SectionCard>

          {/* Inline error from the last write when no modal is open */}
          {writeError && !showRulesEditor && !showException && !showGenerate && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4" role="alert">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600">error</span>
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900">
                    {writeError.isConflict ? 'Conflict — availability changed' : writeError.title}
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">{writeError.message}</p>
                  {writeError.correlationId && (
                    <p className="text-xs text-slate-400 mt-1">
                      Reference: <code>{writeError.correlationId}</code>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Mutation modals ─────────────────────────────────────────────────── */}
      {showRulesEditor && availability.data && activeMembership && (
        <RulesEditorModal
          initialRules={availability.data.data}
          isSaving={isSaving}
          error={writeError}
          onClose={() => { setShowRulesEditor(false); setWriteError(null); }}
          onSubmit={(rules) =>
            runWrite(
              () =>
                replaceAvailabilityRules(activeMembership.id, {
                  rules,
                  expected_version: availability.data!.version,
                }),
              () => { setShowRulesEditor(false); setWriteError(null); },
              [availability.reload, slots.reload],
            )
          }
        />
      )}
      {showException && availability.data && activeMembership && (
        <ExceptionModal
          expectedVersion={availability.data.version}
          isSaving={isSaving}
          error={writeError}
          onClose={() => { setShowException(false); setWriteError(null); }}
          onSubmit={(body) =>
            runWrite(
              () => recordAvailabilityException(activeMembership.id, body, crypto.randomUUID()),
              () => { setShowException(false); setWriteError(null); },
              [availability.reload, slots.reload],
            )
          }
        />
      )}
      {showGenerate && activeMembership && (
        <GenerateSlotsModal
          isSaving={isSaving}
          error={writeError}
          onClose={() => { setShowGenerate(false); setWriteError(null); }}
          onSubmit={(body) =>
            runWrite(
              () => generateAvailabilitySlots(activeMembership.id, body, crypto.randomUUID()),
              () => { setShowGenerate(false); setWriteError(null); },
              [slots.reload],
            )
          }
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Availability rules editor modal                                             */
/* -------------------------------------------------------------------------- */

interface RuleDraft {
  weekday: string;
  start_time: string;
  end_time: string;
  slot_duration_minutes: string;
  timezone: string;
  effective_from: string;
  effective_to: string;
}

function emptyRuleDraft(timezone: string, today: string): RuleDraft {
  return {
    weekday: '1', // Monday
    start_time: '09:00',
    end_time: '17:00',
    slot_duration_minutes: '30',
    timezone,
    effective_from: today,
    effective_to: '',
  };
}

function ruleToDraft(rule: AvailabilityRule, fallbackTz: string): RuleDraft {
  return {
    weekday: String(rule.weekday),
    start_time: rule.start_time.slice(0, 5),
    end_time: rule.end_time.slice(0, 5),
    slot_duration_minutes: String(rule.slot_duration_minutes),
    timezone: rule.timezone || fallbackTz,
    effective_from: rule.effective_from,
    effective_to: rule.effective_to ?? '',
  };
}

interface RulesEditorModalProps {
  initialRules: ReadonlyArray<AvailabilityRule>;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (rules: ReadonlyArray<AvailabilityRuleInput>) => void;
}

function RulesEditorModal({ initialRules, isSaving, error, onClose, onSubmit }: RulesEditorModalProps) {
  const today = dateKey(new Date());
  const fallbackTz = initialRules[0]?.timezone ?? 'Asia/Kuala_Lumpur';
  const [drafts, setDrafts] = useState<RuleDraft[]>(() =>
    initialRules.length > 0
      ? initialRules.map((rule) => ruleToDraft(rule, fallbackTz))
      : [emptyRuleDraft(fallbackTz, today)],
  );

  function updateDraft(index: number, field: keyof RuleDraft, value: string) {
    setDrafts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }
  function addDraft() {
    setDrafts((prev) => [...prev, emptyRuleDraft(fallbackTz, today)]);
  }
  function removeDraft(index: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  // A draft is valid when it has a weekday, a non-empty start before end, a
  // positive slot duration, a timezone and an effective-from date.
  const canSubmit =
    !isSaving &&
    drafts.length > 0 &&
    drafts.every((d) => {
      const hasDay = d.weekday.trim() !== '';
      const hasTimes =
        d.start_time.trim() !== '' && d.end_time.trim() !== '' && d.start_time < d.end_time;
      const hasDuration = d.slot_duration_minutes.trim() !== '' && Number(d.slot_duration_minutes) > 0;
      const hasTz = d.timezone.trim() !== '';
      const hasFrom = d.effective_from.trim() !== '';
      return hasDay && hasTimes && hasDuration && hasTz && hasFrom;
    });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const rules: AvailabilityRuleInput[] = drafts.map((d) => ({
      weekday: Number(d.weekday),
      start_time: d.start_time,
      end_time: d.end_time,
      slot_duration_minutes: Number(d.slot_duration_minutes),
      timezone: d.timezone.trim(),
      effective_from: d.effective_from,
      effective_to: d.effective_to.trim() || null,
    }));
    onSubmit(rules);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Edit weekly availability</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Replaces the entire rule set and regenerates the slot horizon.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form id="rules-editor-form" onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-700">Weekly rules</span>
            <button type="button" onClick={addDraft} className="inline-flex items-center gap-1 text-sm font-bold text-[#1e3fae] hover:underline">
              <span className="material-symbols-outlined text-base">add</span>
              Add rule
            </button>
          </div>

          {drafts.map((draft, index) => (
            <div key={index} className="rounded-lg border border-slate-200 p-4 space-y-3 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Rule {index + 1}</span>
                {drafts.length > 1 && (
                  <button type="button" onClick={() => removeDraft(index)} className="text-slate-400 hover:text-red-600 transition-colors" aria-label={`Remove rule ${index + 1}`}>
                    <span className="material-symbols-outlined text-base">remove_circle</span>
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-600">Day</span>
                  <select
                    value={draft.weekday}
                    onChange={(e) => updateDraft(index, 'weekday', e.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    {WEEKDAY_NAMES.map((name, wd) => (
                      <option key={wd} value={String(wd)}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-600">Start time</span>
                  <input type="time" value={draft.start_time} onChange={(e) => updateDraft(index, 'start_time', e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-600">End time</span>
                  <input type="time" value={draft.end_time} onChange={(e) => updateDraft(index, 'end_time', e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-600">Slot duration (min)</span>
                  <input type="number" min={1} value={draft.slot_duration_minutes} onChange={(e) => updateDraft(index, 'slot_duration_minutes', e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-600">Timezone</span>
                  <input value={draft.timezone} onChange={(e) => updateDraft(index, 'timezone', e.target.value)} placeholder="Asia/Kuala_Lumpur" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-600">Effective from</span>
                  <input type="date" value={draft.effective_from} onChange={(e) => updateDraft(index, 'effective_from', e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" required />
                </label>
                <label className="flex flex-col gap-1 md:col-span-3">
                  <span className="text-xs font-bold text-slate-600">Effective to (optional)</span>
                  <input type="date" value={draft.effective_to} onChange={(e) => updateDraft(index, 'effective_to', e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
              </div>
            </div>
          ))}
        </form>

        {error && (
          <div className="mx-6 mb-2 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
            <p className="text-sm font-bold text-red-700">
              {error.isConflict
                ? 'Conflict — the rule set changed'
                : error.isForbidden
                  ? 'You cannot edit availability rules'
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
          <button type="submit" form="rules-editor-form" disabled={!canSubmit} className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50">
            {isSaving ? 'Saving...' : 'Save rules'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Availability exception modal                                                */
/* -------------------------------------------------------------------------- */

interface ExceptionModalProps {
  expectedVersion: number;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (body: RecordAvailabilityExceptionRequest) => void;
}

function ExceptionModal({ expectedVersion, isSaving, error, onClose, onSubmit }: ExceptionModalProps) {
  const today = dateKey(new Date());
  const [exceptionDate, setExceptionDate] = useState(today);
  const [isUnavailable, setIsUnavailable] = useState(true);
  const [reasonCode, setReasonCode] = useState<KnownExceptionReason>('annual_leave');
  const [replacementStart, setReplacementStart] = useState('');
  const [replacementEnd, setReplacementEnd] = useState('');

  // When offering a replacement window, the start must precede the end if both
  // are supplied. A fully unavailable day needs only a date and a reason.
  const canSubmit =
    !isSaving &&
    exceptionDate.trim() !== '' &&
    (isUnavailable || replacementStart === '' || replacementEnd === '' || replacementStart < replacementEnd);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      exception_date: exceptionDate,
      is_unavailable: isUnavailable,
      replacement_start_time: isUnavailable ? null : (replacementStart || null),
      replacement_end_time: isUnavailable ? null : (replacementEnd || null),
      reason_code: reasonCode,
      expected_version: expectedVersion,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Add availability exception</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form id="exception-form" onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-slate-700">Exception date <span className="text-red-500">*</span></span>
            <input type="date" value={exceptionDate} onChange={(e) => setExceptionDate(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm" required />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isUnavailable} onChange={(e) => setIsUnavailable(e.target.checked)} className="rounded border-slate-300" />
            <span className="text-sm font-bold text-slate-700">Unavailable all day (closes existing slots)</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-slate-700">Reason <span className="text-red-500">*</span></span>
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as KnownExceptionReason)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
              {EXCEPTION_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>{reason.label}</option>
              ))}
            </select>
          </label>
          {!isUnavailable && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-600">Replacement start</span>
                <input type="time" value={replacementStart} onChange={(e) => setReplacementStart(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-600">Replacement end</span>
                <input type="time" value={replacementEnd} onChange={(e) => setReplacementEnd(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
              <p className="col-span-2 text-xs text-slate-500">
                Leave blank to remove all slots for that date with no replacement window.
              </p>
            </div>
          )}
        </form>

        {error && (
          <div className="mx-6 mb-2 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
            <p className="text-sm font-bold text-red-700">
              {error.isConflict
                ? 'Conflict — the rule set changed; reopen to retry'
                : error.isForbidden
                  ? 'You cannot record an exception'
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
          <button type="submit" form="exception-form" disabled={!canSubmit} className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50">
            {isSaving ? 'Saving...' : 'Record exception'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Generate slots modal                                                        */
/* -------------------------------------------------------------------------- */

interface GenerateSlotsModalProps {
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (body: GenerateAvailabilitySlotsRequest) => void;
}

function GenerateSlotsModal({ isSaving, error, onClose, onSubmit }: GenerateSlotsModalProps) {
  const today = dateKey(new Date());
  const horizonEnd = new Date();
  horizonEnd.setDate(horizonEnd.getDate() + 28);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(dateKey(horizonEnd));

  const canSubmit = !isSaving && fromDate.trim() !== '' && toDate.trim() !== '' && fromDate <= toDate;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ from_date: fromDate, to_date: toDate });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Generate bookable slots</h2>
            <p className="text-xs text-slate-500 mt-0.5">Idempotent: re-running over the same range is safe.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form id="generate-form" onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-slate-700">From date <span className="text-red-500">*</span></span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm" required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-slate-700">To date <span className="text-red-500">*</span></span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm" required />
          </label>
        </form>

        {error && (
          <div className="mx-6 mb-2 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
            <p className="text-sm font-bold text-red-700">
              {error.isForbidden ? 'You cannot generate slots' : error.title}
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
          <button type="submit" form="generate-form" disabled={!canSubmit} className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50">
            {isSaving ? 'Generating...' : 'Generate slots'}
          </button>
        </div>
      </div>
    </div>
  );
}
