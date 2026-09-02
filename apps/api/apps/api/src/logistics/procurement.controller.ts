import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import {
  ProcurementRepository,
  type PurchaseOrderStatus,
  type ReconciliationStatus,
  type ReturnStatus,
} from '@smartcura/database/procurement';
import type { ZodType } from 'zod';
import {
  AuthenticatedOnly,
  CurrentSession,
  RequireCsrf, type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  addPurchaseOrderItemSchema,
  openControlledRegisterSchema,
  recordControlledMovementSchema,
  addReturnItemSchema,
  advancePurchaseOrderSchema,
  advanceReconciliationSchema,
  advanceReturnSchema,
  createPurchaseOrderSchema,
  listPurchaseOrdersSchema,
  listReconciliationsSchema,
  listReturnsSchema,
  createReturnSchema,
  receiveGoodsSchema,
  recordCountSchema,
} from './procurement-request.schemas.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ProcurementService {
  constructor(private readonly procurement: ProcurementRepository) {}

  async createPurchaseOrder(current: AuthenticatedSession, value: unknown) {
    const request = parse(createPurchaseOrderSchema, value);
    const active = this.pharmacy(current, 'procurement:manage:site');
    const result = await this.procurement.createPurchaseOrder({
      organizationId: active.organizationId,
      siteId: active.siteId,
      supplierId: request.supplier_id,
    });
    if (!result.ok) throw problem(404, 'RESOURCE_NOT_FOUND', 'Supplier was not found');
    return { purchase_order_id: result.purchaseOrderId, status: 'draft' };
  }

  async addPurchaseOrderItem(current: AuthenticatedSession, orderIdValue: string, value: unknown) {
    const orderId = id(orderIdValue);
    const request = parse(addPurchaseOrderItemSchema, value);
    await this.ownedPurchaseOrder(current, orderId);
    const result = await this.procurement.addPurchaseOrderItem({
      purchaseOrderId: orderId,
      variantId: request.variant_id,
      orderedQuantity: request.ordered_quantity,
      unitCostSen: request.unit_cost_sen,
    });
    if (!result.ok) {
      if (result.reason === 'variant_unknown') {
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Variant was not found');
      }
      throw problem(409, 'PURCHASE_ORDER_NOT_DRAFT', 'Lines are editable only while draft');
    }
    return { purchase_order_item_id: result.purchaseOrderItemId };
  }

  async advancePurchaseOrder(current: AuthenticatedSession, orderIdValue: string, value: unknown) {
    const orderId = id(orderIdValue);
    const request = parse(advancePurchaseOrderSchema, value);
    await this.ownedPurchaseOrder(current, orderId);
    const result = await this.procurement.advancePurchaseOrder({
      purchaseOrderId: orderId,
      next: request.status,
      expectedVersion: request.expected_version,
    });
    if (!result.ok) {
      if (result.reason === 'conflict') {
        throw problem(409, 'PROCUREMENT_VERSION_CONFLICT', 'The record changed');
      }
      if (result.reason === 'no_items') {
        throw problem(409, 'PURCHASE_ORDER_EMPTY', 'An empty order cannot be submitted');
      }
      throw problem(409, 'PROCUREMENT_TRANSITION_INVALID', 'The transition is not allowed');
    }
    return { purchase_order_id: orderId, status: result.status };
  }

  async receiveGoods(current: AuthenticatedSession, orderIdValue: string, value: unknown) {
    const orderId = id(orderIdValue);
    const request = parse(receiveGoodsSchema, value);
    const active = await this.ownedPurchaseOrder(current, orderId);
    const result = await this.procurement.receiveGoods({
      purchaseOrderId: orderId,
      variantId: request.variant_id,
      lotNumber: request.lot_number,
      expiresOn: request.expires_on,
      receivedByProfileId: current.aggregate.profile.profileId,
      receivedQuantity: request.received_quantity,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      if (result.reason === 'over_receipt') {
        throw problem(409, 'GOODS_OVER_RECEIPT', 'More than the ordered quantity was received');
      }
      if (result.reason === 'line_unknown') {
        throw problem(404, 'RESOURCE_NOT_FOUND', 'The order has no line for that variant');
      }
      if (result.reason === 'not_ordered') {
        throw problem(409, 'PURCHASE_ORDER_NOT_ORDERED', 'The order is not awaiting delivery');
      }
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Order was not found');
    }
    void active;
    return {
      goods_receipt_id: result.goodsReceiptId,
      batch_id: result.batchId,
      // Derived from cumulative receipts against ordered quantity, never asserted.
      status: result.status,
    };
  }

  async createReturn(current: AuthenticatedSession, value: unknown) {
    const request = parse(createReturnSchema, value);
    const active = this.pharmacy(current, 'return:manage:site');
    const created = await this.procurement.createReturn({
      organizationId: active.organizationId,
      siteId: active.siteId,
      pharmacyOrderId: request.pharmacy_order_id,
      reasonCode: request.reason_code,
    });
    return { return_id: created.returnId, status: 'requested' };
  }

  async addReturnItem(current: AuthenticatedSession, returnIdValue: string, value: unknown) {
    const returnId = id(returnIdValue);
    const request = parse(addReturnItemSchema, value);
    await this.ownedReturn(current, returnId);
    const result = await this.procurement.addReturnItem({
      returnId, batchId: request.batch_id, quantity: request.quantity,
    });
    if (!result.ok) {
      if (result.reason === 'batch_wrong_site') {
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Batch was not found at this site');
      }
      throw problem(409, 'RETURN_NOT_OPEN', 'Items may be added only while requested');
    }
    return { return_item_id: result.returnItemId };
  }

  async advanceReturn(current: AuthenticatedSession, returnIdValue: string, value: unknown) {
    const returnId = id(returnIdValue);
    const request = parse(advanceReturnSchema, value);
    await this.ownedReturn(current, returnId);
    const result = await this.procurement.advanceReturn({
      returnId,
      next: request.status,
      actorProfileId: current.aggregate.profile.profileId,
      expectedVersion: request.expected_version,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      if (result.reason === 'conflict') {
        throw problem(409, 'PROCUREMENT_VERSION_CONFLICT', 'The record changed');
      }
      if (result.reason === 'no_items') {
        throw problem(409, 'RETURN_EMPTY', 'An empty return cannot be approved');
      }
      throw problem(409, 'PROCUREMENT_TRANSITION_INVALID', 'The transition is not allowed');
    }
    // Non-zero only on completion, which is what posts stock back to the ledger.
    return { return_id: returnId, status: result.status, posted_movements: result.posted };
  }

  async createReconciliation(current: AuthenticatedSession) {
    const active = this.pharmacy(current, 'reconciliation:manage:site');
    const created = await this.procurement.createReconciliation({
      organizationId: active.organizationId,
      siteId: active.siteId,
      countedByProfileId: current.aggregate.profile.profileId,
    });
    return {
      reconciliation_id: created.reconciliationId,
      status: 'draft',
      // Expected quantities are captured NOW, so later movements are not blamed on counting.
      line_count: created.lines,
    };
  }

  async recordCount(current: AuthenticatedSession, reconciliationIdValue: string, value: unknown) {
    const reconciliationId = id(reconciliationIdValue);
    const request = parse(recordCountSchema, value);
    await this.ownedReconciliation(current, reconciliationId);
    const recorded = await this.procurement.recordCount({
      reconciliationId, batchId: request.batch_id, countedQuantity: request.counted_quantity,
    });
    if (!recorded) {
      throw problem(409, 'RECONCILIATION_NOT_DRAFT', 'Counts are editable only while draft');
    }
    return { reconciliation_id: reconciliationId, batch_id: request.batch_id };
  }

  async advanceReconciliation(
    current: AuthenticatedSession, reconciliationIdValue: string, value: unknown,
  ) {
    const reconciliationId = id(reconciliationIdValue);
    const request = parse(advanceReconciliationSchema, value);
    await this.ownedReconciliation(current, reconciliationId);
    // `policy-matrix.md` lists "reconciliation approval" as a pharmacy step-up action. I had
    // omitted this when the surface was first built, so a documented control was absent while
    // the surface looked complete. Approval is the moment a discrepancy becomes an adjustment,
    // which is exactly where re-authentication is worth requiring.
    if (request.status === 'approved') this.requireStepUp(current);
    const result = await this.procurement.advanceReconciliation({
      reconciliationId,
      next: request.status,
      actorProfileId: current.aggregate.profile.profileId,
      expectedVersion: request.expected_version,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      if (result.reason === 'conflict') {
        throw problem(409, 'PROCUREMENT_VERSION_CONFLICT', 'The record changed');
      }
      if (result.reason === 'self_approval') {
        throw problem(403, 'RECONCILIATION_SELF_APPROVAL',
          'A count cannot be approved by the person who made it');
      }
      throw problem(409, 'PROCUREMENT_TRANSITION_INVALID', 'The transition is not allowed');
    }
    return {
      reconciliation_id: reconciliationId,
      status: result.status,
      adjustments_posted: result.adjustments,
    };
  }

  /**
   * Opens a controlled-drug register. `policy-matrix.md` lists "controlled-substance action" as
   * a pharmacy step-up action, so recent re-authentication is required.
   */
  async openControlledRegister(current: AuthenticatedSession, value: unknown) {
    const request = parse(openControlledRegisterSchema, value);
    const active = this.pharmacy(current, 'controlled_substance:manage:site');
    this.requireStepUp(current);
    const result = await this.procurement.openControlledRegister({
      organizationId: active.organizationId,
      siteId: active.siteId,
      variantId: request.variant_id,
    });
    if (!result.ok) {
      if (result.reason === 'not_controlled') {
        throw problem(409, 'MEDICATION_NOT_CONTROLLED',
          'That medication has no controlled schedule');
      }
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Variant was not found');
    }
    return {
      register_id: result.registerId,
      // Read from the medication, never accepted from the request.
      schedule: result.schedule,
    };
  }

  async recordControlledMovement(
    current: AuthenticatedSession, registerIdValue: string, value: unknown,
  ) {
    const registerId = id(registerIdValue);
    const request = parse(recordControlledMovementSchema, value);
    const active = this.pharmacy(current, 'controlled_substance:manage:site');
    this.requireStepUp(current);
    const register = await this.procurement.findControlledRegister(registerId);
    if (register === null || register.siteId !== active.siteId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Register was not found');
    }
    const result = await this.procurement.recordControlledMovement({
      registerId,
      batchId: request.batch_id,
      quantityDelta: request.quantity_delta,
      reasonCode: request.reason_code,
      actorProfileId: current.aggregate.profile.profileId,
      witnessProfileId: request.witness_profile_id,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      if (result.reason === 'self_witness') {
        throw problem(403, 'CONTROLLED_SELF_WITNESS',
          'A controlled-substance movement cannot be witnessed by its own actor');
      }
      if (result.reason === 'would_go_negative') {
        throw problem(409, 'CONTROLLED_STOCK_NEGATIVE',
          'The movement would leave the register accounting for stock that is not there');
      }
      if (result.reason === 'batch_mismatch') {
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Batch was not found for this register');
      }
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Register was not found');
    }
    return {
      cs_event_id: result.csEventId,
      // The stock movement this register entry corresponds to, so the register and the ledger
      // can never disagree about a controlled drug.
      movement_id: result.movementId,
      projected_quantity: result.projected,
    };
  }

  /**
   * The three procurement lists. All scoped by `procurement:manage:site`, the same
   * permission the mutations use, and the organization plus default site come from the
   * MEMBERSHIP rather than the request â€” a caller cannot widen the read by supplying
   * another site, only narrow it to one they already reach.
   */
  async listPurchaseOrders(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listPurchaseOrdersSchema, queryValue);
    const active = this.pharmacy(current, 'procurement:manage:site');
    const rows = await this.procurement.listPurchaseOrders({
      organizationId: active.organizationId,
      siteId: this.listSite(active, query.site_id),
      status: (query.status ?? null) as PurchaseOrderStatus | null,
      openOnly: query.open_only !== 'false',
      limit: query.limit,
    });
    return {
      currency: 'MYR',
      data: rows.map((row) => ({
        purchase_order_id: row.purchaseOrderId,
        site_id: row.siteId,
        supplier_id: row.supplierId,
        status: row.status,
        line_count: row.lineCount,
        ordered_quantity: row.orderedQuantity,
        // Derived from the receipts. A status of `partially_received` says nothing about
        // how much is still outstanding; this does.
        received_quantity: row.receivedQuantity,
        outstanding_quantity: Math.max(row.orderedQuantity - row.receivedQuantity, 0),
        ordered_total_sen: Number(row.orderedTotalSen),
        version: row.version,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      })),
    };
  }

  async listReturns(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listReturnsSchema, queryValue);
    const active = this.pharmacy(current, 'procurement:manage:site');
    const rows = await this.procurement.listReturns({
      organizationId: active.organizationId,
      siteId: this.listSite(active, query.site_id),
      status: (query.status ?? null) as ReturnStatus | null,
      openOnly: query.open_only !== 'false',
      limit: query.limit,
    });
    return {
      data: rows.map((row) => ({
        return_id: row.returnId,
        site_id: row.siteId,
        pharmacy_order_id: row.pharmacyOrderId,
        status: row.status,
        reason_code: row.reasonCode,
        line_count: row.lineCount,
        total_quantity: row.totalQuantity,
        // A partially posted return would otherwise look complete from its status alone.
        posted_line_count: row.postedLineCount,
        version: row.version,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      })),
    };
  }

  async listReconciliations(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listReconciliationsSchema, queryValue);
    const active = this.pharmacy(current, 'procurement:manage:site');
    const rows = await this.procurement.listReconciliations({
      organizationId: active.organizationId,
      siteId: this.listSite(active, query.site_id),
      status: (query.status ?? null) as ReconciliationStatus | null,
      openOnly: query.open_only !== 'false',
      limit: query.limit,
    });
    return {
      data: rows.map((row) => ({
        reconciliation_id: row.reconciliationId,
        site_id: row.siteId,
        status: row.status,
        counted_by_profile_id: row.countedByProfileId,
        approved_by_profile_id: row.approvedByProfileId,
        line_count: row.lineCount,
        // The number a reconciliation exists to surface. Signed, because direction
        // matters: missing stock and surplus stock are different problems.
        variance_quantity: row.varianceQuantity,
        // Carried alongside because a +50/-50 pair nets to zero while still being two
        // counting errors, and a page showing only the net would call that clean.
        absolute_variance_quantity: row.absVarianceQuantity,
        version: row.version,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      })),
    };
  }
  /**
   * Resolves which site a list should read.
   *
   * A supplied `site_id` may only NARROW the read to a site the membership already covers.
   * Without this check the filter would accept any site in the organization, which is a
   * quiet scope widening: the row filter is organization-scoped, so a same-organization
   * site the pharmacist does not staff would have been readable.
   */
  private listSite(
    active: { readonly siteId: string; readonly siteIds: readonly string[] },
    requested: string | undefined,
  ): string {
    if (requested === undefined) return active.siteId;
    if (!active.siteIds.includes(requested)) {
      throw problem(403, 'OBJECT_ACCESS_DENIED', 'That site is not assigned to this membership');
    }
    return requested;
  }

  private async ownedPurchaseOrder(current: AuthenticatedSession, purchaseOrderId: string) {
    const active = this.pharmacy(current, 'procurement:manage:site');
    const order = await this.procurement.findPurchaseOrder(purchaseOrderId);
    // Concealed rather than refused: confirming another site's order exists is a leak.
    if (order === null || order.siteId !== active.siteId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Order was not found');
    }
    return active;
  }

  private async ownedReturn(current: AuthenticatedSession, returnId: string) {
    const active = this.pharmacy(current, 'return:manage:site');
    const record = await this.procurement.findReturn(returnId);
    if (record === null || record.siteId !== active.siteId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Return was not found');
    }
    return active;
  }

  private async ownedReconciliation(current: AuthenticatedSession, reconciliationId: string) {
    const active = this.pharmacy(current, 'reconciliation:manage:site');
    const record = await this.procurement.findReconciliation(reconciliationId);
    if (record === null || record.siteId !== active.siteId) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Reconciliation was not found');
    }
    return active;
  }

  /**
   * Recent re-authentication, per the step-up matrix in `policy-matrix.md`.
   */
  private requireStepUp(current: AuthenticatedSession) {
    const validUntil = current.aggregate.session.stepUpValidUntil ?? null;
    if (validUntil === null || validUntil.getTime() <= Date.now()) {
      throw problem(403, 'STEP_UP_REQUIRED', 'Recent step-up authentication is required');
    }
  }

  /**
   * Site authority. `PermissionGuard` cannot evaluate `site` scope, holding no object context,
   * so the pharmacy membership and its single site assignment are proved here â€” one branch must
   * not order, receive, return or recount another branch's stock.
   */
  private pharmacy(current: AuthenticatedSession, permission: string) {
    const active = current.aggregate.memberships.find(
      (entry) => entry.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined || active.status !== 'active') {
      throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    if (active.roleId !== 'pharmacy' || !active.permissions.includes(permission)) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const [siteId] = active.siteIds ?? [];
    if (siteId === undefined) {
      throw problem(403, 'OBJECT_ACCESS_DENIED', 'A pharmacy site assignment is required');
    }
    return {
      membershipId: active.membershipId,
      organizationId: active.organizationId,
      siteId,
      // The FULL list, because a membership may cover several sites and a caller narrowing
      // to one of them must be checked against all of them, not against the first.
      siteIds: active.siteIds ?? [],
    };
  }
}

