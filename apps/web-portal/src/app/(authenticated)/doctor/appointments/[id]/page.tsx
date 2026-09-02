'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge from '@/components/ui/badge';
import type { BadgeTone } from '@/components/ui/badge';
import {
  createConsultation,
  createConsultationRoomToken,
  getAppointment,
  transitionAppointment,
  APPOINTMENT_MODE_ICON,
} from '@/lib/api/appointments';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';
import { formatSen } from '@/lib/api/finance';
import type { Appointment, AppointmentStatus } from '@/types/contracts';

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

/**
 * The happy-path lifecycle shown as a horizontal stepper. The server vocabulary is wider
 * (pending_payment, rescheduled) but the forward progression a doctor cares about is this
 * chain. Steps the appointment has already passed are filled blue; the current step gets a
 * ring; future steps are slate. A terminal status (cancelled / no_show) collapses the
 * stepper into a single red badge.
 */
const LIFECYCLE: ReadonlyArray<{ key: AppointmentStatus; label: string; icon: string }> = [
  { key: 'confirmed', label: 'Confirmed', icon: 'event_available' },
  { key: 'checked_in', label: 'Checked in', icon: 'how_to_reg' },
  { key: 'in_progress', label: 'In progress', icon: 'stethoscope' },
  { key: 'completed', label: 'Completed', icon: 'task_alt' },
];

function isTerminal(status: AppointmentStatus): boolean {
  return status === 'cancelled' || status === 'no_show';
}

function lifecycleIndex(status: AppointmentStatus): number {
  return LIFECYCLE.findIndex((step) => step.key === status);
}

