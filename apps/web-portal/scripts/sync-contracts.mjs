#!/usr/bin/env node
/**
 * Copies the generated OpenAPI TypeScript models into the portal.
 *
 * WHY COPY RATHER THAN IMPORT. The portal is a standalone npm project, not a workspace
 * member of smartcura-backend, so it cannot resolve `@smartcura/contracts`. Copying
 * keeps ONE source of truth — the contract — instead of hand-written response
 * interfaces that drift from the API the moment an endpoint changes. Hand-written
 * duplicates are how a client ends up reading a field the server stopped sending.
 *
 * The copy is generated output and must not be edited: `npm run contracts:check` in the
 * backend regenerates it, and `npm run contracts:verify` here fails if the portal's copy
 * has fallen behind.
 *
 * Usage:
 *   node scripts/sync-contracts.mjs           # copy
 *   node scripts/sync-contracts.mjs --verify  # fail if out of date
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const portalRoot = resolve(here, '..');
// The backend lives at apps/api in this monorepo. An earlier layout called it
// apps/smartcura-backend; if that name ever returns, add it as a fallback here.
const source = resolve(
  portalRoot,
  '..',
  'api',
  'packages',
  'contracts',
  'generated',
  'typescript',
  'models.ts',
);
const target = join(portalRoot, 'src', 'types', 'contracts.ts');
const verify = process.argv.includes('--verify');

if (!existsSync(source)) {
  console.error(`Generated models not found at ${source}`);
  console.error('Run `npm run contracts:check` in apps/api first.');
  process.exit(1);
}

const banner = [
  '// GENERATED FILE - DO NOT EDIT.',
  '// Copied from apps/api/packages/contracts/generated/typescript/models.ts',
  '// Refresh with: npm run contracts:sync',
  '',
].join('\n');

const generated = readFileSync(source, 'utf8');
const contents = `${banner}${generated}`;

if (verify) {
  if (!existsSync(target)) {
    console.error('src/types/contracts.ts is missing. Run `npm run contracts:sync`.');
    process.exit(1);
  }
  if (readFileSync(target, 'utf8') !== contents) {
    console.error('src/types/contracts.ts is out of date with the backend contract.');
    console.error('Run `npm run contracts:sync` and commit the result.');
    process.exit(1);
  }
  console.log('contracts: portal copy matches the generated models');
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, contents, 'utf8');
const schemas = (generated.match(/^export (interface|type) /gm) ?? []).length;
console.log(`contracts: synced ${schemas} generated types into src/types/contracts.ts`);
