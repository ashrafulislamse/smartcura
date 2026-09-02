import {
  PURCHASE_ORDER_STATUSES,
  RECONCILIATION_STATUSES,
  RETURN_STATUSES,
} from '@smartcura/database/procurement';
import { z } from 'zod';

const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
const code = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const expectedVersion = z.number().int().min(0);

export const createPurchaseOrderSchema = z.object({
  supplier_id: uuidV7,
}).strict();

export const addPurchaseOrderItemSchema = z.object({
  variant_id: uuidV7,
  ordered_quantity: z.number().int().min(1).max(1_000_000),
  // Cost is an integer count of MYR sen, like every other money field.
  unit_cost_sen: z.number().int().min(0).max(100_000_000),
}).strict();

export const advancePurchaseOrderSchema = z.object({
  // `partially_received` and `received` are DERIVED from what actually arrived and are
  // deliberately not requestable: a buyer must not be able to declare an order complete.
  status: z.enum(['submitted', 'approved', 'ordered', 'cancelled']),
  expected_version: expectedVersion,
}).strict();

/**
 * A goods receipt names the lot and its expiry because FEFO picking depends on both. A receipt
 * without an expiry would enter stock that the picker cannot order correctly.
 */
export const receiveGoodsSchema = z.object({
  variant_id: uuidV7,
  lot_number: z.string().trim().min(1).max(64),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  received_quantity: z.number().int().min(1).max(1_000_000),
}).strict();

export const createReturnSchema = z.object({
  pharmacy_order_id: uuidV7.nullable().default(null),
  reason_code: code,
}).strict();

export const addReturnItemSchema = z.object({
  batch_id: uuidV7,
  quantity: z.number().int().min(1).max(1_000_000),
}).strict();

export const advanceReturnSchema = z.object({
  status: z.enum(['approved', 'rejected', 'received', 'completed', 'cancelled']),
  expected_version: expectedVersion,
}).strict();

export const recordCountSchema = z.object({
  batch_id: uuidV7,
  // Zero is a legitimate count: an empty shelf is a finding, not a missing value.
  counted_quantity: z.number().int().min(0).max(10_000_000),
}).strict();

export const advanceReconciliationSchema = z.object({
  status: z.enum(['submitted', 'approved', 'rejected', 'posted']),
  expected_version: expectedVersion,
}).strict();

export type ReceiveGoodsRequest = z.infer<typeof receiveGoodsSchema>;
export type AdvancePurchaseOrderRequest = z.infer<typeof advancePurchaseOrderSchema>;
export type AdvanceReturnRequest = z.infer<typeof advanceReturnSchema>;

export const openControlledRegisterSchema = z.object({
  variant_id: uuidV7,
}).strict();

/**
 * A witnessed controlled-drug movement.
 *
 * `witness_profile_id` is REQUIRED. Migration 0024 documented the witness as mandatory while
 * its CHECK permitted NULL, so dual control could be skipped by omitting a field; 0031 corrects
 * the constraint and this mirrors it at the edge. The witness must be a different person, which
 * the database also enforces.
 */
export const recordControlledMovementSchema = z.object({
  batch_id: uuidV7,
  // Signed: a controlled drug moves in or out, and zero is not a movement.
  quantity_delta: z.number().int().refine((value) => value !== 0).and(
    z.number().int().min(-1_000_000).max(1_000_000),
  ),
  reason_code: code,
  witness_profile_id: uuidV7,
}).strict();

/**
 * Procurement list filters. Every vocabulary comes from the exported const arrays, so a
 * status added to the domain cannot be silently missing here.
 */
const listFilters = {
  site_id: z.string().uuid().optional(),
  /** Default true: a procurement page opens on work that is still outstanding. */
  open_only: z.enum(['true', 'false']).default('true'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};

export const listPurchaseOrdersSchema = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES as unknown as [string, ...string[]]).optional(),
  ...listFilters,
}).strict();

export const listReturnsSchema = z.object({
  status: z.enum(RETURN_STATUSES as unknown as [string, ...string[]]).optional(),
  ...listFilters,
}).strict();

export const listReconciliationsSchema = z.object({
  status: z.enum(RECONCILIATION_STATUSES as unknown as [string, ...string[]]).optional(),
  ...listFilters,
}).strict();
