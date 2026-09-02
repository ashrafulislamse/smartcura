#!/usr/bin/env node
/**
 * Links the newest drizzle snapshot to the previous one in the chain.
 *
 * drizzle-kit validates that snapshots form a single chain: exactly one may have
 * the zero `prevId`. A snapshot minted in a throwaway directory always starts at
 * the root, so adopting it as a baseline collides with `0000_snapshot.json` until
 * its `prevId` points at the snapshot it actually follows.
 *
 * Usage: node tools/relink-snapshot.mjs <metaDir> <targetSnapshot> <parentSnapshot>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [metaDir, target, parent] = process.argv.slice(2);
if (!metaDir || !target || !parent) {
  console.error('Usage: node tools/relink-snapshot.mjs <metaDir> <targetSnapshot> <parentSnapshot>');
  process.exit(2);
}

const parentPath = join(metaDir, parent);
const targetPath = join(metaDir, target);
const parentSnapshot = JSON.parse(readFileSync(parentPath, 'utf8'));
const targetSnapshot = JSON.parse(readFileSync(targetPath, 'utf8'));

if (typeof parentSnapshot.id !== 'string' || parentSnapshot.id.length === 0) {
  console.error(`Refusing to relink: ${parent} has no id.`);
  process.exit(1);
}
if (targetSnapshot.id === parentSnapshot.id) {
  console.error('Refusing to relink: target and parent share an id.');
  process.exit(1);
}

const previous = targetSnapshot.prevId;
targetSnapshot.prevId = parentSnapshot.id;
writeFileSync(targetPath, `${JSON.stringify(targetSnapshot, null, 2)}\n`, 'utf8');
console.log(`${target}: prevId ${previous} -> ${parentSnapshot.id} (${parent})`);
