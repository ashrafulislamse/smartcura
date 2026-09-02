import type { PoolClient } from 'pg';
import { PostgresConnection } from './connection.js';

/**
 * WP-10 procurement: purchase orders, goods receipts, returns and stock reconciliation.
 *
 * EVERY QUANTITY CHANGE POSTS TO THE APPEND-ONLY LEDGER. `inventory_batches` has no quantity
 * column at all — stock is a projection of posted movements minus active reservations — so a
 * receipt that updated a balance directly would have nowhere to write and, worse, would create
 * a second source of truth. Each command here therefore writes its domain row and its ledger
 * movement in ONE transaction, and the schema enforces the link: `goods_receipts.movement_id`
 * is NOT NULL, so a receipt cannot exist without the movement that made it real.
 */

/**
 * Vocabularies as const ARRAYS with the types derived from them, not as bare type unions.
 *
 * A type union exists only at compile time, so a request schema or a contract enum has to
 * RETYPE it — and retyping a vocabulary is how `waiting_requester` became
 * `waiting_on_requester` and how `assigned` went missing entirely earlier in this project.
 * Exporting the array lets `z.enum` and the filter schemas consume the single definition.
 */
export const PURCHASE_ORDER_STATUSES = [
  'draft', 'submitted', 'approved', 'ordered', 'partially_received', 'received', 'cancelled',
] as const;
export type PurchaseOrderStatus = typeof PURCHASE_ORDER_STATUSES[number];

export const RETURN_STATUSES = [
  'requested', 'approved', 'rejected', 'received', 'completed', 'cancelled',
] as const;
export type ReturnStatus = typeof RETURN_STATUSES[number];

export const RECONCILIATION_STATUSES = [
  'draft', 'submitted', 'approved', 'posted', 'rejected',
] as const;
export type ReconciliationStatus = typeof RECONCILIATION_STATUSES[number];

/**
 * `draft → submitted → approved → ordered → partially_received → received`, with cancellation
 * available until goods have arrived. Receiving states are DERIVED from what was actually
 * received, never requested, so a buyer cannot declare an order complete.
 */
const PO_SEQUENCE: readonly PurchaseOrderStatus[] = ['draft', 'submitted', 'approved', 'ordered'];

export function purchaseOrderTransitionAllowed(
  current: PurchaseOrderStatus, next: PurchaseOrderStatus,
): boolean {
  if (current === 'received' || current === 'cancelled') return false;
  // Cancelling is refused once anything has physically arrived: the stock is on the shelf and
  // the ledger already records it, so "cancelled" would contradict the inventory.
  if (next === 'cancelled') return current !== 'partially_received';
  if (next === 'partially_received' || next === 'received') return false;
  const from = PO_SEQUENCE.indexOf(current);
  const to = PO_SEQUENCE.indexOf(next);
  return from >= 0 && to === from + 1;
}

export function returnTransitionAllowed(current: ReturnStatus, next: ReturnStatus): boolean {
  if (current === 'completed' || current === 'rejected' || current === 'cancelled') return false;
  if (current === 'requested') return next === 'approved' || next === 'rejected' || next === 'cancelled';
  if (current === 'approved') return next === 'received' || next === 'cancelled';
  // Completion is what posts stock back, so it is only reachable once the goods are in hand.
  if (current === 'received') return next === 'completed';
  return false;
}

export function reconciliationTransitionAllowed(
  current: ReconciliationStatus, next: ReconciliationStatus,
): boolean {
  if (current === 'posted' || current === 'rejected') return false;
  if (current === 'draft') return next === 'submitted';
  if (current === 'submitted') return next === 'approved' || next === 'rejected';
  if (current === 'approved') return next === 'posted';
  return false;
}

export interface PurchaseOrderRecord {
  readonly purchaseOrderId: string;
  readonly organizationId: string;
  readonly siteId: string;
  readonly status: PurchaseOrderStatus;
  readonly version: number;
}

