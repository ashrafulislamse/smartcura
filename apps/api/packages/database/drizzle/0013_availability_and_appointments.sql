-- WP-05: doctor availability, generated slots, holds, booking, simulated
-- payment, cancellation and reschedule-as-replacement.
--
-- Design rules inherited from the existing foundation rather than invented here:
--   * every identifier is a PostgreSQL 18 `uuidv7()` uuid;
--   * optimistic concurrency uses an integer `version` column with a `>= 0`
--     check, so a stale writer is rejected instead of overwriting;
--   * any foreign key that can cross an organization boundary is COMPOSITE and
--     carries `organization_id`, following the `membership_sites_*_org_fk`
--     precedent from migration 0008;
--   * money is integer MYR sen in a `bigint`, never floating point, and the
--     currency is constrained to a single value rather than left open;
--   * append-only history is protected by a trigger, following the
--     `audit_logs_reject_mutation` precedent from migration 0001;
--   * permissions are seeded per action. No `*` action is introduced, because
--     `permissionMatches` treats `*` as matching every present and future
--     action and migrations 0009/0010 deliberately removed the last wildcard.
--
-- THE CRITICAL INVARIANT: two appointments must never occupy one slot, and one
-- doctor must never hold two overlapping booked slots. That is enforced
-- physically, by four database objects rather than by application checks:
--   1. `appointments_slot_uq`   - UNIQUE (slot_id). One slot, at most one
--                                 appointment, for every writer, forever.
--   2. `appointment_slots_no_overlapping_booking` - EXCLUDE USING gist over
--                                 (membership_id =, tstzrange(starts_at,
--                                 ends_at) &&) WHERE state = 'booked'. Two
--                                 booked slots for the same doctor cannot
--                                 overlap in time even when they are different
--                                 slot rows of different durations.
--   3. `appointment_slots_live_start_uq` - UNIQUE (membership_id, starts_at)
--                                 over live states only, which makes slot
--                                 generation idempotent: regeneration cannot
--                                 duplicate a slot.
--   4. `appointments_slot_doctor_org_fk` - COMPOSITE FK
--                                 (slot_id, doctor_membership_id,
--                                 organization_id), so an appointment cannot
--                                 claim a slot belonging to a different doctor
--                                 or a different organization.
-- Booking additionally takes `SELECT ... FOR UPDATE` on the slot row, but that
-- is an optimisation for a clean error code, not the safety mechanism: with the
-- lock removed the constraints above still make double booking impossible.
--
-- Preflight: assert every precondition before any DDL runs, following the
-- precedent in migrations 0008 and 0011, so a missing dependency reports the
-- specific missing object instead of an opaque server error mid-migration.
DO $$
DECLARE
  server_version integer;
  missing_roles text;
  existing_tables text;
