import { createHash } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import { createNotification } from './notification-repository.js';
import {
  claimIdempotency,
  completeIdempotency,
  deleteIdempotency,
  loadIdempotency,
  type IdempotencyScope,
} from './idempotency.js';
import {
  PHARMACY_ORDER_CHANGED_EVENT_TYPE,
  PHARMACY_ORDER_CHANGED_EVENT_VERSION,
} from './pharmacy-events.js';

export const CONTROLLED_SUBSTANCE_SCHEDULES = [
  'none', 'schedule_2', 'schedule_3', 'schedule_4', 'schedule_5',
] as const;
export type ControlledSubstanceSchedule = typeof CONTROLLED_SUBSTANCE_SCHEDULES[number];

export interface MedicationRecord {
  readonly medicationId: string;
  readonly genericName: string;
  readonly atcCode: string | null;
  readonly controlledSchedule: ControlledSubstanceSchedule;
  readonly requiresPrescription: boolean;
  readonly retiredAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
interface MedicationRow extends QueryResultRow, MedicationRecord {}

export function serializeMedication(record: MedicationRecord): Record<string, unknown> {
  return {
    medication_id: record.medicationId,
    generic_name: record.genericName,
    atc_code: record.atcCode,
    controlled_schedule: record.controlledSchedule,
    controlled_substance: record.controlledSchedule !== 'none',
    requires_prescription: record.requiresPrescription,
    retired: record.retiredAt !== null,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export interface InventoryBatchRecord {
  readonly batchId: string;
  readonly variantId: string;
  readonly lotNumber: string;
  readonly expiresOn: string;
  readonly status: string;
  readonly postedQuantity: number;
  readonly reservedQuantity: number;
  readonly availableQuantity: number;
}
interface InventoryBatchRow extends QueryResultRow, InventoryBatchRecord {}

export interface StockMovementRecord {
  readonly movementId: string;
  readonly batchId: string;
  readonly movementType: string;
  readonly quantityDelta: number;
  readonly referenceType: string;
  readonly referenceId: string | null;
  readonly reasonCode: string | null;
  readonly occurredAt: Date;
}
interface StockMovementRow extends QueryResultRow, StockMovementRecord {}

export interface PharmacyOrderItemRecord {
  readonly orderItemId: string;
  readonly variantId: string;
  readonly position: number;
  readonly quantity: number;
  readonly unitPriceSen: number;
}
export interface PharmacyOrderRecord {
  readonly pharmacyOrderId: string;
  readonly siteId: string;
  readonly patientProfileId: string;
  readonly prescriptionId: string | null;
  readonly status: PharmacyOrderStatus;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly items: readonly PharmacyOrderItemRecord[];
}
interface PharmacyOrderRow extends QueryResultRow {
  readonly pharmacyOrderId: string;
  readonly siteId: string;
  readonly patientProfileId: string;
  readonly prescriptionId: string | null;
  readonly status: PharmacyOrderStatus;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function serializePharmacyOrder(record: PharmacyOrderRecord): Record<string, unknown> {
  return {
    pharmacy_order_id: record.pharmacyOrderId,
    site_id: record.siteId,
    patient_profile_id: record.patientProfileId,
    prescription_id: record.prescriptionId,
    status: record.status,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    items: record.items.map((item) => ({
      order_item_id: item.orderItemId,
      variant_id: item.variantId,
      position: item.position,
      quantity: item.quantity,
      unit_price_sen: item.unitPriceSen,
      currency: 'MYR',
    })),
  };
}

export function pharmacyOrderRequestHash(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export const PHARMACY_ORDER_STATUSES = [
  'received', 'awaiting_validation', 'validated', 'stock_reserved', 'fulfilling',
  'ready_for_dispatch', 'dispatched', 'delivered', 'delivery_exception', 'returned',
  'rejected', 'cancelled',
] as const;
export type PharmacyOrderStatus = typeof PHARMACY_ORDER_STATUSES[number];
export type PrescriptionValidationState =
  'pending' | 'valid' | 'invalid' | 'needs_clarification';
export type StockReservationStatus = 'active' | 'consumed' | 'released' | 'expired';

/** Canonical order transitions from the frozen catalogue. */
const ORDER_TRANSITIONS: Readonly<Record<PharmacyOrderStatus, readonly PharmacyOrderStatus[]>> =
  Object.freeze({
    received: ['awaiting_validation', 'cancelled'],
    awaiting_validation: ['validated', 'stock_reserved', 'rejected', 'cancelled'],
    validated: ['stock_reserved', 'cancelled'],
    stock_reserved: ['fulfilling', 'cancelled'],
    fulfilling: ['ready_for_dispatch', 'cancelled'],
    ready_for_dispatch: ['dispatched', 'cancelled'],
    dispatched: ['delivered', 'delivery_exception'],
    delivery_exception: ['ready_for_dispatch', 'returned'],
    delivered: [],
    returned: [],
    rejected: [],
    cancelled: [],
  });

export function pharmacyOrderTransitionAllowed(
  current: PharmacyOrderStatus, next: PharmacyOrderStatus,
): boolean {
  return ORDER_TRANSITIONS[current].includes(next);
}

export function reservationTransitionAllowed(
  current: StockReservationStatus, next: StockReservationStatus,
): boolean {
  return current === 'active' && next !== 'active';
}

export interface BatchAvailability {
  readonly batchId: string;
  readonly expiresOn: string;
  readonly postedQuantity: number;
  readonly reservedQuantity: number;
  readonly availableQuantity: number;
}
interface AvailabilityRow extends QueryResultRow, BatchAvailability {}

export interface ReservationPlanLine {
  readonly batchId: string;
  readonly quantity: number;
}

/**
 * Allocates a requested quantity across batches by FEFO.
 *
 * Pure and separately testable, because the allocation rule is the part most
 * likely to be wrong: it must consume the EARLIEST-expiring stock first so
 * short-dated inventory is used before it expires, and it must refuse to
 * over-allocate rather than silently short-fill.
 */
export function planFefoAllocation(
  batches: readonly BatchAvailability[],
  requestedQuantity: number,
): { readonly lines: readonly ReservationPlanLine[]; readonly shortfall: number } {
  if (requestedQuantity <= 0) return { lines: [], shortfall: 0 };
  // Earliest expiry first; batch id breaks ties so allocation is deterministic and
  // two identical requests never disagree about which batch to touch.
  const ordered = [...batches]
    .filter((batch) => batch.availableQuantity > 0)
    .sort((left, right) => left.expiresOn === right.expiresOn
      ? left.batchId.localeCompare(right.batchId)
      : left.expiresOn.localeCompare(right.expiresOn));
  const lines: ReservationPlanLine[] = [];
  let remaining = requestedQuantity;
  for (const batch of ordered) {
    if (remaining === 0) break;
    const take = Math.min(remaining, batch.availableQuantity);
    lines.push({ batchId: batch.batchId, quantity: take });
    remaining -= take;
  }
  return { lines, shortfall: remaining };
}

export type PharmacyFailure = 'not_found' | 'version_conflict' | 'invalid_transition' |
  'validation_required' | 'insufficient_stock' | 'wrong_site';

export interface ValidateAndReserveResult {
  readonly status: PharmacyOrderStatus;
  readonly reservations: readonly ReservationPlanLine[];
  readonly shortfallItems: readonly string[];
}

export class PharmacyRepository {
  constructor(private readonly database: PostgresConnection) {}

  async listMedications(input: { includeRetired: boolean; limit: number }): Promise<MedicationRecord[]> {
    const retired = input.includeRetired ? '' : 'WHERE retired_at IS NULL';
    return (await this.database.query<MedicationRow>(
      `SELECT medication_id AS "medicationId", generic_name AS "genericName",
         atc_code AS "atcCode", controlled_schedule AS "controlledSchedule",
         requires_prescription AS "requiresPrescription", retired_at AS "retiredAt",
         version, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM medications ${retired}
       ORDER BY generic_name, medication_id LIMIT $1`,
      [input.limit],
    )).rows;
  }

  async findMedication(medicationId: string): Promise<MedicationRecord | undefined> {
    return (await this.database.query<MedicationRow>(
      `SELECT medication_id AS "medicationId", generic_name AS "genericName",
         atc_code AS "atcCode", controlled_schedule AS "controlledSchedule",
         requires_prescription AS "requiresPrescription", retired_at AS "retiredAt",
         version, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM medications WHERE medication_id = $1`,
      [medicationId],
    )).rows[0];
  }

  async createMedication(input: {
    genericName: string; atcCode: string | null; controlledSchedule: ControlledSubstanceSchedule;
    requiresPrescription: boolean; organizationId: string; actorProfileId: string;
    correlationId: string; now: Date;
  }): Promise<MedicationRecord | 'duplicate'> {
    try {
      return await this.database.transaction(async (client) => {
        const created = (await client.query<MedicationRow>(
          `INSERT INTO medications
           (generic_name, atc_code, controlled_schedule, requires_prescription, updated_at)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING medication_id AS "medicationId", generic_name AS "genericName",
             atc_code AS "atcCode", controlled_schedule AS "controlledSchedule",
             requires_prescription AS "requiresPrescription", retired_at AS "retiredAt",
             version, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [input.genericName, input.atcCode, input.controlledSchedule,
            input.requiresPrescription, input.now],
        )).rows[0]!;
        await this.auditCatalogue(client, created.medicationId, input.organizationId,
          input.actorProfileId, 'pharmacy.medication.created', input.correlationId, input.now);
        return created;
      });
    } catch (error) {
      if (databaseCode(error) === '23505') return 'duplicate';
      throw error;
    }
  }

  async updateMedication(input: {
    medicationId: string; genericName: string; atcCode: string | null;
    controlledSchedule: ControlledSubstanceSchedule; requiresPrescription: boolean;
    retired: boolean; expectedVersion: number; organizationId: string; actorProfileId: string;
    correlationId: string; now: Date;
  }): Promise<MedicationRecord | 'not_found' | 'version_conflict' | 'duplicate'> {
    try {
      return await this.database.transaction(async (client) => {
        const current = (await client.query<{ version: number }>(
          'SELECT version FROM medications WHERE medication_id = $1 FOR UPDATE',
          [input.medicationId],
        )).rows[0];
        if (current === undefined) return 'not_found';
        if (current.version !== input.expectedVersion) return 'version_conflict';
        const updated = (await client.query<MedicationRow>(
          `UPDATE medications SET generic_name = $2, atc_code = $3,
             controlled_schedule = $4, requires_prescription = $5,
             retired_at = $6, version = version + 1, updated_at = $7
           WHERE medication_id = $1
           RETURNING medication_id AS "medicationId", generic_name AS "genericName",
             atc_code AS "atcCode", controlled_schedule AS "controlledSchedule",
             requires_prescription AS "requiresPrescription", retired_at AS "retiredAt",
             version, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [input.medicationId, input.genericName, input.atcCode, input.controlledSchedule,
            input.requiresPrescription, input.retired ? input.now : null, input.now],
        )).rows[0]!;
        await this.auditCatalogue(client, updated.medicationId, input.organizationId,
          input.actorProfileId, 'pharmacy.medication.updated', input.correlationId, input.now);
        return updated;
      });
    } catch (error) {
      if (databaseCode(error) === '23505') return 'duplicate';
      throw error;
    }
  }

  async listBatches(input: {
    siteId: string; variantId?: string | undefined; limit: number;
  }): Promise<InventoryBatchRecord[]> {
    const parameters: unknown[] = [input.siteId];
    const variant = input.variantId === undefined ? '' : `AND batch.variant_id = $${parameters.push(input.variantId)}`;
    parameters.push(input.limit);
    return (await this.database.query<InventoryBatchRow>(
      `SELECT batch.batch_id AS "batchId", batch.variant_id AS "variantId",
         batch.lot_number AS "lotNumber", batch.expires_on::text AS "expiresOn",
         batch.status::text,
         COALESCE(posted.quantity, 0)::integer AS "postedQuantity",
         COALESCE(reserved.quantity, 0)::integer AS "reservedQuantity",
         (COALESCE(posted.quantity, 0) - COALESCE(reserved.quantity, 0))::integer AS "availableQuantity"
       FROM inventory_batches AS batch
       LEFT JOIN (SELECT batch_id, SUM(quantity_delta) AS quantity FROM stock_ledger GROUP BY batch_id)
         AS posted ON posted.batch_id = batch.batch_id
       LEFT JOIN (SELECT batch_id, SUM(active_quantity) AS quantity FROM stock_reservations
                  WHERE status = 'active' GROUP BY batch_id)
         AS reserved ON reserved.batch_id = batch.batch_id
       WHERE batch.site_id = $1 ${variant}
       ORDER BY batch.expires_on, batch.batch_id LIMIT $${parameters.length}`,
      parameters,
    )).rows;
  }

  async listStockMovements(input: {
    siteId: string; batchId?: string | undefined; limit: number;
  }): Promise<StockMovementRecord[]> {
    const parameters: unknown[] = [input.siteId];
    const batch = input.batchId === undefined ? '' : `AND batch_id = $${parameters.push(input.batchId)}`;
    parameters.push(input.limit);
    return (await this.database.query<StockMovementRow>(
      `SELECT movement_id AS "movementId", batch_id AS "batchId",
         movement_type::text AS "movementType", quantity_delta AS "quantityDelta",
         reference_type AS "referenceType", reference_id AS "referenceId",
         reason_code AS "reasonCode", occurred_at AS "occurredAt"
       FROM stock_ledger WHERE site_id = $1 ${batch}
       ORDER BY occurred_at DESC, movement_id DESC LIMIT $${parameters.length}`,
      parameters,
    )).rows;
  }

  /**
   * Reads one order by id, scoped exactly as `listOrders` scopes its rows: a
   * patient sees only their own orders and a pharmacy membership sees only orders
   * at their assigned sites. The scope predicate is pushed into the SQL so the
   * query cannot leak an order outside the caller's authority, and an
   * out-of-scope order reads as `undefined` — which the service maps to 404 so
   * absence and denial stay indistinguishable.
   */
  async findOrder(input: {
    pharmacyOrderId: string;
    patientProfileId?: string | undefined;
    siteIds?: readonly string[] | undefined;
  }): Promise<PharmacyOrderRecord | undefined> {
    const conditions: string[] = ['pharmacy_order_id = $1'];
    const parameters: unknown[] = [input.pharmacyOrderId];
    if (input.patientProfileId !== undefined) {
      conditions.push(`patient_profile_id = $${parameters.push(input.patientProfileId)}`);
    }
    if (input.siteIds !== undefined && input.siteIds.length > 0) {
      conditions.push(`site_id = ANY($${parameters.push(input.siteIds)}::uuid[])`);
    }
    const row = (await this.database.query<PharmacyOrderRow>(
      `SELECT pharmacy_order_id AS "pharmacyOrderId", site_id AS "siteId",
         patient_profile_id AS "patientProfileId", prescription_id AS "prescriptionId",
         status, version, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM pharmacy_orders WHERE ${conditions.join(' AND ')}`,
      parameters,
    )).rows[0];
    if (row === undefined) return undefined;
    const items = (await this.database.query<PharmacyOrderItemRecord & QueryResultRow>(
      `SELECT order_item_id AS "orderItemId", variant_id AS "variantId",
         position, quantity, unit_price_sen::integer AS "unitPriceSen"
       FROM pharmacy_order_items WHERE pharmacy_order_id = $1
       ORDER BY position`,
      [row.pharmacyOrderId],
    )).rows;
    return { ...row, items };
  }

  async listOrders(input: {
    patientProfileId?: string | undefined; siteId?: string | undefined;
    status?: PharmacyOrderStatus | undefined; limit: number;
  }): Promise<PharmacyOrderRecord[]> {
    const parameters: unknown[] = [];
    const conditions: string[] = [];
    if (input.patientProfileId !== undefined) {
      conditions.push(`patient_profile_id = $${parameters.push(input.patientProfileId)}`);
    }
    if (input.siteId !== undefined) conditions.push(`site_id = $${parameters.push(input.siteId)}`);
    if (input.status !== undefined) conditions.push(`status = $${parameters.push(input.status)}`);
    parameters.push(input.limit);
    const rows = (await this.database.query<PharmacyOrderRow>(
      `SELECT pharmacy_order_id AS "pharmacyOrderId", site_id AS "siteId",
         patient_profile_id AS "patientProfileId", prescription_id AS "prescriptionId",
         status, version, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM pharmacy_orders WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC, pharmacy_order_id DESC LIMIT $${parameters.length}`,
      parameters,
    )).rows;
    if (rows.length === 0) return [];
    const itemRows = (await this.database.query<PharmacyOrderItemRecord & QueryResultRow>(
      `SELECT order_item_id AS "orderItemId", pharmacy_order_id AS "pharmacyOrderId",
         variant_id AS "variantId", position, quantity,
         unit_price_sen::integer AS "unitPriceSen"
       FROM pharmacy_order_items WHERE pharmacy_order_id = ANY($1::uuid[])
       ORDER BY pharmacy_order_id, position`,
      [rows.map((row) => row.pharmacyOrderId)],
    )).rows as (PharmacyOrderItemRecord & { pharmacyOrderId: string })[];
    return rows.map((row) => ({
      ...row,
      items: itemRows.filter((item) => item.pharmacyOrderId === row.pharmacyOrderId)
        .map(({ pharmacyOrderId: _ignored, ...item }) => item),
    }));
  }

  async createOrder(input: {
    organizationId: string; siteId: string; patientProfileId: string; prescriptionId: string;
    items: readonly { variantId: string; quantity: number }[]; actorProfileId: string;
    idempotencyKey: string; requestHash: string; now: Date; correlationId: string;
  }): Promise<{ record: PharmacyOrderRecord } | { snapshot: Record<string, unknown> } |
    'site_unknown' | 'prescription_invalid' | 'variant_unknown' | 'idempotency_reused'> {
    const scope: IdempotencyScope = {
      organizationId: input.organizationId, actorProfileId: input.actorProfileId,
      operationId: 'pharmacy.order.create', idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
    };
    return this.database.transaction(async (client) => {
      const existing = await loadIdempotency(client, scope, input.now, true);
      if (existing !== undefined && !existing.expired) {
        if (existing.requestHash !== input.requestHash || existing.state !== 'completed' ||
            existing.responseBody === null) return 'idempotency_reused';
        return { snapshot: existing.responseBody };
      }
      if (existing?.expired === true) await deleteIdempotency(client, scope);
      const site = await client.query(
        'SELECT 1 FROM sites WHERE site_id = $1 AND organization_id = $2',
        [input.siteId, input.organizationId],
      );
      if (site.rowCount !== 1) return 'site_unknown';
      const prescription = (await client.query<{ status: string; expiresAt: Date | null }>(
        `SELECT status::text, expires_at AS "expiresAt" FROM prescriptions
         WHERE prescription_id = $1 AND patient_profile_id = $2 AND organization_id = $3`,
        [input.prescriptionId, input.patientProfileId, input.organizationId],
      )).rows[0];
      if (prescription === undefined || prescription.status !== 'signed' ||
          (prescription.expiresAt !== null && prescription.expiresAt <= input.now)) {
        return 'prescription_invalid';
      }
      const variants = await client.query<{ variantId: string }>(
        `SELECT variant_id AS "variantId" FROM medication_variants
         WHERE variant_id = ANY($1::uuid[]) AND retired_at IS NULL`,
        [input.items.map((item) => item.variantId)],
      );
      if (variants.rowCount !== input.items.length) return 'variant_unknown';
      if (!await claimIdempotency(client, scope, new Date(input.now.getTime() + 86_400_000))) {
        return 'idempotency_reused';
      }
      const order = (await client.query<PharmacyOrderRow>(
        `INSERT INTO pharmacy_orders
         (organization_id, site_id, patient_profile_id, prescription_id, status, updated_at)
         VALUES ($1,$2,$3,$4,'awaiting_validation',$5)
         RETURNING pharmacy_order_id AS "pharmacyOrderId", site_id AS "siteId",
           patient_profile_id AS "patientProfileId", prescription_id AS "prescriptionId",
           status, version, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [input.organizationId, input.siteId, input.patientProfileId,
          input.prescriptionId, input.now],
      )).rows[0]!;
      const items: PharmacyOrderItemRecord[] = [];
      for (const [index, requested] of input.items.entries()) {
        const item = (await client.query<PharmacyOrderItemRecord & QueryResultRow>(
          `INSERT INTO pharmacy_order_items
           (pharmacy_order_id, variant_id, position, quantity, unit_price_sen)
           VALUES ($1,$2,$3,$4,0)
           RETURNING order_item_id AS "orderItemId", variant_id AS "variantId",
             position, quantity, unit_price_sen::integer AS "unitPriceSen"`,
          [order.pharmacyOrderId, requested.variantId, index + 1, requested.quantity],
        )).rows[0]!;
        items.push(item);
      }
      await client.query(
        `INSERT INTO order_status_events
         (pharmacy_order_id, previous_status, status, actor_profile_id, correlation_id, occurred_at)
         VALUES ($1,NULL,'awaiting_validation',$2,$3,$4)`,
        [order.pharmacyOrderId, input.actorProfileId, input.correlationId, input.now],
      );
      await client.query(
        `INSERT INTO audit_logs
         (audit_id,organization_id,actor_profile_id,action,object_type,object_id,
          correlation_id,occurred_at)
         VALUES (uuidv7(),$1,$2,'pharmacy_order.created','pharmacy_order',$3,$4,$5)`,
        [input.organizationId, input.actorProfileId, order.pharmacyOrderId,
          input.correlationId, input.now],
      );
      await client.query(
        `INSERT INTO outbox_events
         (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
          payload,correlation_id,occurred_at)
         VALUES (uuidv7(),$1,$2,'pharmacy_order',$3,0,$4::jsonb,$5,$6)`,
        [PHARMACY_ORDER_CHANGED_EVENT_TYPE, PHARMACY_ORDER_CHANGED_EVENT_VERSION,
          order.pharmacyOrderId, JSON.stringify({
            pharmacy_order_id: order.pharmacyOrderId,
            previous_status: null,
            status: 'awaiting_validation',
            reason_code: null,
          }), input.correlationId, input.now],
      );
      const record: PharmacyOrderRecord = { ...order, items };
      await completeIdempotency(client, scope, 201, serializePharmacyOrder(record), input.now);
      return { record };
    });
  }

  private async auditCatalogue(
    client: PoolClient, medicationId: string, organizationId: string, actorProfileId: string,
    action: string, correlationId: string, now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id,organization_id,actor_profile_id,action,object_type,object_id,
        correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,$3,'medication',$4,$5,$6)`,
      [organizationId, actorProfileId, action, medicationId, correlationId, now],
    );
  }

  /**
   * Available stock per batch for one variant at one site.
   *
   * Derived from the append-only ledger minus active reservations. Nothing reads a
   * stored balance, because a stored balance is what makes overselling possible.
   */
  async availability(input: {
    siteId: string; variantId: string; client?: PoolClient; lock?: boolean;
  }): Promise<BatchAvailability[]> {
    const text = `SELECT batch.batch_id AS "batchId", batch.expires_on::text AS "expiresOn",
        COALESCE(posted.quantity, 0)::integer AS "postedQuantity",
        COALESCE(reserved.quantity, 0)::integer AS "reservedQuantity",
        (COALESCE(posted.quantity, 0) - COALESCE(reserved.quantity, 0))::integer AS "availableQuantity"
      FROM inventory_batches batch
      LEFT JOIN (
        SELECT batch_id, SUM(quantity_delta) AS quantity FROM stock_ledger GROUP BY batch_id
      ) posted ON posted.batch_id = batch.batch_id
      LEFT JOIN (
        SELECT batch_id, SUM(active_quantity) AS quantity FROM stock_reservations
        WHERE status = 'active' GROUP BY batch_id
      ) reserved ON reserved.batch_id = batch.batch_id
      WHERE batch.site_id = $1 AND batch.variant_id = $2
        AND batch.status = 'available' AND batch.expires_on > CURRENT_DATE
      ORDER BY batch.expires_on ASC, batch.batch_id ASC`;
    const result = input.client === undefined
      ? await this.database.query<AvailabilityRow>(text, [input.siteId, input.variantId])
      : await input.client.query<AvailabilityRow>(text, [input.siteId, input.variantId]);
    return result.rows;
  }

  /**
   * Records validation and either FEFO reservations or a reasoned failed-reservation
   * outcome, in ONE serializable retryable transaction.
   *
   * This is atomic boundary 4 from the domain model. The batch rows are locked
   * `FOR UPDATE` before availability is read, so two concurrent orders for the same
   * batch serialise instead of both seeing the same free quantity. The constraint
   * trigger is the backstop if that lock is ever missed.
   */
  async validateAndReserve(input: {
    pharmacyOrderId: string;
    validationState: PrescriptionValidationState;
    validationReasonCode: string | null;
    validatorMembershipId: string;
    validatorProfileId: string;
    expectedVersion: number;
    reservationTtlMs: number;
    now: Date;
    correlationId: string;
  }): Promise<ValidateAndReserveResult | PharmacyFailure> {
    return this.database.serializableTransaction(async (client) => {
      const order = (await client.query<{
        pharmacyOrderId: string; siteId: string; organizationId: string;
        prescriptionId: string | null; status: PharmacyOrderStatus; version: number;
      }>(
        `SELECT pharmacy_order_id AS "pharmacyOrderId", site_id AS "siteId",
           organization_id AS "organizationId", prescription_id AS "prescriptionId",
           status, version
         FROM pharmacy_orders WHERE pharmacy_order_id = $1 FOR UPDATE`,
        [input.pharmacyOrderId],
      )).rows[0];
      if (order === undefined) return 'not_found';
      if (order.version !== input.expectedVersion) return 'version_conflict';
      if (order.status !== 'awaiting_validation' && order.status !== 'validated') {
        return 'invalid_transition';
      }

      await client.query(
        `INSERT INTO prescription_validations
         (pharmacy_order_id, prescription_id, state, reason_code,
          validated_by_membership_id, validated_by_profile_id, correlation_id, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [input.pharmacyOrderId, order.prescriptionId, input.validationState,
          input.validationReasonCode, input.validatorMembershipId,
          input.validatorProfileId, input.correlationId, input.now],
      );

      // A failed validation rejects the order and reserves nothing.
      if (input.validationState !== 'valid') {
        const nextStatus: PharmacyOrderStatus =
          input.validationState === 'invalid' ? 'rejected' : order.status;
        if (nextStatus !== order.status) {
          await this.applyStatus(client, order.pharmacyOrderId, order.status, nextStatus,
            input.validationReasonCode, input.validatorProfileId, input.correlationId, input.now);
        }
        return { status: nextStatus, reservations: [], shortfallItems: [] };
      }

      const items = (await client.query<{
        orderItemId: string; variantId: string; quantity: number;
      }>(
        `SELECT order_item_id AS "orderItemId", variant_id AS "variantId", quantity
         FROM pharmacy_order_items WHERE pharmacy_order_id = $1 ORDER BY position`,
        [input.pharmacyOrderId],
      )).rows;

      const reservations: ReservationPlanLine[] = [];
      const shortfallItems: string[] = [];
      for (const item of items) {
        // Lock every candidate batch BEFORE reading availability, in a deterministic
        // order, so concurrent reservers serialise rather than racing.
        await client.query(
          `SELECT batch_id FROM inventory_batches
           WHERE site_id = $1 AND variant_id = $2 AND status = 'available'
           ORDER BY expires_on ASC, batch_id ASC FOR UPDATE`,
          [order.siteId, item.variantId],
        );
        const batches = await this.availability({
          siteId: order.siteId, variantId: item.variantId, client,
        });
        const plan = planFefoAllocation(batches, item.quantity);
        if (plan.shortfall > 0) {
          shortfallItems.push(item.orderItemId);
          continue;
        }
        for (const line of plan.lines) {
          await client.query(
            `INSERT INTO stock_reservations
             (batch_id, organization_id, site_id, order_item_id, quantity, expires_at, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
            [line.batchId, order.organizationId, order.siteId, item.orderItemId,
              line.quantity, new Date(input.now.getTime() + input.reservationTtlMs), input.now],
          );
          reservations.push(line);
        }
      }

      // Valid prescription plus unavailable stock ends at `validated` with a
      // reasoned failure, NOT at `stock_reserved`. Partial reservations are released
      // so an order never holds stock it cannot fulfil.
      const nextStatus: PharmacyOrderStatus =
        shortfallItems.length > 0 ? 'validated' : 'stock_reserved';
      if (shortfallItems.length > 0 && reservations.length > 0) {
        await client.query(
          `UPDATE stock_reservations SET status = 'released', version = version + 1, updated_at = $2
           WHERE order_item_id IN (
             SELECT order_item_id FROM pharmacy_order_items WHERE pharmacy_order_id = $1
           ) AND status = 'active'`,
          [input.pharmacyOrderId, input.now],
        );
        reservations.length = 0;
      }
      if (nextStatus !== order.status) {
        await this.applyStatus(client, order.pharmacyOrderId, order.status, nextStatus,
          shortfallItems.length > 0 ? 'insufficient_stock' : null,
          input.validatorProfileId, input.correlationId, input.now);
      }
      return { status: nextStatus, reservations, shortfallItems };
    });
  }

  /**
   * Consumes reservations, posts the stock decrement and marks the order dispatched
   * atomically. This is atomic boundary 5.
   */
  async dispatch(input: {
    pharmacyOrderId: string; expectedVersion: number; actorProfileId: string;
    now: Date; correlationId: string;
  }): Promise<'dispatched' | PharmacyFailure> {
    return this.database.serializableTransaction(async (client) => {
      const order = (await client.query<{
        siteId: string; organizationId: string; status: PharmacyOrderStatus; version: number;
      }>(
        `SELECT site_id AS "siteId", organization_id AS "organizationId", status, version
         FROM pharmacy_orders WHERE pharmacy_order_id = $1 FOR UPDATE`,
        [input.pharmacyOrderId],
      )).rows[0];
      if (order === undefined) return 'not_found';
      if (order.version !== input.expectedVersion) return 'version_conflict';
      if (!pharmacyOrderTransitionAllowed(order.status, 'dispatched')) return 'invalid_transition';

      const reservations = (await client.query<{ reservationId: string; batchId: string; quantity: number }>(
        `SELECT reservation.reservation_id AS "reservationId", reservation.batch_id AS "batchId",
           reservation.quantity
         FROM stock_reservations reservation
         JOIN pharmacy_order_items item ON item.order_item_id = reservation.order_item_id
         WHERE item.pharmacy_order_id = $1 AND reservation.status = 'active'
         ORDER BY reservation.reservation_id
         FOR UPDATE OF reservation`,
        [input.pharmacyOrderId],
      )).rows;
      if (reservations.length === 0) return 'validation_required';

      for (const reservation of reservations) {
        // The decrement is posted as a `dispatch` movement and the hold is marked
        // consumed in the same transaction, so stock never sits both reserved and
        // dispatched, nor free in between.
        await client.query(
          `INSERT INTO stock_ledger
           (batch_id, organization_id, site_id, movement_type, quantity_delta,
            reference_type, reference_id, actor_profile_id, correlation_id, occurred_at)
           VALUES ($1,$2,$3,'dispatch',$4,'pharmacy_order',$5,$6,$7,$8)`,
          [reservation.batchId, order.organizationId, order.siteId, -reservation.quantity,
            input.pharmacyOrderId, input.actorProfileId, input.correlationId, input.now],
        );
        await client.query(
          `UPDATE stock_reservations SET status = 'consumed', version = version + 1, updated_at = $2
           WHERE reservation_id = $1`,
          [reservation.reservationId, input.now],
        );
      }
      await this.applyStatus(client, input.pharmacyOrderId, order.status, 'dispatched',
        null, input.actorProfileId, input.correlationId, input.now);
      return 'dispatched';
    });
  }

  /**
   * Moves an order along its own state machine.
   *
   * Needed because `stock_reserved → fulfilling → ready_for_dispatch` has no other
   * route: without it `dispatch` is unreachable, which real verification exposed.
   * Reservation and dispatch remain separate commands, since each is its own atomic
   * boundary.
   */
  async transitionOrder(input: {
    pharmacyOrderId: string;
    nextStatus: PharmacyOrderStatus;
    reasonCode: string | null;
    expectedVersion: number;
    actorProfileId: string;
    now: Date;
    correlationId: string;
  }): Promise<PharmacyOrderStatus | PharmacyFailure> {
    return this.database.transaction(async (client) => {
      const order = (await client.query<{ status: PharmacyOrderStatus; version: number }>(
        `SELECT status, version FROM pharmacy_orders
         WHERE pharmacy_order_id = $1 FOR UPDATE`,
        [input.pharmacyOrderId],
      )).rows[0];
      if (order === undefined) return 'not_found';
      if (order.version !== input.expectedVersion) return 'version_conflict';
      if (!pharmacyOrderTransitionAllowed(order.status, input.nextStatus)) {
        return 'invalid_transition';
      }
      // Cancelling before dispatch must release any hold, or stock stays reserved
      // for an order that will never be filled.
      if (input.nextStatus === 'cancelled') {
        await client.query(
          `UPDATE stock_reservations SET status = 'released', version = version + 1, updated_at = $2
           WHERE status = 'active' AND order_item_id IN (
             SELECT order_item_id FROM pharmacy_order_items WHERE pharmacy_order_id = $1
           )`,
          [input.pharmacyOrderId, input.now],
        );
      }
      await this.applyStatus(client, input.pharmacyOrderId, order.status, input.nextStatus,
        input.reasonCode, input.actorProfileId, input.correlationId, input.now);
      return input.nextStatus;
    });
  }

  /** Releases holds whose window elapsed, returning stock to availability. */
  async releaseExpiredReservations(now: Date, limit: number): Promise<number> {
    const result = await this.database.query(
      `UPDATE stock_reservations SET status = 'expired', version = version + 1, updated_at = $1
       WHERE reservation_id IN (
         SELECT reservation_id FROM stock_reservations
         WHERE status = 'active' AND expires_at <= $1
         ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED
       )`,
      [now, limit],
    );
    return result.rowCount ?? 0;
  }

  private async applyStatus(
    client: PoolClient, pharmacyOrderId: string, previous: PharmacyOrderStatus,
    next: PharmacyOrderStatus, reasonCode: string | null, actorProfileId: string,
    correlationId: string, now: Date,
  ): Promise<void> {
    // Derived in TypeScript. Reusing one parameter as both an enum value and inside
    // a comparison — `= '...'` or `IN (...)` alike — leaves PostgreSQL unable to
    // infer its type (`42P08`).
    const reasonForRow = next === 'cancelled' || next === 'rejected' ? reasonCode : null;
    const updated = (await client.query<{ organizationId: string; version: number }>(
      `UPDATE pharmacy_orders SET status = $2,
         cancellation_reason_code = COALESCE($3, cancellation_reason_code),
         version = version + 1, updated_at = $4
       WHERE pharmacy_order_id = $1
       RETURNING organization_id AS "organizationId", version`,
      [pharmacyOrderId, next, reasonForRow, now],
    )).rows[0]!;
    await client.query(
      `INSERT INTO order_status_events
       (pharmacy_order_id, previous_status, status, reason_code, actor_profile_id,
        correlation_id, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [pharmacyOrderId, previous, next, reasonCode, actorProfileId, correlationId, now],
    );
    await client.query(
      `INSERT INTO audit_logs
       (audit_id,organization_id,actor_profile_id,action,object_type,object_id,
        reason,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,$3,'pharmacy_order',$4,$5,$6,$7)`,
      [updated.organizationId, actorProfileId, `pharmacy_order.${next}`,
        pharmacyOrderId, reasonCode, correlationId, now],
    );
    await client.query(
      `INSERT INTO outbox_events
       (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
        payload,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,'pharmacy_order',$3,$4,$5::jsonb,$6,$7)`,
      [PHARMACY_ORDER_CHANGED_EVENT_TYPE, PHARMACY_ORDER_CHANGED_EVENT_VERSION,
        pharmacyOrderId, updated.version, JSON.stringify({
          pharmacy_order_id: pharmacyOrderId,
          previous_status: previous,
          status: next,
          reason_code: reasonCode,
        }), correlationId, now],
    );
    // Patient-facing milestone notifications. Internal fulfilment states
    // (received → validated → stock_reserved → fulfilling) say nothing a patient
    // can act on; the four below do. The actor is skipped so a patient cancelling
    // their own order is not told what they just did.
    const patientCode = next === 'ready_for_dispatch'
      ? 'pharmacy_order.ready_for_dispatch.title'
      : next === 'dispatched'
        ? 'pharmacy_order.dispatched.title'
        : next === 'delivered'
          ? 'pharmacy_order.delivered.title'
          : next === 'cancelled' || next === 'rejected'
            ? 'pharmacy_order.cancelled.title'
            : null;
    if (patientCode !== null) {
      const patient = (await client.query<{ readonly patientProfileId: string }>(
        `SELECT patient_profile_id AS "patientProfileId" FROM pharmacy_orders
         WHERE pharmacy_order_id = $1`,
        [pharmacyOrderId],
      )).rows[0];
      if (patient !== undefined && patient.patientProfileId !== actorProfileId) {
        await createNotification(client, {
          profileId: patient.patientProfileId,
          category: 'delivery',
          resourceType: 'pharmacy_order',
          resourceId: pharmacyOrderId,
          titleCode: patientCode,
          bodyCode: patientCode.replace(/\.title$/, '.body'),
          correlationId,
          now,
        });
      }
    }
  }
}



function databaseCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (error as { readonly code?: string }).code
    : undefined;
}
