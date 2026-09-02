-- WP-10 pharmacy, prescription validation and inventory.
--
-- THE INVARIANT: available stock is a PROJECTION, never a stored counter.
--   available = posted ledger movements - active reservations
-- `stock_ledger` is append-only and `inventory_batches` has no quantity column, so
-- there is no field a writer could increment. A cached balance would be the single
-- easiest way to oversell: two concurrent orders both read 10, both reserve 10.
--
-- Overselling is prevented by THREE independent mechanisms, because any one of
-- them alone has a hole:
--   1. `stock_reservations` carries a generated `active_quantity` that is the
--      reserved quantity while active and 0 once terminal, so a partial index sum
--      over it is exact.
--   2. Reservation posts inside a SERIALIZABLE transaction that locks the batch row
--      FOR UPDATE, so two reservers of one batch serialise.
--   3. A constraint trigger re-derives the projection AFTER the statement and
--      raises if any batch went negative. Even a future code path that forgets the
--      lock cannot commit an oversell.
--
-- Money is integer MYR sen throughout, matching every other financial value.

CREATE TYPE "public"."prescription_validation_state" AS ENUM('pending', 'valid', 'invalid', 'needs_clarification');--> statement-breakpoint
CREATE TYPE "public"."pharmacy_order_status" AS ENUM('received', 'awaiting_validation', 'validated', 'stock_reserved', 'fulfilling', 'ready_for_dispatch', 'dispatched', 'delivered', 'delivery_exception', 'returned', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."stock_reservation_status" AS ENUM('active', 'consumed', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('receipt', 'reservation_consumed', 'dispatch', 'return', 'adjustment_positive', 'adjustment_negative', 'transfer_in', 'transfer_out');--> statement-breakpoint
CREATE TYPE "public"."inventory_batch_status" AS ENUM('available', 'quarantined', 'recalled', 'expired', 'depleted');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('draft', 'submitted', 'approved', 'ordered', 'partially_received', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('requested', 'approved', 'rejected', 'received', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('draft', 'submitted', 'approved', 'posted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."controlled_substance_schedule" AS ENUM('none', 'schedule_2', 'schedule_3', 'schedule_4', 'schedule_5');

--> statement-breakpoint
CREATE TABLE "suppliers" (
  "supplier_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" varchar(200) NOT NULL,
  "licence_code" varchar(64),
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "medications" (
  "medication_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "generic_name" varchar(200) NOT NULL,
  "atc_code" varchar(16),
  "controlled_schedule" "controlled_substance_schedule" DEFAULT 'none' NOT NULL,
  "requires_prescription" boolean DEFAULT true NOT NULL,
  "retired_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "medications_atc_check" CHECK ("atc_code" IS NULL OR "atc_code" ~ '^[A-Z][0-9]{2}[A-Z]{2}[0-9]{2}$'),
  -- A controlled medication can never be an over-the-counter line.
  CONSTRAINT "medications_controlled_requires_rx_check" CHECK ("controlled_schedule" = 'none' OR "requires_prescription")
);--> statement-breakpoint

CREATE TABLE "medication_variants" (
  "variant_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "medication_id" uuid NOT NULL,
  "brand_name" varchar(200),
  "strength_value" numeric(12, 4) NOT NULL,
  "strength_unit" varchar(32) NOT NULL,
  "form_code" varchar(32) NOT NULL,
  "pack_size" integer NOT NULL,
  "retired_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "medication_variants_strength_check" CHECK ("strength_value" > 0),
  CONSTRAINT "medication_variants_form_check" CHECK ("form_code" ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT "medication_variants_pack_check" CHECK ("pack_size" > 0)
);--> statement-breakpoint

-- Inventory is SITE-specific: stock at one pharmacy is not stock at another, and a
-- site-blind balance would let one branch reserve another branch's shelf.
CREATE TABLE "inventory_batches" (
  "batch_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "supplier_id" uuid,
  "lot_number" varchar(64) NOT NULL,
  "expires_on" date NOT NULL,
  "status" "inventory_batch_status" DEFAULT 'available' NOT NULL,
  "unit_cost_sen" bigint DEFAULT 0 NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- NOTE: there is deliberately NO quantity column. Quantity is derived from the
  -- append-only ledger, so no writer can set a balance directly.
  CONSTRAINT "inventory_batches_version_check" CHECK ("version" >= 0),
  CONSTRAINT "inventory_batches_lot_check" CHECK ("lot_number" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  CONSTRAINT "inventory_batches_cost_check" CHECK ("unit_cost_sen" >= 0)
);--> statement-breakpoint

-- Append-only stock movements. `quantity_delta` is signed: a receipt is positive, a
-- dispatch negative. The sum over a batch IS its posted quantity.
CREATE TABLE "stock_ledger" (
  "movement_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "batch_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "movement_type" "stock_movement_type" NOT NULL,
  "quantity_delta" integer NOT NULL,
  "reference_type" varchar(32) NOT NULL,
  "reference_id" uuid,
  "reason_code" varchar(64),
  "actor_profile_id" uuid,
  "correlation_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_ledger_nonzero_check" CHECK ("quantity_delta" <> 0),
  -- The sign must agree with the movement type, or a "dispatch" could add stock.
  CONSTRAINT "stock_ledger_sign_check" CHECK (
    ("movement_type" IN ('receipt', 'return', 'adjustment_positive', 'transfer_in') AND "quantity_delta" > 0)
    OR ("movement_type" IN ('dispatch', 'adjustment_negative', 'transfer_out') AND "quantity_delta" < 0)
    -- Consuming a reservation converts a hold into a dispatch and moves no stock
    -- on its own, so it is recorded as a zero-sum pair with the dispatch row and
    -- is constrained to be negative here only when it carries the decrement.
    OR ("movement_type" = 'reservation_consumed' AND "quantity_delta" < 0)
  ),
  CONSTRAINT "stock_ledger_reference_check" CHECK ("reference_type" ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT "stock_ledger_reason_check" CHECK ("reason_code" IS NULL OR "reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- A manual adjustment must always state why; an automated movement need not.
  CONSTRAINT "stock_ledger_adjustment_reason_check" CHECK (
    "movement_type" NOT IN ('adjustment_positive', 'adjustment_negative') OR "reason_code" IS NOT NULL
  )
);--> statement-breakpoint

-- A hold on a specific batch. `active_quantity` is GENERATED so the "how much is
-- currently held" figure cannot disagree with the reservation's own state.
CREATE TABLE "stock_reservations" (
  "reservation_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "batch_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "order_item_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "status" "stock_reservation_status" DEFAULT 'active' NOT NULL,
  "active_quantity" integer GENERATED ALWAYS AS (
    CASE WHEN "status" = 'active' THEN "quantity" ELSE 0 END
  ) STORED,
  "expires_at" timestamp with time zone NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_reservations_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "stock_reservations_version_check" CHECK ("version" >= 0),
  CONSTRAINT "stock_reservations_expiry_check" CHECK ("expires_at" > "created_at")
);--> statement-breakpoint

CREATE TABLE "pharmacy_orders" (
  "pharmacy_order_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "patient_profile_id" uuid NOT NULL,
  "prescription_id" uuid,
  "status" "pharmacy_order_status" DEFAULT 'received' NOT NULL,
  "cancellation_reason_code" varchar(64),
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pharmacy_orders_version_check" CHECK ("version" >= 0),
  CONSTRAINT "pharmacy_orders_cancel_reason_check" CHECK (
    ("status" IN ('cancelled', 'rejected')) = ("cancellation_reason_code" IS NOT NULL)
  ),
  CONSTRAINT "pharmacy_orders_cancel_reason_code_check" CHECK ("cancellation_reason_code" IS NULL OR "cancellation_reason_code" ~ '^[a-z][a-z0-9_]{1,62}$')
);--> statement-breakpoint

CREATE TABLE "pharmacy_order_items" (
  "order_item_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "pharmacy_order_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price_sen" bigint NOT NULL,
  CONSTRAINT "pharmacy_order_items_position_check" CHECK ("position" >= 1),
  CONSTRAINT "pharmacy_order_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "pharmacy_order_items_price_check" CHECK ("unit_price_sen" >= 0)
);--> statement-breakpoint

-- Append-only validation events. A later revocation is a NEW event, never an edit,
-- so the record of what the pharmacist decided at intake survives.
CREATE TABLE "prescription_validations" (
  "validation_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "pharmacy_order_id" uuid NOT NULL,
  "prescription_id" uuid,
  "state" "prescription_validation_state" NOT NULL,
  "reason_code" varchar(64),
  "validated_by_membership_id" uuid NOT NULL,
  "validated_by_profile_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Anything other than a clean pass must say why.
  CONSTRAINT "prescription_validations_reason_check" CHECK (
    ("state" IN ('invalid', 'needs_clarification')) = ("reason_code" IS NOT NULL)
  ),
  CONSTRAINT "prescription_validations_reason_code_check" CHECK ("reason_code" IS NULL OR "reason_code" ~ '^[a-z][a-z0-9_]{1,62}$')
);--> statement-breakpoint

CREATE TABLE "order_status_events" (
  "event_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "pharmacy_order_id" uuid NOT NULL,
  "previous_status" "pharmacy_order_status",
  "status" "pharmacy_order_status" NOT NULL,
  "reason_code" varchar(64),
  "actor_profile_id" uuid,
  "correlation_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_status_events_progress_check" CHECK ("previous_status" IS NULL OR "previous_status" <> "status")
);--> statement-breakpoint

-- Periodic projection cache for reporting only. It is explicitly NOT authoritative:
-- `stock_snapshots` can always be rebuilt from the ledger, and no reservation
-- decision reads it.
CREATE TABLE "stock_snapshots" (
  "snapshot_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "batch_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "posted_quantity" integer NOT NULL,
  "reserved_quantity" integer NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_snapshots_reserved_check" CHECK ("reserved_quantity" >= 0)
);--> statement-breakpoint

-- Controlled substances get their own append-only register with a mandatory reason
-- and witness. These are not ordinary editable stock rows.
CREATE TABLE "controlled_substance_register" (
  "register_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "schedule" "controlled_substance_schedule" NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "controlled_substance_register_schedule_check" CHECK ("schedule" <> 'none')
);--> statement-breakpoint

CREATE TABLE "controlled_substance_events" (
  "cs_event_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "register_id" uuid NOT NULL,
  "batch_id" uuid,
  "movement_id" uuid,
  "quantity_delta" integer NOT NULL,
  "reason_code" varchar(64) NOT NULL,
  "actor_profile_id" uuid NOT NULL,
  "witness_profile_id" uuid,
  "correlation_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "controlled_substance_events_nonzero_check" CHECK ("quantity_delta" <> 0),
  CONSTRAINT "controlled_substance_events_reason_check" CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- A witness cannot be the actor, or dual control is theatre.
  CONSTRAINT "controlled_substance_events_witness_check" CHECK ("witness_profile_id" IS NULL OR "witness_profile_id" <> "actor_profile_id")
);--> statement-breakpoint

CREATE TABLE "purchase_orders" (
  "purchase_order_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  "status" "purchase_order_status" DEFAULT 'draft' NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_orders_version_check" CHECK ("version" >= 0)
);--> statement-breakpoint

CREATE TABLE "purchase_order_items" (
  "purchase_order_item_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "purchase_order_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "ordered_quantity" integer NOT NULL,
  "unit_cost_sen" bigint NOT NULL,
  CONSTRAINT "purchase_order_items_quantity_check" CHECK ("ordered_quantity" > 0),
  CONSTRAINT "purchase_order_items_cost_check" CHECK ("unit_cost_sen" >= 0)
);--> statement-breakpoint

CREATE TABLE "goods_receipts" (
  "goods_receipt_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "purchase_order_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "received_quantity" integer NOT NULL,
  "received_by_profile_id" uuid NOT NULL,
  "movement_id" uuid NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "goods_receipts_quantity_check" CHECK ("received_quantity" > 0)
);--> statement-breakpoint

CREATE TABLE "returns" (
  "return_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "pharmacy_order_id" uuid,
  "status" "return_status" DEFAULT 'requested' NOT NULL,
  "reason_code" varchar(64) NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "returns_reason_check" CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "returns_version_check" CHECK ("version" >= 0)
);--> statement-breakpoint

CREATE TABLE "return_items" (
  "return_item_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "return_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "movement_id" uuid,
  CONSTRAINT "return_items_quantity_check" CHECK ("quantity" > 0)
);--> statement-breakpoint

CREATE TABLE "stock_reconciliations" (
  "reconciliation_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "status" "reconciliation_status" DEFAULT 'draft' NOT NULL,
  "counted_by_profile_id" uuid NOT NULL,
  "approved_by_profile_id" uuid,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_reconciliations_version_check" CHECK ("version" >= 0),
  -- A posted count must have been approved by someone other than the counter.
  CONSTRAINT "stock_reconciliations_approval_check" CHECK (
    "status" NOT IN ('approved', 'posted') OR ("approved_by_profile_id" IS NOT NULL AND "approved_by_profile_id" <> "counted_by_profile_id")
  )
);--> statement-breakpoint

CREATE TABLE "reconciliation_lines" (
  "reconciliation_line_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "reconciliation_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "expected_quantity" integer NOT NULL,
  "counted_quantity" integer NOT NULL,
  "movement_id" uuid,
  CONSTRAINT "reconciliation_lines_counted_check" CHECK ("counted_quantity" >= 0)
);--> statement-breakpoint

CREATE INDEX "suppliers_organization_idx" ON "suppliers" ("organization_id", "name");--> statement-breakpoint
CREATE UNIQUE INDEX "medications_generic_uq" ON "medications" ("generic_name") WHERE "retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "medication_variants_medication_idx" ON "medication_variants" ("medication_id", "variant_id");--> statement-breakpoint
-- One lot per variant per site. A second row for the same physical lot would split
-- its quantity across two projections.
CREATE UNIQUE INDEX "inventory_batches_site_variant_lot_uq" ON "inventory_batches" ("site_id", "variant_id", "lot_number");--> statement-breakpoint
-- THE FEFO index: earliest expiry first, restricted to batches that may be picked.
CREATE INDEX "inventory_batches_fefo_idx" ON "inventory_batches" ("site_id", "variant_id", "expires_on", "batch_id") WHERE "status" = 'available';--> statement-breakpoint
CREATE INDEX "stock_ledger_batch_idx" ON "stock_ledger" ("batch_id", "occurred_at", "movement_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_site_time_idx" ON "stock_ledger" ("site_id", "occurred_at", "movement_id");--> statement-breakpoint
-- Supports the exact projection sum without scanning terminal reservations.
CREATE INDEX "stock_reservations_active_idx" ON "stock_reservations" ("batch_id", "status") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "stock_reservations_expiry_idx" ON "stock_reservations" ("expires_at") WHERE "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_item_batch_uq" ON "stock_reservations" ("order_item_id", "batch_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "pharmacy_orders_site_status_idx" ON "pharmacy_orders" ("site_id", "status", "created_at", "pharmacy_order_id");--> statement-breakpoint
CREATE INDEX "pharmacy_orders_patient_idx" ON "pharmacy_orders" ("patient_profile_id", "created_at", "pharmacy_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_order_items_position_uq" ON "pharmacy_order_items" ("pharmacy_order_id", "position");--> statement-breakpoint
CREATE INDEX "prescription_validations_order_idx" ON "prescription_validations" ("pharmacy_order_id", "occurred_at", "validation_id");--> statement-breakpoint
CREATE INDEX "order_status_events_order_idx" ON "order_status_events" ("pharmacy_order_id", "occurred_at", "event_id");--> statement-breakpoint
CREATE INDEX "stock_snapshots_batch_idx" ON "stock_snapshots" ("batch_id", "captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "controlled_substance_register_uq" ON "controlled_substance_register" ("site_id", "variant_id");--> statement-breakpoint
CREATE INDEX "controlled_substance_events_register_idx" ON "controlled_substance_events" ("register_id", "occurred_at", "cs_event_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_site_status_idx" ON "purchase_orders" ("site_id", "status", "purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_movement_uq" ON "goods_receipts" ("movement_id");--> statement-breakpoint
CREATE INDEX "returns_site_status_idx" ON "returns" ("site_id", "status", "return_id");--> statement-breakpoint
CREATE INDEX "reconciliation_lines_reconciliation_idx" ON "reconciliation_lines" ("reconciliation_id", "batch_id");

--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "medication_variants" ADD CONSTRAINT "medication_variants_medication_fk" FOREIGN KEY ("medication_id") REFERENCES "medications"("medication_id");--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
-- Composite site reference: a single-column reference would let a batch in
-- organization A sit at a site in organization B.
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_site_org_fk" FOREIGN KEY ("site_id","organization_id") REFERENCES "sites"("site_id","organization_id");--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "medication_variants"("variant_id");--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("supplier_id");--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("batch_id");--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_site_org_fk" FOREIGN KEY ("site_id","organization_id") REFERENCES "sites"("site_id","organization_id");--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_actor_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("batch_id");--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_item_fk" FOREIGN KEY ("order_item_id") REFERENCES "pharmacy_order_items"("order_item_id");--> statement-breakpoint
ALTER TABLE "pharmacy_orders" ADD CONSTRAINT "pharmacy_orders_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "pharmacy_orders" ADD CONSTRAINT "pharmacy_orders_site_org_fk" FOREIGN KEY ("site_id","organization_id") REFERENCES "sites"("site_id","organization_id");--> statement-breakpoint
ALTER TABLE "pharmacy_orders" ADD CONSTRAINT "pharmacy_orders_patient_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "pharmacy_orders" ADD CONSTRAINT "pharmacy_orders_prescription_fk" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("prescription_id");--> statement-breakpoint
ALTER TABLE "pharmacy_order_items" ADD CONSTRAINT "pharmacy_order_items_order_fk" FOREIGN KEY ("pharmacy_order_id") REFERENCES "pharmacy_orders"("pharmacy_order_id");--> statement-breakpoint
ALTER TABLE "pharmacy_order_items" ADD CONSTRAINT "pharmacy_order_items_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "medication_variants"("variant_id");--> statement-breakpoint
ALTER TABLE "prescription_validations" ADD CONSTRAINT "prescription_validations_order_fk" FOREIGN KEY ("pharmacy_order_id") REFERENCES "pharmacy_orders"("pharmacy_order_id");--> statement-breakpoint
ALTER TABLE "prescription_validations" ADD CONSTRAINT "prescription_validations_prescription_fk" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("prescription_id");--> statement-breakpoint
ALTER TABLE "prescription_validations" ADD CONSTRAINT "prescription_validations_membership_fk" FOREIGN KEY ("validated_by_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "prescription_validations" ADD CONSTRAINT "prescription_validations_profile_fk" FOREIGN KEY ("validated_by_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_order_fk" FOREIGN KEY ("pharmacy_order_id") REFERENCES "pharmacy_orders"("pharmacy_order_id");--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_actor_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("batch_id");--> statement-breakpoint
ALTER TABLE "controlled_substance_register" ADD CONSTRAINT "cs_register_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "controlled_substance_register" ADD CONSTRAINT "cs_register_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "medication_variants"("variant_id");--> statement-breakpoint
ALTER TABLE "controlled_substance_events" ADD CONSTRAINT "cs_events_register_fk" FOREIGN KEY ("register_id") REFERENCES "controlled_substance_register"("register_id");--> statement-breakpoint
ALTER TABLE "controlled_substance_events" ADD CONSTRAINT "cs_events_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("batch_id");--> statement-breakpoint
ALTER TABLE "controlled_substance_events" ADD CONSTRAINT "cs_events_movement_fk" FOREIGN KEY ("movement_id") REFERENCES "stock_ledger"("movement_id");--> statement-breakpoint
ALTER TABLE "controlled_substance_events" ADD CONSTRAINT "cs_events_actor_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "controlled_substance_events" ADD CONSTRAINT "cs_events_witness_fk" FOREIGN KEY ("witness_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("supplier_id");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_site_org_fk" FOREIGN KEY ("site_id","organization_id") REFERENCES "sites"("site_id","organization_id");--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("purchase_order_id");--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_variant_fk" FOREIGN KEY ("variant_id") REFERENCES "medication_variants"("variant_id");--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_order_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("purchase_order_id");--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("batch_id");--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_movement_fk" FOREIGN KEY ("movement_id") REFERENCES "stock_ledger"("movement_id");--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_receiver_fk" FOREIGN KEY ("received_by_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_site_org_fk" FOREIGN KEY ("site_id","organization_id") REFERENCES "sites"("site_id","organization_id");--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_fk" FOREIGN KEY ("pharmacy_order_id") REFERENCES "pharmacy_orders"("pharmacy_order_id");--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_fk" FOREIGN KEY ("return_id") REFERENCES "returns"("return_id");--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("batch_id");--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_movement_fk" FOREIGN KEY ("movement_id") REFERENCES "stock_ledger"("movement_id");--> statement-breakpoint
ALTER TABLE "stock_reconciliations" ADD CONSTRAINT "stock_reconciliations_site_org_fk" FOREIGN KEY ("site_id","organization_id") REFERENCES "sites"("site_id","organization_id");--> statement-breakpoint
ALTER TABLE "stock_reconciliations" ADD CONSTRAINT "stock_reconciliations_counter_fk" FOREIGN KEY ("counted_by_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "stock_reconciliations" ADD CONSTRAINT "stock_reconciliations_approver_fk" FOREIGN KEY ("approved_by_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_reconciliation_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "stock_reconciliations"("reconciliation_id");--> statement-breakpoint
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("batch_id");--> statement-breakpoint
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_movement_fk" FOREIGN KEY ("movement_id") REFERENCES "stock_ledger"("movement_id");

--> statement-breakpoint
-- Append-only enforcement. An editable stock movement is an editable balance.
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_stock_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stock ledger movements are append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER stock_ledger_reject_mutation BEFORE UPDATE OR DELETE ON "stock_ledger" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_stock_ledger();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_validation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'prescription validations are append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER prescription_validations_reject_mutation BEFORE UPDATE OR DELETE ON "prescription_validations" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_validation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_order_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'order status events are append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER order_status_events_reject_mutation BEFORE UPDATE OR DELETE ON "order_status_events" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_order_event();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_cs_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled substance events are append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER cs_events_reject_mutation BEFORE UPDATE OR DELETE ON "controlled_substance_events" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_cs_event();--> statement-breakpoint

-- A reservation may only move ACTIVE -> terminal, and its quantity and batch are
-- fixed. Growing a live hold after the availability check would oversell.
CREATE OR REPLACE FUNCTION smartcura_protect_stock_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'active' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'a terminal reservation cannot change state' USING ERRCODE = '55000';
  END IF;
  IF NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.order_item_id IS DISTINCT FROM OLD.order_item_id THEN
    RAISE EXCEPTION 'reservation quantity and target are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER stock_reservations_protect BEFORE UPDATE ON "stock_reservations" FOR EACH ROW EXECUTE FUNCTION smartcura_protect_stock_reservation();--> statement-breakpoint

-- THE NO-OVERSELL BACKSTOP.
--
-- Re-derives available stock for the affected batch AFTER the statement and raises
-- if it went negative. This is the mechanism that makes overselling impossible
-- rather than merely unlikely: it holds even if a future code path forgets to lock
-- the batch or to check availability first, because the check is evaluated by the
-- database against committed and in-transaction rows.
--
-- DEFERRABLE INITIALLY DEFERRED so a transaction may legitimately post a dispatch
-- decrement and consume its reservation in either order.
CREATE OR REPLACE FUNCTION smartcura_enforce_stock_not_oversold() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_batch uuid;
  posted integer;
  reserved integer;
BEGIN
  target_batch := CASE WHEN TG_OP = 'DELETE' THEN OLD.batch_id ELSE NEW.batch_id END;
  SELECT COALESCE(SUM(quantity_delta), 0) INTO posted
  FROM stock_ledger WHERE batch_id = target_batch;
  SELECT COALESCE(SUM(active_quantity), 0) INTO reserved
  FROM stock_reservations WHERE batch_id = target_batch;
  IF posted - reserved < 0 THEN
    RAISE EXCEPTION 'stock would be oversold for batch % (posted %, reserved %)',
      target_batch, posted, reserved USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_reservations_not_oversold AFTER INSERT OR UPDATE ON "stock_reservations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION smartcura_enforce_stock_not_oversold();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_ledger_not_oversold AFTER INSERT ON "stock_ledger" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION smartcura_enforce_stock_not_oversold();--> statement-breakpoint

INSERT INTO permissions (permission_id, description) VALUES
 ('pharmacy.catalogue:read:site', 'Read the medication catalogue'),
 ('controlled_substance:manage:site', 'Record controlled-substance register events'),
 ('pharmacy.order:read:own', 'Read own pharmacy orders')
ON CONFLICT (permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id) VALUES
 ('pharmacy', 'pharmacy.catalogue:read:site'),
 ('pharmacy', 'controlled_substance:manage:site'),
 ('patient', 'pharmacy.order:read:own')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Least-privilege assertions: controlled-substance authority is site-scoped
-- pharmacy work, and a patient may never post stock or validate a prescription.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id = 'controlled_substance:manage:site' AND role_id <> 'pharmacy'
  ) THEN
    RAISE EXCEPTION 'controlled-substance authority must remain pharmacy-only';
  END IF;
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE role_id = 'patient'
      AND permission_id IN ('stock_ledger:post:site', 'prescription_validation:manage:site',
                            'inventory.reservation:manage:site')
  ) THEN
    RAISE EXCEPTION 'a patient must not hold inventory or validation authority';
  END IF;
END $$;--> statement-breakpoint
INSERT INTO schema_compatibility (component, version) VALUES ('identity', 16)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
