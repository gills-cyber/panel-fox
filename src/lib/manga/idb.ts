const DB_NAME = "koma";
// Stays at 1: a tab still running an older build opens this database at
// version 1, and any bump would make every save in that tab fail. New data
// (version history) lives in its own database below.
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = (version?: number) => {
      const req = version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => {
        // A newer build already raised the version: open it as it is.
        if (version != null && req.error?.name === "VersionError") {
          open();
          return;
        }
        reject(req.error);
      };
    };
    open(DB_VERSION);
  });
}

function reqTo<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Write failed"));
    tx.onabort = () => reject(tx.error ?? new DOMException("Write aborted", "AbortError"));
  });
}

export async function idbGet(store: string, key: string): Promise<string | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, "readonly");
    const value = await reqTo(tx.objectStore(store).get(key));
    if (typeof value === "string") return value;
    return value == null ? null : JSON.stringify(value);
  } finally {
    db.close();
  }
}

export async function idbSet(store: string, key: string, value: unknown) {
  const db = await openDb();
  try {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function idbPutProject(record: unknown) {
  const db = await openDb();
  try {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(record);
    // A full disk aborts the transaction (no error event): reject, never hang.
    await done(tx);
  } finally {
    db.close();
  }
}

export async function idbGetProject<T>(id: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction("projects", "readonly");
    return (await reqTo(tx.objectStore("projects").get(id))) as T | undefined;
  } finally {
    db.close();
  }
}

export async function idbAllProjects<T>(): Promise<T[]> {
  const db = await openDb();
  try {
    const tx = db.transaction("projects", "readonly");
    const rows = await reqTo(tx.objectStore("projects").getAll());
    return (rows ?? []) as T[];
  } finally {
    db.close();
  }
}

export async function idbDeleteProject(id: string) {
  const db = await openDb();
  try {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function migrateLocalStorageSession() {
  if (typeof window === "undefined") return;
  try {
    const existing = await idbGet("kv", "koma-studio-v2");
    if (existing) return;
    const old = localStorage.getItem("koma-studio-v2");
    if (old) await idbSet("kv", "koma-studio-v2", old);
  } catch {
    /* ignore */
  }
}
