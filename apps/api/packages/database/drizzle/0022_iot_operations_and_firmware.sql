-- WP-07 operations: reading provenance, alert escalation, calibration,
-- commands/acknowledgements, diagnostics and the firmware/OTA registry.
--
-- Depends on the enum labels committed by migration 0021.

-- Provenance columns on the partitioned reading table. `source` defaults to
-- `device` because every row written before this migration arrived over MQTT.
ALTER TABLE "vital_readings" ADD COLUMN "source" "reading_source" DEFAULT 'device' NOT NULL;--> statement-breakpoint
-- The paired half of a two-valued measurement. Only `blood_pressure` uses it, so
-- a stray secondary value on a single-valued metric is rejected rather than
-- silently ignored by readers that do not expect it.
ALTER TABLE "vital_readings" ADD COLUMN "value_secondary" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "vital_readings" ADD COLUMN "calibration_id" uuid;--> statement-breakpoint
ALTER TABLE "vital_readings" ADD CONSTRAINT "vital_readings_secondary_value_check" CHECK (
  ("metric" = 'blood_pressure' AND "value_secondary" IS NOT NULL AND "value_secondary" > 0 AND "value_secondary" <= 200)
  OR ("metric" <> 'blood_pressure' AND "value_secondary" IS NULL)
);--> statement-breakpoint
-- `blood_pressure`, `blood_glucose` and `body_weight` were added to the enum in
-- 0021 but were not covered by the original range/unit checks, which are written
-- as an exhaustive OR chain. A metric absent from that chain fails every branch
-- and could never be inserted, so both checks are replaced rather than extended.
ALTER TABLE "vital_readings" DROP CONSTRAINT "vital_readings_value_range_check";--> statement-breakpoint
ALTER TABLE "vital_readings" ADD CONSTRAINT "vital_readings_value_range_check" CHECK (
  ("metric" = 'heart_rate' AND "value" > 0 AND "value" <= 300)
  OR ("metric" = 'oxygen_saturation' AND "value" >= 0 AND "value" <= 100)
  OR ("metric" = 'body_temperature' AND "value" >= 20 AND "value" <= 45)
  OR ("metric" = 'blood_pressure' AND "value" > 0 AND "value" <= 300)
  OR ("metric" = 'systolic_bp' AND "value" > 0 AND "value" <= 300)
  OR ("metric" = 'diastolic_bp' AND "value" > 0 AND "value" <= 200)
  OR ("metric" = 'respiratory_rate' AND "value" > 0 AND "value" <= 120)
  OR ("metric" = 'blood_glucose' AND "value" > 0 AND "value" <= 1000)
  OR ("metric" = 'body_weight' AND "value" > 0 AND "value" <= 500)
  OR ("metric" = 'ecg_voltage' AND "value" >= -50 AND "value" <= 50)
);--> statement-breakpoint
ALTER TABLE "vital_readings" DROP CONSTRAINT "vital_readings_unit_check";--> statement-breakpoint
-- UCUM units from the frozen catalogue. The unit is part of the measurement: a
-- heart rate stored as 'Cel' would be charted as a temperature.
ALTER TABLE "vital_readings" ADD CONSTRAINT "vital_readings_unit_check" CHECK (
  ("metric" = 'heart_rate' AND "unit" = '/min')
  OR ("metric" = 'oxygen_saturation' AND "unit" = '%')
  OR ("metric" = 'body_temperature' AND "unit" = 'Cel')
  OR ("metric" IN ('blood_pressure', 'systolic_bp', 'diastolic_bp') AND "unit" = 'mm[Hg]')
  OR ("metric" = 'respiratory_rate' AND "unit" = '/min')
  OR ("metric" = 'blood_glucose' AND "unit" = 'mg/dL')
  OR ("metric" = 'body_weight' AND "unit" = 'kg')
  OR ("metric" = 'ecg_voltage' AND "unit" = 'mV')
);--> statement-breakpoint

