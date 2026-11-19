import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCHEMA_VERSION, STORES } from '../src/storage/db.js';
import {
  buildBackup,
  applyBackup,
  backupStats,
} from '../src/storage/export-import.js';
import { createFakeDb } from './fake-db.js';

// ---------- helpers ----------

const bytes = (buf) => Buffer.from(buf).toString('hex');

function recordingBuffer() {
  return new Uint8Array([1, 2, 3, 4, 250]).buffer;
}

/** Seed a fake db with one item per store; one take carries a recording. */
async function seed(db) {
  const fixtures = {
    settings: [{ id: 'global', theme: 'dark', tempo: 80 }],
    calibrations: [{ id: 'cal1', micGain: 0.7, at: '2026-11-01T00:00:00.000Z' }],
    sessions: [
      { id: 's1', startedAt: '2026-11-10T10:00:00.000Z', tabId: 't1' },
      { id: 's2', startedAt: '2026-11-11T10:00:00.000Z', tabId: 't2' },
    ],
    takes: [
      { id: 'take1', sessionId: 's1', score: 0.9, recording: recordingBuffer() },
      { id: 'take2', sessionId: 's1', score: 0.5 },
    ],
    tabs: [{ id: 't1', title: 'Cripple Creek', tuning: 'openG', notes: [] }],
  };
  for (const [store, items] of Object.entries(fixtures)) {
    for (const item of items) await db.put(store, item);
  }
  return fixtures;
}

async function clearAll(db) {
  for (const store of STORES) await db.clear(store);
}

async function snapshot(db) {
  const out = {};
  for (const store of STORES) out[store] = await db.getAll(store);
  return out;
}

/** deepEqual but comparing ArrayBuffers by bytes. */
function assertStoresEqual(actual, expected, message) {
  const norm = (stores) =>
    Object.fromEntries(
      Object.entries(stores).map(([name, items]) => [
        name,
        items.map((item) => {
          if (item && typeof item === 'object' && item.recording instanceof ArrayBuffer) {
            const { recording, ...rest } = item;
            return { ...rest, recording: bytes(recording) };
          }
          return item;
        }),
      ]),
    );
  assert.deepEqual(norm(actual), norm(expected), message);
}

// ---------- buildBackup ----------

test('buildBackup strips recording from takes by default', async () => {
  const db = createFakeDb();
  const fixtures = await seed(db);

  const backup = await buildBackup(db);

  assert.equal(backup.schemaVersion, SCHEMA_VERSION);
  assert.ok(!Number.isNaN(Date.parse(backup.exportedAt)), 'exportedAt is a valid ISO date');
  for (const store of STORES) {
    assert.ok(Array.isArray(backup.stores[store]), `stores.${store} is an array`);
  }

  const take1 = backup.stores.takes.find((t) => t.id === 'take1');
  assert.ok(take1, 'take1 exported');
  assert.ok(!('recording' in take1), 'recording stripped from take1');
  assert.equal(take1.score, 0.9, 'other fields preserved');

  // take2 has no recording: unchanged
  const take2 = backup.stores.takes.find((t) => t.id === 'take2');
  assert.deepEqual(take2, { id: 'take2', sessionId: 's1', score: 0.5 });

  // export must not mutate the database (fake db clones on read too)
  const stored = await db.get('takes', 'take1');
  assert.ok(stored.recording instanceof ArrayBuffer, 'original take still has its recording');
  assert.equal(bytes(stored.recording), bytes(fixtures.takes[0].recording));
});

test('buildBackup keeps recording when includeRecordings is true', async () => {
  const db = createFakeDb();
  await seed(db);

  const backup = await buildBackup(db, { includeRecordings: true });

  const take1 = backup.stores.takes.find((t) => t.id === 'take1');
  assert.ok(take1.recording instanceof ArrayBuffer, 'recording kept');
  assert.equal(bytes(take1.recording), bytes(recordingBuffer()));
  assert.equal(backup.stores.takes.length, 2);
});

// ---------- applyBackup: merge round-trip ----------

test('round-trip without recordings: merge restores data minus recording', async () => {
  const db = createFakeDb();
  const fixtures = await seed(db);

  const backup = await buildBackup(db);
  await clearAll(db);

  const result = await applyBackup(db, backup, { mode: 'merge' });
  assert.deepEqual(result, { ok: true, imported: 7, skipped: 0, errors: [] });

  const restored = await snapshot(db);
  const expected = {
    settings: fixtures.settings,
    calibrations: fixtures.calibrations,
    sessions: fixtures.sessions,
    takes: [
      { id: 'take1', sessionId: 's1', score: 0.9 }, // recording stripped
      fixtures.takes[1],
    ],
    tabs: fixtures.tabs,
  };
  assertStoresEqual(restored, expected);
});

