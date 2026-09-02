import assert from 'node:assert/strict';
import test from 'node:test';
import { OutboxRepository, type PostgresConnection } from '@smartcura/database';

/**
 * Dead-letter replay.
 *
 * WHY THIS EXISTS. Replay is the one operator action that deliberately re-runs a
 * command the system already gave up on. If it is not idempotent it turns a single
 * stuck notification into a duplicate one, and if it erases failure history the
 * evidence of the original incident is gone. Neither failure is visible from the
 * outside: the endpoint returns 200 either way.
 *
 * There is no PostgreSQL available in this environment, so the transaction is driven
 * through a scripted client that records the statements issued.
 *
 * WHAT THIS PROVES: the decision branches, the statement set, the ordering of the
 * lock before the decision, and the bindings.
 *
 * WHAT IT DOES NOT PROVE, and must not be read as proving: SQL validity, row
 * locking under real concurrency, rollback atomicity, trigger and constraint
 * behaviour, or that any row is actually requeued. The scripted client reports zero
 * affected rows for every write, so a statement that matched nothing would still
 * satisfy these tests. Only a run against real PostgreSQL closes that gap, and this
 * repository has already been bitten twice by constraints that read correctly and
 * were satisfiable by NULL.
 */

interface Recorded { readonly text: string; readonly values: readonly unknown[] }

function connectionReturning(rows: readonly Record<string, unknown>[]): {
  readonly connection: PostgresConnection;
  readonly statements: Recorded[];
} {
  const statements: Recorded[] = [];
  let firstSelect = true;
  const client = {
    async query(text: string, values: readonly unknown[] = []) {
      statements.push({ text, values });
      if (text.includes('SELECT') && firstSelect) {
        firstSelect = false;
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const connection = {
    async transaction<Result>(operation: (used: typeof client) => Promise<Result>) {
      return operation(client);
    },
  } as unknown as PostgresConnection;
  return { connection, statements };
}

const EVENT_ID = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d80';
const ACTOR_ID = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d81';
const input = {
  eventId: EVENT_ID, reasonCode: 'transient_provider_outage',
  actorProfileId: ACTOR_ID, correlationId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d82',
};

test('an unreplayed dead-letter event is requeued, audited and marked replayed', async () => {
  const { connection, statements } = connectionReturning([{ eventId: EVENT_ID }]);
  const outcome = await new OutboxRepository(connection).replayDeadLetter(input);
  assert.equal(outcome, 'replayed');

  const texts = statements.map((statement) => statement.text);
  // The claim is locked before the decision, otherwise two concurrent operators
  // both read replayed_at as null and both requeue the same event.
  assert.match(texts[0]!, /FOR UPDATE/);
  // replayed_at is stamped in the same transaction as the requeue, so a crash
  // between them cannot leave an event replayable twice.
  assert.ok(texts.some((text) => /UPDATE dead_letter_events\s+SET replayed_at = now\(\)/.test(text)));
  assert.ok(texts.some((text) => /UPDATE outbox_events/.test(text) && /status = 'pending'/.test(text)));
  assert.ok(texts.some((text) => /INSERT INTO audit_logs/.test(text)));

  const requeue = statements.find((statement) => /UPDATE outbox_events/.test(statement.text))!;
  // The requeue is scoped to the dead-letter status so it cannot resurrect an
  // event that another worker has meanwhile taken back into processing.
  assert.match(requeue.text, /status = 'dead_letter'/);
  // Attempts restart for the new delivery cycle; last_error_code is cleared so a
  // stale code is not read as the outcome of the replayed attempt.
  assert.match(requeue.text, /attempts = 0/);
  assert.match(requeue.text, /last_error_code = NULL/);

  const audit = statements.find((statement) => /INSERT INTO audit_logs/.test(statement.text))!;
  assert.ok(audit.values.includes(input.reasonCode), 'the replay reason must reach the audit row');
  assert.ok(audit.values.includes(ACTOR_ID), 'the acting operator must be recorded');

  // Every statement must be bound to THIS event. An unbound write would requeue or
  // audit whatever happened to match, which no rowCount check here could reveal.
  for (const statement of statements) {
    assert.ok(statement.values.includes(EVENT_ID),
      `statement is not scoped to the event being replayed: ${statement.text}`);
  }
});

test('replay is refused when the event is not currently dead-lettered', async () => {
  // The locked status transition IS the idempotency guard. A second replay of an event
  // already moved to `pending` finds nothing, so the side effect cannot be delivered
  // twice. An earlier version also refused the row when `replayed_at` was set, which was
  // unreachable here AND made a re-failing event permanently unrecoverable.
  const { connection, statements } = connectionReturning([]);
  const outcome = await new OutboxRepository(connection).replayDeadLetter(input);
  assert.equal(outcome, 'not_found');
  assert.equal(statements.length, 1, 'nothing may be written when there is nothing to recover');
});

test('an event dead-lettered again after a replay can be recovered', async () => {
  // The case that used to be a dead end: a previously replayed event that has failed
  // again is still `dead_letter`, so it must be replayable. `replayed_at` is history,
  // not a lock.
  const { connection, statements } = connectionReturning([{ eventId: EVENT_ID }]);
  const outcome = await new OutboxRepository(connection).replayDeadLetter(input);
  assert.equal(outcome, 'replayed');
  const counted = statements.find((statement) => /UPDATE dead_letter_events/.test(statement.text))!;
  // The count increments rather than being set to 1, so repeated recovery stays visible.
  assert.match(counted.text, /replay_count = replay_count \+ 1/);
});

test('replay preserves the original failure evidence', async () => {
  const { connection, statements } = connectionReturning([{ eventId: EVENT_ID }]);
  await new OutboxRepository(connection).replayDeadLetter(input);
  for (const statement of statements) {
    // Deleting the dead-letter row would requeue the work while destroying the
    // record of why it failed, which is the only trace of the incident.
    assert.doesNotMatch(statement.text, /DELETE\s+FROM\s+dead_letter_events/i);
    assert.doesNotMatch(statement.text, /(attempts|last_error)\s*=\s*NULL\s*,?\s*replayed_at/i);
  }
  const mark = statements.find((statement) => /UPDATE dead_letter_events/.test(statement.text))!;
  assert.doesNotMatch(mark.text, /attempts\s*=/, 'the recorded attempt count must not be rewritten');
});