-- Connectivity and hardware profile are device facts the catalogue requires but
-- migration 0014 could not express.
ALTER TABLE "devices" ADD COLUMN "connectivity" "device_connectivity_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "hardware_profile" "device_hardware_profile" DEFAULT 'smartcura_esp32_v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "calibration_state" "calibration_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
-- A device that has never been seen cannot be `online`. Without this an operator
-- dashboard could report a device as reachable before it ever authenticated.
ALTER TABLE "devices" ADD CONSTRAINT "devices_connectivity_seen_check" CHECK ("connectivity" = 'unknown' OR "last_seen_at" IS NOT NULL);--> statement-breakpoint

-- Append-only escalation trail for an alert. Escalation is a separate record, not
-- a column, because one alert may escalate more than once and each hop needs its
-- own actor, reason and time for review.
CREATE TABLE "health_alert_escalations" (
  "escalation_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "alert_id" uuid NOT NULL,
  "escalated_to_membership_id" uuid,
  "reason_code" varchar(64) NOT NULL,
  "actor_profile_id" uuid,
  "correlation_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_alert_escalations_reason_check" CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{1,62}$')
);--> statement-breakpoint

-- Calibration is evidence, not a flag. A reading may reference the calibration in
-- force when it was taken, which is why `vital_readings.calibration_id` exists.
CREATE TABLE "device_calibrations" (
  "calibration_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "device_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "metric" "vital_metric" NOT NULL,
  "status" "calibration_status" DEFAULT 'required' NOT NULL,
  "offset_value" numeric(12, 4) DEFAULT 0 NOT NULL,
  "scale_value" numeric(12, 6) DEFAULT 1 NOT NULL,
  "performed_by_profile_id" uuid,
  "performed_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_calibrations_version_check" CHECK ("version" >= 0),
  -- A zero or negative scale would invert or annihilate every corrected reading.
  CONSTRAINT "device_calibrations_scale_check" CHECK ("scale_value" > 0),
  -- A terminal verdict must state who produced it and when; an untested
  -- calibration must not carry a performer.
  CONSTRAINT "device_calibrations_performed_check" CHECK (
    ("status" IN ('passed', 'failed')) = ("performed_at" IS NOT NULL AND "performed_by_profile_id" IS NOT NULL)
  ),
  CONSTRAINT "device_calibrations_expiry_check" CHECK ("expires_at" IS NULL OR "performed_at" IS NULL OR "expires_at" > "performed_at")
);--> statement-breakpoint