/** WP-10 procurement routes. Site authority is proved in the service, not by the guard. */
@Controller('procurement')
@AuthenticatedOnly()
export class ProcurementController {
  constructor(private readonly procurement: ProcurementService) {}

  /** Purchase orders, open work first. Site scope enforced in the service. */
  @Get('purchase-orders')
  async purchaseOrders(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
  ) {
    return this.procurement.listPurchaseOrders(current, query);
  }

  /** Returns, open work first. */
  @Get('returns')
  async returns(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
  ) {
    return this.procurement.listReturns(current, query);
  }

  /** Stock reconciliations, open work first, carrying the variance they exist to show. */
  @Get('reconciliations')
  async reconciliations(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
  ) {
    return this.procurement.listReconciliations(current, query);
  }

  @Post('purchase-orders')
  @RequireCsrf('procurement.purchase_order_create')
  async createOrder(@CurrentSession() current: AuthenticatedSession, @Body() body: unknown) {
    return this.procurement.createPurchaseOrder(current, body);
  }

  @Post('purchase-orders/:purchaseOrderId/items')
  @RequireCsrf('procurement.purchase_order_item_add')
  async addItem(
    @CurrentSession() current: AuthenticatedSession,
    @Param('purchaseOrderId') purchaseOrderId: string,
    @Body() body: unknown,
  ) {
    return this.procurement.addPurchaseOrderItem(current, purchaseOrderId, body);
  }

