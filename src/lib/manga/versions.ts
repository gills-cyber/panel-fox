import { uid } from "@/lib/utils";
import {
  idbDeleteVersions,
  idbDeleteVersionsFor,
  idbGetVersion,
  idbPutProject,
  idbPutVersion,
  idbVersionsFor,
} from "./idb";
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

/**
 * Version history, the way an NSDocument keeps versions: a snapshot of the
 * whole document on every Save, on autosave a few minutes apart, on demand
 * ("Save a Version"), and of the state a restore replaces. Versions live in
 * IndexedDB beside the projects and never leave the device.
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
  doc: ProjectDoc;
};

export type VersionMeta = Omit<VersionRecord, "doc"> & { preview?: PageState };

/** Autosaves this close together fold into one version. */
export const VERSION_GAP_MS = 5 * 60_000;
/** Automatic versions kept per project, newest first; named ones are kept until deleted. */
export const VERSION_KEEP_AUTO = 50;
const VERSION_KEEP_ALL = 120;

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

async function latestStamp(projectId: string) {
  const known = lastStampByProject.get(projectId);
  if (known != null) return known;
  const rows = await idbVersionsFor<VersionRecord>(projectId);
  const latest = rows.reduce((m, r) => Math.max(m, r.savedAt), 0);
  lastStampByProject.set(projectId, latest);
  return latest;
}

/** Note that `record` is what the newest version holds, so a no-op save does not add another. */
export function markVersioned(record: ProjectRecord) {
  lastDocByProject.set(record.id, record.doc);
}

async function prune(projectId: string) {
  const rows = (await idbVersionsFor<VersionRecord>(projectId)).sort((a, b) => b.savedAt - a.savedAt);
  const drop: string[] = [];
  let autos = 0;
  rows.forEach((r, i) => {
    if (i >= VERSION_KEEP_ALL) {
      drop.push(r.id);
      return;
    }
    if (r.kind === "named" || r.kind === "restore") return;
    autos += 1;
    if (autos > VERSION_KEEP_AUTO) drop.push(r.id);
  });
  await idbDeleteVersions(drop);
}

/**
 * Keep a version of a just-written project record. Automatic kinds are
 * throttled and skipped when nothing changed; "named" and "restore" always
 * land. Resolves to the version, or null when none was kept.
 */
export async function recordVersion(
  record: ProjectRecord,
  kind: VersionKind,
  label?: string,
): Promise<VersionRecord | null> {
  const prev = lastDocByProject.get(record.id);
  if ((kind === "auto" || kind === "save") && prev && sameDoc(prev, record.doc)) return null;
  if (kind === "auto") {
    const stamp = await latestStamp(record.id);
    if (record.updatedAt - stamp < VERSION_GAP_MS) return null;
  }
  const version: VersionRecord = {
    id: uid("ver"),
    projectId: record.id,
    savedAt: record.updatedAt,
    kind,
    label: label?.trim() || undefined,
    name: record.name,
    pages: record.doc.pages.length,
    doc: record.doc,
  };
  await idbPutVersion(version);
  lastStampByProject.set(record.id, version.savedAt);
  lastDocByProject.set(record.id, record.doc);
  void prune(record.id).catch(() => {});
  return version;
}

export async function listVersions(projectId: string): Promise<VersionMeta[]> {
  const rows = await idbVersionsFor<VersionRecord>(projectId);
  return rows
    .map(({ doc, ...meta }) => ({
      ...meta,
      preview: doc?.pages?.find((p) => p.id === doc.currentPageId) ?? doc?.pages?.[0],
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** Save the open document and keep this moment as a version, named or not. */
export async function saveVersionNow(label?: string) {
  const record = await saveNamedProject(undefined, false, false);
  const version = await recordVersion(record, "named", label);
  return { record, version };
}

export async function renameVersion(id: string, label: string) {
  const v = await idbGetVersion<VersionRecord>(id);
  if (!v) throw new Error("Version not found");
  const next = { ...v, label: label.trim() || undefined };
  await idbPutVersion(next);
  return next;
}

export async function deleteVersion(id: string) {
  await idbDeleteVersions([id]);
}

export async function deleteVersionsFor(projectId: string) {
  lastStampByProject.delete(projectId);
  lastDocByProject.delete(projectId);
  await idbDeleteVersionsFor(projectId);
}

/**
 * Put the open document back to `id`. The state being replaced is kept first
 * as a "Before restore" version, so a restore is never a one-way door.
 */
export async function restoreVersion(id: string) {
  const v = await idbGetVersion<VersionRecord>(id);
  if (!v) throw new Error("Version not found");
  const s = useStudio.getState();
  if (s.projectId !== v.projectId) throw new Error("That version belongs to another project");
  const before = await saveNamedProject(undefined, false, false);
  await recordVersion(before, "restore", "Before restore");
  s.replaceDocument({ ...v.doc, projectId: v.projectId, projectName: before.name });
  const after = await saveNamedProject(undefined, false, false);
  markVersioned(after);
  return v;
}

/** A new project made from a version, opened beside the original, which stays as it is. */
export async function restoreVersionAsCopy(id: string) {
  const v = await idbGetVersion<VersionRecord>(id);
  if (!v) throw new Error("Version not found");
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
