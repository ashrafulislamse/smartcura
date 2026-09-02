#!/usr/bin/env node
/**
 * Compares the tables the drizzle schema DECLARES against the tables the
 * migrations actually CREATE.
 *
 * This exists because `db:generate` cannot be the drift gate for this project.
 * The migrations are hand-written — they contain triggers, partitioned tables and
 * PL/pgSQL functions drizzle cannot express — so drizzle's snapshot baseline does
 * not describe them, and it either reports a false all-clear (when the config
 * cannot see a schema module) or fails outright in its rename resolver.
 *
 * A table declared but never created means code will query something absent. A
 * table created but never declared means the model is blind to it. Both were real
 * defects in this repository, so both are reported.
 *
 * Usage:
 *   node tools/daytona/... schema-inventory.sh   # produces the database list
 *   node tools/schema-drift.mjs <tablesJsonFile>
 *
 * The JSON file holds the array printed between BEGIN_TABLE_JSON/END_TABLE_JSON.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_DIR = 'smartcura-backend/packages/database/src';

/** Partitions are physical children of a declared partitioned table, not models. */
function isPartitionOf(table, declared) {
  return [...declared].some(
    (parent) => table.startsWith(`${parent}_`) &&
      (/^\d{4}_\d{2}$/.test(table.slice(parent.length + 1)) || table === `${parent}_default`),
  );
}

const declared = new Set();
for (const file of readdirSync(SCHEMA_DIR)) {
  if (!file.startsWith('schema') || !file.endsWith('.ts')) continue;
  const text = readFileSync(join(SCHEMA_DIR, file), 'utf8');
  for (const match of text.matchAll(/pgTable\(\s*'([a-z0-9_]+)'/g)) declared.add(match[1]);
}

const [tablesFile] = process.argv.slice(2);
if (!tablesFile) {
  console.error('Usage: node tools/schema-drift.mjs <tablesJsonFile>');
  process.exit(2);
}
const inDatabase = new Set(JSON.parse(readFileSync(tablesFile, 'utf8')));

// drizzle's own bookkeeping table lives in its private schema, not public.
const IGNORED = new Set(['__drizzle_migrations']);

const declaredNotCreated = [...declared].filter((t) => !inDatabase.has(t)).sort();
const createdNotDeclared = [...inDatabase]
  .filter((t) => !declared.has(t) && !IGNORED.has(t) && !isPartitionOf(t, declared))
  .sort();

console.log(`declared tables: ${declared.size}`);
console.log(`tables in database: ${inDatabase.size}`);

if (declaredNotCreated.length > 0) {
  console.log(`\nDECLARED BUT NOT CREATED (${declaredNotCreated.length}) — code would query a missing table:`);
  for (const table of declaredNotCreated) console.log(`  - ${table}`);
}
if (createdNotDeclared.length > 0) {
  console.log(`\nCREATED BUT NOT DECLARED (${createdNotDeclared.length}) — the model is blind to these:`);
  for (const table of createdNotDeclared) console.log(`  - ${table}`);
}

if (declaredNotCreated.length === 0 && createdNotDeclared.length === 0) {
  console.log('\nSCHEMA_DRIFT_OK — declared model and migrations agree.');
  process.exit(0);
}
process.exit(1);