  @Put('purchase-orders/:purchaseOrderId/status')
  @RequireCsrf('procurement.purchase_order_status')
  async advanceOrder(
    @CurrentSession() current: AuthenticatedSession,
    @Param('purchaseOrderId') purchaseOrderId: string,
    @Body() body: unknown,
  ) {
    return this.procurement.advancePurchaseOrder(current, purchaseOrderId, body);
  }

  @Post('purchase-orders/:purchaseOrderId/receipts')
  @RequireCsrf('procurement.goods_receipt_create')
  async receive(
    @CurrentSession() current: AuthenticatedSession,
    @Param('purchaseOrderId') purchaseOrderId: string,
    @Body() body: unknown,
  ) {
    return this.procurement.receiveGoods(current, purchaseOrderId, body);
  }

  @Post('returns')
  @RequireCsrf('procurement.return_create')
  async createReturn(@CurrentSession() current: AuthenticatedSession, @Body() body: unknown) {
    return this.procurement.createReturn(current, body);
  }

  @Post('returns/:returnId/items')
  @RequireCsrf('procurement.return_item_add')
  async addReturnItem(
    @CurrentSession() current: AuthenticatedSession,
    @Param('returnId') returnId: string,
    @Body() body: unknown,
  ) {
    return this.procurement.addReturnItem(current, returnId, body);
  }

