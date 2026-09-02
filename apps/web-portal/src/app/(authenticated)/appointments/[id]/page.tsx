'use client';

/**
 * Appointment detail, wired to GET /appointments/{id}.
 *
 * RECONCILIATION. The mock carried a patient name and avatar, a doctor name/specialty/avatar,
 * a free-text reason, a diagnosis, a prescription status, symptoms, vitals, a session id, a
 * service name/type, a decimal fee and a payment status. Of these the API models only the fee
 * (integer sen), the payment state, the mode, the status, and the two party identifiers. The
 * doctor is named through the approved-doctor directory — one of two endpoints that return
 * another person's name — and the patient is shown by identifier because nothing resolves it.
 * Reason, diagnosis, prescription status, symptoms and vitals are REMOVED rather than filled
 * with something plausible: they live on separate resources (clinical notes, prescriptions)
 * that this endpoint does not join, and inventing them would be the cached-fabrication this
 * schema was designed to prevent.
 *
 * AN APPOINTMENT DOES NOT STORE ITS OWN TIMES. `starts_at` and `ends_at` live on
 * `appointment_slots` and are projected through the join, so the detail can never disagree with
 * the slot it occupies. Duration is derived from those two instants, not stored.
 *
 * A 404 IS NOT ONLY "DOES NOT EXIST". The API declines to confirm a record the caller cannot
 * read, answering 404 rather than 403, so "not found" here may also mean "not yours".
 *
 * NULL PAYMENT STATE IS NOT AN UNPAID ONE. Null means the fee was zero and no payment aggregate
 * was ever created, so a free appointment has no payment to have a state.
 */

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  APPOINTMENT_MODE_ICON,
  APPOINTMENT_STATUS_STYLE,
  PAYMENT_STATE_STYLE,
  createConsultation,
  createConsultationRoomToken,
  getAppointment,
} from '@/lib/api/appointments';
import { formatInstant, formatSen, humaniseCode, listDoctors, shortId } from '@/lib/api/directory';
import TopBar from '@/components/layout/TopBar';
import type { Appointment } from '@/types/contracts';

/** Minutes between two instants. An appointment has no stored duration; it is derived. */
function durationMinutes(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return '—';
  return String(Math.round((end - start) / 60000));
}

