/**
 * db.js — IndexedDB wrapper for the banjo practice app (browser only).
 *
 * This module is safe to *import* from Node (it only touches `indexedDB`
 * inside `openDb()`), but the database itself can only be opened in a
 * browser. Node tests exercise the storage logic through the `Db`
 * interface with a fake implementation instead.
 *
 * Db interface:
 *   get(store, id)      -> Promise<value | undefined>
 *   put(store, value)   -> Promise<void>   (value.id is the key; overwrites)
 *   delete(store, id)   -> Promise<void>
 *   getAll(store)       -> Promise<value[]>
 *   clear(store)        -> Promise<void>
 *   close()             -> void
 *   raw                 -> the underlying IDBDatabase
 */

export const SCHEMA_VERSION = 1;

export const DB_NAME = 'banjo-practice';

export const STORES = ['settings', 'calibrations', 'sessions', 'takes', 'tabs'];

/** Promisify an IDBRequest (success/error events). */
function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Run a write request inside its own readwrite transaction and resolve
 * only once the transaction has committed (so writes are durable).
 */
function write(raw, store, issue) {
  return new Promise((resolve, reject) => {
    const tx = raw.transaction(store, 'readwrite');
    issue(tx.objectStore(store));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function wrapDb(raw) {
  return {
    raw,

    async get(store, id) {
      return req(raw.transaction(store, 'readonly').objectStore(store).get(id));
    },

    async getAll(store) {
      return req(raw.transaction(store, 'readonly').objectStore(store).getAll());
    },

    async put(store, value) {
      await write(raw, store, (os) => os.put(value));
    },

    async delete(store, id) {
      await write(raw, store, (os) => os.delete(id));
    },

    async clear(store) {
      await write(raw, store, (os) => os.clear());
    },

    close() {
      raw.close();
    },
  };
}

/**
 * Open (and if needed create/upgrade) the app database.
 * The upgrade function creates any missing stores with keyPath 'id',
 * so future schema versions only need to add to STORES.
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    const idb = globalThis.indexedDB;
    if (!idb) {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }

    const request = idb.open(DB_NAME, SCHEMA_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };

    request.onsuccess = () => resolve(wrapDb(request.result));
    request.onerror = () => reject(request.error ?? new Error('Failed to open database'));
  });
}
