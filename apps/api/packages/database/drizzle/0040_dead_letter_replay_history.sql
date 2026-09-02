-- 0040: make dead-letter replay recoverable more than once.
--
-- WHY. `replayDeadLetter` selected with `AND o.status = 'dead_letter'` and then refused
-- the row if `dead_letter_events.replayed_at` was already set. Those two conditions
-- cannot both be interesting at once, and together they produced a trap that end-to-end
-- verification found:
--
--   * A successful replay sets the outbox status to 'pending', so the row stops matching
--     the query. The declared `409 DEAD_LETTER_ALREADY_REPLAYED` was therefore
--     UNREACHABLE on the normal path and a second replay answered 404.
--   * `replayed_at` was never cleared, so it behaved as a PERMANENT LOCK rather than as
--     history. An event that failed AGAIN after a successful replay matched the query,
--     was refused as already-replayed, and could never be recovered by an operator.
--     A twice-failing event was a dead end, which is the opposite of what a recovery
--     tool is for.
--
-- The correct guard was already present and doing the work: the status transition under
-- `SELECT ... FOR UPDATE`. Two concurrent replays serialise on the lock, and the loser
-- re-evaluates the predicate after the winner commits, sees 'pending', and matches
-- nothing. Idempotency does not need a second mechanism.
--
-- So `replayed_at`/`replay_reason` become a record of the LATEST replay, and this
-- migration adds the count so repeated recovery of the same event stays visible.
-- `audit_logs` already retains one immutable row per replay with its reason.

ALTER TABLE dead_letter_events
  ADD COLUMN IF NOT EXISTS replay_count integer NOT NULL DEFAULT 0;--> statement-breakpoint

ALTER TABLE dead_letter_events
  DROP CONSTRAINT IF EXISTS dead_letter_replay_count_check;--> statement-breakpoint

ALTER TABLE dead_letter_events
  ADD CONSTRAINT dead_letter_replay_count_check
  CHECK (replay_count >= 0);--> statement-breakpoint

-- A replayed row must carry both the instant and the reason, or neither. A replay with
-- no recorded reason is exactly the audit gap this project has already had to repair in
-- 0029 and 0031.
ALTER TABLE dead_letter_events
  DROP CONSTRAINT IF EXISTS dead_letter_replay_reason_check;--> statement-breakpoint

UPDATE dead_letter_events SET replay_count = 1
  WHERE replayed_at IS NOT NULL AND replay_count = 0;--> statement-breakpoint

UPDATE dead_letter_events SET replay_reason = 'reason_not_recorded'
  WHERE replayed_at IS NOT NULL AND replay_reason IS NULL;--> statement-breakpoint

ALTER TABLE dead_letter_events
  ADD CONSTRAINT dead_letter_replay_reason_check
  CHECK (
    (replayed_at IS NULL AND replay_reason IS NULL AND replay_count = 0)
    OR (replayed_at IS NOT NULL AND replay_reason IS NOT NULL AND replay_count > 0)
  );--> statement-breakpoint

INSERT INTO schema_compatibility(component, version) VALUES ('identity', 28)
  ON CONFLICT(component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();--> statement-breakpoint

-- Prove the paired constraint actually refuses a half-recorded replay, rather than
-- trusting that ADD CONSTRAINT did what it says. This project has twice shipped a CHECK
-- that read correctly and was satisfiable by NULL.
DO $$
DECLARE
  accepted boolean := false;
  probe_event uuid := uuidv7();
BEGIN
  INSERT INTO outbox_events
    (event_id, event_type, event_version, aggregate_type, aggregate_id, aggregate_version,
     payload, correlation_id, status, attempts, occurred_at)
  VALUES (probe_event, 'foundation.probe.v1', 1, 'probe', probe_event, 1,
          '{}'::jsonb, uuidv7(), 'dead_letter', 1, now());

  BEGIN
    INSERT INTO dead_letter_events
      (dead_letter_id, event_id, error_code, attempts, failed_at, replayed_at, replay_count)
    VALUES (uuidv7(), probe_event, 'probe', 1, now(), now(), 1);
    accepted := true;
  EXCEPTION
    WHEN check_violation THEN
      accepted := false;
  END;

  DELETE FROM dead_letter_events WHERE event_id = probe_event;
  DELETE FROM outbox_events WHERE event_id = probe_event;

  IF accepted THEN
    RAISE EXCEPTION 'dead_letter_events accepts a replay with no recorded reason';
  END IF;
END $$;
