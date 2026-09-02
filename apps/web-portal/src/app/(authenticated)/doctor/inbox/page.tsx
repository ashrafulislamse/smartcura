'use client';

/**
 * Doctor Inbox — the signed-in doctor's patient conversations, wired to
 * GET /conversations (inbox), GET /conversations/{id}/messages (feed),
 * POST /conversations/{id}/messages (reply) and PUT /conversations/{id}/read.
 *
 * MASTER-DETAIL. The left panel lists conversations from `listDoctorInbox`; the right
 * panel shows the server-sequenced message feed for the selected conversation and a
 * composer. On narrow screens only one panel is shown at a time: the list until a
 * conversation is tapped, then the thread (with a back button to return).
 *
 * IDENTIFIERS, NOT NAMES. No endpoint resolves a patient's name from this surface, so
 * the conversation list and thread header show `patient {shortId(patient_profile_id)}`
 * rather than inventing a name — the same honest-limits rule the support queue follows.
 *
 * MARK-READ AFTER VIEWING. Once a conversation's messages load, the latest `sequence_no`
 * is sent to `markConversationRead` so the unread badge clears. A ref keyed by
 * `{conversationId}:{maxSeq}` prevents duplicate PUTs across re-renders; the call is
 * idempotent anyway. The inbox is reloaded afterwards so the badge updates in the list.
 *
 * THE FEED IS RE-READ, NOT LOCALLY APPENDED. After a reply is accepted the message feed
 * is reloaded: the server is the only authority on ordering, deduplication (via
 * `client_correlation_id`) and whether the message was recorded. A fresh
 * `client_correlation_id` plus a fresh Idempotency-Key per send means a replayed
 * double-click cannot create a second message.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import {
  listDoctorInbox,
  listConversationMessages,
  sendConversationMessage,
  markConversationRead,
} from '@/lib/api/clinical';
import { humaniseCode, shortId, formatInstant } from '@/lib/api/directory';
import { ApiError } from '@/lib/api/client';
import type {
  ConversationInbox,
  Message,
  CreateMessageRequest,
} from '@/types/contracts';

/** Conversation status vocabulary, keyed exhaustively. */
const CONVERSATION_STATUS_TONE: Record<'active' | 'closed', BadgeTone> = {
  active: 'green',
  closed: 'slate',
};

function conversationStatusTone(status: string): BadgeTone {
  return status === 'active' || status === 'closed'
    ? CONVERSATION_STATUS_TONE[status]
    : 'slate';
}

