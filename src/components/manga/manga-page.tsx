import { useEffect, useMemo, useRef, useState } from "react";
import { boxesForPage } from "@/lib/manga/templates";
import { selectionIds, useCurrentPage, useStudio } from "@/lib/manga/store";
import {
  applyResize,
  applyRailMove,
  applyCornerMove,
  applyPanelMove,
  applyFillSlot,
  emptySlotAt,
  hitPanelId,
  applySwapRects,
  collectGutterRails,
  collectGutterCorners,
  snapRectToNeighbors,
  HANDLE_CURSOR,
  rectsFromBoxes,
} from "@/lib/manga/resize";
import { paperSpec } from "@/lib/manga/paper";
import { pageCssWidth, type PageZoom } from "@/lib/manga/zoom";
import type { PageState, PanelRect, ResizeHandle } from "@/lib/manga/types";
import { PanelFrame } from "./panel-frame";
import { Bubble, ChainLayer } from "./bubble";
import { SnapGuides } from "./balloon-style";
import { PageGrid, PrintGuides } from "./print-guides";
import { useHydrated } from "@/hooks/use-hydrated";
import { toast } from "sonner";
import { pageOverlays, chainGroups, isChainTail, isChained } from "@/lib/manga/lettering";
import { cn } from "@/lib/utils";

const NO_IDS: string[] = [];
import {
  incomingFilesFrom,
  isFileDrag,
  panelIdAtPoint,
  importIncomingFiles,
} from "@/lib/manga/drop";