BEGIN
  -- PostgreSQL 18 is required: every primary key here is written by the
  -- built-in `uuidv7()`, which does not exist before 18.
  SELECT current_setting('server_version_num')::integer INTO server_version;
  IF server_version < 180000 THEN
    RAISE EXCEPTION
      'Migration 0013 aborted: PostgreSQL 18 or newer is required for built-in uuidv7(), found server_version_num=%.',
      server_version;
  END IF;

  -- The overlap EXCLUDE constraint compares a uuid with `=` and a tstzrange
  -- with `&&` in one GiST index, which needs the btree_gist contrib module for
  -- the uuid operator class. Without it there is no way to express "no two
  -- overlapping booked slots for the same doctor" as a constraint, and the
  -- invariant would degrade into an application check.
  IF NOT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist'
  ) THEN
    RAISE EXCEPTION
      'Migration 0013 aborted: the btree_gist extension is not available. It is required for the no-overlapping-booked-slot EXCLUDE constraint; install postgresql-contrib for this server.';
  END IF;

  -- The composite membership foreign keys below reference
  -- (membership_id, organization_id); migration 0008 created the unique index
  -- PostgreSQL requires for that reference.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'organization_memberships_id_org_uq'
  ) THEN
    RAISE EXCEPTION
      'Migration 0013 aborted: unique index organization_memberships_id_org_uq is missing. Migration 0008 must be applied before this migration.';
  END IF;

  -- The role_permissions seed at the end has a foreign key to roles. A
  -- partially seeded roles table would abort after the DDL had already run.
  SELECT COALESCE(string_agg(expected.role_id, ', ' ORDER BY expected.role_id), '')
  INTO missing_roles
  FROM (VALUES
    ('patient'), ('doctor'), ('admin'), ('super_admin')
  ) AS expected(role_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE roles.role_id = expected.role_id
  );

  IF missing_roles <> '' THEN
    RAISE EXCEPTION
      'Migration 0013 aborted: required system role(s) missing from roles: %. Migration 0004 must be applied before this migration.',
      missing_roles;
  END IF;

  -- Guard against a partially applied earlier attempt. CREATE TABLE without
  -- IF NOT EXISTS is intentional, so report every conflicting relation at once.
  SELECT COALESCE(string_agg(candidate.table_name, ', ' ORDER BY candidate.table_name), '')
  INTO existing_tables
  FROM (VALUES
    ('availability_rules'), ('availability_exceptions'), ('appointment_slots'),
    ('appointments'), ('appointment_status_history'), ('appointment_payments')
  ) AS candidate(table_name)
  WHERE to_regclass('public.' || candidate.table_name) IS NOT NULL;

  IF existing_tables <> '' THEN
    RAISE EXCEPTION
      'Migration 0013 aborted: table(s) already exist from a partially applied attempt: %. Drop them deliberately or repair the drizzle journal before retrying.',
      existing_tables;
  END IF;
END;
$$;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."appointment_slot_state" AS ENUM('open', 'held', 'booked', 'closed');--> statement-breakpoint
CREATE TYPE "public"."appointment_mode" AS ENUM('video', 'chat', 'in_person');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('pending_payment', 'confirmed', 'cancelled', 'completed', 'no_show', 'rescheduled');--> statement-breakpoint
CREATE TYPE "public"."appointment_payment_provider" AS ENUM('simulated');--> statement-breakpoint
CREATE TYPE "public"."appointment_payment_state" AS ENUM('pending', 'captured', 'refunded', 'failed');

