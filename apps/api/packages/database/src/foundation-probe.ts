import { PostgresConnection } from './connection.js';

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL is required');
}

const database = new PostgresConnection(connectionString, 2_000, 'smartcura-foundation-probe');
let rollbackProbeId = '';

try {
  try {
    await database.transaction(async (client) => {
      const ids = await client.query<{ probeId: string }>('SELECT uuidv7() AS "probeId"');
      rollbackProbeId = ids.rows[0]!.probeId;
      await client.query(
        'INSERT INTO foundation_transaction_probes (probe_id, marker) VALUES ($1, $2)',
        [rollbackProbeId, 'rollback-check'],
      );
      throw new Error('intentional rollback');
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'intentional rollback') throw error;
  }

  const rollbackCheck = await database.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM foundation_transaction_probes WHERE probe_id = $1',
    [rollbackProbeId],
  );
  if (rollbackCheck.rows[0]?.count !== '0') throw new Error('Rollback verification failed');

  const eventId = await database.transaction(async (client) => {
    const ids = await client.query<{ probeId: string; eventId: string; correlationId: string }>(
      'SELECT uuidv7() AS "probeId", uuidv7() AS "eventId", uuidv7() AS "correlationId"',
    );
    const id = ids.rows[0]!;
    await client.query(
      'INSERT INTO foundation_transaction_probes (probe_id, marker) VALUES ($1, $2)',
      [id.probeId, 'commit-check'],
    );
    await client.query(
      `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, payload, correlation_id, occurred_at)
       VALUES ($1, 'foundation.probe.v1', 1, 'foundation_probe', $2, 1, $3, $4, now())`,
      [id.eventId, id.probeId, JSON.stringify({ probe_id: id.probeId }), id.correlationId],
    );
    return id.eventId;
  });

  console.log(JSON.stringify({ event: 'foundation.probe_committed', eventId, rollbackVerified: true }));
} finally {
  await database.close();
}
