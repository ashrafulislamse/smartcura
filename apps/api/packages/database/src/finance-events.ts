/**
 * WP-13 finance, support and export event contracts.
 *
 * Payloads are MINIMUM DATA. A support ticket body is whatever a user typed and a ledger
 * entry describes money movement, so neither travels: only identifiers, states and, for
 * the ledger, the absolute amount a consumer needs to reconcile totals.
 */

export const LEDGER_ENTRY_POSTED_EVENT_TYPE = 'finance.ledger_entry.posted.v1';
export const LEDGER_ENTRY_POSTED_EVENT_VERSION = 1;

export const PAYOUT_RUN_CHANGED_EVENT_TYPE = 'finance.payout_run.changed.v1';
export const PAYOUT_RUN_CHANGED_EVENT_VERSION = 1;

export const SUPPORT_TICKET_CHANGED_EVENT_TYPE = 'support.ticket.changed.v1';
export const SUPPORT_TICKET_CHANGED_EVENT_VERSION = 1;

export const EXPORT_JOB_CHANGED_EVENT_TYPE = 'admin.export_job.changed.v1';
export const EXPORT_JOB_CHANGED_EVENT_VERSION = 1;

export const PAYOUT_RUN_STATUSES = [
  'draft', 'approved', 'processing', 'completed',
  'partially_failed', 'failed', 'cancelled',
] as const;
export type PayoutRunStatus = typeof PAYOUT_RUN_STATUSES[number];

export const PAYOUT_ITEM_STATUSES = ['pending', 'paid', 'failed', 'cancelled'] as const;
export type PayoutItemStatus = typeof PAYOUT_ITEM_STATUSES[number];

export const SUPPORT_TICKET_STATUSES = [
  'open', 'assigned', 'in_progress', 'waiting_requester', 'resolved', 'closed',
] as const;
export type SupportTicketStatus = typeof SUPPORT_TICKET_STATUSES[number];

export const SUPPORT_TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type SupportTicketPriority = typeof SUPPORT_TICKET_PRIORITIES[number];

export const EXPORT_JOB_STATUSES = [
  'queued', 'running', 'completed', 'failed', 'expired', 'cancelled',
] as const;
export type ExportJobStatus = typeof EXPORT_JOB_STATUSES[number];

export const LEDGER_ENTRY_KINDS = [
  'appointment_payment', 'appointment_refund', 'delivery_fee', 'doctor_payout',
  'driver_withdrawal', 'platform_fee', 'adjustment', 'reversal',
] as const;
export type LedgerEntryKind = typeof LEDGER_ENTRY_KINDS[number];

/** Exact minimum payload keys, asserted by the worker. */
export const LEDGER_ENTRY_POSTED_KEYS = [
  'ledger_entry_id', 'kind', 'amount_sen',
] as const;

export const PAYOUT_RUN_CHANGED_KEYS = ['payout_run_id', 'status'] as const;

export const SUPPORT_TICKET_CHANGED_KEYS = ['support_ticket_id', 'status'] as const;

export const EXPORT_JOB_CHANGED_KEYS = [
  'export_job_id', 'status', 'dataset_code',
] as const;
