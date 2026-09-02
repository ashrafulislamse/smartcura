-- WP-04a: extended patient profile data and doctor professional detail.
--
-- NUMBERING: this file is 0015, not 0011. Slots 0011 through 0014 were already
-- taken by work landing in parallel (`0011_profile_verification_consent`,
-- `0012_verification_and_files`, `0013_availability_and_appointments`,
-- `0014_iot_devices_and_readings`), and 0011 has additionally already claimed
-- idx 11 in `meta/_journal.json`. See HANDOFF-0011.md for the journal entry this
-- needs and for the overlap with 0011 that still requires reconciliation.
--
-- TABLE NAMING: every table here is prefixed to avoid colliding with the tables
-- 0011 creates (`profile_addresses`, `profile_emergency_contacts`,
-- `profile_allergies`, `profile_conditions`, `doctor_details`,
-- `doctor_specialties`, `doctor_languages`). Two migrations cannot both create
-- the same relation, and 0011 aborts loudly if any of its own tables already
-- exist, so distinct names are the only way both can apply to one database.
--
-- Design rules inherited from the existing foundation rather than invented here:
--   * every identifier is a PostgreSQL 18 `uuidv7()` uuid, generated server-side
--     inside the same transaction as the aggregate write;
--   * optimistic concurrency is an integer `version` column with a `>= 0` check,
--     so a stale writer is rejected instead of silently overwriting;
--   * any foreign key that could cross an organization boundary is COMPOSITE and
--     carries `organization_id`, following the
--     `membership_sites_membership_org_fk` precedent from migration 0008;
--   * money is integer MYR sen. Never a float, never a second currency without a
--     reviewed FX and settlement design;
--   * phone numbers reuse the exact E.164 pattern already enforced on
--     `profiles.phone_e164`;
--   * permissions are seeded per action. No `*` action is introduced, because
--     `permissionMatches` treats `*` as matching every present and future action,
--     and 0009/0010 deliberately removed the last wildcard.
--
-- Preflight: this migration creates seven tables, one enum type and several
-- composite foreign keys whose target unique indexes must already exist. It also
-- seeds `role_permissions` rows whose `role_id` foreign key can only be satisfied
-- by the roles seeded in 0004, and reuses the `allergy_severity` enum created by
-- 0011. Rather than letting any of that abort with an opaque server error, assert
-- every precondition first and name the specific missing object, following the
-- precedent in migrations 0008 and 0011.
DO $$
DECLARE
  server_version integer;
  missing_roles text;
  existing_tables text;
