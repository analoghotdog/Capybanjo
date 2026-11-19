/**
 * export-import.js — pure backup/restore logic over the Db interface.
 *
 * Never opens a database itself: every function takes an already-open Db
 * (see src/storage/db.js for the real one, tests/fake-db.js for tests).
 */

import { SCHEMA_VERSION, STORES } from './db.js';

export { SCHEMA_VERSION };

function isPlainObject(value) {
  return value !== null && typeof value === 'object';
}

/**
 * Build a portable backup of every store.
 *
 * options.includeRecordings (default false): when false, the `recording`
 * field (Blob / ArrayBuffer) is stripped from each take before export.
 *
 * Returns:
 *   {
 *     schemaVersion: SCHEMA_VERSION,
 *     exportedAt: <ISO string>,
 *     stores: { settings: [...], calibrations: [...], sessions: [...],
 *               takes: [...], tabs: [...] }
 *   }
 */
export async function buildBackup(db, options = {}) {
  const includeRecordings = options.includeRecordings === true;
  const stores = {};

  for (const name of STORES) {
    const items = await db.getAll(name);
    stores[name] = items.map((item) => {
      if (
        !includeRecordings &&
        name === 'takes' &&
        isPlainObject(item) &&
        Object.prototype.hasOwnProperty.call(item, 'recording')
      ) {
        const { recording, ...rest } = item;
        return rest;
      }
      return item;
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    stores,
  };
}

/**
 * Apply a backup to a database.
 *
 * options.mode:
 *   - 'merge'   (default): put() every item; same id overwrites.
 *   - 'replace': clear() every store first, then put() every item.
 *
 * Items missing an id are skipped (counted in `skipped`).
 *
 * Resolves with { ok, imported, skipped, errors }.
 * Rejects with { ok: false, errors: [...] } when the backup is unusable:
 * missing/too-new schemaVersion, or invalid shape (no `stores` object).
 */
export async function applyBackup(db, backup, options = {}) {
  const errors = [];

  if (!isPlainObject(backup)) {
    throw { ok: false, errors: ['backup is not an object'] };
  }

  if (backup.schemaVersion === undefined || backup.schemaVersion === null) {
    throw { ok: false, errors: ['backup.schemaVersion is missing'] };
  }

  if (backup.schemaVersion > SCHEMA_VERSION) {
    throw {
      ok: false,
      errors: [
        `backup.schemaVersion ${backup.schemaVersion} is newer than supported version ${SCHEMA_VERSION}`,
      ],
    };
  }

  if (!isPlainObject(backup.stores)) {
    throw { ok: false, errors: ['backup.stores is missing or not an object'] };
  }

  const mode = options.mode === 'replace' ? 'replace' : 'merge';

  if (mode === 'replace') {
    for (const name of STORES) {
      await db.clear(name);
    }
  }

  let imported = 0;
  let skipped = 0;

  for (const name of STORES) {
    const items = backup.stores[name];
    if (items === undefined || items === null) continue;
    if (!Array.isArray(items)) {
      errors.push(`backup.stores.${name} is not an array`);
      continue;
    }

    for (const item of items) {
      if (!isPlainObject(item) || item.id === undefined || item.id === null) {
        skipped += 1;
        continue;
      }
      await db.put(name, item);
      imported += 1;
    }
  }

  return { ok: errors.length === 0, imported, skipped, errors };
}

/**
 * Pure summary of a backup for UI display.
 * Returns { counts: { settings, calibrations, sessions, takes, tabs }, total }.
 */
export function backupStats(backup) {
  const counts = {};
  let total = 0;

  for (const name of STORES) {
    const items =
      isPlainObject(backup) &&
      isPlainObject(backup.stores) &&
      Array.isArray(backup.stores[name])
        ? backup.stores[name]
        : [];
    counts[name] = items.length;
    total += items.length;
  }

  return { counts, total };
}
