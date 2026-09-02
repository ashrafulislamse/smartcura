'use client';

/**
 * Appointments, wired to GET /appointments.
 *
 * THE SCOPE IS NOT A CHOICE THIS PAGE MAKES. The repository selects one predicate from the
 * caller's role — own bookings for a patient, own clinic for a doctor, the whole organization
 * for an administrator — so there is no scope selector and no `site_id` field. Adding one
 * would imply an authority the session does not grant.
 *
 * RECONCILIATION. The mock carried a patient name, a doctor name, an avatar and a free-text
 * reason. The API carries `patient_profile_id` and `doctor_membership_id`; the DOCTOR is
 * resolvable through the approved-doctor directory, which is one of only two endpoints that
 * return another person's name, and the PATIENT is not resolvable at all. So the doctor is
 * named where the directory knows them and the patient is shown by identifier. The reason
 * field is removed rather than filled with something plausible — nothing models it.
 *
 * A NULL PAYMENT STATE IS NOT AN UNPAID ONE. The contract says null means the fee was zero
 * and no payment aggregate was ever created, so a free appointment has no payment to be in a
 * state. Rendering null as "pending" would invent a debt.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  APPOINTMENT_MODE_ICON,
  APPOINTMENT_STATUS_STYLE,
  PAYMENT_STATE_STYLE,
  listAppointments,
  type AppointmentStatus,
} from '@/lib/api/appointments';
import { formatSen, humaniseCode, listDoctors, shortId } from '@/lib/api/directory';
import TopBar from '@/components/layout/TopBar';

const FILTERS: ReadonlyArray<{ key: 'all' | AppointmentStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'pending_payment', label: 'Awaiting payment' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'no_show', label: 'No show' },
];

function formatInstant(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

function isToday(value: string): boolean {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  return (
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate()
  );
}

export default function AppointmentsPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [status, setStatus] = useState<'all' | AppointmentStatus>('all');

  const appointments = useApiResource(
    (signal) =>
      listAppointments({
        status: status === 'all' ? undefined : status,
        pageSize: 100,
        signal,
      }),
    [status],
  );

  /**
   * The doctor directory, read once, purely to put names against `doctor_membership_id`.
   * It is a separate request because no appointment response carries a name, and it is
   * tolerated failing: a missing directory should degrade the page to identifiers, not
   * break it, so its error is never surfaced as an appointments failure.
   */
  const doctors = useApiResource((signal) => listDoctors({ signal }), []);

  const doctorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const doctor of doctors.data?.data ?? []) {
      map.set(doctor.membership_id, doctor.display_name);
    }
    return map;
  }, [doctors.data]);

  const rows = useMemo(() => appointments.data?.data ?? [], [appointments.data]);
  const hasMore = appointments.data?.page?.has_more ?? false;

  /**
   * Soonest first among those still live, then everything closed. An appointment list is
   * read to find what happens next, so ordering by when it was created would bury the
   * imminent booking under whatever was entered most recently.
   */
  const ordered = useMemo(() => {
    const isActive = (value: string) =>
      ACTIVE_APPOINTMENT_STATUSES.some((candidate) => candidate === value);
    return [...rows].sort((left, right) => {
      const byState = Number(isActive(right.status)) - Number(isActive(left.status));
      if (byState !== 0) return byState;
      return left.starts_at.localeCompare(right.starts_at);
    });
  }, [rows]);

  const todayCount = useMemo(() => rows.filter((row) => isToday(row.starts_at)).length, [rows]);
  const activeCount = useMemo(
    () =>
      rows.filter((row) =>
        ACTIVE_APPOINTMENT_STATUSES.some((candidate) => candidate === row.status),
      ).length,
    [rows],
  );
  /** Free appointments, which have no payment aggregate at all rather than an unpaid one. */
  const freeCount = useMemo(() => rows.filter((row) => row.fee_sen === 0).length, [rows]);

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Appointments' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Appointments</h1>
            <p className="text-slate-500 mt-1">
              Scoped to your role automatically. Soonest live bookings first.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { icon: 'event', tint: 'text-blue-600', label: 'In view', value: String(rows.length), note: hasMore ? 'more available' : 'all loaded' },
              { icon: 'today', tint: 'text-indigo-600', label: 'Today', value: String(todayCount), note: 'Starting today' },
              { icon: 'pending', tint: 'text-amber-600', label: 'Live', value: String(activeCount), note: 'Not yet concluded' },
              { icon: 'money_off', tint: 'text-slate-600', label: 'No fee', value: String(freeCount), note: 'No payment created' },
            ].map((card) => (
              <div key={card.label} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className={`material-symbols-outlined ${card.tint} text-2xl`}>{card.icon}</span>
                  <span className="text-xs font-bold text-slate-500">{card.label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">
                  {appointments.isLoading ? '—' : card.value}
                </p>
                <p className="text-xs text-slate-500 mt-1">{card.note}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                onClick={() => setStatus(option.key)}
                className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  status === option.key
                    ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <ResourceState
            isLoading={appointments.isLoading}
            error={appointments.error}
            isEmpty={ordered.length === 0}
            onRetry={appointments.reload}
            loadingLabel="Loading appointments…"
            forbiddenTitle="You cannot view appointments"
            errorTitle="Could not load appointments"
            emptyTitle={status === 'all' ? 'No appointments yet' : `No ${humaniseCode(status)} appointments`}
            emptyBody="Bookings appear here once a slot is taken."
            emptyIcon="event_busy"
          />

          {!appointments.isLoading && !appointments.error && ordered.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Appointments with live bookings first, then by start time
                </caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">When</th>
                    <th scope="col" className="px-5 py-3">Doctor</th>
                    <th scope="col" className="px-5 py-3">Patient</th>
                    <th scope="col" className="px-5 py-3">Mode</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3">Payment</th>
                    <th scope="col" className="px-5 py-3 text-right">Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ordered.map((row) => {
                    const doctorName = doctorNames.get(row.doctor_membership_id);
                    return (
                      <tr
                        key={row.id}
                        onClick={() => router.push(`/appointments/${row.id}`)}
                        className={`cursor-pointer hover:bg-slate-50 transition-colors ${
                          isToday(row.starts_at) ? 'bg-blue-50/20' : ''
                        }`}
                      >
                        <td className="px-5 py-3">
                          <span className="font-bold text-slate-900">{formatInstant(row.starts_at)}</span>
                          <span className="block text-xs text-slate-400">
                            until {formatInstant(row.ends_at)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {/*
                            Named where the directory knows them, identified where it does not.
                            An unapproved or unlisted doctor is absent from the directory, so
                            the identifier is the honest fallback rather than a blank cell.
                          */}
                          {doctorName ? (
                            <span className="text-slate-900">{doctorName}</span>
                          ) : (
                            <code className="text-slate-500">{shortId(row.doctor_membership_id)}</code>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {/* No endpoint resolves a patient name, so this is an identifier. */}
                          <code className="text-slate-500">{shortId(row.patient_profile_id)}</code>
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5 text-slate-700">
                            <span className="material-symbols-outlined text-[18px]">
                              {APPOINTMENT_MODE_ICON[
                                row.mode as keyof typeof APPOINTMENT_MODE_ICON
                              ] ?? 'help'}
                            </span>
                            {humaniseCode(row.mode)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                              APPOINTMENT_STATUS_STYLE[
                                row.status as keyof typeof APPOINTMENT_STATUS_STYLE
                              ] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                            }`}
                          >
                            {humaniseCode(row.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {/*
                            NULL IS NOT "PENDING". The contract states null means the fee was
                            zero and no payment aggregate was created, so there is no payment
                            to have a state. Showing "pending" here would invent a debt.
                          */}
                          {row.payment_state === null ? (
                            <span className="text-xs text-slate-400">No payment</span>
                          ) : (
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                                PAYMENT_STATE_STYLE[
                                  row.payment_state as keyof typeof PAYMENT_STATE_STYLE
                                ] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                              }`}
                            >
                              {humaniseCode(row.payment_state)}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-slate-900">
                          {formatSen(row.fee_sen, row.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!appointments.isLoading && !appointments.error && ordered.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{ordered.length}</span> appointment
              {ordered.length === 1 ? '' : 's'}
              {hasMore && ' — more available; filter by status to narrow'}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
