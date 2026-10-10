import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import { idbGet, idbSet, migrateLocalStorageSession } from "./idb";
import type {
  FitMode,
  Overlay,
  OverlayKind,
  PageState,
  PanelImage,
  PanelRect,
  PanelState,
  PaperTone,
  ImageTool,
  StickerId,
  CustomSticker,
  LibraryImage,
  PanelShape,
  CastMember,
  ScriptLine,
  BookInfo,
  Chapter,
} from "./types";
import { SAMPLES } from "./samples";
import { boxesForPage, getTemplate, layoutTemplate, panelIds } from "./templates";
import { freshImage } from "./image";
import { makeOverlay, pageOverlays, demoOverlays, isDialogue, flipDialogueTail, fitBubbleSize } from "./lettering";
import type { SnapGuide } from "./balloons";
import { roundRect } from "./resize";
import { clamp, uid } from "@/lib/utils";
import type { PaperSizeId, OverlayStyle } from "./paper";
import { DEFAULT_PAPER_SIZE, pageAspect } from "./paper";
import { LAYOUT_KEYS, fitLetterBox, letterMinBox, usesMeasuredFit } from "./fit";
import { applyTheme, readPrefs, writePrefs } from "./prefs";
import { makeBrochurePage } from "./brochure";
import {
  cloneCast,
  cloneScript,
  demoCast,
  demoScript,
  isScriptKind,
  nextCastColor,
} from "./script";
import {
  cloneBook,
  cloneChapters,
  defaultBook,
  folioToPageIndex,
  makeChapter,
  moveItem,
  needsPad,
  sanitizeChapters,
} from "./book";

const DEFAULT_TEMPLATE = "six";
const HISTORY_GAP = 480;
const HISTORY_MAX = 40;

function makePage(templateId: string, fill = false, id?: string): PageState {
  const spec = getTemplate(templateId);
  const ids = panelIds(spec);
  return {
    id: id ?? uid("page"),
    title: "Untitled",
    templateId: spec.id,
    overlays: fill ? demoOverlays() : [],
    panels: ids.map((i, idx) => ({
      id: i,
      image: fill && SAMPLES[idx] ? freshImage(SAMPLES[idx]!.src) : null,
    })),
  };
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

let migrated = false;
let persistQuiet = 0;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persistPending: { name: string; value: unknown } | null = null;

function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  if (!persistPending) return;
  const { name, value } = persistPending;
  persistPending = null;
  void idbSet("kv", name, JSON.stringify(value));
}

const idbStorage: PersistStorage<unknown> = {
  getItem: async (name) => {
    if (!migrated) {
      migrated = true;
      await migrateLocalStorageSession();
    }
    const raw = await idbGet("kv", name);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { state: unknown; version?: number };
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    persistPending = { name, value };
    if (persistQuiet > 0) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(flushPersist, 480);
  },
  removeItem: async (name) => {
    persistPending = null;
    await idbSet("kv", name, "");
  },
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flushPersist());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPersist();
  });
}

type ProjectDoc = {
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
  handInk?: boolean;
  projectId: string | null;
  projectName: string;
  script?: ScriptLine[];
  cast?: CastMember[];
  book?: BookInfo;
  chapters?: Chapter[];
};

function patchPage(
  pages: PageState[],
  currentPageId: string,
  fn: (page: PageState) => PageState,
): PageState[] {
  return pages.map((page) => (page.id === currentPageId ? fn(page) : page));
}

type HistorySnap = {
  pages: PageState[];
  currentPageId: string;
  gutter: number;
  margin: number;
  border: number;
  paper: PaperTone;
  paperSize: PaperSizeId;
  bleed: number;
  rtl: boolean;
  showNumbers: boolean;
  handInk: boolean;
  script: ScriptLine[];
  cast: CastMember[];
  book: BookInfo;
  chapters: Chapter[];
};

function clonePages(pages: PageState[]): PageState[] {
  return pages.map((page) => ({
    ...page,
    overlays: pageOverlays(page).map((o) => ({ ...o })),
    panels: page.panels.map((p) => ({
      ...p,
      image: p.image ? { ...p.image } : null,
      background: p.background ? { ...p.background } : null,
      rect: p.rect ? { ...p.rect } : undefined,
    })),
  }));
}

function takeSnap(s: HistorySnap): HistorySnap {
  return {
    pages: clonePages(s.pages),
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
    script: cloneScript(s.script),
    cast: cloneCast(s.cast),
    book: cloneBook(s.book ?? defaultBook()),
    chapters: cloneChapters(s.chapters ?? []),
  };
}

function frozenPanels(state: {
  currentPage: () => PageState;
  margin: number;
  gutter: number;
  rtl: boolean;
}): PanelState[] {
  const page = state.currentPage();
  const boxes = boxesForPage(page, state.margin, state.gutter, state.rtl);
  const byId = new Map(page.panels.map((p) => [p.id, p]));
  return boxes.map((b) => ({
    id: b.id,
    image: byId.get(b.id)?.image ?? null,
    background: byId.get(b.id)?.background ?? null,
    rect: roundRect({ x: b.x, y: b.y, w: b.w, h: b.h }),
  }));
}

function normalizeDrawnRect(x0: number, y0: number, x1: number, y1: number): PanelRect {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  return roundRect({
    x: clamp(x, 0.4, 99),
    y: clamp(y, 0.4, 99),
    w: clamp(w, 8, 99.2 - x),
    h: clamp(h, 8, 99.2 - y),
  });
}

function moveOverlay(list: Overlay[], id: string, to: number) {
  const i = list.findIndex((o) => o.id === id);
  if (i < 0) return list;
  const next = [...list];
  const [item] = next.splice(i, 1);
  if (!item) return list;
  next.splice(clamp(to, 0, next.length), 0, item);
  return next;
}

let lastRecordAt = 0;
let liveEditing = false;
let liveSnap: HistorySnap | null = null;

