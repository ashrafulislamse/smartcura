-- WP-07 canonical IoT vocabulary.
--
-- ENUM CHANGES ONLY. PostgreSQL refuses to use a value added by
-- `ALTER TYPE ... ADD VALUE` later in the same transaction, so every object that
-- depends on a new label lives in migration 0022. Migrations 0018/0019 were split
-- for the same reason.
--
-- RENAME rather than ADD wherever the concept already exists. `spo2` and
-- `oxygen_saturation` are the same measurement, so adding a second label would
-- leave two spellings of one metric in the database forever, and every reader
-- would have to know both. `ALTER TYPE ... RENAME VALUE` rewrites the label in
-- place: stored rows, indexes and CHECK expressions continue to resolve because
-- they reference the value internally, not by text.
ALTER TYPE "public"."vital_metric" RENAME VALUE 'spo2' TO 'oxygen_saturation';--> statement-breakpoint
ALTER TYPE "public"."vital_metric" RENAME VALUE 'ecg_sample' TO 'ecg_voltage';--> statement-breakpoint
-- `blood_pressure` carries systolic as the primary and diastolic as the secondary
-- value, which is how the catalogue models a paired measurement. The existing
-- `systolic_bp`/`diastolic_bp` labels are retained so migration 0022 can keep
-- accepting already-stored rows; new ingestion uses `blood_pressure`.
ALTER TYPE "public"."vital_metric" ADD VALUE IF NOT EXISTS 'blood_pressure';--> statement-breakpoint
ALTER TYPE "public"."vital_metric" ADD VALUE IF NOT EXISTS 'blood_glucose';--> statement-breakpoint
ALTER TYPE "public"."vital_metric" ADD VALUE IF NOT EXISTS 'body_weight';--> statement-breakpoint
-- Quality is a clinical trust statement, not a grade. `valid`/`invalid` say
-- whether the reading may be treated as truth; `good`/`bad` did not.
ALTER TYPE "public"."vital_reading_quality" RENAME VALUE 'good' TO 'valid';--> statement-breakpoint
ALTER TYPE "public"."vital_reading_quality" RENAME VALUE 'bad' TO 'invalid';--> statement-breakpoint
ALTER TYPE "public"."vital_reading_quality" ADD VALUE IF NOT EXISTS 'unknown';--> statement-breakpoint
-- Escalation and dismissal are distinct outcomes. Without them an unattended
-- critical alert and a reviewed-and-dismissed alert are indistinguishable.
ALTER TYPE "public"."health_alert_state" ADD VALUE IF NOT EXISTS 'escalated';--> statement-breakpoint
ALTER TYPE "public"."health_alert_state" ADD VALUE IF NOT EXISTS 'dismissed';--> statement-breakpoint
-- A device packet is not the only origin of a reading. Manual entry, import and
-- derivation must be distinguishable so a chart never presents a typed value as
-- an instrument measurement.
CREATE TYPE "public"."reading_source" AS ENUM('device', 'manual', 'imported', 'derived');--> statement-breakpoint
-- Connectivity is DERIVED from authenticated broker activity and heartbeat age.
-- It is deliberately a separate type from `device_state`: a suspended device may
-- still be online, and an active device may be offline.
CREATE TYPE "public"."device_connectivity_status" AS ENUM('unknown', 'online', 'offline');--> statement-breakpoint
CREATE TYPE "public"."calibration_status" AS ENUM('not_required', 'required', 'in_progress', 'passed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."device_command_status" AS ENUM('queued', 'dispatched', 'acknowledged', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."firmware_rollout_status" AS ENUM('draft', 'scheduled', 'active', 'paused', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."device_hardware_profile" AS ENUM('smartcura_esp32_v1');
