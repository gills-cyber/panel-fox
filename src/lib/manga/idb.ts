const DB_NAME = "koma";
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      // v2: version history, one row per snapshot, looked up by project.
      if (!db.objectStoreNames.contains("versions")) {
        const versions = db.createObjectStore("versions", { keyPath: "id" });
        versions.createIndex("projectId", "projectId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqTo<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
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

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbPutVersion(record: unknown) {
  const db = await openDb();
  try {
    const tx = db.transaction("versions", "readwrite");
    tx.objectStore("versions").put(record);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function idbGetVersion<T>(id: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction("versions", "readonly");
    return (await reqTo(tx.objectStore("versions").get(id))) as T | undefined;
  } finally {
    db.close();
  }
}

export async function idbVersionsFor<T>(projectId: string): Promise<T[]> {
  const db = await openDb();
  try {
    const tx = db.transaction("versions", "readonly");
    const rows = await reqTo(tx.objectStore("versions").index("projectId").getAll(projectId));
    return (rows ?? []) as T[];
  } finally {
    db.close();
  }
}

export async function idbDeleteVersions(ids: string[]) {
  if (ids.length === 0) return;
  const db = await openDb();
  try {
    const tx = db.transaction("versions", "readwrite");
    const store = tx.objectStore("versions");
    for (const id of ids) store.delete(id);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function idbDeleteVersionsFor(projectId: string) {
  const db = await openDb();
  try {
    const tx = db.transaction("versions", "readwrite");
    const store = tx.objectStore("versions");
    const keys = await reqTo(store.index("projectId").getAllKeys(projectId));
    for (const key of keys ?? []) store.delete(key);
    await done(tx);
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
