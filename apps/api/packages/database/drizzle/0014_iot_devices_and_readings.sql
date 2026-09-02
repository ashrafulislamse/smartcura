-- WP-07a: IoT device registration, credential digests, assignment history,
-- vital reading ingestion, hourly rollups and threshold-driven health alerts.
--
-- Design rules inherited from the existing foundation, not invented here:
--   * every identifier is a PostgreSQL 18 `uuidv7()` generated inside the same
--     transaction as the aggregate write;
--   * optimistic concurrency is an integer `version` with a `>= 0` check;
--   * any foreign key that could cross an organization boundary is COMPOSITE and
--     carries `organization_id`, per the `membership_sites_*_org_fk` precedent;
--   * secrets are never stored, only 64-character lowercase hex SHA-256 digests,
--     exactly as `app_sessions.token_hash` does;
--   * permissions are seeded per action. No `*` action is introduced, because
--     `permissionMatches` treats `*` as matching every present and future
--     action and migrations 0009/0010 deliberately removed the last wildcard.
--
-- THE QoS-1 DUPLICATE PROBLEM AND ITS SOLUTION
-- MQTT QoS 1 is at-least-once, so a redelivered packet is normal traffic, not an
-- anomaly. The obvious guard, `UNIQUE (device_id, boot_id, sequence_number)` on
-- `vital_readings`, is REJECTED by PostgreSQL: `vital_readings` is partitioned by
-- range on `recorded_at`, and every unique index on a partitioned table must
-- contain the partition key.
--
-- Adding `recorded_at` to that index is necessary but NOT sufficient on its own.
-- It makes the index legal and stops every byte-identical redelivery, but a
-- replay whose timestamp was mutated in transit or by a device clock reset would
-- land in a different partition and be accepted a second time. The unique index
-- is therefore only the partition-local half of the guard.
--
-- The authoritative guard is `vital_reading_ingest_claims`, which is NOT
-- partitioned and whose PRIMARY KEY is exactly
-- `(device_id, boot_id, sequence_number)`. The claim is inserted in the same
-- transaction as the reading, so a packet identity is claimed if and only if its
-- reading was stored. This mirrors `vitals-capacity-plan.md` section 5.3, which
-- reached the same conclusion: PostgreSQL cannot enforce a partition-key-free
-- unique key across partitions, so the ledger carries it.
--
-- Tradeoff accepted: the ledger is a second write and a second index per accepted
-- reading (about 168 planning bytes, already budgeted in the capacity plan), and
-- it must be expired on a schedule. The alternative — trusting a partition-local
-- index alone — would leave a duplicate hole that no application code can close.
--
-- Preflight. This migration creates seven tables, four monthly partitions, eight
-- enum types and composite foreign keys whose target unique indexes must already
-- exist. Assert every precondition first and name the specific missing object,
-- following the precedent in migrations 0008 and 0011.
DO $$
DECLARE
  server_version integer;
  missing_roles text;
  existing_tables text;
BEGIN
  -- PostgreSQL 18 is required: every primary key here is written by the built-in
  -- `uuidv7()`, which does not exist before 18.
  SELECT current_setting('server_version_num')::integer INTO server_version;
  IF server_version < 180000 THEN
    RAISE EXCEPTION
      'Migration 0014 aborted: PostgreSQL 18 or newer is required for built-in uuidv7(), found server_version_num=%.',
      server_version;
  END IF;

  IF to_regclass('public.organizations') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION
      'Migration 0014 aborted: organizations and profiles must exist. Migration 0000 must be applied before this migration.';
  END IF;

  -- The permission seed at the end has a foreign key to roles. A partially
  -- seeded roles table would abort this migration after the DDL had already run.
  SELECT COALESCE(string_agg(expected.role_id, ', ' ORDER BY expected.role_id), '')
  INTO missing_roles
  FROM (VALUES ('patient'), ('doctor'), ('admin')) AS expected(role_id)
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE roles.role_id = expected.role_id);

  IF missing_roles <> '' THEN
    RAISE EXCEPTION
      'Migration 0014 aborted: required system role(s) missing from roles: %. Migration 0004 must be applied before this migration.',
      missing_roles;
  END IF;

  -- Guard against a partially applied earlier attempt. CREATE TABLE without
  -- IF NOT EXISTS is intentional, so report every conflicting relation at once.
  SELECT COALESCE(string_agg(candidate.table_name, ', ' ORDER BY candidate.table_name), '')
  INTO existing_tables
  FROM (VALUES
    ('devices'), ('device_credentials'), ('device_assignments'),
    ('vital_readings'), ('vital_reading_ingest_claims'),
    ('vital_reading_aggregates'), ('health_alert_thresholds'), ('health_alerts')
  ) AS candidate(table_name)
  WHERE to_regclass('public.' || candidate.table_name) IS NOT NULL;

  IF existing_tables <> '' THEN
    RAISE EXCEPTION
      'Migration 0014 aborted: table(s) already exist from a partially applied attempt: %. Drop them deliberately or repair the drizzle journal before retrying.',
      existing_tables;
  END IF;
