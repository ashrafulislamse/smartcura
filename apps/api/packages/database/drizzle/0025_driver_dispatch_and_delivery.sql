-- WP-11 driver verification, generic dispatch, delivery proof and earnings.
--
-- TWO invariants carry this slice, and both are enforced by the database:
--
--   1. ONE ACCEPTED OFFER PER JOB. A partial unique index on accepted offers means
--      two drivers racing to accept the same job cannot both win, whatever the
--      application does. The loser gets a constraint violation, not a shared job.
--   2. NO OVERLAPPING ACTIVE ASSIGNMENTS PER DRIVER. A partial unique index on
--      active assignments per driver enforces it. An application check cannot:
--      two concurrent accepts would each read the other as absent.
--
-- MINIMUM-NECESSARY DISCLOSURE is structural too. Recipient name, phone and exact
-- address live on `deliveries`, never on `dispatch_offers`, so an offer row simply
-- has no column that could leak them. A driver shopping for offers cannot harvest
-- patient contact details even if a serializer were wrong.
--
-- PostGIS DEFERRED, deliberately. The design of record selects PostGIS, but the
-- pinned `postgres:18.4-alpine3.23` image does not ship it and `CREATE EXTENSION
-- postgis` would fail the already-verified WP-02L migration gate. Coordinates are
-- stored as bounded `numeric` latitude/longitude, which is complete and correct
-- data; route history and waypoint throttling — the things this work package
-- actually needs — are served by a btree index. Only nearest-driver proximity
-- matching genuinely requires a spatial index, and that is a later optimisation,
-- not a gate requirement.

