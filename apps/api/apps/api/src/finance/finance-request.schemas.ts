import {
  LEDGER_ENTRY_KINDS,
  PAYOUT_RUN_STATUSES,
  SUPPORT_TICKET_STATUSES,
} from '@smartcura/database';
import { z } from 'zod';

const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
const code = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const expectedVersion = z.number().int().min(0);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createPayoutRunSchema = z.object({
  period_start: calendarDate,
  period_end: calendarDate,
}).strict().refine(
  (value) => value.period_end >= value.period_start,
  { message: 'the period must not end before it starts' },
);

/**
 * Money is an integer count of MYR sen. The fee is bounded by the gross here as well as by
 * a database CHECK, so a negative net is refused as a validation failure rather than
 * surfacing a constraint violation as a 500.
 */
export const addPayoutItemSchema = z.object({
  payee_membership_id: uuidV7,
  gross_sen: z.number().int().min(1).max(100_000_000),
  platform_fee_sen: z.number().int().min(0).max(100_000_000),
}).strict().refine(
  (value) => value.platform_fee_sen <= value.gross_sen,
  { message: 'the platform fee cannot exceed the gross amount' },
);

export const advancePayoutRunSchema = z.object({
  // `completed`, `partially_failed` and `failed` are DERIVED from item outcomes and are
  // deliberately not requestable: a run cannot be declared successful by assertion.
  status: z.enum(['approved', 'processing', 'cancelled']),
  reason_code: code.nullable().default(null),
  expected_version: expectedVersion,
}).strict().refine(
  (value) => (value.status === 'cancelled' ? value.reason_code !== null : true),
  { message: 'a cancellation requires a reason code' },
);

export const settlePayoutItemSchema = z.object({
  payable_account_id: uuidV7,
  cash_account_id: uuidV7,
}).strict().refine(
  (value) => value.payable_account_id !== value.cash_account_id,
  { message: 'a settlement must move between two different accounts' },
);

export const reverseEntrySchema = z.object({
  memo_code: code,
}).strict();

export const createTicketSchema = z.object({
  organization_id: uuidV7,
  category_code: code,
  subject_code: code,
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  body: z.string().trim().min(1).max(8000),
}).strict();

export const addTicketMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  // Only staff may mark a note internal; the service enforces that, because a requester
  // marking their own message internal would hide it from the people meant to read it.
  internal_only: z.boolean().default(false),
}).strict();

export const assignTicketSchema = z.object({
  assigned_membership_id: uuidV7,
  reason_code: code,
  expected_version: expectedVersion,
}).strict();

export const advanceTicketSchema = z.object({
  status: z.enum(['in_progress', 'waiting_requester', 'resolved', 'closed']),
  reason_code: code,
  resolution_code: code.nullable().default(null),
  expected_version: expectedVersion,
}).strict().refine(
  (value) => (value.status === 'resolved' ? value.resolution_code !== null : true),
  { message: 'resolving requires a resolution code' },
);

export const requestExportSchema = z.object({
  dataset_code: code,
  // A bulk disclosure must say WHY. The purpose is retained with the job so an export can
  // be reviewed later against the reason it was requested.
  purpose_code: code,
}).strict();

export const updateSettingSchema = z.object({
  // jsonb `null` would defeat the NOT NULL column, so a null value is refused here as
  // well as by a database CHECK.
  value: z.union([
    z.string(), z.number(), z.boolean(),
    z.record(z.string(), z.unknown()), z.array(z.unknown()),
  ]),
  expected_version: expectedVersion,
}).strict();

export type CreatePayoutRunRequest = z.infer<typeof createPayoutRunSchema>;
export type AddPayoutItemRequest = z.infer<typeof addPayoutItemSchema>;
export type AdvancePayoutRunRequest = z.infer<typeof advancePayoutRunSchema>;
export type CreateTicketRequest = z.infer<typeof createTicketSchema>;
export type AdvanceTicketRequest = z.infer<typeof advanceTicketSchema>;
export type RequestExportRequest = z.infer<typeof requestExportSchema>;

/**
 * Support queue filters. `limit` is bounded because an unbounded queue read is a denial
 * of service against the operator's own browser as much as the server.
 */
export const listTicketsSchema = z.object({
  // Derived from the canonical list rather than retyped: hand-copying this vocabulary is
  // how `waiting_requester` became `waiting_on_requester` and `assigned` went missing.
  status: z.enum(SUPPORT_TICKET_STATUSES as unknown as [string, ...string[]]).optional(),
  assigned_membership_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

/** Vocabularies derived from the canonical exports, never retyped. */
export const listPayoutRunsSchema = z.object({
  status: z.enum(PAYOUT_RUN_STATUSES as unknown as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const listLedgerEntriesSchema = z.object({
  kind: z.enum(LEDGER_ENTRY_KINDS as unknown as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();
