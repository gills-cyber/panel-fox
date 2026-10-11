import { uid } from "@/lib/utils";
import { idbAllProjects, idbDeleteProject, idbGetProject, idbPutProject } from "./idb";
import type { BookInfo, CastMember, Chapter, PageState, PaperTone, ScriptLine } from "./types";
import type { PaperSizeId } from "./paper";
import { useStudio } from "./store";
import type { NewProjectOptions } from "./store";
import { downloadBlob } from "./export";
import { SAMPLES } from "./samples";

export type ProjectDoc = {
  pages: PageState[];
  currentPageId: string;
  gutter: number;
  margin: number;
  border: number;
  paper: PaperTone;
  paperSize?: PaperSizeId;
  bleed?: number;
  rtl: boolean;
  showNumbers: boolean;
  /** Hand-drawn (G-pen) balloon ink; absent in older files means on. */
  handInk?: boolean;
  projectId: string | null;
  projectName: string;
  script?: ScriptLine[];
  cast?: CastMember[];
  book?: BookInfo;
  chapters?: Chapter[];
};

export type ProjectRecord = {
  id: string;
  name: string;
  updatedAt: number;
  doc: ProjectDoc;
};

export type ProjectMeta = {
  id: string;
  name: string;
  updatedAt: number;
  pages: number;
  preview?: PageState;
};

let projectUi: {
  save: () => void;
  saveAs: (asCopy: boolean) => void;
  open: () => void;
} | null = null;

export function bindProjectUi(ui: typeof projectUi) {
  projectUi = ui;
}

export function requestSave() {
  projectUi?.save();
}

export function requestSaveAs(asCopy = false) {
  projectUi?.saveAs(asCopy);
}

export function requestOpenProjects() {
  projectUi?.open();
}

const FILE_KIND = "koma-project";

export function snapshotDoc(): ProjectDoc {
  const s = useStudio.getState();
  return {
    pages: s.pages,
    currentPageId: s.currentPageId,
    gutter: s.gutter,
    margin: s.margin,
    border: s.border,
    paper: s.paper,
    paperSize: s.paperSize,
    bleed: s.bleed,
    rtl: s.rtl,
    showNumbers: s.showNumbers,
    handInk: s.handInk,
    projectId: s.projectId,
    projectName: s.projectName,
    script: s.script,
    cast: s.cast,
    book: s.book,
    chapters: s.chapters,
  };
}

function isStockPhoto(src: string | undefined) {
  if (!src) return false;
  if (src.startsWith("/samples/")) return true;
  return SAMPLES.some((s) => s.src === src);
}

export function documentHasWork(doc?: ProjectDoc) {
  const d = doc ?? snapshotDoc();
  if (d.pages.length > 1) return true;
  for (const page of d.pages) {
    if (page.title?.trim() && page.title.trim() !== "Untitled") return true;
    if ((page.overlays?.length ?? 0) > 0) return true;
    if (page.panels.some((p) => p.background && !isStockPhoto(p.background.src))) {
      return true;
    }
    if (page.panels.some((p) => p.image && !isStockPhoto(p.image.src))) {
      return true;
    }
  }
  if ((d.script ?? []).some((l) => l.text.trim().length > 0 || l.overlayId)) return true;
  if ((d.cast ?? []).some((c) => Boolean(c.portrait))) return true;
  if ((d.chapters ?? []).length > 0) return true;
  const book = d.book;
  if (book && (book.title.trim() || book.author.trim() || book.series.trim())) return true;
  return false;
}

export function relativeProjectTime(ts: number) {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 45) return "Just now";
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min ago`;
  if (sec < 86400) return `${Math.max(1, Math.round(sec / 3600))} hr ago`;
  if (sec < 86400 * 7) return `${Math.max(1, Math.round(sec / 86400))}d ago`;
  return new Date(ts).toLocaleDateString();
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const rows = await idbAllProjects<ProjectRecord>();
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      updatedAt: r.updatedAt,
      pages: r.doc?.pages?.length ?? 0,
      preview: r.doc?.pages?.[0],
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function uniqueProjectName(base: string, ignoreId?: string | null) {
  const rows = await listProjects();
  const taken = new Set(
    rows
      .filter((r) => r.id !== ignoreId)
      .map((r) => r.name.trim().toLowerCase()),
  );
  const trimmed = (base || "Untitled").trim() || "Untitled";
  if (!taken.has(trimmed.toLowerCase())) return trimmed;
  for (let i = 2; i < 200; i++) {
    const next = `${trimmed} ${i}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return `${trimmed} ${Date.now()}`;
}

export const AUTOSAVE_MS = 30_000;

/** Overwrite the open project, or create one if the page already has work. */
export async function autosaveProject() {
  const s = useStudio.getState();
  if (s.projectId) return saveNamedProject();
  if (!documentHasWork()) return null;
  return saveNamedProject(s.projectName || "Untitled");
}

