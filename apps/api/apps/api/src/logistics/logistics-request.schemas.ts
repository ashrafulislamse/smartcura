import { z } from 'zod';

const uuidV7 = z.string().uuid()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const reasonCode = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const expectedVersion = z.number().int().min(0);

/**
 * Validation and reservation are ONE command, matching atomic boundary 4: the
 * validation outcome and either FEFO reservations or a reasoned failure commit
 * together. A client cannot request reservation without recording a validation.
 */
export const validatePharmacyOrderSchema = z.object({
  state: z.enum(['valid', 'invalid', 'needs_clarification']),
  reason_code: reasonCode.nullable().default(null),
  expected_version: expectedVersion,
}).strict().superRefine((value, context) => {
  // Anything other than a clean pass must say why, mirroring the database CHECK so
  // the API refuses before the constraint has to.
  if (value.state !== 'valid' && value.reason_code === null) {
    context.addIssue({
      code: 'custom', path: ['reason_code'],
      message: 'A non-valid validation outcome requires a reason code',
    });
  }
  if (value.state === 'valid' && value.reason_code !== null) {
    context.addIssue({
      code: 'custom', path: ['reason_code'],
      message: 'A valid validation outcome carries no reason code',
    });
  }
});

export const dispatchPharmacyOrderSchema = z.object({
  expected_version: expectedVersion,
}).strict();

/**
 * Fulfilment progress. Reservation and dispatch are deliberately NOT reachable
 * here: each is its own atomic boundary with its own command.
 */
export const transitionPharmacyOrderSchema = z.object({
  status: z.enum(['fulfilling', 'ready_for_dispatch', 'cancelled']),
  reason_code: reasonCode.nullable().default(null),
  expected_version: expectedVersion,
}).strict().superRefine((value, context) => {
  if (value.status === 'cancelled' && value.reason_code === null) {
    context.addIssue({
      code: 'custom', path: ['reason_code'],
      message: 'Cancelling an order requires a reason code',
    });
  }
  if (value.status !== 'cancelled' && value.reason_code !== null) {
    context.addIssue({
      code: 'custom', path: ['reason_code'],
      message: 'Only cancellation carries a reason code',
    });
  }
});

export const inventoryAvailabilityQuerySchema = z.object({
  variant_id: uuidV7,
}).strict();

export const acceptDispatchOfferSchema = z.object({
  vehicle_id: uuidV7.nullable().default(null),
  expected_version: expectedVersion,
}).strict();

export const advanceAssignmentSchema = z.object({
  status: z.enum([
    'en_route_pickup', 'arrived_pickup', 'picked_up',
    'en_route_dropoff', 'arrived_dropoff', 'completed', 'cancelled', 'failed',
  ]),
  reason_code: reasonCode.nullable().default(null),
  expected_version: expectedVersion,
}).strict().superRefine((value, context) => {
  const terminatesEarly = value.status === 'cancelled' || value.status === 'failed';
  if (terminatesEarly && value.reason_code === null) {
    context.addIssue({
      code: 'custom', path: ['reason_code'],
      message: 'Cancelling or failing an assignment requires a reason code',
    });
  }
  if (!terminatesEarly && value.reason_code !== null) {
    context.addIssue({
      code: 'custom', path: ['reason_code'],
      message: 'Only cancellation or failure carries a reason code',
    });
  }
});

/**
 * A reported waypoint. `recorded_at` is the DEVICE clock and is accepted, but the
 * server stamps `received_at` itself, so a client cannot backdate its arrival.
 */
export const recordWaypointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy_metres: z.number().int().min(0).max(100_000).nullable().default(null),
  significant: z.boolean().default(false),
  recorded_at: z.string().datetime({ offset: true }),
}).strict();

export type ValidatePharmacyOrderRequest = z.infer<typeof validatePharmacyOrderSchema>;
export type DispatchPharmacyOrderRequest = z.infer<typeof dispatchPharmacyOrderSchema>;
export type AcceptDispatchOfferRequest = z.infer<typeof acceptDispatchOfferSchema>;
export type AdvanceAssignmentRequest = z.infer<typeof advanceAssignmentSchema>;
export type RecordWaypointRequest = z.infer<typeof recordWaypointSchema>;

/**
 * A payout bank account. The full number is accepted once, hashed, and never returned; only the
 * last four digits are retained in clear, matching the column design.
 */
