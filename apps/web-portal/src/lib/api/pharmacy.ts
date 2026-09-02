/**
 * Pharmacy procurement surface: purchase orders, stock returns and reconciliations.
 *
 * SITE SCOPE IS THE SERVER'S DECISION. Each list is read for the site the caller's
 * membership covers; passing a `siteId` may only NARROW to a site already reachable, and
 * the backend answers 403 OBJECT_ACCESS_DENIED otherwise. The portal must not attempt to
 * decide which sites a user may see — that check lives where the membership does.
 *
 * QUANTITIES AND TOTALS ARE DERIVED SERVER-SIDE and must not be recomputed here. A second
 * calculation is a second answer, and the reason these tables hold no stored totals is so
 * there is only one.
 */

import type {
  AddPurchaseOrderItemRequest,
  AddReturnItemRequest,
  AdvancePurchaseOrderRequest,
  AdvanceReconciliationRequest,
  AdvanceReturnRequest,
  ControlledMovementRecorded,
  ControlledRegister,
  CountRecorded,
  CreateMedicationRequest,
  CreatePurchaseOrderRequest,
  CreateReturnRequest,
  GoodsReceiptCreated,
  InventoryAvailability,
  InventoryBatchList,
  Medication,
  MedicationList,
  PharmacyOrder,
  PharmacyOrderList,
  PharmacyOrderState,
  PharmacyValidationResult,
  PurchaseOrderCreated,
  PurchaseOrderItemCreated,
  PurchaseOrderList,
  PurchaseOrderState,
  ReceiveGoodsRequest,
  RecordCountRequest,
  ReconciliationCreated,
  ReconciliationState,
  ReturnCreated,
  ReturnItemCreated,
  ReturnState,
  StockMovementList,
  StockReconciliationList,
  StockReturnList,
  UpdateMedicationRequest,
} from '@/types/contracts';
import { apiRequest } from './client';

export type PurchaseOrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export type StockReturnStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'received'
  | 'completed'
  | 'cancelled';

export type StockReconciliationStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'posted'
  | 'rejected';

