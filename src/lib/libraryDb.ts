const DB_NAME = 'mockup-studio-library';
/** v2 adds content-addressed assets + sync outbox for local-first projects. */
const DB_VERSION = 2;

export type LibraryStore = 'shots' | 'projects' | 'meta' | 'session' | 'assets' | 'outbox';

const ALL_STORES: LibraryStore[] = ['shots', 'projects', 'meta', 'session', 'assets', 'outbox'];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ALL_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

export async function libraryPut(store: LibraryStore, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
  });
  db.close();
}

export async function libraryGet<T>(store: LibraryStore, key: string): Promise<T | null> {
  const db = await openDb();
  const value = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
  });
  db.close();
  return value;
}

export async function libraryDelete(store: LibraryStore, key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
  });
  db.close();
}

export async function libraryKeys(store: LibraryStore): Promise<string[]> {
  const db = await openDb();
  const keys = await new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAllKeys();
    req.onsuccess = () => {
      const result = (req.result ?? [])
        .map((key) => String(key))
        .filter((key) => key.length > 0);
      resolve(result);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB keys failed'));
  });
  db.close();
  return keys;
}

export async function libraryGetAll<T>(store: LibraryStore): Promise<{ key: string; value: T }[]> {
  const db = await openDb();
  const rows = await new Promise<{ key: string; value: T }[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const storeRef = tx.objectStore(store);
    const req = storeRef.openCursor();
    const out: { key: string; value: T }[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      out.push({ key: String(cursor.key), value: cursor.value as T });
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB cursor failed'));
  });
  db.close();
  return rows;
}