export async function saveNamedProject(name?: string, asNew = false) {
  const s = useStudio.getState();
  const id = !asNew && s.projectId ? s.projectId : uid("proj");
  const requested = (name ?? s.projectName ?? "Untitled").trim() || "Untitled";
  const trimmed =
    asNew || !s.projectId
      ? await uniqueProjectName(requested, id)
      : requested;
  const record: ProjectRecord = {
    id,
    name: trimmed,
    updatedAt: Date.now(),
    doc: { ...snapshotDoc(), projectId: id, projectName: trimmed },
  };
  // The document takes its identity before the write, never after it: a new
  // or opened document that replaced this one while the write was in flight
  // must not be stamped with the old project's id (and then saved over it).
  useStudio.setState({ projectId: id, projectName: trimmed });
  await idbPutProject(record);
  return record;
}

/** Keep the open manga in the library before switching away. */
export async function saveCurrentIfNeeded() {
  const s = useStudio.getState();
  if (s.projectId) {
    const record = await saveNamedProject();
    return { saved: true as const, name: record.name };
  }
  if (documentHasWork()) {
    const record = await saveNamedProject(s.projectName || "Untitled", true);
    return { saved: true as const, name: record.name };
  }
  return { saved: false as const, name: s.projectName };
}

export async function openNamedProject(id: string) {
  const record = await idbGetProject<ProjectRecord>(id);
  if (!record?.doc) throw new Error("Project not found");
  useStudio.getState().replaceDocument({
    ...record.doc,
    projectId: record.id,
    projectName: record.name,
  });
}

export async function switchToProject(id: string) {
  const s = useStudio.getState();
  if (s.projectId === id) return { switched: false as const, stashed: null };
  const stashed = await saveCurrentIfNeeded();
  await openNamedProject(id);
  return { switched: true as const, stashed };
}

export async function startNewProject(opts?: NewProjectOptions) {
  const stashed = await saveCurrentIfNeeded();
  useStudio.getState().newProject(opts);
  return stashed;
}

export async function startNewBrochure(opts?: { templateId?: string }) {
  const stashed = await saveCurrentIfNeeded();
  useStudio.getState().newBrochure(opts);
  return stashed;
}

export async function duplicateNamedProject(id: string) {
  // The open document is duplicated as it is now, not as it was last saved.
  if (useStudio.getState().projectId === id) await saveNamedProject();
  const record = await idbGetProject<ProjectRecord>(id);
  if (!record?.doc) throw new Error("Project not found");
  const name = await uniqueProjectName(`${record.name} copy`);
  const nextId = uid("proj");
  const copy: ProjectRecord = {
    id: nextId,
    name,
    updatedAt: Date.now(),
    doc: {
      ...record.doc,
      projectId: nextId,
      projectName: name,
    },
  };
  await idbPutProject(copy);
  return copy;
}

export async function renameNamedProject(id: string, name: string) {
  const record = await idbGetProject<ProjectRecord>(id);
  if (!record) throw new Error("Project not found");
  const trimmed = await uniqueProjectName(name.trim() || "Untitled", id);
  const next: ProjectRecord = {
    ...record,
    name: trimmed,
    updatedAt: Date.now(),
    doc: { ...record.doc, projectName: trimmed },
  };
  await idbPutProject(next);
  const s = useStudio.getState();
  if (s.projectId === id) useStudio.setState({ projectName: trimmed });
  return next;
}

export async function deleteNamedProject(id: string) {
  await idbDeleteProject(id);
  const s = useStudio.getState();
  if (s.projectId === id) {
    useStudio.setState({ projectId: null });
  }
}

export function isKomaFile(file: File) {
  return /\.koma$/i.test(file.name) || file.type === "application/x-koma";
}

export async function loadProjectFile(file: File) {
  const text = await file.text();
  const parsed = JSON.parse(text) as {
    kind?: string;
    name?: string;
    doc?: ProjectDoc;
  };
  if (parsed.kind !== FILE_KIND || !parsed.doc?.pages?.length) {
    throw new Error("Not a PanelFox project file");
  }
  await saveCurrentIfNeeded();
  const rawName =
    parsed.name ||
    parsed.doc.projectName ||
    file.name.replace(/\.koma$/i, "") ||
    "Untitled";
  const name = await uniqueProjectName(rawName);
  const id = uid("proj");
  const record: ProjectRecord = {
    id,
    name,
    updatedAt: Date.now(),
    doc: { ...parsed.doc, projectId: id, projectName: name },
  };
  await idbPutProject(record);
  useStudio.getState().replaceDocument(record.doc);
  return record;
}

export function downloadProjectFile() {
  const s = useStudio.getState();
  const body = JSON.stringify({
    kind: FILE_KIND,
    version: 1,
    name: s.projectName,
    savedAt: new Date().toISOString(),
    doc: snapshotDoc(),
  });
  const slug =
    s.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "koma";
  downloadBlob(
    new Blob([body], { type: "application/json" }),
    `${slug}.koma`,
  );
}