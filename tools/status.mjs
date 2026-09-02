#!/usr/bin/env node
/**
 * Regenerates docs/STATUS.md from MEASURED facts only.
 *
 * Every hand-maintained status document in this repository went stale and started
 * contradicting the code. So this file reports only things it can count or read
 * right now: line counts, migration/journal/snapshot consistency, declared API
 * operations, duplicate table declarations, and which verification suites exist.
 *
 * It deliberately does NOT record whether anything "works". Claims of working
 * behaviour belong in the implementation-plan log next to their evidence, because
 * a generator cannot verify them.
 *
 * Usage: node tools/status.mjs
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
// Monorepo paths after the apps/* restructure. STATUS.md is regenerated from
// these, so the labels follow the folders rather than the old repo names.
const BACKEND = 'apps/api';
const PORTAL = 'apps/web-portal';
const FLUTTER_APPS = ['apps/patient-app', 'apps/doctor-app', 'apps/driver-app'];
const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', '.turbo', '.next', 'generated', '.git', 'build', 'out',
  '.dart_tool', 'coverage',
]);
const GENERATED_FILES = new Set(['package-lock.json', 'pubspec.lock']);

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), files);
    } else {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

function lineCount(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

/** Counts authored source, separating out files a tool wrote. */
function measureProject(dir, extensions) {
  let files = 0;
  let authored = 0;
  let generated = 0;
  for (const file of walk(join(ROOT, dir))) {
    if (!extensions.some((ext) => file.endsWith(ext))) continue;
    const lines = lineCount(file);
    const name = file.split(sep).at(-1) ?? '';
    // drizzle `meta/` snapshots are emitted by drizzle-kit, not written by hand.
    const isGenerated = GENERATED_FILES.has(name) || file.includes(`${sep}meta${sep}`);
    if (isGenerated) generated += lines;
    else {
      authored += lines;
      files += 1;
    }
  }
  return { files, authored, generated };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  } catch {
    return undefined;
  }
}

/** Migration files, journal entries and snapshots must agree or generation breaks. */
function measureMigrations() {
  const dir = join(ROOT, BACKEND, 'packages/database/drizzle');
  if (!existsSync(dir)) return undefined;
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const metaDir = join(dir, 'meta');
  const snapshots = existsSync(metaDir)
    ? readdirSync(metaDir).filter((f) => f.endsWith('_snapshot.json')).sort()
    : [];
  const journal = readJson(`${BACKEND}/packages/database/drizzle/meta/_journal.json`);
  const tags = (journal?.entries ?? []).map((e) => e.tag);
  const unjournalled = sql.map((f) => f.replace(/\.sql$/, '')).filter((t) => !tags.includes(t));
  // The inverse fault, and the more dangerous one: a journal entry whose SQL file
  // is absent makes `db:migrate` fail outright on a fresh database. An interrupted
  // agent left exactly this state once, and nothing detected it.
  const missingSqlFiles = tags.filter((t) => !sql.includes(`${t}.sql`));
  // Only the newest snapshot matters for generation: drizzle-kit diffs the
  // declared schema against the latest one. Hand-written migrations never
  // produced intermediate snapshots, and fabricating them would be inventing
  // history, so their absence is not reported as a fault. What IS a fault is the
  // newest migration having no snapshot, because then `db:generate` has nothing
  // correct to diff against.
  const newestTag = tags.at(-1);
  const latestSnapshotMissing = newestTag !== undefined &&
    !snapshots.includes(`${newestTag.slice(0, 4)}_snapshot.json`);
  const missingSnapshots = latestSnapshotMissing && newestTag !== undefined ? [newestTag] : [];
  return {
    sqlCount: sql.length,
    journalCount: tags.length,
    snapshotCount: snapshots.length,
    unjournalled,
    missingSqlFiles,
    missingSnapshots,
    latest: sql.at(-1)?.replace(/\.sql$/, '') ?? 'none',
  };
}

/** Declared REST operations, which is the most honest measure of API surface. */
function measureContracts() {
  const openapi = readJson(`${BACKEND}/packages/contracts/openapi/openapi.json`);
  const asyncapi = readJson(`${BACKEND}/packages/contracts/asyncapi/asyncapi.json`);
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
  let operations = 0;
  const paths = openapi?.paths ?? {};
  for (const item of Object.values(paths)) {
    for (const key of Object.keys(item ?? {})) if (methods.has(key)) operations += 1;
  }
  return {
    operations,
    paths: Object.keys(paths).length,
    openapiSchemas: Object.keys(openapi?.components?.schemas ?? {}).length,
    asyncapiChannels: Object.keys(asyncapi?.channels ?? {}).length,
    asyncapiSchemas: Object.keys(asyncapi?.components?.schemas ?? {}).length,
  };
}

/**
 * Finds tables declared more than once, and tables the drizzle config cannot see.
 * Both conditions silently corrupt migration generation, so they are surfaced
 * rather than left to be discovered by a failed deployment.
 */