type StudioState = {
  pages: PageState[];
  currentPageId: string;
  selectedPanelId: string | null;
  selectedOverlayId: string | null;
  editingPanelId: string | null;
  pendingSrc: string | null;
  pendingBackground: string | null;
  imageTool: ImageTool;
  arranging: boolean;
  placing: boolean;
  gutter: number;
  margin: number;
  border: number;
  paper: PaperTone;
  paperSize: PaperSizeId;
  bleed: number;
  snapEdges: boolean;
  handInk: boolean;
  snapGuides: SnapGuide[];
  spread: boolean;
  readMode: boolean;
  theme: "light" | "dark";
  styleClipboard: OverlayStyle | null;
  layoutClipboard: { templateId: string; panels: Pick<PanelState, "rect" | "shape" | "rotate">[] } | null;
  rtl: boolean;
  showNumbers: boolean;
  projectId: string | null;
  projectName: string;
  customStickers: CustomSticker[];
  backgrounds: LibraryImage[];
  script: ScriptLine[];
  cast: CastMember[];
  book: BookInfo;
  chapters: Chapter[];
  past: HistorySnap[];
  future: HistorySnap[];
  currentPage: () => PageState;
  selectPanel: (id: string | null) => void;
  selectOverlay: (id: string | null) => void;
  editPanel: (id: string | null) => void;
  setPendingSrc: (src: string | null) => void;
  setPendingBackground: (src: string | null) => void;
  setImageTool: (tool: ImageTool) => void;
  setPageTitle: (title: string) => void;
  setTemplate: (templateId: string) => void;
  setPanelImage: (panelId: string, src: string) => void;
  setPanelBackground: (panelId: string, src: string) => void;
  placePhoto: (panelId: string, src: string) => "photo" | "stacked" | "character";
  addCharacterOnPanel: (panelId: string, src: string) => void;
  swapPanelLayers: (panelId: string) => void;
  stampImage: (panelId: string, image: PanelImage) => void;
  swapPanels: (a: string, b: string) => void;
  placeImage: (src: string, panelId?: string | null) => void;
  updateImage: (panelId: string, patch: Partial<PanelImage>) => void;
  updateBackground: (panelId: string, patch: Partial<PanelImage>) => void;
  clearPanel: (panelId: string) => void;
  clearPanelContents: (panelId: string) => void;
  clearPanelBackground: (panelId: string) => void;
  clearPage: () => void;
  fillDemo: () => void;
  setGutter: (n: number) => void;
  setMargin: (n: number) => void;
  setBorder: (n: number) => void;
  setPaper: (p: PaperTone) => void;
  setPaperSize: (s: PaperSizeId) => void;
  setBleed: (n: number) => void;
  setSnapEdges: (v: boolean) => void;
  setHandInk: (v: boolean) => void;
  setSnapGuides: (guides: SnapGuide[]) => void;
  setSpread: (v: boolean) => void;
  setReadMode: (v: boolean) => void;
  toggleReadMode: () => void;
  setTheme: (t: "light" | "dark") => void;
  copyOverlayStyle: (id?: string | null) => void;
  pasteOverlayStyle: (id?: string | null) => void;
  copyPageLayout: () => void;
  applyPageLayout: (pageId?: string | null) => void;
  setPanelShape: (id: string, shape: PanelShape) => void;
  setPanelRotate: (id: string, rotate: number) => void;
  toggleOverlayLock: (id: string) => void;
  toggleOverlayHidden: (id: string) => void;
  togglePanelLock: (id: string) => void;
  movePage: (id: string, beforeId: string | null) => void;
  movePageEarlier: (id?: string | null) => void;
  movePageLater: (id?: string | null) => void;
  sendPageTo: (id: string, dest: number | "cover") => void;
  setBook: (patch: Partial<BookInfo>) => void;
  addChapter: (title?: string, startPageId?: string) => Chapter | null;
  renameChapter: (id: string, title: string) => void;
  removeChapter: (id: string) => void;
  padToEvenSpread: () => void;
  setRtl: (v: boolean) => void;
  setShowNumbers: (v: boolean) => void;
  setArranging: (v: boolean) => void;
  setPlacing: (v: boolean) => void;
  addPage: (atIndex?: number) => void;
  duplicatePage: (id?: string) => void;
  removePage: (id: string) => void;
  setCurrentPage: (id: string) => void;
  setPanelRects: (rects: Record<string, PanelRect>) => void;
  swapPanelRects: (a: string, b: string) => void;
  addPanel: () => void;
  addPanelAt: (rect: PanelRect) => string;
  removePanel: (id: string) => void;
  bringPanelForward: (id: string) => void;
  sendPanelBackward: (id: string) => void;
  resetLayout: () => void;
  addOverlay: (kind: OverlayKind, sticker?: StickerId, text?: string, src?: string) => Overlay;
  /** Drop a balloon centred on a page point (percent) and open it for typing. */
  addOverlayAt: (kind: OverlayKind, x: number, y: number, panelId?: string | null) => Overlay;
  /** Overlay that should open in text-edit mode as soon as it mounts. */
  pendingEditOverlayId: string | null;
  setPendingEditOverlay: (id: string | null) => void;
  addChainedOverlay: (fromId?: string | null) => void;
  unchainOverlay: (id?: string | null) => void;
  joinOverlays: (aId: string, bId: string) => void;
  flipOverlayTail: (id?: string | null, axis?: "x" | "y") => void;
  updateOverlay: (id: string, patch: Partial<Overlay>, live?: boolean) => void;
  beginLiveEdit: () => void;
  endLiveEdit: (record?: boolean) => void;
  removeOverlay: (id: string) => void;
  deleteSelection: () => void;
  duplicateOverlay: (id?: string | null) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  addCustomSticker: (src: string, name: string) => CustomSticker;
  removeCustomSticker: (id: string) => void;
  placeLogo: (src?: string | null) => void;
  addBackground: (src: string, name: string) => LibraryImage;
  removeBackground: (id: string) => void;
  nudgeOverlay: (id: string, dx: number, dy: number) => void;
  undo: () => void;
  redo: () => void;
  selectedImage: () => PanelImage | null;
  replaceDocument: (doc: ProjectDoc) => void;
  newProject: () => void;
  newBrochure: () => void;
  setProjectName: (name: string) => void;
  addSplashPage: (src: string) => void;
  addCast: (name?: string, portrait?: string) => CastMember;
  renameCast: (id: string, name: string) => void;
  setCastPortrait: (id: string, src: string | null) => void;
  removeCast: (id: string) => void;
  stampCast: (id: string) => void;
  addScriptLine: (partial?: Partial<ScriptLine>) => ScriptLine;
  updateScriptLine: (id: string, patch: Partial<ScriptLine>) => void;
  removeScriptLine: (id: string) => void;
  placeScriptLine: (id: string) => void;
  focusScriptLine: (id: string) => void;
  assignSpeaker: (overlayId: string, speakerId: string | null) => void;
};

