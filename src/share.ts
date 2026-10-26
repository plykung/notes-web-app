// Things shared into Notes (Android share sheet, Chrome on Windows). The service
// worker (public/sw.js) receives the share and keeps it here until the app opens
// it. This is a separate database from the notes (src/store.ts), so wiping the
// device copy for a different account can't lose a share that's waiting.

export const SHARE_DB = "notes-share";
const STORE = "shares";
/** A share nobody opened within a day is dropped. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type SharedFile = { name: string; type: string; blob: Blob };
export type SharedPayload = { title?: string; text?: string; url?: string; files: SharedFile[]; at: number };

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = action(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The waiting share, or null if it's gone or too old. */
export async function readShare(id: string): Promise<SharedPayload | null> {
  const payload = await run<SharedPayload | undefined>("readonly", (s) => s.get(id));
  if (!payload || Date.now() - payload.at > MAX_AGE_MS) return null;
  return payload;
}

export const deleteShare = (id: string) => run("readwrite", (s) => s.delete(id)).then(() => {});
