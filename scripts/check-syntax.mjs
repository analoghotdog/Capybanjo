// Syntax check for all first-party source files without executing them
// (browser-only modules cannot run in Node, but they must at least parse).
// Run: node --experimental-vm-modules scripts/check-syntax.mjs
// NOTE: helper script; addition to the C1 layout (see DEVIATIONS.md).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = [
  ...walk(join(root, 'src')).filter((f) => extname(f) === '.js'),
  ...walk(join(root, 'tests')).filter((f) => extname(f) === '.mjs' || extname(f) === '.js'),
  join(root, 'sw.js'),
];

let failed = 0;
for (const f of files) {
  const code = readFileSync(f, 'utf8');
  try {
    // sw.js is a classic service-worker script; everything else is ESM.
    if (f.endsWith('sw.js')) new vm.Script(code, { filename: f });
    else new vm.SourceTextModule(code, { identifier: f });
    console.log(`ok   ${f.slice(root.length + 1)}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${f.slice(root.length + 1)}: ${err.message}`);
  }
}
console.log(failed ? `\n${failed} file(s) failed to parse` : '\nall files parse');
process.exit(failed ? 1 : 0);