export const registerBankAccountSchema = z.object({
  bank_code: z.string().regex(/^[A-Z0-9]{3,32}$/),
  account_number: z.string().regex(/^[0-9]{6,20}$/),
}).strict();

export const requestWithdrawalSchema = z.object({
  bank_account_id: uuidV7,
  amount_sen: z.number().int().min(100).max(100_000_000),
}).strict();

export const advanceWithdrawalSchema = z.object({
  status: z.enum(['under_review', 'approved', 'processing', 'paid', 'failed', 'rejected', 'cancelled']),
  reason_code: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/).nullable().default(null),
  // Required only when settling, and validated there rather than made mandatory for every step.
  payable_account_id: uuidV7.nullable().default(null),
  cash_account_id: uuidV7.nullable().default(null),
  expected_version: z.number().int().min(0),
}).strict().refine(
  // Mirrors the database CHECK: a refusal or a bank failure must say why, and nothing else may.
  (value) => (['rejected', 'cancelled', 'failed'].includes(value.status)
    ? value.reason_code !== null : value.reason_code === null),
  { message: 'a rejected, cancelled or failed outcome requires a reason code, and only those may carry one' },
).refine(
  (value) => (value.status === 'paid'
    ? value.payable_account_id !== null && value.cash_account_id !== null
      && value.payable_account_id !== value.cash_account_id
    : true),
  { message: 'settlement requires two different ledger accounts' },
);


const controlledSchedule = z.enum([
  'none', 'schedule_2', 'schedule_3', 'schedule_4', 'schedule_5',
]);
const atcCode = z.string().regex(/^[A-Z][0-9]{2}[A-Z]{2}[0-9]{2}$/).nullable();

export const listMedicationsQuerySchema = z.object({
  page_size: z.coerce.number().int().min(1).max(100).default(25),
  include_retired: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
}).strict();

export const createMedicationSchema = z.object({
  generic_name: z.string().trim().min(2).max(200),
  atc_code: atcCode.default(null),
  controlled_schedule: controlledSchedule.default('none'),
  requires_prescription: z.boolean().default(true),
}).strict().superRefine((value, context) => {
  if (value.controlled_schedule !== 'none' && !value.requires_prescription) {
    context.addIssue({
      code: 'custom', path: ['requires_prescription'],
      message: 'A controlled medication must require a prescription',
    });
  }
});

export const updateMedicationSchema = createMedicationSchema.extend({
  retired: z.boolean().default(false),
  expected_version: expectedVersion,
}).strict();

export const listInventoryBatchesQuerySchema = z.object({
  variant_id: uuidV7.optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const listStockMovementsQuerySchema = z.object({
  batch_id: uuidV7.optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

const pharmacyOrderItem = z.object({
  variant_id: uuidV7,
  quantity: z.number().int().min(1).max(10_000),
}).strict();

export const createPharmacyOrderSchema = z.object({
  site_id: uuidV7,
  prescription_id: uuidV7,
  items: z.array(pharmacyOrderItem).min(1).max(100),
}).strict().superRefine((value, context) => {
  const variants = value.items.map((item) => item.variant_id);
  if (new Set(variants).size !== variants.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Variant ids must be unique' });
  }
});

export const listPharmacyOrdersQuerySchema = z.object({
  site_id: uuidV7.optional(),
  status: z.enum([
    'received', 'awaiting_validation', 'validated', 'stock_reserved', 'fulfilling',
    'ready_for_dispatch', 'dispatched', 'delivered', 'delivery_exception', 'returned',
    'rejected', 'cancelled',
  ]).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const createVehicleSchema = z.object({
  plate_number: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9 -]{1,15}$/),
  vehicle_type: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
}).strict();

export const updateVehicleSchema = createVehicleSchema.extend({
  active: z.boolean(),
  expected_version: expectedVersion,
}).strict();

export const createDeliveryRatingSchema = z.object({
  stars: z.number().int().min(1).max(5),
}).strict();

export const listDriverRatingsQuerySchema = z.object({
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

/**
 * Which slice of a driver's own assignments to list. `active` (the default) is the
 * work still owed; `completed` is the history; `all` is both. Cancelled and failed
 * assignments are never returned by this view.
 */
export const listDriverAssignmentsQuerySchema = z.object({
  status: z.enum(['active', 'completed', 'all']).default('active'),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
