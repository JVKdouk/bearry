/**
 * Durable local storage for the offline-first store.
 *
 * IndexedDB rather than localStorage on purpose: the synced collections are the
 * user's whole workspace (todos, notes, a year of calendar events) and would
 * blow through localStorage's ~5MB ceiling — and localStorage writes are
 * synchronous, so persisting on every keystroke would jank the UI. IDB is async,
 * effectively unbounded, and stores structured values without a JSON round-trip.
 *
 * The API here is deliberately tiny (get/set/del/clear over one key-value store)
 * so callers never deal with transactions or upgrade events. Every operation
 * degrades to a no-op rather than throwing: private-mode browsers and blocked
 * storage must make the app *stateless*, never *broken*.
 */

const DB_NAME = "bearry";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  // Gate on indexedDB itself rather than `window`: workers have IDB without a
  // window, and so does the test environment. Checking `window` made this a
  // silent no-op anywhere outside a page, which is exactly how persistence can
  // appear to work and quietly store nothing.
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null); // storage blocked entirely
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  // IDB yields `undefined` for a missing key; normalize to null so the declared
  // return type is honest and callers can compare against one absent value.
  const v = await withStore<T>("readonly", (s) => s.get(key));
  return v ?? null;
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  await withStore("readwrite", (s) => s.put(value, key));
}

export async function idbDel(key: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(key));
}

export async function idbClear(): Promise<void> {
  await withStore("readwrite", (s) => s.clear());
}

/** True when durable local storage is actually available in this browser. */
export async function idbAvailable(): Promise<boolean> {
  return (await openDb()) !== null;
}

// --- Keys -----------------------------------------------------------------
// Everything is namespaced per user id: a shared device must never show one
// account's cached workspace to the next person who signs in.

export const KEYS = {
  /** The signed-in identity, so the app can boot offline without /users/me. */
  session: "session.v1",
  collections: (userId: string) => `collections.v1:${userId}`,
  cursor: (userId: string) => `cursor.v1:${userId}`,
  outbox: (userId: string) => `outbox.v1:${userId}`,
  captureQueue: (userId: string) => `captureQueue.v1:${userId}`,
};
