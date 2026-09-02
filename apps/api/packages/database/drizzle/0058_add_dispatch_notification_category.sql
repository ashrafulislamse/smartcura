-- Add a dedicated notification category for driver-facing dispatch events.
--
-- Previously all dispatch notifications were grouped under the broader 'delivery'
-- category, which is shared with patient-facing pharmacy delivery updates. Splitting
-- dispatch into its own category lets drivers manage their alert preferences
-- independently and gives the worker a distinct Android channel for these alerts.

ALTER TYPE "public"."notification_category" ADD VALUE IF NOT EXISTS 'dispatch';--> statement-breakpoint

-- Record the schema level so the code/migration pair stays aligned. This migration
-- only extends an enum, so it does not change the identity compatibility version.