--> statement-breakpoint
-- Recurring weekly availability for a doctor MEMBERSHIP, not a profile: one
-- human may practise in more than one organization, and a working pattern
-- belongs to the organization it is worked in. Rules are declarative input to
-- slot generation and never hold booking state themselves.
CREATE TABLE "availability_rules" (
	"rule_id" uuid PRIMARY KEY NOT NULL,
	"membership_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"slot_duration_minutes" smallint NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Kuala_Lumpur' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rules_version_check" CHECK ("availability_rules"."version" >= 0),
	-- ISO-8601 weekday numbering as used by PostgreSQL `EXTRACT(DOW)`:
	-- 0 = Sunday through 6 = Saturday. Generation reads the same function, so
	-- storing any other numbering would silently shift every generated slot.
	CONSTRAINT "availability_rules_weekday_check" CHECK ("availability_rules"."weekday" >= 0 AND "availability_rules"."weekday" <= 6),
	-- A window that ends at or before it starts describes no time at all and
	-- would generate either nothing or, with a negative duration, an inverted
	-- slot range that the EXCLUDE constraint below cannot reason about.
	CONSTRAINT "availability_rules_window_check" CHECK ("availability_rules"."end_time" > "availability_rules"."start_time"),
	CONSTRAINT "availability_rules_duration_check" CHECK ("availability_rules"."slot_duration_minutes" >= 5 AND "availability_rules"."slot_duration_minutes" <= 240),
	-- The window must divide exactly into whole slots. Without this, generation
	-- has to choose between a short trailing slot and silently discarding time,
	-- and the two choices produce different slot sets for the same rule, which
	-- breaks the "regeneration is idempotent" guarantee.
	CONSTRAINT "availability_rules_window_divisible_check" CHECK ((EXTRACT(EPOCH FROM ("availability_rules"."end_time" - "availability_rules"."start_time"))::integer % ("availability_rules"."slot_duration_minutes" * 60)) = 0),
	CONSTRAINT "availability_rules_effective_order_check" CHECK ("availability_rules"."effective_to" IS NULL OR "availability_rules"."effective_to" >= "availability_rules"."effective_from"),
	-- IANA zone name shape. The zone is stored per rule because a working day is
	-- expressed in local time while every generated slot is an absolute instant;
	-- resolving one to the other needs the zone the doctor actually works in.
	CONSTRAINT "availability_rules_timezone_check" CHECK ("availability_rules"."timezone" ~ '^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+._-]+)*$')
);
--> statement-breakpoint
-- Per-date override of the recurring pattern. Either the day is unavailable, or
-- it is replaced by exactly one different window. Both facts are stored in one
-- row so a date cannot simultaneously be closed and replaced.
CREATE TABLE "availability_exceptions" (
	"exception_id" uuid PRIMARY KEY NOT NULL,
	"membership_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"exception_date" date NOT NULL,
	"is_unavailable" boolean DEFAULT true NOT NULL,
	"replacement_start_time" time,
	"replacement_end_time" time,
	"reason_code" varchar(64) NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_exceptions_version_check" CHECK ("availability_exceptions"."version" >= 0),
	-- Structured lowercase reason code, never operator free text: exception
	-- reasons reach audit logs and the patient-facing reason for a cancelled
	-- slot, and an open string field is an unacceptable route for clinical
	-- detail to leak into either.
	CONSTRAINT "availability_exceptions_reason_code_check" CHECK ("availability_exceptions"."reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
	-- An unavailable day has no replacement window; an available exception must
	-- carry a complete one. Anything else is a row whose meaning depends on
	-- which column the reader trusts.
	CONSTRAINT "availability_exceptions_replacement_check" CHECK (
		("availability_exceptions"."is_unavailable" = true
			AND "availability_exceptions"."replacement_start_time" IS NULL
			AND "availability_exceptions"."replacement_end_time" IS NULL)
		OR ("availability_exceptions"."is_unavailable" = false
			AND "availability_exceptions"."replacement_start_time" IS NOT NULL
			AND "availability_exceptions"."replacement_end_time" IS NOT NULL
			AND "availability_exceptions"."replacement_end_time" > "availability_exceptions"."replacement_start_time")
	)
);
--> statement-breakpoint
-- A generated, bookable instant. Slots are materialised from rules rather than
-- computed per request because a hold and a booking must attach to a row that
-- can be locked, versioned and constrained. `held_until` makes a hold expire on
-- its own: an abandoned checkout must never remove capacity permanently.
CREATE TABLE "appointment_slots" (
	"slot_id" uuid PRIMARY KEY NOT NULL,
	"membership_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"state" "appointment_slot_state" DEFAULT 'open' NOT NULL,
	"held_until" timestamp with time zone,
	"held_by_profile_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_slots_version_check" CHECK ("appointment_slots"."version" >= 0),
	CONSTRAINT "appointment_slots_window_check" CHECK ("appointment_slots"."ends_at" > "appointment_slots"."starts_at"),
	-- `held` and a live hold are the same fact. Binding them removes both the
	-- "held by nobody" row that no one can convert to a booking and the
	-- "open but still reserved" row that hides capacity from every patient.
	CONSTRAINT "appointment_slots_hold_check" CHECK (
		("appointment_slots"."state" = 'held'
			AND "appointment_slots"."held_until" IS NOT NULL
			AND "appointment_slots"."held_by_profile_id" IS NOT NULL)
		OR ("appointment_slots"."state" <> 'held'
			AND "appointment_slots"."held_until" IS NULL
			AND "appointment_slots"."held_by_profile_id" IS NULL)
	)
);
--> statement-breakpoint
-- One appointment per slot, enforced by the UNIQUE index on `slot_id` below.
-- A reschedule NEVER mutates the original appointment's time: it cancels the
-- original with status `rescheduled`, links `replaced_by_appointment_id`, and
-- books a separate replacement row against a separate slot. That keeps the
-- original's slot, fee and payment history exactly as the patient agreed to it.
CREATE TABLE "appointments" (
	"appointment_id" uuid PRIMARY KEY NOT NULL,
	"slot_id" uuid NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"doctor_membership_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"mode" "appointment_mode" NOT NULL,
	"status" "appointment_status" DEFAULT 'pending_payment' NOT NULL,
	"fee_sen" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'MYR' NOT NULL,
	"cancellation_reason_code" varchar(64),
	"replaced_by_appointment_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_version_check" CHECK ("appointments"."version" >= 0),
	-- Money is integer MYR sen. A zero fee is legitimate (a free follow-up) and
	-- skips the payment aggregate entirely; a negative fee is a payout, which
	-- this aggregate has no representation for.
	CONSTRAINT "appointments_fee_check" CHECK ("appointments"."fee_sen" >= 0),
	-- Single-currency by decision, not omission. Multi-currency pricing needs a
	-- reviewed FX and settlement design.
	CONSTRAINT "appointments_currency_check" CHECK ("appointments"."currency" = 'MYR'),
	-- Every non-attendance outcome must state why, and a reason code must never
	-- appear on an appointment that is still live or completed normally.
	CONSTRAINT "appointments_cancellation_reason_check" CHECK (
		("appointments"."status" IN ('cancelled', 'no_show', 'rescheduled')) = ("appointments"."cancellation_reason_code" IS NOT NULL)
	),
	CONSTRAINT "appointments_cancellation_reason_code_check" CHECK ("appointments"."cancellation_reason_code" IS NULL OR "appointments"."cancellation_reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
	-- `rescheduled` and a replacement link are the same fact. Without the
	-- equivalence a patient could be shown a rescheduled appointment with no
	-- successor, or a replacement chain whose head still looks bookable.
	CONSTRAINT "appointments_replacement_status_check" CHECK (
		("appointments"."status" = 'rescheduled') = ("appointments"."replaced_by_appointment_id" IS NOT NULL)
	),
	CONSTRAINT "appointments_replacement_self_check" CHECK ("appointments"."replaced_by_appointment_id" IS NULL OR "appointments"."replaced_by_appointment_id" <> "appointments"."appointment_id")
);
--> statement-breakpoint
-- Append-only transition log. The trigger below rejects UPDATE and DELETE, so
-- the sequence of states an appointment passed through cannot be rewritten
-- after the fact, exactly as `audit_logs` is protected in migration 0001.
CREATE TABLE "appointment_status_history" (
	"history_id" uuid PRIMARY KEY NOT NULL,
	"appointment_id" uuid NOT NULL,
	"previous_status" "appointment_status",
	"status" "appointment_status" NOT NULL,
	"reason_code" varchar(64),
	"actor_profile_id" uuid,
	"correlation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_status_history_reason_code_check" CHECK ("appointment_status_history"."reason_code" IS NULL OR "appointment_status_history"."reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
	-- A transition to the state it came from records nothing and would make the
	-- history unusable for reconstructing the state machine.
	CONSTRAINT "appointment_status_history_progress_check" CHECK ("appointment_status_history"."previous_status" IS NULL OR "appointment_status_history"."previous_status" <> "appointment_status_history"."status")
);
--> statement-breakpoint
-- Simulated payment only. No card data, no provider token, no external call:
-- the `provider` enum has exactly one value so a real provider cannot be
-- recorded here by accident before its integration is designed and reviewed.
CREATE TABLE "appointment_payments" (
	"payment_id" uuid PRIMARY KEY NOT NULL,
	"appointment_id" uuid NOT NULL,
	"amount_sen" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'MYR' NOT NULL,
	"provider" "appointment_payment_provider" DEFAULT 'simulated' NOT NULL,
	"state" "appointment_payment_state" DEFAULT 'pending' NOT NULL,
	"idempotency_reference" varchar(128) NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_payments_version_check" CHECK ("appointment_payments"."version" >= 0),
	-- A payment row exists only for a positive amount; a zero-fee appointment
	-- has no payment aggregate at all, so "amount 0" is never a valid payment.
	CONSTRAINT "appointment_payments_amount_check" CHECK ("appointment_payments"."amount_sen" > 0),
	CONSTRAINT "appointment_payments_currency_check" CHECK ("appointment_payments"."currency" = 'MYR'),
	CONSTRAINT "appointment_payments_idempotency_reference_check" CHECK ("appointment_payments"."idempotency_reference" ~ '^[A-Za-z0-9._~-]{16,128}$')
);

--> statement-breakpoint
-- Created BEFORE the composite foreign key that references it: PostgreSQL
-- requires a unique index on exactly the referenced column list, and the
-- generated ordering would otherwise emit ADD CONSTRAINT first and fail. Same
-- reason migrations 0008 and 0011 front-loaded their unique indexes.
CREATE UNIQUE INDEX "appointment_slots_id_membership_org_uq" ON "appointment_slots" USING btree ("slot_id","membership_id","organization_id");--> statement-breakpoint
-- INVARIANT 3. At most one LIVE slot per doctor and start instant. Slot
-- generation is therefore idempotent: regenerating a range re-attempts the same
-- (membership_id, starts_at) keys and conflicts away instead of duplicating
-- capacity. `closed` rows are excluded on purpose, so a slot closed by a
-- cancellation or an availability exception does not permanently block that
-- time from being offered again.
CREATE UNIQUE INDEX "appointment_slots_live_start_uq" ON "appointment_slots" USING btree ("membership_id","starts_at") WHERE state <> 'closed';--> statement-breakpoint
CREATE INDEX "appointment_slots_membership_window_idx" ON "appointment_slots" USING btree ("membership_id","starts_at","slot_id");--> statement-breakpoint
CREATE INDEX "appointment_slots_state_window_idx" ON "appointment_slots" USING btree ("state","starts_at");--> statement-breakpoint
-- Supports the hold-expiry sweep without scanning booked or open capacity.
CREATE INDEX "appointment_slots_hold_expiry_idx" ON "appointment_slots" USING btree ("held_until") WHERE state = 'held';--> statement-breakpoint
-- INVARIANT 2. No two BOOKED slots for the same doctor may overlap in time,
-- whatever their durations or slot rows. An application check cannot express
-- this safely: two concurrent bookings of different overlapping slots would
-- each read the other as absent. The GiST exclusion constraint is evaluated by
-- the index itself, so one of the two transactions always fails.
ALTER TABLE "appointment_slots" ADD CONSTRAINT "appointment_slots_no_overlapping_booking" EXCLUDE USING gist ("membership_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("state" = 'booked');--> statement-breakpoint
-- INVARIANT 1. One slot carries at most one appointment, for every writer,
-- forever. This is the primary reason two patients cannot occupy one slot: even
-- if every application guard were removed, the second INSERT fails.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_uq" UNIQUE ("slot_id");--> statement-breakpoint
-- A rescheduled appointment has exactly one successor. Without this, a chain
-- could fan out and "the current appointment" would stop being well defined.
CREATE UNIQUE INDEX "appointments_replacement_uq" ON "appointments" USING btree ("replaced_by_appointment_id") WHERE replaced_by_appointment_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "appointments_patient_created_idx" ON "appointments" USING btree ("patient_profile_id","created_at","appointment_id");--> statement-breakpoint
CREATE INDEX "appointments_doctor_created_idx" ON "appointments" USING btree ("doctor_membership_id","created_at","appointment_id");--> statement-breakpoint
CREATE INDEX "appointments_organization_created_idx" ON "appointments" USING btree ("organization_id","created_at","appointment_id");--> statement-breakpoint
CREATE INDEX "appointment_status_history_appointment_idx" ON "appointment_status_history" USING btree ("appointment_id","occurred_at","history_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_payments_appointment_uq" ON "appointment_payments" USING btree ("appointment_id");--> statement-breakpoint
-- The provider reference is unique per provider, so a replayed simulated
-- capture cannot create a second payment for the same intent.
CREATE UNIQUE INDEX "appointment_payments_provider_reference_uq" ON "appointment_payments" USING btree ("provider","idempotency_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "availability_rules_membership_slot_uq" ON "availability_rules" USING btree ("membership_id","weekday","start_time","effective_from") WHERE is_active;--> statement-breakpoint
CREATE INDEX "availability_rules_membership_active_idx" ON "availability_rules" USING btree ("membership_id","is_active","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "availability_exceptions_membership_date_uq" ON "availability_exceptions" USING btree ("membership_id","exception_date");--> statement-breakpoint
CREATE INDEX "availability_exceptions_date_idx" ON "availability_exceptions" USING btree ("exception_date");--> statement-breakpoint
-- Composite membership foreign keys. A single-column reference would let a rule,
-- an exception, a slot or an appointment in organization A point at a membership
-- in organization B, which no application guard can retroactively repair.
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_membership_org_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "public"."organization_memberships"("membership_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_membership_org_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "public"."organization_memberships"("membership_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_slots" ADD CONSTRAINT "appointment_slots_membership_org_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "public"."organization_memberships"("membership_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_slots" ADD CONSTRAINT "appointment_slots_held_by_profile_id_profiles_profile_id_fk" FOREIGN KEY ("held_by_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_membership_org_fk" FOREIGN KEY ("doctor_membership_id","organization_id") REFERENCES "public"."organization_memberships"("membership_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- INVARIANT 4. The appointment's slot, doctor and organization must agree. A
-- plain `slot_id` reference would allow booking another doctor's slot and
-- recording it against this doctor, which the overlap constraint could not see.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_doctor_org_fk" FOREIGN KEY ("slot_id","doctor_membership_id","organization_id") REFERENCES "public"."appointment_slots"("slot_id","membership_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_profile_id_profiles_profile_id_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_replaced_by_appointment_id_appointments_appointment_id_fk" FOREIGN KEY ("replaced_by_appointment_id") REFERENCES "public"."appointments"("appointment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointment_id_appointments_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("appointment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_actor_profile_id_profiles_profile_id_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_payments" ADD CONSTRAINT "appointment_payments_appointment_id_appointments_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("appointment_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
-- Append-only status history, following the `audit_logs_reject_mutation`
-- precedent from migration 0001. A transition log that can be edited is not
-- evidence: cancellation reasons and no-show findings are disputed by real
-- people, so the sequence must be immutable even to a privileged writer.
CREATE OR REPLACE FUNCTION smartcura_reject_appointment_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'appointment_status_history is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER appointment_status_history_reject_mutation
BEFORE UPDATE OR DELETE ON appointment_status_history
FOR EACH ROW EXECUTE FUNCTION smartcura_reject_appointment_history_mutation();
--> statement-breakpoint
-- A booked slot cannot be released while a live appointment still occupies it.
-- Releasing first and cancelling second would briefly expose the slot for
-- rebooking while the original appointment was still confirmed, which is the
-- double-booking failure arriving through the back door. Callers must cancel the
-- appointment first; the same transaction may then close or reopen the slot.
CREATE OR REPLACE FUNCTION smartcura_guard_slot_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state = 'booked' AND NEW.state <> 'booked' AND EXISTS (
    SELECT 1 FROM appointments
    WHERE appointments.slot_id = OLD.slot_id
      AND appointments.status IN ('pending_payment', 'confirmed')
  ) THEN
    RAISE EXCEPTION
      'appointment_slot % cannot leave state booked while a live appointment occupies it', OLD.slot_id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER appointment_slots_guard_release
BEFORE UPDATE ON appointment_slots
FOR EACH ROW EXECUTE FUNCTION smartcura_guard_slot_release();
--> statement-breakpoint
INSERT INTO permissions (permission_id, description)
VALUES
  ('availability:write:own', 'Create or replace the acting doctor''s own availability rules and exceptions'),
  ('availability:read:global', 'Read published bookable availability for any doctor membership'),
  ('appointment:book:own', 'Hold a slot and book an appointment for the acting patient'),
  ('appointment:read:own', 'Read appointments where the actor is the patient'),
  ('appointment:read:assigned', 'Read appointments assigned to the acting doctor membership'),
  ('appointment:cancel:own', 'Cancel or reschedule an appointment where the actor is the patient'),
  ('appointment:complete:assigned', 'Record completion or non-attendance for an assigned appointment'),
  ('appointment:read:organization', 'Read appointment administration metadata within the organization')
ON CONFLICT (permission_id) DO UPDATE
SET description = EXCLUDED.description;--> statement-breakpoint
-- Explicit per-action grants only. Availability is public-by-design bookable
-- capacity, so `availability:read:global` is granted broadly; appointment
-- payload access is not, and no role receives a global appointment read.
-- Administrators get organization-scoped appointment metadata for scheduling
-- oversight and never a clinical scope, matching the WP-04 precedent that
-- administrative rank does not confer clinical access.
INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('patient', 'availability:read:global'),
  ('patient', 'appointment:book:own'),
  ('patient', 'appointment:read:own'),
  ('patient', 'appointment:cancel:own'),
  ('doctor', 'availability:write:own'),
  ('doctor', 'availability:read:global'),
  ('doctor', 'appointment:read:assigned'),
  ('doctor', 'appointment:complete:assigned'),
  ('admin', 'availability:read:global'),
  ('admin', 'appointment:read:organization'),
  ('super_admin', 'availability:read:global')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint
-- Post-seed least-privilege assertion, following migration 0011. A wildcard
-- action reaching availability or appointments would re-open the hole that
-- 0009/0010 closed, and a booking permission granted to a doctor role would let
-- a clinician create appointments in a patient's name.
DO $$
DECLARE
  wildcard_permissions text;
  misplaced_booking_grants text;
BEGIN
  SELECT COALESCE(string_agg(candidate.permission_id, ', ' ORDER BY candidate.permission_id), '')
  INTO wildcard_permissions
  FROM (
    SELECT permission_id FROM permissions WHERE permission_id LIKE '%:*:%' OR permission_id LIKE '%:*'
  ) AS candidate
  WHERE candidate.permission_id LIKE 'availability:%'
     OR candidate.permission_id LIKE 'appointment:%';

  IF wildcard_permissions <> '' THEN
    RAISE EXCEPTION
      'Migration 0013 aborted: wildcard action permission(s) present for WP-05 resources: %. A `*` action matches every present and future action; seed explicit per-action permissions instead.',
      wildcard_permissions;
  END IF;

  SELECT COALESCE(string_agg(role_id || ' -> ' || permission_id, ', ' ORDER BY role_id, permission_id), '')
  INTO misplaced_booking_grants
  FROM role_permissions
  WHERE permission_id IN ('appointment:book:own', 'appointment:cancel:own')
    AND role_id <> 'patient';

  IF misplaced_booking_grants <> '' THEN
    RAISE EXCEPTION
      'Migration 0013 aborted: booking authority granted outside the patient role: %. Booking and patient-initiated cancellation are `own` scoped actions of the person receiving care.',
      misplaced_booking_grants;
  END IF;
END;
$$;--> statement-breakpoint
-- Records the identity permission catalogue level this migration leaves behind.
-- `FoundationReadinessRepository` requires an EXACT match against
-- `IDENTITY_SCHEMA_VERSION`, so the constant must be raised to 9 in the same
-- deployment as this migration; see HANDOFF-0013.md.
INSERT INTO schema_compatibility (component, version)
VALUES ('identity', 9)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();