export function MangaPage({
  onPickFile,
  onArmFile,
  onPanelMenu,
  onPaperMenu,
  zoom = "fit",
  pageOverride,
  readOnly = false,
  spreadSlot = false,
  fitHost = false,
}: {
  onPickFile: (panelId: string) => void;
  onArmFile?: (panelId: string) => void;
  onPanelMenu?: (panelId: string, x: number, y: number) => void;
  onPaperMenu?: (x: number, y: number) => void;
  zoom?: PageZoom;
  pageOverride?: PageState;
  readOnly?: boolean;
  spreadSlot?: boolean;
  fitHost?: boolean;
}) {
  const livePage = useCurrentPage();
  const page = pageOverride ?? livePage;
  const paperSize = useStudio((s) => s.paperSize);
  const bleed = useStudio((s) => s.bleed);
  const hydrated = useHydrated();
  // Device prefs the server cannot see: only drawn once the page has hydrated.
  const showGuides = useStudio((s) => s.showGuides) && hydrated;
  const showGrid = useStudio((s) => s.showGrid) && hydrated;
  const snapEdges = useStudio((s) => s.snapEdges);
  const snapGuides = useStudio((s) => s.snapGuides);
  const spec = paperSpec(paperSize);
  const live = !pageOverride && !readOnly;
  const gutter = useStudio((s) => s.gutter);
  const margin = useStudio((s) => s.margin);
  const border = useStudio((s) => s.border);
  const paper = useStudio((s) => s.paper);
  const rtl = useStudio((s) => s.rtl);
  const showNumbers = useStudio((s) => s.showNumbers);
  const selectedPanelId = useStudio((s) => (live ? s.selectedPanelId : null));
  const selectedOverlayId = useStudio((s) => (live ? s.selectedOverlayId : null));
  const selectedOverlayIds = useStudio((s) => (live ? s.selectedOverlayIds : NO_IDS));
  const selectedIds = useMemo(
    () => selectionIds({ selectedOverlayId, selectedOverlayIds }),
    [selectedOverlayId, selectedOverlayIds],
  );
  // ⇧-drag on the page draws a rubber band that selects the balloons it crosses.
  const [band, setBand] = useState<PanelRect | null>(null);
  const bandRef = useRef<{ x0: number; y0: number; pointerId: number } | null>(null);
  const editingPanelId = useStudio((s) => s.editingPanelId);
  const pendingSrc = useStudio((s) => s.pendingSrc);
  const pendingBackground = useStudio((s) => s.pendingBackground);
  const imageTool = useStudio((s) => s.imageTool);
  const arranging = useStudio((s) => s.arranging);
  const placing = useStudio((s) => s.placing);
  const selectPanel = useStudio((s) => s.selectPanel);
  const selectOverlay = useStudio((s) => s.selectOverlay);
  const editPanel = useStudio((s) => s.editPanel);
  const setPanelImage = useStudio((s) => s.setPanelImage);
  const setPanelBackground = useStudio((s) => s.setPanelBackground);
  const placePhoto = useStudio((s) => s.placePhoto);
  const swapPanels = useStudio((s) => s.swapPanels);
  const updateImage = useStudio((s) => s.updateImage);

  const pageRef = useRef<HTMLDivElement>(null);
  const [pageEl, setPageEl] = useState<HTMLDivElement | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const [liftGhost, setLiftGhost] = useState<{
    from: string;
    src: string;
    x: number;
    y: number;
    over: string | null;
    slot: PanelRect | null;
  } | null>(null);
  const [armedRail, setArmedRail] = useState<string | null>(null);
  const [draftPlace, setDraftPlace] = useState<PanelRect | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveHint, setMoveHint] = useState<{
    x: number;
    y: number;
    over: string | null;
    slot: PanelRect | null;
  } | null>(null);
  const draftPlaceRef = useRef<PanelRect | null>(null);
  const place = useRef<{
    x0: number;
    y0: number;
    pointerId: number;
    moved: boolean;
  } | null>(null);
  const paperHold = useRef<number | null>(null);
  const dragDepth = useRef(0);
  const session = useRef<{
    kind: "handle" | "rail" | "corner" | "move";
    id: string;
    handle: ResizeHandle;
    axis?: "x" | "y";
    line?: number;
    xLine?: number;
    yLine?: number;
    startX: number;
    startY: number;
    startRects: Record<string, PanelRect>;
    moved: boolean;
    lastX?: number;
    lastY?: number;
  } | null>(null);
  const draftRef = useRef<Record<string, PanelRect> | null>(null);
  const [draft, setDraft] = useState<Record<string, PanelRect> | null>(null);

  const storedBoxes = useMemo(
    () => boxesForPage({ templateId: page.templateId, panels: page.panels }, margin, gutter, rtl),
    // Lettering edits replace the page object but not its panels; keep box identity stable then.
    [page.templateId, page.panels, margin, gutter, rtl],
  );
  const boxes = useMemo(() => {
    if (!draft) return storedBoxes;
    return storedBoxes.map((b) => {
      const r = draft[b.id];
      return r ? { ...b, x: r.x, y: r.y, w: r.w, h: r.h } : b;
    });
  }, [storedBoxes, draft]);
  const byId = useMemo(
    () => new Map(page.panels.map((p) => [p.id, p])),
    [page.panels],
  );
  const rails = useMemo(() => collectGutterRails(boxes, gutter), [boxes, gutter]);
  const corners = useMemo(() => collectGutterCorners(rails), [rails]);
  const lastRailTap = useRef({ id: "", t: 0 });

  useEffect(() => {
    const el = pageEl;
    if (!el) return;
    const sync = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0) el.style.setProperty("--sheet-w", `${w}px`);
      if (h > 0) el.style.setProperty("--sheet-h", `${h}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageEl]);

  useEffect(() => {
    function move(e: PointerEvent) {
      const s = session.current;
      const el = pageRef.current;
      if (!s || !el) return;
      s.moved = true;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dx = ((e.clientX - s.startX) / rect.width) * 100;
      const dy = ((e.clientY - s.startY) / rect.height) * 100;
      let next: Record<string, PanelRect>;
      if (s.kind === "move") {
        const px = ((e.clientX - rect.left) / rect.width) * 100;
        const py = ((e.clientY - rect.top) / rect.height) * 100;
        const over = hitPanelId(px, py, s.startRects, s.id);
        const others = Object.entries(s.startRects)
          .filter(([id]) => id !== s.id)
          .map(([, r]) => r);
        const slot = over ? null : emptySlotAt(px, py, others, { margin, gutter });
        next = over
          ? applySwapRects(s.startRects, s.id, over)
          : slot
            ? applyFillSlot(s.startRects, s.id, slot, gutter)
            : applyPanelMove(s.startRects, s.id, dx, dy, { margin });
        setMoveHint({ x: e.clientX, y: e.clientY, over, slot });
      } else if (s.kind === "corner" && s.xLine != null && s.yLine != null) {
        next = applyCornerMove(s.startRects, s.xLine, s.yLine, dx, dy, {
          margin,
          gutter,
        });
      } else if (s.kind === "rail" && s.axis && s.line != null) {
        next = applyRailMove(
          s.startRects,
          s.axis,
          s.line,
          s.axis === "x" ? dx : dy,
          { margin, gutter },
        );
      } else {
        next = applyResize(s.startRects, s.id, s.handle, dx, dy, {
          margin,
          gutter,
        });
        if (snapEdges) next = snapRectToNeighbors(next, s.id, s.handle);
      }
      draftRef.current = next;
      setDraft(next);
    }
    function up() {
      const s = session.current;
      if (!s) return;
      const d = draftRef.current;
      const moved = s.moved;
      session.current = null;
      draftRef.current = null;
      setDraft(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setMoving(false);
      setMoveHint(null);
      if (!moved) return;
      if (d) useStudio.getState().setPanelRects(d);
    }
    function blockTouch(e: TouchEvent) {
      if (session.current) e.preventDefault();
    }
    window.addEventListener("pointermove", move, { capture: true });
    window.addEventListener("pointerup", up, { capture: true });
    window.addEventListener("pointercancel", up, { capture: true });
    window.addEventListener("blur", up);
    window.addEventListener("touchmove", blockTouch, { passive: false });
    return () => {
      window.removeEventListener("pointermove", move, { capture: true } as EventListenerOptions);
      window.removeEventListener("pointerup", up, { capture: true } as EventListenerOptions);
      window.removeEventListener("pointercancel", up, { capture: true } as EventListenerOptions);
      window.removeEventListener("blur", up);
      window.removeEventListener("touchmove", blockTouch);
    };
  }, [margin, gutter, snapEdges]);

  function abortMove() {
    session.current = null;
    draftRef.current = null;
    setDraft(null);
    setMoving(false);
    setMoveHint(null);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function onMovePointerDown(e: React.PointerEvent, panelId: string) {
    if (readOnly) return;
    const locked = page.panels.find((p) => p.id === panelId)?.locked;
    if (locked) return;
    selectPanel(panelId);
    const startRects = rectsFromBoxes(boxes);
    session.current = {
      kind: "move",
      id: panelId,
      handle: "se",
      startX: e.clientX,
      startY: e.clientY,
      startRects,
      moved: false,
      lastX: e.clientX,
      lastY: e.clientY,
    };
    draftRef.current = startRects;
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";
    setMoving(true);
  }

  function onResizePointerDown(
    e: React.PointerEvent,
    panelId: string,
    handle: ResizeHandle,
  ) {
    if (readOnly) return;
    if (page.panels.find((p) => p.id === panelId)?.locked) return;
    selectPanel(panelId);
    const startRects = rectsFromBoxes(boxes);
    session.current = {
      kind: "handle",
      id: panelId,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startRects,
      moved: false,
    };
    draftRef.current = startRects;
    document.body.style.cursor = HANDLE_CURSOR[handle];
    document.body.style.userSelect = "none";
    try {
      pageRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onRailPointerDown(
    e: React.PointerEvent,
    rail: (typeof rails)[number],
  ) {
    if (readOnly) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const now = Date.now();
    const isDouble =
      lastRailTap.current.id === rail.id && now - lastRailTap.current.t < 450;
    lastRailTap.current = { id: rail.id, t: now };
    if (isDouble) setArmedRail(rail.id);
    selectPanel(null);
    selectOverlay(null);
    const startRects = rectsFromBoxes(boxes);
    session.current = {
      kind: "rail",
      id: rail.id,
      handle: rail.axis === "x" ? "e" : "s",
      axis: rail.axis,
      line: rail.line,
      startX: e.clientX,
      startY: e.clientY,
      startRects,
      moved: false,
    };
    draftRef.current = startRects;
    document.body.style.cursor = rail.axis === "x" ? "ew-resize" : "ns-resize";
    document.body.style.userSelect = "none";
    try {
      pageRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onCornerPointerDown(
    e: React.PointerEvent,
    corner: (typeof corners)[number],
  ) {
    if (readOnly) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const now = Date.now();
    const isDouble =
      lastRailTap.current.id === corner.id && now - lastRailTap.current.t < 450;
    lastRailTap.current = { id: corner.id, t: now };
    if (isDouble) setArmedRail(corner.id);
    selectPanel(null);
    selectOverlay(null);
    const startRects = rectsFromBoxes(boxes);
    session.current = {
      kind: "corner",
      id: corner.id,
      handle: "se",
      xLine: corner.xLine,
      yLine: corner.yLine,
      startX: e.clientX,
      startY: e.clientY,
      startRects,
      moved: false,
    };
    draftRef.current = startRects;
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";
    try {
      pageRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  async function dropOn(
    panelId: string,
    src: string,
    file?: File,
    asBackground = false,
  ) {
    try {
      if (file) {
        const n = await importIncomingFiles(
          [file],
          panelId,
          asBackground ? "background" : "photo",
        );
        if (asBackground) toast.success("Background added");
        else if (n) {
          const panel = useStudio
            .getState()
            .currentPage()
            .panels.find((p) => p.id === panelId);
          if (panel?.image && panel.background) {
            toast.message("Layered on this panel. Extra photos become characters you can drag.");
          }
        }
      } else if (src) {
        if (asBackground) setPanelBackground(panelId, src);
        else {
          const kind = placePhoto(panelId, src);
          if (kind === "stacked") toast.message("Photo layered over the first image");
          else if (kind === "character") toast.message("Character added — drag it into place");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add file");
    }
  }

  function onFileDragOver(e: React.DragEvent) {
    if (readOnly || !isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropTarget(panelIdAtPoint(e.clientX, e.clientY));
  }

  function onFileDragEnter(e: React.DragEvent) {
    if (readOnly || !isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setFileDrag(true);
  }

  function onFileDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setDropTarget(null);
      setFileDrag(false);
    }
  }

  async function onFileDrop(e: React.DragEvent) {
    if (readOnly) return;
    const files = incomingFilesFrom(e.dataTransfer);
    const uri =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain");
    if (!files.length && !uri) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setFileDrag(false);
    const over = panelIdAtPoint(e.clientX, e.clientY);
    const p = pagePctFromEvent(e.clientX, e.clientY);
    const others = boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
    const slot = over ? null : emptySlotAt(p.x, p.y, others, { margin, gutter });
    setDropTarget(null);
    try {
      if (!over && files.length) {
        const id = useStudio
          .getState()
          .addPanelAt(slot ?? { x: 10, y: 10, w: 80, h: 50 });
        await importIncomingFiles(files, id);
        return;
      }
      const target =
        over ??
        selectedPanelId ??
        page.panels.find((pn) => !pn.image)?.id ??
        page.panels[0]?.id ??
        null;
      const asBackground = e.altKey || e.shiftKey;
      if (files.length) {
        await importIncomingFiles(files, target, asBackground ? "background" : "photo");
        if (asBackground) toast.success("Background added");
      } else if (uri) {
        if (!target) return;
        if (asBackground || uri.startsWith("koma-bg:")) {
          setPanelBackground(target, uri.replace(/^koma-bg:/, "").trim());
        } else {
          const kind = placePhoto(target, uri.trim());
          if (kind === "stacked") toast.message("Photo layered over the first image");
          else if (kind === "character") toast.message("Character added — drag it into place");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add file");
    }
  }

  function pagePctFromEvent(clientX: number, clientY: number) {
    const el = pageRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * 100,
      y: ((clientY - r.top) / r.height) * 100,
    };
  }

  function startPlace(e: React.PointerEvent) {
    const p = pagePctFromEvent(e.clientX, e.clientY);
    place.current = {
      x0: p.x,
      y0: p.y,
      pointerId: e.pointerId,
      moved: false,
    };
    setDraftPlace({ x: p.x, y: p.y, w: 0, h: 0 });
    draftPlaceRef.current = { x: p.x, y: p.y, w: 0, h: 0 };
    selectOverlay(null);
    try {
      pageRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function movePlace(e: React.PointerEvent) {
    const s = place.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const p = pagePctFromEvent(e.clientX, e.clientY);
    if (Math.hypot(p.x - s.x0, p.y - s.y0) > 1.2) s.moved = true;
    if (paperHold.current != null) {
      window.clearTimeout(paperHold.current);
      paperHold.current = null;
    }
    const x = Math.min(s.x0, p.x);
    const y = Math.min(s.y0, p.y);
    const next = {
      x,
      y,
      w: Math.abs(p.x - s.x0),
      h: Math.abs(p.y - s.y0),
    };
    draftPlaceRef.current = next;
    setDraftPlace(next);
  }

  function endPlace(e: React.PointerEvent) {
    const s = place.current;
    if (!s || (e.pointerId != null && s.pointerId !== e.pointerId)) return;
    const draft = draftPlaceRef.current;
    const moved = s.moved;
    place.current = null;
    draftPlaceRef.current = null;
    setDraftPlace(null);
    if (paperHold.current != null) {
      window.clearTimeout(paperHold.current);
      paperHold.current = null;
    }
    if (moved && draft && draft.w > 4 && draft.h > 4) {
      useStudio.getState().addPanelAt(draft);
    } else if (useStudio.getState().placing) {
      useStudio.getState().setPlacing(false);
    }
  }

  return (
    <div className={cn("relative mx-auto w-full max-w-full", fitHost && "grid h-full min-h-0 w-full place-items-center")}>
      <div
        ref={(el) => {
          pageRef.current = el;
          setPageEl(el);
        }}
        className={cn(
          "paper-sheet koma-page-zoom relative mx-auto",
          placing && "cursor-crosshair",
          readOnly && "pointer-events-none",
        )}
        data-paper={paper}
        data-readonly={readOnly ? "true" : undefined}
        style={{
          ["--page-w" as string]: String(spec.w),
          ["--page-h" as string]: String(spec.h),
          width: fitHost ? "auto" : pageCssWidth(zoom),
          height: fitHost ? "100%" : undefined,
          maxHeight: fitHost ? "100%" : undefined,
          maxWidth:
            fitHost
              ? "100%"
              : zoom === "fit"
              ? spreadSlot
                ? `min(calc((100dvh - 7.5rem) * ${spec.w} / ${spec.h} * 0.92), calc((100vw - 20rem) / 2 - 1.25rem))`
                : `calc((100dvh - 7.5rem) * ${spec.w} / ${spec.h})`
              : undefined,
          aspectRatio: `${spec.w} / ${spec.h}`,
          cursor: placing ? "crosshair" : undefined,
          // The print guides draw the bleed to scale; without them a band stands in for it.
          boxShadow:
            bleed > 0 && !(live && showGuides)
              ? `0 0 0 ${Math.max(4, bleed * 2.2)}px color-mix(in srgb, var(--color-bg) 55%, #8a8a8e)`
              : undefined,
        }}
        onPointerDownCapture={(e) => {
          if (readOnly || e.button !== 0) return;
          if ((e.target as HTMLElement).closest("[data-overlay-id]")) return;
          if (e.shiftKey && !placing) {
            e.preventDefault();
            e.stopPropagation();
            const p = pagePctFromEvent(e.clientX, e.clientY);
            bandRef.current = { x0: p.x, y0: p.y, pointerId: e.pointerId };
            setBand({ x: p.x, y: p.y, w: 0, h: 0 });
            try {
              pageRef.current?.setPointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
            return;
          }
          if (!placing) return;
          e.preventDefault();
          e.stopPropagation();
          startPlace(e);
        }}
        onPointerDown={(e) => {
          if (readOnly) return;
          if (e.button !== 0) return;
          if (e.target !== e.currentTarget) return;
          selectPanel(null);
          selectOverlay(null);
          setArmedRail(null);
          if (placing) return;
          startPlace(e);
          if (paperHold.current != null) window.clearTimeout(paperHold.current);
          const x = e.clientX;
          const y = e.clientY;
          paperHold.current = window.setTimeout(() => {
            paperHold.current = null;
            place.current = null;
            setDraftPlace(null);
            onPaperMenu?.(x, y);
          }, 520);
        }}
        onPointerMove={(e) => {
          const b = bandRef.current;
          if (b && b.pointerId === e.pointerId) {
            const p = pagePctFromEvent(e.clientX, e.clientY);
            setBand({
              x: Math.min(b.x0, p.x),
              y: Math.min(b.y0, p.y),
              w: Math.abs(p.x - b.x0),
              h: Math.abs(p.y - b.y0),
            });
            return;
          }
          if (place.current) movePlace(e);
        }}
        onPointerUp={(e) => {
          const b = bandRef.current;
          if (b && b.pointerId === e.pointerId) {
            bandRef.current = null;
            const r = band;
            setBand(null);
            if (r && (r.w > 0.5 || r.h > 0.5)) {
              const hit = pageOverlays(page)
                .filter(
                  (o) =>
                    !o.hidden &&
                    o.x < r.x + r.w &&
                    o.x + o.w > r.x &&
                    o.y < r.y + r.h &&
                    o.y + o.h > r.y,
                )
                .map((o) => o.id);
              if (hit.length) useStudio.getState().selectOverlays(hit);
              else selectOverlay(null);
            }
            return;
          }
          if (place.current) endPlace(e);
        }}
        onPointerCancel={(e) => {
          if (bandRef.current?.pointerId === e.pointerId) {
            bandRef.current = null;
            setBand(null);
            return;
          }
          if (place.current) endPlace(e);
        }}
        onContextMenu={(e) => {
          if (readOnly) return;
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          place.current = null;
          setDraftPlace(null);
          onPaperMenu?.(e.clientX, e.clientY);
        }}
        onDragEnterCapture={onFileDragEnter}
        onDragOverCapture={onFileDragOver}
        onDragLeaveCapture={onFileDragLeave}
        onDropCapture={onFileDrop}
      >
        <div className="paper-grain rounded-[inherit]" />
        <svg className="pointer-events-none absolute h-0 w-0" aria-hidden>
          <defs>
            <filter id="koma-ink-sfx" x="-25%" y="-25%" width="150%" height="150%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.05 0.09"
                numOctaves="2"
                seed="4"
                result="n"
              />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="5.5" />
            </filter>
          </defs>
        </svg>
        {boxes.length === 0 && !draftPlace && !readOnly ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-8 text-center">
            <p className="max-w-[16rem] text-[13px] leading-relaxed text-muted">
              {placing
                ? "Drag on the page to draw a panel."
                : "Right-click or drag on the paper to insert a panel. Templates are a starting point — each page can be different."}
            </p>
          </div>
        ) : null}
        {boxes.map((box) => {
          const panel = byId.get(box.id);
          if (!panel) return null;
          return (
            <PanelFrame
              key={box.id}
              box={box}
              panel={panel}
              selected={selectedPanelId === box.id}
              editing={live && editingPanelId === box.id}
              arranging={live && arranging}
              lifting={
                live &&
                (liftGhost?.from === box.id || (moving && selectedPanelId === box.id))
              }
              pending={
                (Boolean(pendingSrc) && selectedPanelId !== box.id) ||
                (Boolean(pendingBackground) && selectedPanelId !== box.id) ||
                dropTarget === box.id ||
                Boolean(
                  liftGhost &&
                    liftGhost.over === box.id &&
                    liftGhost.from !== box.id,
                ) ||
                Boolean(moveHint?.over === box.id)
              }
              showNumber={showNumbers && !readOnly}
              borderPct={border}
              onSelect={() => {
                if (readOnly) return;
                if (pendingSrc) {
                  const kind = placePhoto(box.id, pendingSrc);
                  if (kind === "stacked") toast.message("Photo layered over the first image");
                  else if (kind === "character") toast.message("Character added — drag it into place");
                  return;
                }
                if (pendingBackground) {
                  setPanelBackground(box.id, pendingBackground);
                  return;
                }
                selectPanel(box.id);
              }}
              onEdit={() => {
                if (readOnly) return;
                editPanel(box.id);
              }}
              onLiftMove={(x, y) => {
                const src = panel.image?.src;
                if (!src) return;
                const over = panelIdAtPoint(x, y, box.id);
                const p = pagePctFromEvent(x, y);
                const others = boxes
                  .filter((b) => b.id !== box.id)
                  .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
                const slot = over
                  ? null
                  : emptySlotAt(p.x, p.y, others, { margin, gutter });
                setLiftGhost({
                  from: box.id,
                  src,
                  x,
                  y,
                  over,
                  slot,
                });
              }}
              onLiftEnd={(x, y) => {
                const over = panelIdAtPoint(x, y, box.id);
                const from = liftGhost?.from ?? box.id;
                const slot = liftGhost?.slot ?? null;
                const src = liftGhost?.src;
                setLiftGhost(null);
                if (over && over !== from) {
                  swapPanels(from, over);
                  return;
                }
                if (slot && src) {
                  const id = useStudio.getState().addPanelAt(slot);
                  useStudio.getState().setPanelImage(id, src);
                  useStudio.getState().clearPanel(from);
                }
              }}
              onOpenFile={() => onPickFile(box.id)}
              onArmFile={() => onArmFile?.(box.id)}
              onContextMenu={(x, y) => onPanelMenu?.(box.id, x, y)}
              onDropSrc={(src, file, asBackground) =>
                dropOn(box.id, src, file, asBackground)
              }
              onDropBackground={(src) => setPanelBackground(box.id, src)}
              onPan={(focusX, focusY) => updateImage(box.id, { focusX, focusY })}
              onZoom={(zoom) => updateImage(box.id, { zoom })}
              onResizePointerDown={(e, handle) =>
                onResizePointerDown(e, box.id, handle)
              }
              onMovePointerDown={(e) => onMovePointerDown(e, box.id)}
              onAbortMove={abortMove}
              imageTool={imageTool}
              readOnly={readOnly}
            />
          );
        })}
        {draftPlace && draftPlace.w > 0.5 && draftPlace.h > 0.5 ? (
          <div
            className="pointer-events-none absolute z-50 border-[1.6px] border-dashed border-ink bg-paper/40"
            style={{
              left: `${draftPlace.x}%`,
              top: `${draftPlace.y}%`,
              width: `${draftPlace.w}%`,
              height: `${draftPlace.h}%`,
            }}
          />
        ) : null}
        {liftGhost?.slot || moveHint?.slot ? (
          <div
            className="pointer-events-none absolute z-50 border-[1.6px] border-dashed border-accent bg-accent/10"
            style={{
              left: `${(liftGhost?.slot ?? moveHint?.slot)!.x}%`,
              top: `${(liftGhost?.slot ?? moveHint?.slot)!.y}%`,
              width: `${(liftGhost?.slot ?? moveHint?.slot)!.w}%`,
              height: `${(liftGhost?.slot ?? moveHint?.slot)!.h}%`,
            }}
          />
        ) : null}
        {readOnly || moving || liftGhost
          ? null
          : rails.map((rail, i) => {
          const vertical = rail.axis === "x";
          const armed = armedRail === rail.id;
          const span = rail.end - rail.start;
          return (
            <div
              key={`${rail.id}:${i}`}
              data-koma-rail
              aria-label={
                vertical ? "Move vertical panel border" : "Move horizontal panel border"
              }
              className={cn(
                "koma-rail",
                vertical ? "koma-rail-v" : "koma-rail-h",
                armed && "is-armed",
              )}
              style={
                vertical
                  ? {
                      left: `${rail.mid}%`,
                      top: `${rail.start}%`,
                      height: `${span}%`,
                    }
                  : {
                      top: `${rail.mid}%`,
                      left: `${rail.start}%`,
                      width: `${span}%`,
                    }
              }
              onPointerDown={(e) => onRailPointerDown(e, rail)}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setArmedRail(rail.id);
              }}
            />
          );
        })}
        {readOnly || moving || liftGhost
          ? null
          : corners.map((corner) => (
          <div
            key={corner.id}
            data-koma-corner
            aria-label="Move panel corner diagonally"
            className={cn("koma-corner", armedRail === corner.id && "is-armed")}
            style={{
              left: `${corner.xMid}%`,
              top: `${corner.yMid}%`,
            }}
            onPointerDown={(e) => onCornerPointerDown(e, corner)}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setArmedRail(corner.id);
            }}
          />
        ))}
        {chainGroups(pageOverlays(page).filter((o) => !o.hidden)).map((group) => (
          <ChainLayer
            key={group[0]?.chainId ?? group[0]?.id}
            group={group}
            zIndex={group.every((o) => o.behind) ? 25 : 79}
          />
        ))}
        {live && showGrid ? <PageGrid spec={spec} /> : null}
        {live && showGuides ? <PrintGuides spec={spec} margin={margin} bleed={bleed} /> : null}
        {live ? <SnapGuides guides={snapGuides} /> : null}
        {band ? (
          <div
            className="koma-marquee pointer-events-none absolute z-[130]"
            data-koma="marquee"
            style={{ left: `${band.x}%`, top: `${band.y}%`, width: `${band.w}%`, height: `${band.h}%` }}
          />
        ) : null}
        {pageOverlays(page)
          .filter((o) => !o.hidden || selectedOverlayId === o.id)
          .map((overlay, i) => (
          <Bubble
            key={overlay.id}
            overlay={overlay}
            selected={selectedOverlayId === overlay.id}
            inSelection={selectedIds.length > 1 && selectedIds.includes(overlay.id)}
            pageEl={pageEl}
            ignorePointer={fileDrag || arranging || moving || placing || readOnly}
            zIndex={overlay.behind ? 25 : 80 + i}
            showTail={isChainTail(overlay, pageOverlays(page))}
            paintShape={!isChained(overlay, pageOverlays(page))}
          />
        ))}
        {liftGhost ? (
          <div
            className="pointer-events-none fixed z-[90] size-24 overflow-hidden rounded-md shadow-float ring-2 ring-accent"
            style={{
              left: liftGhost.x,
              top: liftGhost.y,
              transform: "translate(-50%, -50%)",
            }}
          >
            <img src={liftGhost.src} alt="" className="size-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-0.5 text-center text-[10px] font-medium text-paper">
              {liftGhost.over && liftGhost.over !== liftGhost.from
                ? "Swap"
                : liftGhost.slot
                  ? "Fill"
                  : "Move"}
            </span>
          </div>
        ) : null}
        {moving && moveHint && !liftGhost ? (
          <div
            className="pointer-events-none fixed z-[90] rounded-full bg-ink px-2.5 py-1 text-[10px] font-medium text-paper shadow-float"
            style={{
              left: moveHint.x,
              top: moveHint.y,
              transform: "translate(-50%, -130%)",
            }}
          >
            {moveHint.over ? "Swap" : moveHint.slot ? "Drop here" : "Move"}
          </div>
        ) : null}
      </div>
    </div>
  );
}