export class ProcurementRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * Purchase orders, open work first then newest.
   *
   * `orderedTotalSen` and `receivedQuantity` are DERIVED from the lines and the receipts,
   * never stored on the order: a stored total is a total that can disagree with the lines
   * it claims to summarise, and this schema deliberately has nowhere to keep one. The
   * received figure is what tells a buyer whether an order is genuinely outstanding, which
   * a status alone does not — `partially_received` says nothing about how much is missing.
   */
  async listPurchaseOrders(input: {
    readonly organizationId: string;
    readonly siteId: string | null;
    readonly status: PurchaseOrderStatus | null;
    readonly openOnly: boolean;
    readonly limit: number;
  }): Promise<readonly {
    readonly purchaseOrderId: string; readonly siteId: string; readonly supplierId: string;
    readonly status: PurchaseOrderStatus; readonly lineCount: number;
    readonly orderedQuantity: number; readonly receivedQuantity: number;
    readonly orderedTotalSen: string; readonly version: number;
    readonly createdAt: Date; readonly updatedAt: Date;
  }[]> {
    return (await this.database.query(
      `SELECT o.purchase_order_id AS "purchaseOrderId", o.site_id AS "siteId",
              o.supplier_id AS "supplierId", o.status,
              count(DISTINCT i.purchase_order_item_id)::int AS "lineCount",
              coalesce(sum(i.ordered_quantity), 0)::int AS "orderedQuantity",
              coalesce((SELECT sum(g.received_quantity)::int
                          FROM goods_receipts g
                         WHERE g.purchase_order_id = o.purchase_order_id), 0) AS "receivedQuantity",
              coalesce(sum(i.ordered_quantity * i.unit_cost_sen), 0)::text AS "orderedTotalSen",
              o.version, o.created_at AS "createdAt", o.updated_at AS "updatedAt"
         FROM purchase_orders o
         LEFT JOIN purchase_order_items i USING (purchase_order_id)
        WHERE o.organization_id = $1
          AND ($2::uuid IS NULL OR o.site_id = $2::uuid)
          AND ($3::text IS NULL OR o.status::text = $3::text)
          AND ($4 = false OR o.status NOT IN ('received','cancelled'))
        GROUP BY o.purchase_order_id
        ORDER BY (o.status NOT IN ('received','cancelled')) DESC,
                 o.created_at DESC, o.purchase_order_id DESC
        LIMIT $5`,
      [input.organizationId, input.siteId, input.status, input.openOnly, input.limit],
    )).rows as never;
  }

  /** Returns, open work first then newest. Quantities derived from the items. */
  async listReturns(input: {
    readonly organizationId: string;
    readonly siteId: string | null;
    readonly status: ReturnStatus | null;
    readonly openOnly: boolean;
    readonly limit: number;
  }): Promise<readonly {
    readonly returnId: string; readonly siteId: string;
    readonly pharmacyOrderId: string | null; readonly status: ReturnStatus;
    readonly reasonCode: string; readonly lineCount: number;
    readonly totalQuantity: number; readonly postedLineCount: number;
    readonly version: number; readonly createdAt: Date; readonly updatedAt: Date;
  }[]> {
    return (await this.database.query(
      `SELECT r.return_id AS "returnId", r.site_id AS "siteId",
              r.pharmacy_order_id AS "pharmacyOrderId", r.status,
              r.reason_code AS "reasonCode",
              count(i.return_item_id)::int AS "lineCount",
              coalesce(sum(i.quantity), 0)::int AS "totalQuantity",
              -- A line with a movement has already put stock back. Surfacing the count
              -- makes a partially posted return visible instead of looking complete.
              count(i.return_item_id) FILTER (WHERE i.movement_id IS NOT NULL)::int AS "postedLineCount",
              r.version, r.created_at AS "createdAt", r.updated_at AS "updatedAt"
         FROM returns r
         LEFT JOIN return_items i USING (return_id)
        WHERE r.organization_id = $1
          AND ($2::uuid IS NULL OR r.site_id = $2::uuid)
          AND ($3::text IS NULL OR r.status::text = $3::text)
          AND ($4 = false OR r.status NOT IN ('completed','rejected','cancelled'))
        GROUP BY r.return_id
        ORDER BY (r.status NOT IN ('completed','rejected','cancelled')) DESC,
                 r.created_at DESC, r.return_id DESC
        LIMIT $5`,
      [input.organizationId, input.siteId, input.status, input.openOnly, input.limit],
    )).rows as never;
  }

  /**
   * Stock reconciliations, open work first then newest.
   *
   * `varianceQuantity` is the signed sum of counted minus expected across the lines, and
   * it is the number a reconciliation exists to surface: a count that matches perfectly is
   * uninteresting, and a large variance is the shrinkage signal. `absVarianceQuantity` is
   * carried alongside because a +50/-50 pair nets to zero while still being two errors.
   */
  async listReconciliations(input: {
    readonly organizationId: string;
    readonly siteId: string | null;
    readonly status: ReconciliationStatus | null;
    readonly openOnly: boolean;
    readonly limit: number;
  }): Promise<readonly {
    readonly reconciliationId: string; readonly siteId: string;
    readonly status: ReconciliationStatus; readonly countedByProfileId: string;
    readonly approvedByProfileId: string | null; readonly lineCount: number;
    readonly varianceQuantity: number; readonly absVarianceQuantity: number;
    readonly version: number; readonly createdAt: Date; readonly updatedAt: Date;
  }[]> {
    return (await this.database.query(
      `SELECT c.reconciliation_id AS "reconciliationId", c.site_id AS "siteId", c.status,
              c.counted_by_profile_id AS "countedByProfileId",
              c.approved_by_profile_id AS "approvedByProfileId",
              count(l.reconciliation_line_id)::int AS "lineCount",
              coalesce(sum(l.counted_quantity - l.expected_quantity), 0)::int AS "varianceQuantity",
              coalesce(sum(abs(l.counted_quantity - l.expected_quantity)), 0)::int AS "absVarianceQuantity",
              c.version, c.created_at AS "createdAt", c.updated_at AS "updatedAt"
         FROM stock_reconciliations c
         LEFT JOIN reconciliation_lines l USING (reconciliation_id)
        WHERE c.organization_id = $1
          AND ($2::uuid IS NULL OR c.site_id = $2::uuid)
          AND ($3::text IS NULL OR c.status::text = $3::text)
          AND ($4 = false OR c.status NOT IN ('posted','rejected'))
        GROUP BY c.reconciliation_id
        ORDER BY (c.status NOT IN ('posted','rejected')) DESC,
                 c.created_at DESC, c.reconciliation_id DESC
        LIMIT $5`,
      [input.organizationId, input.siteId, input.status, input.openOnly, input.limit],
    )).rows as never;
  }
  async createPurchaseOrder(input: {
    readonly organizationId: string;
    readonly siteId: string;
    readonly supplierId: string;
  }): Promise<{ readonly ok: true; readonly purchaseOrderId: string }
    | { readonly ok: false; readonly reason: 'supplier_unknown' }> {
    // The supplier must belong to the same organization. Without the check an order could be
    // raised against another tenant's supplier record.
    const supplier = await this.database.query(
      `SELECT 1 FROM suppliers
        WHERE supplier_id = $1 AND organization_id = $2 AND active`,
      [input.supplierId, input.organizationId],
    );
    if ((supplier.rowCount ?? 0) === 0) return { ok: false, reason: 'supplier_unknown' };
    const created = await this.database.query<{ purchaseOrderId: string }>(
      `INSERT INTO purchase_orders (organization_id, site_id, supplier_id)
       VALUES ($1,$2,$3)
       RETURNING purchase_order_id AS "purchaseOrderId"`,
      [input.organizationId, input.siteId, input.supplierId],
    );
    return { ok: true, purchaseOrderId: created.rows[0]!.purchaseOrderId };
  }

  async findPurchaseOrder(purchaseOrderId: string): Promise<PurchaseOrderRecord | null> {
    const found = await this.database.query<PurchaseOrderRecord>(
      `SELECT purchase_order_id AS "purchaseOrderId", organization_id AS "organizationId",
              site_id AS "siteId", status, version
         FROM purchase_orders WHERE purchase_order_id = $1`,
      [purchaseOrderId],
    );
    return found.rows[0] ?? null;
  }

  /** Lines are editable only while the order is a draft; approval must fix the commitment. */
  async addPurchaseOrderItem(input: {
    readonly purchaseOrderId: string;
    readonly variantId: string;
    readonly orderedQuantity: number;
    readonly unitCostSen: number;
  }): Promise<{ readonly ok: true; readonly purchaseOrderItemId: string }
    | { readonly ok: false; readonly reason: 'not_draft' | 'variant_unknown' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{ status: PurchaseOrderStatus }>(
        'SELECT status FROM purchase_orders WHERE purchase_order_id = $1 FOR UPDATE',
        [input.purchaseOrderId],
      );
      if (locked.rows[0]?.status !== 'draft') {
        return { ok: false as const, reason: 'not_draft' as const };
      }
      const variant = await client.query(
        'SELECT 1 FROM medication_variants WHERE variant_id = $1', [input.variantId],
      );
      if ((variant.rowCount ?? 0) === 0) {
        return { ok: false as const, reason: 'variant_unknown' as const };
      }
      const created = await client.query<{ purchaseOrderItemId: string }>(
        `INSERT INTO purchase_order_items
           (purchase_order_id, variant_id, ordered_quantity, unit_cost_sen)
         VALUES ($1,$2,$3,$4)
         RETURNING purchase_order_item_id AS "purchaseOrderItemId"`,
        [input.purchaseOrderId, input.variantId, input.orderedQuantity, input.unitCostSen],
      );
      return { ok: true as const, purchaseOrderItemId: created.rows[0]!.purchaseOrderItemId };
    });
  }

  async advancePurchaseOrder(input: {
    readonly purchaseOrderId: string;
    readonly next: PurchaseOrderStatus;
    readonly expectedVersion: number;
  }): Promise<{ readonly ok: true; readonly status: PurchaseOrderStatus }
    | { readonly ok: false; readonly reason: 'conflict' | 'state' | 'no_items' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{ status: PurchaseOrderStatus; version: number }>(
        'SELECT status, version FROM purchase_orders WHERE purchase_order_id = $1 FOR UPDATE',
        [input.purchaseOrderId],
      );
      const current = locked.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'state' as const };
      if (current.version !== input.expectedVersion) {
        return { ok: false as const, reason: 'conflict' as const };
      }
      if (!purchaseOrderTransitionAllowed(current.status, input.next)) {
        return { ok: false as const, reason: 'state' as const };
      }
      if (input.next === 'submitted') {
        const items = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM purchase_order_items WHERE purchase_order_id = $1',
          [input.purchaseOrderId],
        );
        // Submitting an empty order would create an approvable commitment to buy nothing,
        // which later line additions could quietly fill.
        if (items.rows[0]?.count === '0') return { ok: false as const, reason: 'no_items' as const };
      }
      await client.query(
        `UPDATE purchase_orders SET status = $2::purchase_order_status,
                version = version + 1, updated_at = now()
          WHERE purchase_order_id = $1`,
        [input.purchaseOrderId, input.next],
      );
      return { ok: true as const, status: input.next };
    });
  }

  /**
   * Receives goods against an ordered purchase order.
   *
   * The batch, the receipt row and the POSITIVE ledger movement commit together, and the order
   * status is then derived from cumulative received quantity versus ordered quantity — never
   * asserted by the caller. Over-receipt is refused: accepting more than was ordered would put
   * unaccounted stock on the shelf under a document that does not cover it.
   */
  async receiveGoods(input: {
    readonly purchaseOrderId: string;
    readonly variantId: string;
    readonly lotNumber: string;
    readonly expiresOn: string;
    readonly receivedQuantity: number;
    readonly receivedByProfileId: string;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly goodsReceiptId: string; readonly batchId: string;
      readonly status: PurchaseOrderStatus }
    | { readonly ok: false;
      readonly reason: 'state' | 'not_ordered' | 'over_receipt' | 'line_unknown' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{
        status: PurchaseOrderStatus; organizationId: string; siteId: string;
      }>(
        `SELECT status, organization_id AS "organizationId", site_id AS "siteId"
           FROM purchase_orders WHERE purchase_order_id = $1 FOR UPDATE`,
        [input.purchaseOrderId],
      );
      const order = locked.rows[0];
      if (order === undefined) return { ok: false as const, reason: 'state' as const };
      if (order.status !== 'ordered' && order.status !== 'partially_received') {
        return { ok: false as const, reason: 'not_ordered' as const };
      }
      const line = await client.query<{ orderedQuantity: number }>(
        `SELECT ordered_quantity AS "orderedQuantity" FROM purchase_order_items
          WHERE purchase_order_id = $1 AND variant_id = $2`,
        [input.purchaseOrderId, input.variantId],
      );
      const ordered = line.rows[0]?.orderedQuantity;
      if (ordered === undefined) return { ok: false as const, reason: 'line_unknown' as const };
      const receivedSoFar = await client.query<{ total: string }>(
        `SELECT COALESCE(sum(receipt.received_quantity), 0)::text AS total
           FROM goods_receipts AS receipt
           JOIN inventory_batches AS batch ON batch.batch_id = receipt.batch_id
          WHERE receipt.purchase_order_id = $1 AND batch.variant_id = $2`,
        [input.purchaseOrderId, input.variantId],
      );
      const already = Number(receivedSoFar.rows[0]?.total ?? '0');
      if (already + input.receivedQuantity > ordered) {
        return { ok: false as const, reason: 'over_receipt' as const };
      }
      // One batch per (site, variant, lot) by unique index, so a second delivery of the same
      // lot adds to the existing batch rather than creating a duplicate the FEFO picker would
      // treat as separate stock.
      const batch = await client.query<{ batchId: string }>(
        `INSERT INTO inventory_batches
           (organization_id, site_id, variant_id, lot_number, expires_on)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (site_id, variant_id, lot_number) DO UPDATE SET lot_number = EXCLUDED.lot_number
         RETURNING batch_id AS "batchId"`,
        [order.organizationId, order.siteId, input.variantId, input.lotNumber, input.expiresOn],
      );
      const batchId = batch.rows[0]!.batchId;
      const movement = await client.query<{ movementId: string }>(
        `INSERT INTO stock_ledger
           (batch_id, organization_id, site_id, movement_type, quantity_delta,
            reference_type, reference_id, actor_profile_id, correlation_id)
         VALUES ($1,$2,$3,'receipt',$4,'purchase_order',$5,$6,$7)
         RETURNING movement_id AS "movementId"`,
        [batchId, order.organizationId, order.siteId, input.receivedQuantity,
          input.purchaseOrderId, input.receivedByProfileId, input.correlationId],
      );
      const created = await client.query<{ goodsReceiptId: string }>(
        `INSERT INTO goods_receipts
           (purchase_order_id, batch_id, received_quantity, received_by_profile_id, movement_id)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING goods_receipt_id AS "goodsReceiptId"`,
        [input.purchaseOrderId, batchId, input.receivedQuantity,
          input.receivedByProfileId, movement.rows[0]!.movementId],
      );
      // DERIVED, not asserted: fully received only when every line is satisfied.
      const outstanding = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM purchase_order_items AS item
          WHERE item.purchase_order_id = $1
            AND item.ordered_quantity > (
              SELECT COALESCE(sum(receipt.received_quantity), 0)
                FROM goods_receipts AS receipt
                JOIN inventory_batches AS batch ON batch.batch_id = receipt.batch_id
               WHERE receipt.purchase_order_id = $1 AND batch.variant_id = item.variant_id)`,
        [input.purchaseOrderId],
      );
      const status: PurchaseOrderStatus =
        outstanding.rows[0]?.count === '0' ? 'received' : 'partially_received';
      await client.query(
        `UPDATE purchase_orders SET status = $2::purchase_order_status,
                version = version + 1, updated_at = now()
          WHERE purchase_order_id = $1`,
        [input.purchaseOrderId, status],
      );
      return {
        ok: true as const,
        goodsReceiptId: created.rows[0]!.goodsReceiptId,
        batchId,
        status,
      };
    });
  }

  /**
   * Opens the controlled-drug register for a variant, or returns the existing one.
   *
   * The schedule is read from the MEDICATION, never from the request: a caller that could
   * declare a drug's schedule could downgrade a schedule-2 substance to escape the register.
   * A non-controlled drug has no register, which the schedule CHECK enforces independently.
   */
  async openControlledRegister(input: {
    readonly organizationId: string;
    readonly siteId: string;
    readonly variantId: string;
  }): Promise<{ readonly ok: true; readonly registerId: string; readonly schedule: string }
    | { readonly ok: false; readonly reason: 'variant_unknown' | 'not_controlled' }> {
    const variant = await this.database.query<{ schedule: string }>(
      `SELECT medication.controlled_schedule::text AS schedule
         FROM medication_variants AS variant
         JOIN medications AS medication ON medication.medication_id = variant.medication_id
        WHERE variant.variant_id = $1`,
      [input.variantId],
    );
    const schedule = variant.rows[0]?.schedule;
    if (schedule === undefined) return { ok: false, reason: 'variant_unknown' };
    if (schedule === 'none') return { ok: false, reason: 'not_controlled' };
    const opened = await this.database.query<{ registerId: string }>(
      `INSERT INTO controlled_substance_register
         (organization_id, site_id, variant_id, schedule)
       VALUES ($1,$2,$3,$4::controlled_substance_schedule)
       ON CONFLICT (site_id, variant_id) DO UPDATE SET site_id = EXCLUDED.site_id
       RETURNING register_id AS "registerId"`,
      [input.organizationId, input.siteId, input.variantId, schedule],
    );
    return { ok: true, registerId: opened.rows[0]!.registerId, schedule };
  }

  async findControlledRegister(registerId: string): Promise<{
    readonly registerId: string; readonly siteId: string; readonly variantId: string;
  } | null> {
    const found = await this.database.query<{
      registerId: string; siteId: string; variantId: string;
    }>(
      `SELECT register_id AS "registerId", site_id AS "siteId", variant_id AS "variantId"
         FROM controlled_substance_register WHERE register_id = $1`,
      [registerId],
    );
    return found.rows[0] ?? null;
  }

  /**
   * Records a witnessed controlled-drug movement, and the matching stock ledger movement, in
   * ONE transaction.
   *
   * The register is not a parallel bookkeeping system: if the register said a controlled drug
   * left the shelf but the stock ledger did not, the two would disagree about a substance whose
   * whole point is that it never goes unaccounted. So the register event carries the
   * `movement_id` of the stock movement it corresponds to.
   *
   * The register events table is append-only by trigger, and the witness must be a different
   * person from the actor — enforced by CHECK as well as here, because dual control that one
   * person can satisfy alone is not dual control.
   */
  async recordControlledMovement(input: {
    readonly registerId: string;
    readonly batchId: string;
    readonly quantityDelta: number;
    readonly reasonCode: string;
    readonly actorProfileId: string;
    readonly witnessProfileId: string;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly csEventId: string; readonly movementId: string;
      readonly projected: number }
    | { readonly ok: false;
      readonly reason: 'register_unknown' | 'batch_mismatch' | 'self_witness' | 'would_go_negative' }> {
    if (input.actorProfileId === input.witnessProfileId) {
      return { ok: false, reason: 'self_witness' };
    }
    return this.database.transaction(async (client) => {
      const register = await client.query<{
        organizationId: string; siteId: string; variantId: string;
      }>(
        `SELECT organization_id AS "organizationId", site_id AS "siteId",
                variant_id AS "variantId"
           FROM controlled_substance_register WHERE register_id = $1 FOR UPDATE`,
        [input.registerId],
      );
      const current = register.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'register_unknown' as const };
      // The batch must be the same site AND the same variant as the register. A register for
      // one drug must never account for another drug's stock.
      const batch = await client.query(
        `SELECT 1 FROM inventory_batches
          WHERE batch_id = $1 AND site_id = $2 AND variant_id = $3`,
        [input.batchId, current.siteId, current.variantId],
      );
      if ((batch.rowCount ?? 0) === 0) {
        return { ok: false as const, reason: 'batch_mismatch' as const };
      }
      // A controlled drug must never project negative: that would mean the register accounts
      // for stock that is not there, which is the exact condition it exists to surface.
      const projected = await client.query<{ total: string }>(
        `SELECT COALESCE(sum(quantity_delta), 0)::text AS total
           FROM stock_ledger WHERE batch_id = $1`,
        [input.batchId],
      );
      const after = Number(projected.rows[0]?.total ?? '0') + input.quantityDelta;
      if (after < 0) return { ok: false as const, reason: 'would_go_negative' as const };
      const movementType = input.quantityDelta > 0 ? 'adjustment_positive' : 'adjustment_negative';
      const movement = await client.query<{ movementId: string }>(
        `INSERT INTO stock_ledger
           (batch_id, organization_id, site_id, movement_type, quantity_delta,
            reference_type, reference_id, reason_code, actor_profile_id, correlation_id)
         VALUES ($1,$2,$3,$4::stock_movement_type,$5,'controlled_substance',$6,$7,$8,$9)
         RETURNING movement_id AS "movementId"`,
        [input.batchId, current.organizationId, current.siteId, movementType,
          input.quantityDelta, input.registerId, input.reasonCode,
          input.actorProfileId, input.correlationId],
      );
      const movementId = movement.rows[0]!.movementId;
      const created = await client.query<{ csEventId: string }>(
        `INSERT INTO controlled_substance_events
           (register_id, batch_id, movement_id, quantity_delta, reason_code,
            actor_profile_id, witness_profile_id, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING cs_event_id AS "csEventId"`,
        [input.registerId, input.batchId, movementId, input.quantityDelta,
          input.reasonCode, input.actorProfileId, input.witnessProfileId, input.correlationId],
      );
      return {
        ok: true as const,
        csEventId: created.rows[0]!.csEventId,
        movementId,
        projected: after,
      };
    });
  }

  async createReturn(input: {
    readonly organizationId: string;
    readonly siteId: string;
    readonly pharmacyOrderId: string | null;
    readonly reasonCode: string;
  }): Promise<{ readonly returnId: string }> {
    const created = await this.database.query<{ returnId: string }>(
      `INSERT INTO returns (organization_id, site_id, pharmacy_order_id, reason_code)
       VALUES ($1,$2,$3,$4)
       RETURNING return_id AS "returnId"`,
      [input.organizationId, input.siteId, input.pharmacyOrderId, input.reasonCode],
    );
    return { returnId: created.rows[0]!.returnId };
  }

  async addReturnItem(input: {
    readonly returnId: string;
    readonly batchId: string;
    readonly quantity: number;
  }): Promise<{ readonly ok: true; readonly returnItemId: string }
    | { readonly ok: false; readonly reason: 'not_open' | 'batch_wrong_site' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{ status: ReturnStatus; siteId: string }>(
        `SELECT status, site_id AS "siteId" FROM returns WHERE return_id = $1 FOR UPDATE`,
        [input.returnId],
      );
      const current = locked.rows[0];
      if (current === undefined || current.status !== 'requested') {
        return { ok: false as const, reason: 'not_open' as const };
      }
      // The batch must belong to the same site as the return. Otherwise a return could post
      // stock into a branch that never held it.
      const batch = await client.query(
        'SELECT 1 FROM inventory_batches WHERE batch_id = $1 AND site_id = $2',
        [input.batchId, current.siteId],
      );
      if ((batch.rowCount ?? 0) === 0) {
        return { ok: false as const, reason: 'batch_wrong_site' as const };
      }
      const created = await client.query<{ returnItemId: string }>(
        `INSERT INTO return_items (return_id, batch_id, quantity)
         VALUES ($1,$2,$3) RETURNING return_item_id AS "returnItemId"`,
        [input.returnId, input.batchId, input.quantity],
      );
      return { ok: true as const, returnItemId: created.rows[0]!.returnItemId };
    });
  }

  async findReturn(returnId: string): Promise<{
    readonly returnId: string; readonly organizationId: string; readonly siteId: string;
    readonly status: ReturnStatus; readonly version: number;
  } | null> {
    const found = await this.database.query<{
      returnId: string; organizationId: string; siteId: string;
      status: ReturnStatus; version: number;
    }>(
      `SELECT return_id AS "returnId", organization_id AS "organizationId",
              site_id AS "siteId", status, version
         FROM returns WHERE return_id = $1`,
      [returnId],
    );
    return found.rows[0] ?? null;
  }

  /**
   * Advances a return. Reaching `completed` posts the stock back to the ledger, once per item,
   * in the same transaction as the state change — so returned stock is on the shelf if and only
   * if the return says it is.
   */
  async advanceReturn(input: {
    readonly returnId: string;
    readonly next: ReturnStatus;
    readonly actorProfileId: string;
    readonly expectedVersion: number;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly status: ReturnStatus; readonly posted: number }
    | { readonly ok: false; readonly reason: 'conflict' | 'state' | 'no_items' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{
        status: ReturnStatus; version: number; organizationId: string; siteId: string;
      }>(
        `SELECT status, version, organization_id AS "organizationId", site_id AS "siteId"
           FROM returns WHERE return_id = $1 FOR UPDATE`,
        [input.returnId],
      );
      const current = locked.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'state' as const };
      if (current.version !== input.expectedVersion) {
        return { ok: false as const, reason: 'conflict' as const };
      }
      if (!returnTransitionAllowed(current.status, input.next)) {
        return { ok: false as const, reason: 'state' as const };
      }
      let posted = 0;
      if (input.next === 'approved') {
        const items = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM return_items WHERE return_id = $1',
          [input.returnId],
        );
        if (items.rows[0]?.count === '0') return { ok: false as const, reason: 'no_items' as const };
      }
      if (input.next === 'completed') {
        // `movement_id IS NULL` is the guard: an item already posted is skipped, so a retried
        // completion cannot double-credit stock.
        const unposted = await client.query<{ returnItemId: string; batchId: string; quantity: number }>(
          `SELECT return_item_id AS "returnItemId", batch_id AS "batchId", quantity
             FROM return_items WHERE return_id = $1 AND movement_id IS NULL
             FOR UPDATE`,
          [input.returnId],
        );
        for (const item of unposted.rows) {
          const movement = await client.query<{ movementId: string }>(
            `INSERT INTO stock_ledger
               (batch_id, organization_id, site_id, movement_type, quantity_delta,
                reference_type, reference_id, actor_profile_id, correlation_id)
             VALUES ($1,$2,$3,'return',$4,'return',$5,$6,$7)
             RETURNING movement_id AS "movementId"`,
            [item.batchId, current.organizationId, current.siteId, item.quantity,
              input.returnId, input.actorProfileId, input.correlationId],
          );
          await client.query(
            'UPDATE return_items SET movement_id = $2 WHERE return_item_id = $1',
            [item.returnItemId, movement.rows[0]!.movementId],
          );
          posted += 1;
        }
      }
      await client.query(
        `UPDATE returns SET status = $2::return_status, version = version + 1, updated_at = now()
          WHERE return_id = $1`,
        [input.returnId, input.next],
      );
      return { ok: true as const, status: input.next, posted };
    });
  }

  /**
   * Opens a reconciliation and records the EXPECTED quantity per batch as the ledger currently
   * projects it. Capturing expectation at count time is the point: comparing a physical count
   * against a balance that moved afterwards would attribute later dispatches to counting error.
   */
  async createReconciliation(input: {
    readonly organizationId: string;
    readonly siteId: string;
    readonly countedByProfileId: string;
  }): Promise<{ readonly reconciliationId: string; readonly lines: number }> {
    return this.database.transaction(async (client) => {
      const created = await client.query<{ reconciliationId: string }>(
        `INSERT INTO stock_reconciliations (organization_id, site_id, counted_by_profile_id)
         VALUES ($1,$2,$3) RETURNING reconciliation_id AS "reconciliationId"`,
        [input.organizationId, input.siteId, input.countedByProfileId],
      );
      const reconciliationId = created.rows[0]!.reconciliationId;
      const lines = await client.query(
        `INSERT INTO reconciliation_lines
           (reconciliation_id, batch_id, expected_quantity, counted_quantity)
         SELECT $1, batch.batch_id,
                COALESCE(sum(ledger.quantity_delta), 0)::integer,
                COALESCE(sum(ledger.quantity_delta), 0)::integer
           FROM inventory_batches AS batch
           LEFT JOIN stock_ledger AS ledger ON ledger.batch_id = batch.batch_id
          WHERE batch.site_id = $2
          GROUP BY batch.batch_id`,
        [reconciliationId, input.siteId],
      );
      return { reconciliationId, lines: lines.rowCount ?? 0 };
    });
  }

  async recordCount(input: {
    readonly reconciliationId: string;
    readonly batchId: string;
    readonly countedQuantity: number;
  }): Promise<boolean> {
    const updated = await this.database.query(
      `UPDATE reconciliation_lines AS line
          SET counted_quantity = $3
        WHERE line.reconciliation_id = $1 AND line.batch_id = $2
          AND EXISTS (SELECT 1 FROM stock_reconciliations AS r
                       WHERE r.reconciliation_id = $1 AND r.status = 'draft')`,
      [input.reconciliationId, input.batchId, input.countedQuantity],
    );
    return (updated.rowCount ?? 0) > 0;
  }

  async findReconciliation(reconciliationId: string): Promise<{
    readonly reconciliationId: string; readonly organizationId: string;
    readonly siteId: string; readonly status: ReconciliationStatus;
    readonly countedByProfileId: string; readonly version: number;
  } | null> {
    const found = await this.database.query<{
      reconciliationId: string; organizationId: string; siteId: string;
      status: ReconciliationStatus; countedByProfileId: string; version: number;
    }>(
      `SELECT reconciliation_id AS "reconciliationId", organization_id AS "organizationId",
              site_id AS "siteId", status,
              counted_by_profile_id AS "countedByProfileId", version
         FROM stock_reconciliations WHERE reconciliation_id = $1`,
      [reconciliationId],
    );
    return found.rows[0] ?? null;
  }

  /**
   * Advances a reconciliation. `posted` writes one adjustment movement per discrepant line.
   *
   * Approval requires a DIFFERENT person from the counter, enforced by a database CHECK as well
   * as here: a stock count that its own counter can approve is not a control, and an adjustment
   * is precisely how shrinkage would be concealed.
   */
  async advanceReconciliation(input: {
    readonly reconciliationId: string;
    readonly next: ReconciliationStatus;
    readonly actorProfileId: string;
    readonly expectedVersion: number;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly status: ReconciliationStatus;
      readonly adjustments: number }
    | { readonly ok: false; readonly reason: 'conflict' | 'state' | 'self_approval' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{
        status: ReconciliationStatus; version: number; countedByProfileId: string;
        organizationId: string; siteId: string;
      }>(
        `SELECT status, version, counted_by_profile_id AS "countedByProfileId",
                organization_id AS "organizationId", site_id AS "siteId"
           FROM stock_reconciliations WHERE reconciliation_id = $1 FOR UPDATE`,
        [input.reconciliationId],
      );
      const current = locked.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'state' as const };
      if (current.version !== input.expectedVersion) {
        return { ok: false as const, reason: 'conflict' as const };
      }
      if (!reconciliationTransitionAllowed(current.status, input.next)) {
        return { ok: false as const, reason: 'state' as const };
      }
      const approving = input.next === 'approved';
      if (approving && current.countedByProfileId === input.actorProfileId) {
        return { ok: false as const, reason: 'self_approval' as const };
      }
      let adjustments = 0;
      if (input.next === 'posted') {
        const discrepant = await client.query<{
          reconciliationLineId: string; batchId: string; delta: number;
        }>(
          `SELECT reconciliation_line_id AS "reconciliationLineId", batch_id AS "batchId",
                  (counted_quantity - expected_quantity) AS delta
             FROM reconciliation_lines
            WHERE reconciliation_id = $1 AND movement_id IS NULL
              AND counted_quantity <> expected_quantity
            FOR UPDATE`,
          [input.reconciliationId],
        );
        for (const line of discrepant.rows) {
          // The movement type must agree with the sign, which the ledger's own check enforces.
          const movementType = line.delta > 0 ? 'adjustment_positive' : 'adjustment_negative';
          const movement = await client.query<{ movementId: string }>(
            `INSERT INTO stock_ledger
               (batch_id, organization_id, site_id, movement_type, quantity_delta,
                reference_type, reference_id, reason_code, actor_profile_id, correlation_id)
             VALUES ($1,$2,$3,$4::stock_movement_type,$5,'stock_reconciliation',$6,
                     'reconciliation_adjustment',$7,$8)
             RETURNING movement_id AS "movementId"`,
            [line.batchId, current.organizationId, current.siteId, movementType, line.delta,
              input.reconciliationId, input.actorProfileId, input.correlationId],
          );
          await client.query(
            'UPDATE reconciliation_lines SET movement_id = $2 WHERE reconciliation_line_id = $1',
            [line.reconciliationLineId, movement.rows[0]!.movementId],
          );
          adjustments += 1;
        }
      }
      await client.query(
        `UPDATE stock_reconciliations
            SET status = $2::reconciliation_status,
                approved_by_profile_id = CASE WHEN $3 THEN $4 ELSE approved_by_profile_id END,
                version = version + 1, updated_at = now()
          WHERE reconciliation_id = $1`,
        [input.reconciliationId, input.next, approving, input.actorProfileId],
      );
      return { ok: true as const, status: input.next, adjustments };
    });
  }
}
