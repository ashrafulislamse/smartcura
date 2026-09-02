#!/usr/bin/env node
/**
 * Counts hand-written source lines per area, excluding dependencies and any
 * generated or build output so the number reflects authored work only.
 *
 * Usage: node tools/count-lines.mjs <rootDir> [...moreRootDirs]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', '.turbo', '.next', 'generated', '.git', 'build', 'out',
  '.dart_tool', 'coverage',
]);
const COUNTED_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.sql', '.json', '.md', '.yaml', '.yml', '.dart'];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), files);
    } else if (COUNTED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

/** Splits a repo-relative path into a reporting group. */
function groupFor(relativePath) {
  const parts = relativePath.split(sep);
  if (parts[0] === 'apps' || parts[0] === 'packages') {
    if (parts[0] === 'packages' && parts[1] === 'database' && parts[2] === 'drizzle') {
      return 'packages/database (migrations)';
    }
    return `${parts[0]}/${parts[1]}`;
  }
  if (parts.length === 1) return 'root config';
  return parts[0];
}

function countLines(file) {
  const text = readFileSync(file, 'utf8');
  const total = text.length === 0 ? 0 : text.split('\n').length;
  let code = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('--')) continue;
    code += 1;
  }
  return { total, code };
}

for (const root of process.argv.slice(2)) {
  if (!statSync(root, { throws: false })) continue;
  const groups = new Map();
  let files = 0;
  let total = 0;
  let code = 0;

  for (const file of walk(root)) {
    const rel = relative(root, file);
    const key = groupFor(rel);
    const counted = countLines(file);
    const bucket = groups.get(key) ?? { files: 0, total: 0, code: 0 };
    bucket.files += 1;
    bucket.total += counted.total;
    bucket.code += counted.code;
    groups.set(key, bucket);
    files += 1;
    total += counted.total;
    code += counted.code;
  }

  console.log(`\n=== ${root} ===`);
  console.log('area'.padEnd(32) + 'files'.padStart(7) + 'lines'.padStart(9) + 'code'.padStart(9));
  for (const [key, value] of [...groups].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      key.padEnd(32) +
      String(value.files).padStart(7) +
      String(value.total).padStart(9) +
      String(value.code).padStart(9),
    );
  }
  console.log('-'.repeat(57));
  console.log('TOTAL'.padEnd(32) + String(files).padStart(7) + String(total).padStart(9) + String(code).padStart(9));
}
