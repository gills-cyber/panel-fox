import { uid } from "@/lib/utils";
import { idbPutProject } from "./idb";
import type { PageState } from "./types";
import { useStudio } from "./store";
import {
  saveNamedProject,
  saveCurrentIfNeeded,
  openNamedProject,
  uniqueProjectName,
  type ProjectDoc,
  type ProjectRecord,
} from "./project";
import {
  deleteVersionRows,
  externalize,
  getVersionRow,
  internalize,
  putVersionRow,
  storageRoom,
  updateVersionRow,
  versionRowsFor,
} from "./versions-db";

/**
 * Version history, the way an NSDocument keeps versions: a snapshot of the
 * whole document on every Save, on autosave a few minutes apart, on demand
 * ("Save a Version"), and of the state a restore replaces. Versions live on
 * the device in their own IndexedDB database; pictures are stored once and
 * shared by every version that uses them.
 */

export type VersionKind = "auto" | "save" | "named" | "restore";

export type VersionRecord = {
  id: string;
  projectId: string;
  savedAt: number;
  kind: VersionKind;
  /** A name the user gave the version; also what a restore point is called. */
  label?: string;
  /** The project's name at the time. */
  name: string;
  pages: number;
  /** The document, with pictures replaced by references into the asset store. */
  doc: ProjectDoc;
  /** The pictures the document refers to (content hashes). */
  assets: string[];
};

export type VersionMeta = Omit<VersionRecord, "doc" | "assets"> & { preview?: PageState };

/** Autosaves this close together fold into one version. */
export const VERSION_GAP_MS = 5 * 60_000;
/** Automatic versions (autosave and Save) kept per project, newest first. */
export const VERSION_KEEP_AUTO = 50;
/** "Before restore" points kept per project. Named versions are kept until deleted. */
export const VERSION_KEEP_RESTORE = 20;
/** Headroom kept on the device beyond what the next save of the project needs. */
const ROOM_MARGIN = 4 * 1024 * 1024;

/** Fired on window after the history of a project changed. */
export const VERSIONS_EVENT = "koma:versions";

const lastStampByProject = new Map<string, number>();
const lastDocByProject = new Map<string, ProjectDoc>();

/** True when nothing in the document changed since `prev` was versioned (same references, same settings). */
function sameDoc(a: ProjectDoc, b: ProjectDoc) {
  return (
    a.pages === b.pages &&
    a.script === b.script &&
    a.cast === b.cast &&
    a.book === b.book &&
    a.chapters === b.chapters &&
    a.currentPageId === b.currentPageId &&
    a.gutter === b.gutter &&
    a.margin === b.margin &&
    a.border === b.border &&
    a.paper === b.paper &&
    a.paperSize === b.paperSize &&
    a.bleed === b.bleed &&
    a.rtl === b.rtl &&
    a.showNumbers === b.showNumbers &&
    a.handInk === b.handInk &&
    a.projectName === b.projectName
  );
}

export function kindLabel(v: Pick<VersionRecord, "kind" | "label">) {
  if (v.label) return v.label;
  switch (v.kind) {
    case "save":
      return "Saved";
    case "named":
      return "Version";
    case "restore":
      return "Before restore";
    default:
      return "Autosaved";
  }
}

function announce(projectId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(VERSIONS_EVENT, { detail: { projectId } }));
}

async function latestStamp(projectId: string) {
  const known = lastStampByProject.get(projectId);
  if (known != null) return known;
  const rows = await versionRowsFor<VersionRecord>(projectId);
  const latest = rows.reduce((m, r) => Math.max(m, r.savedAt), 0);
  lastStampByProject.set(projectId, latest);
  return latest;
}

/** Note that `record` is what the newest version holds, so a no-op save does not add another. */
export function markVersioned(record: ProjectRecord) {
  lastDocByProject.set(record.id, record.doc);
}

/** Drop the oldest automatic versions and restore points past their caps; named ones stay. */
async function prune(projectId: string, extraAutos = 0) {
  const rows = (await versionRowsFor<VersionRecord>(projectId)).sort((a, b) => b.savedAt - a.savedAt);
  const drop: string[] = [];
  let autos = 0;
  let restores = 0;
  for (const r of rows) {
    if (r.kind === "named") continue;
    if (r.kind === "restore") {
      restores += 1;
      if (restores > VERSION_KEEP_RESTORE) drop.push(r.id);
      continue;
    }
    autos += 1;
    if (autos > VERSION_KEEP_AUTO - extraAutos) drop.push(r.id);
  }
  if (drop.length) await deleteVersionRows({ ids: drop });
  return drop.length;
}

/**
 * Keep a version of a just-written project record. Automatic kinds are
 * throttled, skipped when nothing changed, and skipped when the device is
 * nearly full; "named" and "restore" always try. Resolves to the version, or
 * null when none was kept.
 */
