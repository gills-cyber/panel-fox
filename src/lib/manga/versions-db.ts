/**
 * Storage for version history: its own IndexedDB database, so the shared
 * "koma" database never changes version (a tab on an older build keeps
 * saving). Pictures are stored once, by content hash, in "assets"; a version
 * keeps only references to them, so fifty versions of a heavy manga cost
 * about one copy of its pictures plus fifty small documents.
 */

const DB_NAME = "koma-versions";
const DB_VERSION = 1;
/** Strings this long that are data URLs are stored once and referenced. */
const ASSET_MIN = 2048;
export const ASSET_PREFIX = "koma-asset:";

export type AssetRow = { hash: string; src: string; size: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("versions")) {
        const v = db.createObjectStore("versions", { keyPath: "id" });
        v.createIndex("projectId", "projectId", { unique: false });
      }
      if (!db.objectStoreNames.contains("assets")) {
        db.createObjectStore("assets", { keyPath: "hash" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
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

// ---- hashing ---------------------------------------------------------------

const hashCache = new Map<string, string>();

function fnv(text: string) {
  // 2 x 32-bit FNV-1a, only where Web Crypto is missing (insecure origins).
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `f${text.length.toString(36)}-${a.toString(36)}${b.toString(36)}`;
}

async function hashOf(src: string) {
  const known = hashCache.get(src);
  if (known) return known;
  let hash: string;
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (subtle) {
    const buf = await subtle.digest("SHA-256", new TextEncoder().encode(src));
    hash = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    hash = fnv(src);
  }
  if (hashCache.size > 400) hashCache.clear();
  hashCache.set(src, hash);
  return hash;
}

function isAssetString(v: unknown): v is string {
  return typeof v === "string" && v.length >= ASSET_MIN && v.startsWith("data:");
}

/** Every string in `value` that would be stored as an asset. */
function collectAssets(value: unknown, out: Set<string>) {
  if (isAssetString(value)) {
    out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectAssets(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectAssets(v, out);
  }
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn);
    return out;
  }
  return value;
}

/**
 * Split a document into a small body with references and the pictures it
 * refers to. `fresh` lists the pictures not stored yet, and their bytes.
 */
export async function externalize<T>(doc: T) {
  const found = new Set<string>();
  collectAssets(doc, found);
  const byHash = new Map<string, string>();
  for (const src of found) byHash.set(src, await hashOf(src));
  const body = mapStrings(doc, (s) => {
    const h = byHash.get(s);
    return h ? `${ASSET_PREFIX}${h}` : s;
  }) as T;
  const hashes = [...new Set(byHash.values())];
  const all: AssetRow[] = [];
  const seen = new Set<string>();
  for (const [src, hash] of byHash) {
    if (seen.has(hash)) continue;
    seen.add(hash);
    all.push({ hash, src, size: src.length });
  }
  let freshBytes = 0;
  const fresh: AssetRow[] = [];
  if (hashes.length) {
    const db = await openDb();
    try {
      const tx = db.transaction("assets", "readonly");
      const store = tx.objectStore("assets");
      const have = await Promise.all(hashes.map((h) => reqTo(store.getKey(h))));
      const missing = new Set(hashes.filter((_, i) => have[i] === undefined));
      for (const [src, hash] of byHash) {
        if (!missing.has(hash)) continue;
        missing.delete(hash);
        fresh.push({ hash, src, size: src.length });
        freshBytes += src.length;
      }
    } finally {
      db.close();
    }
  }
  return { body, hashes, all, fresh, freshBytes };
}

/** Put the pictures back into a stored document body. */
export async function internalize<T>(body: T): Promise<T> {
  const wanted = new Set<string>();
  mapStrings(body, (s) => {
    if (s.startsWith(ASSET_PREFIX)) wanted.add(s.slice(ASSET_PREFIX.length));
    return s;
  });
  if (!wanted.size) return body;
  const db = await openDb();
  const found = new Map<string, string>();
  try {
    const tx = db.transaction("assets", "readonly");
    const store = tx.objectStore("assets");
    const rows = await Promise.all([...wanted].map((h) => reqTo(store.get(h) as IDBRequest<AssetRow | undefined>)));
    for (const row of rows) if (row) found.set(row.hash, row.src);
  } finally {
    db.close();
  }
  const missing = [...wanted].filter((h) => !found.has(h));
  if (missing.length) throw new Error("Some pictures of this version are missing");
  return mapStrings(body, (s) =>
    s.startsWith(ASSET_PREFIX) ? (found.get(s.slice(ASSET_PREFIX.length)) ?? s) : s,
  ) as T;
}

// ---- rows ------------------------------------------------------------------

/**
 * Write a version row and any of its pictures not stored yet, in one
 * transaction (so a cleanup running alongside cannot drop one in between).
 */
export async function putVersionRow(row: { id: string; projectId: string; assets: string[] }, all: AssetRow[]) {
  const db = await openDb();
  try {
    const tx = db.transaction(["versions", "assets"], "readwrite");
    const assets = tx.objectStore("assets");
    const have = await Promise.all(all.map((a) => reqTo(assets.getKey(a.hash))));
    all.forEach((a, i) => {
      if (have[i] === undefined) assets.put(a);
    });
    tx.objectStore("versions").put(row);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function updateVersionRow(row: { id: string }) {
  const db = await openDb();
  try {
    const tx = db.transaction("versions", "readwrite");
    tx.objectStore("versions").put(row);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function getVersionRow<T>(id: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction("versions", "readonly");
    return (await reqTo(tx.objectStore("versions").get(id))) as T | undefined;
  } finally {
    db.close();
  }
}

export async function versionRowsFor<T>(projectId: string): Promise<T[]> {
  const db = await openDb();
  try {
    const tx = db.transaction("versions", "readonly");
    const rows = await reqTo(tx.objectStore("versions").index("projectId").getAll(projectId));
    return (rows ?? []) as T[];
  } finally {
    db.close();
  }
}

/**
 * Delete version rows (by id, or every row of a project), then drop the
 * pictures no remaining version refers to.
 */
export async function deleteVersionRows(sel: { ids?: string[]; projectId?: string }) {
  const db = await openDb();
  try {
    const tx = db.transaction(["versions", "assets"], "readwrite");
    const versions = tx.objectStore("versions");
    const assets = tx.objectStore("assets");
    if (sel.ids) for (const id of sel.ids) versions.delete(id);
    if (sel.projectId) {
      const keys = await reqTo(versions.index("projectId").getAllKeys(sel.projectId));
      for (const k of keys ?? []) versions.delete(k);
    }
    const rows = (await reqTo(versions.getAll())) as { assets?: string[] }[];
    const live = new Set(rows.flatMap((r) => r.assets ?? []));
    const stored = (await reqTo(assets.getAllKeys())) as string[];
    for (const h of stored) if (!live.has(h)) assets.delete(h);
    await done(tx);
  } finally {
    db.close();
  }
}

/** Free space left for this site, or null when the browser does not say. */
export async function storageRoom(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || !est.quota) return null;
    return est.quota - (est.usage ?? 0);
  } catch {
    return null;
  }
}
