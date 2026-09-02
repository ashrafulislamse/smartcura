'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import StatCard from '@/components/ui/stat-card';
import FilterPills from '@/components/ui/filter-pills';
import SearchInput from '@/components/ui/search-input';
import Badge from '@/components/ui/badge';
import type { BadgeTone } from '@/components/ui/badge';
import {
  listAppointments,
  APPOINTMENT_MODE_ICON,
  type AppointmentStatus,
} from '@/lib/api/appointments';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';
import type { Appointment } from '@/types/contracts';

type FilterKey = 'all' | AppointmentStatus;

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'checked_in', label: 'Checked in' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'no_show', label: 'No show' },
];

/** Map every known appointment status to a Badge tone, in one place. */
const STATUS_TONE: Record<Exclude<AppointmentStatus, string>, BadgeTone> = {
  pending_payment: 'amber',
  confirmed: 'blue',
  checked_in: 'indigo',
  in_progress: 'purple',
  cancelled: 'red',
  completed: 'green',
  no_show: 'orange',
  rescheduled: 'slate',
};

function statusTone(status: AppointmentStatus): BadgeTone {
  return STATUS_TONE[status as Exclude<AppointmentStatus, string>] ?? 'slate';
}

function isToday(iso: string): boolean {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  return (
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate()
  );
}

export default function DoctorAppointmentsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const appointments = useApiResource(
    (signal) =>
      listAppointments({
        status: status === 'all' ? undefined : status,
        pageSize: 100,
        signal,
      }),
    [status],
  );

  const allRows = useMemo(
    () =>
      [...(appointments.data?.data ?? [])].sort((a, b) =>
        a.starts_at.localeCompare(b.starts_at),
      ),
    [appointments.data],
  );

  // KPI counts are derived from the unfiltered, unsearched full set so the cards stay
  // stable while the user filters the table below. We re-derive on every render from the
  // already-fetched page, never issuing a second request.
  const counts = useMemo(() => {
    const source = appointments.data?.data ?? [];
    return {
      today: source.filter((row) => isToday(row.starts_at)).length,
      upcoming: source.filter((row) =>
        ['pending_payment', 'confirmed', 'checked_in', 'in_progress'].includes(
          row.status,
        ),
      ).length,
      completed: source.filter((row) => row.status === 'completed').length,
      cancelled: source.filter((row) =>
        ['cancelled', 'no_show'].includes(row.status),
      ).length,
    };
  }, [appointments.data]);

  // The visible table is the fetched page filtered by the search box. The status filter is
  // applied server-side via listAppointments, so we only narrow by text here.
  const rows = useMemo(() => {
    if (query.trim() === '') return allRows;
    const needle = query.trim().toLowerCase();
    return allRows.filter((row: Appointment) => {
      return (
        shortId(row.patient_profile_id).toLowerCase().includes(needle) ||
        humaniseCode(row.status).toLowerCase().includes(needle) ||
        humaniseCode(row.mode).toLowerCase().includes(needle) ||
        formatInstant(row.starts_at).toLowerCase().includes(needle)
      );
    });
  }, [allRows, query]);

  if (authLoading || !user) {
    return (
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
        <PageLoader label="Loading appointments..." />
      </main>
    );
  }
  if (user.activeRole !== 'doctor') return null;

  const loadedCount = appointments.data?.data?.length ?? 0;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Appointments' }]} />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="My appointments"
            subtitle="Bookings are scoped to your doctor membership."
          />

          {/* KPI row — derived from the loaded page, not from a second request. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon="event_available"
              label="Today"
              value={counts.today}
              tone="blue"
              note="Scheduled today"
            />
            <StatCard
              icon="upcoming"
              label="Upcoming"
              value={counts.upcoming}
              tone="teal"
              note="Active commitments"
            />
            <StatCard
              icon="task_alt"
              label="Completed"
              value={counts.completed}
              tone="green"
              note="Session finished"
            />
            <StatCard
              icon="event_busy"
              label="Cancelled"
              value={counts.cancelled}
              tone="red"
              note="Cancelled or no-show"
            />
          </div>

          {/* Controls row — filter pills and search share one bar. */}
          <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
            <FilterPills
              tabs={FILTERS}
              activeKey={status}
              onSelect={(key) => setStatus(key)}
            />
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search patient, status, mode..."
              className="md:w-72"
            />
          </div>

          <ResourceState
            isLoading={appointments.isLoading}
            error={appointments.error}
            isEmpty={
              !appointments.isLoading &&
              !appointments.error &&
              allRows.length === 0
            }
            onRetry={appointments.reload}
            loadingLabel="Loading appointments..."
            errorTitle="Could not load appointments"
            forbiddenTitle="You cannot view appointments"
            emptyTitle="No appointments"
            emptyBody="Appointments appear here when patients book your slots."
            emptyIcon="event_busy"
          />

          {!appointments.isLoading && !appointments.error && rows.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase">
                    <th className="px-5 py-3">When</th>
                    <th className="px-5 py-3">Patient profile</th>
                    <th className="px-5 py-3">Mode</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Payment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => router.push(`/doctor/appointments/${row.id}`)}
                      className="cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-5 py-4">
                        <b className="text-slate-900">{formatInstant(row.starts_at)}</b>
                        <span className="block text-xs text-slate-400">
                          until {formatInstant(row.ends_at)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <code className="text-slate-700">{shortId(row.patient_profile_id)}</code>
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1.5 text-slate-700">
                          <span className="material-symbols-outlined text-[#1e3fae] text-lg">
                            {APPOINTMENT_MODE_ICON[row.mode as keyof typeof APPOINTMENT_MODE_ICON] ?? 'help'}
                          </span>
                          {humaniseCode(row.mode)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <Badge tone={statusTone(row.status)}>
                          {humaniseCode(row.status)}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {row.payment_state
                          ? humaniseCode(row.payment_state)
                          : row.fee_sen === 0
                            ? 'No fee'
                            : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
                Showing {rows.length} of {loadedCount} loaded appointments
              </div>
            </div>
          )}

          {/* Searched-but-empty: the page had rows but none matched the query. */}
          {!appointments.isLoading &&
            !appointments.error &&
            allRows.length > 0 &&
            rows.length === 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
                <span className="material-symbols-outlined text-slate-300 text-5xl">search_off</span>
                <h2 className="font-bold text-slate-900 mt-3">No matches</h2>
                <p className="text-sm text-slate-500 mt-1">
                  No appointments match &ldquo;{query}&rdquo;. Try a different search term.
                </p>
              </div>
            )}
        </div>
      </div>
    </main>
  );
}