function measureSchemaDeclarations() {
  const dir = join(ROOT, BACKEND, 'packages/database/src');
  if (!existsSync(dir)) return undefined;
  const declarations = new Map();
  const schemaFiles = readdirSync(dir).filter((f) => f.startsWith('schema') && f.endsWith('.ts'));
  for (const file of schemaFiles) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const match of text.matchAll(/pgTable\(\s*'([a-z0-9_]+)'/g)) {
      const list = declarations.get(match[1]) ?? [];
      list.push(file);
      declarations.set(match[1], list);
    }
  }
  const config = existsSync(join(ROOT, BACKEND, 'packages/database/drizzle.config.ts'))
    ? readFileSync(join(ROOT, BACKEND, 'packages/database/drizzle.config.ts'), 'utf8')
    : '';
  const invisible = schemaFiles.filter((f) => !config.includes(f));
  const duplicates = [...declarations]
    .filter(([, files]) => files.length > 1)
    .map(([table, files]) => `${table} (${files.join(', ')})`);
  return {
    schemaFiles,
    tableCount: declarations.size,
    duplicates,
    invisibleToGenerator: invisible,
  };
}

function measureVerificationSuites() {
  const dir = join(ROOT, 'tools/daytona');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('verify-'))
    .map((f) => ({ name: f, lines: lineCount(join(dir, f)) }));
}

const backend = measureProject(BACKEND, ['.ts', '.sql', '.json', '.mjs', '.yaml', '.yml']);
const portal = measureProject(PORTAL, ['.ts', '.tsx', '.js', '.json']);
const flutter = FLUTTER_APPS.map((app) => ({ app, ...measureProject(app, ['.dart']) }));
const migrations = measureMigrations();
const contracts = measureContracts();
const schema = measureSchemaDeclarations();
const suites = measureVerificationSuites();

const warnings = [];
if (migrations?.unjournalled.length) {
  warnings.push(
    `${migrations.unjournalled.length} migration(s) are NOT in the journal and will never be applied: ${migrations.unjournalled.join(', ')}`,
  );
}
if (migrations?.missingSqlFiles.length) {
  warnings.push(
    `${migrations.missingSqlFiles.length} journal entr(ies) have NO matching .sql file, so \`db:migrate\` will fail on a fresh database: ${migrations.missingSqlFiles.join(', ')}`,
  );
}
if (migrations?.missingSnapshots.length) {
  warnings.push(
    `the newest migration has no drizzle snapshot, so \`db:generate\` has no correct baseline: ${migrations.missingSnapshots.join(', ')}`,
  );
}
if (schema?.duplicates.length) {
  warnings.push(
    `${schema.duplicates.length} table(s) are declared more than once: ${schema.duplicates.join('; ')}`,
  );
}
if (schema?.invisibleToGenerator.length) {
  warnings.push(
    `drizzle.config.ts does not reference ${schema.invisibleToGenerator.length} schema file(s), so \`db:generate\` cannot see their tables and reports a false all-clear: ${schema.invisibleToGenerator.join(', ')}`,
  );
}

const generatedAt = new Date().toISOString();
const lines = [
  '# Project status (generated)',
  '',
  '> Regenerate with `node tools/status.mjs`. Do not edit by hand: every',
  '> hand-maintained status file in this repository has gone stale and started',
  '> contradicting the code.',
  '>',
  '> This file reports only what can be measured right now. It makes NO claim that',
  '> any feature works. Evidence of verified behaviour belongs in the',
  '> implementation log in `docs/04_TECHNICAL_SPECIFICATIONS/Backend_Implementation_Plan.md`.',
  '',
  `Generated: ${generatedAt}`,
  '',
];

if (warnings.length > 0) {
  lines.push('## Consistency warnings', '');
  for (const warning of warnings) lines.push(`- ${warning}`);
  lines.push('');
} else {
  lines.push('## Consistency warnings', '', 'None detected.', '');
}

lines.push(
  '## Authored source size',
  '',
  'Generated files (lockfiles, drizzle snapshots) are excluded from the authored column.',
  '',
  '| Project | Files | Authored lines | Generated lines |',
  '|---|---:|---:|---:|',
  `| ${BACKEND} | ${backend.files} | ${backend.authored} | ${backend.generated} |`,
  `| ${PORTAL} | ${portal.files} | ${portal.authored} | ${portal.generated} |`,
);
for (const app of flutter) {
  lines.push(`| ${app.app} | ${app.files} | ${app.authored} | ${app.generated} |`);
}
lines.push('');

lines.push(
  '## Declared API surface',
  '',
  `- REST operations: **${contracts.operations}** across ${contracts.paths} paths`,
  `- OpenAPI schemas: ${contracts.openapiSchemas}`,
  `- AsyncAPI channels: ${contracts.asyncapiChannels}, schemas: ${contracts.asyncapiSchemas}`,
  '',
  'Operation count is the most honest measure of how much API exists: a repository',
  'with no route reachable through it serves no client.',
  '',
);

if (migrations !== undefined) {
  lines.push(
    '## Migrations',
    '',
    `- SQL files: ${migrations.sqlCount}`,
    `- Journal entries: ${migrations.journalCount}`,
    `- Snapshots: ${migrations.snapshotCount}`,
    `- Latest: \`${migrations.latest}\``,
    '',
  );
}

if (schema !== undefined) {
  lines.push(
    '## Declared tables',
    '',
    `- Distinct tables declared: ${schema.tableCount}`,
    `- Schema files: ${schema.schemaFiles.join(', ')}`,
    '',
  );
}

lines.push('## Verification suites present', '');
if (suites.length === 0) lines.push('None found under `tools/daytona`.');
else for (const suite of suites) lines.push(`- \`${suite.name}\` (${suite.lines} lines)`);
lines.push('');

writeFileSync(join(ROOT, 'docs/STATUS.md'), `${lines.join('\n')}\n`, 'utf8');
console.log(`docs/STATUS.md regenerated (${warnings.length} warning(s))`);
for (const warning of warnings) console.log(`  WARN ${warning}`);
