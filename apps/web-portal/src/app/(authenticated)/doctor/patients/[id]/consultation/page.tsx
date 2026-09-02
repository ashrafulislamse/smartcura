'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge from '@/components/ui/badge';
import type { BadgeTone } from '@/components/ui/badge';
import {
  listAppointments,
  createConsultation,
  APPOINTMENT_MODE_ICON,
  APPOINTMENT_STATUS_STYLE,
} from '@/lib/api/appointments';
import type { AppointmentStatus, AppointmentMode } from '@/lib/api/appointments';
import { getDoctorPatient } from '@/lib/api/doctor-patients';
import {
  listConsultationPrescriptions,
  listConversationMessages,
  markConversationRead,
  readConsultationConversation,
  sendConversationMessage,
} from '@/lib/api/clinical';
import { formatInstant, humaniseCode, initials, shortId } from '@/lib/api/directory';
import { ApiError } from '@/lib/api/client';
import type { Message, Prescription } from '@/types/contracts';

/** Map an appointment status to a Badge tone for the radio-cards. */
function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'confirmed':
      return 'blue';
    case 'checked_in':
      return 'indigo';
    case 'in_progress':
      return 'purple';
    case 'completed':
      return 'green';
    case 'cancelled':
      return 'red';
    case 'no_show':
      return 'orange';
    case 'rescheduled':
      return 'slate';
    default:
      return 'amber';
  }
}

/** Map an appointment mode to a Badge tone. */
function modeTone(mode: string): BadgeTone {
  switch (mode) {
    case 'video':
      return 'blue';
    case 'audio':
      return 'teal';
    case 'chat':
      return 'purple';
    case 'in_person':
      return 'indigo';
    default:
      return 'slate';
  }
}

type StepKey = 'select' | 'start' | 'complete';

const STEPS: ReadonlyArray<{ key: StepKey; label: string; icon: string }> = [
  { key: 'select', label: 'Select appointment', icon: 'event_available' },
  { key: 'start', label: 'Start consultation', icon: 'stethoscope' },
  { key: 'complete', label: 'Complete', icon: 'task_alt' },
];

/**
 * Start a consultation for one patient.
 *
 * A consultation is always anchored to an appointment, so this page first asks the doctor
 * to pick the appointment it belongs to. The appointment list comes from
 * `GET /appointments?status=confirmed`, which is scoped to the signed-in doctor's own
 * membership (the repository chooses the predicate by role, never from a request field),
 * and is narrowed here to this patient by `patient_profile_id`. There is no endpoint that
 * filters appointments by patient, so the narrowing is client-side over the doctor's own
 * confirmed bookings.
 *
 * `POST /appointments/:id/consultation` accepts a `confirmed`, `checked_in` or
 * `in_progress` appointment, so no check-in transition is required before starting.
 */
