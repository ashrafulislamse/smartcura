-- 0039: make schema_compatibility monotonic, and correct the identity version.
--
-- WHY THIS MIGRATION EXISTS.
--
-- `schema_compatibility` holds ONE row per component and readiness requires an EXACT
-- match against a constant in the code, so that a build whose schema disagrees reports
-- unready instead of serving traffic against a schema it was not written for. That
-- design is sound, but it makes the recorded number load-bearing, and the upsert every
-- migration uses is:
--
--   INSERT ... ON CONFLICT(component) DO UPDATE SET version = EXCLUDED.version
--
-- which will happily move the version DOWN.
--
-- The Stage 11 migrations restarted the identity sequence at 23 and 24, values already
-- consumed by 0031 and 0033. So applying 0035 to a database sitting at 24 REGRESSED the
-- recorded compatibility to 23, and 0036 only restored 24. Across a full run the end
-- state happened to be correct, which is exactly why nothing failed. The danger is a
-- PARTIAL run: a deployment that applied 0034 and 0035 and then stopped would hold the
-- Stage 11 content tables while permanently reporting compatibility 23 — and readiness
-- would then happily pass for a build that has no idea Stage 11 exists. A version that
-- can go backwards is worse than no version, because it is trusted.
--
-- Two corrections:
--   1. Move identity to 27, above every value any migration has ever written, so the
--      recorded number is unambiguous no matter which order past migrations ran in.
--   2. Refuse a decrease at the database level. A review rule would not have caught
--      this one, because each individual migration looked perfectly reasonable in
--      isolation; only the sequence was wrong.

CREATE OR REPLACE FUNCTION schema_compatibility_forbid_regression()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION
      'schema_compatibility.% cannot move backwards: % -> %',
      OLD.component, OLD.version, NEW.version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS schema_compatibility_no_regression ON schema_compatibility;
CREATE TRIGGER schema_compatibility_no_regression
  BEFORE UPDATE ON schema_compatibility
  FOR EACH ROW
  EXECUTE FUNCTION schema_compatibility_forbid_regression();

-- Raise identity above every previously written value. This must run as an increase so
-- it passes the trigger installed above.
INSERT INTO schema_compatibility(component, version) VALUES ('identity', 27)
  ON CONFLICT(component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();

-- Fail the migration if the guard does not actually hold, rather than trusting that
-- CREATE TRIGGER above did what it says.
DO $$
DECLARE
  regressed boolean := false;
BEGIN
  BEGIN
    UPDATE schema_compatibility SET version = 1 WHERE component = 'identity';
    regressed := true;
  EXCEPTION
    WHEN check_violation THEN
      regressed := false;
  END;

  IF regressed THEN
    RAISE EXCEPTION 'schema_compatibility still accepts a version regression';
  END IF;

  IF (SELECT version FROM schema_compatibility WHERE component = 'identity') <> 27 THEN
    RAISE EXCEPTION 'identity compatibility was not left at 27';
  END IF;
END $$;
