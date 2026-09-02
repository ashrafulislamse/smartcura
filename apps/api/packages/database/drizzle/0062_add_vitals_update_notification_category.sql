-- Add a notification category for patient-facing vitals-update notifications.
--
-- When a patient's device (ESP32 or Health Connect sync) ingests new vital
-- readings, a notification is created so the patient sees new health data in
-- their messages tab and receives a push. The category is throttled to once per
-- 30 minutes per patient in the service layer to avoid spam from frequent ESP32
-- publishes. A dedicated category lets patients manage their preferences for
-- these updates independently from critical vitals_alerts (doctor-facing).

ALTER TYPE "public"."notification_category" ADD VALUE IF NOT EXISTS 'vitals_update';--> statement-breakpoint

-- Record the schema level so the code/migration pair stays aligned. This migration
-- only extends an enum, so it does not change the identity compatibility version.
