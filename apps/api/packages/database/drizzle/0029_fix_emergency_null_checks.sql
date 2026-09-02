-- Corrective: two WP-12 CHECK constraints were satisfiable by NULL.
--
-- THE SAME DEFECT CLASS AS 0026. A CHECK constraint that evaluates to NULL is
-- SATISFIED, not violated. `0026` fixed this for a jsonb containment test; these two
-- constraints reintroduced it in a different shape, and only behavioural proof caught
-- them — the constraints exist, are syntactically correct, and look right:
--
--   (manual_override AND override_reason_code ~ '...')
--     with override_reason_code NULL  ->  true AND NULL  ->  NULL  -> ACCEPTED
--
--   (terminated_at IS NULL OR termination_reason_code ~ '...')
--     with termination_reason_code NULL  ->  false OR NULL  ->  NULL  -> ACCEPTED
--
-- So an unexplained manual dispatch override and an unexplained break-glass
-- termination were both storable, in the two places where the reason IS the audit
-- value. Every conditional CHECK below now states its NULL expectation explicitly
-- rather than relying on a comparison to fail.

-- REPAIR BEFORE TIGHTENING. Rows were already stored under the broken constraints, and
-- PostgreSQL correctly refused to add the corrected ones while they existed. Any real
-- deployment faces the same thing, so the fix has to say what happens to that data.
--
-- Neither row can be silently normalised. Clearing `manual_override` would falsify the
-- record: the override DID happen, and only its justification is missing. So the fact
-- is preserved and the gap is named explicitly with a reserved code, which is
-- auditable as a missing justification rather than disguised as a compliant one.
UPDATE "emergency_dispatches"
  SET "override_reason_code" = 'reason_not_recorded'
  WHERE "manual_override" IS TRUE AND "override_reason_code" IS NULL;--> statement-breakpoint

UPDATE "break_glass_grants"
  SET "termination_reason_code" = 'reason_not_recorded'
  WHERE "terminated_at" IS NOT NULL AND "termination_reason_code" IS NULL;--> statement-breakpoint

ALTER TABLE "emergency_dispatches" DROP CONSTRAINT "emergency_dispatches_override_check";--> statement-breakpoint
ALTER TABLE "emergency_dispatches" ADD CONSTRAINT "emergency_dispatches_override_check" CHECK (
  ("manual_override" IS TRUE
    AND "override_reason_code" IS NOT NULL
    AND "override_reason_code" ~ '^[a-z][a-z0-9_]{1,62}$')
  OR ("manual_override" IS FALSE AND "override_reason_code" IS NULL)
);--> statement-breakpoint

ALTER TABLE "break_glass_grants" DROP CONSTRAINT "break_glass_grants_termination_reason_check";--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_termination_reason_check" CHECK (
  "terminated_at" IS NULL
  OR ("termination_reason_code" IS NOT NULL
    AND "termination_reason_code" ~ '^[a-z][a-z0-9_]{1,62}$')
);--> statement-breakpoint

-- The same audit exposed the same shape in the remaining optional reason codes, which
-- were merely permissive rather than wrong; they are restated explicitly so the whole
-- table reads one way and a future reader cannot mistake the pattern for correct.
ALTER TABLE "emergency_events" DROP CONSTRAINT "emergency_events_reason_check";--> statement-breakpoint
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_reason_check" CHECK (
  "reason_code" IS NULL OR "reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'
);--> statement-breakpoint

ALTER TABLE "emergency_resolutions" DROP CONSTRAINT "emergency_resolutions_outcome_check";--> statement-breakpoint
ALTER TABLE "emergency_resolutions" ADD CONSTRAINT "emergency_resolutions_outcome_check" CHECK (
  "outcome_code" IS NULL OR "outcome_code" ~ '^[a-z][a-z0-9_]{1,62}$'
);--> statement-breakpoint

ALTER TABLE "break_glass_grants" DROP CONSTRAINT "break_glass_grants_detail_check";--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_detail_check" CHECK (
  "reason_detail" IS NULL OR length(btrim("reason_detail")) BETWEEN 1 AND 2000
);--> statement-breakpoint

-- Assert the corrected constraints state their NULL expectation explicitly, so an
-- edit that reintroduces a NULL-satisfiable hole cannot deploy. An INSERT probe was
-- tried first and rejected as evidence: a unique-index violation would land in the
-- same handler as a check violation and report success either way, which is the kind
-- of vacuous test that already wasted one verification run.
DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(conname, ', ') INTO offending
    FROM pg_constraint
    WHERE conname IN (
      'emergency_dispatches_override_check',
      'break_glass_grants_termination_reason_check'
    )
    AND pg_get_constraintdef(oid) NOT LIKE '%IS NOT NULL%';
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'these conditional checks are satisfiable by NULL: %', offending;
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conname IN (
    'emergency_dispatches_override_check',
    'break_glass_grants_termination_reason_check'
  )) <> 2 THEN
    RAISE EXCEPTION 'both corrected constraints must exist';
  END IF;
END $$;--> statement-breakpoint

INSERT INTO schema_compatibility (component, version) VALUES ('identity', 21)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