const first = makePage(DEFAULT_TEMPLATE, true, "page_demo");
const boot = readPrefs();

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => {
      function commit(extra: Partial<StudioState>) {
        const s = get();
        const now = Date.now();
        const record = now - lastRecordAt > HISTORY_GAP;
        lastRecordAt = now;
        set({
          ...extra,
          past: record
            ? [...s.past.slice(-(HISTORY_MAX - 1)), takeSnap(s)]
            : s.past,
          future: record ? [] : s.future,
        });
      }

      return {
        pages: [first],
        currentPageId: first.id,
        selectedPanelId: null,
        selectedOverlayId: null,
        editingPanelId: null,
        pendingSrc: null,
        pendingBackground: null,
        imageTool: "frame",
        arranging: false,
        placing: false,
        gutter: typeof boot.gutter === "number" ? boot.gutter : 0.9,
        margin: typeof boot.margin === "number" ? boot.margin : 3.2,
        border: typeof boot.border === "number" ? boot.border : 0.22,
        paper: boot.paper === "white" || boot.paper === "newsprint" ? boot.paper : "cream",
        paperSize:
          boot.paperSize === "b5" ||
          boot.paperSize === "a4" ||
          boot.paperSize === "a5" ||
          boot.paperSize === "letter" ||
          boot.paperSize === "webtoon"
            ? boot.paperSize
            : DEFAULT_PAPER_SIZE,
        bleed: typeof boot.bleed === "number" ? boot.bleed : 0,
        snapEdges: boot.snapEdges !== false,
        handInk: boot.handInk !== false,
        snapGuides: [],
        pendingEditOverlayId: null,
        spread: Boolean(boot.spread),
        readMode: false,
        theme: boot.theme === "dark" ? "dark" : "light",
        styleClipboard: null,
        layoutClipboard: null,
        rtl: Boolean(boot.rtl),
        showNumbers: Boolean(boot.showNumbers),
        projectId: null,
        projectName: "Untitled",
        customStickers: [],
        backgrounds: [],
        script: demoScript(first.id),
        cast: demoCast(),
        book: defaultBook(),
        chapters: [],
        past: [],
        future: [],

        currentPage: () => {
          const { pages, currentPageId } = get();
          return pages.find((p) => p.id === currentPageId) ?? pages[0]!;
        },

        selectedImage: () => {
          const page = get().currentPage();
          const id = get().selectedPanelId;
          if (!id) return null;
          return page.panels.find((p) => p.id === id)?.image ?? null;
        },

        selectPanel: (id) =>
          set((s) => ({
            selectedPanelId: id,
            selectedOverlayId: null,
            imageTool: "frame",
            editingPanelId: id && id === s.editingPanelId ? id : null,
          })),
        selectOverlay: (id) =>
          set({ selectedOverlayId: id, selectedPanelId: null, editingPanelId: null }),
        editPanel: (id) =>
          set({
            selectedPanelId: id,
            editingPanelId: id,
            selectedOverlayId: null,
            imageTool: "frame",
          }),
        setPendingSrc: (src) => set({ pendingSrc: src }),
        setPendingBackground: (src) => set({ pendingBackground: src }),
        setImageTool: (imageTool) => set({ imageTool }),

        setPageTitle: (title) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              title,
            })),
          });
        },

        setTemplate: (templateId) => {
          const spec = getTemplate(templateId);
          const state = get();
          const laid = layoutTemplate(spec, state.margin, state.gutter, state.rtl);
          const old = state.currentPage().panels;
          commit({
            pages: get().pages.map((page) => {
              if (page.id !== get().currentPageId) return page;
              return {
                ...page,
                templateId: spec.id,
                panels: laid.map((b, i) => ({
                  id: b.id,
                  image: old[i]?.image ?? null,
                  background: old[i]?.background ?? null,
                  rect: roundRect({ x: b.x, y: b.y, w: b.w, h: b.h }),
                })),
              };
            }),
            selectedPanelId: null,
            selectedOverlayId: null,
            editingPanelId: null,
            placing: false,
          });
        },

        setPanelImage: (panelId, src) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) =>
                p.id === panelId
                  ? {
                      ...p,
                      image: freshImage(
                        src,
                        p.background ? { fit: "contain" } : undefined,
                      ),
                    }
                  : p,
              ),
            })),
            selectedPanelId: panelId,
            selectedOverlayId: null,
            pendingSrc: null,
          });
        },

        setPanelBackground: (panelId, src) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) =>
                p.id === panelId
                  ? { ...p, background: freshImage(src, { fit: "cover", zoom: 1 }) }
                  : p,
              ),
            })),
            selectedPanelId: panelId,
            selectedOverlayId: null,
            pendingBackground: null,
          });
        },

        placePhoto: (panelId, src) => {
          const panel = get()
            .currentPage()
            .panels.find((p) => p.id === panelId);
          if (!panel) return "photo";
          if (panel.image && panel.background) {
            get().addCharacterOnPanel(panelId, src);
            return "character";
          }
          if (panel.image && !panel.background) {
            commit({
              pages: patchPage(get().pages, get().currentPageId, (page) => ({
                ...page,
                panels: page.panels.map((p) =>
                  p.id === panelId
                    ? {
                        ...p,
                        background: p.image
                          ? { ...p.image, fit: "cover" as const }
                          : null,
                        image: freshImage(src, { fit: "contain" }),
                      }
                    : p,
                ),
              })),
              selectedPanelId: panelId,
              selectedOverlayId: null,
              pendingSrc: null,
            });
            return "stacked";
          }
          get().setPanelImage(panelId, src);
          return "photo";
        },

        addCharacterOnPanel: (panelId, src) => {
          const state = get();
          const page = state.currentPage();
          const boxes = boxesForPage(page, state.margin, state.gutter, state.rtl);
          const box = boxes.find((b) => b.id === panelId) ?? boxes[0];
          const overlay = makeOverlay("sticker", boxes, panelId, undefined, undefined, src);
          if (box) {
            overlay.w = clamp(box.w * 0.5, 16, 44);
            overlay.h = clamp(box.h * 0.62, 18, 50);
            overlay.x = box.x + (box.w - overlay.w) / 2;
            overlay.y = box.y + Math.max(2, box.h * 0.28);
          }
          const twins = pageOverlays(page).filter((o) => o.src).length;
          overlay.x = clamp(overlay.x + twins * 3, 0, 100 - overlay.w);
          overlay.y = clamp(overlay.y + twins * 3, 0, 100 - overlay.h);
          commit({
            pages: patchPage(state.pages, state.currentPageId, (p) => ({
              ...p,
              overlays: [...pageOverlays(p), overlay],
            })),
            selectedOverlayId: overlay.id,
            selectedPanelId: panelId,
          });
        },

        swapPanelLayers: (panelId) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) =>
                p.id === panelId
                  ? {
                      ...p,
                      image: p.background ? { ...p.background } : null,
                      background: p.image ? { ...p.image } : null,
                    }
                  : p,
              ),
            })),
            selectedPanelId: panelId,
          });
        },

        clearPanelBackground: (panelId) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) =>
                p.id === panelId ? { ...p, background: null } : p,
              ),
            })),
          });
        },

        stampImage: (panelId, image) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) =>
                p.id === panelId ? { ...p, image: { ...image } } : p,
              ),
            })),
            selectedPanelId: panelId,
            selectedOverlayId: null,
            pendingSrc: null,
          });
        },

        swapPanels: (a, b) => {
          if (!a || !b || a === b) return;
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => {
              const pa = page.panels.find((p) => p.id === a);
              const pb = page.panels.find((p) => p.id === b);
              if (!pa || !pb) return page;
              const imgA = pa.image ? { ...pa.image } : null;
              const imgB = pb.image ? { ...pb.image } : null;
              const bgA = pa.background ? { ...pa.background } : null;
              const bgB = pb.background ? { ...pb.background } : null;
              return {
                ...page,
                panels: page.panels.map((p) => {
                  if (p.id === a) return { ...p, image: imgB, background: bgB };
                  if (p.id === b) return { ...p, image: imgA, background: bgA };
                  return p;
                }),
              };
            }),
            selectedPanelId: b,
            selectedOverlayId: null,
          });
        },

        placeImage: (src, panelId) => {
          const target = panelId ?? get().selectedPanelId;
          if (target) {
            get().placePhoto(target, src);
          } else {
            set({ pendingSrc: src });
          }
        },

        updateImage: (panelId, patch) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) =>
                p.id === panelId && p.image
                  ? { ...p, image: { ...p.image, ...patch } }
                  : p,
              ),
            })),
          });
        },

        updateBackground: (panelId, patch) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) =>
                p.id === panelId && p.background
                  ? { ...p, background: { ...p.background, ...patch } }
                  : p,
              ),
            })),
          });
        },

        clearPanel: (panelId) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) =>
                p.id === panelId ? { ...p, image: null } : p,
              ),
            })),
          });
        },

        clearPanelContents: (panelId) => {
          const state = get();
          const page = state.currentPage();
          const box = boxesForPage(
            page,
            state.margin,
            state.gutter,
            state.rtl,
          ).find((b) => b.id === panelId);
          commit({
            pages: patchPage(state.pages, state.currentPageId, (p) => ({
              ...p,
              panels: p.panels.map((item) =>
                item.id === panelId
                  ? { ...item, image: null, background: null }
                  : item,
              ),
              overlays: box
                ? pageOverlays(p).filter((o) => {
                    const cx = o.x + o.w / 2;
                    const cy = o.y + o.h / 2;
                    return (
                      cx < box.x ||
                      cy < box.y ||
                      cx > box.x + box.w ||
                      cy > box.y + box.h
                    );
                  })
                : pageOverlays(p),
            })),
            selectedOverlayId: null,
          });
        },

        clearPage: () => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) => ({
                ...p,
                image: null,
                background: null,
              })),
              overlays: [],
            })),
          });
        },

        fillDemo: () => {
          const page = get().currentPage();
          const spec = getTemplate(page.templateId);
          const ids = panelIds(spec);
          const hadOverlays = Boolean(page.overlays?.length);
          commit({
            pages: patchPage(get().pages, get().currentPageId, (p) => ({
              ...p,
              overlays: p.overlays?.length ? p.overlays : demoOverlays(),
              panels: ids.map((id, i) => {
                const prev = p.panels.find((x) => x.id === id);
                return {
                  id,
                  image: SAMPLES[i % SAMPLES.length]
                    ? freshImage(SAMPLES[i % SAMPLES.length]!.src)
                    : null,
                  background: prev?.background ?? null,
                  rect: prev?.rect,
                };
              }),
            })),
            ...(get().script.length || hadOverlays
              ? {}
              : { script: demoScript(page.id), cast: get().cast.length ? get().cast : demoCast() }),
          });
        },

        setGutter: (gutter) => commit({ gutter }),
        setMargin: (margin) => commit({ margin }),
        setBorder: (border) => commit({ border }),
        setPaper: (paper) => commit({ paper }),
        setPaperSize: (paperSize) => {
          commit({ paperSize });
          if (paperSize === "webtoon") set({ spread: false });
        },
        setBleed: (bleed) => commit({ bleed }),
        setSnapEdges: (snapEdges) => set({ snapEdges }),
        // Part of the document (saved, undoable): the look of the lettering travels with the work.
        setHandInk: (handInk) => commit({ handInk }),
        setSnapGuides: (snapGuides) => {
          // Dragging calls this every pointer move; only re-render the page when the guides actually change.
          const cur = get().snapGuides;
          if (
            cur.length === snapGuides.length &&
            cur.every((g, i) => {
              const n = snapGuides[i]!;
              return g.axis === n.axis && g.at === n.at;
            })
          ) {
            return;
          }
          set({ snapGuides });
        },
        setSpread: (spread) =>
          set({ spread: get().paperSize === "webtoon" ? false : spread }),
        setReadMode: (readMode) =>
          set({
            readMode,
            selectedPanelId: null,
            selectedOverlayId: null,
            editingPanelId: null,
            placing: false,
            arranging: false,
            pendingSrc: null,
            pendingBackground: null,
          }),
        toggleReadMode: () => get().setReadMode(!get().readMode),
        setTheme: (theme) => {
          set({ theme });
          applyTheme(theme);
          writePrefs({ theme });
        },
        copyOverlayStyle: (id) => {
          const oid = id ?? get().selectedOverlayId;
          const o = pageOverlays(get().currentPage()).find((x) => x.id === oid);
          if (!o) return;
          set({
            styleClipboard: {
              fontSize: o.fontSize,
              bold: o.bold,
              italic: o.italic,
              color: o.color,
              fill: o.fill,
              stroke: o.stroke,
              vertical: o.vertical,
              rotate: o.rotate,
              opacity: o.opacity,
              fontId: o.fontId,
              align: o.align,
              balloonStyle: o.balloonStyle,
            },
          });
        },
        pasteOverlayStyle: (id) => {
          const oid = id ?? get().selectedOverlayId;
          const clip = get().styleClipboard;
          if (!oid || !clip) return;
          get().updateOverlay(oid, { ...clip });
        },
        copyPageLayout: () => {
          const page = get().currentPage();
          set({
            layoutClipboard: {
              templateId: page.templateId,
              panels: page.panels.map((p) => ({
                rect: p.rect,
                shape: p.shape,
                rotate: p.rotate,
              })),
            },
          });
        },
        applyPageLayout: (pageId) => {
          const clip = get().layoutClipboard;
          if (!clip) return;
          const id = pageId ?? get().currentPageId;
          commit({
            pages: get().pages.map((page) => {
              if (page.id !== id) return page;
              const panels = page.panels.map((p, i) => {
                const src = clip.panels[i];
                if (!src) return p;
                return { ...p, rect: src.rect, shape: src.shape, rotate: src.rotate };
              });
              return { ...page, templateId: clip.templateId, panels };
            }),
          });
        },
        setPanelShape: (panelId, shape) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) =>
                p.id === panelId ? { ...p, shape } : p,
              ),
            })),
          });
        },
        setPanelRotate: (panelId, rotate) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) =>
                p.id === panelId ? { ...p, rotate } : p,
              ),
            })),
          });
        },
        toggleOverlayLock: (id) => {
          const o = pageOverlays(get().currentPage()).find((x) => x.id === id);
          if (!o) return;
          get().updateOverlay(id, { locked: !o.locked });
        },
        toggleOverlayHidden: (id) => {
          const o = pageOverlays(get().currentPage()).find((x) => x.id === id);
          if (!o) return;
          get().updateOverlay(id, { hidden: !o.hidden });
        },
        togglePanelLock: (id) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) =>
                p.id === id ? { ...p, locked: !p.locked } : p,
              ),
            })),
          });
        },
        movePage: (id, beforeId) => {
          const pages = [...get().pages];
          const from = pages.findIndex((p) => p.id === id);
          if (from < 0) return;
          const [item] = pages.splice(from, 1);
          if (!item) return;
          const to =
            beforeId == null
              ? pages.length
              : pages.findIndex((p) => p.id === beforeId);
          if (to < 0) return;
          pages.splice(to, 0, item);
          commit({ pages, chapters: sanitizeChapters(get().chapters, pages) });
        },
        movePageEarlier: (id) => {
          const s = get();
          const pid = id ?? s.currentPageId;
          const i = s.pages.findIndex((p) => p.id === pid);
          if (i <= 0) return;
          s.movePage(pid, s.pages[i - 1]!.id);
        },
        movePageLater: (id) => {
          const s = get();
          const pid = id ?? s.currentPageId;
          const i = s.pages.findIndex((p) => p.id === pid);
          if (i < 0 || i >= s.pages.length - 1) return;
          s.movePage(pid, s.pages[i + 2]?.id ?? null);
        },
        sendPageTo: (id, dest) => {
          const s = get();
          const from = s.pages.findIndex((p) => p.id === id);
          if (from < 0) return;
          let book = s.book;
          let destIndex: number;
          if (dest === "cover") {
            destIndex = 0;
            book = { ...book, coverFirst: true };
          } else {
            destIndex = folioToPageIndex(dest, s.pages.length, book.coverFirst);
          }
          const pages = moveItem(s.pages, from, destIndex);
          commit({
            pages,
            book,
            currentPageId: id,
            selectedPanelId: null,
            selectedOverlayId: null,
            chapters: sanitizeChapters(s.chapters, pages),
          });
        },
        setBook: (patch) => {
          commit({ book: { ...get().book, ...patch } });
        },
        addChapter: (title, startPageId) => {
          const s = get();
          const start = startPageId ?? s.currentPageId;
          if (!s.pages.some((p) => p.id === start)) return null;
          if (s.chapters.some((c) => c.startPageId === start)) {
            return s.chapters.find((c) => c.startPageId === start) ?? null;
          }
          const chapter = makeChapter(start, title, s.chapters.length + 1);
          commit({
            chapters: sanitizeChapters([...s.chapters, chapter], s.pages),
          });
          return chapter;
        },
        renameChapter: (id, title) => {
          commit({
            chapters: get().chapters.map((c) =>
              c.id === id ? { ...c, title } : c,
            ),
          });
        },
        removeChapter: (id) => {
          commit({
            chapters: get().chapters.filter((c) => c.id !== id),
          });
        },
        padToEvenSpread: () => {
          const s = get();
          if (!needsPad(s.pages.length, s.book.coverFirst)) return;
          const page = makePage("blank", false);
          page.title = "Blank";
          commit({
            pages: [...s.pages, page],
          });
        },
        setRtl: (rtl) => commit({ rtl }),
        setShowNumbers: (showNumbers) => commit({ showNumbers }),
        setArranging: (arranging) =>
          set({
            arranging,
            editingPanelId: arranging ? null : get().editingPanelId,
            placing: arranging ? false : get().placing,
          }),
        setPlacing: (placing) =>
          set({
            placing,
            arranging: placing ? false : get().arranging,
            selectedOverlayId: placing ? null : get().selectedOverlayId,
          }),

        addPage: (atIndex) => {
          const page = makePage("blank", false);
          const pages = [...get().pages];
          const i =
            atIndex == null
              ? pages.length
              : Math.min(pages.length, Math.max(0, Math.round(atIndex)));
          pages.splice(i, 0, page);
          commit({
            pages,
            currentPageId: page.id,
            selectedPanelId: null,
            selectedOverlayId: null,
            chapters: sanitizeChapters(get().chapters, pages),
          });
        },

        duplicatePage: (id) => {
          const s = get();
          const src =
            s.pages.find((p) => p.id === (id ?? s.currentPageId)) ??
            s.currentPage();
          const copy: PageState = {
            ...takeSnap(s).pages.find((p) => p.id === src.id)!,
            id: uid("page"),
            title:
              src.title.trim() && src.title !== "Untitled"
                ? `${src.title} copy`
                : "Untitled",
          };
          const idx = s.pages.findIndex((p) => p.id === src.id);
          const pages = [...s.pages];
          pages.splice(idx + 1, 0, copy);
          commit({
            pages,
            currentPageId: copy.id,
            selectedPanelId: null,
            selectedOverlayId: null,
          });
        },

        removePage: (id) => {
          const s = get();
          if (s.pages.length <= 1) return;
          const oldIdx = s.pages.findIndex((p) => p.id === id);
          const fallback =
            s.pages[oldIdx + 1]?.id ?? s.pages[oldIdx - 1]?.id ?? null;
          const pages = s.pages.filter((p) => p.id !== id);
          const chapters = sanitizeChapters(
            s.chapters.map((c) =>
              c.startPageId === id && fallback
                ? { ...c, startPageId: fallback }
                : c,
            ),
            pages,
          );
          commit({
            pages,
            chapters,
            currentPageId:
              s.currentPageId === id ? pages[0]!.id : s.currentPageId,
            selectedPanelId: null,
            selectedOverlayId: null,
          });
        },

        setCurrentPage: (id) =>
          set({
            currentPageId: id,
            selectedPanelId: null,
            selectedOverlayId: null,
          }),

        setPanelRects: (rects) => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) => ({
                ...p,
                rect: rects[p.id] ? roundRect(rects[p.id]!) : p.rect,
              })),
            })),
          });
        },

        swapPanelRects: (a, b) => {
          if (!a || !b || a === b) return;
          const state = get();
          const page = state.currentPage();
          const boxes = boxesForPage(page, state.margin, state.gutter, state.rtl);
          const ba = boxes.find((x) => x.id === a);
          const bb = boxes.find((x) => x.id === b);
          if (!ba || !bb) return;
          const rects = Object.fromEntries(
            boxes.map((box) => [
              box.id,
              roundRect(
                box.id === a
                  ? { x: bb.x, y: bb.y, w: bb.w, h: bb.h }
                  : box.id === b
                    ? { x: ba.x, y: ba.y, w: ba.w, h: ba.h }
                    : { x: box.x, y: box.y, w: box.w, h: box.h },
              ),
            ]),
          );
          get().setPanelRects(rects);
        },

        addPanel: () => {
          set({
            placing: true,
            arranging: false,
            selectedOverlayId: null,
          });
        },

        addPanelAt: (raw) => {
          const state = get();
          const rect = normalizeDrawnRect(
            raw.x,
            raw.y,
            raw.x + raw.w,
            raw.y + raw.h,
          );
          const id = uid("p");
          const rest = frozenPanels(state);
          commit({
            pages: patchPage(state.pages, state.currentPageId, (p) => ({
              ...p,
              panels: [...rest, { id, image: null, background: null, rect }],
            })),
            selectedPanelId: id,
            selectedOverlayId: null,
            editingPanelId: id,
            placing: false,
            arranging: false,
          });
          return id;
        },

        removePanel: (id) => {
          const state = get();
          const page = state.currentPage();
          if (!page.panels.some((p) => p.id === id)) return;
          const rest = frozenPanels(state).filter((p) => p.id !== id);
          commit({
            pages: patchPage(state.pages, state.currentPageId, (p) => ({
              ...p,
              panels: rest,
            })),
            selectedPanelId:
              state.selectedPanelId === id ? null : state.selectedPanelId,
            editingPanelId:
              state.editingPanelId === id ? null : state.editingPanelId,
          });
        },

        bringPanelForward: (id) => {
          const page = get().currentPage();
          const i = page.panels.findIndex((p) => p.id === id);
          if (i < 0 || i === page.panels.length - 1) return;
          const panels = [...page.panels];
          const [item] = panels.splice(i, 1);
          if (!item) return;
          panels.push(item);
          commit({
            pages: patchPage(get().pages, get().currentPageId, (p) => ({
              ...p,
              panels,
            })),
          });
        },

        sendPanelBackward: (id) => {
          const page = get().currentPage();
          const i = page.panels.findIndex((p) => p.id === id);
          if (i <= 0) return;
          const panels = [...page.panels];
          const [item] = panels.splice(i, 1);
          if (!item) return;
          panels.unshift(item);
          commit({
            pages: patchPage(get().pages, get().currentPageId, (p) => ({
              ...p,
              panels,
            })),
          });
        },

        resetLayout: () => {
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              panels: page.panels.map((p) => ({
                id: p.id,
                image: p.image,
                background: p.background,
              })),
            })),
          });
        },

        addOverlay: (kind, sticker, text, src) => {
          const state = get();
          const page = state.currentPage();
          const boxes = boxesForPage(page, state.margin, state.gutter, state.rtl);
          const overlay = makeOverlay(
            kind,
            boxes,
            state.selectedPanelId,
            sticker,
            text,
            src,
          );
          // Start the balloon sized around its words, not the kind's stock box.
          const fitted = fitLetterBox(overlay, pageAspect(state.paperSize), "auto");
          if (fitted) Object.assign(overlay, fitted);
          const twins = pageOverlays(page).filter((o) => o.kind === kind).length;
          overlay.x = Math.min(100 - overlay.w, overlay.x + twins * 5);
          overlay.y = Math.min(100 - overlay.h, overlay.y + twins * 6);
          commit({
            pages: patchPage(state.pages, state.currentPageId, (p) => ({
              ...p,
              overlays: [...pageOverlays(p), overlay],
            })),
            selectedOverlayId: overlay.id,
            selectedPanelId: null,
          });
          return overlay;
        },

        addOverlayAt: (kind, x, y, panelId) => {
          const state = get();
          const page = state.currentPage();
          const boxes = boxesForPage(page, state.margin, state.gutter, state.rtl);
          const overlay = makeOverlay(kind, boxes, panelId ?? state.selectedPanelId);
          const fitted = fitLetterBox(overlay, pageAspect(state.paperSize), "auto");
          if (fitted) Object.assign(overlay, fitted);
          overlay.x = clamp(x - overlay.w / 2, 0, 100 - overlay.w);
          overlay.y = clamp(y - overlay.h / 2, 0, 100 - overlay.h);
          commit({
            pages: patchPage(state.pages, state.currentPageId, (p) => ({
              ...p,
              overlays: [...pageOverlays(p), overlay],
            })),
            selectedOverlayId: overlay.id,
            selectedPanelId: null,
            pendingEditOverlayId: overlay.id,
          });
          return overlay;
        },
        setPendingEditOverlay: (pendingEditOverlayId) => set({ pendingEditOverlayId }),

        addChainedOverlay: (fromId) => {
          const state = get();
          const page = state.currentPage();
          const src =
            pageOverlays(page).find((o) => o.id === (fromId ?? state.selectedOverlayId)) ??
            null;
          if (!src || !isDialogue(src.kind)) {
            state.addOverlay("speech");
            return;
          }
          const chainId = src.chainId ?? uid("chain");
          const boxes = boxesForPage(page, state.margin, state.gutter, state.rtl);
          const next = makeOverlay(src.kind, boxes, state.selectedPanelId);
          next.w = src.w * 0.82;
          next.h = src.h * 0.82;
          next.x = clamp(src.x + src.w * 0.42, 0, 100 - next.w);
          next.y = clamp(src.y - src.h * 0.22, 0, 100 - next.h);
          next.fontSize = src.fontSize;
          next.bold = src.bold;
          next.italic = src.italic;
          next.color = src.color;
          next.fill = src.fill;
          next.stroke = src.stroke;
          next.fontId = src.fontId;
          next.align = src.align;
          next.balloonStyle = src.balloonStyle;
          next.text = "";
          next.chainId = chainId;
          next.tailX = src.tailX;
          next.tailY = src.tailY;
          commit({
            pages: patchPage(state.pages, state.currentPageId, (p) => ({
              ...p,
              overlays: pageOverlays(p)
                .map((o) => (o.id === src.id ? { ...o, chainId } : o))
                .concat(next),
            })),
            selectedOverlayId: next.id,
            selectedPanelId: null,
          });
        },

        unchainOverlay: (id) => {
          const s = get();
          const oid = id ?? s.selectedOverlayId;
          if (!oid) return;
          const page = s.currentPage();
          const src = pageOverlays(page).find((o) => o.id === oid);
          if (!src?.chainId) return;
          const chainId = src.chainId;
          const mates = pageOverlays(page).filter((o) => o.chainId === chainId);
          commit({
            pages: patchPage(s.pages, s.currentPageId, (p) => ({
              ...p,
              overlays: pageOverlays(p).map((o) => {
                if (o.id === src.id) {
                  const { chainId: _drop, ...rest } = o;
                  return rest;
                }
                if (o.chainId === chainId && mates.length <= 2) {
                  const { chainId: _drop, ...rest } = o;
                  return rest;
                }
                return o;
              }),
            })),
          });
        },

        joinOverlays: (aId, bId) => {
          if (!aId || !bId || aId === bId) return;
          const s = get();
          const page = s.currentPage();
          const overlays = pageOverlays(page);
          const a = overlays.find((o) => o.id === aId);
          const b = overlays.find((o) => o.id === bId);
          if (!a || !b || !isDialogue(a.kind) || !isDialogue(b.kind)) return;
          const chainId = a.chainId || b.chainId || uid("chain");
          const merge = new Set(
            [a.chainId, b.chainId, chainId].filter((v): v is string => Boolean(v)),
          );
          commit({
            pages: patchPage(s.pages, s.currentPageId, (p) => ({
              ...p,
              overlays: pageOverlays(p).map((o) =>
                o.id === aId || o.id === bId || (o.chainId && merge.has(o.chainId))
                  ? { ...o, chainId }
                  : o,
              ),
            })),
          });
        },

        flipOverlayTail: (id, axis = "x") => {
          const oid = id ?? get().selectedOverlayId;
          if (!oid) return;
          const o = pageOverlays(get().currentPage()).find((x) => x.id === oid);
          if (!o || o.locked || !isDialogue(o.kind)) return;
          get().updateOverlay(oid, flipDialogueTail(o, axis));
        },

        updateOverlay: (id, patch, live = false) => {
          const s = get();
          const current = pageOverlays(s.currentPage()).find((x) => x.id === id);
          if (!current) return;
          const keys = Object.keys(patch) as (keyof Overlay)[];
          if (
            keys.length > 0 &&
            keys.every((k) => Object.is(current[k], patch[k]))
          ) {
            return;
          }
          let script = s.script;
          if (current.scriptLineId && patch.text != null) {
            script = script.map((l) =>
              l.id === current.scriptLineId ? { ...l, text: patch.text ?? l.text } : l,
            );
          }
          let merged: Overlay = { ...current, ...patch };
          // Lettering changed: size the balloon around the words (never the words around the balloon).
          if (
            usesMeasuredFit(merged) &&
            LAYOUT_KEYS.some((k) => k in patch) &&
            !("w" in patch || "h" in patch)
          ) {
            const box = fitLetterBox(
              merged,
              pageAspect(s.paperSize),
              merged.autoFit === false ? "grow" : "auto",
              current,
            );
            if (box) merged = { ...merged, ...box };
          } else if (usesMeasuredFit(merged) && ("w" in patch || "h" in patch)) {
            // A box set directly never squeezes the words out.
            const min = letterMinBox(merged, pageAspect(s.paperSize));
            if (min) {
              merged = {
                ...merged,
                w: Math.max(merged.w, min.minW),
                h: Math.max(merged.h, min.minH),
              };
            }
          }
          const pages = patchPage(s.pages, s.currentPageId, (page) => ({
            ...page,
            overlays: pageOverlays(page).map((o) =>
              o.id === id ? merged : o,
            ),
          }));
          if (live) {
            get().beginLiveEdit();
            set({ pages, script });
            return;
          }
          commit({ pages, script });
        },

        beginLiveEdit: () => {
          if (liveEditing) return;
          liveEditing = true;
          persistQuiet += 1;
          liveSnap = takeSnap(get());
        },

        endLiveEdit: (record = true) => {
          if (!liveEditing) return;
          liveEditing = false;
          persistQuiet = Math.max(0, persistQuiet - 1);
          const snap = liveSnap;
          liveSnap = null;
          if (record && snap) {
            lastRecordAt = Date.now();
            set({
              past: [...get().past.slice(-(HISTORY_MAX - 1)), snap],
              future: [],
            });
          }
          flushPersist();
        },

        removeOverlay: (id) => {
          const script = get().script.map((l) =>
            l.overlayId === id ? { ...l, overlayId: null } : l,
          );
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              overlays: pageOverlays(page).filter((o) => o.id !== id),
            })),
            script,
            selectedOverlayId:
              get().selectedOverlayId === id ? null : get().selectedOverlayId,
          });
        },

        deleteSelection: () => {
          const s = get();
          if (s.selectedOverlayId) {
            s.removeOverlay(s.selectedOverlayId);
            return;
          }
          const pid = s.selectedPanelId;
          if (!pid) return;
          const panel = s.currentPage().panels.find((p) => p.id === pid);
          if (panel?.image) s.clearPanel(pid);
          else s.removePanel(pid);
        },

        duplicateOverlay: (id) => {
          const s = get();
          const oid = id ?? s.selectedOverlayId;
          const page = s.currentPage();
          const src = pageOverlays(page).find((o) => o.id === oid);
          if (!src) return;
          const copy: Overlay = {
            ...src,
            id: uid("ov"),
            x: clamp(src.x + 4, 0, 100 - src.w),
            y: clamp(src.y + 4, 0, 100 - src.h),
            scriptLineId: undefined,
          };
          const list = [...pageOverlays(page)];
          const idx = list.findIndex((o) => o.id === src.id);
          list.splice(idx + 1, 0, copy);
          let script = s.script;
          if (src.scriptLineId) {
            const srcLine = script.find((l) => l.id === src.scriptLineId);
            if (srcLine) {
              const line: ScriptLine = {
                ...srcLine,
                id: uid("line"),
                overlayId: copy.id,
                text: copy.text,
                pageId: page.id,
              };
              copy.scriptLineId = line.id;
              const at = script.findIndex((l) => l.id === srcLine.id);
              script = [...script.slice(0, at + 1), line, ...script.slice(at + 1)];
            }
          }
          commit({
            pages: patchPage(s.pages, s.currentPageId, (p) => ({
              ...p,
              overlays: list,
            })),
            script,
            selectedOverlayId: copy.id,
            selectedPanelId: null,
          });
        },

        bringForward: (id) => {
          const page = get().currentPage();
          const list = pageOverlays(page).map((o) =>
            o.id === id ? { ...o, behind: false } : o,
          );
          const i = list.findIndex((o) => o.id === id);
          if (i < 0 || i >= list.length - 1) {
            if (i >= 0) {
              commit({
                pages: patchPage(get().pages, get().currentPageId, (p) => ({
                  ...p,
                  overlays: list,
                })),
              });
            }
            return;
          }
          commit({
            pages: patchPage(get().pages, get().currentPageId, (p) => ({
              ...p,
              overlays: moveOverlay(list, id, i + 1),
            })),
          });
        },

        sendBackward: (id) => {
          const page = get().currentPage();
          const list = pageOverlays(page);
          const i = list.findIndex((o) => o.id === id);
          if (i <= 0) return;
          commit({
            pages: patchPage(get().pages, get().currentPageId, (p) => ({
              ...p,
              overlays: moveOverlay(list, id, i - 1),
            })),
          });
        },

        bringToFront: (id) => {
          const list = pageOverlays(get().currentPage()).map((o) =>
            o.id === id ? { ...o, behind: false } : o,
          );
          commit({
            pages: patchPage(get().pages, get().currentPageId, (p) => ({
              ...p,
              overlays: moveOverlay(list, id, list.length),
            })),
          });
        },

        sendToBack: (id) => {
          const list = pageOverlays(get().currentPage()).map((o) =>
            o.id === id ? { ...o, behind: true } : o,
          );
          commit({
            pages: patchPage(get().pages, get().currentPageId, (p) => ({
              ...p,
              overlays: moveOverlay(list, id, 0),
            })),
          });
        },

        addCustomSticker: (src, name) => {
          const item: CustomSticker = {
            id: uid("emo"),
            src,
            name: name.replace(/\.[^.]+$/, "") || "Logo",
          };
          set({ customStickers: [...get().customStickers, item] });
          return item;
        },

        removeCustomSticker: (id) => {
          set({
            customStickers: get().customStickers.filter((s) => s.id !== id),
          });
        },

        placeLogo: (src) => {
          const state = get();
          const logoSrc = src || state.customStickers[state.customStickers.length - 1]?.src;
          if (!logoSrc) return;
          const page = state.currentPage();
          const overlay = makeOverlay(
            "sticker",
            boxesForPage(page, state.margin, state.gutter, state.rtl),
            state.selectedPanelId,
            undefined,
            undefined,
            logoSrc,
          );
          overlay.w = 18;
          overlay.h = 9;
          overlay.x = 6;
          overlay.y = 3.2;
          overlay.color = "";
          commit({
            pages: patchPage(state.pages, state.currentPageId, (p) => ({
              ...p,
              overlays: [...pageOverlays(p), overlay],
            })),
            selectedOverlayId: overlay.id,
            selectedPanelId: null,
          });
        },

        addBackground: (src, name) => {
          const item: LibraryImage = {
            id: uid("bg"),
            src,
            name: name.replace(/\.[^.]+$/, "") || "Background",
          };
          set({ backgrounds: [...get().backgrounds, item] });
          return item;
        },

        removeBackground: (id) => {
          set({
            backgrounds: get().backgrounds.filter((s) => s.id !== id),
          });
        },

        nudgeOverlay: (id, dx, dy) => {
          const o = pageOverlays(get().currentPage()).find((x) => x.id === id);
          if (!o || o.locked) return;
          commit({
            pages: patchPage(get().pages, get().currentPageId, (page) => ({
              ...page,
              overlays: pageOverlays(page).map((item) =>
                item.id === id
                  ? {
                      ...item,
                      x: clamp(item.x + dx, 0, 100 - item.w),
                      y: clamp(item.y + dy, 0, 100 - item.h),
                    }
                  : item,
              ),
            })),
          });
        },

        undo: () => {
          const s = get();
          const prev = s.past[s.past.length - 1];
          if (!prev) return;
          lastRecordAt = 0;
          set({
            ...prev,
            pages: clonePages(prev.pages),
            past: s.past.slice(0, -1),
            future: [takeSnap(s), ...s.future].slice(0, HISTORY_MAX),
            selectedPanelId: null,
            selectedOverlayId: null,
          });
        },

        redo: () => {
          const s = get();
          const next = s.future[0];
          if (!next) return;
          lastRecordAt = 0;
          set({
            ...next,
            pages: clonePages(next.pages),
            past: [...s.past, takeSnap(s)].slice(-HISTORY_MAX),
            future: s.future.slice(1),
            selectedPanelId: null,
            selectedOverlayId: null,
          });
        },

        replaceDocument: (doc) => {
          lastRecordAt = 0;
          const pages = clonePages(doc.pages);
          const currentPageId =
            pages.find((p) => p.id === doc.currentPageId)?.id ?? pages[0]!.id;
          set({
            pages,
            currentPageId,
            gutter: doc.gutter,
            margin: doc.margin,
            border: doc.border,
            paper: doc.paper,
            paperSize: doc.paperSize ?? DEFAULT_PAPER_SIZE,
            bleed: doc.bleed ?? 0,
            rtl: doc.rtl,
            showNumbers: doc.showNumbers,
            handInk: doc.handInk !== false,
            projectId: doc.projectId,
            projectName: doc.projectName || "Untitled",
            past: [],
            future: [],
            selectedPanelId: null,
            selectedOverlayId: null,
            editingPanelId: null,
            pendingSrc: null,
            pendingBackground: null,
            script: doc.script ? cloneScript(doc.script) : [],
            cast: doc.cast ? cloneCast(doc.cast) : get().cast,
            book: doc.book ? { ...defaultBook(), ...doc.book } : defaultBook(),
            chapters: Array.isArray(doc.chapters)
              ? sanitizeChapters(cloneChapters(doc.chapters), pages)
              : [],
          });
        },

        newProject: () => {
          lastRecordAt = 0;
          const page = makePage("blank", false);
          set({
            pages: [page],
            currentPageId: page.id,
            projectId: null,
            projectName: "Untitled",
            past: [],
            future: [],
            selectedPanelId: null,
            selectedOverlayId: null,
            editingPanelId: null,
            pendingSrc: null,
            pendingBackground: null,
            imageTool: "frame",
            script: [],
            book: defaultBook(),
            chapters: [],
          });
        },

        newBrochure: () => {
          lastRecordAt = 0;
          const page = makeBrochurePage();
          set({
            pages: [page],
            currentPageId: page.id,
            projectId: null,
            projectName: "Clinic brochure",
            paper: "white",
            paperSize: "letter",
            gutter: 1.8,
            margin: 5,
            border: 0.08,
            showNumbers: false,
            rtl: false,
            past: [],
            future: [],
            selectedPanelId: null,
            selectedOverlayId: null,
            editingPanelId: null,
            pendingSrc: null,
            pendingBackground: null,
            imageTool: "frame",
            script: [],
            book: defaultBook(),
            chapters: [],
          });
        },

        setProjectName: (projectName) => set({ projectName }),

        addCast: (name, portrait) => {
          const s = get();
          const member: CastMember = {
            id: uid("cast"),
            name: (name ?? "").trim() || `Character ${s.cast.length + 1}`,
            color: nextCastColor(s.cast),
            portrait,
          };
          commit({ cast: [...s.cast, member] });
          return member;
        },

        renameCast: (id, name) => {
          const trimmed = name.trim();
          if (!trimmed) return;
          commit({
            cast: get().cast.map((c) => (c.id === id ? { ...c, name: trimmed } : c)),
          });
        },

        setCastPortrait: (id, src) => {
          commit({
            cast: get().cast.map((c) =>
              c.id === id ? { ...c, portrait: src || undefined } : c,
            ),
          });
        },

        removeCast: (id) => {
          commit({
            cast: get().cast.filter((c) => c.id !== id),
            script: get().script.map((l) =>
              l.speakerId === id ? { ...l, speakerId: null } : l,
            ),
            pages: get().pages.map((page) => ({
              ...page,
              overlays: pageOverlays(page).map((o) =>
                o.speakerId === id ? { ...o, speakerId: undefined } : o,
              ),
            })),
          });
        },

        stampCast: (id) => {
          const member = get().cast.find((c) => c.id === id);
          if (!member?.portrait) return;
          get().addOverlay("sticker", undefined, undefined, member.portrait);
        },

        addScriptLine: (partial) => {
          const s = get();
          const line: ScriptLine = {
            id: uid("line"),
            speakerId: partial?.speakerId ?? s.cast[0]?.id ?? null,
            kind: partial?.kind ?? "speech",
            text: partial?.text ?? "",
            pageId: partial?.pageId ?? s.currentPageId,
            overlayId: partial?.overlayId ?? null,
          };
          commit({ script: [...s.script, line] });
          return line;
        },

        updateScriptLine: (id, patch) => {
          const s = get();
          const line = s.script.find((l) => l.id === id);
          if (!line) return;
          const next: ScriptLine = { ...line, ...patch };
          let pages = s.pages;
          if (
            next.overlayId &&
            (patch.text != null || patch.kind != null || patch.speakerId !== undefined)
          ) {
            pages = s.pages.map((page) => ({
              ...page,
              overlays: pageOverlays(page).map((o) => {
                if (o.id !== next.overlayId) return o;
                const updated = { ...o };
                if (patch.text != null) {
                  updated.text = patch.text;
                  const box = fitLetterBox(
                    updated,
                    pageAspect(s.paperSize),
                    updated.autoFit === false ? "grow" : "auto",
                    o,
                  );
                  if (box) Object.assign(updated, box);
                  else if (updated.autoFit !== false) {
                    const size = fitBubbleSize({ ...updated, text: patch.text });
                    updated.w = size.w;
                    updated.h = size.h;
                    updated.x = clamp(o.x + (o.w - size.w) / 2, 0, 100 - size.w);
                    updated.y = clamp(o.y + (o.h - size.h) / 2, 0, 100 - size.h);
                  }
                }
                if (patch.kind && isScriptKind(patch.kind)) updated.kind = patch.kind;
                if (patch.speakerId !== undefined) {
                  updated.speakerId = patch.speakerId ?? undefined;
                }
                return updated;
              }),
            }));
          }
          commit({
            script: s.script.map((l) => (l.id === id ? next : l)),
            pages,
          });
        },

        removeScriptLine: (id) => {
          const line = get().script.find((l) => l.id === id);
          commit({
            script: get().script.filter((l) => l.id !== id),
            pages: line?.overlayId
              ? get().pages.map((page) => ({
                  ...page,
                  overlays: pageOverlays(page).map((o) =>
                    o.id === line.overlayId ? { ...o, scriptLineId: undefined } : o,
                  ),
                }))
              : get().pages,
          });
        },

        placeScriptLine: (id) => {
          const s = get();
          const line = s.script.find((l) => l.id === id);
          if (!line) return;
          if (line.overlayId) {
            s.focusScriptLine(id);
            return;
          }
          const page = s.currentPage();
          const boxes = boxesForPage(page, s.margin, s.gutter, s.rtl);
          const kind = isScriptKind(line.kind) ? line.kind : "speech";
          const overlay = makeOverlay(
            kind,
            boxes,
            s.selectedPanelId,
            undefined,
            line.text || "…",
          );
          overlay.scriptLineId = line.id;
          overlay.speakerId = line.speakerId ?? undefined;
          const box = fitLetterBox(overlay, pageAspect(s.paperSize), "auto");
          if (box) Object.assign(overlay, box);
          else {
            const size = fitBubbleSize(overlay);
            overlay.w = size.w;
            overlay.h = size.h;
          }
          overlay.x = clamp(overlay.x, 0, 100 - overlay.w);
          overlay.y = clamp(overlay.y, 0, 100 - overlay.h);
          commit({
            pages: patchPage(s.pages, s.currentPageId, (p) => ({
              ...p,
              overlays: [...pageOverlays(p), overlay],
            })),
            script: s.script.map((l) =>
              l.id === id
                ? { ...l, overlayId: overlay.id, pageId: page.id }
                : l,
            ),
            selectedOverlayId: overlay.id,
            selectedPanelId: null,
          });
        },

        focusScriptLine: (id) => {
          const s = get();
          const line = s.script.find((l) => l.id === id);
          if (!line?.overlayId) return;
          for (const page of s.pages) {
            if (pageOverlays(page).some((o) => o.id === line.overlayId)) {
              set({
                currentPageId: page.id,
                selectedOverlayId: line.overlayId,
                selectedPanelId: null,
              });
              return;
            }
          }
        },

        assignSpeaker: (overlayId, speakerId) => {
          const s = get();
          let found: Overlay | undefined;
          for (const page of s.pages) {
            found = pageOverlays(page).find((o) => o.id === overlayId);
            if (found) break;
          }
          if (!found) return;
          if (found.scriptLineId) {
            s.updateScriptLine(found.scriptLineId, { speakerId });
            return;
          }
          if (!isScriptKind(found.kind)) {
            commit({
              pages: s.pages.map((page) => ({
                ...page,
                overlays: pageOverlays(page).map((o) =>
                  o.id === overlayId ? { ...o, speakerId: speakerId ?? undefined } : o,
                ),
              })),
            });
            return;
          }
          const line: ScriptLine = {
            id: uid("line"),
            speakerId,
            kind: isScriptKind(found.kind) ? found.kind : "speech",
            text: found.text,
            pageId: s.currentPageId,
            overlayId: found.id,
          };
          commit({
            script: [...s.script, line],
            pages: s.pages.map((page) => ({
              ...page,
              overlays: pageOverlays(page).map((o) =>
                o.id === overlayId
                  ? { ...o, speakerId: speakerId ?? undefined, scriptLineId: line.id }
                  : o,
              ),
            })),
          });
        },

        addSplashPage: (src) => {
          const page = makePage("splash", false);
          page.panels = [{ id: page.panels[0]!.id, image: freshImage(src) }];
          commit({
            pages: [...get().pages, page],
            currentPageId: page.id,
            selectedPanelId: page.panels[0]!.id,
            selectedOverlayId: null,
          });
        },
      };
    },
    {
      skipHydration: true,
      name: "koma-studio-v2",
      storage: idbStorage as PersistStorage<unknown>,
      partialize: (s) => ({
        pages: s.pages,
        currentPageId: s.currentPageId,
        gutter: s.gutter,
        margin: s.margin,
        border: s.border,
        paper: s.paper,
        paperSize: s.paperSize,
        bleed: s.bleed,
        snapEdges: s.snapEdges,
        handInk: s.handInk,
        spread: s.spread,
        theme: s.theme,
        rtl: s.rtl,
        showNumbers: s.showNumbers,
        projectId: s.projectId,
        projectName: s.projectName,
        customStickers: s.customStickers,
        backgrounds: s.backgrounds,
        script: s.script,
        cast: s.cast,
        book: s.book,
        chapters: s.chapters,
        schema: 4,
      }),
      merge: (persisted, current) => {
        const raw = (persisted ?? {}) as Partial<StudioState> & { schema?: number };
        const schema = raw.schema ?? 0;
        const { schema: _schema, ...p } = raw;
        const next = {
          ...current,
          ...p,
          past: [] as HistorySnap[],
          future: [] as HistorySnap[],
          script: Array.isArray(p.script) ? p.script : [],
          cast: Array.isArray(p.cast) ? p.cast : current.cast,
          book:
            p.book && typeof p.book === "object"
              ? { ...defaultBook(), ...p.book }
              : defaultBook(),
          chapters: Array.isArray(p.chapters) ? p.chapters : [],
        };
        if (schema < 3) {
          if ((p.border ?? 0) >= 0.28) next.border = 0.22;
          if ((p.gutter ?? 0) >= 1.05) next.gutter = 0.9;
          next.showNumbers = false;
        }
        const prefs = readPrefs();
        if (prefs.theme === "dark" || prefs.theme === "light") next.theme = prefs.theme;
        if (prefs.paper) next.paper = prefs.paper;
        if (prefs.paperSize) next.paperSize = prefs.paperSize;
        if (typeof prefs.gutter === "number") next.gutter = prefs.gutter;
        if (typeof prefs.margin === "number") next.margin = prefs.margin;
        if (typeof prefs.border === "number") next.border = prefs.border;
        if (typeof prefs.bleed === "number") next.bleed = prefs.bleed;
        if (typeof prefs.rtl === "boolean") next.rtl = prefs.rtl;
        if (typeof prefs.showNumbers === "boolean") next.showNumbers = prefs.showNumbers;
        if (typeof prefs.spread === "boolean") next.spread = prefs.spread;
        if (typeof prefs.snapEdges === "boolean") next.snapEdges = prefs.snapEdges;
        if (typeof prefs.handInk === "boolean") next.handInk = prefs.handInk;
        return next;
      },
      onRehydrateStorage: () => (state) => {
        const fromPrefs = readPrefs().theme;
        const theme =
          fromPrefs === "dark" || fromPrefs === "light"
            ? fromPrefs
            : state?.theme === "dark"
              ? "dark"
              : "light";
        applyTheme(theme);
      },
    },
  ),
);

if (typeof window !== "undefined") {
  applyTheme(boot.theme === "dark" ? "dark" : "light");
  useStudio.subscribe((s) => {
    writePrefs({
      theme: s.theme,
      paper: s.paper,
      paperSize: s.paperSize,
      gutter: s.gutter,
      margin: s.margin,
      border: s.border,
      bleed: s.bleed,
      rtl: s.rtl,
      showNumbers: s.showNumbers,
      spread: s.spread,
      snapEdges: s.snapEdges,
      handInk: s.handInk,
    });
  });
}

export function useCurrentPage(): PageState {
  return useStudio(
    (s) => s.pages.find((p) => p.id === s.currentPageId) ?? s.pages[0]!,
  );
}

export type { FitMode, PaperTone, ImageTool };