  @Put('returns/:returnId/status')
  @RequireCsrf('procurement.return_status')
  async advanceReturn(
    @CurrentSession() current: AuthenticatedSession,
    @Param('returnId') returnId: string,
    @Body() body: unknown,
  ) {
    return this.procurement.advanceReturn(current, returnId, body);
  }

  @Post('controlled-registers')
  @RequireCsrf('procurement.controlled_register_create')
  async openControlledRegister(
    @CurrentSession() current: AuthenticatedSession,
    @Body() body: unknown,
  ) {
    return this.procurement.openControlledRegister(current, body);
  }

  @Post('controlled-registers/:registerId/movements')
  @RequireCsrf('procurement.controlled_movement_create')
  async recordControlledMovement(
    @CurrentSession() current: AuthenticatedSession,
    @Param('registerId') registerId: string,
    @Body() body: unknown,
  ) {
    return this.procurement.recordControlledMovement(current, registerId, body);
  }

  @Post('reconciliations')
  @RequireCsrf('procurement.reconciliation_create')
  async createReconciliation(@CurrentSession() current: AuthenticatedSession) {
    return this.procurement.createReconciliation(current);
  }

  @Put('reconciliations/:reconciliationId/counts')
  @RequireCsrf('procurement.reconciliation_counts')
  async recordCount(
    @CurrentSession() current: AuthenticatedSession,
    @Param('reconciliationId') reconciliationId: string,
    @Body() body: unknown,
  ) {
    return this.procurement.recordCount(current, reconciliationId, body);
  }

  @Put('reconciliations/:reconciliationId/status')
  @RequireCsrf('procurement.reconciliation_status')
  async advanceReconciliation(
    @CurrentSession() current: AuthenticatedSession,
    @Param('reconciliationId') reconciliationId: string,
    @Body() body: unknown,
  ) {
    return this.procurement.advanceReconciliation(current, reconciliationId, body);
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function id(value: string): string {
  if (!UUID_V7.test(value)) throw validationFailed();
  return value;
}
