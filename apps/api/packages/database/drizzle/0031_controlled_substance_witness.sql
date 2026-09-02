-- Corrective: the controlled-substance witness was documented as mandatory but not enforced.
--
-- Migration `0024` introduces these tables with the comment "Controlled substances get their
-- own append-only register with a mandatory reason and witness", and it enforces the reason,
-- the non-zero delta and that a witness cannot be the actor — "or dual control is theatre".
-- But `witness_profile_id` is nullable and the CHECK is written `witness_profile_id IS NULL OR
-- witness_profile_id <> actor_profile_id`, so omitting the witness entirely satisfies it.
--
-- Dual control that can be skipped by leaving a field out is not dual control. The gap is
-- between the stated intent and the constraint, so the constraint is corrected rather than the
-- comment. A NOT NULL column change is avoided in favour of a CHECK because the check is where
-- the sibling rule already lives, keeping one place to read for this rule.

-- No rows can exist yet in practice, but a corrective migration must say what happens to data
-- admitted by the looser rule. An unwitnessed controlled-substance movement cannot be
-- retroactively witnessed by anyone honestly, so it is refused rather than back-filled: the
-- migration fails loudly and an operator must decide, which is the correct outcome for a
-- controlled-drug record.
DO $$
DECLARE
  unwitnessed integer;
BEGIN
  SELECT count(*) INTO unwitnessed
    FROM controlled_substance_events WHERE witness_profile_id IS NULL;
  IF unwitnessed > 0 THEN
    RAISE EXCEPTION
      'there are % unwitnessed controlled-substance events; they cannot be back-filled and need an operator decision',
      unwitnessed;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "controlled_substance_events"
  DROP CONSTRAINT "controlled_substance_events_witness_check";--> statement-breakpoint
ALTER TABLE "controlled_substance_events"
  ADD CONSTRAINT "controlled_substance_events_witness_check" CHECK (
    "witness_profile_id" IS NOT NULL AND "witness_profile_id" <> "actor_profile_id"
  );--> statement-breakpoint

-- One open register per site and variant. Two registers for one controlled drug at one site
-- would let the same stock be accounted twice, which is precisely what a register exists to
-- prevent.
-- IF NOT EXISTS because 0024 already created the register-event index; asserting an index that
-- may already exist is not a schema change worth failing a deployment over.
CREATE UNIQUE INDEX IF NOT EXISTS "controlled_substance_register_site_variant_uq"
  ON "controlled_substance_register" ("site_id", "variant_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "controlled_substance_events_register_idx"
  ON "controlled_substance_events" ("register_id", "occurred_at");--> statement-breakpoint

INSERT INTO permissions (permission_id, description) VALUES
  ('controlled_substance:manage:site', 'Open controlled-drug registers and record witnessed movements')
ON CONFLICT (permission_id) DO NOTHING;--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('pharmacy', 'controlled_substance:manage:site')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint

DO $$
BEGIN
  -- The witness rule must not be satisfiable by omission.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'controlled_substance_events_witness_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%IS NOT NULL%'
  ) THEN
    RAISE EXCEPTION 'the controlled-substance witness check is still satisfiable by NULL';
  END IF;
  -- Controlled-drug handling stays a pharmacy-site capability; no other role gains it.
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id = 'controlled_substance:manage:site' AND role_id <> 'pharmacy'
  ) THEN
    RAISE EXCEPTION 'controlled-substance handling must remain a pharmacy capability';
  END IF;
END $$;--> statement-breakpoint

INSERT INTO schema_compatibility (component, version) VALUES ('identity', 23)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