interface ListOptions<Status> {
  readonly status?: Status;
  readonly siteId?: string;
  /** Defaults to true server-side: a procurement page opens on outstanding work. */
  readonly openOnly?: boolean;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

function query<Status extends string>(options: ListOptions<Status>): string {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.siteId) params.set('site_id', options.siteId);
  if (options.openOnly !== undefined) params.set('open_only', String(options.openOnly));
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const encoded = params.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

export function listPurchaseOrders(
  options: ListOptions<PurchaseOrderStatus> = {},
): Promise<PurchaseOrderList> {
  return apiRequest<PurchaseOrderList>({
    method: 'GET',
    path: `/procurement/purchase-orders${query(options)}`,
    signal: options.signal,
  });
}

/**
 * Receives goods against an ordered purchase order, creating a batch + receipt + positive
 * ledger movement in one transaction. 201 because a batch and a receipt row are created.
 * Lot number and expiry are required so FEFO (first-expiry-first-out) can reserve stock.
 */
export function receiveGoods(
  purchaseOrderId: string,
  body: ReceiveGoodsRequest,
  idempotencyKey: string,
): Promise<GoodsReceiptCreated> {
  return apiRequest<GoodsReceiptCreated>({
    method: 'POST',
    path: `/procurement/purchase-orders/${purchaseOrderId}/receipts`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

export function listStockReturns(
  options: ListOptions<StockReturnStatus> = {},
): Promise<StockReturnList> {
  return apiRequest<StockReturnList>({
    method: 'GET',
    path: `/procurement/returns${query(options)}`,
    signal: options.signal,
  });
}

export function listStockReconciliations(
  options: ListOptions<StockReconciliationStatus> = {},
): Promise<StockReconciliationList> {
  return apiRequest<StockReconciliationList>({
    method: 'GET',
    path: `/procurement/reconciliations${query(options)}`,
    signal: options.signal,
  });
}

// ------------------------------------------------------------------ pharmacy orders

export type PharmacyOrderStatus =
  | 'received'
  | 'awaiting_validation'
  | 'validated'
  | 'stock_reserved'
  | 'fulfilling'
  | 'ready_for_dispatch'
  | 'dispatched'
  | 'delivered'
  | 'delivery_exception'
  | 'returned'
  | 'rejected'
  | 'cancelled';

export function validatePharmacyOrder(
  pharmacyOrderId: string,
  body: { state: 'valid' | 'invalid' | 'needs_clarification'; reason_code: string | null; expected_version: number },
  idempotencyKey: string,
): Promise<PharmacyValidationResult> {
  return apiRequest<PharmacyValidationResult>({
    method: 'POST', path: `/pharmacy-orders/${pharmacyOrderId}/validation`, body,
    csrf: true, idempotencyKey,
  });
}

export function transitionPharmacyOrder(
  pharmacyOrderId: string,
  body: { status: 'fulfilling' | 'ready_for_dispatch' | 'cancelled'; reason_code: string | null; expected_version: number },
): Promise<PharmacyOrderState> {
  return apiRequest<PharmacyOrderState>({ method: 'PUT', path: `/pharmacy-orders/${pharmacyOrderId}/status`, body, csrf: true });
}

export function dispatchPharmacyOrder(
  pharmacyOrderId: string, expectedVersion: number, idempotencyKey: string,
): Promise<PharmacyOrderState> {
  return apiRequest<PharmacyOrderState>({
    method: 'POST', path: `/pharmacy-orders/${pharmacyOrderId}/dispatch`, body: { expected_version: expectedVersion },
    csrf: true, idempotencyKey,
  });
}

export function openControlledRegister(variantId: string, idempotencyKey: string): Promise<ControlledRegister> {
  return apiRequest<ControlledRegister>({ method: 'POST', path: '/procurement/controlled-registers', body: { variant_id: variantId }, csrf: true, idempotencyKey });
}

export function recordControlledMovement(
  registerId: string,
  body: { batch_id: string; quantity_delta: number; reason_code: string; witness_profile_id: string },
  idempotencyKey: string,
): Promise<ControlledMovementRecorded> {
  return apiRequest<ControlledMovementRecorded>({ method: 'POST', path: `/procurement/controlled-registers/${registerId}/movements`, body, csrf: true, idempotencyKey });
}

export function listPharmacyOrders(
  options: { siteId?: string; status?: PharmacyOrderStatus; limit?: number; signal?: AbortSignal } = {},
): Promise<PharmacyOrderList> {
  const params = new URLSearchParams();
  if (options.siteId) params.set('site_id', options.siteId);
  if (options.status) params.set('status', options.status);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const encoded = params.toString();
  return apiRequest<PharmacyOrderList>({
    method: 'GET',
    path: `/pharmacy-orders${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

export function getPharmacyOrder(pharmacyOrderId: string, signal?: AbortSignal): Promise<PharmacyOrder> {
  return apiRequest<PharmacyOrder>({
    method: 'GET',
    path: `/pharmacy-orders/${encodeURIComponent(pharmacyOrderId)}`,
    signal,
  });
}

// ----------------------------------------------------------------------- inventory

/**
 * Site-scoped inventory reads.
 *
 * `siteId` is a PATH parameter here, not a filter, so a caller must know which site it is
 * asking about. The portal resolves it from `Membership.site_ids` in the session bootstrap
 * rather than storing it separately: the membership is the authority on which sites a user
 * reaches, and a copy kept elsewhere is a copy that can go stale after a role change.
 */
export function listInventoryBatches(
  siteId: string,
  options: { variantId?: string; signal?: AbortSignal } = {},
): Promise<InventoryBatchList> {
  const params = new URLSearchParams();
  if (options.variantId) params.set('variant_id', options.variantId);
  const encoded = params.toString();
  return apiRequest<InventoryBatchList>({
    method: 'GET',
    path: `/sites/${siteId}/inventory/batches${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

export function listStockMovements(
  siteId: string,
  options: { batchId?: string; signal?: AbortSignal } = {},
): Promise<StockMovementList> {
  const params = new URLSearchParams();
  if (options.batchId) params.set('batch_id', options.batchId);
  const encoded = params.toString();
  return apiRequest<StockMovementList>({
    method: 'GET',
    path: `/sites/${siteId}/inventory/movements${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

export function listMedications(
  options: { includeRetired?: boolean; signal?: AbortSignal } = {},
): Promise<MedicationList> {
  const params = new URLSearchParams();
  if (options.includeRetired) params.set('include_retired', 'true');
  const encoded = params.toString();
  return apiRequest<MedicationList>({
    method: 'GET',
    path: `/medications${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

/**
 * Days until a batch expires, negative once past. Computed from the date STRING the API
 * sends, parsed as UTC midnight so a browser timezone cannot shift an expiry across a day
 * boundary and turn "expires today" into "expired yesterday".
 */
export function daysUntil(expiresOn: string): number | null {
  const parsed = Date.parse(`${expiresOn}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;
  return Math.round((parsed - Date.now()) / 86_400_000);
}

/** Integer sen to a display string. Two fixed decimals, no locale rounding surprises. */
export function formatSen(amountSen: number, currency = 'MYR'): string {
  const negative = amountSen < 0;
  const absolute = Math.abs(amountSen);
  const major = Math.trunc(absolute / 100).toLocaleString('en-MY');
  const minor = String(absolute % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${currency} ${major}.${minor}`;
}

export function humaniseCode(code: string): string {
  return code.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

export function shortId(value: string | null): string {
  return value ? value.slice(0, 8) : '—';
}

export function formatInstant(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

// -------------------------------------------------- procurement: purchase orders

/** Opens a draft purchase order for a supplier. Lines are added separately. */
export function createPurchaseOrder(
  body: CreatePurchaseOrderRequest,
  idempotencyKey: string,
): Promise<PurchaseOrderCreated> {
  return apiRequest<PurchaseOrderCreated>({
    method: 'POST',
    path: '/procurement/purchase-orders',
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Adds a single variant line to a draft purchase order. */
export function addPurchaseOrderItem(
  purchaseOrderId: string,
  body: AddPurchaseOrderItemRequest,
  idempotencyKey: string,
): Promise<PurchaseOrderItemCreated> {
  return apiRequest<PurchaseOrderItemCreated>({
    method: 'POST',
    path: `/procurement/purchase-orders/${purchaseOrderId}/items`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Submits, approves, orders or cancels a purchase order. `expected_version` for concurrency. */
export function advancePurchaseOrder(
  purchaseOrderId: string,
  body: AdvancePurchaseOrderRequest,
): Promise<PurchaseOrderState> {
  return apiRequest<PurchaseOrderState>({
    method: 'PUT',
    path: `/procurement/purchase-orders/${purchaseOrderId}/status`,
    body,
    csrf: true,
  });
}

// ----------------------------------------------- procurement: reconciliations

/** Opens a draft stock count for the acting site. */
export function createReconciliation(idempotencyKey: string): Promise<ReconciliationCreated> {
  return apiRequest<ReconciliationCreated>({
    method: 'POST',
    path: '/procurement/reconciliations',
    csrf: true,
    idempotencyKey,
  });
}

/** Records a physical count for one batch in a draft reconciliation. */
export function recordReconciliationCount(
  reconciliationId: string,
  body: RecordCountRequest,
  idempotencyKey: string,
): Promise<CountRecorded> {
  return apiRequest<CountRecorded>({
    method: 'PUT',
    path: `/procurement/reconciliations/${reconciliationId}/counts`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Submits, approves, rejects or posts a stock count. Approval needs a different person. */
export function advanceReconciliation(
  reconciliationId: string,
  body: AdvanceReconciliationRequest,
): Promise<ReconciliationState> {
  return apiRequest<ReconciliationState>({
    method: 'PUT',
    path: `/procurement/reconciliations/${reconciliationId}/status`,
    body,
    csrf: true,
  });
}

// ------------------------------------------------------- procurement: returns

/** Opens a stock return, optionally linked to a pharmacy order. */
export function createReturn(
  body: CreateReturnRequest,
  idempotencyKey: string,
): Promise<ReturnCreated> {
  return apiRequest<ReturnCreated>({
    method: 'POST',
    path: '/procurement/returns',
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Adds a batch line to an open stock return. */
export function addReturnItem(
  returnId: string,
  body: AddReturnItemRequest,
  idempotencyKey: string,
): Promise<ReturnItemCreated> {
  return apiRequest<ReturnItemCreated>({
    method: 'POST',
    path: `/procurement/returns/${returnId}/items`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Approves, rejects, receives, completes or cancels a stock return. */
export function advanceReturn(
  returnId: string,
  body: AdvanceReturnRequest,
): Promise<ReturnState> {
  return apiRequest<ReturnState>({
    method: 'PUT',
    path: `/procurement/returns/${returnId}/status`,
    body,
    csrf: true,
  });
}

// ----------------------------------------------------- medication catalogue

/** Creates a medication catalogue entry. May classify a controlled substance. */
export function createMedication(
  body: CreateMedicationRequest,
  idempotencyKey: string,
): Promise<Medication> {
  return apiRequest<Medication>({
    method: 'POST',
    path: '/medications',
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Reads one medication catalogue entry by id. */
export function readMedication(medicationId: string, signal?: AbortSignal): Promise<Medication> {
  return apiRequest<Medication>({
    method: 'GET',
    path: `/medications/${encodeURIComponent(medicationId)}`,
    signal,
  });
}

/** Replaces a medication catalogue entry. `expected_version` for optimistic concurrency. */
export function updateMedication(
  medicationId: string,
  body: UpdateMedicationRequest,
): Promise<Medication> {
  return apiRequest<Medication>({
    method: 'PUT',
    path: `/medications/${encodeURIComponent(medicationId)}`,
    body,
    csrf: true,
  });
}

// ----------------------------------------------------- inventory availability

/**
 * Per-batch derived availability for one variant at a site. `variant_id` is a required query
 * parameter — the endpoint answers for a single variant at a time.
 */
export function readInventoryAvailability(
  siteId: string,
  variantId: string,
  signal?: AbortSignal,
): Promise<InventoryAvailability> {
  return apiRequest<InventoryAvailability>({
    method: 'GET',
    path: `/sites/${siteId}/inventory/availability?variant_id=${encodeURIComponent(variantId)}`,
    signal,
  });
}
