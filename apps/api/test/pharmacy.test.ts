import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PHARMACY_ORDER_CHANGED_EVENT_TYPE,
  pharmacyOrderRequestHash,
  pharmacyOrderTransitionAllowed,
  planFefoAllocation,
  reservationTransitionAllowed,
  serializeMedication,
  serializePharmacyOrder,
  type BatchAvailability,
} from '@smartcura/database/pharmacy';
import {
  createMedicationSchema,
  createPharmacyOrderSchema,
  updateMedicationSchema,
} from '../apps/api/src/logistics/logistics-request.schemas.js';
import { OutboxProcessor } from '../apps/worker/src/outbox.processor.js';

const orderId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d80';

const batch = (
  batchId: string, expiresOn: string, available: number,
): BatchAvailability => ({
  batchId, expiresOn,
  postedQuantity: available, reservedQuantity: 0, availableQuantity: available,
});

test('FEFO allocation consumes the earliest-expiring stock first', () => {
  const batches = [
    batch('018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d01', '2027-01-31', 10),
    batch('018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d02', '2026-09-30', 4),
    batch('018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d03', '2026-12-31', 6),
  ];
  const plan = planFefoAllocation(batches, 12);
  assert.equal(plan.shortfall, 0);
  // Short-dated stock must be used before it expires, so the September batch is
  // drained first, then December, then January.
  assert.deepEqual(plan.lines, [
    { batchId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d02', quantity: 4 },
    { batchId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d03', quantity: 6 },
    { batchId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d01', quantity: 2 },
  ]);
});

test('FEFO allocation reports a shortfall instead of silently short-filling', () => {
  const batches = [batch('018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d01', '2027-01-31', 3)];
  const plan = planFefoAllocation(batches, 10);
  // A partially filled plan with no shortfall signal would let an order proceed to
  // dispatch with less medication than the prescription requires.
  assert.equal(plan.shortfall, 7);
  assert.deepEqual(plan.lines, [
    { batchId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d01', quantity: 3 },
  ]);
  assert.deepEqual(planFefoAllocation([], 5), { lines: [], shortfall: 5 });
  assert.deepEqual(planFefoAllocation(batches, 0), { lines: [], shortfall: 0 });
});

test('already-reserved quantity is excluded so concurrent orders cannot oversell', () => {
  // Ten posted, seven already held by another order: only three are allocatable.
  const contended: BatchAvailability = {
    batchId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d01', expiresOn: '2027-01-31',
    postedQuantity: 10, reservedQuantity: 7, availableQuantity: 3,
  };
  const plan = planFefoAllocation([contended], 5);
  assert.equal(plan.shortfall, 2);
  assert.deepEqual(plan.lines, [{ batchId: contended.batchId, quantity: 3 }]);
  // A fully reserved batch is not allocatable at all, even though stock is posted.
  const exhausted: BatchAvailability = {
    ...contended, reservedQuantity: 10, availableQuantity: 0,
  };
  assert.deepEqual(planFefoAllocation([exhausted], 1), { lines: [], shortfall: 1 });
  // Allocation never exceeds availability for any batch in the plan.
  const total = plan.lines.reduce((sum, line) => sum + line.quantity, 0);
  assert.ok(total <= contended.availableQuantity);
});

test('allocation is deterministic when two batches share an expiry', () => {
  const first = batch('018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d01', '2027-01-31', 2);
  const second = batch('018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d02', '2027-01-31', 2);
  // Batch id breaks the tie, so two identical requests never disagree about which
  // batch to touch and cannot deadlock against each other.
  assert.deepEqual(planFefoAllocation([second, first], 3).lines, [
    { batchId: first.batchId, quantity: 2 },
    { batchId: second.batchId, quantity: 1 },
  ]);
  assert.deepEqual(
    planFefoAllocation([first, second], 3).lines,
    planFefoAllocation([second, first], 3).lines,
  );
});

test('order and reservation state machines match the frozen catalogue', () => {
  assert.equal(pharmacyOrderTransitionAllowed('received', 'awaiting_validation'), true);
  // Valid prescription plus available stock may skip straight to reserved.
  assert.equal(pharmacyOrderTransitionAllowed('awaiting_validation', 'stock_reserved'), true);
  assert.equal(pharmacyOrderTransitionAllowed('validated', 'stock_reserved'), true);
  assert.equal(pharmacyOrderTransitionAllowed('ready_for_dispatch', 'dispatched'), true);
  assert.equal(pharmacyOrderTransitionAllowed('delivery_exception', 'returned'), true);
  // Dispatch cannot be reached without stock, and terminal states never reopen.
  assert.equal(pharmacyOrderTransitionAllowed('received', 'dispatched'), false);
  assert.equal(pharmacyOrderTransitionAllowed('validated', 'dispatched'), false);
  assert.equal(pharmacyOrderTransitionAllowed('delivered', 'dispatched'), false);
  assert.equal(pharmacyOrderTransitionAllowed('cancelled', 'received'), false);
  assert.equal(pharmacyOrderTransitionAllowed('dispatched', 'cancelled'), false);
  assert.equal(reservationTransitionAllowed('active', 'consumed'), true);
  assert.equal(reservationTransitionAllowed('active', 'released'), true);
  assert.equal(reservationTransitionAllowed('consumed', 'released'), false);
  assert.equal(reservationTransitionAllowed('released', 'active'), false);
});

test('worker accepts exact minimum-data pharmacy events and rejects patient disclosure', async () => {
  const processor = new OutboxProcessor();
  const event = (payload: Record<string, unknown>) => ({
    eventId: orderId, eventType: PHARMACY_ORDER_CHANGED_EVENT_TYPE,
    eventVersion: 1, attempts: 1, payload,
  });
  assert.equal(await processor.process(event({
    pharmacy_order_id: orderId, previous_status: 'validated',
    status: 'stock_reserved', reason_code: null,
  }) as never), true);
  assert.equal(await processor.process(event({
    pharmacy_order_id: orderId, previous_status: null,
    status: 'rejected', reason_code: 'prescription_invalid',
  }) as never), true);
  // Neither patient identity nor medication may travel on the event bus.
  assert.equal(await processor.process(event({
    pharmacy_order_id: orderId, previous_status: 'validated', status: 'stock_reserved',
    reason_code: null, patient_profile_id: orderId,
  }) as never), false);
  assert.equal(await processor.process(event({
    pharmacy_order_id: orderId, previous_status: 'validated', status: 'stock_reserved',
    reason_code: 'Ran out of amoxicillin',
  }) as never), false);
});

test('migration derives balances from an append-only ledger and blocks oversell', () => {
  const migration = readFileSync(new URL(
    '../packages/database/drizzle/0024_pharmacy_and_inventory.sql', import.meta.url,
  ), 'utf8');
  // The load-bearing absence: no quantity column on a batch means no writer can
  // set a balance directly.
  assert.doesNotMatch(migration, /ALTER TABLE "inventory_batches" ADD COLUMN "quantity"/);
  assert.match(migration, /there is deliberately NO quantity column/);
  assert.match(migration, /stock_ledger_reject_mutation/);
  assert.match(migration, /stock_reservations_not_oversold/);
  assert.match(migration, /stock_ledger_not_oversold/);
  assert.match(migration, /smartcura_enforce_stock_not_oversold/);
  assert.match(migration, /posted - reserved < 0/);
  assert.match(migration, /active_quantity" integer GENERATED ALWAYS AS/);
  assert.match(migration, /inventory_batches_fefo_idx/);
  assert.match(migration, /stock_ledger_sign_check/);
  assert.match(migration, /controlled_substance_events_witness_check/);
  assert.match(migration, /stock_reconciliations_approval_check/);
  assert.match(migration, /controlled-substance authority must remain pharmacy-only/);
  assert.match(migration, /a patient must not hold inventory or validation authority/);
  assert.match(migration, /'identity', 16/);
});

test('reservation and dispatch run in serializable transactions that lock batches first', () => {
  const repository = readFileSync(new URL(
    '../packages/database/src/pharmacy-repository.ts', import.meta.url,
  ), 'utf8');
  // Both atomic boundaries must be serializable and retryable, not plain BEGIN.
  assert.equal(repository.match(/serializableTransaction/g)?.length, 2);
  // Candidate batches are locked in a deterministic order BEFORE availability is
  // read, so two reservers serialise instead of both seeing the same free quantity.
  assert.match(repository, /ORDER BY expires_on ASC, batch_id ASC FOR UPDATE/);
  assert.match(repository, /FOR UPDATE OF reservation/);
  // Availability is always derived, never read from a stored counter.
  assert.match(repository, /SUM\(quantity_delta\)/);
  assert.match(repository, /SUM\(active_quantity\)/);
  assert.doesNotMatch(repository, /SET quantity = quantity/);
});


test('medication catalogue schemas enforce controlled-substance and optimistic rules', () => {
  assert.equal(createMedicationSchema.safeParse({
    generic_name: 'Morphine', controlled_schedule: 'schedule_2',
    requires_prescription: false,
  }).success, false);
  assert.equal(createMedicationSchema.safeParse({
    generic_name: 'Paracetamol', atc_code: 'N02BE01',
    controlled_schedule: 'none', requires_prescription: false,
  }).success, true);
  assert.equal(updateMedicationSchema.safeParse({
    generic_name: 'Morphine', atc_code: null, controlled_schedule: 'schedule_2',
    requires_prescription: true, retired: false, expected_version: -1,
  }).success, false);
});

test('pharmacy order creation accepts quantities but rejects forged prices and duplicate variants', () => {
  const variant = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d01';
  const base = {
    site_id: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d02',
    prescription_id: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d03',
    items: [{ variant_id: variant, quantity: 2 }],
  };
  assert.equal(createPharmacyOrderSchema.safeParse(base).success, true);
  assert.equal(createPharmacyOrderSchema.safeParse({
    ...base, items: [{ ...base.items[0], unit_price_sen: 1 }],
  }).success, false);
  assert.equal(createPharmacyOrderSchema.safeParse({
    ...base, items: [base.items[0], base.items[0]],
  }).success, false);
  assert.equal(pharmacyOrderRequestHash(base), pharmacyOrderRequestHash(base));
});

test('new pharmacy representations are snake_case and 0034 preserves immutable stock design', () => {
  const now = new Date('2026-07-31T00:00:00.000Z');
  assert.deepEqual(serializeMedication({
    medicationId: orderId, genericName: 'Morphine', atcCode: null,
    controlledSchedule: 'schedule_2', requiresPrescription: true,
    retiredAt: null, version: 0, createdAt: now, updatedAt: now,
  }), {
    medication_id: orderId, generic_name: 'Morphine', atc_code: null,
    controlled_schedule: 'schedule_2', controlled_substance: true,
    requires_prescription: true, retired: false, version: 0,
    created_at: now.toISOString(), updated_at: now.toISOString(),
  });
  const order = serializePharmacyOrder({
    pharmacyOrderId: orderId,
    siteId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d01',
    patientProfileId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d02',
    prescriptionId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d03',
    status: 'awaiting_validation', version: 0, createdAt: now, updatedAt: now,
    items: [{ orderItemId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d04',
      variantId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d05', position: 1,
      quantity: 2, unitPriceSen: 0 }],
  });
  assert.equal(order['patientProfileId'], undefined);
  assert.equal((order['items'] as Record<string, unknown>[])[0]?.['currency'], 'MYR');
  const migration = readFileSync(new URL(
    '../packages/database/drizzle/0034_stage8_stage9_api_surfaces.sql', import.meta.url,
  ), 'utf8');
  assert.match(migration, /pharmacy_orders_prescription_uq/);
  assert.match(migration, /pharmacy\.order:create:own/);
  assert.doesNotMatch(migration, /inventory_batches" ADD COLUMN "quantity/);
});
