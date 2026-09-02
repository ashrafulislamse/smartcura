-- WP-05 canonical vocabulary alignment.
--
-- PostgreSQL does not permit a newly added enum value to be used elsewhere in
-- the same transaction. This migration therefore adds only the values. The
-- permission/trigger/index hardening that uses them is intentionally migration
-- 0019, after this transaction has committed.
ALTER TYPE "public"."appointment_mode"
  ADD VALUE IF NOT EXISTS 'audio' AFTER 'video';--> statement-breakpoint
ALTER TYPE "public"."appointment_status"
  ADD VALUE IF NOT EXISTS 'checked_in' AFTER 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."appointment_status"
  ADD VALUE IF NOT EXISTS 'in_progress' AFTER 'checked_in';
