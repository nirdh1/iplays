// Runs the Club OS unit tests (*.test.ts under src/os) with esbuild (already a Vite dependency).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const find = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? find(p) : p.endsWith('.test.ts') ? [p] : [];
});
const out = mkdtempSync(join(tmpdir(), 'os-tests-'));
let failed = false;
for (const file of find('src/os')) {
  const outfile = join(out, file.replace(/[\\/]/g, '_') + '.mjs');
  await build({ entryPoints: [file], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
  console.log(`# ${file}`);
  try {
    execFileSync(process.execPath, [outfile], { stdio: 'inherit' });
  } catch {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