BEGIN
  -- PostgreSQL 18 is required: every primary key here is written by the built-in
  -- `uuidv7()`, which does not exist before 18. Failing now is far cheaper than
  -- discovering it on the first INSERT.
  SELECT current_setting('server_version_num')::integer INTO server_version;
  IF server_version < 180000 THEN
    RAISE EXCEPTION
      'Migration 0015 aborted: PostgreSQL 18 or newer is required for built-in uuidv7(), found server_version_num=%.',
      server_version;
  END IF;

  -- The composite doctor foreign keys below reference
  -- (membership_id, organization_id) on organization_memberships. PostgreSQL
  -- requires a unique index on exactly those columns; migration 0008 created it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'organization_memberships_id_org_uq'
  ) THEN
    RAISE EXCEPTION
      'Migration 0015 aborted: unique index organization_memberships_id_org_uq is missing. Migration 0008 must be applied before this migration.';
  END IF;

  -- `allergy_severity` is REUSED, not redefined. Migration 0011 created it with
  -- exactly the vocabulary this work package needs (mild, moderate, severe,
  -- life_threatening). Declaring a second enum with the same members would give
  -- the platform two spellings of one clinical concept, and severity is compared
  -- across records when triaging.
  IF to_regtype('public.allergy_severity') IS NULL THEN
    RAISE EXCEPTION
      'Migration 0015 aborted: enum type allergy_severity is missing. Migration 0011 must be applied before this migration.';
  END IF;

  -- The role_permissions seed at the end has a foreign key to roles. A partially
  -- seeded roles table would abort this migration after the DDL already ran, so
  -- check the full system role set up front.
  SELECT COALESCE(string_agg(expected.role_id, ', ' ORDER BY expected.role_id), '')
  INTO missing_roles
  FROM (VALUES
    ('patient'), ('doctor'), ('driver'), ('pharmacy'),
    ('emergency'), ('admin'), ('super_admin')
  ) AS expected(role_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE roles.role_id = expected.role_id
  );

  IF missing_roles <> '' THEN
    RAISE EXCEPTION
      'Migration 0015 aborted: required system role(s) missing from roles: %. Migration 0004 must be applied before this migration.',
      missing_roles;
  END IF;

  -- Guard against a partially applied earlier attempt. CREATE TABLE without
  -- IF NOT EXISTS is intentional (silently skipping a table would leave the
  -- schema out of step with the drizzle snapshot), so report every conflicting
  -- relation at once instead of stopping at the first one.
  SELECT COALESCE(string_agg(candidate.table_name, ', ' ORDER BY candidate.table_name), '')
  INTO existing_tables
  FROM (VALUES
    ('patient_addresses'), ('patient_emergency_contacts'), ('patient_allergies'),
    ('patient_conditions'), ('doctor_professional_details'),
    ('doctor_professional_specialties'), ('doctor_professional_languages')
  ) AS candidate(table_name)
  WHERE to_regclass('public.' || candidate.table_name) IS NOT NULL;

  IF existing_tables <> '' THEN
    RAISE EXCEPTION
      'Migration 0015 aborted: table(s) already exist from a partially applied attempt: %. Drop them deliberately or repair the drizzle journal before retrying.',
      existing_tables;
  END IF;
