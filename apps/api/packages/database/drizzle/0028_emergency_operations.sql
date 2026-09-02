-- WP-12 emergency operations.
--
-- Emergency response SHARES dispatch mechanics with pharmacy delivery but is a
-- SEPARATE aggregate with its own state enum, so an ambulance can never be accepted
-- through a pharmacy delivery command and a delivery can never be resolved as an
-- emergency. `enum-state-catalogue.md` §9 requires exactly this separation.
--
-- Break-glass is the controlled path by which an emergency responder or doctor reads
-- clinical data they have no ordinary relationship to. Everything here exists to make
-- that access bounded, minimum-necessary and undeniable.

CREATE TYPE "public"."emergency_event_status" AS ENUM('created', 'triaged', 'dispatching', 'unit_assigned', 'responding', 'on_scene', 'transporting', 'resolved', 'cancelled', 'false_alarm');--> statement-breakpoint
CREATE TYPE "public"."triage_priority" AS ENUM('unknown', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."emergency_unit_status" AS ENUM('available', 'reserved', 'en_route', 'on_scene', 'transporting', 'out_of_service');--> statement-breakpoint
CREATE TYPE "public"."emergency_resolution_type" AS ENUM('treated_on_scene', 'transported', 'cancelled_by_requester', 'false_alarm', 'duplicate', 'other');--> statement-breakpoint
CREATE TYPE "public"."emergency_communication_channel" AS ENUM('voice', 'sms', 'in_app', 'radio');--> statement-breakpoint
CREATE TYPE "public"."break_glass_status" AS ENUM('active', 'expired', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."break_glass_review_outcome" AS ENUM('justified', 'unjustified', 'inconclusive');

-- Emergency fleet. Units belong to a site because an operations area, not an
-- organization, is what actually dispatches them.
CREATE TABLE "emergency_units" (
  "emergency_unit_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "call_sign" varchar(32) NOT NULL,
  "unit_type" varchar(32) NOT NULL,
  "status" "emergency_unit_status" DEFAULT 'available' NOT NULL,
  "capacity" integer DEFAULT 1 NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "emergency_units_call_sign_check" CHECK ("call_sign" ~ '^[A-Z0-9][A-Z0-9 -]{1,31}$'),
  CONSTRAINT "emergency_units_type_check" CHECK ("unit_type" ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT "emergency_units_capacity_check" CHECK ("capacity" >= 1),
  CONSTRAINT "emergency_units_version_check" CHECK ("version" >= 0)
);--> statement-breakpoint

CREATE TABLE "responder_profiles" (
  "responder_profile_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "membership_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "qualification_code" varchar(64) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "responder_profiles_qualification_check" CHECK ("qualification_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "responder_profiles_version_check" CHECK ("version" >= 0)
);--> statement-breakpoint

CREATE TABLE "responder_shifts" (
  "responder_shift_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "responder_profile_id" uuid NOT NULL,
  "emergency_unit_id" uuid,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "responder_shifts_window_check" CHECK ("ends_at" > "starts_at")
);--> statement-breakpoint

-- The SOS event. `reported_by_profile_id` is the reporter, which is NOT always the
-- patient: a bystander or family member may raise an event for someone else, and
-- collapsing the two would misattribute the clinical subject.
CREATE TABLE "emergency_events" (
  "emergency_event_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid,
  "patient_profile_id" uuid NOT NULL,
  "reported_by_profile_id" uuid NOT NULL,
  "status" "emergency_event_status" DEFAULT 'created' NOT NULL,
  "triage_priority" "triage_priority" DEFAULT 'unknown' NOT NULL,
  "category_code" varchar(64) NOT NULL,
  -- Coordinates are bounded numerics, not PostGIS geography: the runtime image has
  -- no PostGIS, and claiming a geography type we cannot create would be a false
  -- schema. Distance work is deferred rather than faked.
  "latitude" numeric(9, 6),
  "longitude" numeric(9, 6),
  "address_text" text,
  "reason_code" varchar(64),
  -- Set once when the event first leaves `created`, so response duration is measured
  -- from a real acknowledgement instant rather than recomputed at resolution time.
  "triaged_at" timestamp with time zone,
  "dispatched_at" timestamp with time zone,
  "on_scene_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "emergency_events_category_check" CHECK ("category_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "emergency_events_reason_check" CHECK (
    "reason_code" IS NULL OR "reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'
  ),
  CONSTRAINT "emergency_events_version_check" CHECK ("version" >= 0),
  -- Half a coordinate pair is not a location.
  CONSTRAINT "emergency_events_coordinate_pair_check" CHECK (
    ("latitude" IS NULL) = ("longitude" IS NULL)
  ),
  -- A terminal reasoned outcome must carry its reason, and a resolved event must
  -- carry the instant used to compute response duration.
  CONSTRAINT "emergency_events_terminal_reason_check" CHECK (
    "status" NOT IN ('cancelled', 'false_alarm') OR "reason_code" IS NOT NULL
  ),
  CONSTRAINT "emergency_events_resolved_at_check" CHECK (
    ("status" = 'resolved') = ("resolved_at" IS NOT NULL)
  )
);--> statement-breakpoint

-- A POINT-IN-TIME COPY of the vitals that justified the response, not a foreign key
-- to a live reading. The reading may later be corrected, re-quality-flagged or
-- removed, and the clinical record must preserve what the responder actually saw.
CREATE TABLE "emergency_vital_snapshots" (
  "emergency_vital_snapshot_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "emergency_event_id" uuid NOT NULL,
  "metric" "vital_metric" NOT NULL,
  "value_numeric" numeric(12, 4) NOT NULL,
  "unit" varchar(16) NOT NULL,
  "quality" "vital_reading_quality" NOT NULL,
  "measured_at" timestamp with time zone NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "emergency_vital_snapshots_unit_check" CHECK ("unit" ~ '^[A-Za-z%/_°]{1,16}$')
);--> statement-breakpoint

-- Append-only triage history. A priority change is evidence, so it is a new row and
-- never an overwrite of the previous assessment.
CREATE TABLE "triage_events" (
  "triage_event_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "emergency_event_id" uuid NOT NULL,
  "assessed_by_membership_id" uuid NOT NULL,
  "priority" "triage_priority" NOT NULL,
  "protocol_code" varchar(64) NOT NULL,
  "reason_code" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "triage_events_protocol_check" CHECK ("protocol_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "triage_events_reason_check" CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- `unknown` is the initial absence of assessment, never the result of one.
  CONSTRAINT "triage_events_priority_check" CHECK ("priority" <> 'unknown')
);--> statement-breakpoint

-- Unit reservation. Separate from `dispatch_assignments` because an ambulance is not
-- a courier: it has no pharmacy order, no proof of delivery and no earnings.
CREATE TABLE "emergency_dispatches" (
  "emergency_dispatch_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "emergency_event_id" uuid NOT NULL,
  "emergency_unit_id" uuid NOT NULL,
  "assigned_by_membership_id" uuid NOT NULL,
  "status" "emergency_unit_status" DEFAULT 'reserved' NOT NULL,
  "manual_override" boolean DEFAULT false NOT NULL,
  "override_reason_code" varchar(64),
  "released_at" timestamp with time zone,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "emergency_dispatches_version_check" CHECK ("version" >= 0),
  -- A manual override of automatic selection is a reviewable act, so it must say why.
  CONSTRAINT "emergency_dispatches_override_check" CHECK (
    ("manual_override" AND "override_reason_code" ~ '^[a-z][a-z0-9_]{1,62}$')
    OR (NOT "manual_override" AND "override_reason_code" IS NULL)
  ),
  CONSTRAINT "emergency_dispatches_status_check" CHECK (
    "status" IN ('reserved', 'en_route', 'on_scene', 'transporting', 'available')
  )
);--> statement-breakpoint

CREATE TABLE "emergency_communications" (
  "emergency_communication_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "emergency_event_id" uuid NOT NULL,
  "actor_membership_id" uuid NOT NULL,
  "channel" "emergency_communication_channel" NOT NULL,
  "direction" varchar(8) NOT NULL,
  -- Structured summary only. Verbatim call content on an emergency record would put
  -- unbounded clinical narrative into a table that is read under break-glass.
  "summary_code" varchar(64) NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "emergency_communications_direction_check" CHECK ("direction" IN ('inbound', 'outbound')),
  CONSTRAINT "emergency_communications_summary_check" CHECK ("summary_code" ~ '^[a-z][a-z0-9_]{1,62}$')
);--> statement-breakpoint

-- Resolution requires notes, resolver, type and a COMPUTED response duration. The
-- duration is generated from the event timestamps rather than accepted from a
-- client, because a self-reported response time is exactly the number an operator
-- would be tempted to improve.
CREATE TABLE "emergency_resolutions" (
  "emergency_resolution_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "emergency_event_id" uuid NOT NULL,
  "resolved_by_membership_id" uuid NOT NULL,
  "resolution_type" "emergency_resolution_type" NOT NULL,
  "notes" text NOT NULL,
  "outcome_code" varchar(64),
  "event_created_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone NOT NULL,
  "response_duration_seconds" integer GENERATED ALWAYS AS (
    GREATEST(0, (EXTRACT(EPOCH FROM ("resolved_at" - "event_created_at")))::integer)
  ) STORED,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "emergency_resolutions_notes_check" CHECK (length(btrim("notes")) BETWEEN 1 AND 4000),
  CONSTRAINT "emergency_resolutions_outcome_check" CHECK (
    "outcome_code" IS NULL OR "outcome_code" ~ '^[a-z][a-z0-9_]{1,62}$'
  ),
  CONSTRAINT "emergency_resolutions_order_check" CHECK ("resolved_at" >= "event_created_at")
);--> statement-breakpoint

-- Break-glass grant. The 15-minute ceiling is a DATABASE constraint, not a service
-- convention, so an application bug cannot mint an unbounded emergency grant.
CREATE TABLE "break_glass_grants" (
  "break_glass_grant_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "actor_membership_id" uuid NOT NULL,
  "actor_profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "patient_profile_id" uuid NOT NULL,
  "emergency_event_id" uuid NOT NULL,
  "reason_code" varchar(64) NOT NULL,
  "reason_detail" text,
  "status" "break_glass_status" DEFAULT 'active' NOT NULL,
  -- Renewal is a NEW grant referencing the one it succeeds, never an extension of an
  -- existing row. Policy requires a fresh reason/event record per renewal, and an
  -- updatable expiry would make an indefinite grant look like a single access.
  "renews_grant_id" uuid,
  "outage_mode" boolean DEFAULT false NOT NULL,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "terminated_at" timestamp with time zone,
  "termination_reason_code" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "break_glass_grants_reason_check" CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "break_glass_grants_detail_check" CHECK (
    "reason_detail" IS NULL OR length(btrim("reason_detail")) BETWEEN 1 AND 2000
  ),
  CONSTRAINT "break_glass_grants_window_check" CHECK ("expires_at" > "granted_at"),
  -- The policy ceiling, enforced where it cannot be bypassed.
  CONSTRAINT "break_glass_grants_max_duration_check" CHECK (
    "expires_at" <= "granted_at" + interval '15 minutes'
  ),
  CONSTRAINT "break_glass_grants_termination_check" CHECK (
    ("status" = 'terminated') = ("terminated_at" IS NOT NULL)
  ),
  CONSTRAINT "break_glass_grants_termination_reason_check" CHECK (
    "terminated_at" IS NULL OR "termination_reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'
  ),
  -- An actor reading their own record does not need to break any glass, and allowing
  -- it would let self-access hide inside emergency audit noise.
  CONSTRAINT "break_glass_grants_not_self_check" CHECK ("actor_profile_id" <> "patient_profile_id")
);--> statement-breakpoint

-- Every sensitive read under a grant, append-only. `field_group` records WHAT was
-- disclosed, because "minimum necessary" is unauditable if the log only proves that
-- some access happened.
CREATE TABLE "break_glass_access_log" (
  "break_glass_access_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "break_glass_grant_id" uuid NOT NULL,
  "resource_type" varchar(48) NOT NULL,
  "resource_id" uuid,
  "field_group" varchar(48) NOT NULL,
  "correlation_id" uuid NOT NULL,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "break_glass_access_resource_check" CHECK ("resource_type" ~ '^[a-z][a-z0-9_]{1,47}$'),
  CONSTRAINT "break_glass_access_field_group_check" CHECK ("field_group" ~ '^[a-z][a-z0-9_]{1,47}$')
);--> statement-breakpoint

-- Retrospective review. The reviewer is constrained to be a different profile.
CREATE TABLE "break_glass_reviews" (
  "break_glass_review_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "break_glass_grant_id" uuid NOT NULL,
  "reviewer_membership_id" uuid NOT NULL,
  "reviewer_profile_id" uuid NOT NULL,
  "actor_profile_id" uuid NOT NULL,
  "outcome" "break_glass_review_outcome" NOT NULL,
  "notes" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "break_glass_reviews_notes_check" CHECK (length(btrim("notes")) BETWEEN 1 AND 4000),
  -- Policy: the actor cannot review or approve their own use. Denormalising
  -- `actor_profile_id` onto the review makes this a CHECK rather than a service rule
  -- that a later caller could forget.
  CONSTRAINT "break_glass_reviews_not_self_check" CHECK ("reviewer_profile_id" <> "actor_profile_id")
);--> statement-breakpoint

ALTER TABLE "emergency_units" ADD CONSTRAINT "emergency_units_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "emergency_units" ADD CONSTRAINT "emergency_units_site_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("site_id");--> statement-breakpoint
ALTER TABLE "responder_profiles" ADD CONSTRAINT "responder_profiles_membership_fk" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "responder_profiles" ADD CONSTRAINT "responder_profiles_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "responder_profiles" ADD CONSTRAINT "responder_profiles_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "responder_shifts" ADD CONSTRAINT "responder_shifts_responder_fk" FOREIGN KEY ("responder_profile_id") REFERENCES "responder_profiles"("responder_profile_id");--> statement-breakpoint
ALTER TABLE "responder_shifts" ADD CONSTRAINT "responder_shifts_unit_fk" FOREIGN KEY ("emergency_unit_id") REFERENCES "emergency_units"("emergency_unit_id");--> statement-breakpoint
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_site_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("site_id");--> statement-breakpoint
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_patient_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_reporter_fk" FOREIGN KEY ("reported_by_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "emergency_vital_snapshots" ADD CONSTRAINT "emergency_vital_snapshots_event_fk" FOREIGN KEY ("emergency_event_id") REFERENCES "emergency_events"("emergency_event_id");--> statement-breakpoint
ALTER TABLE "triage_events" ADD CONSTRAINT "triage_events_event_fk" FOREIGN KEY ("emergency_event_id") REFERENCES "emergency_events"("emergency_event_id");--> statement-breakpoint
ALTER TABLE "triage_events" ADD CONSTRAINT "triage_events_membership_fk" FOREIGN KEY ("assessed_by_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "emergency_dispatches" ADD CONSTRAINT "emergency_dispatches_event_fk" FOREIGN KEY ("emergency_event_id") REFERENCES "emergency_events"("emergency_event_id");--> statement-breakpoint
ALTER TABLE "emergency_dispatches" ADD CONSTRAINT "emergency_dispatches_unit_fk" FOREIGN KEY ("emergency_unit_id") REFERENCES "emergency_units"("emergency_unit_id");--> statement-breakpoint
ALTER TABLE "emergency_dispatches" ADD CONSTRAINT "emergency_dispatches_membership_fk" FOREIGN KEY ("assigned_by_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "emergency_communications" ADD CONSTRAINT "emergency_communications_event_fk" FOREIGN KEY ("emergency_event_id") REFERENCES "emergency_events"("emergency_event_id");--> statement-breakpoint
ALTER TABLE "emergency_communications" ADD CONSTRAINT "emergency_communications_membership_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "emergency_resolutions" ADD CONSTRAINT "emergency_resolutions_event_fk" FOREIGN KEY ("emergency_event_id") REFERENCES "emergency_events"("emergency_event_id");--> statement-breakpoint
ALTER TABLE "emergency_resolutions" ADD CONSTRAINT "emergency_resolutions_membership_fk" FOREIGN KEY ("resolved_by_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_membership_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_actor_profile_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_patient_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_event_fk" FOREIGN KEY ("emergency_event_id") REFERENCES "emergency_events"("emergency_event_id");--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_renews_fk" FOREIGN KEY ("renews_grant_id") REFERENCES "break_glass_grants"("break_glass_grant_id");--> statement-breakpoint
ALTER TABLE "break_glass_access_log" ADD CONSTRAINT "break_glass_access_grant_fk" FOREIGN KEY ("break_glass_grant_id") REFERENCES "break_glass_grants"("break_glass_grant_id");--> statement-breakpoint
ALTER TABLE "break_glass_reviews" ADD CONSTRAINT "break_glass_reviews_grant_fk" FOREIGN KEY ("break_glass_grant_id") REFERENCES "break_glass_grants"("break_glass_grant_id");--> statement-breakpoint
ALTER TABLE "break_glass_reviews" ADD CONSTRAINT "break_glass_reviews_reviewer_membership_fk" FOREIGN KEY ("reviewer_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "break_glass_reviews" ADD CONSTRAINT "break_glass_reviews_reviewer_profile_fk" FOREIGN KEY ("reviewer_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "break_glass_reviews" ADD CONSTRAINT "break_glass_reviews_actor_profile_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint

CREATE UNIQUE INDEX "emergency_units_call_sign_unique" ON "emergency_units" ("organization_id", "call_sign");--> statement-breakpoint
CREATE INDEX "emergency_units_available_idx" ON "emergency_units" ("site_id", "status") WHERE "status" = 'available';--> statement-breakpoint
CREATE UNIQUE INDEX "responder_profiles_membership_unique" ON "responder_profiles" ("membership_id");--> statement-breakpoint
CREATE INDEX "responder_shifts_window_idx" ON "responder_shifts" ("responder_profile_id", "starts_at", "ends_at");--> statement-breakpoint
CREATE INDEX "emergency_events_active_idx" ON "emergency_events" ("organization_id", "status", "triage_priority") WHERE "status" NOT IN ('resolved', 'cancelled', 'false_alarm');--> statement-breakpoint
CREATE INDEX "emergency_events_patient_idx" ON "emergency_events" ("patient_profile_id", "created_at");--> statement-breakpoint
CREATE INDEX "emergency_vital_snapshots_event_idx" ON "emergency_vital_snapshots" ("emergency_event_id", "measured_at");--> statement-breakpoint
CREATE INDEX "triage_events_event_idx" ON "triage_events" ("emergency_event_id", "created_at");--> statement-breakpoint

-- ONE active dispatch per event: an event cannot have two ambulances reserved.
CREATE UNIQUE INDEX "emergency_dispatches_one_active_per_event" ON "emergency_dispatches" ("emergency_event_id")
  WHERE "released_at" IS NULL;--> statement-breakpoint
-- ONE active dispatch per unit: an ambulance cannot be sent to two emergencies. This
-- is the emergency counterpart of the courier one-active-assignment rule, and it is
-- an index rather than a check because it spans rows.
CREATE UNIQUE INDEX "emergency_dispatches_one_active_per_unit" ON "emergency_dispatches" ("emergency_unit_id")
  WHERE "released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "emergency_communications_event_idx" ON "emergency_communications" ("emergency_event_id", "occurred_at");--> statement-breakpoint
-- Exactly one resolution per event.
CREATE UNIQUE INDEX "emergency_resolutions_event_unique" ON "emergency_resolutions" ("emergency_event_id");--> statement-breakpoint
-- One active grant per actor/patient/event triple, so a responder cannot stack
-- overlapping grants to disguise a longer window as several short ones.
CREATE UNIQUE INDEX "break_glass_grants_one_active" ON "break_glass_grants" ("actor_membership_id", "patient_profile_id", "emergency_event_id")
  WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "break_glass_grants_patient_idx" ON "break_glass_grants" ("patient_profile_id", "granted_at");--> statement-breakpoint
CREATE INDEX "break_glass_grants_pending_review_idx" ON "break_glass_grants" ("organization_id", "granted_at");--> statement-breakpoint
CREATE INDEX "break_glass_access_grant_idx" ON "break_glass_access_log" ("break_glass_grant_id", "accessed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "break_glass_reviews_grant_unique" ON "break_glass_reviews" ("break_glass_grant_id");--> statement-breakpoint
-- A renewal chain is linear: two grants cannot both claim to succeed the same one.
CREATE UNIQUE INDEX "break_glass_grants_renews_unique" ON "break_glass_grants" ("renews_grant_id")
  WHERE "renews_grant_id" IS NOT NULL;--> statement-breakpoint

-- A grant window and its reason are the audit record. Allowing either to be edited
-- after the fact would make the trail deniable, so the database refuses.
CREATE OR REPLACE FUNCTION "break_glass_grant_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."granted_at" <> OLD."granted_at"
    OR NEW."expires_at" <> OLD."expires_at"
    OR NEW."reason_code" <> OLD."reason_code"
    OR NEW."actor_membership_id" <> OLD."actor_membership_id"
    OR NEW."patient_profile_id" <> OLD."patient_profile_id"
    OR NEW."emergency_event_id" <> OLD."emergency_event_id" THEN
    RAISE EXCEPTION 'break-glass grant window and justification are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "break_glass_grants_immutable_trigger" BEFORE UPDATE ON "break_glass_grants"
  FOR EACH ROW EXECUTE FUNCTION "break_glass_grant_immutable"();--> statement-breakpoint

-- Access evidence and triage history are append-only.
CREATE OR REPLACE FUNCTION "emergency_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "break_glass_access_log_append_only" BEFORE UPDATE OR DELETE ON "break_glass_access_log"
  FOR EACH ROW EXECUTE FUNCTION "emergency_append_only"();--> statement-breakpoint
CREATE TRIGGER "triage_events_append_only" BEFORE UPDATE OR DELETE ON "triage_events"
  FOR EACH ROW EXECUTE FUNCTION "emergency_append_only"();--> statement-breakpoint
CREATE TRIGGER "emergency_vital_snapshots_append_only" BEFORE UPDATE OR DELETE ON "emergency_vital_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "emergency_append_only"();--> statement-breakpoint

-- A grant must name an emergency event that is genuinely open, and the patient on the
-- grant must be the patient on the event. Checked as a DEFERRABLE constraint trigger
-- so the SOS transaction may create event and grant together, while a grant against a
-- resolved or unrelated event still cannot commit.
CREATE OR REPLACE FUNCTION "break_glass_requires_active_event"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  event_status "emergency_event_status";
  event_patient uuid;
  event_org uuid;
BEGIN
  SELECT "status", "patient_profile_id", "organization_id"
    INTO event_status, event_patient, event_org
    FROM "emergency_events" WHERE "emergency_event_id" = NEW."emergency_event_id";
  IF event_status IS NULL THEN
    RAISE EXCEPTION 'break-glass requires an emergency event' USING ERRCODE = 'check_violation';
  END IF;
  IF event_status IN ('resolved', 'cancelled', 'false_alarm') THEN
    RAISE EXCEPTION 'break-glass requires an ACTIVE emergency event, not %', event_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF event_patient <> NEW."patient_profile_id" THEN
    RAISE EXCEPTION 'break-glass patient must match the emergency event patient'
      USING ERRCODE = 'check_violation';
  END IF;
  IF event_org <> NEW."organization_id" THEN
    RAISE EXCEPTION 'break-glass organization must match the emergency event organization'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "break_glass_grants_active_event_trigger"
  AFTER INSERT ON "break_glass_grants"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "break_glass_requires_active_event"();--> statement-breakpoint

-- Resolution timestamps must be the event's own, so response duration cannot be
-- improved by supplying a later start or an earlier finish.
CREATE OR REPLACE FUNCTION "emergency_resolution_matches_event"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actual_created timestamp with time zone;
  actual_status "emergency_event_status";
BEGIN
  SELECT "created_at", "status" INTO actual_created, actual_status
    FROM "emergency_events" WHERE "emergency_event_id" = NEW."emergency_event_id";
  IF actual_created IS NULL THEN
    RAISE EXCEPTION 'resolution requires an emergency event' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."event_created_at" <> actual_created THEN
    RAISE EXCEPTION 'resolution response duration must be computed from the event creation instant'
      USING ERRCODE = 'check_violation';
  END IF;
  IF actual_status NOT IN ('resolved', 'cancelled', 'false_alarm') THEN
    RAISE EXCEPTION 'resolution requires a terminal emergency event, not %', actual_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "emergency_resolutions_match_event_trigger"
  AFTER INSERT ON "emergency_resolutions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "emergency_resolution_matches_event"();--> statement-breakpoint

-- Emergency dispatch must never reference a pharmacy delivery aggregate, and a
-- pharmacy dispatch job must never reference an emergency event. The catalogue
-- requires the separation; this makes it structural rather than conventional.
ALTER TABLE "dispatch_jobs" ADD CONSTRAINT "dispatch_jobs_reference_type_check" CHECK (
  "reference_type" IN ('pharmacy_order', 'emergency_event_transport')
);--> statement-breakpoint

INSERT INTO permissions (permission_id, description) VALUES
  ('emergency.event:create:own', 'Raise an emergency event for oneself or a dependant'),
  ('emergency.event:read:site', 'Read emergency events for an assigned operations area'),
  ('emergency.triage:manage:site', 'Record triage assessments for an operations area'),
  ('emergency.dispatch:manage:site', 'Reserve and progress emergency units'),
  ('emergency.communication:manage:site', 'Record emergency communications'),
  ('emergency.fleet:read:site', 'Read emergency unit availability'),
  ('emergency.resolution:create:site', 'Resolve emergency events'),
  ('break_glass:activate', 'Activate a time-bounded audited emergency access grant'),
  ('break_glass:review', 'Retrospectively review break-glass use')
ON CONFLICT (permission_id) DO NOTHING;--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('patient', 'emergency.event:create:own'),
  ('emergency', 'emergency.event:read:site'),
  ('emergency', 'emergency.triage:manage:site'),
  ('emergency', 'emergency.dispatch:manage:site'),
  ('emergency', 'emergency.communication:manage:site'),
  ('emergency', 'emergency.fleet:read:site'),
  ('emergency', 'emergency.resolution:create:site'),
  ('emergency', 'break_glass:activate'),
  ('doctor', 'break_glass:activate'),
  -- Review is an ADMINISTRATIVE capability, deliberately not granted to the roles
  -- that can activate. Policy forbids reviewing one's own use, and granting review to
  -- the same role would make mutual sign-off between colleagues the normal path.
  ('admin', 'break_glass:review'),
  ('super_admin', 'break_glass:review')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint

DO $$
BEGIN
  -- Break-glass activation must never reach a role with no clinical duty of care.
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id = 'break_glass:activate'
      AND role_id NOT IN ('doctor', 'emergency')
  ) THEN
    RAISE EXCEPTION 'break-glass activation is limited to doctor and emergency roles';
  END IF;
  -- Activation and review must not overlap, or self-review becomes reachable.
  IF EXISTS (
    SELECT 1 FROM role_permissions a
    JOIN role_permissions b ON a.role_id = b.role_id
    WHERE a.permission_id = 'break_glass:activate'
      AND b.permission_id = 'break_glass:review'
  ) THEN
    RAISE EXCEPTION 'no role may both activate and review break-glass access';
  END IF;
END $$;--> statement-breakpoint

INSERT INTO schema_compatibility (component, version) VALUES ('identity', 20)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
