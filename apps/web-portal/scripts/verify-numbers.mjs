#!/usr/bin/env node
/**
 * Cross-checks the public site's quoted numbers (apps/web-portal/src/lib/site-data.ts)
 * against the generated docs/STATUS.md. Fails if any drift is detected.
 *
 * Run: node apps/web-portal/scripts/verify-numbers.mjs
 *
 * Why this file exists: the public site promises honest numbers and pins a
 * date on them. Drift between press copy and the code that produced the
 * measurement is the trap this script exists to close.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const SITE_DATA = join(ROOT, 'apps', 'web-portal', 'src', 'lib', 'site-data.ts');
const STATUS_MD = join(ROOT, 'docs', 'STATUS.md');

function fail(message) {
  console.error(`\u2717 ${message}`);
  process.exitCode = 1;
}
function ok(message) {
  console.log(`\u2713 ${message}`);
}

/** Reads the MEASURED const out of site-data.ts via regex. */
function parseMeasured(file) {
  const src = readFileSync(file, 'utf8');
  const objectMatch = src.match(/export const MEASURED[^=]*=\s*\{([\s\S]*?)\}\s*as const;/u);
  if (!objectMatch) {
    fail(`could not locate MEASURED const in ${file}`);
    return undefined;
  }
  const body = objectMatch[1];
  const fields = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(\w+):\s*(\d+)\s*,?\s*(?:\/\*.*\*\/)?\s*$/u);
    if (m) fields[m[1]] = Number(m[2]);
  }
  return fields;
}

/** Reads the four auto-generated counts from docs/STATUS.md (only present if regenerated). */
function parseStatus(file) {
  if (!existsSync(file)) return undefined;
  const src = readFileSync(file, 'utf8');
  const between = (suffix) => {
    const re = new RegExp(`^- ${suffix.replace(/\*/g, '\\*')}: \\*\\*?(\\d+)\\*?\\*?(?:[^\\n]*)$`, 'm');
    const m = src.match(re);
    return m ? Number(m[1]) : undefined;
  };
  return {
    operations: between('REST operations'),
    openapiSchemas: readBetween(src, /^- OpenAPI schemas:\s*(\d+)/m),
    migrations: readBetween(src, /^- SQL files:\s*(\d+)/m),
    tables: readBetween(src, /^- Distinct tables declared:\s*(\d+)/m),
  };
}

function readBetween(src, re) {
  const m = src.match(re);
  return m ? Number(m[1]) : undefined;
}

const measured = parseMeasured(SITE_DATA);
if (!measured) {
  fail('unable to parse MEASURED — aborting');
  process.exit(1);
}

console.log('MEASURED (public site):');
for (const [k, v] of Object.entries(measured)) {
  console.log(`  ${k.padEnd(16)} ${v}`);
}
console.log('');

if (!existsSync(STATUS_MD)) {
  console.log('docs/STATUS.md not found — running without drift checks.');
  console.log('Generate it with `node tools/status.mjs` for full coverage.');
  process.exit(0);
}

const status = parseStatus(STATUS_MD);
console.log('docs/STATUS.md (measured):');
for (const [k, v] of Object.entries(status ?? {})) {
  console.log(`  ${k.padEnd(16)} ${v ?? '(missing)'}`);
}
console.log('');

const checks = [
  ['restOperations', 'operations'],
  ['openApiSchemas', 'openapiSchemas'],
  ['migrations', 'migrations'],
  ['tables', 'tables'],
];

for (const [siteKey, statusKey] of checks) {
  const a = measured[siteKey];
  const b = status?.[statusKey];
  if (a === undefined) { fail(`${siteKey} not set in MEASURED`); continue; }
  if (b === undefined) { console.log(`\u00b7 ${siteKey} not present in STATUS.md (regenerate to cover)`); continue; }
  if (a === b) ok(`${siteKey} = ${b} matches MEASURED`);
  else fail(`${siteKey} = ${a} in MEASURED does not match STATUS.md = ${b} — re-measure and update`);
}

console.log('');
console.log('Numbers outside STATUS.md (asserted in AGENTS.md, not auto-generated):');
console.log(`  localTests        ${measured.localTests}    (manual in AGENTS.md latest entry)`);
console.log(`  portalPages       ${measured.portalPages}   (manual in AGENTS.md latest entry)`);
console.log(`  aiPhases          ${measured.aiPhases}      (10 = AI-0..AI-9)`);
console.log(`  surfaces          ${measured.surfaces}      (patient, doctor, driver, web portal)`);
