'use client';

/**
 * Support ticket queue, wired to GET /support/tickets.
 *
 * RECONCILIATION WITH THE PREVIOUS MOCK. `mockTickets` carried a free-text `subject`,
 * a requester `name`, an `assignee` name and a `messages` count. The API carries
 * `subject_code` and `category_code` — closed vocabularies, not prose — plus profile and
 * membership IDENTIFIERS rather than names, because a queue row deliberately excludes
 * anything a user typed. Names would need a second lookup that no endpoint offers yet,
 * so identifiers are shown truncated rather than invented.
 *
 * WHAT REPLACES THEM IS BETTER FOR TRIAGE: real SLA state. A row reports whether first
 * response or resolution has BREACHED, and the queue arrives ordered by urgency from the
 * backend. The page must not re-sort by recency — that would bury the ticket about to
 * miss its SLA, which is the whole reason the ordering exists.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import {
  createSupportTicket,
  listSupportTickets,
  type SupportTicketStatus,
} from '@/lib/api/support';
import { ApiError } from '@/lib/api/client';
import type { CreateSupportTicketRequest } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';

const TABS: ReadonlyArray<{ key: 'all' | SupportTicketStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'waiting_requester', label: 'Waiting on requester' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
];

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700 border-blue-100',
  assigned: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-100',
  waiting_requester: 'bg-purple-50 text-purple-700 border-purple-100',
  resolved: 'bg-green-50 text-green-700 border-green-100',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
};

const PRIORITY_STYLE: Record<string, string> = {
  urgent: 'bg-red-50 text-red-700 border-red-100',
  high: 'bg-orange-50 text-orange-700 border-orange-100',
  medium: 'bg-slate-50 text-slate-700 border-slate-100',
  low: 'bg-slate-50 text-slate-500 border-slate-100',
};

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'] as const;

/** Codes are machine vocabulary; render them readably without inventing new words. */
function humanise(code: string): string {
  return code.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

function shortId(value: string | null): string {
  if (!value) return '—';
  return value.slice(0, 8);
}

function dueLabel(iso: string): string {
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return '—';
  const minutes = Math.round((due - Date.now()) / 60000);
  const overdue = minutes < 0;
  const absolute = Math.abs(minutes);
  const text =
    absolute < 60
      ? `${absolute}m`
      : absolute < 1440
        ? `${Math.round(absolute / 60)}h`
        : `${Math.round(absolute / 1440)}d`;
  return overdue ? `${text} overdue` : `in ${text}`;
}

export default function SupportTicketsPage() {
  const router = useRouter();
  const { user, activeMembership, isLoading: isAuthLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<'all' | SupportTicketStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewTicket, setShowNewTicket] = useState(false);

  const organizationId = activeMembership?.organization_id ?? null;

  const { data, isLoading, error, reload } = useApiResource(
    (signal) =>
      listSupportTickets({
        status: activeTab === 'all' ? undefined : activeTab,
        limit: 100,
        signal,
      }),
    [activeTab],
  );

  const tickets = useMemo(() => data?.data ?? [], [data]);

  // Search narrows what the server returned. It must never be the only thing standing
  // between one requester and another's ticket — that scoping is the backend's job.
  const filtered = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (needle === '') return tickets;
    return tickets.filter(
      (ticket) =>
        ticket.subject_code.toLowerCase().includes(needle) ||
        ticket.category_code.toLowerCase().includes(needle) ||
        ticket.support_ticket_id.toLowerCase().includes(needle),
    );
  }, [tickets, searchQuery]);

  const breached = useMemo(
    () => tickets.filter((ticket) => ticket.sla.resolution_breached).length,
    [tickets],
  );
  const awaitingFirstResponse = useMemo(
    () => tickets.filter((ticket) => ticket.sla.first_responded_at === null).length,
    [tickets],
  );

  // --- New ticket mutation ---------------------------------------------------
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<ApiError | null>(null);

  const runCreate = useCallback(
    async (body: CreateSupportTicketRequest, idempotencyKey: string) => {
      if (!organizationId) return;
      setIsCreating(true);
      setCreateError(null);
      try {
        await createSupportTicket(body, idempotencyKey);
        setShowNewTicket(false);
        reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setCreateError(apiError);
      } finally {
        setIsCreating(false);
      }
    },
    [organizationId, reload],
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
      <TopBar breadcrumbs={[{ label: 'Support' }, { label: 'Tickets' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Support Tickets</h1>
              <p className="text-slate-500 mt-1">
                Ordered by urgency: breached first, then soonest due.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setCreateError(null); setShowNewTicket(true); }}
              disabled={!organizationId}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold border border-[#1e3fae] bg-[#1e3fae] text-white hover:bg-[#173080] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <span className="material-symbols-outlined text-base">add</span>
              New Ticket
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'inbox', tint: 'text-blue-600', label: 'Loaded', value: tickets.length, note: 'Tickets in view' },
              { icon: 'alarm', tint: 'text-red-600', label: 'Breached', value: breached, note: 'Past resolution due' },
              { icon: 'schedule', tint: 'text-amber-600', label: 'Unanswered', value: awaitingFirstResponse, note: 'No first response yet' },
            ].map((card) => (
              <div key={card.label} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className={`material-symbols-outlined ${card.tint} text-2xl`}>{card.icon}</span>
                  <span className="text-xs font-bold text-slate-500">{card.label}</span>
                </div>
                <p className="text-3xl font-bold text-slate-900">{isLoading ? '—' : card.value}</p>
                <p className="text-xs text-slate-500 mt-1">{card.note}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full group">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#1e3fae] transition-colors">
              <span className="material-symbols-outlined">search</span>
            </span>
            <input
              className="w-full bg-white text-sm text-slate-900 rounded-lg border border-slate-200 pl-10 pr-4 py-3 placeholder-slate-400 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all shadow-sm"
              placeholder="Search loaded tickets by subject, category or id..."
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>

          {isLoading && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3fae]"></div>
              <p className="text-sm text-slate-500">Loading the queue…</p>
            </div>
          )}

          {!isLoading && error && (
            <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8" role="alert">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600">error</span>
                <div className="flex-1">
                  <h2 className="font-bold text-slate-900">
                    {error.isForbidden ? 'You cannot view the support queue' : 'Could not load the queue'}
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">{error.message}</p>
                  {error.correlationId && (
                    <p className="text-xs text-slate-400 mt-2">
                      Reference: <code>{error.correlationId}</code>
                    </p>
                  )}
                  {!error.isForbidden && (
                    <button
                      onClick={reload}
                      className="mt-4 px-4 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isLoading && !error && filtered.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">inbox</span>
              <h2 className="font-bold text-slate-900 mt-3">
                {tickets.length === 0 ? 'Nothing in this queue' : 'No tickets match your search'}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {tickets.length === 0
                  ? 'There are no tickets with this status right now.'
                  : 'Try a different subject, category or id.'}
              </p>
            </div>
          )}

          {!isLoading && !error && filtered.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Support tickets ordered by SLA urgency</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Subject</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3">Priority</th>
                    <th scope="col" className="px-5 py-3">Requester</th>
                    <th scope="col" className="px-5 py-3">Assignee</th>
                    <th scope="col" className="px-5 py-3">Resolution due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((ticket) => (
                    <tr
                      key={ticket.support_ticket_id}
                      onClick={() => router.push(`/support/tickets/${ticket.support_ticket_id}`)}
                      className={`cursor-pointer hover:bg-slate-50 transition-colors ${
                        ticket.sla.resolution_breached ? 'bg-red-50/40' : ''
                      }`}
                    >
                      <td className="px-5 py-4">
                        <p className="font-bold text-slate-900">{humanise(ticket.subject_code)}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {humanise(ticket.category_code)} · <code>{shortId(ticket.support_ticket_id)}</code>
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                            STATUS_STYLE[ticket.status] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                          }`}
                        >
                          {humanise(ticket.status)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                            PRIORITY_STYLE[ticket.priority] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                          }`}
                        >
                          {humanise(ticket.priority)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {/* An identifier, not a name: no endpoint resolves profile names yet. */}
                        <code className="text-xs text-slate-500">{shortId(ticket.requester_profile_id)}</code>
                      </td>
                      <td className="px-5 py-4">
                        <code className="text-xs text-slate-500">{shortId(ticket.assigned_membership_id)}</code>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={
                            ticket.sla.resolution_breached
                              ? 'font-bold text-red-700'
                              : 'text-slate-600'
                          }
                        >
                          {dueLabel(ticket.sla.resolution_due_at)}
                        </span>
                        {ticket.sla.first_responded_at === null && (
                          <p className="text-xs text-amber-700 mt-0.5">Awaiting first response</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && !error && tickets.length > 0 && (
            <div className="py-4">
              <span className="text-sm text-slate-500">
                Showing <span className="font-bold text-slate-900">{filtered.length}</span> of{' '}
                <span className="font-bold text-slate-900">{tickets.length}</span> loaded tickets
                {tickets.length === 100 && ' (server limit reached; narrow by status)'}
              </span>
            </div>
          )}
        </div>
      </div>

      {showNewTicket && organizationId && (
        <NewTicketModal
          organizationId={organizationId}
          isSaving={isCreating}
          error={createError}
          onClose={() => { setShowNewTicket(false); setCreateError(null); }}
          onSubmit={(body, idempotencyKey) => runCreate(body, idempotencyKey)}
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* New Ticket modal                                                            */
/* -------------------------------------------------------------------------- */

interface NewTicketModalProps {
  readonly organizationId: string;
  readonly isSaving: boolean;
  readonly error: ApiError | null;
  readonly onClose: () => void;
  readonly onSubmit: (body: CreateSupportTicketRequest, idempotencyKey: string) => void;
}

function NewTicketModal({ organizationId, isSaving, error, onClose, onSubmit }: NewTicketModalProps) {
  const [categoryCode, setCategoryCode] = useState('');
  const [subjectCode, setSubjectCode] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<(typeof PRIORITY_OPTIONS)[number]>('medium');

  // Codes are snake_case per the CHECK constraint: ^[a-z][a-z0-9_]{1,62}$
  const codePattern = /^[a-z][a-z0-9_]{1,62}$/;
  const categoryValid = codePattern.test(categoryCode.trim());
  const subjectValid = codePattern.test(subjectCode.trim());
  const bodyValid = body.trim().length > 0;
  const canSubmit = categoryValid && subjectValid && bodyValid && !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const req: CreateSupportTicketRequest = {
      organization_id: organizationId,
      category_code: categoryCode.trim(),
      subject_code: subjectCode.trim(),
      body: body.trim(),
      priority,
    };
    // A fresh key per submit so a replayed double-click cannot create a second ticket.
    onSubmit(req, crypto.randomUUID());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">New Support Ticket</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">
          <form id="new-ticket-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">
                Category code <span className="text-red-500">*</span>
              </span>
              <input
                value={categoryCode}
                onChange={(e) => setCategoryCode(e.target.value)}
                placeholder="e.g. billing_inquiry"
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                required
              />
              <span className="text-xs text-slate-400">Lowercase, snake_case. Must start with a letter.</span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">
                Subject code <span className="text-red-500">*</span>
              </span>
              <input
                value={subjectCode}
                onChange={(e) => setSubjectCode(e.target.value)}
                placeholder="e.g. refund_request"
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                required
              />
              <span className="text-xs text-slate-400">Lowercase, snake_case. Must start with a letter.</span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">Priority</span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as (typeof PRIORITY_OPTIONS)[number])}
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {humanise(p)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">
                Description <span className="text-red-500">*</span>
              </span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe the issue or request..."
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none min-h-[110px]"
                required
              />
            </label>
          </form>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isForbidden
                  ? 'You cannot create support tickets'
                  : error.isConflict
                    ? 'Conflict — this ticket may already exist'
                    : error.title}
              </p>
              <p className="text-xs text-red-600 mt-1">{error.message}</p>
              {error.correlationId && (
                <p className="text-xs text-red-400 mt-1">
                  Reference: <code>{error.correlationId}</code>
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="new-ticket-form"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
            >
              {isSaving ? 'Creating...' : 'Create ticket'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
