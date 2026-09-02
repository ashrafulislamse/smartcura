/**
 * Applies migrations ONE PER TRANSACTION.
 *
 * WHY THIS EXISTS. Drizzle's migrator wraps every pending migration in a single
 * transaction. That is a stronger atomicity guarantee in general, but PostgreSQL
 * forbids using an enum label in the same transaction that added it
 * (`55P04: unsafe use of new value`). Several migrations here are deliberately
 * split into an enum-only file followed by a file that depends on the new labels —
 * `0018`/`0019` for appointments and `0021`/`0022` for IoT — and that split only
 * works if the two files land in DIFFERENT transactions.
 *
 * Applying all of them in one transaction made `0019` fail on `checked_in`, which
 * is exactly the failure this runner removes.
 *
 * Drizzle remains the authority for hashing and journal bookkeeping: each entry is
 * handed to its own `migrate()` call through a single-entry journal, so this file
 * controls batching only. Reimplementing the journal format against a database
 * that already has applied migrations would risk corrupting migration tracking.
 *
 * TRADEOFF, stated plainly: a failure now leaves earlier migrations in this run
 * applied instead of rolling the whole batch back. Each individual migration is
 * still atomic, which is the guarantee that matters for a forward-only migration
 * policy, and it matches how most migration tools behave.
 */

import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

interface JournalEntry {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

interface Journal {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly JournalEntry[];
}

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL is required');
}

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const journal = JSON.parse(
  await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
) as Journal;

const pool = new Pool({
  connectionString,
  application_name: 'smartcura-migrator',
  max: 1,
});

try {
  const database = drizzle(pool);
  let applied = 0;
  for (const entry of [...journal.entries].sort((left, right) => left.idx - right.idx)) {
    // A single-entry journal in a scratch folder. Drizzle compares the entry's
    // `when` against the newest recorded migration, so an already-applied entry is
    // skipped without being re-run.
    const scratch = await mkdtemp(join(tmpdir(), 'smartcura-migration-'));
    const metaDir = join(scratch, 'meta');
    await cp(join(migrationsFolder, 'meta'), metaDir, { recursive: true });
    await writeFile(
      join(metaDir, '_journal.json'),
      JSON.stringify({
        version: journal.version,
        dialect: journal.dialect,
        entries: [entry],
      }),
    );
    await cp(
      join(migrationsFolder, `${entry.tag}.sql`),
      join(scratch, `${entry.tag}.sql`),
    );
    try {
      await migrate(database, { migrationsFolder: scratch });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'database.migration_failed',
        idx: entry.idx,
        tag: entry.tag,
      }));
      throw error;
    }
    applied += 1;
  }
  console.log(JSON.stringify({
    event: 'database.migrations_applied',
    considered: applied,
  }));
} finally {
  await pool.end();
}
