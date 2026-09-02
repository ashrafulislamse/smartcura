'use client';

/**
 * Support ticket thread, wired to GET /support/tickets/{id}.
 *
 * RECONCILIATION WITH THE PREVIOUS MOCK. `mockTickets` carried a free-text `subject`,
 * a requester `name`, `email`, `role` and `avatar`, an `assignee` name, a `priority`
 * and a canned two-message conversation. The thread endpoint returns none of those: it
 * returns the ticket's status, its version, and the MESSAGE THREAD — the one thing the
 * queue deliberately withholds. The requester and assignee are identifiers, not names,
 * because no endpoint resolves profile names; priority is a property of the queue row,
 * not the thread, so it is not shown here. Those invented figures are removed rather
 * than approximated.
 *
 * WHAT REPLACES THEM IS BETTER FOR THE JOB: the actual conversation. The queue row is
 * for triage; this page is for reading, replying, assigning and advancing. `internal_only`
 * notes are excluded for a requester by the backend query, so a requester never sees
 * staff notes.
 *
 * A 404 IS NOT ONLY "DOES NOT EXIST". The API declines to confirm a ticket the caller
 * cannot read, answering 404 rather than 403, so "not found" here may also mean "not
 * yours".
 *
 * ASSIGN AND ADVANCE carry `expected_version` from the thread as read. A 409 means the
 * version in hand is stale; the thread is re-read so a retry uses fresh state. The
 * `SupportTicketState` acknowledgement carries no version, so we always RE-READ rather
 * than incrementing what we hold (the trap in AGENTS.md: "A mutation acknowledgement is
 * not the new state").
 */

import { useCallback, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import SectionCard from '@/components/ui/section-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import {
  addSupportTicketMessage,
  advanceSupportTicket,
  assignSupportTicket,
  readSupportTicket,
  type SupportTicketStatus,
} from '@/lib/api/support';
import { listMemberships } from '@/lib/api/directory';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';
import { ApiError } from '@/lib/api/client';
import type {
  AdvanceSupportTicketRequest,
  AssignSupportTicketRequest,
} from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';

type KnownTicketStatus = SupportTicketStatus;

/** Badge tone per known ticket status, keyed exhaustively so an invented value falls through. */
const STATUS_TONE: Record<KnownTicketStatus, BadgeTone> = {
  open: 'blue',
  assigned: 'indigo',
  in_progress: 'amber',
  waiting_requester: 'purple',
  resolved: 'green',
  closed: 'slate',
};

/**
 * Status transitions that are meaningful from the detail page. The backend constrains the
 * order: a ticket cannot close before it is resolved, and resolving requires a resolution
 * code. The buttons below expose only the transitions that make sense from the current
 * status; the backend is the authority on whether a given transition is legal.
 */
interface TransitionOption {
  readonly label: string;
  readonly status: AdvanceSupportTicketRequest['status'];
  readonly icon: string;
  readonly variant: 'primary' | 'outline' | 'danger';
  readonly requiresResolution: boolean;
}

const TRANSITIONS: ReadonlyArray<TransitionOption> = [
  { label: 'Start progress', status: 'in_progress', icon: 'play_arrow', variant: 'outline', requiresResolution: false },
  { label: 'Waiting on requester', status: 'waiting_requester', icon: 'schedule', variant: 'outline', requiresResolution: false },
  { label: 'Resolve', status: 'resolved', icon: 'check_circle', variant: 'primary', requiresResolution: true },
  { label: 'Close', status: 'closed', icon: 'lock', variant: 'danger', requiresResolution: true },
];

/**
 * Which transitions to offer from the current status. The backend is the final authority,
 * but hiding a button that cannot succeed is better UX than offering one that 422s.
 */
function availableTransitions(status: KnownTicketStatus): readonly TransitionOption[] {
  switch (status) {
    case 'open':
    case 'assigned':
      return TRANSITIONS.filter((t) => t.status === 'in_progress' || t.status === 'resolved');
    case 'in_progress':
      return TRANSITIONS.filter(
        (t) => t.status === 'waiting_requester' || t.status === 'resolved',
      );
    case 'waiting_requester':
      return TRANSITIONS.filter(
        (t) => t.status === 'in_progress' || t.status === 'resolved',
      );
    case 'resolved':
      return TRANSITIONS.filter((t) => t.status === 'closed');
    case 'closed':
      return [];
    default:
      return [];
  }
}

