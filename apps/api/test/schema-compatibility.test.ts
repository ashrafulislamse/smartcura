import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { IDENTITY_SCHEMA_VERSION } from '@smartcura/database';

/**
 * Schema compatibility versions.
 *
 * WHY THIS EXISTS. `schema_compatibility` holds one row per component and readiness
 * requires an EXACT match against a constant in the code, so a build whose schema
 * disagrees reports unready rather than serving traffic against a schema it was not
 * written for. That makes the number load-bearing in two directions, and BOTH failed
 * on the same day:
 *
 *   1. The Stage 11 migrations raised the database to 26 and nobody raised the code
 *      constant, which sat at 24. Every local test passed — the constant and the SQL
 *      are never compared to each other by anything — and the first real symptom was
 *      `GET /api/v1/ready` returning 503 in the sandbox.
 *
 *   2. Those same migrations restarted the sequence at 23 and 24, values already
 *      consumed by 0031 and 0033. Because the upsert is
 *      `DO UPDATE SET version = EXCLUDED.version`, applying 0035 to a database at 24
 *      moved the recorded version BACKWARDS to 23.
 *
 * The database now refuses a regression (0039). This file stops the two definitions
 * drifting apart again, which is the half a trigger cannot police.
 */

const DRIZZLE = new URL('../packages/database/drizzle/', import.meta.url);
const IDENTITY_WRITE = /schema_compatibility\s*\(\s*component,\s*version\s*\)\s*VALUES\s*\(\s*'identity'\s*,\s*(\d+)\s*\)/g;

interface IdentityWrite {
  readonly file: string;
  readonly version: number;
}

function identityWrites(): readonly IdentityWrite[] {
  const writes: IdentityWrite[] = [];
  const files = readdirSync(DRIZZLE)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(new URL(file, DRIZZLE), 'utf8');
    for (const match of sql.matchAll(IDENTITY_WRITE)) {
      writes.push({ file, version: Number(match[1]) });
    }
  }
  return writes;
}

test('the code constant equals the highest identity version any migration writes', () => {
  const writes = identityWrites();
  assert.ok(writes.length > 0, 'no identity compatibility writes were found at all');
  const highest = Math.max(...writes.map((write) => write.version));
  // This is the assertion whose absence produced a 503 in the sandbox: the schema said
  // 26, the code said 24, and nothing local compared them.
  assert.equal(IDENTITY_SCHEMA_VERSION, highest,
    `IDENTITY_SCHEMA_VERSION is ${IDENTITY_SCHEMA_VERSION} but the newest migration writes ${highest}`
    + ` (${writes.find((write) => write.version === highest)?.file}). Raise the constant in the same change as the migration.`);
});

test('no migration after 0039 may lower the identity version', () => {
  // 0035 and 0036 genuinely do regress, and that history is pinned below rather than
  // hidden. From 0039 onward the sequence must be non-decreasing, and the database
  // enforces the same rule at runtime.
  const writes = identityWrites().filter((write) => Number(write.file.slice(0, 4)) >= 39);
  let previous = 0;
  for (const write of writes) {
    assert.ok(write.version >= previous,
      `${write.file} lowers identity from ${previous} to ${write.version}`);
    previous = write.version;
  }
});

test('the historical regression is pinned, so a weakened detector cannot pass quietly', () => {
  // Positive control. If someone edits 0035/0036 to renumber them, this test fails and
  // forces the comments in 0039 and foundation-readiness.ts to be corrected with it,
  // rather than leaving two files describing a defect that no longer exists.
  const writes = identityWrites();
  const at = (file: string) => writes.filter((write) => write.file.startsWith(file)).map((write) => write.version);
  assert.deepEqual(at('0031'), [23], '0031 is the original owner of identity 23');
  assert.deepEqual(at('0033'), [24], '0033 is the original owner of identity 24');
  assert.deepEqual(at('0035'), [23], '0035 re-used 23; if this changed, update the 0039 rationale');
  assert.deepEqual(at('0036'), [24], '0036 re-used 24; if this changed, update the 0039 rationale');
});

test('0039 installs a database guard against version regression', () => {
  const sql = readFileSync(new URL('0039_schema_compatibility_monotonic.sql', DRIZZLE), 'utf8');
  // The trigger is the half that protects a PARTIAL migration run, which is the case
  // that would otherwise leave the schema newer than the number describing it.
  assert.match(sql, /CREATE TRIGGER schema_compatibility_no_regression/);
  assert.match(sql, /BEFORE UPDATE ON schema_compatibility/);
  assert.match(sql, /NEW\.version < OLD\.version/);
  // And the migration proves the guard rather than assuming CREATE TRIGGER worked.
  assert.match(sql, /RAISE EXCEPTION 'schema_compatibility still accepts a version regression'/);
});

test('every migration file is registered in the drizzle journal exactly once', () => {
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', DRIZZLE), 'utf8')) as {
    entries: ReadonlyArray<{ idx: number; tag: string }>;
  };
  const files = readdirSync(DRIZZLE).filter((name) => name.endsWith('.sql')).sort()
    .map((name) => name.replace(/\.sql$/, ''));
  // An unregistered migration is never applied, and the status generator has caught
  // that before. A tag whose prefix disagrees with its index is how the numbering
  // silently drifted earlier in the session.
  assert.deepEqual(journal.entries.map((entry) => entry.tag), files,
    'journal tags must match the .sql files on disk, in order');
  journal.entries.forEach((entry, index) => {
    assert.equal(entry.idx, index, `journal entry ${entry.tag} has idx ${entry.idx}, expected ${index}`);
    assert.ok(entry.tag.startsWith(String(index).padStart(4, '0')),
      `journal entry ${entry.tag} does not start with its index ${index}`);
  });
});
