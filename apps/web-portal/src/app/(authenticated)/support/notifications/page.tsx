'use client';

/**
 * Broadcast messaging, wired to GET/POST /admin/broadcasts, the schedule and send routes,
 * and GET /admin/notification-templates.
 *
 * THE FREE-TEXT COMPOSER IS GONE, and that is the substantive change rather than a cosmetic
 * one. The mock offered `title` and `message` text boxes. `CreateBroadcastMessageRequest`
 * accepts only `template_key`, `template_version` and `audience` — a broadcast CANNOT carry
 * ad-hoc text at all. That is a deliberate design, visible from the other end too: a
 * delivered `Notification` carries `title_code` and `body_code`, not a title and a body, so
 * the client renders the wording. Free text would be untranslatable, unreviewable and
 * unversioned, and typing it into a box that then discarded it would be a lie about what the
 * system does. So this page picks an approved template version instead.
 *
 * SEND AND SCHEDULE ARE NOT THE SAME ACTION. The mock had a "now / later" radio. Sending is
 * queued to the transactional outbox immediately and cannot be recalled; a schedule can be
 * re-read and changed until it fires. Modelling "now" as a schedule with the current time
 * would imply a reversibility that does not exist, so they are separate controls and the
 * irreversible one says so.
 *
 * Every mutation carries `expected_version`, taken from the row as read. A concurrent edit
 * makes it stale and the server refuses rather than overwriting.
 */

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  createBroadcastMessage,
  listBroadcastMessages,
  listNotificationTemplates,
  scheduleBroadcastMessage,
  sendBroadcastMessage,
} from '@/lib/api/administration';
import { humaniseCode } from '@/lib/api/directory';
import { ApiError } from '@/lib/api/client';
import TopBar from '@/components/layout/TopBar';

const AUDIENCES = ['all', 'patients', 'staff'] as const;
type Audience = (typeof AUDIENCES)[number];

/**
 * THE BROADCAST STATUS VOCABULARY, and a case where the compiler cannot help. The generated
 * contract types `status` as a bare `string`, so an invented value would compile silently —
 * unlike the membership enums, which are generated unions. The real database enum is:
 *
 *     draft, scheduled, dispatching, sent, cancelled
 *
 * I had originally written `dispatched`, which does not exist, and treated `dispatching` as
 * still actionable. Both are wrong: a broadcast mid-flight would have rendered with the
 * fallback style AND offered a send button for something already being delivered. Because the
 * type cannot enforce this, `verify-portal-broadcast` asserts the list below matches
 * `pg_enum` exactly.
 */
const BROADCAST_STATUSES = ['draft', 'scheduled', 'dispatching', 'sent', 'cancelled'] as const;
type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

const STATUS_TINT: Record<BroadcastStatus, string> = {
  draft: 'bg-slate-50 text-slate-700 border-slate-100',
  scheduled: 'bg-amber-50 text-amber-700 border-amber-100',
  dispatching: 'bg-blue-50 text-blue-700 border-blue-100',
  sent: 'bg-green-50 text-green-700 border-green-100',
  cancelled: 'bg-red-50 text-red-700 border-red-100',
};

/**
 * Only a draft or a schedule can still be acted on.
 *
 * `dispatching` is deliberately NOT actionable even though it is not terminal: the worker is
 * already delivering, so offering "send" would duplicate and offering "schedule" would be
 * ignored. The database enforces `status = 'sent'` exactly when `dispatched_at` is set, so
 * those two can never disagree and either alone is a sound test for delivered.
 */
function isActionable(status: string): boolean {
  return status === 'draft' || status === 'scheduled';
}