CREATE TYPE "public"."driver_availability_status" AS ENUM('offline', 'available', 'busy', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."dispatch_job_status" AS ENUM('pending', 'offering', 'assigned', 'in_progress', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."dispatch_offer_status" AS ENUM('pending', 'accepted', 'declined', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."dispatch_assignment_status" AS ENUM('assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."dispatch_stop_kind" AS ENUM('pickup', 'dropoff');--> statement-breakpoint
CREATE TYPE "public"."pharmacy_delivery_status" AS ENUM('awaiting_dispatch', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."proof_kind" AS ENUM('signature', 'photo', 'code');--> statement-breakpoint
CREATE TYPE "public"."driver_earning_type" AS ENUM('delivery_fee', 'bonus', 'adjustment_positive', 'adjustment_negative');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('requested', 'approved', 'paid', 'rejected', 'cancelled');

--> statement-breakpoint
CREATE TABLE "drivers" (
  "driver_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "membership_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "availability" "driver_availability_status" DEFAULT 'offline' NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "drivers_version_check" CHECK ("version" >= 0)
);--> statement-breakpoint

CREATE TABLE "vehicles" (
  "vehicle_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "driver_id" uuid NOT NULL,
  "plate_number" varchar(16) NOT NULL,
  "vehicle_type" varchar(32) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vehicles_plate_check" CHECK ("plate_number" ~ '^[A-Z0-9][A-Z0-9 -]{1,15}$'),
  CONSTRAINT "vehicles_type_check" CHECK ("vehicle_type" ~ '^[a-z][a-z0-9_]{1,31}$')
);--> statement-breakpoint

CREATE TABLE "driver_bank_accounts" (
  "bank_account_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "driver_id" uuid NOT NULL,
  "bank_code" varchar(32) NOT NULL,
  -- Only the last four digits are retained in clear. A full account number is a
  -- payment credential, so the verified value is held as a digest.
  "account_last4" char(4) NOT NULL,
  "account_hash" varchar(64) NOT NULL,
  "verified_at" timestamp with time zone,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "driver_bank_accounts_last4_check" CHECK ("account_last4" ~ '^[0-9]{4}$'),
  CONSTRAINT "driver_bank_accounts_hash_check" CHECK ("account_hash" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint

-- Generic dispatch job. Pharmacy delivery and emergency response SHARE these
-- mechanics but stay separate aggregates, so `reference_type` names the owner
-- rather than the job carrying pharmacy or emergency columns directly.
CREATE TABLE "dispatch_jobs" (
  "dispatch_job_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid,
  "reference_type" varchar(32) NOT NULL,
  "reference_id" uuid NOT NULL,
  "status" "dispatch_job_status" DEFAULT 'pending' NOT NULL,
  "fee_sen" bigint DEFAULT 0 NOT NULL,
  "currency" varchar(3) DEFAULT 'MYR' NOT NULL,
  "reason_code" varchar(64),
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dispatch_jobs_version_check" CHECK ("version" >= 0),
  CONSTRAINT "dispatch_jobs_reference_check" CHECK ("reference_type" ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT "dispatch_jobs_fee_check" CHECK ("fee_sen" >= 0),
  CONSTRAINT "dispatch_jobs_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "dispatch_jobs_reason_check" CHECK (
    ("status" IN ('cancelled', 'failed')) = ("reason_code" IS NOT NULL)
  )
);--> statement-breakpoint

-- An EXPIRING offer. It carries no recipient identity by construction: there is no
-- name, phone or address column here at all.
CREATE TABLE "dispatch_offers" (
  "offer_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "dispatch_job_id" uuid NOT NULL,
  "driver_id" uuid NOT NULL,
  "status" "dispatch_offer_status" DEFAULT 'pending' NOT NULL,
  "fee_sen" bigint NOT NULL,
  -- Coarse distance only. A precise pickup coordinate on an offer would let a
  -- driver locate a patient before accepting anything.
  "approx_distance_metres" integer,
  "expires_at" timestamp with time zone NOT NULL,
  "responded_at" timestamp with time zone,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dispatch_offers_version_check" CHECK ("version" >= 0),
  CONSTRAINT "dispatch_offers_fee_check" CHECK ("fee_sen" >= 0),
  CONSTRAINT "dispatch_offers_distance_check" CHECK ("approx_distance_metres" IS NULL OR "approx_distance_metres" >= 0),
  CONSTRAINT "dispatch_offers_expiry_check" CHECK ("expires_at" > "created_at"),
  -- A terminal response must be timestamped; a pending offer must not be.
  CONSTRAINT "dispatch_offers_responded_check" CHECK (
    ("status" IN ('accepted', 'declined')) = ("responded_at" IS NOT NULL)
  )
);--> statement-breakpoint

CREATE TABLE "dispatch_assignments" (
  "assignment_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "dispatch_job_id" uuid NOT NULL,
  "driver_id" uuid NOT NULL,
  "vehicle_id" uuid,
  "offer_id" uuid NOT NULL,
  "status" "dispatch_assignment_status" DEFAULT 'assigned' NOT NULL,
  "reason_code" varchar(64),
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "version" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dispatch_assignments_version_check" CHECK ("version" >= 0),
  CONSTRAINT "dispatch_assignments_completed_check" CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL)),
  CONSTRAINT "dispatch_assignments_reason_check" CHECK (
    ("status" IN ('cancelled', 'failed')) = ("reason_code" IS NOT NULL)
  )
);--> statement-breakpoint

CREATE TABLE "dispatch_stops" (
  "stop_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "dispatch_job_id" uuid NOT NULL,
  "kind" "dispatch_stop_kind" NOT NULL,
  "sequence_no" integer NOT NULL,
  "latitude" numeric(9, 6) NOT NULL,
  "longitude" numeric(10, 6) NOT NULL,
  "arrived_at" timestamp with time zone,
  CONSTRAINT "dispatch_stops_sequence_check" CHECK ("sequence_no" >= 1),
  CONSTRAINT "dispatch_stops_latitude_check" CHECK ("latitude" >= -90 AND "latitude" <= 90),
  CONSTRAINT "dispatch_stops_longitude_check" CHECK ("longitude" >= -180 AND "longitude" <= 180)
);--> statement-breakpoint

-- Throttled route history. Append-only: a driver cannot rewrite where they were.
CREATE TABLE "location_waypoints" (
  "waypoint_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "assignment_id" uuid NOT NULL,
  "driver_id" uuid NOT NULL,
  "latitude" numeric(9, 6) NOT NULL,
  "longitude" numeric(10, 6) NOT NULL,
  "accuracy_metres" integer,
  "significant" boolean DEFAULT false NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "location_waypoints_latitude_check" CHECK ("latitude" >= -90 AND "latitude" <= 90),
  CONSTRAINT "location_waypoints_longitude_check" CHECK ("longitude" >= -180 AND "longitude" <= 180),
  CONSTRAINT "location_waypoints_accuracy_check" CHECK ("accuracy_metres" IS NULL OR "accuracy_metres" >= 0),
  CONSTRAINT "location_waypoints_order_check" CHECK ("received_at" >= "recorded_at")
);--> statement-breakpoint

-- Recipient identity lives HERE and nowhere in the dispatch tables, so an offer
-- cannot disclose it. Reads are gated on an active assignment.
CREATE TABLE "deliveries" (
  "delivery_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "pharmacy_order_id" uuid NOT NULL,
  "dispatch_job_id" uuid,
  "status" "pharmacy_delivery_status" DEFAULT 'awaiting_dispatch' NOT NULL,
  "recipient_name" varchar(200) NOT NULL,
  "recipient_phone_e164" varchar(16) NOT NULL,
  "address_line1" varchar(200) NOT NULL,
  "address_line2" varchar(200),
  "postcode" varchar(12) NOT NULL,
  "city" varchar(120) NOT NULL,
  "state_code" varchar(32) NOT NULL,
  "latitude" numeric(9, 6),
  "longitude" numeric(10, 6),
  "reason_code" varchar(64),
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deliveries_version_check" CHECK ("version" >= 0),
  CONSTRAINT "deliveries_phone_check" CHECK ("recipient_phone_e164" ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT "deliveries_reason_check" CHECK (("status" = 'failed') = ("reason_code" IS NOT NULL)),
  CONSTRAINT "deliveries_latitude_check" CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90)),
  CONSTRAINT "deliveries_longitude_check" CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180))
);--> statement-breakpoint

CREATE TABLE "pickup_proofs" (
  "pickup_proof_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "assignment_id" uuid NOT NULL,
  "kind" "proof_kind" NOT NULL,
  "file_object_id" uuid,
  "code_hash" varchar(64),
  "captured_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- A photo or signature proof must reference a stored object; a code proof must
  -- store only a digest. A proof with neither proves nothing.
  CONSTRAINT "pickup_proofs_shape_check" CHECK (
    ("kind" IN ('signature', 'photo') AND "file_object_id" IS NOT NULL AND "code_hash" IS NULL)
    OR ("kind" = 'code' AND "code_hash" IS NOT NULL AND "file_object_id" IS NULL)
  ),
  CONSTRAINT "pickup_proofs_code_hash_check" CHECK ("code_hash" IS NULL OR "code_hash" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint

CREATE TABLE "delivery_proofs" (
  "delivery_proof_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "delivery_id" uuid NOT NULL,
  "assignment_id" uuid NOT NULL,
  "kind" "proof_kind" NOT NULL,
  "file_object_id" uuid,
  "code_hash" varchar(64),
  "captured_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_proofs_shape_check" CHECK (
    ("kind" IN ('signature', 'photo') AND "file_object_id" IS NOT NULL AND "code_hash" IS NULL)
    OR ("kind" = 'code' AND "code_hash" IS NOT NULL AND "file_object_id" IS NULL)
  ),
  CONSTRAINT "delivery_proofs_code_hash_check" CHECK ("code_hash" IS NULL OR "code_hash" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint

CREATE TABLE "delivery_ratings" (
  "rating_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "delivery_id" uuid NOT NULL,
  "driver_id" uuid NOT NULL,
  "stars" smallint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_ratings_stars_check" CHECK ("stars" BETWEEN 1 AND 5)
);--> statement-breakpoint

-- Append-only earnings ledger. A driver balance is a projection over these events,
-- never a stored wallet field, for the same reason inventory has no quantity column.
CREATE TABLE "driver_earning_events" (
  "earning_event_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "driver_id" uuid NOT NULL,
  "assignment_id" uuid,
  "earning_type" "driver_earning_type" NOT NULL,
  "amount_sen" bigint NOT NULL,
  "currency" varchar(3) DEFAULT 'MYR' NOT NULL,
  "reason_code" varchar(64),
  "correlation_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "driver_earning_events_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "driver_earning_events_nonzero_check" CHECK ("amount_sen" <> 0),
  -- Sign must agree with the type, or a negative "delivery_fee" could quietly
  -- reduce a driver's balance.
  CONSTRAINT "driver_earning_events_sign_check" CHECK (
    ("earning_type" IN ('delivery_fee', 'bonus', 'adjustment_positive') AND "amount_sen" > 0)
    OR ("earning_type" = 'adjustment_negative' AND "amount_sen" < 0)
  ),
  CONSTRAINT "driver_earning_events_reason_check" CHECK (
    "earning_type" NOT IN ('adjustment_positive', 'adjustment_negative') OR "reason_code" IS NOT NULL
  )
);--> statement-breakpoint

CREATE TABLE "driver_withdrawals" (
  "withdrawal_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "driver_id" uuid NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "amount_sen" bigint NOT NULL,
  "currency" varchar(3) DEFAULT 'MYR' NOT NULL,
  "status" "withdrawal_status" DEFAULT 'requested' NOT NULL,
  "reason_code" varchar(64),
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "driver_withdrawals_amount_check" CHECK ("amount_sen" > 0),
  CONSTRAINT "driver_withdrawals_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "driver_withdrawals_version_check" CHECK ("version" >= 0),
  CONSTRAINT "driver_withdrawals_reason_check" CHECK (
    ("status" IN ('rejected', 'cancelled')) = ("reason_code" IS NOT NULL)
  )
);--> statement-breakpoint

CREATE UNIQUE INDEX "drivers_membership_uq" ON "drivers" ("membership_id");--> statement-breakpoint
CREATE INDEX "drivers_availability_idx" ON "drivers" ("organization_id", "availability", "driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_plate_uq" ON "vehicles" ("plate_number") WHERE "active";--> statement-breakpoint
CREATE UNIQUE INDEX "driver_bank_accounts_hash_uq" ON "driver_bank_accounts" ("account_hash");--> statement-breakpoint
-- One live dispatch job per owning record: a pharmacy order must not be dispatched twice.
CREATE UNIQUE INDEX "dispatch_jobs_reference_live_uq" ON "dispatch_jobs" ("reference_type", "reference_id")
  WHERE "status" IN ('pending', 'offering', 'assigned', 'in_progress');--> statement-breakpoint
CREATE INDEX "dispatch_jobs_status_idx" ON "dispatch_jobs" ("status", "created_at", "dispatch_job_id");--> statement-breakpoint
-- INVARIANT 1. At most one ACCEPTED offer per job, enforced by the index rather
-- than by application logic, so two drivers racing to accept cannot both win.
CREATE UNIQUE INDEX "dispatch_offers_accepted_uq" ON "dispatch_offers" ("dispatch_job_id") WHERE "status" = 'accepted';--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_offers_job_driver_uq" ON "dispatch_offers" ("dispatch_job_id", "driver_id");--> statement-breakpoint
CREATE INDEX "dispatch_offers_expiry_idx" ON "dispatch_offers" ("expires_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "dispatch_offers_driver_idx" ON "dispatch_offers" ("driver_id", "status", "offer_id");--> statement-breakpoint
-- INVARIANT 2. One active assignment per driver. Two concurrent accepts would each
-- read the other as absent, so this cannot be an application check.
CREATE UNIQUE INDEX "dispatch_assignments_driver_active_uq" ON "dispatch_assignments" ("driver_id")
  WHERE "status" IN ('assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff');--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_assignments_job_uq" ON "dispatch_assignments" ("dispatch_job_id")
  WHERE "status" <> 'cancelled' AND "status" <> 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_assignments_offer_uq" ON "dispatch_assignments" ("offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_stops_job_sequence_uq" ON "dispatch_stops" ("dispatch_job_id", "sequence_no");--> statement-breakpoint
-- Route history and the throttle check both read the newest waypoint per assignment.
CREATE INDEX "location_waypoints_assignment_idx" ON "location_waypoints" ("assignment_id", "recorded_at", "waypoint_id");--> statement-breakpoint
-- Significant waypoints are retained longer for audit, so they are separately indexed.
CREATE INDEX "location_waypoints_significant_idx" ON "location_waypoints" ("assignment_id", "recorded_at") WHERE "significant";--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_order_uq" ON "deliveries" ("pharmacy_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_proofs_assignment_uq" ON "pickup_proofs" ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_proofs_delivery_uq" ON "delivery_proofs" ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_ratings_delivery_uq" ON "delivery_ratings" ("delivery_id");--> statement-breakpoint
CREATE INDEX "driver_earning_events_driver_idx" ON "driver_earning_events" ("driver_id", "occurred_at", "earning_event_id");--> statement-breakpoint
-- One earning per completed assignment: a replayed completion must not pay twice.
CREATE UNIQUE INDEX "driver_earning_events_assignment_fee_uq" ON "driver_earning_events" ("assignment_id")
  WHERE "earning_type" = 'delivery_fee' AND "assignment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "driver_withdrawals_driver_idx" ON "driver_withdrawals" ("driver_id", "status", "withdrawal_id");

--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_membership_fk" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_fk" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id");--> statement-breakpoint
ALTER TABLE "driver_bank_accounts" ADD CONSTRAINT "driver_bank_accounts_driver_fk" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id");--> statement-breakpoint
ALTER TABLE "dispatch_jobs" ADD CONSTRAINT "dispatch_jobs_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_job_fk" FOREIGN KEY ("dispatch_job_id") REFERENCES "dispatch_jobs"("dispatch_job_id");--> statement-breakpoint
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_driver_fk" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id");--> statement-breakpoint
ALTER TABLE "dispatch_assignments" ADD CONSTRAINT "dispatch_assignments_job_fk" FOREIGN KEY ("dispatch_job_id") REFERENCES "dispatch_jobs"("dispatch_job_id");--> statement-breakpoint
ALTER TABLE "dispatch_assignments" ADD CONSTRAINT "dispatch_assignments_driver_fk" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id");--> statement-breakpoint
ALTER TABLE "dispatch_assignments" ADD CONSTRAINT "dispatch_assignments_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("vehicle_id");--> statement-breakpoint
ALTER TABLE "dispatch_assignments" ADD CONSTRAINT "dispatch_assignments_offer_fk" FOREIGN KEY ("offer_id") REFERENCES "dispatch_offers"("offer_id");--> statement-breakpoint
ALTER TABLE "dispatch_stops" ADD CONSTRAINT "dispatch_stops_job_fk" FOREIGN KEY ("dispatch_job_id") REFERENCES "dispatch_jobs"("dispatch_job_id");--> statement-breakpoint
ALTER TABLE "location_waypoints" ADD CONSTRAINT "location_waypoints_assignment_fk" FOREIGN KEY ("assignment_id") REFERENCES "dispatch_assignments"("assignment_id");--> statement-breakpoint
ALTER TABLE "location_waypoints" ADD CONSTRAINT "location_waypoints_driver_fk" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_fk" FOREIGN KEY ("pharmacy_order_id") REFERENCES "pharmacy_orders"("pharmacy_order_id");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_job_fk" FOREIGN KEY ("dispatch_job_id") REFERENCES "dispatch_jobs"("dispatch_job_id");--> statement-breakpoint
ALTER TABLE "pickup_proofs" ADD CONSTRAINT "pickup_proofs_assignment_fk" FOREIGN KEY ("assignment_id") REFERENCES "dispatch_assignments"("assignment_id");--> statement-breakpoint
ALTER TABLE "pickup_proofs" ADD CONSTRAINT "pickup_proofs_file_fk" FOREIGN KEY ("file_object_id") REFERENCES "stored_objects"("object_id");--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_delivery_fk" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("delivery_id");--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_assignment_fk" FOREIGN KEY ("assignment_id") REFERENCES "dispatch_assignments"("assignment_id");--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_file_fk" FOREIGN KEY ("file_object_id") REFERENCES "stored_objects"("object_id");--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_delivery_fk" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("delivery_id");--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_driver_fk" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id");--> statement-breakpoint
ALTER TABLE "driver_earning_events" ADD CONSTRAINT "driver_earning_events_driver_fk" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id");--> statement-breakpoint
ALTER TABLE "driver_earning_events" ADD CONSTRAINT "driver_earning_events_assignment_fk" FOREIGN KEY ("assignment_id") REFERENCES "dispatch_assignments"("assignment_id");--> statement-breakpoint
ALTER TABLE "driver_withdrawals" ADD CONSTRAINT "driver_withdrawals_driver_fk" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id");--> statement-breakpoint
ALTER TABLE "driver_withdrawals" ADD CONSTRAINT "driver_withdrawals_account_fk" FOREIGN KEY ("bank_account_id") REFERENCES "driver_bank_accounts"("bank_account_id");

--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_waypoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'location waypoints are append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER location_waypoints_reject_mutation BEFORE UPDATE OR DELETE ON "location_waypoints" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_waypoint();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_earning() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'driver earning events are append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER driver_earning_events_reject_mutation BEFORE UPDATE OR DELETE ON "driver_earning_events" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_earning();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_proof_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'delivery proof is immutable once captured' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER pickup_proofs_reject_mutation BEFORE UPDATE OR DELETE ON "pickup_proofs" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_proof_mutation();--> statement-breakpoint
CREATE TRIGGER delivery_proofs_reject_mutation BEFORE UPDATE OR DELETE ON "delivery_proofs" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_proof_mutation();--> statement-breakpoint

-- A waypoint may only be recorded against an assignment that is currently active.
-- Without this a driver could keep reporting location after completing a job, or
-- backfill a route for an assignment that was cancelled.
CREATE OR REPLACE FUNCTION smartcura_enforce_waypoint_active_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_status dispatch_assignment_status; assignment_driver uuid;
BEGIN
  SELECT status, driver_id INTO assignment_status, assignment_driver
  FROM dispatch_assignments WHERE assignment_id = NEW.assignment_id;
  IF assignment_status IS NULL THEN
    RAISE EXCEPTION 'waypoint references an unknown assignment' USING ERRCODE = '23503';
  END IF;
  IF assignment_status IN ('completed', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'waypoints require an active assignment' USING ERRCODE = '23514';
  END IF;
  IF assignment_driver <> NEW.driver_id THEN
    RAISE EXCEPTION 'waypoint driver must own the assignment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER location_waypoints_require_active BEFORE INSERT ON "location_waypoints" FOR EACH ROW EXECUTE FUNCTION smartcura_enforce_waypoint_active_assignment();--> statement-breakpoint

-- A delivery fee may only be posted for a COMPLETED assignment carrying proof.
-- Paying for an unproven delivery is the failure mode this prevents.
CREATE OR REPLACE FUNCTION smartcura_enforce_earning_requires_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_status dispatch_assignment_status;
BEGIN
  IF NEW.earning_type <> 'delivery_fee' OR NEW.assignment_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO assignment_status FROM dispatch_assignments WHERE assignment_id = NEW.assignment_id;
  IF assignment_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'a delivery fee requires a completed assignment' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM delivery_proofs WHERE assignment_id = NEW.assignment_id) THEN
    RAISE EXCEPTION 'a delivery fee requires captured delivery proof' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER driver_earning_events_require_proof AFTER INSERT ON "driver_earning_events" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION smartcura_enforce_earning_requires_proof();--> statement-breakpoint

INSERT INTO permissions (permission_id, description) VALUES
 ('dispatch.job:manage:site', 'Create and cancel dispatch jobs for a site'),
 ('delivery.recipient:read:assigned', 'Read recipient contact and address during an active assignment'),
 ('driver.vehicle:manage:own', 'Manage own vehicles'),
 ('driver.bank_account:manage:own', 'Manage own payout bank accounts')
ON CONFLICT (permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id) VALUES
 ('pharmacy', 'dispatch.job:manage:site'),
 ('driver', 'delivery.recipient:read:assigned'),
 ('driver', 'driver.vehicle:manage:own'),
 ('driver', 'driver.bank_account:manage:own')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Least-privilege assertions: recipient disclosure is an assigned-driver capability
-- only, and a driver never holds inventory or clinical authority.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id = 'delivery.recipient:read:assigned' AND role_id <> 'driver'
  ) THEN
    RAISE EXCEPTION 'recipient disclosure must remain an assigned-driver capability';
  END IF;
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE role_id = 'driver'
      AND permission_id IN ('stock_ledger:post:site', 'patient.record:read',
                            'prescription:read:own', 'prescription_validation:manage:site')
  ) THEN
    RAISE EXCEPTION 'a driver must not hold clinical or inventory authority';
  END IF;
END $$;--> statement-breakpoint
INSERT INTO schema_compatibility (component, version) VALUES ('identity', 17)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