export default function AppointmentDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const appointmentId = String(params.id);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);

  const appointment = useApiResource(
    (signal) => getAppointment(appointmentId, signal),
    [appointmentId],
  );

  /**
   * The doctor directory, read once, purely to put a name against `doctor_membership_id`.
   * It is a separate request because no appointment response carries a name, and it is
   * tolerated failing: a missing directory should degrade the page to an identifier, not
   * break it, so its error is never surfaced as an appointment failure.
   */
  const doctors = useApiResource((signal) => listDoctors({ signal }), []);

  const doctor = useMemo(() => {
    const id = appointment.data?.doctor_membership_id;
    if (!id) return null;
    return doctors.data?.data.find((entry) => entry.membership_id === id) ?? null;
  }, [appointment.data, doctors.data]);

  const record: Appointment | null = appointment.data;

  async function handleStartConsultation() {
    if (!record) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const consultation = await createConsultation(record.id, `consultation-${record.id}`);
      const token = await createConsultationRoomToken(consultation.consultation_id, `room-token-${consultation.consultation_id}`);
      setRoomUrl(token.server_url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not start the consultation.');
    } finally {
      setActionLoading(false);
    }
  }

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  // The API answers 404 for both "does not exist" and "not yours", to avoid confirming existence.
  const notFound = appointment.error?.status === 404;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Appointments', href: '/appointments' },
          { label: shortId(appointmentId) },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1000px] mx-auto flex flex-col gap-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-[#1e3fae] transition-colors self-start"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back
          </button>

          {notFound ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">event_busy</span>
              <h2 className="font-bold text-slate-900 mt-3">Appointment not found</h2>
              <p className="text-sm text-slate-500 mt-1">
                This booking does not exist, or you do not have access to it.
              </p>
              <Link
                href="/appointments"
                className="inline-block mt-4 text-sm font-bold text-[#1e3fae] hover:underline"
              >
                Back to appointments
              </Link>
            </div>
          ) : (
            <ResourceState
              isLoading={appointment.isLoading}
              error={appointment.error}
              isEmpty={false}
              onRetry={appointment.reload}
              loadingLabel="Loading appointment…"
              forbiddenTitle="You cannot view this appointment"
              errorTitle="Could not load the appointment"
              emptyTitle=""
              emptyBody=""
              emptyIcon=""
            />
          )}


          {record && !appointment.error && (
            <>
              {/* Header */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1e3fae]/10 text-[#1e3fae]">
                        <span className="material-symbols-outlined text-[24px]">medical_services</span>
                      </div>
                      <div>
                        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                          Appointment {shortId(record.id)}
                        </h1>
                        <p className="text-sm font-medium text-slate-500 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[18px]">
                            {APPOINTMENT_MODE_ICON[record.mode as keyof typeof APPOINTMENT_MODE_ICON] ?? 'help'}
                          </span>
                          {humaniseCode(record.mode)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 mt-1">
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <span className="material-symbols-outlined text-[20px] text-slate-400">calendar_today</span>
                        {formatInstant(record.starts_at)}
                      </span>
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <span className="material-symbols-outlined text-[20px] text-slate-400">schedule</span>
                        {formatInstant(record.ends_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-start md:items-end gap-2">
                    <span
                      className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold border ${
                        APPOINTMENT_STATUS_STYLE[record.status as keyof typeof APPOINTMENT_STATUS_STYLE] ??
                        'bg-slate-50 text-slate-700 border-slate-100'
                      }`}
                    >
                      {humaniseCode(record.status)}
                    </span>
                    <span className="text-xs text-slate-400">
                      Updated {formatInstant(record.updated_at)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Patient & Doctor */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Patient — identifier only. No endpoint resolves another person's name. */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                    Patient
                  </h3>
                  <p className="text-xs text-slate-400 mb-1">Profile</p>
                  <code className="text-slate-700">{shortId(record.patient_profile_id)}</code>
                  <p className="text-xs text-slate-400 mt-4 mb-1">Organization</p>
                  <code className="text-slate-700">{shortId(record.organization_id)}</code>
                </div>

                {/* Doctor — named via the directory, one of two name-bearing endpoints. */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                    Doctor
                  </h3>
                  {doctor ? (
                    <>
                      <p className="text-lg font-bold text-slate-900">{doctor.display_name}</p>
                      <p className="text-sm text-slate-500">
                        {doctor.primary_specialty ?? 'General practice'}
                      </p>
                      <p className="text-xs text-slate-400 mt-2">
                        Practice: {doctor.practice_name}
                      </p>
                    </>
                  ) : (
                    /* No name resolved — show the identifier rather than inventing one. */
                    <code className="text-slate-700">{shortId(record.doctor_membership_id)}</code>
                  )}
                </div>
              </div>

              {actionError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
                  {actionError}
                </div>
              )}
              {roomUrl && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
                  Consultation room ready at <code>{roomUrl}</code>. Use the LiveKit client in the consultation view to join.
                </div>
              )}
              {record.mode === 'video' && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleStartConsultation}
                    disabled={actionLoading}
                    className="rounded-lg bg-[#1e3fae] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {actionLoading ? 'Starting consultation…' : 'Start consultation'}
                  </button>
                </div>
              )}

              {/* Fee & payment state */}
              {typeof record.fee_sen === 'number' && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                    Fee
                  </h3>
                  <p className="text-lg font-bold text-slate-900">
                    {record.fee_sen === 0 ? 'Free' : formatSen(record.fee_sen)}
                  </p>
                  {record.payment_state && (
                    <span
                      className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold border mt-3 ${
                        PAYMENT_STATE_STYLE[record.payment_state as keyof typeof PAYMENT_STATE_STYLE] ??
                        'bg-slate-50 text-slate-700 border-slate-100'
                      }`}
                    >
                      {humaniseCode(record.payment_state)}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}