export default function DoctorAppointmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const appointment = useApiResource((signal) => getAppointment(id, signal), [id]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const record = appointment.data;

  async function startConsultation() {
    if (!record) return;
    setBusy(true);
    setMessage(null);
    try {
      if (record.status === 'confirmed') {
        await transitionAppointment(
          id,
          { status: 'checked_in', expected_version: record.version },
          `check-in-${id}`,
        );
      }
      const consultation = await createConsultation(id, `consultation-${id}`);
      const token = await createConsultationRoomToken(
        consultation.consultation_id,
        `room-token-${consultation.consultation_id}`,
      );
      setRoomUrl(token.server_url);
      setMessage(`Room ready: ${token.server_url}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start consultation.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!record) return;
    setTransitionBusy(true);
    setTransitionError(null);
    try {
      await transitionAppointment(
        id,
        { status: 'cancelled', reason_code: 'doctor_unavailable', expected_version: record.version },
        `cancel-${id}`,
      );
      appointment.reload();
    } catch (error) {
      setTransitionError(error instanceof Error ? error.message : 'Could not cancel appointment.');
    } finally {
      setTransitionBusy(false);
    }
  }

  async function handleNoShow() {
    if (!record) return;
    setTransitionBusy(true);
    setTransitionError(null);
    try {
      await transitionAppointment(
        id,
        { status: 'no_show', reason_code: 'patient_absent', expected_version: record.version },
        `noshow-${id}`,
      );
      appointment.reload();
    } catch (error) {
      setTransitionError(error instanceof Error ? error.message : 'Could not mark no-show.');
    } finally {
      setTransitionBusy(false);
    }
  }

  if (appointment.isLoading && !record) {
    return (
      <main className="flex-1 overflow-y-auto bg-[#F9FAFB]">
        <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Appointments', href: '/doctor/appointments' }, { label: 'Details' }]} />
        <PageLoader label="Loading appointment..." />
      </main>
    );
  }

  const canCancel =
    !!record &&
    !transitionBusy &&
    ['pending_payment', 'confirmed', 'checked_in'].includes(record.status);
  const canNoShow =
    !!record &&
    !transitionBusy &&
    ['confirmed', 'checked_in'].includes(record.status);
  const canStartConsultation =
    !!record &&
    !busy &&
    !isTerminal(record.status) &&
    record.status !== 'completed' &&
    record.status !== 'rescheduled';

  return (
    <main className="flex-1 overflow-y-auto bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Doctor' },
          { label: 'Appointments', href: '/doctor/appointments' },
          { label: 'Details' },
        ]}
      />
      <div className="p-8 max-w-[1200px] mx-auto w-full flex flex-col gap-6">
        <button
          onClick={() => router.back()}
          className="text-sm text-slate-500 self-start inline-flex items-center gap-1 hover:text-[#1e3fae] transition-colors"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Back
        </button>

        <ResourceState
          isLoading={appointment.isLoading}
          error={appointment.error}
          isEmpty={false}
          onRetry={appointment.reload}
          loadingLabel="Loading appointment..."
          errorTitle="Could not load appointment"
          forbiddenTitle="You cannot view this appointment"
          emptyTitle=""
          emptyBody=""
          emptyIcon=""
        />

        {record && !appointment.error && (
          <>
            <PageHeader
              title={`Appointment ${shortId(record.id)}`}
              subtitle={`${humaniseCode(record.mode)} consultation`}
              actions={
                <Badge tone={statusTone(record.status)} className="text-sm px-3 py-1.5">
                  {humaniseCode(record.status)}
                </Badge>
              }
            />

            {/* Status timeline */}
            {!isTerminal(record.status) ? (
              <SectionCard>
                <div className="flex items-center justify-between w-full overflow-x-auto pb-2">
                  {LIFECYCLE.map((step, index) => {
                    const currentIndex = lifecycleIndex(record.status);
                    const isCompleted = currentIndex >= 0 && index < currentIndex;
                    const isCurrent = index === currentIndex;
                    const isFuture = currentIndex >= 0 && index > currentIndex;
                    const isPending =
                      currentIndex < 0 && record.status === 'pending_payment';
                    // When pending_payment, no lifecycle step is reached yet.
                    const dimmed = isPending || isFuture;

                    return (
                      <div key={step.key} className="flex items-center flex-1 last:flex-none">
                        <div className="flex flex-col items-center gap-2 min-w-[80px]">
                          <div
                            className={[
                              'flex items-center justify-center w-11 h-11 rounded-full border-2 transition-all',
                              isCompleted
                                ? 'bg-[#1e3fae] border-[#1e3fae] text-white'
                                : isCurrent
                                  ? 'bg-white border-[#1e3fae] text-[#1e3fae] ring-4 ring-[#1e3fae]/15'
                                  : 'bg-white border-slate-200 text-slate-300',
                            ].join(' ')}
                          >
                            <span className="material-symbols-outlined text-xl">
                              {isCompleted ? 'check' : step.icon}
                            </span>
                          </div>
                          <span
                            className={[
                              'text-xs font-bold text-center',
                              dimmed ? 'text-slate-300' : 'text-slate-700',
                            ].join(' ')}
                          >
                            {step.label}
                          </span>
                        </div>
                        {index < LIFECYCLE.length - 1 && (
                          <div
                            className={[
                              'flex-1 h-0.5 mx-2 transition-colors',
                              currentIndex >= 0 && index < currentIndex
                                ? 'bg-[#1e3fae]'
                                : 'bg-slate-200',
                            ].join(' ')}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            ) : (
              <SectionCard>
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-2xl text-red-600">
                    {record.status === 'no_show' ? 'person_off' : 'event_busy'}
                  </span>
                  <div>
                    <p className="font-bold text-slate-900">
                      {record.status === 'no_show' ? 'Patient did not attend' : 'Appointment cancelled'}
                    </p>
                    <p className="text-sm text-slate-500">
                      This appointment is no longer active.
                    </p>
                  </div>
                  <Badge tone="red" className="ml-auto">
                    {humaniseCode(record.status)}
                  </Badge>
                </div>
              </SectionCard>
            )}

            {/* Summary section */}
            <SectionCard title="Summary">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-xs text-slate-400 uppercase font-bold tracking-wide mb-1">Mode</p>
                    <p className="inline-flex items-center gap-2 text-slate-900 font-bold">
                      <span className="material-symbols-outlined text-[#1e3fae]">
                        {APPOINTMENT_MODE_ICON[record.mode as keyof typeof APPOINTMENT_MODE_ICON] ?? 'help'}
                      </span>
                      {humaniseCode(record.mode)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase font-bold tracking-wide mb-1">Status</p>
                    <Badge tone={statusTone(record.status)}>{humaniseCode(record.status)}</Badge>
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-xs text-slate-400 uppercase font-bold tracking-wide mb-1">Date &amp; time</p>
                    <p className="text-slate-900 font-bold">{formatInstant(record.starts_at)}</p>
                    <p className="text-sm text-slate-500">until {formatInstant(record.ends_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase font-bold tracking-wide mb-1">Fee</p>
                    <p className="text-slate-900 font-bold">
                      {record.fee_sen === 0 ? 'No fee' : formatSen(record.fee_sen, record.currency)}
                    </p>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Patient info section — only the identifier is available, no name endpoint. */}
            <SectionCard title="Patient">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-slate-400">
                  <span className="material-symbols-outlined">person</span>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-wide">Patient profile</p>
                  <code className="text-slate-900 font-mono text-sm">{record.patient_profile_id}</code>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Short ID: <code className="font-mono">{shortId(record.patient_profile_id)}</code>
                  </p>
                </div>
              </div>
            </SectionCard>

            {/* Action buttons row */}
            <div className="flex flex-wrap gap-3">
              {roomUrl && (
                <a
                  href={roomUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#1a3694] transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">video_call</span>
                  Join room
                </a>
              )}
              {canStartConsultation && (
                <button
                  type="button"
                  onClick={startConsultation}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#1a3694] transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-lg">play_circle</span>
                  {busy ? 'Starting...' : 'Start consultation'}
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={transitionBusy}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-5 py-3 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-lg">cancel</span>
                  Cancel
                </button>
              )}
              {canNoShow && (
                <button
                  type="button"
                  onClick={handleNoShow}
                  disabled={transitionBusy}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-5 py-3 text-sm font-bold text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-lg">person_off</span>
                  No-show
                </button>
              )}
            </div>

            {transitionError && (
              <div
                role="alert"
                className="rounded-lg bg-red-50 border border-red-100 p-4 text-sm text-red-700"
              >
                {transitionError}
              </div>
            )}

            {/* Consultation section — the existing flow is kept intact below the actions. */}
            <SectionCard title="Consultation">
              <p className="text-sm text-slate-500">
                Check in, create the consultation, and obtain a short-lived room token.
              </p>
              <button
                type="button"
                onClick={startConsultation}
                disabled={busy || !canStartConsultation}
                className="mt-4 rounded-lg bg-[#1e3fae] px-4 py-2 text-sm font-bold text-white disabled:opacity-50 hover:bg-[#1a3694] transition-colors"
              >
                {busy ? 'Starting...' : 'Start consultation and open room'}
              </button>
              {message && (
                <p
                  role="status"
                  className="mt-4 rounded-lg bg-slate-50 p-3 text-sm break-all text-slate-700"
                >
                  {message}
                </p>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </main>
  );
}