END;
$$;--> statement-breakpoint
-- `in_remission` is why this enum exists instead of reusing
-- `clinical_record_status`. Remission is not resolution: the condition is
-- clinically inactive but expected to recur, and collapsing it into `resolved`
-- would both lose that distinction and trip the "resolved implies a resolution
-- date" rule below for a condition that has no resolution date.
CREATE TYPE "public"."patient_condition_status" AS ENUM('active', 'resolved', 'in_remission');--> statement-breakpoint
-- Addresses are owned by the profile. Rows are HARD deleted by the API (see
-- `patient-profile-repository.ts`): an address is contact data, not clinical
-- history, and no other aggregate in this work package references it. When
-- dispatch and delivery land and start referencing an address, that reference
-- must be a snapshot on the referencing row, not a foreign key into a mutable
-- address the patient can edit.
CREATE TABLE "patient_addresses" (
	"address_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"label" varchar(80),
	"line1" varchar(160) NOT NULL,
	"line2" varchar(160),
	"city" varchar(120) NOT NULL,
	"state" varchar(120) NOT NULL,
	"postcode" varchar(16) NOT NULL,
	"country_code" varchar(2) DEFAULT 'MY' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_addresses_version_check" CHECK ("patient_addresses"."version" >= 0),
	-- ISO 3166-1 alpha-2, uppercase. Storing 'my' and 'MY' as different values
	-- would split one country across two buckets.
	CONSTRAINT "patient_addresses_country_code_check" CHECK ("patient_addresses"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "patient_addresses_postcode_check" CHECK ("patient_addresses"."postcode" ~ '^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$'),
	-- Coordinates are numeric, never float: latitude/longitude are compared for
	-- equality when de-duplicating pinned locations, and binary floating point
	-- makes that comparison depend on how the value was parsed.
	CONSTRAINT "patient_addresses_latitude_check" CHECK ("patient_addresses"."latitude" IS NULL OR ("patient_addresses"."latitude" >= -90 AND "patient_addresses"."latitude" <= 90)),
	CONSTRAINT "patient_addresses_longitude_check" CHECK ("patient_addresses"."longitude" IS NULL OR ("patient_addresses"."longitude" >= -180 AND "patient_addresses"."longitude" <= 180)),
	-- Half a coordinate pair is not a location. Allowing one column without the
	-- other would produce rows that look geocoded to a query testing only
	-- `latitude IS NOT NULL`.
	CONSTRAINT "patient_addresses_coordinate_pair_check" CHECK (("patient_addresses"."latitude" IS NULL) = ("patient_addresses"."longitude" IS NULL))
);
--> statement-breakpoint
-- Emergency contacts are owned by the profile and HARD deleted by the API: a
-- removed contact must genuinely stop being called, and keeping an archived row
-- around invites a dispatch path that forgets the archive predicate. The audit
-- log records the removal.
CREATE TABLE "patient_emergency_contacts" (
	"contact_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"relationship" varchar(64) NOT NULL,
	"phone_e164" varchar(16) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_emergency_contacts_version_check" CHECK ("patient_emergency_contacts"."version" >= 0),
	-- Same E.164 pattern as `profiles.phone_e164`, but NOT NULL here: an
	-- emergency contact that cannot be dialled is not a contact, and discovering
	-- an unusable number at dispatch time is a safety failure.
	CONSTRAINT "patient_emergency_contacts_phone_e164_check" CHECK ("patient_emergency_contacts"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
-- Allergies are SOFT deleted (`deleted_at`). An allergy a clinician has seen is
-- clinical history: erasing the row would erase the fact that it was once
-- recorded and acted upon, and a prescribing check that silently loses a
-- life-threatening allergy is the worst failure this table can have.
CREATE TABLE "patient_allergies" (
	"allergy_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"substance" varchar(160) NOT NULL,
	"reaction" varchar(240),
	"severity" "allergy_severity" NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"noted_by_profile_id" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- `noted_by_profile_id` is nullable on purpose: a patient-entered allergy has
	-- no separate noter, and that difference is clinically meaningful, so it is
	-- represented as NULL rather than backfilled with the patient's own id.
	--
	-- `recorded_at` is deliberately unconstrained relative to `created_at`: a
	-- patient recalling a childhood reaction, or a record imported from an
	-- existing clinical system, legitimately carries a clinical date far earlier
	-- than the row's insert time.
	CONSTRAINT "patient_allergies_version_check" CHECK ("patient_allergies"."version" >= 0)
);
--> statement-breakpoint
-- Conditions are SOFT deleted for the same reason as allergies.
CREATE TABLE "patient_conditions" (
	"condition_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"condition_name" varchar(200) NOT NULL,
	"status" "patient_condition_status" DEFAULT 'active' NOT NULL,
	"onset_date" date,
	"resolved_date" date,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_conditions_version_check" CHECK ("patient_conditions"."version" >= 0),
	-- A resolution date on an active or in-remission condition is a
	-- contradiction: it reads as "still ongoing" and "finished on this date" at
	-- once, and a timeline rendering either fact would be wrong.
	CONSTRAINT "patient_conditions_resolved_status_check" CHECK ("patient_conditions"."resolved_date" IS NULL OR "patient_conditions"."status" = 'resolved'),
	CONSTRAINT "patient_conditions_resolved_order_check" CHECK ("patient_conditions"."resolved_date" IS NULL OR "patient_conditions"."onset_date" IS NULL OR "patient_conditions"."resolved_date" >= "patient_conditions"."onset_date")
);
--> statement-breakpoint
-- Professional detail for a doctor MEMBERSHIP, not a profile. One profile may
-- hold several memberships (different organizations, or doctor plus patient),
-- and a biography, fee and availability flag belong to the organization the
-- doctor practises in. Keying on `membership_id` makes the one-row-per-membership
-- rule true by construction rather than by application convention.
CREATE TABLE "doctor_professional_details" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"biography" text,
	"years_experience" integer DEFAULT 0 NOT NULL,
	"consultation_fee_sen" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'MYR' NOT NULL,
	"accepts_new_patients" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_professional_details_version_check" CHECK ("doctor_professional_details"."version" >= 0),
	CONSTRAINT "doctor_professional_details_experience_check" CHECK ("doctor_professional_details"."years_experience" >= 0 AND "doctor_professional_details"."years_experience" <= 80),
	-- Money is integer MYR sen, never floating point ringgit. A negative
	-- consultation fee is not a discount, it is a payout, and no payment
	-- aggregate has a representation for that.
	CONSTRAINT "doctor_professional_details_fee_check" CHECK ("doctor_professional_details"."consultation_fee_sen" >= 0),
	-- Bounded to keep an obvious unit mistake (ringgit entered as sen, or a
	-- stray digit) from reaching a payment authorization. RM 100,000 per
	-- consultation is far past any legitimate value.
	CONSTRAINT "doctor_professional_details_fee_ceiling_check" CHECK ("doctor_professional_details"."consultation_fee_sen" <= 10000000),
	-- Single-currency by decision, not by omission. Multi-currency pricing needs
	-- a reviewed FX and settlement design, so an unpriceable row fails loudly.
	CONSTRAINT "doctor_professional_details_currency_check" CHECK ("doctor_professional_details"."currency" = 'MYR')
);
--> statement-breakpoint
-- Specialties are a normalized child table rather than a text[] column: doctor
-- discovery filters and sorts on specialty, which an array cannot support with a
-- plain btree index, and a typo becomes a constraint violation instead of a
-- silently unmatchable array element.
CREATE TABLE "doctor_professional_specialties" (
	"membership_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"specialty_code" varchar(64) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_professional_specialties_pk" PRIMARY KEY("membership_id","specialty_code"),
	-- Canonical lowercase snake_case identifiers, never display text. Labels and
	-- localization are client concerns per the enum catalogue.
	CONSTRAINT "doctor_professional_specialties_code_check" CHECK ("doctor_professional_specialties"."specialty_code" ~ '^[a-z][a-z0-9_]{1,62}$')
);
--> statement-breakpoint
CREATE TABLE "doctor_professional_languages" (
	"membership_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"language_code" varchar(35) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_professional_languages_pk" PRIMARY KEY("membership_id","language_code"),
	-- BCP 47 shape, matching `profiles.preferred_locale` conventions.
	CONSTRAINT "doctor_professional_languages_code_check" CHECK ("doctor_professional_languages"."language_code" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);
--> statement-breakpoint
-- Created BEFORE the composite foreign keys that reference it: PostgreSQL
-- requires a unique index on exactly the referenced column list, and the
-- default generated ordering would emit ADD CONSTRAINT first and fail. Same
-- reason migration 0008 created its unique indexes ahead of the
-- membership_sites composite keys.
CREATE UNIQUE INDEX "doctor_professional_details_membership_org_uq" ON "doctor_professional_details" USING btree ("membership_id","organization_id");--> statement-breakpoint
ALTER TABLE "patient_addresses" ADD CONSTRAINT "patient_addresses_profile_id_profiles_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_emergency_contacts" ADD CONSTRAINT "patient_emergency_contacts_profile_id_profiles_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_profile_id_profiles_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Plain reference: profiles are platform level, not organization owned, so there
-- is no organization boundary for this key to cross.
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_noted_by_profile_id_profiles_profile_id_fk" FOREIGN KEY ("noted_by_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_profile_id_profiles_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Composite: the professional detail row must belong to the SAME organization as
-- the membership it describes. A single-column membership reference would let a
-- fee and biography recorded in organization A be attached to a membership in
-- organization B, which no application guard can retroactively repair.
ALTER TABLE "doctor_professional_details" ADD CONSTRAINT "doctor_professional_details_membership_org_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "public"."organization_memberships"("membership_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_professional_specialties" ADD CONSTRAINT "doctor_professional_specialties_doctor_org_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "public"."doctor_professional_details"("membership_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_professional_languages" ADD CONSTRAINT "doctor_professional_languages_doctor_org_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "public"."doctor_professional_details"("membership_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_addresses_profile_idx" ON "patient_addresses" USING btree ("profile_id","is_primary");--> statement-breakpoint
-- At most one primary address per profile. A partial unique index rather than an
-- application check: "exactly one default" is a database invariant, and two
-- concurrent writers each promoting a different address would otherwise both
-- succeed and leave the profile with two primaries.
CREATE UNIQUE INDEX "patient_addresses_primary_uq" ON "patient_addresses" USING btree ("profile_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "patient_emergency_contacts_profile_idx" ON "patient_emergency_contacts" USING btree ("profile_id","is_primary");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_emergency_contacts_primary_uq" ON "patient_emergency_contacts" USING btree ("profile_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "patient_allergies_profile_idx" ON "patient_allergies" USING btree ("profile_id","severity") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "patient_allergies_noted_by_idx" ON "patient_allergies" USING btree ("noted_by_profile_id");--> statement-breakpoint
-- One live row per substance per profile. Duplicate allergy entries are a real
-- triage hazard: a clinician reconciling two rows for the same substance with
-- different severities has no way to tell which is current.
CREATE UNIQUE INDEX "patient_allergies_live_substance_uq" ON "patient_allergies" USING btree ("profile_id","substance") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "patient_conditions_profile_idx" ON "patient_conditions" USING btree ("profile_id","status") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_conditions_live_name_uq" ON "patient_conditions" USING btree ("profile_id","condition_name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "doctor_professional_details_org_fee_idx" ON "doctor_professional_details" USING btree ("organization_id","accepts_new_patients","consultation_fee_sen");--> statement-breakpoint
CREATE INDEX "doctor_professional_specialties_code_idx" ON "doctor_professional_specialties" USING btree ("specialty_code","organization_id");--> statement-breakpoint
-- At most one primary specialty per doctor, for the same reason as the primary
-- address: a directory listing has one headline specialty, and two would make
-- the rendering order-dependent.
CREATE UNIQUE INDEX "doctor_professional_specialties_primary_uq" ON "doctor_professional_specialties" USING btree ("membership_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "doctor_professional_languages_code_idx" ON "doctor_professional_languages" USING btree ("language_code","organization_id");--> statement-breakpoint
-- Permissions for extended profile data. Two resources, because the objects have
-- different owners and different object policies: `profile_detail` rows belong to
-- a PROFILE, `doctor_detail` rows belong to a MEMBERSHIP.
INSERT INTO permissions (permission_id, description)
VALUES
  ('profile_detail:read:own', 'Read your own addresses, emergency contacts, allergies and conditions'),
  ('profile_detail:write:own', 'Create, update and remove your own extended profile detail rows'),
  ('profile_detail:read:assigned', 'Read the extended profile detail of a patient assigned to you'),
  ('doctor_detail:write:own', 'Maintain the professional detail of your own doctor membership'),
  ('doctor_detail:read:global', 'Read published doctor professional detail across the platform')
ON CONFLICT (permission_id) DO UPDATE
SET description = EXCLUDED.description;--> statement-breakpoint
-- Grants.
--
-- `profile_detail:read:own` / `:write:own` go to every role, because every role
-- is held by a human who has their own address, emergency contact, allergy and
-- condition list. The `own` scope is what constrains them: `scopeAllows` only
-- passes when the resource owner is the actor, so the grant authorises a role
-- over its own rows and nothing else.
--
-- `profile_detail:read:assigned` goes to `doctor` ONLY. Reading another person's
-- clinical detail is a clinical act, and the `assigned` scope requires a live
-- care relationship rather than mere organization membership. `admin` and
-- `super_admin` are deliberately excluded: administrative rank is not clinical
-- authority, matching the assertion migration 0011 makes about
-- `profile.clinical:%`.
--
-- `doctor_detail:write:own` goes to `doctor` ONLY: a biography, fee and
-- availability flag are the practitioner's own professional statements.
--
-- `doctor_detail:read:global` is the doctor directory. The detail it exposes is
-- published professional information, not patient data, so patients need it to
-- choose a clinician and administrators need it to review listings.
INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('patient', 'profile_detail:read:own'),
  ('patient', 'profile_detail:write:own'),
  ('patient', 'doctor_detail:read:global'),
  ('doctor', 'profile_detail:read:own'),
  ('doctor', 'profile_detail:write:own'),
  ('doctor', 'profile_detail:read:assigned'),
  ('doctor', 'doctor_detail:write:own'),
  ('doctor', 'doctor_detail:read:global'),
  ('driver', 'profile_detail:read:own'),
  ('driver', 'profile_detail:write:own'),
  ('pharmacy', 'profile_detail:read:own'),
  ('pharmacy', 'profile_detail:write:own'),
  ('emergency', 'profile_detail:read:own'),
  ('emergency', 'profile_detail:write:own'),
  ('admin', 'profile_detail:read:own'),
  ('admin', 'profile_detail:write:own'),
  ('admin', 'doctor_detail:read:global'),
  ('super_admin', 'profile_detail:read:own'),
  ('super_admin', 'profile_detail:write:own'),
  ('super_admin', 'doctor_detail:read:global')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint
-- Post-seed least-privilege assertions, following the precedent in 0011. Both
-- failures below are cheap to detect here and expensive to discover in
-- production.
DO $$
DECLARE
  wildcard_permissions text;
  clinical_admin_grants text;
  unscoped_permissions text;
BEGIN
  SELECT COALESCE(string_agg(candidate.permission_id, ', ' ORDER BY candidate.permission_id), '')
  INTO wildcard_permissions
  FROM permissions AS candidate
  WHERE (candidate.permission_id LIKE '%:*:%' OR candidate.permission_id LIKE '%:*')
    AND (candidate.permission_id LIKE 'profile_detail:%'
      OR candidate.permission_id LIKE 'doctor_detail:%');

  IF wildcard_permissions <> '' THEN
    RAISE EXCEPTION
      'Migration 0015 aborted: wildcard action permission(s) present for WP-04a resources: %. A `*` action matches every present and future action; seed explicit per-action permissions instead.',
      wildcard_permissions;
  END IF;

  -- Every permission in this work package must carry an explicit scope.
  -- `scopeAllows` treats a scopeless permission as allowed only when the caller
  -- opts in with `unscopedObjectPolicyAllowed`, which is exactly the kind of
  -- implicit authority this platform does not grant over patient data.
  SELECT COALESCE(string_agg(candidate.permission_id, ', ' ORDER BY candidate.permission_id), '')
  INTO unscoped_permissions
  FROM permissions AS candidate
  WHERE (candidate.permission_id LIKE 'profile_detail:%'
      OR candidate.permission_id LIKE 'doctor_detail:%')
    AND candidate.permission_id !~ ':(own|assigned|site|organization|global)$';

  IF unscoped_permissions <> '' THEN
    RAISE EXCEPTION
      'Migration 0015 aborted: WP-04a permission(s) without an explicit scope: %.',
      unscoped_permissions;
  END IF;

  -- Administrative rank must not confer clinical read access to another
  -- person's record. `profile_detail:read:assigned` is the only cross-profile
  -- read this migration creates, and it belongs to clinicians.
  SELECT COALESCE(string_agg(role_id || ' -> ' || permission_id, ', ' ORDER BY role_id, permission_id), '')
  INTO clinical_admin_grants
  FROM role_permissions
  WHERE role_id IN ('admin', 'super_admin')
    AND permission_id = 'profile_detail:read:assigned';

  IF clinical_admin_grants <> '' THEN
    RAISE EXCEPTION
      'Migration 0015 aborted: administrative role(s) were granted assigned clinical read: %. policy-matrix.md denies clinical payload access to admin and super_admin.',
      clinical_admin_grants;
  END IF;
END;
$$;--> statement-breakpoint
-- Bumps the `identity` compatibility component, because this migration adds
-- permission rows that change the effective permission set a session carries.
--
-- The value is 11, not the 7 originally specified for this work package. 7 was
-- correct when `identity` stood at 6; migrations landing in parallel have since
-- taken 8 (0012), 9 (0013) and 10 (0014). `identity` is a single row, so the
-- LAST migration to run decides the value readiness compares against, and
-- writing 7 here would silently roll the component backwards and make a fully
-- migrated database report unready.
--
-- `FoundationReadinessRepository` requires an EXACT match with
-- `IDENTITY_SCHEMA_VERSION`, so that constant must read 11 once 0012 through
-- 0015 have all landed. `foundation-readiness.ts` is deliberately NOT edited
-- here: 0013 and 0014 both deferred the same constant to their handoffs, and a
-- three-way race over one integer produces a value that matches nobody. See
-- HANDOFF-0011.md.
INSERT INTO schema_compatibility (component, version)
VALUES ('identity', 11)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();
