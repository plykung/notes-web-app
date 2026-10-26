// A tiny key-value store on IndexedDB: notes, images and queued changes live on
// the device so the app works offline. Values may contain Blobs.

const DB_NAME = "notes-web-app";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = action(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const getItem = <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key));
export const setItem = (key: string, value: unknown) => run("readwrite", (s) => s.put(value, key)).then(() => {});
export const removeItem = (key: string) => run("readwrite", (s) => s.delete(key)).then(() => {});
export const allKeys = () => run("readonly", (s) => s.getAllKeys()) as Promise<string[]>;
export const clearAll = () => run("readwrite", (s) => s.clear()).then(() => {});
