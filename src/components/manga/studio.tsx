import {
  memo,
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Cloud,
  FileText,
  FolderOpen,
  Heart,
  ImagePlus,
  Italic,
  LayoutGrid,
  MessageCircle,
  Paintbrush,
  PanelLeft,
  Plus,
  RectangleHorizontal,
  RotateCw,
  ScrollText,
  Share,
  Trash2,
  Type,
  FlipHorizontal2,
  FlipVertical2,
  Crop,
  X,
  ZoomIn,
  ZoomOut,
  BookOpen,
  Undo2,
  Redo2,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { SpreadView } from "@/components/manga/spread-view";
import { PageThumb } from "@/components/manga/page-thumb";
import {
  PageContextMenu,
  PageInsertMark,
  pageRailMenuFromEvent,
  pageRailMenuFromPoint,
  usePageRailMenus,
  type PageRailMenu,
} from "@/components/manga/page-rail";
import { TemplateThumb } from "@/components/manga/template-thumb";
import { StickerMark } from "@/components/manga/bubble";
import { AppMenu } from "@/components/manga/app-menu";
import { CheckRow, Segmented } from "@/components/manga/controls";
import { NewProjectDialog, type NewProjectChoice } from "@/components/manga/new-project-dialog";
import { CommandPalette } from "@/components/manga/command-palette";
import { Floating } from "@/components/manga/floating";
import { ExportDialog } from "@/components/manga/export-dialog";
import { Reader } from "@/components/manga/reader";
import { ScriptPanel } from "@/components/manga/script-panel";
import { BalloonStylePicker } from "@/components/manga/balloon-style";
import { BalloonPaintControls } from "@/components/manga/balloon-paint";
import { balloonStyleOf, BALLOON_STYLES } from "@/lib/manga/balloons";
import {
  OpenProjectDialog,
  ProjectPanel,
  SaveAsDialog,
} from "@/components/manga/project-dialogs";
import { SAMPLES } from "@/lib/manga/samples";
import { TEMPLATES } from "@/lib/manga/templates";
import {
  LETTER_COLORS,
  LETTER_FONT_MAX,
  LETTER_FONT_MIN,
  STICKERS,
  SFX_GROUPS,
  isDialogue,
  pageOverlays,
  pageTitle,
} from "@/lib/manga/lettering";
import { letterFont, defaultFontId } from "@/lib/manga/fonts";
import { FontFamilyControl } from "@/components/manga/font-family";
import {
  CLINIC_ICONS,
  CLINIC_ICON_GROUPS,
  clinicIconSrc,
} from "@/lib/manga/clinic-icons";
import type { Overlay, OverlayKind, PaperTone, PanelImage, StickerId } from "@/lib/manga/types";
import { IMAGE_ZOOM_MAX, IMAGE_ZOOM_MIN, fileToLogoSrc } from "@/lib/manga/image";
import { PAPER_SIZES, paperSpec } from "@/lib/manga/paper";
import { pageUnit } from "@/components/manga/print-guides";
import { selectionIds, useCurrentPage, useStudio, type AlignMode } from "@/lib/manga/store";
import { cn, clamp, prefersReducedMotion } from "@/lib/utils";
import {
  imageFilesFrom,
  isFileDrag,
  panelIdAtPoint,
  uploadImageFiles,
} from "@/lib/manga/drop";
import {
  combo,
  handleStudioHotkey,
  isTypingTarget,
  modKey,
  useApplePlatform,
} from "@/lib/manga/hotkeys";
import { cancelPasteFallback, parseOverlayClipboard } from "@/lib/manga/clipboard";
import {
  bindProjectUi,
  downloadProjectFile,
  isKomaFile,
  loadProjectFile,
  saveNamedProject,
  autosaveProject,
  AUTOSAVE_MS,
  startNewBrochure,
  startNewProject,
  duplicateNamedProject,
  renameNamedProject,
  switchToProject,
} from "@/lib/manga/project";
import {
  groupPagesByChapter,
  needsPad,
  pageLabel,
} from "@/lib/manga/book";
import {
  settleZoom,
  stepZoom,
  zoomLabel as formatZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PRESETS,
  type PageZoom,
} from "@/lib/manga/zoom";
import {
  anchorAt,
  layoutRect,
  placeZoom,
  transformFor,
  union,
  type Placement,
} from "@/lib/manga/zoom-motion";

/** Quiet time after an edit before the project is written. */
const AUTOSAVE_SOON_MS = 2500;

type Drawer = "layouts" | "images" | "adjust" | "script" | null;
type Menu = "layout" | "zoom" | "media" | "stickers" | "title" | null;
type InspectorTab = "format" | "document" | "script";
type StickerTab = "manga" | "clinic" | "logos";

export function Studio() {
  const page = useCurrentPage();
  const pages = useStudio((s) => s.pages);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const pickFor = useRef<string | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [stickerTab, setStickerTab] = useState<StickerTab>("clinic");
  const [tab, setTab] = useState<InspectorTab>("format");
  const [thumbs, setThumbs] = useState(true);
  const [zoom, setZoom] = useState<PageZoom>("fit");
  const zoomRef = useRef<PageZoom>("fit");
  zoomRef.current = zoom;
  /** The page's width at Fit, measured whenever Fit is showing. */
  const fitPx = useRef(0);
  /** A zoom step in flight: the transform eases, then the real layout lands. */
  const zoomMotion = useRef<{ token: number; next: PageZoom; place: Placement } | null>(null);
  const zoomCommit = useRef<Placement | null>(null);
  /** A pinch in progress: the running scale against the laid-out size. */
  const pinch = useRef<{ k: number; fromPx: number; start: number } | null>(null);
  /** The last transform placed on the sheets, to tell a no-op settle apart. */
  const lastPlace = useRef<Placement | null>(null);
  const [pageMenu, setPageMenu] = useState<PageRailMenu | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveAsCopy, setSaveAsCopy] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [newOpen, setNewOpen] = useState<"manga" | "brochure" | null>(null);
  // The reader stays mounted a beat after read mode ends, for its fade-out.
  const [readerShown, setReaderShown] = useState(() => useStudio.getState().readMode);
  const [ghost, setGhost] = useState<{
    src: string;
    x: number;
    y: number;
  } | null>(null);

  usePageRailMenus((next) => {
    if (next.pageId) useStudio.getState().setCurrentPage(next.pageId);
    setPageMenu(next);
  });

  function openThumbMenu(x: number, y: number, host: HTMLElement) {
    const rail = host.closest<HTMLElement>(
      "[data-koma='page-rail'],[data-koma='page-rail-mobile']",
    );
    if (!rail) return;
    const axis =
      rail.getAttribute("data-koma") === "page-rail-mobile" ? "x" : "y";
    const next = pageRailMenuFromPoint(rail, x, y, axis, host);
    if (next.pageId) useStudio.getState().setCurrentPage(next.pageId);
    setPageMenu(next);
  }

  const selectedPanelId = useStudio((s) => s.selectedPanelId);
  const selectedOverlayId = useStudio((s) => s.selectedOverlayId);
  const imageTool = useStudio((s) => s.imageTool);
  const pendingSrc = useStudio((s) => s.pendingSrc);
  const gutter = useStudio((s) => s.gutter);
  const margin = useStudio((s) => s.margin);
  const border = useStudio((s) => s.border);
  const paper = useStudio((s) => s.paper);
  const rtl = useStudio((s) => s.rtl);
  const showNumbers = useStudio((s) => s.showNumbers);
  const projectName = useStudio((s) => s.projectName);
  const projectId = useStudio((s) => s.projectId);
  const theme = useStudio((s) => s.theme);
  const spread = useStudio((s) => s.spread);
  const customStickers = useStudio((s) => s.customStickers);
  const chapters = useStudio((s) => s.chapters);
  const coverFirst = useStudio((s) => s.book.coverFirst);
  const readMode = useStudio((s) => s.readMode);
  const apple = useApplePlatform();
  const k = (key: string, m: Parameters<typeof combo>[1] = {}) =>
    combo(key, m, apple);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const undoLabel = useStudio((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useStudio((s) => s.future[0]?.label);
  const selectedCount = useStudio((s) => selectionIds(s).length);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // "— Edited" after the name, like an NSDocument window: on while a change
  // waits for autosave, then it lingers a moment after the save and fades.
  const [edited, setEdited] = useState<"clean" | "edited" | "saved">("clean");
  const editedTimer = useRef(0);
  const [renameTick, setRenameTick] = useState(0);

  const selected = page.panels.find((p) => p.id === selectedPanelId) ?? null;
  const selectedOverlay =
    pageOverlays(page).find((o) => o.id === selectedOverlayId) ?? null;

  useEffect(() => {
    void useStudio.persist.rehydrate();
  }, []);

  useEffect(() => {
    bindProjectUi({
      save: () => {
        const s = useStudio.getState();
        if (s.projectId) {
          void saveNamedProject().then((record) =>
            toast.success(`Saved “${record.name}”`),
          );
          return;
        }
        setSaveAsCopy(false);
        setSaveOpen(true);
      },
      saveAs: (asCopy) => {
        setSaveAsCopy(asCopy);
        setSaveOpen(true);
      },
      open: () => setProjectsOpen(true),
    });
    return () => bindProjectUi(null);
  }, []);

  useEffect(() => {
    let dirty = false;
    const mark = (state: ReturnType<typeof useStudio.getState>, prev: ReturnType<typeof useStudio.getState>) => {
      // Hydration replaces the document wholesale; that is not an edit.
      if (!useStudio.persist.hasHydrated()) return;
      if (
        state.pages === prev.pages &&
        state.gutter === prev.gutter &&
        state.margin === prev.margin &&
        state.border === prev.border &&
        state.paper === prev.paper &&
        state.paperSize === prev.paperSize &&
        state.rtl === prev.rtl &&
        state.showNumbers === prev.showNumbers &&
        state.projectName === prev.projectName &&
        state.book === prev.book &&
        state.chapters === prev.chapters &&
        state.script === prev.script &&
        state.cast === prev.cast
      ) {
        return;
      }
      dirty = true;
      window.clearTimeout(editedTimer.current);
      setEdited("edited");
      // Save soon after the last edit, not only on the slow interval.
      window.clearTimeout(soon);
      soon = window.setTimeout(() => void flush(), AUTOSAVE_SOON_MS);
    };
    let soon = 0;
    const unsub = useStudio.subscribe(mark);
    async function flush() {
      if (!dirty) return;
      dirty = false;
      try {
        const record = await autosaveProject();
        if (record) setSavedAt(record.updatedAt);
        if (!dirty) {
          setEdited("saved");
          window.clearTimeout(editedTimer.current);
          editedTimer.current = window.setTimeout(
            () => setEdited((v) => (v === "saved" ? "clean" : v)),
            prefersReducedMotion() ? 1200 : 1500,
          );
        }
      } catch {
        dirty = true;
      }
    }
    const tick = window.setInterval(() => {
      void flush();
    }, AUTOSAVE_MS);
    function onHide() {
      if (document.visibilityState === "hidden") void flush();
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(soon);
      window.clearTimeout(editedTimer.current);
      unsub();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  useEffect(() => {
    if (tab === "script") return;
    if (selectedPanelId || selectedOverlayId) setTab("format");
  }, [selectedPanelId, selectedOverlayId, tab]);

  useEffect(() => {
    if (!menu) return;
    function close(e: PointerEvent) {
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest("[data-koma-menu],[data-koma-popover],[data-koma-menu-btn]")
      ) {
        return;
      }
      setMenu(null);
    }
    window.addEventListener("pointerup", close);
    return () => window.removeEventListener("pointerup", close);
  }, [menu]);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      cancelPasteFallback();
      if (useStudio.getState().readMode) return;
      if (document.querySelector("[data-koma-dialog]")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) {
        if (isTypingTarget(e.target)) return;
        // A balloon copied here (or in another window) rides in the HTML
        // flavour; newer text from elsewhere means there is nothing to paste
        // on the page, and with an empty clipboard the in-app copy pastes.
        const text = e.clipboardData?.getData("text/plain") ?? "";
        const html = e.clipboardData?.getData("text/html") ?? "";
        const fromClip = parseOverlayClipboard(text, html);
        if (!fromClip && text.trim()) return;
        const pasted = useStudio.getState().pasteOverlay(fromClip);
        if (pasted) e.preventDefault();
        return;
      }
      e.preventDefault();
      const target =
        useStudio.getState().selectedPanelId ??
        useStudio.getState().currentPage().panels.find((p) => !p.image)?.id;
      void uploadImageFiles(files, target).catch((err) =>
        toast.error(err instanceof Error ? err.message : "Paste failed"),
      );
    }
    // A sheet that closes on this very key (Radix dismisses in the capture
    // phase, and with motion off it unmounts at once) must still own it.
    let dialogAtCapture: Element | null = null;
    function onKeyCapture() {
      dialogAtCapture = document.querySelector("[data-koma-dialog]");
    }
    function onKey(e: KeyboardEvent) {
      // A widget that already took the key (a pop-up list's typeahead and
      // arrows, a layer's Esc) keeps it from the page's hotkeys; the text
      // fields handle their own keys and the hotkey layer knows them.
      if (
        e.defaultPrevented &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        return;
      }
      // ⌘K (or ⌘⇧P) toggles the command palette; it closes itself too, but
      // another sheet keeps the keyboard, and the reader has no palette.
      const dialog = dialogAtCapture ?? document.querySelector("[data-koma-dialog]");
      dialogAtCapture = null;
      if (
        modKey(e) &&
        !e.altKey &&
        ((e.key.toLowerCase() === "k" && !e.shiftKey) ||
          (e.key.toLowerCase() === "p" && e.shiftKey))
      ) {
        if (dialog && dialog.getAttribute("data-koma-dialog") !== "commands") return;
        if (useStudio.getState().readMode) return;
        e.preventDefault();
        setCmdOpen((v) => !v);
        return;
      }
      // A sheet owns the keyboard while it is up (Radix handles Esc and Return).
      if (dialog) return;
      if (useStudio.getState().readMode) {
        const used = handleStudioHotkey(e);
        if (used && e.key === "Escape") {
          setDrawer(null);
          setMenu(null);
          setPageMenu(null);
          setExportOpen(false);
        }
        return;
      }
      if (modKey(e) && e.key.toLowerCase() === "e" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setExportOpen(true);
        return;
      }
      // ⌥⌘P thumbnails, ⌥⌘I Format, ⌥⌘J Document: the Pages set. ⌥ turns the
      // key into a dead glyph on macOS, so go by the physical key.
      if (modKey(e) && e.altKey && !e.shiftKey && !isTypingTarget(e.target)) {
        if (e.code === "KeyP") {
          e.preventDefault();
          setThumbs((v) => !v);
          return;
        }
        if (e.code === "KeyI") {
          e.preventDefault();
          setTab("format");
          return;
        }
        if (e.code === "KeyJ") {
          e.preventDefault();
          setTab("document");
          return;
        }
        if (e.code === "KeyG") {
          e.preventDefault();
          const s = useStudio.getState();
          s.setShowGuides(!s.showGuides);
          return;
        }
        if (e.code === "KeyL") {
          e.preventDefault();
          const s = useStudio.getState();
          s.setShowGrid(!s.showGrid);
          return;
        }
      }
      if (
        modKey(e) &&
        !isTypingTarget(e.target) &&
        (e.key === "=" || e.key === "+" || e.code === "NumpadAdd")
      ) {
        e.preventDefault();
        zoomToRef.current(stepZoom(zoomBaseRef.current(), 1));
        return;
      }
      if (
        modKey(e) &&
        !isTypingTarget(e.target) &&
        (e.key === "-" || e.code === "NumpadSubtract")
      ) {
        e.preventDefault();
        zoomToRef.current(stepZoom(zoomBaseRef.current(), -1));
        return;
      }
      if (modKey(e) && e.code === "Digit0" && e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        zoomToRef.current(100);
        return;
      }
      if (modKey(e) && e.key === "0" && !isTypingTarget(e.target)) {
        e.preventDefault();
        zoomToRef.current("fit");
        return;
      }
      const used = handleStudioHotkey(e);
      if (used && e.key === "Escape") {
        setDrawer(null);
        setMenu(null);
        setPageMenu(null);
        setExportOpen(false);
      }
    }
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKeyCapture, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKeyCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // ---- Zoom motion: the sheets scale on the GPU, then lay out once at the real size.
  const zoomParts = useCallback(() => {
    const stage = stageRef.current;
    const subject = stage?.querySelector<HTMLElement>("[data-koma-zoom-subject]") ?? null;
    const pages = stage ? [...stage.querySelectorAll<HTMLElement>(".paper-sheet")] : [];
    if (!stage || !subject || !pages.length) return null;
    // The reference sheet is a real page: a spread's empty verso is a
    // placeholder that does not follow the zoom.
    const page = pages.find((p) => p.dataset.koma !== "spread-verso") ?? pages[0]!;
    return { stage, subject, pages, page };
  }, []);

  /** The zoom a step counts from: the one in flight, else the one laid out. */
  const zoomBase = useCallback(() => zoomMotion.current?.next ?? zoomRef.current, []);

  const targetPx = useCallback(
    (z: PageZoom) => (z === "fit" ? fitPx.current : Math.round(5.6 * z)),
    [],
  );

  const finishZoomMotion = useCallback(
    (token: number) => {
      const m = zoomMotion.current;
      if (!m || m.token !== token) return;
      zoomMotion.current = null;
      const parts = zoomParts();
      if (!parts) return;
      parts.stage.removeAttribute("data-zoom-motion");
      parts.stage.setAttribute("data-pinching", "");
      zoomCommit.current = m.place;
      if (Object.is(m.next, zoomRef.current)) {
        // Same zoom as before (a pinch that settled back): swap now.
        landZoom();
        return;
      }
      zoomRef.current = m.next;
      setZoom(m.next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoomParts],
  );

  /** The real layout is in: drop the transform and scroll to where the motion ended. */
  function landZoom() {
    const place = zoomCommit.current;
    const parts = zoomParts();
    if (!place || !parts) return;
    zoomCommit.current = null;
    parts.subject.style.transform = "";
    parts.stage.scrollLeft = place.scrollLeft;
    parts.stage.scrollTop = place.scrollTop;
    const stage = parts.stage;
    requestAnimationFrame(() => stage.removeAttribute("data-pinching"));
  }

  useLayoutEffect(() => {
    if (zoomCommit.current) landZoom();
    if (zoom === "fit") {
      const parts = zoomParts();
      if (parts) fitPx.current = parts.page.offsetWidth;
    }
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => {
      // At a numeric zoom the Fit width is unknown until Fit shows again, so
      // forget the stale one rather than ease to it.
      if (zoomRef.current !== "fit") {
        fitPx.current = 0;
        return;
      }
      const parts = zoomParts();
      if (parts) fitPx.current = parts.page.offsetWidth;
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [zoomParts]);

  /** Zoom to `next` with motion, keeping `at` (or the stage's centre) still. */
  const zoomTo = useCallback(
    (next: PageZoom, at?: { x: number; y: number }) => {
      const parts = zoomParts();
      if (!parts) {
        zoomRef.current = next;
        setZoom(next);
        return;
      }
      const { stage, subject, pages } = parts;
      const fromPx = parts.page.offsetWidth;
      const toPx = targetPx(next);
      if (!fromPx || !toPx) {
        zoomRef.current = next;
        setZoom(next);
        return;
      }
      const k = toPx / fromPx;
      const seen = union(pages.map((p) => p.getBoundingClientRect()))!;
      const sr = stage.getBoundingClientRect();
      const anchor = anchorAt(seen, at?.x ?? sr.left + sr.width / 2, at?.y ?? sr.top + sr.height / 2);
      const sheets = union(pages.map((p) => layoutRect(stage, p)))!;
      const place = placeZoom(stage, subject, sheets, k, anchor);
      const inFlight = zoomMotion.current;
      const token = (inFlight?.token ?? 0) + 1;
      zoomMotion.current = { token, next, place };
      const target = transformFor(place);
      // Nothing to animate when the sheets already sit there (a pinch that
      // settled on its own size), or when motion is off. A step chained onto
      // a running motion retargets it instead.
      const cur = subject.style.transform ? lastPlace.current : { k: 1, dx: 0, dy: 0 };
      const still =
        !inFlight &&
        cur &&
        Math.abs(cur.k - k) < 0.002 &&
        Math.abs(cur.dx - place.dx) < 1 &&
        Math.abs(cur.dy - place.dy) < 1;
      if (prefersReducedMotion() || still) {
        subject.style.transform = target;
        lastPlace.current = place;
        finishZoomMotion(token);
        return;
      }
      stage.removeAttribute("data-pinching");
      stage.setAttribute("data-zoom-motion", "");
      const onEnd = (e: TransitionEvent) => {
        if (e.target !== subject || e.propertyName !== "transform") return;
        subject.removeEventListener("transitionend", onEnd);
        finishZoomMotion(token);
      };
      subject.addEventListener("transitionend", onEnd);
      window.setTimeout(() => {
        subject.removeEventListener("transitionend", onEnd);
        finishZoomMotion(token);
      }, 400);
      // Next frame, so the transition sees a change from the current transform.
      requestAnimationFrame(() => {
        if (zoomMotion.current?.token !== token) return;
        subject.style.transform = target;
        lastPlace.current = place;
      });
    },
    [zoomParts, targetPx, finishZoomMotion],
  );
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;
  const zoomBaseRef = useRef(zoomBase);
  zoomBaseRef.current = zoomBase;

  // Trackpad pinch (and ⌘/Ctrl + wheel) scale the page live under the fingers;
  // when the gesture ends the size settles on a preset in reach and lays out.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let settle = 0;
    let gestureAt = 0;
    /** Begin a pinch from whatever scale is on screen, even mid-motion. */
    function begin() {
      const parts = zoomParts();
      if (!parts) return null;
      if (!pinch.current) {
        const layoutW = parts.page.offsetWidth;
        const seenW = parts.page.getBoundingClientRect().width;
        const k = layoutW ? seenW / layoutW : 1;
        pinch.current = { k, fromPx: layoutW, start: k };
        zoomMotion.current = null;
        parts.stage.removeAttribute("data-zoom-motion");
        parts.stage.setAttribute("data-pinching", "");
      }
      return parts;
    }
    function live(k: number, x: number, y: number) {
      const parts = begin();
      if (!parts || !pinch.current) return;
      const { stage, subject, pages } = parts;
      const from = pinch.current.fromPx / 5.6;
      pinch.current.k = clamp(k, ZOOM_MIN / from, ZOOM_MAX / from);
      const seen = union(pages.map((p) => p.getBoundingClientRect()))!;
      const sheets = union(pages.map((p) => layoutRect(stage, p)))!;
      const place = placeZoom(stage, subject, sheets, pinch.current.k, anchorAt(seen, x, y));
      subject.style.transform = transformFor(place);
      lastPlace.current = place;
    }
    function end(x: number, y: number) {
      const g = pinch.current;
      pinch.current = null;
      if (!g) return;
      const pct = (g.fromPx * g.k) / 5.6;
      zoomToRef.current(settleZoom(pct, fitPx.current / 5.6), { x, y });
    }
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (performance.now() - gestureAt < 200) return; // Safari also sends gesture events
      // A pinch arrives as many small deltas, a mouse wheel as notches of ~100.
      const factor = 1 + clamp(-e.deltaY / 100, -0.25, 0.25);
      const parts = begin();
      if (!parts || !pinch.current) return;
      live(pinch.current.k * factor, e.clientX, e.clientY);
      window.clearTimeout(settle);
      settle = window.setTimeout(() => end(e.clientX, e.clientY), 160);
    }
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    function onGestureStart(e: Event) {
      e.preventDefault();
      gestureAt = performance.now();
      const g = e as Gesture;
      begin();
      if (pinch.current) live(pinch.current.k, g.clientX, g.clientY);
    }
    function onGestureChange(e: Event) {
      e.preventDefault();
      gestureAt = performance.now();
      const g = e as Gesture;
      begin();
      if (pinch.current) live(pinch.current.start * g.scale, g.clientX, g.clientY);
    }
    function onGestureEnd(e: Event) {
      e.preventDefault();
      const g = e as Gesture;
      end(g.clientX, g.clientY);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("gestureend", onGestureEnd);
    return () => {
      window.clearTimeout(settle);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, [zoomParts]);

  useEffect(() => {
    function over(e: DragEvent) {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
    function drop(e: DragEvent) {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      const koma = [...(e.dataTransfer?.files ?? [])].find(isKomaFile);
      if (koma) {
        void loadProjectFile(koma)
          .then((record) => toast.success(`Opened “${record.name}”`))
          .catch((err) =>
            toast.error(err instanceof Error ? err.message : "Could not open project"),
          );
        return;
      }
      if ((e.target as HTMLElement | null)?.closest?.(".paper-sheet")) return;
      const files = imageFilesFrom(e.dataTransfer);
      if (!files.length) return;
      const id =
        panelIdAtPoint(e.clientX, e.clientY) ??
        useStudio.getState().selectedPanelId;
      void uploadImageFiles(files, id).catch((err) =>
        toast.error(err instanceof Error ? err.message : "Could not add image"),
      );
    }
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  function armPicker(panelId?: string | null) {
    const state = useStudio.getState();
    const page = state.currentPage();
    const id =
      panelId ??
      state.selectedPanelId ??
      page.panels.find((p) => !p.image)?.id ??
      page.panels[0]?.id ??
      null;
    if (!id) return;
    pickFor.current = id;
    state.selectPanel(id);
  }

  function openPicker(panelId?: string | null) {
    armPicker(panelId);
    const input = fileRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length) return;
    try {
      await uploadImageFiles(files, pickFor.current ?? selectedPanelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add image");
    }
  }

  async function onProjectFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const record = await loadProjectFile(file);
      toast.success(`Opened “${record.name}”`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open project");
    }
  }

  function handleSave() {
    const s = useStudio.getState();
    if (s.projectId) {
      void saveNamedProject().then((record) =>
        toast.success(`Saved “${record.name}”`),
      );
      return;
    }
    setSaveAsCopy(false);
    setSaveOpen(true);
  }

  useEffect(() => {
    document.title = `${projectName || "Untitled"}${
      edited === "edited" ? " — Edited" : ""
    } — PanelFox`;
  }, [projectName, edited]);

  useEffect(() => {
    if (readMode) {
      setReaderShown(true);
      return;
    }
    const t = window.setTimeout(() => setReaderShown(false), prefersReducedMotion() ? 0 : 260);
    return () => window.clearTimeout(t);
  }, [readMode]);

  function handleSaveAs() {
    setSaveAsCopy(true);
    setSaveOpen(true);
  }

  function handleNew() {
    setProjectsOpen(false);
    setNewOpen("manga");
  }

  function handleNewBrochure() {
    setProjectsOpen(false);
    setNewOpen("brochure");
  }

  function chooseTemplate(c: NewProjectChoice) {
    setNewOpen(null);
    const start =
      c.kind === "brochure"
        ? startNewBrochure({ templateId: c.templateId })
        : startNewProject({ templateId: c.templateId, paperSize: c.paperSize, rtl: c.rtl });
    void start.then((stashed) => {
      useStudio.getState().setReadMode(false);
      const what = c.kind === "brochure" ? "a clinic brochure" : "a new manga";
      toast.message(
        stashed.saved
          ? `Saved “${stashed.name}”. Started ${what}.`
          : c.kind === "brochure"
            ? "New clinic brochure"
            : "New project",
      );
    });
  }

  const newProjectDialog = (
    <NewProjectDialog
      open={newOpen !== null}
      initialKind={newOpen ?? "manga"}
      onClose={() => setNewOpen(null)}
      onChoose={chooseTemplate}
    />
  );

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const src = await fileToLogoSrc(file);
      useStudio.getState().addCustomSticker(src, file.name);
      useStudio.getState().placeLogo(src);
      setStickerTab("logos");
      toast.success("Logo added — drag it into place");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add logo");
    }
  }

  const pageIndex = pages.findIndex((p) => p.id === page.id) + 1;
  const zoomLabel = formatZoom(zoom);

  return (
    <>
    <div
      className="flex h-dvh min-h-0 flex-col bg-chrome text-ink"
      data-koma="editor"
      inert={readMode || undefined}
      aria-hidden={readMode || undefined}
    >
      <input
        id="koma-file"
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="koma-file"
        onChange={onFileChange}
      />
      <input
        ref={logoRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*"
        className="koma-file"
        data-koma="logo-file"
        onChange={onLogoFile}
      />
      <input
        ref={projectFileRef}
        type="file"
        accept=".koma,application/x-koma,application/json"
        className="koma-file"
        data-koma="project-file"
        onChange={onProjectFile}
      />

      <AppMenu
        thumbs={thumbs}
        onThumbs={() => setThumbs((v) => !v)}
        onExport={() => setExportOpen(true)}
        onImport={() => openPicker()}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onOpen={() => setProjectsOpen(true)}
        onRename={() => setRenameTick((n) => n + 1)}
        onNew={handleNew}
        onNewBrochure={handleNewBrochure}
        onDownloadProject={() => downloadProjectFile()}
        onScript={() => setTab("script")}
        onRead={() => useStudio.getState().toggleReadMode()}
        spread={spread}
        onSpread={() => useStudio.getState().setSpread(!spread)}
        theme={theme}
        onTheme={() =>
          useStudio.getState().setTheme(theme === "dark" ? "light" : "dark")
        }
        onZoomIn={() => zoomTo(stepZoom(zoomBase(), 1))}
        onZoomOut={() => zoomTo(stepZoom(zoomBase(), -1))}
        onZoomFit={() => zoomTo("fit")}
        onZoomActual={() => zoomTo(100)}
        onCommands={() => setCmdOpen(true)}
      />

      <header className="koma-glass relative z-40 flex h-14 min-h-14 max-h-14 shrink-0 items-center gap-1 overflow-visible border-b border-line/70 px-2 sm:px-3 md:h-[52px] md:min-h-[52px] md:max-h-[52px]">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          <ToolTipBtn
            label="Page thumbnails"
            keys={k("P", { cmd: true, alt: true })}
            active={thumbs}
            onClick={() => setThumbs((v) => !v)}
            className="hidden md:inline-flex"
          >
            <PanelLeft />
          </ToolTipBtn>
          <ToolSep />
          <div
            data-koma="project-chip"
            className="flex min-w-0 max-w-[10rem] items-center gap-0.5 lg:max-w-[15rem]"
          >
            <ToolTipBtn
              label="Document menu"
              koma="title-menu"
              className="md:h-7 md:min-w-7 md:px-1 md:[&>svg]:size-4"
              active={menu === "title"}
              onClick={(e) => {
                e.stopPropagation();
                setMenuAnchor(e.currentTarget);
                setMenu(menu === "title" ? null : "title");
              }}
              menu
            >
              <FileText className="text-muted" />
            </ToolTipBtn>
            <ProjectName editSignal={renameTick} />
            {edited !== "clean" ? (
              <span
                data-koma="edited"
                data-state={edited}
                className="koma-edited hidden shrink-0 text-[13px] text-muted lg:inline"
              >
                — Edited
              </span>
            ) : null}
            <span
              data-koma="autosave"
              data-interval={String(AUTOSAVE_MS)}
              className="sr-only"
            >
              {projectId || savedAt ? "Autosave on" : "unsaved"}
            </span>
          </div>
          <span className="hidden min-w-0 items-center gap-1 sm:flex">
            <ChevronRight aria-hidden className="size-3 shrink-0 text-faint" />
            <PageTitle />
          </span>
          <ToolSep />
          <ToolGroup>
            <ToolTipBtn
              label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
              keys={k("Z", { cmd: true })}
              koma="undo"
              disabled={!canUndo}
              onClick={() => useStudio.getState().undo()}
            >
              <Undo2 />
            </ToolTipBtn>
            <ToolTipBtn
              label={redoLabel ? `Redo ${redoLabel}` : "Redo"}
              keys={k("Z", { cmd: true, shift: true })}
              koma="redo"
              disabled={!canRedo}
              onClick={() => useStudio.getState().redo()}
            >
              <Redo2 />
            </ToolTipBtn>
          </ToolGroup>
        </div>

        <div className="hidden shrink-0 items-center md:flex">
          <ToolGroup>
            <ToolTipBtn
              label="Layouts"
              caption="Layouts"
              active={menu === "layout"}
              onClick={(e) => {
                e.stopPropagation();
                setMenuAnchor(e.currentTarget);
                setMenu(menu === "layout" ? null : "layout");
              }}
              menu
            >
              <LayoutGrid />
            </ToolTipBtn>
            <ToolTipBtn
              label="Media"
              caption="Media"
              active={menu === "media"}
              onClick={(e) => {
                e.stopPropagation();
                setMenuAnchor(e.currentTarget);
                setMenu(menu === "media" ? null : "media");
              }}
              menu
            >
              <ImagePlus />
            </ToolTipBtn>
            <ToolTipBtn
              label="Speech bubble"
              caption="Speech"
              keys="T"
              onClick={() => useStudio.getState().addOverlay("speech")}
            >
              <MessageCircle />
            </ToolTipBtn>
            <ToolTipBtn
              label="Thought bubble"
              caption="Thought"
              onClick={() => useStudio.getState().addOverlay("thought")}
            >
              <Cloud />
            </ToolTipBtn>
            <ToolTipBtn
              label="Narration box"
              caption="Caption"
              onClick={() => useStudio.getState().addOverlay("narration")}
            >
              <RectangleHorizontal />
            </ToolTipBtn>
            <ToolTipBtn
              label="Title"
              caption="Title"
              keys={k("T", { shift: true })}
              onClick={() => insertTitle()}
            >
              <Type />
            </ToolTipBtn>
            <ToolTipBtn
              label="Stickers"
              caption="Stickers"
              active={menu === "stickers"}
              onClick={(e) => {
                e.stopPropagation();
                setMenuAnchor(e.currentTarget);
                if (menu !== "stickers") {
                  setStickerTab(
                    page.templateId.startsWith("brochure") ? "clinic" : stickerTab,
                  );
                }
                setMenu(menu === "stickers" ? null : "stickers");
              }}
              menu
            >
              <Heart />
            </ToolTipBtn>
          </ToolGroup>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
          <ToolGroup className="md:hidden">
            <ToolTipBtn
              label="Speech bubble"
              onClick={() => useStudio.getState().addOverlay("speech")}
            >
              <MessageCircle />
            </ToolTipBtn>
            <ToolTipBtn
              label="Title"
              onClick={() => insertTitle()}
            >
              <Type />
            </ToolTipBtn>
            <ToolTipBtn
              label="Stickers"
              onClick={() => useStudio.getState().addOverlay("sticker", "heart")}
            >
              <Heart />
            </ToolTipBtn>
          </ToolGroup>
          <div className="relative flex items-center">
            <ToolTipBtn
              label="Zoom out"
              keys={k("-", { cmd: true })}
              koma="zoom-out"
              className="hidden lg:flex md:min-w-8 md:px-1"
              onClick={() => zoomTo(stepZoom(zoomBase(), -1))}
            >
              <ZoomOut />
            </ToolTipBtn>
            <button
              type="button"
              data-koma="zoom-menu"
              data-koma-menu-btn=""
              className="koma-press hidden h-8 min-w-11 items-center justify-center gap-1 rounded-[7px] px-2 text-[12px] font-medium tabular-nums text-ink-soft hover:bg-ink/6 hover:text-ink sm:flex md:min-w-[3rem]"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                setMenuAnchor(e.currentTarget);
                setMenu(menu === "zoom" ? null : "zoom");
              }}
            >
              {zoomLabel}
              <ChevronDown className="hidden size-3 text-muted sm:block" strokeWidth={2.25} />
            </button>
            <ToolTipBtn
              label="Zoom in"
              keys={k("+", { cmd: true })}
              koma="zoom-in"
              className="hidden lg:flex md:min-w-8 md:px-1"
              onClick={() => zoomTo(stepZoom(zoomBase(), 1))}
            >
              <ZoomIn />
            </ToolTipBtn>
            {menu === "zoom" ? (
              <MenuPanel anchor={menuAnchor} align="end" className="w-36">
                {ZOOM_PRESETS.map((opt) => (
                  <button
                    key={String(opt.id)}
                    type="button"
                    data-koma={`zoom-${opt.id}`}
                    role="menuitemradio"
                    aria-checked={zoom === opt.id}
                    className="relative flex h-7 w-full items-center rounded-[5px] pl-6 pr-2.5 text-left text-[13px] text-ink hover:bg-accent hover:text-accent-fg"
                    onClick={(e) =>
                      flashThen(e.currentTarget, () => {
                        zoomTo(opt.id);
                        setMenu(null);
                      })
                    }
                  >
                    {zoom === opt.id ? (
                      <Check
                        aria-hidden
                        className="absolute left-1.5 top-1/2 size-3.5 -translate-y-1/2"
                        strokeWidth={2.5}
                      />
                    ) : null}
                    {opt.label}
                    {opt.id === "fit" || opt.id === 100 ? (
                      <span className="koma-keys ml-auto pl-3 text-[12px] tabular-nums opacity-55">
                        {k("0", { cmd: true, alt: opt.id === 100 })}
                      </span>
                    ) : null}
                  </button>
                ))}
              </MenuPanel>
            ) : null}
          </div>

          <ToolSep />
          <ToolTipBtn
            label="Read"
            caption="Read"
            keys="R"
            koma="read-open"
            className="hidden md:flex"
            active={readMode}
            ariaPressed={readMode}
            onClick={() => useStudio.getState().toggleReadMode()}
          >
            <BookOpen className="text-accent" />
          </ToolTipBtn>

          <ToolTipBtn
            label="Export"
            caption="Export"
            keys={k("E", { cmd: true })}
            onClick={() => setExportOpen(true)}
          >
            <Share />
          </ToolTipBtn>

          <ToolSep className="hidden md:block" />
          <ToolGroup className="hidden md:flex">
            <ToolTipBtn
              label="Format"
              caption="Format"
              keys={k("I", { cmd: true, alt: true })}
              active={tab === "format"}
              onClick={() => setTab("format")}
            >
              <Paintbrush />
            </ToolTipBtn>
            <ToolTipBtn
              label="Script"
              caption="Script"
              koma="script-open"
              active={tab === "script"}
              onClick={() => setTab("script")}
            >
              <ScrollText />
            </ToolTipBtn>
            <ToolTipBtn
              label="Document"
              caption="Document"
              keys={k("J", { cmd: true, alt: true })}
              active={tab === "document"}
              onClick={() => setTab("document")}
            >
              <FileText />
            </ToolTipBtn>
          </ToolGroup>
        </div>

        {menu === "title" ? (
          <MenuPanel anchor={menuAnchor} className="w-60 p-1" role="menu">
            <PanelItem
              label="Rename"
              onClick={(el) =>
                flashThen(el, () => {
                  setMenu(null);
                  setRenameTick((n) => n + 1);
                })
              }
            />
            <PanelItem
              label="Duplicate"
              disabled={!projectId}
              onClick={(el) =>
                flashThen(el, () => {
                  setMenu(null);
                  if (!projectId) return;
                  void duplicateNamedProject(projectId)
                    .then((copy) => switchToProject(copy.id))
                    .then(() => toast.message("Duplicated project"))
                    .catch((err) =>
                      toast.error(
                        err instanceof Error ? err.message : "Duplicate failed",
                      ),
                    );
                })
              }
            />
            <PanelItem
              label="Save a Copy…"
              keys={k("S", { cmd: true, shift: true })}
              onClick={(el) =>
                flashThen(el, () => {
                  setMenu(null);
                  handleSaveAs();
                })
              }
            />
            <PanelItem
              label="Download Project File"
              onClick={(el) =>
                flashThen(el, () => {
                  setMenu(null);
                  downloadProjectFile();
                })
              }
            />
            <div role="separator" className="mx-2 my-1 h-px bg-line" />
            <PanelItem
              label="Projects…"
              keys={k("O", { cmd: true })}
              onClick={(el) =>
                flashThen(el, () => {
                  setMenu(null);
                  setProjectsOpen(true);
                })
              }
            />
          </MenuPanel>
        ) : null}

        {menu === "layout" ? (
          <MenuPanel
            anchor={menuAnchor}
            align="center"
            arrow
            className="w-[min(40rem,calc(100vw-2rem))]"
          >
            <p className="px-2 pb-2 text-xs font-medium text-muted">
              Manga pages
            </p>
            <div className="grid grid-cols-4 gap-1 sm:grid-cols-5">
              {TEMPLATES.filter((spec) => spec.group !== "brochure").map((spec) => (
                <TemplateThumb
                  key={spec.id}
                  spec={spec}
                  active={spec.id === page.templateId}
                  onClick={() => {
                    useStudio.getState().setTemplate(spec.id);
                    setMenu(null);
                  }}
                />
              ))}
            </div>
            <p className="px-2 pb-2 pt-3 text-xs font-medium text-muted">
              Brochures
            </p>
            <div className="grid grid-cols-4 gap-1 sm:grid-cols-5" data-koma="brochure-templates">
              {TEMPLATES.filter((spec) => spec.group === "brochure").map((spec) => (
                <TemplateThumb
                  key={spec.id}
                  spec={spec}
                  active={spec.id === page.templateId}
                  onClick={() => {
                    useStudio.getState().setTemplate(spec.id);
                    setMenu(null);
                  }}
                />
              ))}
            </div>
          </MenuPanel>
        ) : null}

        {menu === "media" ? (
          <MenuPanel anchor={menuAnchor} align="center" arrow className="w-80">
            <p className="px-2 pb-2 text-xs font-medium text-muted">
              Sample art
            </p>
            <UploadDrop
              onFiles={(files) => {
                void uploadImageFiles(
                  files,
                  useStudio.getState().selectedPanelId,
                )
                  .then(() => setMenu(null))
                  .catch((err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Could not add image",
                    ),
                  );
              }}
            />
            <SampleGrid
              pendingSrc={pendingSrc}
              onGhost={setGhost}
              onPick={(src) => {
                useStudio.getState().placeImage(src);
                setMenu(null);
              }}
            />
          </MenuPanel>
        ) : null}
        {menu === "stickers" ? (
          <MenuPanel
            anchor={menuAnchor}
            align="center"
            arrow
            className="w-[min(22rem,calc(100vw-2rem))]"
          >
            <div className="mb-2 flex rounded-md bg-ink/5 p-0.5">
              {(
                [
                  ["clinic", "Clinic"],
                  ["manga", "Manga"],
                  ["logos", "Logos"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  data-koma={`sticker-tab-${id}`}
                  onClick={() => setStickerTab(id)}
                  className={cn(
                    "min-h-9 flex-1 rounded-sm text-xs font-medium",
                    stickerTab === id
                      ? "bg-surface text-ink shadow-tool"
                      : "text-muted hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {stickerTab === "manga" ? (
              <>
                <p className="px-2 pb-2 text-xs font-medium text-muted">
                  Emotion marks
                </p>
                <StickerGrid
                  onPick={(id) => {
                    useStudio.getState().addOverlay("sticker", id);
                    setMenu(null);
                  }}
                />
              </>
            ) : null}
            {stickerTab === "clinic" ? (
              <ClinicIconGrid
                onPick={(id) => {
                  useStudio.getState().addOverlay(
                    "sticker",
                    undefined,
                    undefined,
                    clinicIconSrc(id),
                  );
                  setMenu(null);
                }}
              />
            ) : null}
            {stickerTab === "logos" ? (
              <LogoLibrary
                logos={customStickers}
                onUpload={() => logoRef.current?.click()}
                onPlace={(src) => {
                  useStudio.getState().placeLogo(src);
                  setMenu(null);
                }}
                onRemove={(id) => useStudio.getState().removeCustomSticker(id)}
              />
            ) : null}
          </MenuPanel>
        ) : null}
      </header>

      {pendingSrc ? (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-line bg-surface px-3 py-1.5 text-xs text-ink">
          Tap a panel to place the image
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => useStudio.getState().setPendingSrc(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {thumbs ? (
          <aside
            data-koma="page-rail"
            className="koma-glass-side hidden w-40 shrink-0 flex-col overflow-y-auto border-r border-line/60 md:flex"
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const next = pageRailMenuFromEvent(e, "y");
              if (next.pageId) useStudio.getState().setCurrentPage(next.pageId);
              setPageMenu(next);
            }}
          >
            {groupPagesByChapter(pages, chapters).map((group) => (
              <div key={group.chapter?.id ?? group.pages[0]?.id ?? "pages"}>
                {group.chapter ? (
                  <button
                    type="button"
                    data-koma="chapter-header"
                    onClick={() =>
                      useStudio.getState().setCurrentPage(group.chapter!.startPageId)
                    }
                    className="koma-chapter-head w-full text-left"
                  >
                    {group.chapter.title}
                  </button>
                ) : null}
                {group.pages.map((p) => {
                  const i = pages.findIndex((x) => x.id === p.id);
                  return (
                    <PageThumb
                      key={p.id}
                      page={p}
                      index={i + 1}
                      label={pageLabel(pages, p.id, coverFirst)}
                      selected={p.id === page.id}
                      onClick={() => useStudio.getState().setCurrentPage(p.id)}
                      onMove={(fromId, toId) =>
                        useStudio.getState().movePage(fromId, toId)
                      }
                      onMenu={openThumbMenu}
                    />
                  );
                })}
              </div>
            ))}
            <div className="flex items-center justify-center gap-1 px-3 py-3">
              <button
                type="button"
                aria-label="Add page"
                onClick={() => useStudio.getState().addPage()}
                className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
              >
                <Plus className="size-4" />
              </button>
              {pages.length > 1 ? (
                <button
                  type="button"
                  aria-label="Delete page"
                  onClick={() => useStudio.getState().removePage(page.id)}
                  className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </div>
          </aside>
        ) : null}

        <main
          ref={stageRef}
          data-koma="page-stage"
          className="relative isolate min-h-0 flex-1 overflow-auto overscroll-contain bg-bg px-4 py-5 sm:px-10 sm:py-10"
        >
          <SpreadView
            onPickFile={openPicker}
            onArmFile={armPicker}
            zoom={zoom}
          />
        </main>

        <aside className="koma-glass-side hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-line/60 md:flex">
          <div className="flex h-10 shrink-0 items-center border-b border-line/60 px-4">
            <p className="truncate text-sm font-medium">
              {tab === "document"
                ? "Document"
                : tab === "script"
                  ? "Script"
                  : selectedOverlay && selectedCount > 1
                    ? `${selectedCount} balloons`
                    : selectedOverlay
                    ? overlayLabel(selectedOverlay.kind)
                    : selected?.image
                      ? "Image"
                      : selected
                        ? "Panel"
                        : "Format"}
              {tab === "format" &&
              selectedOverlay &&
              selectedCount < 2 &&
              selectedOverlay.kind !== "sticker" ? (
                <span className="ml-1.5 text-[11px] font-normal text-muted">
                  {isDialogue(selectedOverlay.kind) || selectedOverlay.kind === "narration"
                    ? `${BALLOON_STYLES.find((b) => b.id === balloonStyleOf(selectedOverlay))?.label ?? "Oval"} · `
                    : ""}
                  {letterFont(selectedOverlay.fontId || defaultFontId(selectedOverlay.kind)).label}
                </span>
              ) : null}
            </p>
          </div>
          {tab === "script" ? (
            <ScriptPanel />
          ) : (
          <Inspector
            tab={tab}
            selected={selected}
            overlay={selectedOverlay}
            imageTool={imageTool}
            gutter={gutter}
            margin={margin}
            border={border}
            paper={paper}
            rtl={rtl}
            showNumbers={showNumbers}
            hasCustomLayout={page.panels.some((p) => p.rect)}
            onOpenFile={() => openPicker(selected?.id)}
            onArmFile={() => armPicker(selected?.id)}
            onNew={handleNew}
            onNewBrochure={handleNewBrochure}
          />
          )}
        </aside>
      </div>

      <div
        data-koma="page-rail-mobile"
        className="koma-glass-side flex shrink-0 items-end gap-2 overflow-x-auto px-3 py-2 md:hidden"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const next = pageRailMenuFromEvent(e, "x");
          if (next.pageId) useStudio.getState().setCurrentPage(next.pageId);
          setPageMenu(next);
        }}
      >
        {pages.map((p, i) => (
          <PageThumb
            key={p.id}
            page={p}
            index={i + 1}
            label={pageLabel(pages, p.id, coverFirst)}
            selected={p.id === page.id}
            onClick={() => useStudio.getState().setCurrentPage(p.id)}
            onMove={(fromId, toId) => useStudio.getState().movePage(fromId, toId)}
            onMenu={openThumbMenu}
            className="w-16 shrink-0 px-0 py-0"
          />
        ))}
        <button
          type="button"
          aria-label="Add page"
          onClick={() => useStudio.getState().addPage()}
          className="mb-5 flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <nav className="koma-glass relative z-30 flex shrink-0 items-center justify-around border-t border-line/70 px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
        <DockBtn
          icon={<BookOpen />}
          label="Read"
          koma="read-open-mobile"
          active={readMode}
          onClick={() => useStudio.getState().toggleReadMode()}
        />
        <DockBtn
          icon={<FolderOpen />}
          label="Projects"
          active={false}
          onClick={() => setProjectsOpen(true)}
        />
        <DockBtn
          icon={<LayoutGrid />}
          label="Layouts"
          active={drawer === "layouts"}
          onClick={() => setDrawer(drawer === "layouts" ? null : "layouts")}
        />
        <DockBtn
          icon={<ImagePlus />}
          label="Media"
          active={drawer === "images"}
          onClick={() => setDrawer(drawer === "images" ? null : "images")}
        />
        <DockBtn
          icon={<Paintbrush />}
          label="Format"
          active={drawer === "adjust"}
          onClick={() => setDrawer(drawer === "adjust" ? null : "adjust")}
        />
        <DockBtn
          icon={<ScrollText />}
          label="Script"
          active={drawer === "script"}
          onClick={() => setDrawer(drawer === "script" ? null : "script")}
        />
        <button
          type="button"
          className="flex min-h-11 flex-col items-center justify-center gap-0.5 px-3 text-xs font-medium text-muted"
          onClick={() => useStudio.getState().addPage()}
        >
          <Plus className="size-4" />
          Page {pageIndex}
        </button>
      </nav>

      {drawer ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/20"
            aria-label="Close"
            onPointerUp={() => setDrawer(null)}
            onClick={() => setDrawer(null)}
          />
          <div
            data-koma-sheet
            className="absolute inset-x-0 bottom-0 z-10 max-h-[72dvh] overflow-y-auto rounded-t-xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-float"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm font-medium">
                {drawer === "layouts"
                  ? "Choose a Template"
                  : drawer === "images"
                    ? "Media"
                    : drawer === "script"
                      ? "Script"
                      : "Format"}
              </p>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDrawer(null)}
                aria-label="Close"
              >
                <X />
              </Button>
            </div>
            {drawer === "layouts" ? (
              <div className="grid grid-cols-3 gap-1 px-3 pb-6">
                {TEMPLATES.map((spec) => (
                  <TemplateThumb
                    key={spec.id}
                    spec={spec}
                    active={spec.id === page.templateId}
                    onClick={() => {
                      useStudio.getState().setTemplate(spec.id);
                      setDrawer(null);
                    }}
                  />
                ))}
              </div>
            ) : null}
            {drawer === "images" ? (
              <>
                <UploadDrop
                  onFiles={(files) => {
                    void uploadImageFiles(
                      files,
                      useStudio.getState().selectedPanelId,
                    )
                      .then(() => setDrawer(null))
                      .catch((err) =>
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : "Could not add image",
                        ),
                      );
                  }}
                />
                <SampleGrid
                  pendingSrc={pendingSrc}
                  onGhost={setGhost}
                  onPick={(src) => {
                    useStudio.getState().placeImage(src);
                    setDrawer(null);
                  }}
                />
              </>
            ) : null}
            {drawer === "adjust" ? (
              <Inspector
                tab="format"
                showAll
                selected={selected}
                overlay={selectedOverlay}
                imageTool={imageTool}
                gutter={gutter}
                margin={margin}
                border={border}
                paper={paper}
                rtl={rtl}
                showNumbers={showNumbers}
                hasCustomLayout={page.panels.some((p) => p.rect)}
                onOpenFile={() => openPicker(selected?.id)}
                onArmFile={() => armPicker(selected?.id)}
                onAdded={() => setDrawer(null)}
                onNew={handleNew}
                onNewBrochure={handleNewBrochure}
              />
            ) : null}
            {drawer === "script" ? (
              <ScriptPanel compact />
            ) : null}
          </div>
        </div>
      ) : null}

      {ghost ? (
        <div
          className="pointer-events-none fixed z-50 size-20 overflow-hidden rounded-md shadow-float ring-2 ring-accent"
          style={{
            left: ghost.x,
            top: ghost.y,
            transform: "translate(-50%, -50%)",
          }}
        >
          <img src={ghost.src} alt="" className="size-full object-cover" />
        </div>
      ) : null}

      {pageMenu ? (
        <>
          <PageInsertMark menu={pageMenu} />
          <PageContextMenu
            key={`${pageMenu.pageId ?? "gap"}-${pageMenu.insertAt}-${pageMenu.x}-${pageMenu.y}`}
            menu={pageMenu}
            onClose={() => setPageMenu(null)}
          />
        </>
      ) : null}
    </div>

      {readerShown ? (
        <div
          className="koma-reader-host fixed inset-0 z-[100]"
          data-koma="reader-host"
          data-state={readMode ? "open" : "closed"}
        >
          <Reader onLibrary={() => setProjectsOpen(true)} />
        </div>
      ) : null}

      <SaveAsDialog
        open={saveOpen}
        asCopy={saveAsCopy}
        onClose={() => setSaveOpen(false)}
        onSaved={(name, count) => {
          toast.success(
            `Saved “${name}” · ${count} project${count === 1 ? "" : "s"} on this device`,
          );
        }}
      />
      <OpenProjectDialog
        open={projectsOpen}
        onClose={() => setProjectsOpen(false)}
        onOpenFile={() => projectFileRef.current?.click()}
        onNew={handleNew}
        onSaveAs={() => {
          setProjectsOpen(false);
          handleSaveAs();
        }}
        onSaveFirst={() => {
          setProjectsOpen(false);
          setSaveAsCopy(false);
          setSaveOpen(true);
        }}
      />
      {newProjectDialog}
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        ctx={{
          apple,
          thumbs,
          onThumbs: () => setThumbs((v) => !v),
          onExport: () => setExportOpen(true),
          onImport: () => openPicker(),
          onSave: handleSave,
          onSaveAs: handleSaveAs,
          onOpen: () => setProjectsOpen(true),
          onRename: () => setRenameTick((n) => n + 1),
          onNew: handleNew,
          onNewBrochure: handleNewBrochure,
          onDownloadProject: () => downloadProjectFile(),
          onScript: () => setTab("script"),
          onRead: () => useStudio.getState().toggleReadMode(),
          spread,
          onSpread: () => useStudio.getState().setSpread(!spread),
          theme,
          onTheme: () =>
            useStudio.getState().setTheme(theme === "dark" ? "light" : "dark"),
          onZoomIn: () => zoomTo(stepZoom(zoomBase(), 1)),
          onZoomOut: () => zoomTo(stepZoom(zoomBase(), -1)),
          onZoomFit: () => zoomTo("fit"),
          onZoomActual: () => zoomTo(100),
          onSwitchProject: (id) => {
            void switchToProject(id)
              .then((r) => {
                if (r.switched)
                  toast.success(`Opened “${useStudio.getState().projectName}”`);
              })
              .catch((err) =>
                toast.error(err instanceof Error ? err.message : "Could not open project"),
              );
          },
        }}
      />
    </>
  );
}

function overlayLabel(kind: OverlayKind) {
  if (kind === "speech") return "Speech";
  if (kind === "thought") return "Thought";
  if (kind === "narration") return "Narration";
  if (kind === "title") return "Title";
  if (kind === "sfx") return "Sound";
  if (kind === "text") return "Text";
  if (kind === "shout") return "Shout";
  if (kind === "whisper") return "Whisper";
  if (kind === "scream") return "Scream";
  if (kind === "tone") return "Tone";
  return "Sticker";
}

function insertTitle() {
  useStudio.getState().addOverlay("title");
}

function PageTitle() {
  const raw = useStudio((s) => {
    const page = s.pages.find((p) => p.id === s.currentPageId) ?? s.pages[0];
    return page?.title ?? "";
  });
  const fallback = useStudio((s) =>
    pageLabel(s.pages, s.currentPageId, s.book.coverFirst),
  );
  const named = pageTitle({ title: raw });
  const display = named === "Untitled" ? fallback : named;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(display);
  const inputRef = useRef<HTMLInputElement>(null);
  const ignoreBlur = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(display);
  }, [display, editing]);

  function commit() {
    const next = draft.trim();
    useStudio
      .getState()
      .setPageTitle(next === "" || next === fallback ? "Untitled" : next);
    setEditing(false);
  }

  function startEditing() {
    ignoreBlur.current = true;
    setDraft(display);
    flushSync(() => setEditing(true));
    const el = inputRef.current;
    el?.focus();
    window.setTimeout(() => {
      el?.setSelectionRange(0, el.value.length);
      ignoreBlur.current = false;
    }, 50);
  }

  if (!editing) {
    return (
      <button
        type="button"
        aria-label="Edit page title"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          startEditing();
        }}
        className="relative z-10 max-w-full min-h-11 min-w-0 truncate rounded-[5px] px-1.5 py-1 text-left text-base font-medium tracking-tight text-ink-soft hover:bg-ink/6 hover:text-ink md:min-h-8 md:text-[13px] md:font-normal"
      >
        {display}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      aria-label="Page title"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="words"
      spellCheck={false}
      enterKeyHint="done"
      inputMode="text"
      onChange={(e) => setDraft(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => {
        if (ignoreBlur.current) {
          inputRef.current?.focus();
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(display);
          setEditing(false);
        }
      }}
      className="relative z-20 h-11 w-44 rounded-[5px] bg-surface px-1.5 text-base font-medium tracking-tight outline-none ring-2 ring-accent/60 md:h-7 md:text-[13px] md:font-normal"
    />
  );
}

/** The document's name in the titlebar; click to rename in place, like Finder. */
function ProjectName({ editSignal }: { editSignal: number }) {
  const name = useStudio((s) => s.projectName || "Untitled");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const ignoreBlur = useRef(false);
  const lastSignal = useRef(editSignal);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  function startEditing() {
    ignoreBlur.current = true;
    setDraft(name);
    setEditing(true);
  }

  // Focus once the field exists; a menu item or the File menu may have asked.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    el?.focus();
    const t = window.setTimeout(() => {
      el?.setSelectionRange(0, el.value.length);
      ignoreBlur.current = false;
    }, 50);
    return () => window.clearTimeout(t);
  }, [editing]);

  useEffect(() => {
    if (editSignal === lastSignal.current) return;
    lastSignal.current = editSignal;
    startEditing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSignal]);

  function commit() {
    const next = draft.trim() || "Untitled";
    setEditing(false);
    if (next === name) return;
    const s = useStudio.getState();
    if (s.projectId) {
      void renameNamedProject(s.projectId, next).catch((err) =>
        toast.error(err instanceof Error ? err.message : "Rename failed"),
      );
    } else {
      s.setProjectName(next);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        data-koma="project-name"
        aria-label="Rename project"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          startEditing();
        }}
        className="min-h-7 min-w-0 truncate rounded-[5px] px-1 text-left text-[13px] font-semibold tracking-[-0.01em] hover:bg-ink/6"
      >
        {name}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      aria-label="Project name"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="words"
      spellCheck={false}
      enterKeyHint="done"
      onChange={(e) => setDraft(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => {
        if (ignoreBlur.current) {
          inputRef.current?.focus();
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(name);
          setEditing(false);
        }
      }}
      className="relative z-20 h-7 w-44 rounded-[5px] bg-surface px-1 text-[13px] font-semibold tracking-[-0.01em] outline-none ring-2 ring-accent/60"
    />
  );
}

function ToolGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex items-center gap-0.5", className)}>{children}</div>;
}

/** Hairline between toolbar groups, like NSToolbarItem.Identifier.space with a separator. */
function ToolSep({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("mx-1 hidden h-5 w-px shrink-0 bg-line md:block", className)}
    />
  );
}

/** Keynote-style toolbar item: icon with a caption under it on wide windows. */
function ToolTipBtn({
  label,
  caption,
  keys,
  active,
  ariaPressed,
  onClick,
  children,
  className,
  menu,
  koma,
  disabled,
}: {
  label: string;
  caption?: string;
  keys?: string;
  active?: boolean;
  ariaPressed?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
  menu?: boolean;
  koma?: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={ariaPressed}
          data-koma={koma}
          data-koma-menu-btn={menu ? "" : undefined}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClick}
          className={cn(
            "koma-press flex size-11 shrink-0 flex-col items-center justify-center gap-[3px] rounded-[7px] text-ink-soft transition-[background-color,color] duration-[var(--motion-quick)] ease-[var(--ease-out)] [&>svg]:size-5 [&>svg]:[stroke-width:1.75] md:h-9 md:w-auto md:min-w-9 md:px-1.5 md:[&>svg]:size-[18px] xl:h-10 xl:px-2",
            caption && "xl:min-w-[3.25rem]",
            active ? "bg-ink/10 text-ink" : "hover:bg-ink/6 hover:text-ink",
            disabled && "opacity-35 hover:bg-transparent hover:text-ink-soft",
            className,
          )}
        >
          {children}
          {caption ? (
            <span className="hidden text-[11px] font-medium leading-none xl:block">
              {caption}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {keys ? <kbd className="koma-kbd ml-2">{keys}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** NSMenu's blink: the chosen item flashes off and on, then the action runs. */
function flashThen(el: HTMLElement | null, fn: () => void) {
  if (!el || prefersReducedMotion()) {
    fn();
    return;
  }
  el.setAttribute("data-flash", "");
  window.setTimeout(fn, 140);
}

function PanelItem({
  label,
  keys,
  disabled,
  onClick,
}: {
  label: string;
  keys?: string;
  disabled?: boolean;
  onClick: (el: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onPointerDown={(e) => e.currentTarget.focus()}
      onClick={(e) => onClick(e.currentTarget)}
      className="koma-menu-item relative flex h-[26px] w-full items-center justify-between rounded-[5px] pl-6 pr-2 text-left text-[13px] text-ink outline-none hover:bg-accent hover:text-accent-fg focus-visible:bg-accent focus-visible:text-accent-fg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink"
    >
      <span>{label}</span>
      {keys ? (
        <span className="koma-keys ml-8 text-[13px] tabular-nums opacity-55">
          {keys}
        </span>
      ) : null}
    </button>
  );
}

/** Toolbar pop-ups: a plain menu fades in; a popover grows from its arrow. */
function MenuPanel({
  children,
  className,
  role,
  anchor,
  align = "start",
  arrow,
}: {
  children: ReactNode;
  className?: string;
  role?: string;
  anchor: HTMLElement | null;
  align?: "start" | "center" | "end";
  arrow?: boolean;
}) {
  return (
    <Floating
      anchor={anchor}
      align={align}
      offset={arrow ? 12 : 4}
      arrow={arrow}
      role={role}
      data-koma-menu={arrow ? undefined : ""}
      data-koma-popover={arrow ? "" : undefined}
      className={cn(
        "rounded-[14px] bg-surface/92 p-2 shadow-float backdrop-blur-2xl",
        className,
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div className="koma-pop-scroll">{children}</div>
    </Floating>
  );
}

function DockBtn({
  icon,
  label,
  active,
  onClick,
  koma,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  koma?: string;
}) {
  return (
    <button
      type="button"
      data-koma={koma}
      onClick={onClick}
      className={cn(
        "flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 px-3 text-xs font-medium",
        active ? "text-accent" : "text-muted",
      )}
    >
      <span className="[&>svg]:size-4">{icon}</span>
      {label}
    </button>
  );
}

function UploadDrop({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);

  return (
    <label
      className={cn(
        "mx-2 mb-2 flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-3 text-center",
        over
          ? "border-accent bg-accent/5"
          : "border-line hover:border-ink/30 hover:bg-ink/5",
      )}
      onDragOver={(e) => {
        if (!isFileDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const files = imageFilesFrom(e.dataTransfer);
        if (!files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onFiles(files);
      }}
    >
      <input
        type="file"
        accept="image/*"
        multiple
        className="koma-file"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <ImagePlus className="size-5 text-muted" />
      <p className="text-xs font-medium">Tap to choose photos</p>
      <p className="text-[11px] text-muted">or drop images here</p>
    </label>
  );
}

function SampleGrid({
  pendingSrc,
  onPick,
  onGhost,
}: {
  pendingSrc: string | null;
  onPick: (src: string) => void;
  onGhost?: (ghost: { src: string; x: number; y: number } | null) => void;
}) {
  const skipClick = useRef(false);
  const drag = useRef<{
    src: string;
    x: number;
    y: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent, src: string) {
    if (e.pointerType === "mouse") return;
    drag.current = {
      src,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      pointerId: e.pointerId,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) d.moved = true;
    if (d.moved) onGhost?.({ src: d.src, x: e.clientX, y: e.clientY });
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    onGhost?.(null);
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved) return;
    skipClick.current = true;
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of stack) {
      const panel = el.closest?.("[data-panel-id]");
      if (panel instanceof HTMLElement && panel.dataset.panelId) {
        useStudio.getState().setPanelImage(panel.dataset.panelId, d.src);
        return;
      }
    }
    onPick(d.src);
  }

  return (
    <div className="grid grid-cols-2 gap-2 px-2 pb-2">
      {SAMPLES.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => {
            if (skipClick.current) {
              skipClick.current = false;
              return;
            }
            onPick(s.src);
          }}
          draggable={false}
          onDragStart={(e) => {
            if (e.nativeEvent instanceof DragEvent === false) return;
            e.dataTransfer.setData("text/uri-list", s.src);
            e.dataTransfer.setData("text/plain", s.src);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onPointerDown={(e) => {
            e.currentTarget.draggable = e.pointerType === "mouse";
            onPointerDown(e, s.src);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
            onGhost?.(null);
          }}
          className={cn(
            "min-h-11 overflow-hidden rounded-md shadow-tool transition-[box-shadow] duration-[var(--motion-quick)]",
            pendingSrc === s.src ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-ink/20",
          )}
        >
          <img
            src={s.src}
            alt={s.label}
            draggable={false}
            className="aspect-[3/4] w-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}

function Inspector({
  tab,
  showAll = false,
  selected,
  overlay,
  imageTool = "frame",
  gutter,
  margin,
  border,
  paper,
  rtl,
  showNumbers,
  hasCustomLayout,
  onOpenFile,
  onArmFile,
  onAdded,
  onNew,
  onNewBrochure,
}: {
  tab: InspectorTab;
  showAll?: boolean;
  selected: { id: string; image: PanelImage | null } | null;
  overlay: Overlay | null;
  imageTool?: "frame" | "crop";
  gutter: number;
  margin: number;
  border: number;
  paper: PaperTone;
  rtl: boolean;
  showNumbers: boolean;
  hasCustomLayout: boolean;
  onOpenFile: () => void;
  onArmFile?: () => void;
  onAdded?: () => void;
  onNew?: () => void;
  onNewBrochure?: () => void;
}) {
  const image = selected?.image ?? null;
  const showFormat = showAll || tab === "format";
  const showDocument = showAll || tab === "document";
  const logos = useStudio((s) => s.customStickers);
  const snapEdges = useStudio((s) => s.snapEdges);
  const handInk = useStudio((s) => s.handInk);
  const showGuides = useStudio((s) => s.showGuides);
  const showGrid = useStudio((s) => s.showGrid);
  const bleed = useStudio((s) => s.bleed);
  const spreadOn = useStudio((s) => s.spread);
  const paperSize = useStudio((s) => s.paperSize);
  const sheet = paperSpec(paperSize);
  const bleedUnit = pageUnit(sheet);
  // Bleed is kept as a percent of the page width; the slider speaks the page's own units.
  const bleedUnits = (bleed / 100) * sheet.w;
  const bleedMax = bleedUnit === "mm" ? 5 : 40;
  const bleedStep = bleedUnit === "mm" ? 0.5 : 5;

  function uploadLogo() {
    const input = document.querySelector<HTMLInputElement>("[data-koma='logo-file']");
    input?.click();
  }

  return (
    <div className="flex flex-col px-4 pb-8 pt-3">
      {showFormat ? (
        <>
          <section className="koma-group">
            <InsertTools onAdded={onAdded} />
          </section>
          <section className="koma-group">
          <Button asChild variant="outline" size="sm" className="w-full">
            <label htmlFor="koma-file" onPointerDown={() => onArmFile?.()}>
              <ImagePlus />
              Choose Photo…
            </label>
          </Button>
          {overlay ? (
            <>
              <AlignStrip />
              <OverlayEditor overlay={overlay} />
            </>
          ) : selected && image ? (
            <>
              <p className="text-[11px] font-medium text-muted">Edit</p>
              <Segmented
                options={[
                  { id: "frame", label: "Panel" },
                  { id: "crop", label: "Crop" },
                ]}
                value={imageTool}
                onChange={(id) =>
                  useStudio.getState().setImageTool(id as "frame" | "crop")
                }
              />
              <p className="text-[11px] font-medium text-muted">Image</p>
              <Segmented
                options={[
                  { id: "cover", label: "Fill" },
                  { id: "contain", label: "Fit" },
                ]}
                value={image.fit}
                onChange={(id) =>
                  useStudio.getState().updateImage(selected.id, {
                    fit: id as "cover" | "contain",
                  })
                }
              />
              <Field label="Size" value={`${Math.round(image.zoom * 100)}%`}>
                <Slider
                  min={IMAGE_ZOOM_MIN}
                  max={IMAGE_ZOOM_MAX}
                  step={0.01}
                  value={[image.zoom]}
                  onValueChange={([v]) =>
                    useStudio.getState().updateImage(selected.id, {
                      zoom: clamp(v ?? 1, IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX),
                    })
                  }
                />
              </Field>
              <Field label="Brightness" value={`${image.brightness ?? 100}%`}>
                <Slider
                  min={50}
                  max={160}
                  step={1}
                  value={[image.brightness ?? 100]}
                  onValueChange={([v]) =>
                    useStudio.getState().updateImage(selected.id, {
                      brightness: clamp(v ?? 100, 50, 160),
                    })
                  }
                />
              </Field>
              <Field label="Contrast" value={`${image.contrast ?? 100}%`}>
                <Slider
                  min={50}
                  max={160}
                  step={1}
                  value={[image.contrast ?? 100]}
                  onValueChange={([v]) =>
                    useStudio.getState().updateImage(selected.id, {
                      contrast: clamp(v ?? 100, 50, 160),
                    })
                  }
                />
              </Field>
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    useStudio.getState().updateImage(selected.id, {
                      rotate: ((image.rotate ?? 0) + 90) % 360,
                    })
                  }
                >
                  <RotateCw />
                  Rotate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    useStudio.getState().updateImage(selected.id, {
                      flipX: !image.flipX,
                    })
                  }
                >
                  <FlipHorizontal2 />
                  Flip
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    useStudio.getState().updateImage(selected.id, {
                      flipY: !image.flipY,
                    })
                  }
                >
                  <FlipVertical2 />
                  Flip Y
                </Button>
              </div>
              <p className="text-[11px] leading-[1.45] text-muted">
                {imageTool === "crop"
                  ? "Drag inside to pan. Drag the white corners to scale. The panel crops the photo."
                  : "Drag the blue handles to resize the panel. Switch to Crop to scale the photo inside it."}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    useStudio.getState().updateImage(selected.id, {
                      zoom: 1,
                      focusX: 50,
                      focusY: 50,
                      fit: "cover",
                    })
                  }
                >
                  <Crop />
                  Reset crop
                </Button>
                <Button variant="outline" size="sm" onClick={onOpenFile}>
                  Replace
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => useStudio.getState().clearPanel(selected.id)}
                >
                  Clear
                </Button>
              </div>
            </>
          ) : selected ? (
            <p className="text-[12px] leading-[1.45] text-muted">
              Drop an image into this panel. Drag the blue handles to resize
              the frame.
            </p>
          ) : (
            <p className="text-[12px] leading-[1.45] text-muted">
              Select a panel to crop its photo, add a speech bubble, or drop
              clinic icons and a logo onto a brochure.
            </p>
          )}
          </section>
        </>
      ) : null}

      {showDocument ? (
        <>
          {showAll ? (
            <section className="koma-group">
              <p className="text-[11px] font-medium text-muted">Document</p>
            </section>
          ) : null}
          <section className="koma-group">
            <BookInspector />
          </section>
          <section className="koma-group">
            <ProjectPanel onNew={onNew} />
          </section>
          <section className="koma-group">
          <LogoLibrary
            logos={logos}
            onUpload={uploadLogo}
            onPlace={(src) => useStudio.getState().placeLogo(src)}
            onRemove={(id) => useStudio.getState().removeCustomSticker(id)}
          />
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            data-koma="new-brochure"
            onClick={() => {
              if (onNewBrochure) {
                onNewBrochure();
                return;
              }
              void startNewBrochure().then((stashed) => {
                if (stashed.saved) {
                  toast.message(`Saved “${stashed.name}”. Started a clinic brochure.`);
                } else {
                  toast.message("New clinic brochure");
                }
              });
            }}
          >
            Start clinic brochure
          </Button>
          </section>
          <section className="koma-group">
          <Field label="Gutter" value={`${gutter.toFixed(2)} mm`}>
            <Slider
              min={0.4}
              max={4}
              step={0.05}
              disabled={hasCustomLayout}
              value={[gutter]}
              onValueChange={([v]) =>
                useStudio.getState().setGutter(v ?? 1.55)
              }
            />
          </Field>
          <Field label="Margin" value={`${margin.toFixed(2)} mm`}>
            <Slider
              min={1.5}
              max={8}
              step={0.05}
              disabled={hasCustomLayout}
              value={[margin]}
              onValueChange={([v]) =>
                useStudio.getState().setMargin(v ?? 3.4)
              }
            />
          </Field>
          <Field label="Border" value={`${border.toFixed(2)} mm`}>
            <Slider
              min={0.2}
              max={1.6}
              step={0.05}
              value={[border]}
              onValueChange={([v]) =>
                useStudio.getState().setBorder(v ?? 0.55)
              }
            />
          </Field>
          <Field
            label="Bleed"
            value={
              bleedUnits > 0
                ? `${bleedUnit === "mm" ? bleedUnits.toFixed(1) : Math.round(bleedUnits)} ${bleedUnit}`
                : "None"
            }
          >
            <Slider
              min={0}
              max={bleedMax}
              step={bleedStep}
              value={[Math.min(bleedMax, Math.round(bleedUnits / bleedStep) * bleedStep)]}
              onValueChange={([v]) =>
                useStudio.getState().setBleed(((v ?? 0) / sheet.w) * 100)
              }
            />
          </Field>
          <div>
            <p className="mb-2 text-[11px] font-medium text-muted">Page size</p>
            <div className="flex flex-wrap gap-1">
              {PAPER_SIZES.map((size) => (
                <button
                  key={size.id}
                  type="button"
                  data-koma={`paper-${size.id}`}
                  onClick={() => useStudio.getState().setPaperSize(size.id)}
                  className={cn(
                    "min-h-11 rounded-[8px] px-2.5 text-xs font-medium md:h-7 md:min-h-7",
                    paperSize === size.id
                      ? "bg-surface text-ink shadow-tool ring-1 ring-line/60"
                      : "bg-ink/5 text-muted hover:text-ink",
                  )}
                >
                  {size.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-[1.45] text-muted">
              {PAPER_SIZES.find((s) => s.id === paperSize)?.blurb ?? "Print draft"}
              {paperSize === "webtoon"
                ? " · File → Export → Strip or Canvas."
                : ""}
            </p>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-medium text-muted">Paper</p>
            <Segmented
              options={[
                { id: "cream", label: "Cream" },
                { id: "white", label: "White" },
                { id: "newsprint", label: "News" },
              ]}
              value={paper}
              onChange={(id) => useStudio.getState().setPaper(id as PaperTone)}
            />
          </div>
          </section>
          <section className="koma-group">
          <CheckRow
            label="Snap to edges"
            checked={snapEdges}
            onChange={(v) => useStudio.getState().setSnapEdges(v)}
          />
          <CheckRow
            label="Hand-drawn balloons"
            koma="view-hand-ink"
            checked={handInk}
            onChange={(v) => useStudio.getState().setHandInk(v)}
          />
          <CheckRow
            label="Print guides"
            koma="view-guides"
            checked={showGuides}
            onChange={(v) => useStudio.getState().setShowGuides(v)}
          />
          <CheckRow
            label="Grid"
            koma="view-grid"
            checked={showGrid}
            onChange={(v) => useStudio.getState().setShowGrid(v)}
          />
          <CheckRow
            label="Two-page spread"
            koma="view-spread"
            checked={spreadOn}
            disabled={paperSize === "webtoon"}
            onChange={(v) => useStudio.getState().setSpread(v)}
          />
          <CheckRow
            label="Right-to-left numbers"
            checked={rtl}
            onChange={(v) => useStudio.getState().setRtl(v)}
          />
          <CheckRow
            label="Panel numbers"
            checked={showNumbers}
            onChange={(v) => useStudio.getState().setShowNumbers(v)}
          />
          </section>
          <section className="koma-group">
          {hasCustomLayout ? (
            <p className="text-[11px] leading-[1.45] text-muted">
              Layout was edited by dragging panel edges. Reset to use gutter
              and margin again.
            </p>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => useStudio.getState().resetLayout()}
            disabled={!hasCustomLayout}
          >
            Reset layout
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => useStudio.getState().fillDemo()}
          >
            Fill with sample art
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => useStudio.getState().clearPage()}
          >
            Clear all panels
          </Button>
          </section>
        </>
      ) : null}
    </div>
  );
}

// The lettering/sticker/SFX palettes are static; the callbacks only reach stable setters and store actions.
const InsertTools = memo(InsertToolsInner, () => true);
function InsertToolsInner({ onAdded }: { onAdded?: () => void }) {
  function add(kind: OverlayKind, sticker?: StickerId, text?: string) {
    if (kind === "title") insertTitle();
    else useStudio.getState().addOverlay(kind, sticker, text);
    onAdded?.();
  }

  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-muted">Lettering</p>
      <div className="grid grid-cols-5 gap-1">
        <InsertBtn label="Speech" onClick={() => add("speech")}>
          <MessageCircle />
        </InsertBtn>
        <InsertBtn label="Thought" onClick={() => add("thought")}>
          <Cloud />
        </InsertBtn>
        <InsertBtn label="Caption" onClick={() => add("narration")}>
          <RectangleHorizontal />
        </InsertBtn>
        <InsertBtn label="Title" onClick={() => add("title")}>
          <Type />
        </InsertBtn>
        <InsertBtn label="Text" onClick={() => add("text")}>
          <AlignLeft />
        </InsertBtn>
      </div>
      <InsertFold title="Clinic icons" koma="clinic-fold">
      <ClinicIconGrid
        onPick={(id) => {
          useStudio.getState().addOverlay("sticker", undefined, undefined, clinicIconSrc(id));
          onAdded?.();
        }}
      />
      </InsertFold>
      <InsertFold title="Sound effects" koma="sfx-fold">
      {SFX_GROUPS.map((group) => (
        <div key={group.title} className="mb-2">
          <p className="mb-1 text-[11px] font-medium text-muted">{group.title}</p>
          <div className="flex flex-wrap gap-1">
            {group.items.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => add("sfx", undefined, p.id)}
                className="koma-sfx-hand min-h-11 rounded-md bg-ink/5 px-2.5 text-sm font-normal active:bg-ink/15 hover:bg-ink/10"
                style={{
                  fontFamily: "var(--font-sfx)",
                  transform: `rotate(${((i % 5) - 2) * 3}deg)`,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      </InsertFold>
      <InsertFold title="Emotion marks" koma="marks-fold">
      <StickerGrid
        onPick={(id) => add("sticker", id)}
      />
      </InsertFold>
    </div>
  );
}

function InsertFold({
  title,
  koma,
  children,
}: {
  title: string;
  koma: string;
  children: ReactNode;
}) {
  // Folds remember whether you left them open, per browser. Read after mount so
  // server and client render the same closed fold first.
  const [open, setOpen] = useState(false);
  const restored = useRef(false);
  useEffect(() => {
    try {
      if (!restored.current) {
        restored.current = true;
        if (localStorage.getItem(`koma-fold:${koma}`) === "open") {
          setOpen(true);
          return;
        }
      }
      localStorage.setItem(`koma-fold:${koma}`, open ? "open" : "closed");
    } catch {
      /* private mode */
    }
  }, [koma, open]);
  return (
    <div className="mt-2" data-koma={koma}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${koma}-body`}
        data-koma={`${koma}-toggle`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-full items-center gap-1.5 rounded-[5px] px-1 text-[11px] font-medium text-muted hover:text-ink"
      >
        <ChevronRight
          className={cn(
            "size-3 transition-transform duration-[var(--motion-quick)] ease-[var(--ease-out)]",
            open && "rotate-90",
          )}
          strokeWidth={2.25}
        />
        {title}
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-[var(--motion-fast)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div
          id={`${koma}-body`}
          data-koma={`${koma}-body`}
          className="min-h-0 overflow-hidden"
          inert={!open || undefined}
        >
          <div className="pb-1 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Keynote's Arrange strip: align the selection, or one balloon to the page. */
function AlignStrip() {
  const count = useStudio((s) => selectionIds(s).length);
  const aligns: { mode: AlignMode; label: string; icon: ReactNode }[] = [
    { mode: "left", label: "Align Left", icon: <AlignStartVertical /> },
    { mode: "centerX", label: "Align Center", icon: <AlignCenterVertical /> },
    { mode: "right", label: "Align Right", icon: <AlignEndVertical /> },
    { mode: "top", label: "Align Top", icon: <AlignStartHorizontal /> },
    { mode: "centerY", label: "Align Middle", icon: <AlignCenterHorizontal /> },
    { mode: "bottom", label: "Align Bottom", icon: <AlignEndHorizontal /> },
  ];
  return (
    <div data-koma="align-strip">
      <p className="mb-1.5 text-[11px] font-medium text-muted">
        {count > 1 ? `Align ${count} balloons` : "Align to page"}
      </p>
      <div className="flex items-center gap-0.5">
        {aligns.map((a) => (
          <Tooltip key={a.mode}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={a.label}
                data-koma-align={a.mode}
                onClick={() => useStudio.getState().alignSelection(a.mode)}
                className="koma-icon-btn"
              >
                {a.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{a.label}</TooltipContent>
          </Tooltip>
        ))}
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        {(
          [
            { axis: "x", label: "Distribute Horizontally", icon: <AlignHorizontalDistributeCenter /> },
            { axis: "y", label: "Distribute Vertically", icon: <AlignVerticalDistributeCenter /> },
          ] as const
        ).map((d) => (
          <Tooltip key={d.axis}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={d.label}
                data-koma-distribute={d.axis}
                disabled={count < 3}
                onClick={() => useStudio.getState().distributeSelection(d.axis)}
                className="koma-icon-btn"
              >
                {d.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {count < 3 ? `${d.label} (select three or more)` : d.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function InsertBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-md bg-ink/5 py-2 text-xs font-medium text-ink active:bg-ink/15 hover:bg-ink/10"
    >
      <span className="[&>svg]:size-4">{children}</span>
      {label}
    </button>
  );
}

const StickerGrid = memo(StickerGridInner, () => true);
function StickerGridInner({ onPick }: { onPick: (id: StickerId) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {STICKERS.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-label={s.label}
          onClick={() => onPick(s.id)}
          className="flex size-12 items-center justify-center rounded-md bg-ink/5 p-1.5 active:bg-ink/15 hover:bg-ink/10"
        >
          <StickerMark id={s.id} />
        </button>
      ))}
    </div>
  );
}

const ClinicIconGrid = memo(ClinicIconGridInner, () => true);
function ClinicIconGridInner({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div data-koma="clinic-icons" className="space-y-2">
      {CLINIC_ICON_GROUPS.map((group) => (
        <div key={group}>
          <p className="mb-1 px-1 text-[11px] font-medium text-muted">{group}</p>
          <div className="grid grid-cols-4 gap-1">
            {CLINIC_ICONS.filter((icon) => icon.group === group).map((icon) => (
              <button
                key={icon.id}
                type="button"
                aria-label={icon.label}
                title={icon.label}
                onClick={() => onPick(icon.id)}
                className="flex flex-col items-center gap-0.5 rounded-md bg-ink/5 p-1.5 active:bg-ink/15 hover:bg-ink/10"
              >
                <img
                  src={clinicIconSrc(icon.id)}
                  alt=""
                  draggable={false}
                  className="size-10"
                />
                <span className="max-w-full truncate text-[10px] text-muted">
                  {icon.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LogoLibrary({
  logos,
  onUpload,
  onPlace,
  onRemove,
}: {
  logos: { id: string; src: string; name: string }[];
  onUpload: () => void;
  onPlace: (src: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div data-koma="logo-library">
      <p className="mb-2 text-[11px] font-medium text-muted">Company logo</p>
      <button
        type="button"
        data-koma="upload-logo"
        onClick={onUpload}
        className="mb-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-ink/20 bg-ink/5 text-xs font-medium hover:bg-ink/10"
      >
        <ImagePlus className="size-4" />
        Upload logo
      </button>
      {logos.length ? (
        <div className="grid grid-cols-2 gap-1.5">
          {logos.map((logo) => (
            <div
              key={logo.id}
              className="group relative overflow-hidden rounded-md bg-ink/5 p-2"
            >
              <button
                type="button"
                onClick={() => onPlace(logo.src)}
                className="flex h-16 w-full items-center justify-center"
                aria-label={`Place ${logo.name}`}
              >
                <img
                  src={logo.src}
                  alt={logo.name}
                  draggable={false}
                  className="max-h-14 max-w-full object-contain"
                />
              </button>
              <p className="truncate px-1 text-[10px] text-muted">{logo.name}</p>
              <button
                type="button"
                aria-label={`Remove ${logo.name}`}
                onClick={() => onRemove(logo.id)}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-surface text-muted opacity-0 shadow-tool group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] leading-[1.45] text-muted">
          PNG or SVG with a transparent background looks best on the page.
        </p>
      )}
    </div>
  );
}

function OverlayEditor({ overlay }: { overlay: Overlay }) {
  const cast = useStudio((s) => s.cast);
  if (overlay.kind === "sticker") {
    return (
      <div className="space-y-3">
        <p className="text-[11px] font-medium text-muted">Sticker</p>
        <p className="text-[11px] leading-[1.45] text-muted">
          Drag to move. Drag a corner to resize.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => useStudio.getState().removeOverlay(overlay.id)}
        >
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isDialogue(overlay.kind) || overlay.kind === "narration" ? (
        <Field label="Balloon">
          <BalloonStylePicker overlay={overlay} />
        </Field>
      ) : null}
      {isDialogue(overlay.kind) || overlay.kind === "narration" ? (
        <BalloonPaintControls overlay={overlay} />
      ) : null}
      <Field label="Font">
        <FontFamilyControl
          kind={overlay.kind}
          value={overlay.fontId}
          onChange={(fontId) =>
            useStudio.getState().updateOverlay(overlay.id, { fontId })
          }
        />
      </Field>
      <Field label="Type size" value={`${overlay.fontSize} pt`}>
        <Slider
          min={LETTER_FONT_MIN}
          max={LETTER_FONT_MAX}
          step={1}
          aria-label="Font size"
          value={[overlay.fontSize]}
          onValueChange={([v]) =>
            useStudio.getState().updateOverlay(
              overlay.id,
              { fontSize: clamp(v ?? 22, LETTER_FONT_MIN, LETTER_FONT_MAX) },
              true,
            )
          }
          onValueCommit={() => useStudio.getState().endLiveEdit(true, "Resize Type")}
        />
      </Field>
      {isDialogue(overlay.kind) ? (
        <Field label="Speaker">
          <span className="koma-popup block">
            <select
              aria-label="Speaker"
              data-koma="overlay-speaker"
              value={overlay.speakerId ?? ""}
              onChange={(e) =>
                useStudio.getState().assignSpeaker(overlay.id, e.target.value || null)
              }
              className="koma-field w-full outline-none"
            >
              <option value="">Narrator</option>
              {cast.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span aria-hidden className="koma-popup-badge">
              <ChevronsUpDown className="size-3" strokeWidth={2.5} />
            </span>
          </span>
        </Field>
      ) : null}
      {isDialogue(overlay.kind) ? (
        <div className="flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="sm"
            data-koma="inspector-chain"
            onClick={() => useStudio.getState().addChainedOverlay(overlay.id)}
          >
            Chain
          </Button>
          {overlay.chainId ? (
            <Button
              variant="outline"
              size="sm"
              data-koma="inspector-unchain"
              onClick={() => useStudio.getState().unchainOverlay(overlay.id)}
            >
              Unchain
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            data-koma="inspector-flip-x"
            onClick={() =>
              useStudio.getState().flipOverlayTail(overlay.id, "x")
            }
          >
            <FlipHorizontal2 />
            Other speaker
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-koma="inspector-flip-y"
            onClick={() =>
              useStudio.getState().flipOverlayTail(overlay.id, "y")
            }
          >
            <FlipVertical2 />
            Up / down
          </Button>
        </div>
      ) : null}
      <div className="flex gap-2">
        <div className="flex rounded-[7px] bg-ink/5 p-0.5">
          <button
            type="button"
            aria-label="Bold"
            aria-pressed={overlay.bold}
            onClick={() =>
              useStudio.getState().updateOverlay(overlay.id, {
                bold: !overlay.bold,
              })
            }
            className={cn(
              "flex size-7 items-center justify-center rounded-[5px] transition-colors duration-[var(--motion-quick)]",
              overlay.bold ? "bg-surface text-ink shadow-tool" : "text-muted hover:text-ink",
            )}
          >
            <Bold className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Italic"
            aria-pressed={overlay.italic}
            onClick={() =>
              useStudio.getState().updateOverlay(overlay.id, {
                italic: !overlay.italic,
              })
            }
            className={cn(
              "flex size-7 items-center justify-center rounded-[5px] transition-colors duration-[var(--motion-quick)]",
              overlay.italic ? "bg-surface text-ink shadow-tool" : "text-muted hover:text-ink",
            )}
          >
            <Italic className="size-4" />
          </button>
        </div>
        <Segmented
          className="flex-1"
          options={[
            { id: "left", icon: <AlignLeft className="size-4" />, label: "Align left" },
            { id: "center", icon: <AlignCenter className="size-4" />, label: "Align center" },
            { id: "right", icon: <AlignRight className="size-4" />, label: "Align right" },
          ]}
          value={overlay.align || (overlay.kind === "text" ? "left" : "center")}
          onChange={(id) =>
            useStudio
              .getState()
              .updateOverlay(overlay.id, { align: id as "left" | "center" | "right" })
          }
        />
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-medium text-muted">Lettering</p>
        <div className="flex flex-wrap items-center gap-1">
          {LETTER_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={c.label}
              onClick={() =>
                useStudio.getState().updateOverlay(overlay.id, {
                  color: c.id,
                })
              }
              className={cn(
                "size-7 rounded-full shadow-tool",
                c.id === "#ffffff" && "ring-1 ring-ink/25",
                overlay.color === c.id &&
                  "ring-2 ring-accent ring-offset-2 ring-offset-surface",
              )}
              style={{ background: c.id }}
            />
          ))}
          <label className="koma-well">
            <span className="sr-only">Custom color</span>
            <input
              type="color"
              value={overlay.color}
              aria-label="Custom color"
              onChange={(e) =>
                useStudio.getState().updateOverlay(overlay.id, {
                  color: e.target.value,
                })
              }
            />
            <span className="koma-well-dot" style={{ background: overlay.color }} />
          </label>
        </div>
      </div>
      <p className="text-[11px] leading-[1.45] text-muted">
        Type in the bubble. Drag to move. Drag the outline to shrink it small.
        {isDialogue(overlay.kind)
          ? " Drag the tail toward the speaker, or Speaker / F to point it at someone else"
          : ""}
        .
      </p>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => useStudio.getState().removeOverlay(overlay.id)}
      >
        Remove
      </Button>
    </div>
  );
}

function BookInspector() {
  const book = useStudio((s) => s.book);
  const chapters = useStudio((s) => s.chapters);
  const pages = useStudio((s) => s.pages);
  const currentPageId = useStudio((s) => s.currentPageId);

  function field(
    koma: string,
    label: string,
    value: string,
    key: "title" | "author" | "series" | "volume",
    placeholder: string,
  ) {
    return (
      <Field label={label}>
        <input
          data-koma={koma}
          value={value}
          placeholder={placeholder}
          onChange={(e) => useStudio.getState().setBook({ [key]: e.target.value })}
          className="koma-field w-full outline-none"
        />
      </Field>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium text-muted">Book</p>
      {field("book-title", "Title", book.title, "title", "Volume title")}
      {field("book-author", "Author", book.author, "author", "Writer")}
      {field("book-series", "Series", book.series, "series", "Series name")}
      {field("book-volume", "Volume", book.volume, "volume", "1")}
      <CheckRow
        label="First page is cover"
        koma="cover-first"
        checked={book.coverFirst}
        onChange={(v) => useStudio.getState().setBook({ coverFirst: v })}
      />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-medium text-muted">Chapters</p>
          <button
            type="button"
            data-koma="add-chapter"
            onClick={() => useStudio.getState().addChapter()}
            className="text-[11px] font-medium text-accent hover:underline"
          >
            Add at this page
          </button>
        </div>
        {chapters.length === 0 ? (
          <p className="text-[11px] leading-[1.45] text-muted">
            Mark the start of a chapter on the current page. Thumbnails group
            under the title.
          </p>
        ) : (
          <div className="space-y-2">
            {chapters.map((ch) => (
              <div key={ch.id} className="flex items-center gap-1.5">
                <input
                  value={ch.title}
                  aria-label="Chapter title"
                  onChange={(e) =>
                    useStudio.getState().renameChapter(ch.id, e.target.value)
                  }
                  className="koma-field h-7 min-w-0 flex-1 text-[12px] outline-none"
                />
                <span className="shrink-0 text-[10px] tabular-nums text-muted">
                  {pageLabel(pages, ch.startPageId, book.coverFirst)}
                </span>
                <button
                  type="button"
                  aria-label="Remove chapter"
                  onClick={() => useStudio.getState().removeChapter(ch.id)}
                  className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        data-koma="pad-spread"
        disabled={!needsPad(pages.length, book.coverFirst)}
        onClick={() => useStudio.getState().padToEvenSpread()}
      >
        Pad to even spread
      </Button>
      <p className="text-[11px] leading-[1.45] text-muted">
        Current page is {pageLabel(pages, currentPageId, book.coverFirst)}.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  children,
}: {
  label: string;
  /** A live readout beside the label, the number every Mac slider carries. */
  value?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="text-[11px] font-medium text-muted">{label}</p>
        {value != null ? (
          <span className="text-[11px] tabular-nums text-muted">{value}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** NSSegmentedControl: one knob slides between the segments. */