-- Outbound device commands. The command is authoritative in PostgreSQL; MQTT is
-- only the transport, so a lost publish is a retry rather than a lost command.
CREATE TABLE "device_commands" (
  "command_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "device_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "command_type" varchar(64) NOT NULL,
  "parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "device_command_status" DEFAULT 'queued' NOT NULL,
  "issued_by_profile_id" uuid NOT NULL,
  "dispatched_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_commands_version_check" CHECK ("version" >= 0),
  CONSTRAINT "device_commands_type_check" CHECK ("command_type" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "device_commands_parameters_check" CHECK (jsonb_typeof("parameters") = 'object' AND octet_length("parameters"::text) <= 4096),
  CONSTRAINT "device_commands_expiry_check" CHECK ("expires_at" > "created_at"),
  -- A command cannot be acknowledged or reported failed before it was dispatched.
  CONSTRAINT "device_commands_dispatch_check" CHECK (
    "status" IN ('queued', 'cancelled', 'expired') OR "dispatched_at" IS NOT NULL
  )
);--> statement-breakpoint

-- Device-reported acknowledgements. Append-only and keyed per command so a
-- QoS-1 redelivery of the same ack cannot be recorded twice.
CREATE TABLE "device_command_acknowledgements" (
  "acknowledgement_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "command_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "accepted" boolean NOT NULL,
  "failure_code" varchar(64),
  "device_boot_id" bigint NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_command_acks_boot_check" CHECK ("device_boot_id" >= 0),
  -- A rejection must say why; an acceptance must not carry a failure code.
  CONSTRAINT "device_command_acks_failure_check" CHECK ("accepted" = ("failure_code" IS NULL))
);--> statement-breakpoint

CREATE TABLE "device_diagnostics" (
  "diagnostic_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "device_id" uuid NOT NULL,
  "battery_percent" smallint,
  "rssi_dbm" smallint,
  "uptime_seconds" bigint,
  "free_heap_bytes" bigint,
  "device_boot_id" bigint NOT NULL,
  "reported_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_diagnostics_battery_check" CHECK ("battery_percent" IS NULL OR ("battery_percent" >= 0 AND "battery_percent" <= 100)),
  CONSTRAINT "device_diagnostics_uptime_check" CHECK ("uptime_seconds" IS NULL OR "uptime_seconds" >= 0),
  CONSTRAINT "device_diagnostics_boot_check" CHECK ("device_boot_id" >= 0),
  CONSTRAINT "device_diagnostics_order_check" CHECK ("received_at" >= "reported_at")
);--> statement-breakpoint

-- Firmware registry. The artifact lives in object storage; PostgreSQL owns the
-- authoritative checksum so a tampered artifact can be detected on download.
CREATE TABLE "firmware_versions" (
  "firmware_version_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "hardware_profile" "device_hardware_profile" NOT NULL,
  "version" varchar(32) NOT NULL,
  "object_key" varchar(512) NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "released_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Semantic version, so rollout ordering is comparable rather than lexical guesswork.
  CONSTRAINT "firmware_versions_version_check" CHECK ("version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  CONSTRAINT "firmware_versions_sha_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "firmware_versions_size_check" CHECK ("size_bytes" > 0)
);--> statement-breakpoint

CREATE TABLE "firmware_rollouts" (
  "rollout_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "firmware_version_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "status" "firmware_rollout_status" DEFAULT 'draft' NOT NULL,
  "scheduled_at" timestamp with time zone,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "firmware_rollouts_version_check" CHECK ("version" >= 0),
  CONSTRAINT "firmware_rollouts_scheduled_check" CHECK ("status" <> 'scheduled' OR "scheduled_at" IS NOT NULL)
);--> statement-breakpoint

CREATE TABLE "device_firmware_events" (
  "event_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "device_id" uuid NOT NULL,
  "rollout_id" uuid,
  "firmware_version_id" uuid NOT NULL,
  "outcome" varchar(32) NOT NULL,
  "detail_code" varchar(64),
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_firmware_events_outcome_check" CHECK ("outcome" IN ('offered', 'downloading', 'installed', 'failed', 'rejected'))
);--> statement-breakpoint

CREATE INDEX "health_alert_escalations_alert_idx" ON "health_alert_escalations" ("alert_id", "occurred_at", "escalation_id");--> statement-breakpoint
-- At most one live calibration per device and metric. Two concurrent "required"
-- rows would make "the current calibration" undefined.
CREATE UNIQUE INDEX "device_calibrations_live_uq" ON "device_calibrations" ("device_id", "metric") WHERE "status" IN ('required', 'in_progress', 'passed');--> statement-breakpoint
CREATE INDEX "device_calibrations_device_idx" ON "device_calibrations" ("device_id", "created_at", "calibration_id");--> statement-breakpoint
-- Supports the dispatch sweep without scanning terminal commands.
CREATE INDEX "device_commands_dispatch_idx" ON "device_commands" ("status", "expires_at", "command_id") WHERE "status" IN ('queued', 'dispatched');--> statement-breakpoint
CREATE INDEX "device_commands_device_idx" ON "device_commands" ("device_id", "created_at", "command_id");--> statement-breakpoint
-- One recorded acknowledgement per command. A QoS-1 broker may redeliver the
-- same ack, and a second row would make an accepted command look contradicted.
CREATE UNIQUE INDEX "device_command_acks_command_uq" ON "device_command_acknowledgements" ("command_id");--> statement-breakpoint
CREATE INDEX "device_diagnostics_device_idx" ON "device_diagnostics" ("device_id", "reported_at", "diagnostic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_versions_profile_version_uq" ON "firmware_versions" ("hardware_profile", "version");--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_versions_sha_uq" ON "firmware_versions" ("sha256");--> statement-breakpoint
-- One live rollout per organization and firmware version.
CREATE UNIQUE INDEX "firmware_rollouts_live_uq" ON "firmware_rollouts" ("organization_id", "firmware_version_id") WHERE "status" IN ('draft', 'scheduled', 'active', 'paused');--> statement-breakpoint
CREATE INDEX "device_firmware_events_device_idx" ON "device_firmware_events" ("device_id", "occurred_at", "event_id");--> statement-breakpoint

ALTER TABLE "health_alert_escalations" ADD CONSTRAINT "health_alert_escalations_alert_fk" FOREIGN KEY ("alert_id") REFERENCES "health_alerts"("alert_id");--> statement-breakpoint
ALTER TABLE "health_alert_escalations" ADD CONSTRAINT "health_alert_escalations_membership_fk" FOREIGN KEY ("escalated_to_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "health_alert_escalations" ADD CONSTRAINT "health_alert_escalations_actor_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "device_calibrations" ADD CONSTRAINT "device_calibrations_device_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id");--> statement-breakpoint
ALTER TABLE "device_calibrations" ADD CONSTRAINT "device_calibrations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "device_calibrations" ADD CONSTRAINT "device_calibrations_performer_fk" FOREIGN KEY ("performed_by_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_device_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id");--> statement-breakpoint
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_issuer_fk" FOREIGN KEY ("issued_by_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "device_command_acknowledgements" ADD CONSTRAINT "device_command_acks_command_fk" FOREIGN KEY ("command_id") REFERENCES "device_commands"("command_id");--> statement-breakpoint
ALTER TABLE "device_command_acknowledgements" ADD CONSTRAINT "device_command_acks_device_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id");--> statement-breakpoint
ALTER TABLE "device_diagnostics" ADD CONSTRAINT "device_diagnostics_device_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id");--> statement-breakpoint
ALTER TABLE "firmware_rollouts" ADD CONSTRAINT "firmware_rollouts_version_fk" FOREIGN KEY ("firmware_version_id") REFERENCES "firmware_versions"("firmware_version_id");--> statement-breakpoint
ALTER TABLE "firmware_rollouts" ADD CONSTRAINT "firmware_rollouts_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "device_firmware_events" ADD CONSTRAINT "device_firmware_events_device_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("device_id");--> statement-breakpoint
ALTER TABLE "device_firmware_events" ADD CONSTRAINT "device_firmware_events_rollout_fk" FOREIGN KEY ("rollout_id") REFERENCES "firmware_rollouts"("rollout_id");--> statement-breakpoint
ALTER TABLE "device_firmware_events" ADD CONSTRAINT "device_firmware_events_version_fk" FOREIGN KEY ("firmware_version_id") REFERENCES "firmware_versions"("firmware_version_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION smartcura_reject_append_only_escalation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'alert escalations are append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER health_alert_escalations_reject_mutation BEFORE UPDATE OR DELETE ON "health_alert_escalations" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_escalation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_command_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'command acknowledgements are append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER device_command_acks_reject_mutation BEFORE UPDATE OR DELETE ON "device_command_acknowledgements" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_command_ack();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_firmware_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'device firmware events are append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER device_firmware_events_reject_mutation BEFORE UPDATE OR DELETE ON "device_firmware_events" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_firmware_event();--> statement-breakpoint

INSERT INTO permissions (permission_id, description) VALUES
 ('iot.alert:escalate:assigned', 'Escalate an assigned patient health alert'),
 ('iot.device:calibrate:organization', 'Record device calibration evidence'),
 ('iot.device:command:organization', 'Issue and cancel device commands'),
 ('iot.firmware:manage:global', 'Manage the firmware registry and rollouts')
ON CONFLICT (permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id) VALUES
 ('doctor', 'iot.alert:escalate:assigned'),
 ('admin', 'iot.device:calibrate:organization'),
 ('admin', 'iot.device:command:organization'),
 ('super_admin', 'iot.firmware:manage:global')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Least-privilege assertion: firmware management is global-only, so no
-- organization administrator may publish firmware to another organization.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id = 'iot.firmware:manage:global' AND role_id <> 'super_admin'
  ) THEN
    RAISE EXCEPTION 'firmware management must remain super-admin only';
  END IF;
END $$;--> statement-breakpoint
INSERT INTO schema_compatibility (component, version) VALUES ('identity', 14)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