test('round-trip with recordings keeps the recording bytes', async () => {
  const db = createFakeDb();
  const fixtures = await seed(db);

  const backup = await buildBackup(db, { includeRecordings: true });
  await clearAll(db);

  const result = await applyBackup(db, backup);
  assert.equal(result.ok, true);
  assert.equal(result.imported, 7);

  const take1 = await db.get('takes', 'take1');
  assert.ok(take1.recording instanceof ArrayBuffer);
  assert.equal(bytes(take1.recording), bytes(fixtures.takes[0].recording));
});

test('merge overwrites same id and keeps pre-existing items', async () => {
  const db = createFakeDb();
  await db.put('settings', { id: 'keep', value: 'old' });

  const backup = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    stores: {
      settings: [{ id: 'keep', value: 'new' }, { id: 'added', value: 1 }],
    },
  };

  const result = await applyBackup(db, backup, { mode: 'merge' });
  assert.equal(result.imported, 2);

  const settings = await db.getAll('settings');
  assert.deepEqual(settings, [
    { id: 'keep', value: 'new' }, // overwritten
    { id: 'added', value: 1 },
  ]);
});

// ---------- applyBackup: replace ----------

test('replace mode clears stale items before importing', async () => {
  const db = createFakeDb();
  await seed(db);
  await db.put('sessions', { id: 'stale', startedAt: '2020-01-01T00:00:00.000Z' });
  await db.put('tabs', { id: 'stale-tab', title: 'old' });

  const backup = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    stores: {
      sessions: [{ id: 's1', startedAt: '2026-11-10T10:00:00.000Z', tabId: 't1' }],
    },
  };

  const result = await applyBackup(db, backup, { mode: 'replace' });
  assert.equal(result.ok, true);
  assert.equal(result.imported, 1);

  assert.deepEqual(await db.getAll('sessions'), [
    { id: 's1', startedAt: '2026-11-10T10:00:00.000Z', tabId: 't1' },
  ]);
  assert.deepEqual(await db.getAll('tabs'), [], 'stale items in other stores cleared too');
  assert.deepEqual(await db.getAll('settings'), [], 'all stores cleared');
  assert.deepEqual(await db.getAll('calibrations'), []);
  assert.deepEqual(await db.getAll('takes'), []);
});

// ---------- applyBackup: validation ----------

test('rejects when schemaVersion is missing', async () => {
  const db = createFakeDb();
  const backup = { stores: { settings: [] } };

  await assert.rejects(
    () => applyBackup(db, backup),
    (err) => {
      assert.equal(err.ok, false);
      assert.ok(Array.isArray(err.errors) && err.errors.length > 0);
      assert.match(err.errors[0], /schemaVersion is missing/);
      return true;
    },
  );
});

test('rejects when schemaVersion is newer than supported', async () => {
  const db = createFakeDb();
  const backup = { schemaVersion: SCHEMA_VERSION + 1, stores: { settings: [] } };

  await assert.rejects(
    () => applyBackup(db, backup),
    (err) => {
      assert.equal(err.ok, false);
      assert.match(err.errors[0], /newer than supported/);
      return true;
    },
  );

  // nothing must have been written
  assert.deepEqual(await db.getAll('settings'), []);
});

test('rejects when stores object is missing', async () => {
  const db = createFakeDb();
  const backup = { schemaVersion: SCHEMA_VERSION };

  await assert.rejects(
    () => applyBackup(db, backup),
    (err) => {
      assert.equal(err.ok, false);
      assert.match(err.errors[0], /stores is missing/);
      return true;
    },
  );
});

test('items without an id are skipped', async () => {
  const db = createFakeDb();
  const backup = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    stores: {
      settings: [{ id: 'ok', v: 1 }, { v: 2 }, null, { id: 'ok2', v: 3 }],
    },
  };

  const result = await applyBackup(db, backup);
  assert.deepEqual(result, { ok: true, imported: 2, skipped: 2, errors: [] });
  assert.deepEqual(await db.getAll('settings'), [
    { id: 'ok', v: 1 },
    { id: 'ok2', v: 3 },
  ]);
});

// ---------- backupStats ----------

test('backupStats reports per-store counts and total', async () => {
  const db = createFakeDb();
  await seed(db);
  const backup = await buildBackup(db);

  const stats = backupStats(backup);
  assert.deepEqual(stats.counts, {
    settings: 1,
    calibrations: 1,
    sessions: 2,
    takes: 2,
    tabs: 1,
  });
  assert.equal(stats.total, 7);

  // pure / tolerant of empty input
  assert.deepEqual(backupStats({}).counts.settings, 0);
  assert.equal(backupStats({}).total, 0);
});