END;
$$;--> statement-breakpoint
CREATE TYPE "public"."device_type" AS ENUM('vitals_monitor', 'ecg', 'thermometer', 'pulse_oximeter', 'simulator');--> statement-breakpoint
CREATE TYPE "public"."device_state" AS ENUM('provisioned', 'active', 'suspended', 'retired');--> statement-breakpoint
CREATE TYPE "public"."device_credential_type" AS ENUM('mqtt_password', 'client_certificate');--> statement-breakpoint
CREATE TYPE "public"."vital_metric" AS ENUM('heart_rate', 'spo2', 'body_temperature', 'systolic_bp', 'diastolic_bp', 'respiratory_rate', 'ecg_sample');--> statement-breakpoint
CREATE TYPE "public"."vital_reading_quality" AS ENUM('good', 'suspect', 'bad');--> statement-breakpoint
CREATE TYPE "public"."health_threshold_comparator" AS ENUM('lt', 'lte', 'gt', 'gte');--> statement-breakpoint
CREATE TYPE "public"."health_alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."health_alert_state" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
-- A device is owned by exactly one organization. `state` is the lifecycle, not
-- connectivity: a reachable but suspended device must not be able to ingest.
-- Connectivity is `last_seen_at`, which is the only column ingestion updates.
CREATE TABLE "devices" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"device_type" "device_type" NOT NULL,
	"serial_number" varchar(64) NOT NULL,
	"hardware_revision" varchar(32),
	"firmware_version" varchar(32),
	"state" "device_state" DEFAULT 'provisioned' NOT NULL,
	"provisioned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_version_check" CHECK ("devices"."version" >= 0),
	-- Serial numbers are compared for equality against a physical label, so a
	-- lowercase or space-padded spelling of the same device would create a
	-- second registration that no operator could tell apart.
	CONSTRAINT "devices_serial_number_check" CHECK ("devices"."serial_number" ~ '^[A-Z0-9][A-Z0-9-]{3,63}$'),
	-- A device cannot have been seen before it was provisioned. Such a row is
	-- always a clock or import fault, and it would make "stale device" alerting
	-- read as healthy.
	CONSTRAINT "devices_last_seen_order_check" CHECK ("devices"."last_seen_at" IS NULL OR "devices"."last_seen_at" >= "devices"."provisioned_at")
);
--> statement-breakpoint
-- ONLY a digest is stored. The plaintext MQTT password or client-certificate
-- fingerprint is returned once at provisioning and is unrecoverable afterwards,
-- so a database disclosure cannot be replayed against the broker. Same shape and
-- same reasoning as `app_sessions.token_hash`.
CREATE TABLE "device_credentials" (
	"credential_id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"credential_type" "device_credential_type" NOT NULL,
	"secret_hash" char(64) NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- 64 lowercase hex characters of SHA-256. Mixed case would make two
	-- spellings of the same digest compare unequal, silently breaking
	-- authentication comparison.
	CONSTRAINT "device_credentials_secret_hash_check" CHECK ("device_credentials"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "device_credentials_rotated_order_check" CHECK ("device_credentials"."rotated_at" IS NULL OR "device_credentials"."rotated_at" >= "device_credentials"."created_at"),
	CONSTRAINT "device_credentials_revoked_order_check" CHECK ("device_credentials"."revoked_at" IS NULL OR "device_credentials"."revoked_at" >= "device_credentials"."created_at")
);
--> statement-breakpoint
-- Append-only assignment history. A released assignment is closed with
-- `released_at` and a reason code, never deleted: a reading recorded last month
-- must stay attributable to the patient the device was assigned to at that time,
-- which is impossible if history is rewritten in place.
CREATE TABLE "device_assignments" (
	"assignment_id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"assigned_by_profile_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_assignments_released_order_check" CHECK ("device_assignments"."released_at" IS NULL OR "device_assignments"."released_at" >= "device_assignments"."assigned_at"),
	-- A release without a reason code cannot be reviewed, and a reason code
	-- without a release timestamp implies a release that never happened.
	CONSTRAINT "device_assignments_release_reason_check" CHECK (("device_assignments"."released_at" IS NULL) = ("device_assignments"."release_reason" IS NULL))
);
--> statement-breakpoint
-- Raw scalar readings, PARTITIONED BY RANGE on `recorded_at` in UTC calendar
-- months per `vitals-capacity-plan.md` section 5.1. Retention is a partition
-- detach and drop, not a mass DELETE.
--
-- The primary key is `(recorded_at, reading_id)`, not `reading_id` alone, because
-- PostgreSQL requires the partition key to be part of every unique constraint on
-- a partitioned table. `reading_id` remains a `uuidv7()` and so remains globally
-- unique in practice; a caller addressing one reading also carries its recorded
-- time. Tradeoff: a lookup by `reading_id` alone must scan every partition, so
-- the API always pairs an id with a bounded time predicate.
CREATE TABLE "vital_readings" (
	"reading_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"metric" "vital_metric" NOT NULL,
	"value" numeric(12, 4) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"boot_id" bigint NOT NULL,
	"sequence_number" bigint NOT NULL,
	"quality" "vital_reading_quality" DEFAULT 'good' NOT NULL,
	CONSTRAINT "vital_readings_pk" PRIMARY KEY("recorded_at","reading_id"),
	-- `boot_id` counts device power cycles and `sequence_number` counts readings
	-- within a boot. Both are monotonic and non-negative; a negative value means
	-- the firmware counter wrapped or the payload was tampered with, and either
	-- way the packet identity can no longer be trusted for dedupe.
	CONSTRAINT "vital_readings_boot_id_check" CHECK ("vital_readings"."boot_id" >= 0),
	CONSTRAINT "vital_readings_sequence_number_check" CHECK ("vital_readings"."sequence_number" >= 0),
	-- A reading cannot be ingested before it was recorded. Rejecting this at
	-- write time keeps offline-replay lag measurable instead of negative.
	CONSTRAINT "vital_readings_ingested_order_check" CHECK ("vital_readings"."ingested_at" >= "vital_readings"."recorded_at"),
	-- Values are bounded per metric. An out-of-range reading is an instrument or
	-- transport fault, and storing it would corrupt aggregates and fire alerts
	-- that no clinician can act on. `ecg_sample` is a millivolt sample and is
	-- allowed to be negative; every other supported metric is positive.
	CONSTRAINT "vital_readings_value_range_check" CHECK (
		("vital_readings"."metric" = 'heart_rate' AND "vital_readings"."value" > 0 AND "vital_readings"."value" <= 300)
		OR ("vital_readings"."metric" = 'spo2' AND "vital_readings"."value" >= 0 AND "vital_readings"."value" <= 100)
		OR ("vital_readings"."metric" = 'body_temperature' AND "vital_readings"."value" >= 20 AND "vital_readings"."value" <= 45)
		OR ("vital_readings"."metric" = 'systolic_bp' AND "vital_readings"."value" > 0 AND "vital_readings"."value" <= 300)
		OR ("vital_readings"."metric" = 'diastolic_bp' AND "vital_readings"."value" > 0 AND "vital_readings"."value" <= 200)
		OR ("vital_readings"."metric" = 'respiratory_rate' AND "vital_readings"."value" > 0 AND "vital_readings"."value" <= 120)
		OR ("vital_readings"."metric" = 'ecg_sample' AND "vital_readings"."value" >= -50 AND "vital_readings"."value" <= 50)
	),
	-- The unit is part of the measurement, not a display hint. A heart rate
	-- stored with unit 'Cel' would be silently charted as a temperature.
	CONSTRAINT "vital_readings_unit_check" CHECK (
		("vital_readings"."metric" = 'heart_rate' AND "vital_readings"."unit" = '/min')
		OR ("vital_readings"."metric" = 'spo2' AND "vital_readings"."unit" = '%')
		OR ("vital_readings"."metric" = 'body_temperature' AND "vital_readings"."unit" = 'Cel')
		OR ("vital_readings"."metric" IN ('systolic_bp', 'diastolic_bp') AND "vital_readings"."unit" = 'mm[Hg]')
		OR ("vital_readings"."metric" = 'respiratory_rate' AND "vital_readings"."unit" = '/min')
		OR ("vital_readings"."metric" = 'ecg_sample' AND "vital_readings"."unit" = 'mV')
	)
) PARTITION BY RANGE ("recorded_at");
--> statement-breakpoint
-- THE dedupe authority. Not partitioned, so its primary key is a genuine global
-- constraint on `(device_id, boot_id, sequence_number)` — the exact key a
-- partitioned table cannot enforce. Claimed in the same transaction as the
-- reading insert, so a claimed identity always corresponds to a stored reading.
--
-- `expires_at` implements the 30-day accepted replay window from the capacity
-- plan. A packet arriving after its claim has been purged must be REJECTED, not
-- inserted: past the window the ledger can no longer prove whether the packet
-- was already accepted, and inserting it would create the duplicate this table
-- exists to prevent.
CREATE TABLE "vital_reading_ingest_claims" (
	"device_id" uuid NOT NULL,
	"boot_id" bigint NOT NULL,
	"sequence_number" bigint NOT NULL,
	"reading_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"first_ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vital_reading_ingest_claims_pk" PRIMARY KEY("device_id","boot_id","sequence_number"),
	CONSTRAINT "vital_reading_ingest_claims_expiry_check" CHECK ("vital_reading_ingest_claims"."expires_at" > "vital_reading_ingest_claims"."first_ingested_at")
);
--> statement-breakpoint
-- Hourly rollups so a chart read does not scan raw partitions. `value_sum` and
-- `sample_count` are stored so a bucket can be extended incrementally and
-- exactly; `value_avg` is GENERATED so no writer can record an average that
-- disagrees with the sum and count it came from.
CREATE TABLE "vital_reading_aggregates" (
	"device_id" uuid NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"metric" "vital_metric" NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"sample_count" integer NOT NULL,
	"value_sum" numeric(20, 4) NOT NULL,
	"value_min" numeric(12, 4) NOT NULL,
	"value_max" numeric(12, 4) NOT NULL,
	"value_avg" numeric(20, 6) GENERATED ALWAYS AS ("value_sum" / "sample_count") STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vital_reading_aggregates_pk" PRIMARY KEY("device_id","patient_profile_id","metric","bucket_start"),
	-- A zero-sample bucket has no average. The check also guarantees the
	-- generated column never divides by zero.
	CONSTRAINT "vital_reading_aggregates_sample_count_check" CHECK ("vital_reading_aggregates"."sample_count" > 0),
	CONSTRAINT "vital_reading_aggregates_bounds_check" CHECK ("vital_reading_aggregates"."value_min" <= "vital_reading_aggregates"."value_max"),
	-- Buckets are hour-aligned by construction, so two writers can never create
	-- two overlapping buckets for the same hour. The three-argument `date_trunc`
	-- is required: the two-argument timestamptz form reads the session TimeZone
	-- and is therefore only STABLE, which PostgreSQL refuses in a CHECK.
	CONSTRAINT "vital_reading_aggregates_bucket_check" CHECK ("vital_reading_aggregates"."bucket_start" = date_trunc('hour', "vital_reading_aggregates"."bucket_start", 'UTC'))
);
--> statement-breakpoint
-- Thresholds are scoped either to the whole organization
-- (`patient_profile_id IS NULL`) or to one patient. A patient row overrides the
-- organization default for the same metric, comparator and severity; precedence
-- is resolved at evaluation time rather than by deleting the default, so the
-- default is still there when the patient-specific override is retired.
CREATE TABLE "health_alert_thresholds" (
	"threshold_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_profile_id" uuid,
	"metric" "vital_metric" NOT NULL,
	"comparator" "health_threshold_comparator" NOT NULL,
	"threshold_value" numeric(12, 4) NOT NULL,
	"severity" "health_alert_severity" NOT NULL,
	"retired_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_alert_thresholds_version_check" CHECK ("health_alert_thresholds"."version" >= 0),
	CONSTRAINT "health_alert_thresholds_retired_order_check" CHECK ("health_alert_thresholds"."retired_at" IS NULL OR "health_alert_thresholds"."retired_at" >= "health_alert_thresholds"."created_at")
);
--> statement-breakpoint
-- One breach of one threshold by one reading. `observed_value` is clinical data
-- and is deliberately excluded from every published event payload; the event
-- carries the alert identity and severity only, and a reader with the right
-- permission fetches the value over the authorized HTTP path.
CREATE TABLE "health_alerts" (
	"alert_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"metric" "vital_metric" NOT NULL,
	"observed_value" numeric(12, 4) NOT NULL,
	"threshold_id" uuid NOT NULL,
	"severity" "health_alert_severity" NOT NULL,
	"state" "health_alert_state" DEFAULT 'open' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"acknowledged_by_profile_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_alerts_version_check" CHECK ("health_alerts"."version" >= 0),
	-- An acknowledgement needs an acknowledger. Recording one without the other
	-- produces an unauditable clinical action.
	CONSTRAINT "health_alerts_acknowledged_pair_check" CHECK (("health_alerts"."acknowledged_at" IS NULL) = ("health_alerts"."acknowledged_by_profile_id" IS NULL)),
	CONSTRAINT "health_alerts_acknowledged_state_check" CHECK ("health_alerts"."acknowledged_at" IS NULL OR "health_alerts"."state" IN ('acknowledged', 'resolved')),
	CONSTRAINT "health_alerts_resolved_state_check" CHECK (("health_alerts"."state" = 'resolved') = ("health_alerts"."resolved_at" IS NOT NULL)),
	CONSTRAINT "health_alerts_acknowledged_order_check" CHECK ("health_alerts"."acknowledged_at" IS NULL OR "health_alerts"."acknowledged_at" >= "health_alerts"."observed_at"),
	CONSTRAINT "health_alerts_resolved_order_check" CHECK ("health_alerts"."resolved_at" IS NULL OR "health_alerts"."resolved_at" >= "health_alerts"."observed_at")
);
--> statement-breakpoint
-- Monthly UTC partitions with half-open bounds `[month_start, next_month_start)`,
-- per `vitals-capacity-plan.md` section 5.1. Bounds are written with an explicit
-- `+00` offset because a bare timestamp literal would be interpreted in the
-- session TimeZone, which would silently shift every boundary for a non-UTC
-- session and put a reading in the wrong partition.
CREATE TABLE "vital_readings_2026_07" PARTITION OF "vital_readings"
	FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');--> statement-breakpoint
CREATE TABLE "vital_readings_2026_08" PARTITION OF "vital_readings"
	FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');--> statement-breakpoint
CREATE TABLE "vital_readings_2026_09" PARTITION OF "vital_readings"
	FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');--> statement-breakpoint
-- The default partition is a SAFETY NET, not normal operation. Without it, a
-- reading whose `recorded_at` falls outside every declared month is rejected
-- outright and the packet is lost; with it, the row is stored and can be moved
-- once the correct partition exists. Routine ingestion landing here is an
-- alertable failure: a non-empty default partition blocks ATTACH of the month it
-- overlaps until those rows are moved, which is exactly why the capacity plan
-- refuses to treat it as a substitute for pre-creating monthly partitions.
CREATE TABLE "vital_readings_default" PARTITION OF "vital_readings" DEFAULT;--> statement-breakpoint
-- Unique indexes are created BEFORE the composite foreign keys that reference
-- them: PostgreSQL requires a unique index on exactly the referenced column
-- list, and the reverse order fails with an opaque "no unique constraint
-- matching given keys". Same ordering reason as migrations 0008 and 0011.
CREATE UNIQUE INDEX "devices_organization_serial_uq" ON "devices" USING btree ("organization_id","serial_number");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_id_organization_uq" ON "devices" USING btree ("device_id","organization_id");--> statement-breakpoint
CREATE INDEX "devices_org_created_idx" ON "devices" USING btree ("organization_id","created_at","device_id");--> statement-breakpoint
CREATE INDEX "devices_org_state_idx" ON "devices" USING btree ("organization_id","state");--> statement-breakpoint
-- One live credential per device per credential type. Rotation revokes the old
-- row and inserts a new one, so the digest that was valid last week stays
-- auditable instead of being overwritten.
CREATE UNIQUE INDEX "device_credentials_active_uq" ON "device_credentials" USING btree ("device_id","credential_type") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "device_credentials_device_idx" ON "device_credentials" USING btree ("device_id");--> statement-breakpoint
-- THE at-most-one-active-assignment rule. A partial unique index on `device_id`
-- where `released_at IS NULL` makes a second open assignment impossible at the
-- storage layer, so two concurrent assign requests cannot both succeed no matter
-- how the application orders its reads.
CREATE UNIQUE INDEX "device_assignments_active_uq" ON "device_assignments" USING btree ("device_id") WHERE "released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "device_assignments_patient_idx" ON "device_assignments" USING btree ("patient_profile_id","assigned_at");--> statement-breakpoint
CREATE INDEX "device_assignments_device_time_idx" ON "device_assignments" USING btree ("device_id","assigned_at");--> statement-breakpoint
-- Partition-local duplicate guard. `recorded_at` is present ONLY because
-- PostgreSQL requires the partition key in every unique index on a partitioned
-- table; the semantic key is the first three columns. This index stops every
-- byte-identical QoS-1 redelivery within a partition. It does NOT stop a replay
-- whose timestamp was mutated into another month — that is what the
-- `vital_reading_ingest_claims` primary key is for.
CREATE UNIQUE INDEX "vital_readings_dedupe_uq" ON "vital_readings" USING btree ("device_id","boot_id","sequence_number","recorded_at");--> statement-breakpoint
CREATE INDEX "vital_readings_patient_metric_time_idx" ON "vital_readings" USING btree ("patient_profile_id","metric","recorded_at");--> statement-breakpoint
CREATE INDEX "vital_readings_device_time_idx" ON "vital_readings" USING btree ("device_id","recorded_at");--> statement-breakpoint
-- BRIN, not btree, for broad retention and administrative scans: readings arrive
-- in near time order, so a tiny BRIN summary prunes whole ranges at a fraction
-- of the per-row cost the capacity plan budgets for btree indexes.
CREATE INDEX "vital_readings_recorded_brin_idx" ON "vital_readings" USING brin ("recorded_at");--> statement-breakpoint
CREATE INDEX "vital_reading_ingest_claims_expiry_idx" ON "vital_reading_ingest_claims" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "vital_reading_aggregates_patient_metric_idx" ON "vital_reading_aggregates" USING btree ("patient_profile_id","metric","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "health_alert_thresholds_org_scope_uq" ON "health_alert_thresholds" USING btree ("organization_id","metric","comparator","severity") WHERE "patient_profile_id" IS NULL AND "retired_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "health_alert_thresholds_patient_scope_uq" ON "health_alert_thresholds" USING btree ("organization_id","patient_profile_id","metric","comparator","severity") WHERE "patient_profile_id" IS NOT NULL AND "retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "health_alert_thresholds_lookup_idx" ON "health_alert_thresholds" USING btree ("organization_id","metric","retired_at");--> statement-breakpoint
-- At most one live alert per patient, metric and threshold. Without this, a
-- reading that stays above a threshold for an hour would raise sixty alerts and
-- bury the first one; ingestion relies on the conflict to make repeated breaches
-- idempotent instead of counting on application-side deduplication.
CREATE UNIQUE INDEX "health_alerts_live_uq" ON "health_alerts" USING btree ("patient_profile_id","metric","threshold_id") WHERE "state" <> 'resolved';--> statement-breakpoint
CREATE INDEX "health_alerts_patient_state_idx" ON "health_alerts" USING btree ("patient_profile_id","state","observed_at","alert_id");--> statement-breakpoint
CREATE INDEX "health_alerts_org_state_idx" ON "health_alerts" USING btree ("organization_id","state","severity");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- COMPOSITE on purpose: the assignment row carries the organization, and this key
-- proves the device belongs to that same organization. A single-column reference
-- would let an assignment created in organization A point at a device owned by
-- organization B, which no application guard could retroactively repair.
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_device_org_fk" FOREIGN KEY ("device_id","organization_id") REFERENCES "public"."devices"("device_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- `patient_profile_id` and `assigned_by_profile_id` are plain references:
-- profiles are platform level, not organization owned, so there is no
-- organization boundary for them to cross. The boundary is carried by the
-- composite device key above.
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_patient_profile_id_profiles_profile_id_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_assigned_by_profile_id_profiles_profile_id_fk" FOREIGN KEY ("assigned_by_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Foreign keys FROM a partitioned table are supported from PostgreSQL 12 and are
-- inherited by every partition, including ones attached later.
ALTER TABLE "vital_readings" ADD CONSTRAINT "vital_readings_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_readings" ADD CONSTRAINT "vital_readings_patient_profile_id_profiles_profile_id_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_reading_ingest_claims" ADD CONSTRAINT "vital_reading_ingest_claims_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_reading_aggregates" ADD CONSTRAINT "vital_reading_aggregates_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_reading_aggregates" ADD CONSTRAINT "vital_reading_aggregates_patient_profile_id_profiles_profile_id_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_alert_thresholds" ADD CONSTRAINT "health_alert_thresholds_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_alert_thresholds" ADD CONSTRAINT "health_alert_thresholds_patient_profile_id_profiles_profile_id_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_alerts" ADD CONSTRAINT "health_alerts_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_alerts" ADD CONSTRAINT "health_alerts_patient_profile_id_profiles_profile_id_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_alerts" ADD CONSTRAINT "health_alerts_device_org_fk" FOREIGN KEY ("device_id","organization_id") REFERENCES "public"."devices"("device_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_alerts" ADD CONSTRAINT "health_alerts_threshold_id_health_alert_thresholds_threshold_id_fk" FOREIGN KEY ("threshold_id") REFERENCES "public"."health_alert_thresholds"("threshold_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_alerts" ADD CONSTRAINT "health_alerts_acknowledged_by_profile_id_profiles_profile_id_fk" FOREIGN KEY ("acknowledged_by_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Permissions are seeded one action at a time. `reading:ingest:device` is the
-- only permission here whose scope suffix is not one of the five the policy
-- engine parses (`own`, `assigned`, `site`, `organization`, `global`); see
-- HANDOFF-0014.md, where the required `PermissionScope` extension is recorded.
-- Until that lands, the ingestion route proves the grant by explicit membership
-- of the granted list plus a live device assignment, and never through
-- `evaluatePermission`, which would report `invalid_permission` for it.
INSERT INTO permissions (permission_id, description)
VALUES
  ('device:register:organization', 'Register an IoT device into an organization'),
  ('device:read:organization', 'List and read IoT devices in an organization'),
  ('device:assign:organization', 'Assign or release an organization device to a patient'),
  ('reading:ingest:device', 'Submit vital readings on behalf of an assigned device'),
  ('reading:read:own', 'Read the requesting profile''s own vital readings'),
  ('reading:read:assigned', 'Read vital readings for an actively assigned patient'),
  ('alert:read:assigned', 'Read health alerts for an actively assigned patient'),
  ('alert:acknowledge:assigned', 'Acknowledge a health alert for an actively assigned patient')
ON CONFLICT (permission_id) DO UPDATE
SET description = EXCLUDED.description;--> statement-breakpoint
-- Least privilege per role:
--   * `admin` provisions and assigns hardware and may ingest on behalf of a
--     gateway or the simulator, but is NOT granted clinical read scopes here;
--   * `patient` reads only their own readings and may ingest from a device that
--     is actively assigned to them;
--   * `doctor` reads and acknowledges only for patients they are actively
--     assigned to, which `care_assignments` decides at request time.
INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('admin', 'device:register:organization'),
  ('admin', 'device:read:organization'),
  ('admin', 'device:assign:organization'),
  ('admin', 'reading:ingest:device'),
  ('patient', 'reading:ingest:device'),
  ('patient', 'reading:read:own'),
  ('doctor', 'reading:read:assigned'),
  ('doctor', 'alert:read:assigned'),
  ('doctor', 'alert:acknowledge:assigned')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO schema_compatibility (component, version)
VALUES ('identity', 10)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();
