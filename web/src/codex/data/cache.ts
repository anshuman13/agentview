import { TABLE_FIELDS } from './sync';
import type { SyncRow } from './sync';

export type Cached = { since: number; tables: Record<string, SyncRow[]> };

export const META_KEY = 'meta';
export const LEGACY_KEY = 'snapshot';
export const tableKey = (table: string) => `table:${table}`;
export const rowId = (table: string, key: string) => `row:${table}:${key}`;
export const rowRange = (table: string) => IDBKeyRange.bound(`row:${table}:`, `row:${table}:\uffff`);
// Rows cached before a column existed never get its value unless everything is pulled again.
export const COLUMNS = JSON.stringify(TABLE_FIELDS);

// The browser keeps one record per row and the hub version in IndexedDB, so a reload pulls only rows changed since.
let dbOpen: Promise<IDBDatabase> | undefined;

function cacheDb(): Promise<IDBDatabase> {
  return (dbOpen ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('agentview-codex', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('cache');
    req.onsuccess = () => {
      req.result.onclose = req.result.onversionchange = () => (dbOpen = undefined);
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    dbOpen = undefined;
    throw e;
  }));
}

export async function cacheOp<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await cacheDb();
  return new Promise((resolve, reject) => {
    // Settles on the commit, so a quota error at commit time is not reported as saved.
    const tx = db.transaction('cache', mode);
    const req = op(tx.objectStore('cache'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
  });
}

export async function cacheWrite(ops: (s: IDBObjectStore) => void): Promise<void> {
  const db = await cacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cache', 'readwrite');
    ops(tx.objectStore('cache'));
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
