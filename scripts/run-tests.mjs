// Runs every compiled *.test.js under dist/ with node:test.
// Node 18/20 treat `--test` arguments as paths and Node 21+ as globs, so we
// resolve the file list ourselves to behave the same on every supported version.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

function collect(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collect(full));
    else if (entry.name.endsWith('.test.js')) files.push(full);
  }
  return files;
}

const files = collect(dist).sort();
if (files.length === 0) {
  console.error('No test files found under dist/. Run "npm run build" first.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
