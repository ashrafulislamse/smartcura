import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from 'pg';

/**
 * Raised when a SERIALIZABLE transaction still conflicts after its bounded
 * retries. This is contention, not a fault: the caller should answer with a stable
 * retryable conflict so a client can try again, rather than a 500.
 */
export class SerializationConflictError extends Error {
  constructor() {
    super('Serializable transaction conflicted after bounded retries');
    this.name = 'SerializationConflictError';
  }
}

export class PostgresConnection {
  readonly #pool: Pool;

  constructor(connectionString: string, timeoutMs: number, applicationName: string) {
    this.#pool = new Pool({
      connectionString,
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
      application_name: applicationName,
      max: 5,
    });
  }

  async isReady(): Promise<boolean> {
    try {
      await this.#pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.#pool.query<Row>(text, [...values]);
  }

  async transaction<Result>(operation: (client: PoolClient) => Promise<Result>): Promise<Result> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async serializableTransaction<Result>(
    operation: (client: PoolClient) => Promise<Result>,
    maxAttempts = 3,
  ): Promise<Result> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const client = await this.#pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        const code = typeof error === 'object' && error !== null
          ? (error as { readonly code?: unknown }).code
          : undefined;
        const contention = code === '40001' || code === '40P01';
        if (!contention) throw error;
        // Exhausting retries is CONTENTION, not a server fault. Raising a
        // distinguishable error lets the API answer with a stable retryable conflict;
        // rethrowing the driver error produced a 500, which real concurrency
        // verification exposed as one loser in a parallel batch.
        if (attempt === maxAttempts) throw new SerializationConflictError();
      } finally {
        client.release();
      }
    }
    throw new SerializationConflictError();
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
