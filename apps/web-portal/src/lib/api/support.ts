/**
 * Support surface: the organization ticket queue and one ticket's thread.
 *
 * WHO SEES WHAT is decided by the backend, not here. Staff holding
 * `support.ticket:manage:organization` receive the whole organization; anyone else
 * receives only the tickets they raised, scoped in the query rather than filtered
 * afterwards. The portal must not attempt its own filtering, because a client-side
 * filter over a server-side over-fetch is a disclosure waiting to happen.
 *
 * Queue rows carry no message body on purpose: a ticket body is whatever a user typed.
 * Read the thread when a specific ticket is opened.
 */

import type {
  AddSupportTicketMessageRequest,
  AdvanceSupportTicketRequest,
  AssignSupportTicketRequest,
  CreateSupportTicketRequest,
  SupportTicketCreated,
  SupportTicketList,
  SupportTicketMessageRecorded,
  SupportTicketState,
  SupportTicketThread,
} from '@/types/contracts';
import { apiRequest } from './client';

export type SupportTicketStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'waiting_requester'
  | 'resolved'
  | 'closed';

export interface ListSupportTicketsOptions {
  readonly status?: SupportTicketStatus;
  readonly assignedMembershipId?: string;
  /** Server-bounded to 100. Requesting more is refused rather than silently clamped. */
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

/**
 * Ordered by urgency by the backend — breached first, then soonest due — so the caller
 * should NOT re-sort by recency. A queue sorted by creation time buries the ticket about
 * to miss its SLA behind newer ones.
 */
export function listSupportTickets(
  options: ListSupportTicketsOptions = {},
): Promise<SupportTicketList> {
  const query = new URLSearchParams();
  if (options.status) query.set('status', options.status);
  if (options.assignedMembershipId) query.set('assigned_membership_id', options.assignedMembershipId);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
  return apiRequest<SupportTicketList>({
    method: 'GET',
    path: `/support/tickets${suffix}`,
    signal: options.signal,
  });
}

/** The thread. Internal notes are excluded for a requester by the backend query. */
export function readSupportTicket(
  supportTicketId: string,
  signal?: AbortSignal,
): Promise<SupportTicketThread> {
  return apiRequest<SupportTicketThread>({
    method: 'GET',
    path: `/support/tickets/${supportTicketId}`,
    signal,
  });
}

export function createSupportTicket(
  body: CreateSupportTicketRequest,
  idempotencyKey: string,
): Promise<SupportTicketCreated> {
  return apiRequest<SupportTicketCreated>({
    method: 'POST',
    path: '/support/tickets',
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** `internal_only` notes are never disclosed to the requester. */
export function addSupportTicketMessage(
  supportTicketId: string,
  body: AddSupportTicketMessageRequest,
): Promise<SupportTicketMessageRecorded> {
  return apiRequest<SupportTicketMessageRecorded>({
    method: 'POST',
    path: `/support/tickets/${supportTicketId}/messages`,
    body,
    csrf: true,
  });
}

export function assignSupportTicket(
  supportTicketId: string,
  body: AssignSupportTicketRequest,
): Promise<SupportTicketState> {
  return apiRequest<SupportTicketState>({
    method: 'PUT',
    path: `/support/tickets/${supportTicketId}/assignment`,
    body,
    csrf: true,
  });
}

/**
 * Status transitions are constrained by the backend: a ticket cannot close before it is
 * resolved, and resolving requires a resolution code.
 */
export function advanceSupportTicket(
  supportTicketId: string,
  body: AdvanceSupportTicketRequest,
): Promise<SupportTicketState> {
  return apiRequest<SupportTicketState>({
    method: 'PUT',
    path: `/support/tickets/${supportTicketId}/status`,
    body,
    csrf: true,
  });
}