function humanise(code: string): string {
  return code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export default function TicketDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, activeMembership, isLoading: isAuthLoading } = useAuth();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const ticketId = String(params.id);
  const organizationId = activeMembership?.organization_id ?? null;

  const thread = useApiResource(
    (signal) => readSupportTicket(ticketId, signal),
    [ticketId],
  );

  // Memberships for the assign dropdown. The organization comes from the caller's own
  // membership, never from the request. Loaded only when the user opens the assign control.
  const [showAssign, setShowAssign] = useState(false);
  const memberships = useApiResource(
    (signal) =>
      organizationId
        ? listMemberships(organizationId, signal)
        : Promise.resolve(null),
    [organizationId, showAssign],
  );

  const messages = useMemo(() => thread.data?.messages ?? [], [thread.data]);
  const notFound = thread.error?.status === 404;

  const currentStatus = thread.data?.status as KnownTicketStatus | undefined;
  const canReply = thread.data !== null && thread.data.status !== 'closed';
  const transitions = currentStatus ? availableTransitions(currentStatus) : [];

  // --- Reply mutation --------------------------------------------------------
  async function sendReply() {
    const body = draft.trim();
    if (body === '' || !thread.data || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await addSupportTicketMessage(ticketId, { body });
      setDraft('');
      // The thread is re-read rather than locally appended: the server is the only
      // authority on ordering and on whether the message was recorded.
      thread.reload();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      setSendError(apiError ? apiError.message : 'Could not send the reply');
    } finally {
      setSending(false);
    }
  }

  // --- Assign mutation -------------------------------------------------------
  const [assignMembershipId, setAssignMembershipId] = useState('');
  const [assignReasonCode, setAssignReasonCode] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<ApiError | null>(null);

  const runAssign = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!thread.data || assignMembershipId === '' || assignReasonCode.trim() === '') return;
      setAssignBusy(true);
      setAssignError(null);
      const req: AssignSupportTicketRequest = {
        assigned_membership_id: assignMembershipId,
        reason_code: assignReasonCode.trim(),
        expected_version: thread.data.version,
      };
      try {
        await assignSupportTicket(ticketId, req);
        setShowAssign(false);
        setAssignMembershipId('');
        setAssignReasonCode('');
        // Re-read the thread: the acknowledgement carries no version, so incrementing
        // what we hold would risk a spurious 409 on the next mutation.
        thread.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setAssignError(apiError);
        if (apiError.isConflict) thread.reload();
      } finally {
        setAssignBusy(false);
      }
    },
    [thread, ticketId, assignMembershipId, assignReasonCode],
  );

  // --- Advance (status transition) mutation ---------------------------------
  const [advanceBusy, setAdvanceBusy] = useState(false);
  const [advanceError, setAdvanceError] = useState<ApiError | null>(null);
  const [resolutionModal, setResolutionModal] = useState<TransitionOption | null>(null);
  const [resolutionCode, setResolutionCode] = useState('');
  const [advanceReasonCode, setAdvanceReasonCode] = useState('');

  const runAdvance = useCallback(
    async (option: TransitionOption) => {
      if (!thread.data) return;
      const reason = option.requiresResolution ? 'resolved' : advanceReasonCode.trim() || 'status_change';
      const req: AdvanceSupportTicketRequest = {
        status: option.status,
        reason_code: reason,
        expected_version: thread.data.version,
        resolution_code: option.requiresResolution ? (resolutionCode.trim() || null) : undefined,
      };
      setAdvanceBusy(true);
      setAdvanceError(null);
      try {
        await advanceSupportTicket(ticketId, req);
        setResolutionModal(null);
        setResolutionCode('');
        setAdvanceReasonCode('');
        thread.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setAdvanceError(apiError);
        if (apiError.isConflict) thread.reload();
      } finally {
        setAdvanceBusy(false);
      }
    },
    [thread, ticketId, advanceReasonCode, resolutionCode],
  );

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Support', href: '/support/tickets' },
          { label: 'Tickets', href: '/support/tickets' },
          { label: shortId(ticketId) },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1000px] mx-auto flex flex-col gap-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-[#1e3fae] transition-colors self-start"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to tickets
          </button>

          {notFound ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">confirmation_number</span>
              <h2 className="font-bold text-slate-900 mt-3">Ticket not found</h2>
              <p className="text-sm text-slate-500 mt-1">
                This ticket does not exist, or you do not have access to it.
              </p>
              <button
                onClick={() => router.push('/support/tickets')}
                className="inline-block mt-4 text-sm font-bold text-[#1e3fae] hover:underline"
              >
                Back to tickets
              </button>
            </div>
          ) : (
            <ResourceState
              isLoading={thread.isLoading}
              error={thread.error}
              isEmpty={false}
              onRetry={thread.reload}
              loadingLabel="Loading the ticket thread…"
              forbiddenTitle="You cannot view this ticket"
              errorTitle="Could not load the ticket"
              emptyTitle=""
              emptyBody=""
              emptyIcon=""
            />
          )}

          {thread.data && !thread.error && (
            <>
              {/* Header */}
              <SectionCard>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                      Ticket {shortId(thread.data.support_ticket_id)}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                      {messages.length} message{messages.length === 1 ? '' : 's'} · version{' '}
                      {thread.data.version}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[thread.data.status as KnownTicketStatus] ?? 'slate'}>
                    {humaniseCode(thread.data.status)}
                  </Badge>
                </div>
              </SectionCard>

              {/* Actions: assign + status transitions */}
              {thread.data.status !== 'closed' && (
                <SectionCard title="Actions">
                  <div className="flex flex-col gap-4">
                    {/* Assign control */}
                    {!showAssign ? (
                      <button
                        type="button"
                        onClick={() => { setShowAssign(true); setAssignError(null); }}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors self-start"
                      >
                        <span className="material-symbols-outlined text-base">person_add</span>
                        Assign ticket
                      </button>
                    ) : (
                      <form onSubmit={runAssign} className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-bold text-slate-700">Assign to</label>
                          <select
                            value={assignMembershipId}
                            onChange={(e) => setAssignMembershipId(e.target.value)}
                            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
                            required
                          >
                            <option value="">Select a member…</option>
                            {(memberships.data?.data ?? []).map((m) => (
                              <option key={m.id} value={m.id}>
                                {humaniseCode(m.role)} · {shortId(m.id)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-bold text-slate-700">
                            Reason code <span className="text-red-500">*</span>
                          </label>
                          <input
                            value={assignReasonCode}
                            onChange={(e) => setAssignReasonCode(e.target.value)}
                            placeholder="e.g. triage_assignment"
                            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
                            required
                          />
                        </div>
                        {assignError && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                            <p className="text-sm font-bold text-red-700">
                              {assignError.isForbidden
                                ? 'You cannot assign tickets'
                                : assignError.isConflict
                                  ? 'Conflict — the ticket changed. Please retry.'
                                  : assignError.title}
                            </p>
                            <p className="text-xs text-red-600 mt-1">{assignError.message}</p>
                          </div>
                        )}
                        <div className="flex gap-3">
                          <button
                            type="submit"
                            disabled={assignBusy || assignMembershipId === '' || assignReasonCode.trim() === ''}
                            className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
                          >
                            {assignBusy ? 'Assigning...' : 'Confirm assign'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setShowAssign(false); setAssignError(null); }}
                            disabled={assignBusy}
                            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Status transition buttons */}
                    {transitions.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                        {transitions.map((option) => {
                          const base =
                            'inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50';
                          const variantClass =
                            option.variant === 'primary'
                              ? 'bg-[#1e3fae] text-white hover:bg-[#173080]'
                              : option.variant === 'danger'
                                ? 'border border-red-300 text-red-700 hover:bg-red-50'
                                : 'border border-slate-200 text-slate-700 hover:bg-slate-50';
                          return (
                            <button
                              key={option.status}
                              type="button"
                              disabled={advanceBusy}
                              onClick={() => {
                                setAdvanceError(null);
                                if (option.requiresResolution) {
                                  setResolutionModal(option);
                                } else {
                                  setAdvanceReasonCode('');
                                  void runAdvance(option);
                                }
                              }}
                              className={`${base} ${variantClass}`}
                            >
                              <span className="material-symbols-outlined text-base">{option.icon}</span>
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {advanceError && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                        <p className="text-sm font-bold text-red-700">
                          {advanceError.isForbidden
                            ? 'You cannot change this ticket status'
                            : advanceError.isConflict
                              ? 'Conflict — the ticket changed. Please retry.'
                              : advanceError.isUnauthenticated
                                ? 'Your session expired. Please sign in again.'
                                : advanceError.title}
                        </p>
                        <p className="text-xs text-red-600 mt-1">{advanceError.message}</p>
                        {advanceError.correlationId && (
                          <p className="text-xs text-red-400 mt-1">
                            Reference: <code>{advanceError.correlationId}</code>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

              {/* Resolution modal — resolves/closes need a resolution_code */}
              {resolutionModal && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                  role="dialog"
                  aria-modal="true"
                >
                  <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                      <h2 className="text-lg font-bold text-slate-900">{resolutionModal.label}</h2>
                      <button
                        type="button"
                        onClick={() => setResolutionModal(null)}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                        aria-label="Close"
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <form
                      onSubmit={(e) => { e.preventDefault(); void runAdvance(resolutionModal); }}
                      className="p-6 flex flex-col gap-4"
                    >
                      <label className="flex flex-col gap-1.5">
                        <span className="text-sm font-bold text-slate-700">
                          Resolution code <span className="text-red-500">*</span>
                        </span>
                        <input
                          value={resolutionCode}
                          onChange={(e) => setResolutionCode(e.target.value)}
                          placeholder="e.g. issue_resolved"
                          className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
                          required
                        />
                        <span className="text-xs text-slate-400">Lowercase, snake_case. Describes the outcome.</span>
                      </label>
                      <div className="flex justify-end gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => setResolutionModal(null)}
                          disabled={advanceBusy}
                          className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={advanceBusy || resolutionCode.trim() === ''}
                          className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
                        >
                          {advanceBusy ? 'Processing...' : resolutionModal.label}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Conversation */}
              <SectionCard title="Conversation">
                {messages.length === 0 ? (
                  <div className="text-center py-12">
                    <span className="material-symbols-outlined text-slate-300 text-5xl">chat_bubble_outline</span>
                    <h2 className="font-bold text-slate-900 mt-3">No messages yet</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      This ticket has no message thread. Write the first reply below.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {messages.map((message, index) => {
                      const mine = message.author_profile_id === user.id;
                      return (
                        <div key={index} className={`flex gap-3 ${mine ? 'flex-row-reverse' : ''}`}>
                          <div
                            className={`shrink-0 size-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                              mine ? 'bg-[#1e3fae]' : 'bg-slate-400'
                            }`}
                          >
                            {mine ? (user.name.charAt(0) || 'A') : 'U'}
                          </div>
                          <div className={`flex flex-col gap-1 max-w-[75%] ${mine ? 'items-end' : ''}`}>
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs font-bold text-slate-700">
                                {mine ? 'You' : 'Requester'}
                              </span>
                              <span className="text-xs text-slate-400">
                                {formatInstant(message.created_at)}
                              </span>
                            </div>
                            <div
                              className={`p-4 rounded-2xl text-[15px] leading-relaxed ${
                                mine
                                  ? 'bg-[#1e3fae] text-white rounded-tr-none'
                                  : 'bg-slate-100 text-slate-700 rounded-tl-none'
                              }`}
                            >
                              <p>{message.body}</p>
                            </div>
                            {message.internal_only && (
                              <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                                Internal note
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>

              {/* Composer */}
              <SectionCard title="Reply">
                {!canReply ? (
                  <p className="text-sm text-slate-500">
                    This ticket is closed and can no longer receive replies.
                  </p>
                ) : (
                  <>
                    <textarea
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-4 text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] focus:bg-white transition-all resize-none min-h-[110px] text-base"
                      placeholder="Write a reply to the requester…"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    {sendError && (
                      <p className="text-sm text-red-600 mt-2" role="alert">{sendError}</p>
                    )}
                    <div className="flex justify-end mt-3">
                      <button
                        onClick={sendReply}
                        disabled={draft.trim() === '' || sending}
                        className="flex items-center gap-2 bg-[#1e3fae] hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 px-6 rounded-lg shadow-md transition-all"
                      >
                        <span>{sending ? 'Sending…' : 'Send Reply'}</span>
                        <span className="material-symbols-outlined text-[18px]">send</span>
                      </button>
                    </div>
                  </>
                )}
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