export default function ConsultationNotes() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const patientId = params.id;
  const { user, isLoading: authLoading } = useAuth();

  // Fetch the patient details so we can show the name in the header instead of a bare id.
  const patientResource = useApiResource(
    (signal) => getDoctorPatient(patientId, signal),
    [patientId],
  );

  const appointments = useApiResource(
    (signal) => listAppointments({ status: 'confirmed', pageSize: 100, signal }),
    [],
  );

  // The list is the doctor's confirmed bookings; keep only this patient's, soonest first so
  // the appointment the doctor is here to see now is at the top. Recency would bury it.
  const rows = useMemo(
    () =>
      [...(appointments.data?.data ?? [])]
        .filter((row) => row.patient_profile_id === patientId)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [appointments.data, patientId],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ consultation_id: string; status: string } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function startConsultation() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const consultation = await createConsultation(selectedId, `consultation-${selectedId}`);
      setResult({ consultation_id: consultation.consultation_id, status: consultation.status });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError({
              status: 0,
              code: 'CLIENT_ERROR',
              title: 'Could not start consultation',
              detail: caught instanceof Error ? caught.message : String(caught),
            }),
      );
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || !user) return <PageLoader label="Loading..." />;
  if (user.activeRole !== 'doctor') return null;

  const patient = patientResource.data;
  const patientName =
    patient && patient.display_name.trim().length > 0
      ? patient.display_name
      : `Patient ${shortId(patientId)}`;
  const patientInitials =
    patient && patient.display_name.trim().length > 0
      ? initials(patient.display_name)
      : shortId(patientId).slice(0, 2).toUpperCase();

  // The current step is derived: once we have a result we are on step 3, once an
  // appointment is selected we are on step 2, otherwise step 1.
  const currentStep: StepKey = result ? 'complete' : selectedId ? 'start' : 'select';
  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Doctor' },
          { label: 'Patients', href: '/doctor/patients' },
          { label: shortId(patientId), href: `/doctor/patients/${patientId}` },
          { label: 'Consultation' },
        ]}
      />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          {/* Back link */}
          <button
            onClick={() => router.push(`/doctor/patients/${patientId}`)}
            className="text-sm text-slate-500 hover:text-[#1e3fae] transition-colors self-start inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to patient
          </button>

          <PageHeader
            title="Patient consultation"
            subtitle="Anchor a new consultation to one of this patient's confirmed appointments."
          />

          {/* Patient context card */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
            <div className="size-12 rounded-full bg-[#1e3fae]/10 text-[#1e3fae] flex items-center justify-center font-bold text-base shrink-0">
              {patientInitials}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-slate-900 truncate">{patientName}</h2>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-500 mt-0.5">
                {patient?.email && <span>{patient.email}</span>}
                {patient?.phone_e164 && <span>{patient.phone_e164}</span>}
                <code className="text-xs text-slate-400">{shortId(patientId)}</code>
              </div>
            </div>
            {patient && (
              <Badge tone={patient.status === 'active' ? 'green' : 'slate'}>
                {humaniseCode(patient.status)}
              </Badge>
            )}
          </section>

          {/* Premium stepper */}
          <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            {STEPS.map((step, index) => {
              const isDone = index < currentStepIndex;
              const isActive = index === currentStepIndex;
              return (
                <div key={step.key} className="flex items-center gap-2 flex-1">
                  <div className="flex items-center gap-3 flex-1">
                    <div
                      className={`size-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        isDone
                          ? 'bg-green-50 text-green-600'
                          : isActive
                            ? 'bg-[#1e3fae] text-white'
                            : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {isDone ? 'check' : step.icon}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p
                        className={`text-xs font-bold uppercase tracking-wide ${
                          isActive ? 'text-[#1e3fae]' : isDone ? 'text-green-600' : 'text-slate-400'
                        }`}
                      >
                        Step {index + 1}
                      </p>
                      <p
                        className={`text-sm font-bold truncate ${
                          isActive || isDone ? 'text-slate-900' : 'text-slate-400'
                        }`}
                      >
                        {step.label}
                      </p>
                    </div>
                  </div>
                  {index < STEPS.length - 1 && (
                    <div
                      className={`h-0.5 w-8 rounded-full shrink-0 ${
                        isDone ? 'bg-green-200' : 'bg-slate-200'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Step 1: Select appointment */}
          <SectionCard title="1. Choose the appointment">
            <p className="text-sm text-slate-500">
              Only this patient&apos;s confirmed appointments are listed, soonest first.
            </p>

            <ResourceState
              isLoading={appointments.isLoading}
              error={appointments.error}
              isEmpty={!appointments.isLoading && !appointments.error && rows.length === 0}
              onRetry={appointments.reload}
              loadingLabel="Loading appointments..."
              errorTitle="Could not load appointments"
              forbiddenTitle="You cannot view appointments"
              emptyTitle="No confirmed appointments"
              emptyBody="This patient has no confirmed appointments yet. Confirm or check in an appointment before starting a consultation."
              emptyIcon="event_busy"
            />

            {!appointments.isLoading && !appointments.error && rows.length > 0 && (
              <div className="mt-4 flex flex-col gap-3">
                {rows.map((row) => {
                  const selected = selectedId === row.id;
                  const modeIcon =
                    APPOINTMENT_MODE_ICON[row.mode as keyof typeof APPOINTMENT_MODE_ICON] ?? 'help';
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(row.id);
                        setResult(null);
                        setError(null);
                      }}
                      className={`w-full text-left rounded-xl border-2 p-4 flex items-center gap-4 transition-all ${
                        selected
                          ? 'border-[#1e3fae] bg-blue-50/50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      {/* Radio indicator */}
                      <span
                        className={`material-symbols-outlined text-2xl shrink-0 ${
                          selected ? 'text-[#1e3fae]' : 'text-slate-300'
                        }`}
                      >
                        {selected ? 'radio_button_checked' : 'radio_button_unchecked'}
                      </span>

                      {/* Mode icon */}
                      <div
                        className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${
                          selected ? 'bg-[#1e3fae]/10 text-[#1e3fae]' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[20px]">{modeIcon}</span>
                      </div>

                      {/* Time info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-slate-900">
                          {formatInstant(row.starts_at)}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          until {formatInstant(row.ends_at)}
                        </p>
                      </div>

                      {/* Mode + status badges */}
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge tone={modeTone(row.mode as AppointmentMode)}>
                          {humaniseCode(row.mode)}
                        </Badge>
                        <Badge tone={statusTone(row.status as AppointmentStatus)}>
                          {humaniseCode(row.status)}
                        </Badge>
                      </div>

                      {/* Short id */}
                      <code className="text-xs text-slate-400 shrink-0 hidden sm:block">
                        {shortId(row.id)}
                      </code>
                    </button>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Step 2: Start consultation */}
          {selectedId && !result && (
            <SectionCard title="2. Start the consultation">
              <p className="text-sm text-slate-500">
                Selected appointment:{' '}
                <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">
                  {shortId(selectedId)}
                </code>
              </p>
              <button
                type="button"
                onClick={startConsultation}
                disabled={busy}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-6 py-3 text-sm font-bold text-white hover:bg-[#1a3694] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[20px]">
                  {busy ? 'progress_activity' : 'play_circle'}
                </span>
                {busy ? 'Starting...' : 'Start consultation'}
              </button>

              {error && (
                <div
                  role="alert"
                  className="mt-4 rounded-lg bg-red-50 border border-red-100 p-4"
                >
                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-red-600 shrink-0">
                      error
                    </span>
                    <div className="flex-1">
                      <p className="font-bold text-red-700">{error.title}</p>
                      <p className="text-red-600 mt-1 text-sm">{error.message}</p>
                      {error.correlationId && (
                        <p className="text-xs text-red-400 mt-2">
                          Reference: <code>{error.correlationId}</code>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </SectionCard>
          )}

          {/* Step 3: Confirmation */}
          {result && (
            <SectionCard title="3. Consultation created">
              <div className="rounded-lg bg-green-50 border border-green-100 p-5 flex items-start gap-4">
                <div className="size-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined">task_alt</span>
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-green-800">Consultation created successfully</h3>
                  <p className="text-sm text-green-700 mt-1">
                    Consultation{' '}
                    <code className="text-xs bg-green-100 px-1.5 py-0.5 rounded">
                      {shortId(result.consultation_id)}
                    </code>{' '}
                    is now {humaniseCode(result.status)}.
                  </p>
                  <div className="flex flex-wrap gap-3 mt-4">
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/doctor/appointments/${selectedId}`)
                      }
                      className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2 text-sm font-bold text-white hover:bg-[#1a3694] transition-colors"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        visibility
                      </span>
                      View consultation
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push(`/doctor/patients/${patientId}`)}
                      className="inline-flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        person
                      </span>
                      Back to patient
                    </button>
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Consultation workspace: conversation + prescriptions, once created */}
          {result && (
            <ConsultationWorkspace
              consultationId={result.consultation_id}
              patientName={patientName}
            />
          )}
        </div>
      </div>
    </main>
  );
}

/* -------------------------------------------------- consultation workspace
 * Rendered once a consultation exists. Fetches its participant conversation, the message
 * feed, and the consultation's prescriptions. Messaging uses idempotent POSTs keyed by
 * `crypto.randomUUID()`; read receipts are advanced to the highest sequence seen.
 */

const PRESCRIPTION_STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'amber',
  signed: 'green',
  superseded: 'slate',
  cancelled: 'red',
  expired: 'orange',
  discarded: 'slate',
};

interface ConsultationWorkspaceProps {
  consultationId: string;
  patientName: string;
}

function ConsultationWorkspace({ consultationId, patientName }: ConsultationWorkspaceProps) {
  // Resolve the participant conversation for this consultation.
  const conversation = useApiResource(
    (signal) => readConsultationConversation(consultationId, signal),
    [consultationId],
  );

  const conversationId = conversation.data?.conversation_id ?? null;

  return (
    <div className="flex flex-col gap-6">
      <ConversationPanel
        conversationId={conversationId}
        conversationLoading={conversation.isLoading}
        conversationError={conversation.error}
        onConversationReload={conversation.reload}
      />
      <PrescriptionsPanel consultationId={consultationId} patientName={patientName} />
    </div>
  );
}

/* -------------------------------------------------- conversation messaging */

interface ConversationPanelProps {
  conversationId: string | null;
  conversationLoading: boolean;
  conversationError: ApiError | null;
  onConversationReload: () => void;
}

function ConversationPanel({
  conversationId,
  conversationLoading,
  conversationError,
  onConversationReload,
}: ConversationPanelProps) {
  // The message feed is only fetched once the conversation id resolves.
  const messages = useApiResource(
    (signal) =>
      conversationId
        ? listConversationMessages(conversationId, { pageSize: 200, signal })
        : Promise.resolve({ data: [], page: { has_more: false, next_cursor: null } }),
    [conversationId],
  );

  const messageRows = useMemo(() => {
    // The feed is newest-first per the server's ordering; reverse for chronological display.
    const list = [...(messages.data?.data ?? [])];
    list.sort((a, b) => a.sequence_no - b.sequence_no);
    return list;
  }, [messages.data]);

  // Track the highest sequence number we have rendered, for read receipts.
  const highestSequenceNo = messageRows.length > 0
    ? messageRows[messageRows.length - 1].sequence_no
    : 0;

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<ApiError | null>(null);
  const [readReceipt, setReadReceipt] = useState<string | null>(null);

  // Advance read receipts whenever the feed gains messages and we are not mid-send.
  useEffect(() => {
    if (!conversationId || highestSequenceNo === 0 || busy) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await markConversationRead(conversationId, {
          through_sequence_no: highestSequenceNo,
        });
        if (!cancelled) {
          setReadReceipt(`Marked read through #${result.through_sequence_no}.`);
        }
      } catch {
        // Read-receipt failures are non-fatal for the feed; the next poll retries implicitly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, highestSequenceNo, busy]);

  const runSend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!conversationId) return;
      const text = draft.trim();
      if (!text) return;
      if (busy) return;
      setBusy(true);
      setWriteError(null);
      try {
        await sendConversationMessage(
          conversationId,
          {
            message_type: 'text',
            text_content: text,
            file_object_id: null,
            client_correlation_id: crypto.randomUUID(),
          },
          crypto.randomUUID(),
        );
        setDraft('');
        messages.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({
                status: 0,
                code: 'CLIENT_ERROR',
                title: 'Could not send message',
                detail: caught instanceof Error ? caught.message : String(caught),
              });
        setWriteError(apiError);
        if (apiError.isConflict) messages.reload();
      } finally {
        setBusy(false);
      }
    },
    [conversationId, draft, busy, messages],
  );

  return (
    <SectionCard
      title="Conversation"
      action={
        <button
          type="button"
          onClick={messages.reload}
          disabled={!conversationId}
          className="text-sm font-bold text-[#1e3fae] hover:underline inline-flex items-center gap-1 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span>
          Refresh
        </button>
      }
    >
      <p className="text-sm text-slate-500">
        Secure messaging thread with the patient for this consultation.
      </p>

      {!conversationId && (
        <ResourceState
          isLoading={conversationLoading}
          error={conversationError}
          isEmpty={false}
          onRetry={onConversationReload}
          loadingLabel="Loading conversation..."
          errorTitle="Could not load conversation"
          forbiddenTitle="You cannot view this conversation"
          emptyTitle=""
          emptyBody=""
          emptyIcon=""
        />
      )}

      {conversationId && (
        <>
          <ResourceState
            isLoading={messages.isLoading}
            error={messages.error}
            isEmpty={!messages.isLoading && !messages.error && messageRows.length === 0}
            onRetry={messages.reload}
            loadingLabel="Loading messages..."
            errorTitle="Could not load messages"
            forbiddenTitle="You cannot view these messages"
            emptyTitle="No messages yet"
            emptyBody="Send the first message to start the conversation."
            emptyIcon="chat_bubble"
          />

          {!messages.isLoading && !messages.error && messageRows.length > 0 && (
            <ul className="mt-4 flex flex-col gap-3 max-h-[420px] overflow-y-auto pr-1">
              {messageRows.map((message) => (
                <MessageRow key={message.message_id} message={message} />
              ))}
            </ul>
          )}

          {readReceipt && (
            <p role="status" className="mt-3 text-xs text-slate-400 inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">done_all</span>
              {readReceipt}
            </p>
          )}

          {writeError && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {writeError.isForbidden
                  ? 'You cannot send messages in this conversation'
                  : writeError.isConflict
                    ? 'Conflict — the conversation changed. Please refresh.'
                    : writeError.isUnauthenticated
                      ? 'Your session expired. Please sign in again.'
                      : writeError.title}
              </p>
              <p className="text-xs text-red-600 mt-1">{writeError.message}</p>
              {writeError.correlationId && (
                <p className="text-xs text-red-400 mt-1">
                  Reference: <code>{writeError.correlationId}</code>
                </p>
              )}
            </div>
          )}

          <form onSubmit={runSend} className="mt-4 flex items-end gap-3">
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                New message
              </span>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder="Type a message to the patient..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none"
              />
            </label>
            <button
              type="submit"
              disabled={busy || draft.trim() === ''}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <span className="material-symbols-outlined text-[20px]">
                {busy ? 'progress_activity' : 'send'}
              </span>
              {busy ? 'Sending...' : 'Send'}
            </button>
          </form>
        </>
      )}
    </SectionCard>
  );
}

function MessageRow({ message }: { message: Message }) {
  const mine = message.is_me;
  return (
    <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm shadow-sm ${
          mine
            ? 'bg-[#1e3fae] text-white'
            : 'bg-white border border-slate-200 text-slate-800'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">
          {message.text_content?.trim() || '[empty message]'}
        </p>
        <p
          className={`mt-1 text-[10px] ${mine ? 'text-blue-100' : 'text-slate-400'} inline-flex items-center gap-1`}
        >
          <span>#{message.sequence_no}</span>
          <span aria-hidden>·</span>
          <span>{formatInstant(message.created_at)}</span>
          {mine && message.read_at && (
            <span className="inline-flex items-center gap-0.5" title={`Read ${formatInstant(message.read_at)}`}>
              <span className="material-symbols-outlined text-[12px]">done_all</span>
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

/* -------------------------------------------------- consultation prescriptions */

interface PrescriptionsPanelProps {
  consultationId: string;
  patientName: string;
}

function PrescriptionsPanel({ consultationId }: PrescriptionsPanelProps) {
  const prescriptions = useApiResource(
    (signal) => listConsultationPrescriptions(consultationId, signal),
    [consultationId],
  );

  const rows = useMemo(() => prescriptions.data?.data ?? [], [prescriptions.data]);

  return (
    <SectionCard
      title="Consultation prescriptions"
      action={
        <button
          type="button"
          onClick={prescriptions.reload}
          className="text-sm font-bold text-[#1e3fae] hover:underline inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span>
          Refresh
        </button>
      }
    >
      <p className="text-sm text-slate-500">
        Prescriptions issued for this consultation.
      </p>

      <ResourceState
        isLoading={prescriptions.isLoading}
        error={prescriptions.error}
        isEmpty={!prescriptions.isLoading && !prescriptions.error && rows.length === 0}
        onRetry={prescriptions.reload}
        loadingLabel="Loading prescriptions..."
        errorTitle="Could not load prescriptions"
        forbiddenTitle="You cannot view these prescriptions"
        emptyTitle="No prescriptions yet"
        emptyBody="Prescriptions created for this consultation will appear here."
        emptyIcon="medication"
      />

      {!prescriptions.isLoading && !prescriptions.error && rows.length > 0 && (
        <ul className="mt-4 flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
          {rows.map((rx) => (
            <li key={rx.prescription_id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <code className="text-xs text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded">
                {shortId(rx.prescription_id)}
              </code>
              <Badge tone={PRESCRIPTION_STATUS_TONE[rx.status] ?? 'slate'}>
                {humaniseCode(rx.status)}
              </Badge>
              <span className="text-xs text-slate-400">
                v{rx.version} · {rx.items.length} item{rx.items.length === 1 ? '' : 's'}
              </span>
              {rx.diagnosis && (
                <span className="text-xs text-slate-500 truncate">
                  {rx.diagnosis}
                </span>
              )}
              {rx.signed_at && (
                <span className="text-xs text-slate-400 ml-auto inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">verified</span>
                  {formatInstant(rx.signed_at)}
                </span>
              )}
              {rx.replaces_prescription_id && (
                <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">swap_vert</span>
                  Replaces {shortId(rx.replaces_prescription_id)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
