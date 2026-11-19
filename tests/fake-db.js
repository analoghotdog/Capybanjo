/**
 * fake-db.js — in-memory implementation of the Db interface from
 * src/storage/db.js, for exercising pure storage logic under Node.
 *
 * Mirrors IndexedDB semantics: values are structured-cloned on write and
 * read (so callers can't mutate stored state by accident), put() overwrites
 * by id, and the database rejects operations after close().
 */

import { STORES } from '../src/storage/db.js';

export function createFakeDb() {
  const data = new Map(STORES.map((name) => [name, new Map()]));
  let closed = false;

  function storeMap(name) {
    if (closed) throw new Error('database is closed');
    const map = data.get(name);
    if (!map) throw new Error(`unknown object store: ${name}`);
    return map;
  }

  return {
    raw: data,

    async get(store, id) {
      const map = storeMap(store);
      return map.has(id) ? structuredClone(map.get(id)) : undefined;
    },

    async getAll(store) {
      const map = storeMap(store);
      return [...map.values()].map((value) => structuredClone(value));
    },

    async put(store, value) {
      const map = storeMap(store);
      if (value === null || typeof value !== 'object' || value.id === undefined) {
        throw new Error('value must be an object with an id');
      }
      map.set(value.id, structuredClone(value));
    },

    async delete(store, id) {
      storeMap(store).delete(id);
    },

    async clear(store) {
      storeMap(store).clear();
    },

    close() {
      closed = true;
    },
  };
}
