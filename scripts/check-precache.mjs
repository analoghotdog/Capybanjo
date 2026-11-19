// Verifies that sw.js's PRECACHE list covers every file the app needs and that
// every PRECACHE entry exists on disk. Fails (exit 1) on any mismatch.
// Run: node scripts/check-precache.mjs

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const toPosix = (p) => p.split(sep).join('/');

// Every file the app needs at runtime: root shell files, icons, all of src/.
const needed = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  ...walk(join(root, 'icons')).map((p) => toPosix(p.slice(root.length + 1))),
  ...walk(join(root, 'src')).map((p) => toPosix(p.slice(root.length + 1))),
];

const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const block = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw);
if (!block) {
  console.error('FAIL: could not find PRECACHE in sw.js');
  process.exit(1);
}
const entries = [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);

const errors = [];
const entrySet = new Set(entries);

for (const file of needed) {
  if (!entrySet.has(file)) errors.push(`missing from PRECACHE: ${file}`);
}
for (const entry of entries) {
  if (entry === './') continue;
  if (!existsSync(join(root, entry))) errors.push(`PRECACHE entry does not exist: ${entry}`);
}
if (!entrySet.has('./')) errors.push("PRECACHE must contain './' (the app shell)");

if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  process.exit(1);
}
console.log(`precache ok: ${entries.length} entries cover all ${needed.length} runtime files`);