export default function DoctorInboxPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  // --- Inbox list (left panel) ----------------------------------------------
  const inbox = useApiResource(
    (signal) => listDoctorInbox({ pageSize: 100, signal }),
    [],
  );
  const conversations = useMemo(() => inbox.data?.data ?? [], [inbox.data]);
  const reloadInbox = inbox.reload;

  const selectedConversation = selectedConversationId
    ? conversations.find((c) => c.conversation_id === selectedConversationId) ?? null
    : null;

  // --- Message feed (right panel), keyed on the selected conversation --------
  const messages = useApiResource(
    (signal) =>
      selectedConversationId
        ? listConversationMessages(selectedConversationId, { pageSize: 100, signal })
        : Promise.resolve(null),
    [selectedConversationId],
  );
  const messageRows = useMemo(() => {
    const list = messages.data?.data ?? [];
    // The server sequences messages by `sequence_no`; sort defensively so the feed is
    // always ascending regardless of how the page was served.
    return [...list].sort((a, b) => a.sequence_no - b.sequence_no);
  }, [messages.data]);

  // --- Composer state --------------------------------------------------------
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // --- Mark-read-after-viewing -----------------------------------------------
  // A ref keyed by `{conversationId}:{maxSeq}` prevents duplicate PUTs. The inbox is
  // reloaded afterwards so the unread badge clears in the list.
  const lastMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedConversationId || messageRows.length === 0) return;
    const maxSeq = messageRows.reduce((max, m) => Math.max(max, m.sequence_no), 0);
    const marker = `${selectedConversationId}:${maxSeq}`;
    if (lastMarkedRef.current === marker) return;
    lastMarkedRef.current = marker;
    markConversationRead(selectedConversationId, { through_sequence_no: maxSeq })
      .then(() => reloadInbox())
      .catch(() => {
        // Non-fatal: the badge will refresh on the next reload. A failed receipt does
        // not block reading or replying.
      });
  }, [messageRows, selectedConversationId, reloadInbox]);

  // --- Auto-scroll the feed to the latest message ----------------------------
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messageRows]);

  // --- Reply mutation --------------------------------------------------------
  async function sendMessage() {
    const body = draft.trim();
    if (body === '' || !selectedConversationId || sending) return;
    setSending(true);
    setSendError(null);
    const payload: CreateMessageRequest = {
      message_type: 'text',
      text_content: body,
      // Fresh per send: the server deduplicates on this id, so a replayed double-click
      // cannot create a second message.
      client_correlation_id: crypto.randomUUID(),
    };
    try {
      await sendConversationMessage(selectedConversationId, payload, crypto.randomUUID());
      setDraft('');
      // Re-read the feed: the server is the authority on ordering and dedup.
      messages.reload();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      setSendError(apiError ? apiError.message : 'Could not send the message');
    } finally {
      setSending(false);
    }
  }

  function selectConversation(id: string) {
    setSelectedConversationId(id);
    setSendError(null);
    setDraft('');
  }

  if (isAuthLoading || !user || user.activeRole !== 'doctor') {
    return <PageLoader label="Loading inbox..." />;
  }

  const showThread = selectedConversationId !== null;
  // The backend is the authority on whether a closed conversation may be replied to.
  // We only disable the composer when the inbox row confirms `closed`; if the row is
  // stale or missing we let the request through and surface a backend refusal.
  const canReply = selectedConversation?.status !== 'closed';
  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Inbox' }]} />

      <div className="flex-1 overflow-hidden p-4 md:p-6 flex flex-col">
        <PageHeader
          title="Inbox"
          subtitle="Patient conversations"
          actions={
            <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-500">
              <span className="material-symbols-outlined text-base text-[#1e3fae]">mail</span>
              {totalUnread} unread
            </span>
          }
        />

        <div className="mt-4 flex-1 min-h-0 flex gap-4">
          {/* ---------------------------------------------------------------- */}
          {/* Left panel — conversation list                                    */}
          {/* ---------------------------------------------------------------- */}
          <aside
            className={`${showThread ? 'hidden md:flex' : 'flex'} w-full md:w-80 lg:w-96 shrink-0 flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden`}
          >
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-700">
                {conversations.length} conversation{conversations.length === 1 ? '' : 's'}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ResourceState
                isLoading={inbox.isLoading}
                error={inbox.error}
                isEmpty={!inbox.isLoading && !inbox.error && conversations.length === 0}
                onRetry={reloadInbox}
                loadingLabel="Loading conversations…"
                forbiddenTitle="You cannot view the inbox"
                errorTitle="Could not load the inbox"
                emptyTitle="No conversations"
                emptyBody="You have no patient conversations yet. Conversations appear here when a patient messages a consultation you are assigned to."
                emptyIcon="forum"
              />
              {!inbox.isLoading && !inbox.error && conversations.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {conversations.map((conversation: ConversationInbox) => {
                    const isSelected = conversation.conversation_id === selectedConversationId;
                    const hasUnread = conversation.unread_count > 0;
                    return (
                      <li key={conversation.conversation_id}>
                        <button
                          type="button"
                          onClick={() => selectConversation(conversation.conversation_id)}
                          className={`w-full text-left px-4 py-3.5 flex flex-col gap-1.5 transition-colors ${
                            isSelected
                              ? 'bg-[#1e3fae]/5 border-l-2 border-[#1e3fae]'
                              : 'hover:bg-slate-50 border-l-2 border-transparent'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-sm truncate ${
                                hasUnread
                                  ? 'font-bold text-slate-900'
                                  : 'font-semibold text-slate-700'
                              }`}
                            >
                              patient {shortId(conversation.patient_profile_id)}
                            </span>
                            {hasUnread && (
                              <span className="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#1e3fae] text-white text-[11px] font-bold">
                                {conversation.unread_count}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <Badge tone={conversationStatusTone(conversation.status)}>
                              {humaniseCode(conversation.status)}
                            </Badge>
                            <span className="text-xs text-slate-400">
                              {formatInstant(conversation.latest_message_at)}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* ---------------------------------------------------------------- */}
          {/* Right panel — message thread + composer                           */}
          {/* ---------------------------------------------------------------- */}
          <section
            className={`${showThread ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden`}
          >
            {!showThread ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
                <span className="material-symbols-outlined text-slate-300 text-5xl">
                  mark_chat_read
                </span>
                <h2 className="font-bold text-slate-900 mt-3">Select a conversation</h2>
                <p className="text-sm text-slate-500 mt-1 max-w-xs">
                  Choose a conversation from the list to read its messages and reply.
                </p>
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedConversationId(null)}
                    className="md:hidden text-slate-500 hover:text-[#1e3fae] transition-colors"
                    aria-label="Back to conversations"
                  >
                    <span className="material-symbols-outlined">arrow_back</span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      patient {shortId(selectedConversation?.patient_profile_id ?? selectedConversationId)}
                    </p>
                    <p className="text-xs text-slate-500">
                      consultation <code>{shortId(selectedConversation?.consultation_id ?? null)}</code>
                    </p>
                  </div>
                  {selectedConversation && (
                    <Badge tone={conversationStatusTone(selectedConversation.status)}>
                      {humaniseCode(selectedConversation.status)}
                    </Badge>
                  )}
                </div>

                {/* Message feed */}
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  <ResourceState
                    isLoading={messages.isLoading}
                    error={messages.error}
                    isEmpty={
                      !messages.isLoading && !messages.error && messageRows.length === 0
                    }
                    onRetry={messages.reload}
                    loadingLabel="Loading messages…"
                    forbiddenTitle="You cannot view this conversation"
                    errorTitle="Could not load the messages"
                    emptyTitle="No messages"
                    emptyBody="This conversation has no messages yet. Write the first reply below."
                    emptyIcon="chat_bubble_outline"
                  />
                  {!messages.isLoading && !messages.error && messageRows.length > 0 && (
                    <div className="flex flex-col gap-4">
                      {messageRows.map((message: Message) => (
                        <MessageBubble key={message.message_id} message={message} userName={user.name} />
                      ))}
                      <div ref={feedEndRef} />
                    </div>
                  )}
                </div>

                {/* Composer */}
                <div className="border-t border-slate-100 p-4">
                  {!canReply ? (
                    <p className="text-sm text-slate-500 text-center py-2">
                      This conversation is closed and can no longer receive replies.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <textarea
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] focus:bg-white transition-all resize-none min-h-[80px] text-sm"
                        placeholder="Write a reply to the patient…"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          // Ctrl/Cmd+Enter sends — a common composer affordance.
                          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                            event.preventDefault();
                            void sendMessage();
                          }
                        }}
                      />
                      {sendError && (
                        <p className="text-sm text-red-600" role="alert">{sendError}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">
                          Press Ctrl+Enter to send
                        </span>
                        <button
                          type="button"
                          onClick={() => void sendMessage()}
                          disabled={draft.trim() === '' || sending}
                          className="inline-flex items-center gap-2 bg-[#1e3fae] hover:bg-[#173080] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-5 rounded-lg shadow-sm transition-all text-sm"
                        >
                          <span>{sending ? 'Sending…' : 'Send'}</span>
                          <span className="material-symbols-outlined text-[18px]">send</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Message bubble                                                              */
/* -------------------------------------------------------------------------- */

interface MessageBubbleProps {
  readonly message: Message;
  readonly userName: string;
}

function MessageBubble({ message, userName }: MessageBubbleProps) {
  // `is_me` is the server's authoritative view of whether the signed-in user authored
  // the message — preferable to comparing profile ids, which the inbox does not surface.
  const mine = message.is_me;
  const isFile = message.message_type === 'file';

  return (
    <div className={`flex gap-3 ${mine ? 'flex-row-reverse' : ''}`}>
      <div
        className={`shrink-0 size-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${
          mine ? 'bg-[#1e3fae]' : 'bg-slate-400'
        }`}
      >
        {mine ? (userName.charAt(0) || 'D') : 'P'}
      </div>
      <div className={`flex flex-col gap-1 max-w-[75%] ${mine ? 'items-end' : ''}`}>
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold text-slate-700">
            {mine ? 'You' : 'Patient'}
          </span>
          <span className="text-xs text-slate-400">
            {formatInstant(message.created_at)}
          </span>
        </div>
        <div
          className={`p-3.5 rounded-2xl text-sm leading-relaxed ${
            mine
              ? 'bg-[#1e3fae] text-white rounded-tr-none'
              : 'bg-slate-100 text-slate-700 rounded-tl-none'
          }`}
        >
          {isFile ? (
            <span className="inline-flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">attach_file</span>
              Attachment
            </span>
          ) : (
            <p className="whitespace-pre-wrap">{message.text_content ?? ''}</p>
          )}
        </div>
        {message.read_at && mine && (
          <span className="text-[11px] text-slate-400">Read</span>
        )}
      </div>
    </div>
  );
}
