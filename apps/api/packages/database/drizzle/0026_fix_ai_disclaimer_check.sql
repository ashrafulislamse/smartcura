-- WP-08 correction: the non-diagnostic label CHECK admitted unlabelled artifacts.
--
-- FOUND BY REAL EXECUTION, not by review. Migration 0023 declared:
--
--   CHECK ((content -> 'non_diagnostic') = 'true'::jsonb)
--
-- When the key is ABSENT, `content -> 'non_diagnostic'` is SQL NULL, so the
-- comparison evaluates to NULL — and a CHECK constraint PASSES when its expression
-- is NULL rather than failing. The constraint therefore only caught an artifact
-- whose label was present and wrong, and silently accepted one with no label at
-- all, which is the case that actually matters: unlabelled clinical-support output
-- reaching a patient.
--
-- `@>` containment returns a proper boolean false for a missing key, so it has no
-- three-valued-logic hole. It also requires the value to be exactly `true`, not
-- merely truthy.
--
-- Migration 0023 is already applied and immutable, so this is a corrective forward
-- migration rather than an edit.

-- Any row admitted by the broken constraint must be removed before the stricter
-- one is installed, otherwise the ALTER fails on existing data. Such a row was
-- never valid; it existed only because the constraint could not see it.
DELETE FROM "ai_artifacts"
WHERE NOT ("content" @> '{"non_diagnostic": true}'::jsonb);--> statement-breakpoint

ALTER TABLE "ai_artifacts" DROP CONSTRAINT IF EXISTS "ai_artifacts_disclaimer_check";--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_disclaimer_check"
  CHECK ("content" @> '{"non_diagnostic": true}'::jsonb);--> statement-breakpoint

-- Same defect class, same fix: an absent `payment_id` would have made this
-- constraint pass. Checked explicitly rather than assumed.
DO $$
DECLARE broken text;
BEGIN
  SELECT string_agg(conname, ', ') INTO broken
  FROM pg_constraint
  WHERE contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%->%'
    AND pg_get_constraintdef(oid) NOT LIKE '%@>%'
    AND pg_get_constraintdef(oid) NOT LIKE '%COALESCE%'
    AND pg_get_constraintdef(oid) NOT LIKE '%IS NOT NULL%';
  IF broken IS NOT NULL THEN
    RAISE EXCEPTION 'jsonb CHECK constraints with a NULL hole remain: %', broken;
  END IF;
END $$;--> statement-breakpoint

INSERT INTO schema_compatibility (component, version) VALUES ('identity', 18)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
