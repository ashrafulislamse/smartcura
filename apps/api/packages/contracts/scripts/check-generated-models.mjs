import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repoRoot = path.resolve(root, '..', '..', '..');
const isWindows = process.platform === 'win32';
const tscName = isWindows ? 'tsc.cmd' : 'tsc';

function run(command, args, label, cwd = root) {
  console.log(`\n${label}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: isWindows && /\.(cmd|bat)$/i.test(command),
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

const explicitTsc = process.env.TSC?.trim();

function findOnPath(command) {
  const extensions = isWindows ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  return undefined;
}

const installedTsc = [
  path.join(root, 'node_modules', '.bin', tscName),
  path.join(repoRoot, 'apps', 'web-portal', 'node_modules', '.bin', tscName),
].find((candidate) => fs.existsSync(candidate));
const tsc = explicitTsc || installedTsc || findOnPath('tsc');
const dart = process.env.DART?.trim() || findOnPath('dart');
if (!tsc) throw new Error('TypeScript compiler not found. Set TSC or install the pinned contract dependency.');
if (!dart) throw new Error('Dart compiler not found. Set DART or add the Dart SDK to PATH.');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'smartcura-contracts-'));

try {
  run(tsc, ['--project', path.join(root, 'generated', 'typescript', 'tsconfig.json')], 'TypeScript generated-model check');
  const dartRoot = path.join(root, 'generated', 'dart');
  run(dart, ['analyze'], 'Dart generated-package analysis', dartRoot);
  run(dart, ['run', 'tool/compile_check.dart'], 'Dart generated-model runtime smoke check', dartRoot);
  run(
    dart,
    ['compile', 'kernel', 'tool/compile_check.dart', '-o', path.join(temporaryDirectory, 'compile_check.dill')],
    'Dart generated-model compile check',
    dartRoot,
  );
  console.log('\nGenerated TypeScript and Dart models compile successfully.');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