export async function recordVersion(
  record: ProjectRecord,
  kind: VersionKind,
  label?: string,
): Promise<VersionRecord | null> {
  const prev = lastDocByProject.get(record.id);
  const automatic = kind === "auto" || kind === "save";
  if (automatic && prev && sameDoc(prev, record.doc)) return null;
  if (kind === "auto") {
    const stamp = await latestStamp(record.id);
    if (record.updatedAt - stamp < VERSION_GAP_MS) return null;
  }
  const { body, hashes, all, freshBytes } = await externalize(record.doc);
  const json = JSON.stringify(body).length;
  if (automatic) {
    // Near the quota, an automatic version first makes room by letting the
    // oldest automatic ones go; if that is not enough it is skipped (the
    // project itself is already saved). The room kept covers this version
    // plus one more save of the whole project.
    let room = await storageRoom();
    const whole = json + all.reduce((n, a) => n + a.size, 0);
    const need = freshBytes + json + whole + ROOM_MARGIN;
    if (room != null && room < need) {
      for (let cut = 10; cut <= VERSION_KEEP_AUTO && room != null && room < need; cut += 10) {
        if (!(await prune(record.id, cut))) break;
        room = await storageRoom();
      }
      if (room != null && room < need) return null;
    }
  }
  const version: VersionRecord = {
    id: uid("ver"),
    projectId: record.id,
    savedAt: record.updatedAt,
    kind,
    label: label?.trim() || undefined,
    name: record.name,
    pages: record.doc.pages.length,
    doc: body,
    assets: hashes,
  };
  await putVersionRow(version, all);
  lastStampByProject.set(record.id, version.savedAt);
  lastDocByProject.set(record.id, record.doc);
  void prune(record.id)
    .catch(() => 0)
    .finally(() => announce(record.id));
  return { ...version, doc: record.doc };
}

export async function listVersions(projectId: string): Promise<VersionMeta[]> {
  const rows = (await versionRowsFor<VersionRecord>(projectId)).sort((a, b) => b.savedAt - a.savedAt);
  return Promise.all(
    rows.map(async ({ doc, assets: _assets, ...meta }) => {
      const page = doc?.pages?.find((p) => p.id === doc.currentPageId) ?? doc?.pages?.[0];
      let preview: PageState | undefined;
      try {
        preview = page ? await internalize(page) : undefined;
      } catch {
        preview = undefined;
      }
      return { ...meta, preview };
    }),
  );
}

/** Save the open document and keep this moment as a version, named or not. */
export async function saveVersionNow(label?: string) {
  const record = await saveNamedProject(undefined, false, false);
  const version = await recordVersion(record, "named", label);
  return { record, version };
}

export async function renameVersion(id: string, label: string) {
  const v = await getVersionRow<VersionRecord>(id);
  if (!v) throw new Error("Version not found");
  const next = { ...v, label: label.trim() || undefined };
  await updateVersionRow(next);
  return next;
}

export async function deleteVersion(id: string) {
  await deleteVersionRows({ ids: [id] });
}

export async function deleteVersionsFor(projectId: string) {
  lastStampByProject.delete(projectId);
  lastDocByProject.delete(projectId);
  await deleteVersionRows({ projectId });
}

async function loadVersion(id: string) {
  const v = await getVersionRow<VersionRecord>(id);
  if (!v) throw new Error("Version not found");
  return { ...v, doc: await internalize(v.doc) };
}

/**
 * Put the open document back to `id`. The state being replaced is kept first
 * as a "Before restore" version, so a restore is never a one-way door; if
 * that cannot be written, nothing is replaced. `saved` is false when the
 * restored document could not be written yet (autosave tries again).
 */
export async function restoreVersion(id: string) {
  const v = await loadVersion(id);
  const s = useStudio.getState();
  if (s.projectId !== v.projectId) throw new Error("That version belongs to another project");
  const before = await saveNamedProject(undefined, false, false);
  await recordVersion(before, "restore", "Before restore");
  s.replaceDocument({ ...v.doc, projectId: v.projectId, projectName: before.name });
  let saved = true;
  try {
    const after = await saveNamedProject(undefined, false, false);
    markVersioned(after);
  } catch {
    saved = false;
  }
  return { version: v, saved };
}

/** A new project made from a version, opened beside the original, which stays as it is. */
export async function restoreVersionAsCopy(id: string) {
  const v = await loadVersion(id);
  const when = new Date(v.savedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const name = await uniqueProjectName(`${v.name} (${when})`);
  const nextId = uid("proj");
  const copy: ProjectRecord = {
    id: nextId,
    name,
    updatedAt: Date.now(),
    doc: { ...v.doc, projectId: nextId, projectName: name },
  };
  await idbPutProject(copy);
  await saveCurrentIfNeeded();
  await openNamedProject(nextId);
  return copy;
}

/** "Today, 1:53 PM", "Yesterday, 9:10 AM", "Oct 9, 1:53 PM". */
export function versionTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return `${date}, ${time}`;
}