function formatInstant(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

export default function BroadcastNotificationsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();

  const [templateKey, setTemplateKey] = useState('');
  const [audience, setAudience] = useState<Audience>('all');
  const [scheduleAt, setScheduleAt] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const broadcasts = useApiResource((signal) => listBroadcastMessages(signal), []);
  const templates = useApiResource((signal) => listNotificationTemplates(signal), []);

  const rows = useMemo(() => broadcasts.data?.data ?? [], [broadcasts.data]);
  const templateList = useMemo(() => templates.data?.data ?? [], [templates.data]);

  /**
   * ONLY TEMPLATES WITH AN APPROVED ACTIVE VERSION CAN BE BROADCAST. `active_version` is
   * nullable, and a null one means no version has been activated yet — there is literally no
   * wording to send. Offering such a template in the picker would produce a request the
   * server must reject, so it is excluded here and the count is stated instead of hidden.
   */
  const sendableTemplates = useMemo(
    () => templateList.filter((template) => template.active_version !== null),
    [templateList],
  );
  const unsendableCount = templateList.length - sendableTemplates.length;

  const selectedTemplate = useMemo(
    () => sendableTemplates.find((template) => template.template_key === templateKey) ?? null,
    [sendableTemplates, templateKey],
  );

  /**
   * Ordered by what still needs a decision: drafts first, then scheduled, then the
   * dispatched history. Recency would bury a draft under everything already sent.
   */
  const ordered = useMemo(() => {
    const weight = (row: (typeof rows)[number]) => {
      if (!isActionable(row.status)) return 2;
      if (row.status === 'scheduled') return 1;
      return 0;
    };
    return [...rows].sort((left, right) => {
      const byState = weight(left) - weight(right);
      if (byState !== 0) return byState;
      return right.created_at.localeCompare(left.created_at);
    });
  }, [rows]);

  const pending = useMemo(
    () => rows.filter((row) => isActionable(row.status)).length,
    [rows],
  );

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>, success: string) => {
      setBusyId(id);
      setActionError(null);
      setNotice(null);
      try {
        await action();
        setNotice(success);
        // Re-read rather than patching local state: the version advances server-side, and a
        // stale version here would make the next action fail for a confusing reason.
        await broadcasts.reload();
      } catch (error) {
        // The problem detail if the server sent one, since it names the actual refusal —
        // a stale expected_version reads very differently from a permission failure.
        setActionError(
          error instanceof ApiError
            ? `${error.title}${error.message && error.message !== error.title ? `: ${error.message}` : ''}`
            : 'The action could not be completed.',
        );
      } finally {
        setBusyId(null);
      }
    },
    [broadcasts],
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
      <TopBar breadcrumbs={[{ label: 'Support' }, { label: 'Broadcasts' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Broadcasts</h1>
            <p className="text-slate-500 mt-1">
              Send an approved notification template to an audience.
            </p>
          </div>

          {notice && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800" role="status">
              {notice}
            </div>
          )}
          {actionError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
              {actionError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: 'campaign', tint: 'text-blue-600', label: 'Broadcasts', value: String(rows.length), note: 'All time' },
              { icon: 'pending_actions', tint: 'text-amber-600', label: 'Not yet sent', value: String(pending), note: 'Draft or scheduled' },
              { icon: 'description', tint: 'text-slate-600', label: 'Templates', value: String(sendableTemplates.length),
                note: unsendableCount > 0 ? `${unsendableCount} without an active version` : 'Available to send' },
            ].map((card) => (
              <div key={card.label} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className={`material-symbols-outlined ${card.tint} text-2xl`}>{card.icon}</span>
                  <span className="text-xs font-bold text-slate-500">{card.label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">
                  {broadcasts.isLoading ? '—' : card.value}
                </p>
                <p className="text-xs text-slate-500 mt-1">{card.note}</p>
              </div>
            ))}
          </div>

          {/* ---------------------------------------------------------------- composer */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="font-bold text-slate-900">New broadcast</h2>
            <p className="text-sm text-slate-500 mt-1">
              The wording comes from an approved template version, so it can be reviewed and
              translated. There is no free-text field.
            </p>

            {templates.error ? (
              <div className="mt-4">
                <ResourceState
                  isLoading={false}
                  error={templates.error}
                  isEmpty={false}
                  onRetry={templates.reload}
                  loadingLabel="Loading templates…"
                  forbiddenTitle="You cannot read notification templates"
                  errorTitle="Could not load templates"
                  emptyTitle="No templates"
                  emptyBody="Templates are managed separately."
                  emptyIcon="description"
                />
              </div>
            ) : sendableTemplates.length === 0 && !templates.isLoading ? (
              <p className="mt-4 text-sm text-slate-500">
                {templateList.length === 0
                  ? 'No templates exist yet, so there is nothing that can be broadcast.'
                  : `${templateList.length} template${templateList.length === 1 ? '' : 's'} exist but none has an approved active version, so none can be sent.`}
              </p>
            ) : (
              <form
                className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!selectedTemplate) return;
                  void runAction(
                    'new',
                    () =>
                      createBroadcastMessage({
                        template_key: selectedTemplate.template_key,
                        // The ACTIVE version, read from the template rather than typed. A
                        // hand-entered number could name a version that was never approved.
                        // Non-null by construction: only templates with an active version
                        // reach the picker.
                        template_version: selectedTemplate.active_version as number,
                        audience,
                      }),
                    'Broadcast created as a draft. Schedule it or send it below.',
                  );
                }}
              >
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Template
                  </span>
                  <select
                    value={templateKey}
                    onChange={(event) => setTemplateKey(event.target.value)}
                    required
                    className="bg-white text-sm text-slate-900 rounded-lg border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae]"
                  >
                    <option value="">Select a template…</option>
                    {sendableTemplates.map((template) => (
                      <option key={template.template_key} value={template.template_key}>
                        {humaniseCode(template.template_key)} (v{template.active_version})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Audience
                  </span>
                  <select
                    value={audience}
                    onChange={(event) => setAudience(event.target.value as Audience)}
                    className="bg-white text-sm text-slate-900 rounded-lg border border-slate-200 px-3 py-2.5 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae]"
                  >
                    {AUDIENCES.map((option) => (
                      <option key={option} value={option}>
                        {humaniseCode(option)}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="submit"
                  disabled={templateKey === '' || busyId !== null}
                  className="px-5 py-2.5 bg-[#1e3fae] text-white rounded-lg font-bold text-sm shadow-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busyId === 'new' ? 'Creating…' : 'Create draft'}
                </button>

                {selectedTemplate && (
                  <p className="md:col-span-3 text-xs text-slate-500">
                    Category <span className="font-bold">{humaniseCode(selectedTemplate.category)}</span>,
                    active version <span className="font-bold">{selectedTemplate.active_version}</span>.
                    Created as a draft — nothing is delivered until you send it.
                  </p>
                )}
              </form>
            )}
          </section>

          <ResourceState
            isLoading={broadcasts.isLoading}
            error={broadcasts.error}
            isEmpty={ordered.length === 0}
            onRetry={broadcasts.reload}
            loadingLabel="Loading broadcasts…"
            forbiddenTitle="You cannot manage broadcasts"
            errorTitle="Could not load broadcasts"
            emptyTitle="No broadcasts yet"
            emptyBody="Create one above. It starts as a draft."
            emptyIcon="campaign"
          />

          {!broadcasts.isLoading && !broadcasts.error && ordered.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Broadcasts, with those still needing a decision first
                </caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Broadcast</th>
                    <th scope="col" className="px-5 py-3">Audience</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3">Scheduled</th>
                    <th scope="col" className="px-5 py-3">Dispatched</th>
                    <th scope="col" className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ordered.map((row) => {
                    const actionable = isActionable(row.status);
                    const busy = busyId === row.broadcast_message_id;
                    return (
                      <tr
                        key={row.broadcast_message_id}
                        className={`hover:bg-slate-50 transition-colors ${actionable ? 'bg-amber-50/20' : ''}`}
                      >
                        <td className="px-5 py-3">
                          <code className="font-bold text-slate-900">
                            {row.broadcast_message_id.slice(0, 8)}
                          </code>
                          <span className="block text-xs text-slate-400">
                            created {formatInstant(row.created_at)} · v{row.version}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-700">{humaniseCode(row.audience)}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                              STATUS_TINT[row.status as BroadcastStatus] ?? 'bg-slate-50 text-slate-700 border-slate-100'
                            }`}
                          >
                            {humaniseCode(row.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-500">{formatInstant(row.scheduled_at)}</td>
                        <td className="px-5 py-3 text-slate-500">{formatInstant(row.dispatched_at)}</td>
                        <td className="px-5 py-3">
                          {!actionable ? (
                            // No control at all, rather than a disabled one: a dispatched
                            // broadcast cannot be recalled, so offering anything would mislead.
                            <span className="block text-right text-xs text-slate-400">
                              {row.status === 'dispatching'
                                ? 'Delivering now — cannot be recalled'
                                : row.status === 'cancelled'
                                  ? 'Cancelled'
                                  : 'Delivered — cannot be recalled'}
                            </span>
                          ) : (
                            <div className="flex flex-col md:flex-row gap-2 justify-end">
                              <input
                                type="datetime-local"
                                aria-label={`Schedule broadcast ${row.broadcast_message_id.slice(0, 8)}`}
                                value={scheduleAt}
                                onChange={(event) => setScheduleAt(event.target.value)}
                                className="text-xs rounded-lg border border-slate-200 px-2 py-1.5"
                              />
                              <button
                                onClick={() =>
                                  void runAction(
                                    row.broadcast_message_id,
                                    () =>
                                      scheduleBroadcastMessage(
                                        row.broadcast_message_id,
                                        new Date(scheduleAt).toISOString(),
                                        row.version,
                                      ),
                                    'Scheduled. It can still be changed until it fires.',
                                  )
                                }
                                disabled={scheduleAt === '' || busy}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              >
                                Schedule
                              </button>
                              <button
                                onClick={() =>
                                  void runAction(
                                    row.broadcast_message_id,
                                    () => sendBroadcastMessage(row.broadcast_message_id, row.version),
                                    'Queued for delivery. This cannot be recalled.',
                                  )
                                }
                                disabled={busy}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#1e3fae] text-white hover:bg-blue-700 disabled:opacity-50"
                              >
                                {busy ? 'Working…' : 'Send now'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!broadcasts.isLoading && !broadcasts.error && ordered.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{ordered.length}</span> broadcast
              {ordered.length === 1 ? '' : 's'}; those awaiting a decision are listed first.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
