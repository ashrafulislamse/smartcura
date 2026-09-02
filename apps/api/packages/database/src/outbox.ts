import type { PoolClient } from 'pg';
import { PostgresConnection } from './connection.js';

export interface ClaimedOutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: Record<string, unknown>;
  readonly correlationId?: string;
  readonly attempts: number;
}

export class OutboxRepository {
  constructor(private readonly database: PostgresConnection) {}

  async claim(workerId: string, limit: number, leaseMs: number): Promise<ClaimedOutboxEvent[]> {
    return this.database.transaction(async (client) => {
      const result = await client.query<ClaimedOutboxEvent>({
        text: `WITH candidates AS (
          SELECT event_id FROM outbox_events
          WHERE (status = 'pending' AND available_at <= now())
             OR (status = 'processing' AND lease_expires_at < now())
          ORDER BY occurred_at, event_id
          FOR UPDATE SKIP LOCKED LIMIT $1
        )
        UPDATE outbox_events AS event
        SET status = 'processing', lease_owner = $2,
            lease_expires_at = now() + ($3::text || ' milliseconds')::interval,
            attempts = attempts + 1
        FROM candidates WHERE event.event_id = candidates.event_id
        RETURNING event.event_id AS "eventId", event.event_type AS "eventType",
          event.event_version AS "eventVersion", event.payload,
          event.correlation_id AS "correlationId", event.attempts`,
        values: [limit, workerId, leaseMs],
      });
      return result.rows;
    });
  }

  async complete(eventId: string, workerId: string): Promise<void> {
    await this.database.query(
      `UPDATE outbox_events SET status = 'processed', processed_at = now(),
       lease_owner = NULL, lease_expires_at = NULL
       WHERE event_id = $1 AND status = 'processing' AND lease_owner = $2`,
      [eventId, workerId],
    );
  }

  async fail(
    event: ClaimedOutboxEvent,
    workerId: string,
    errorCode: string,
    maxAttempts: number,
    retryDelayMs: number,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      if (event.attempts >= maxAttempts) {
        await this.moveToDeadLetter(client, event, workerId, errorCode);
        return;
      }
      await client.query(
        `UPDATE outbox_events SET status = 'pending', last_error_code = $3,
         available_at = now() + ($4::text || ' milliseconds')::interval,
         lease_owner = NULL, lease_expires_at = NULL
         WHERE event_id = $1 AND status = 'processing' AND lease_owner = $2`,
        [event.eventId, workerId, errorCode, retryDelayMs],
      );
    });
  }

  /**
   * Requeues a terminal event without changing its identity or deleting failure history.
   *
   * IDEMPOTENCY COMES FROM THE STATUS TRANSITION, not from a replay flag. The row is
   * locked with `FOR UPDATE` while still `dead_letter`; a concurrent second replay
   * blocks, re-evaluates the predicate after the winner commits, sees `pending`, and
   * matches nothing. So a retried request, a double click or a repeated runbook step
   * cannot deliver the side effect twice.
   *
   * An earlier version ALSO refused the row when `replayed_at` was already set. That was
   * wrong in both directions and end-to-end verification found it: the extra check was
   * unreachable on the normal path, because a replayed event is no longer `dead_letter`;
   * and because `replayed_at` was never cleared it acted as a permanent lock, so an event
   * that failed AGAIN after a successful replay could never be recovered. A recovery tool
   * that permanently refuses the second failure is worse than no tool, because an
   * operator only discovers it mid-incident.
   *
   * `replayed_at`/`replay_reason` now describe the LATEST replay and `replay_count`
   * records how many there have been. Per-replay history lives in `audit_logs`, which is
   * append-only, so nothing is lost by overwriting the summary columns.
   */
  async replayDeadLetter(input: {
    readonly eventId: string;
    readonly reasonCode: string;
    readonly actorProfileId: string;
    readonly correlationId: string;
  }): Promise<'replayed' | 'not_found'> {
    return this.database.transaction(async (client) => {
      const deadLetter = await client.query<{ eventId: string }>(
        `SELECT d.event_id AS "eventId"
           FROM dead_letter_events d
           JOIN outbox_events o USING(event_id)
          WHERE d.event_id = $1 AND o.status = 'dead_letter'
          FOR UPDATE OF d, o`,
        [input.eventId],
      );
      // Absent covers both an unknown event and one that is not currently dead-lettered.
      // They are the same answer to the caller: there is nothing here to recover.
      if (deadLetter.rows[0] === undefined) return 'not_found';

      await client.query(
        `UPDATE dead_letter_events
            SET replayed_at = now(), replay_reason = $2, replay_count = replay_count + 1
          WHERE event_id = $1`,
        [input.eventId, input.reasonCode],
      );
      await client.query(
        `UPDATE outbox_events
            SET status = 'pending', available_at = now(), attempts = 0,
                last_error_code = NULL, processed_at = NULL
          WHERE event_id = $1 AND status = 'dead_letter'`,
        [input.eventId],
      );
      await client.query(
        `INSERT INTO audit_logs
         (audit_id,organization_id,actor_profile_id,action,object_type,object_id,reason,correlation_id,metadata)
         VALUES(uuidv7(),NULL,$2,'outbox.dead_letter.replay','outbox_event',$1,$3,$4,'{}'::jsonb)`,
        [input.eventId, input.actorProfileId, input.reasonCode, input.correlationId],
      );
      return 'replayed';
    });
  }

  private async moveToDeadLetter(
    client: PoolClient,
    event: ClaimedOutboxEvent,
    workerId: string,
    errorCode: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO dead_letter_events
       (dead_letter_id, event_id, error_code, attempts)
       VALUES (uuidv7(), $1, $2, $3) ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, errorCode, event.attempts],
    );
    await client.query(
      `UPDATE outbox_events SET status = 'dead_letter', last_error_code = $3,
       lease_owner = NULL, lease_expires_at = NULL
       WHERE event_id = $1 AND status = 'processing' AND lease_owner = $2`,
      [event.eventId, workerId, errorCode],
    );
  }
}
