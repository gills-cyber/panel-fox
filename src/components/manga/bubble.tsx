import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { FlipHorizontal2, FlipVertical2 } from "lucide-react";
import type { Overlay, ResizeHandle, StickerId } from "@/lib/manga/types";
import { HANDLE_CURSOR } from "@/lib/manga/resize";
import { glyphWobble, moveOverlay, resizeOverlay, THOUGHT_CLOUD, chainConnectorPath, HEART_PATH, RAGE_PATH, isGlowInk, glowStrength, isDialogue, fitBubbleSize, speechTailGeom, speechTailPath, thoughtTrail, canRotate, wrapDeg, overlayOpacity, tintsRaster, stickerPaint, STICKER_COLORS, scaleOverlayBy, scaleOverlaySize, LETTER_FONT_MAX, LETTER_FONT_MIN, pageOverlays, letterRefHeight, letterLockHeight, isClearPaint } from "@/lib/manga/lettering";
import {
  balloonStyleOf,
  balloonHasTail,
  balloonEllipse,
  balloonUsesTrail,
  balloonTextFrame,
  snapMove,
  snapResize,
  extraSnapLines,
  overlayAtPoint,
  tailPagePoint,
  burstPath,
} from "@/lib/manga/balloons";
import { boxesForPage } from "@/lib/manga/templates";
import { BalloonStylePicker } from "@/components/manga/balloon-style";
import { BalloonPaintControls } from "@/components/manga/balloon-paint";
import { overlayFontCss, titleUsesOutline } from "@/lib/manga/fonts";
import { FontFamilyControl } from "@/components/manga/font-family";
import { useStudio } from "@/lib/manga/store";
import { fitLetterBox, letterMinBox } from "@/lib/manga/fit";
import { inkBody, inkPuff, inkSeed, inkTail, type InkBox } from "@/lib/manga/ink";
import { pageAspect } from "@/lib/manga/paper";
import { cn, clamp } from "@/lib/utils";
import { FontSizeControl } from "@/components/manga/font-size";
import { ContextMenu } from "@/components/manga/context-menu";
import { combo } from "@/lib/manga/hotkeys";
import { Slider } from "@/components/ui/slider";
import { scriptOrder, speakerOf } from "@/lib/manga/script";
import { smartEdit } from "@/lib/manga/typography";

const HANDLES: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const HANDLE_POS: Record<ResizeHandle, string> = {
  n: "koma-handle-n",
  s: "koma-handle-s",
  e: "koma-handle-e",
  w: "koma-handle-w",
  ne: "koma-handle-ne",
  nw: "koma-handle-nw",
  se: "koma-handle-se",
  sw: "koma-handle-sw",
};

function overlayBarStyle(overlay: Overlay): CSSProperties {
  const dialogue = isDialogue(overlay.kind);
  const roomAbove = overlay.y >= 12;
  const tailUp = dialogue && overlay.tailY < 40;
  const roomBelow = overlay.y + overlay.h <= 78;
  if (dialogue) {
    if (roomAbove && !tailUp) {
      return { left: "50%", top: 0, transform: "translate(-50%, calc(-100% - 8px))" };
    }
    if (roomBelow && tailUp) {
      return { left: "50%", top: "100%", transform: "translate(-50%, 10px)" };
    }
    if (overlay.x + overlay.w / 2 < 52) {
      return { left: "100%", top: 0, transform: "translate(8px, 0)" };
    }
    return { left: 0, top: 0, transform: "translate(calc(-100% - 8px), 0)" };
  }
  if (overlay.y < 8) {
    return { left: "50%", top: "100%", transform: "translate(-50%, 10px)" };
  }
  return { left: "50%", top: 0, transform: "translate(-50%, calc(-100% - 8px))" };
}

function overlayPopStyle(overlay: Overlay): CSSProperties {
  const bar = overlayBarStyle(overlay);
  if (bar.top === 0 || bar.top === "0") {
    return { left: "50%", top: 0, transform: "translate(-50%, calc(-100% - 84px))" };
  }
  if (bar.top === "100%") {
    return { left: "50%", top: "100%", transform: "translate(-50%, 52px)" };
  }
  if (bar.left === "100%") {
    return { left: "100%", top: 0, transform: "translate(8px, 48px)" };
  }
  return { left: 0, top: 0, transform: "translate(calc(-100% - 8px), 48px)" };
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Apple-like ease-out with a whisper of overshoot. */
function appleEase(t: number) {
  const e = 1 - (1 - t) ** 4;
  return e + Math.sin(Math.PI * t) * 0.055 * (1 - t);
}

function useTailMotion(tailX: number, tailY: number, live: boolean) {
  const [visual, setVisual] = useState({ x: tailX, y: tailY });
  const visualRef = useRef(visual);
  visualRef.current = visual;
  const raf = useRef(0);

  useEffect(() => {
    if (live || prefersReducedMotion()) {
      cancelAnimationFrame(raf.current);
      const next = { x: tailX, y: tailY };
      visualRef.current = next;
      setVisual(next);
      return;
    }
    if (
      Math.abs(visualRef.current.x - tailX) < 0.04 &&
      Math.abs(visualRef.current.y - tailY) < 0.04
    ) {
      return;
    }
    const from = visualRef.current;
    const t0 = performance.now();
    const ms = 340;
    cancelAnimationFrame(raf.current);
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = appleEase(t);
      const next = {
        x: from.x + (tailX - from.x) * e,
        y: from.y + (tailY - from.y) * e,
      };
      visualRef.current = next;
      setVisual(next);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [tailX, tailY, live]);

  return visual;
}

function BubbleInner({
  overlay,
  selected,
  pageEl,
  ignorePointer = false,
  zIndex = 30,
  showTail = true,
  paintShape = true,
}: {
  overlay: Overlay;
  selected: boolean;
  pageEl: HTMLDivElement | null;
  ignorePointer?: boolean;
  zIndex?: number;
  showTail?: boolean;
  paintShape?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [textEditing, setTextEditing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [hideBar, setHideBar] = useState(false);
  const [liveDrag, setLiveDrag] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const hold = useRef<number | null>(null);
  const holdFrom = useRef({ x: 0, y: 0 });
  const wheelQuiet = useRef<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    dist: number;
    size: number;
    ang: number;
    rotate: number;
    w: number;
    h: number;
    x: number;
    y: number;
  } | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    start: Overlay;
    mode: "move" | "resize" | "tail" | "rotate";
    handle?: ResizeHandle;
    pointerId: number;
    moved: boolean;
  } | null>(null);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const liveDragRef = useRef(liveDrag);
  liveDragRef.current = liveDrag;
  const textEditingRef = useRef(textEditing);
  textEditingRef.current = textEditing;
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const at = pendingCaret.current;
    if (at == null) return;
    pendingCaret.current = null;
    const el = textRef.current;
    if (el && document.activeElement === el) el.setSelectionRange(at, at);
  }, [overlay.text]);

  // A balloon dropped with a double-click opens for typing straight away.
  useEffect(() => {
    const studio = useStudio.getState();
    if (studio.pendingEditOverlayId !== overlay.id) return;
    studio.setPendingEditOverlay(null);
    setTextEditing(true);
  }, [overlay.id]);
  const [draft, setDraft] = useState<Partial<Overlay> | null>(null);
  const draftRef = useRef<Partial<Overlay> | null>(null);
  const draftRaf = useRef(0);
  const o: Overlay = draft ? { ...overlay, ...draft } : overlay;

  function applyDraft(patch: Partial<Overlay>) {
    const next = { ...(draftRef.current ?? {}), ...patch };
    draftRef.current = next;
    if (draftRaf.current) return;
    draftRaf.current = requestAnimationFrame(() => {
      draftRaf.current = 0;
      if (draftRef.current) setDraft(draftRef.current);
    });
  }

  function flushDraft() {
    if (draftRaf.current) {
      cancelAnimationFrame(draftRaf.current);
      draftRaf.current = 0;
    }
    const patch = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    const studio = useStudio.getState();
    if (patch && Object.keys(patch).length) {
      studio.updateOverlay(overlay.id, patch, true);
      studio.endLiveEdit();
    } else {
      studio.endLiveEdit(false);
    }
  }

  useEffect(() => {
    if (!selected) {
      setTextEditing(false);
      setStyleOpen(false);
    }
  }, [selected]);

  useEffect(() => {
    if (!styleOpen) return;
    function close(e: PointerEvent) {
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest("[data-koma='balloon-style-pop'], [data-koma='balloon-style']")
      ) {
        return;
      }
      setStyleOpen(false);
    }
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [styleOpen]);

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 360);
    return () => {
      window.clearTimeout(t);
      if (wheelQuiet.current != null) window.clearTimeout(wheelQuiet.current);
    };
  }, []);

  useEffect(() => {
    if (!selected || textEditing) return;
    rootRef.current?.focus({ preventScroll: true });
  }, [selected, textEditing, overlay.id]);

  useEffect(() => {
    if (!selected || !textEditing || overlay.kind === "sticker") return;
    const t = window.setTimeout(() => {
      textRef.current?.focus({ preventScroll: true });
    }, 30);
    return () => window.clearTimeout(t);
  }, [selected, textEditing, overlay.id, overlay.kind]);

  // Type size is fixed by the font size the user picked; the balloon is sized
  // around the words by the store, so nothing here rescales the lettering.
  useLayoutEffect(() => {
    rootRef.current?.style.setProperty("--fit-scale", "1");
  }, []);

  function cancelHold() {
    if (hold.current != null) {
      window.clearTimeout(hold.current);
      hold.current = null;
    }
  }

  function remove() {
    useStudio.getState().removeOverlay(overlay.id);
    setMenu(null);
  }

  /** The overlay as it looks right now: the store value plus any uncommitted draft. */
  function liveOverlay(): Overlay {
    return { ...overlayRef.current, ...(draftRef.current ?? {}) };
  }

  /**
   * Wheel / button nudges stay a local draft while they stream in, like a drag,
   * so the whole studio is not re-rendered per tick. The draft is committed as
   * one history step once the input goes quiet.
   */
  function nudgeLive(patch: Partial<Overlay>) {
    if (!liveDragRef.current) {
      liveDragRef.current = true;
      setLiveDrag(true);
      useStudio.getState().beginLiveEdit();
    }
    applyDraft(patch);
    if (wheelQuiet.current != null) window.clearTimeout(wheelQuiet.current);
    wheelQuiet.current = window.setTimeout(() => {
      wheelQuiet.current = null;
      flushDraft();
      setLiveDrag(false);
    }, 220);
  }

  function bumpFont(delta: number) {
    const cur = liveOverlay();
    const step =
      cur.fontSize <= 16 && Math.abs(delta) > 1 ? Math.sign(delta) : delta;
    const fontSize = clamp(cur.fontSize + step, LETTER_FONT_MIN, LETTER_FONT_MAX);
    if (fontSize === cur.fontSize) return;
    const next = { ...cur, fontSize };
    const box = fitLetterBox(
      next,
      pageAspect(useStudio.getState().paperSize),
      cur.autoFit === false ? "grow" : "auto",
      cur,
    );
    nudgeLive({ fontSize, ...(box ?? {}) });
  }

  function pagePct(clientX: number, clientY: number) {
    const el = pageEl ?? rootRef.current?.offsetParent;
    if (!(el instanceof HTMLElement)) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * 100,
      y: ((clientY - r.top) / r.height) * 100,
    };
  }

  function onPointerDown(
    e: React.PointerEvent,
    mode: "move" | "resize" | "tail" | "rotate",
    handle?: ResizeHandle,
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (mode !== "move") e.preventDefault();
    useStudio.getState().selectOverlay(overlay.id);
    if (overlay.locked && mode !== "move") return;
    if (overlay.locked) {
      cancelHold();
      holdFrom.current = { x: e.clientX, y: e.clientY };
      hold.current = window.setTimeout(() => {
        setMenu({ x: holdFrom.current.x, y: holdFrom.current.y });
      }, 520);
      return;
    }
    cancelHold();
    holdFrom.current = { x: e.clientX, y: e.clientY };
    if (mode === "move" || mode === "resize" || mode === "tail" || mode === "rotate") {
      setLiveDrag(true);
      useStudio.getState().beginLiveEdit();
    }
    if (mode === "resize") applyDraft({ autoFit: false });
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      pinch.current = {
        dist: Math.max(12, Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)),
        size: overlay.fontSize,
        ang: Math.atan2(pts[1]!.y - pts[0]!.y, pts[1]!.x - pts[0]!.x) * (180 / Math.PI),
        rotate: overlay.rotate ?? 0,
        w: overlay.w,
        h: overlay.h,
        x: overlay.x,
        y: overlay.y,
      };
      drag.current = null;
      return;
    }
    if (mode === "move") {
      hold.current = window.setTimeout(() => {
        setMenu({ x: holdFrom.current.x, y: holdFrom.current.y });
        drag.current = null;
      }, 520);
    }
    if (mode === "tail") setHideBar(true);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      start: overlay,
      mode,
      handle,
      pointerId: e.pointerId,
      moved: false,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinch.current && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      const ang =
        Math.atan2(pts[1]!.y - pts[0]!.y, pts[1]!.x - pts[0]!.x) * (180 / Math.PI);
      const patch: Partial<Overlay> = {};
      if (canRotate(overlay.kind)) {
        patch.rotate = wrapDeg(pinch.current.rotate + (ang - pinch.current.ang));
      }
      if (overlay.kind === "sticker" && pinch.current.dist > 8) {
        const scale = d / pinch.current.dist;
        const next = scaleOverlaySize(
          {
            ...overlay,
            w: pinch.current.w,
            h: pinch.current.h,
            x: pinch.current.x,
            y: pinch.current.y,
          },
          pinch.current.w * scale,
        );
        patch.w = next.w;
        patch.h = next.h;
        patch.x = next.x;
        patch.y = next.y;
      } else if (isDialogue(overlay.kind) && pinch.current.dist > 8) {
        const scale = d / pinch.current.dist;
        const next = scaleOverlaySize(
          {
            ...overlay,
            w: pinch.current.w,
            h: pinch.current.h,
            x: pinch.current.x,
            y: pinch.current.y,
          },
          pinch.current.w * scale,
        );
        patch.w = next.w;
        patch.h = next.h;
        patch.x = next.x;
        patch.y = next.y;
        patch.fontSize = clamp(Math.round(pinch.current.size * scale), LETTER_FONT_MIN, LETTER_FONT_MAX);
      } else if (overlay.kind !== "sticker" && overlay.kind !== "tone" && pinch.current.dist > 8) {
        patch.fontSize = clamp(
          Math.round(pinch.current.size * (d / pinch.current.dist)),
          LETTER_FONT_MIN,
          LETTER_FONT_MAX,
        );
      }
      if (Object.keys(patch).length) applyDraft(patch);
      return;
    }
    if (
      Math.hypot(e.clientX - holdFrom.current.x, e.clientY - holdFrom.current.y) > 10
    ) {
      cancelHold();
    }
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || !pageEl) return;
    const a = pagePct(d.x, d.y);
    const b = pagePct(e.clientX, e.clientY);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const slop = d.mode === "move" ? 0.45 : 0.05;
    if (Math.abs(dx) + Math.abs(dy) < slop && !d.moved) return;
    d.moved = true;
    cancelHold();
    if (d.mode === "move") {
      const next = moveOverlay(d.start, dx, dy);
      const studio = useStudio.getState();
      const precision = e.altKey || e.metaKey || e.ctrlKey;
      if (!studio.snapEdges || precision) {
        studio.setSnapGuides([]);
        applyDraft(next);
      } else {
        const page = studio.currentPage();
        const others = pageOverlays(page)
          .filter((o) => o.id !== overlay.id && !o.hidden)
          .map((o) => ({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h }));
        const boxes = boxesForPage(page, studio.margin, studio.gutter, studio.rtl);
        const extras = extraSnapLines(studio.margin, boxes, studio.gutter);
        extras.x.push(...boxes.map((b) => b.x), ...boxes.map((b) => b.x + b.w), ...boxes.map((b) => b.x + b.w / 2));
        extras.y.push(...boxes.map((b) => b.y), ...boxes.map((b) => b.y + b.h), ...boxes.map((b) => b.y + b.h / 2));
        const snapped = snapMove({ ...d.start, ...next }, others, extras);
        studio.setSnapGuides(snapped.guides);
        applyDraft({ x: snapped.x, y: snapped.y });
      }
    } else if (d.mode === "resize" && d.handle) {
      let next = resizeOverlay(d.start, d.handle, dx, dy);
      const studio = useStudio.getState();
      if (e.shiftKey && d.start.w > 0 && d.start.h > 0) {
        // Shift keeps the balloon's proportions while a corner or edge is dragged.
        const ratio = d.start.w / d.start.h;
        const w = Math.max(next.w, next.h * ratio);
        const h = w / ratio;
        const x = d.handle.includes("w") ? d.start.x + d.start.w - w : next.x;
        const y = d.handle.includes("n") ? d.start.y + d.start.h - h : next.y;
        next = { x: clamp(x, 0, 100 - w), y: clamp(y, 0, 100 - h), w, h };
      }
      const keepRatio = e.shiftKey;
      const min = letterMinBox({ ...d.start, w: next.w }, pageAspect(studio.paperSize));
      if (min && (next.w < min.minW || next.h < min.minH)) {
        const w = Math.max(next.w, min.minW);
        const h = Math.max(next.h, min.minH);
        const x = d.handle.includes("w") ? d.start.x + d.start.w - w : next.x;
        const y = d.handle.includes("n") ? d.start.y + d.start.h - h : next.y;
        next = { x: clamp(x, 0, 100 - w), y: clamp(y, 0, 100 - h), w, h };
      }
      const precision = e.altKey || e.metaKey || e.ctrlKey || keepRatio;
      if (!studio.snapEdges || precision) {
        studio.setSnapGuides([]);
        applyDraft(next);
      } else {
        const page = studio.currentPage();
        const others = pageOverlays(page)
          .filter((o) => o.id !== overlay.id && !o.hidden)
          .map((o) => ({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h }));
        const boxes = boxesForPage(page, studio.margin, studio.gutter, studio.rtl);
        const extras = extraSnapLines(studio.margin, boxes, studio.gutter);
        extras.x.push(...boxes.map((b) => b.x), ...boxes.map((b) => b.x + b.w));
        extras.y.push(...boxes.map((b) => b.y), ...boxes.map((b) => b.y + b.h));
        const snapped = snapResize({ ...d.start, ...next }, d.handle, others, extras);
        studio.setSnapGuides(snapped.guides);
        applyDraft({
          x: snapped.x,
          y: snapped.y,
          w: snapped.w,
          h: snapped.h,
        });
      }
    } else if (d.mode === "tail") {
      const rect = pageEl.getBoundingClientRect();
      const ox = ((e.clientX - rect.left) / rect.width) * 100;
      const oy = ((e.clientY - rect.top) / rect.height) * 100;
      const tailX = ((ox - o.x) / o.w) * 100;
      const tailY = ((oy - o.y) / o.h) * 100;
      applyDraft({ tailX, tailY });
    } else if (d.mode === "rotate") {
      const rect = pageEl.getBoundingClientRect();
      const cx = rect.left + ((d.start.x + d.start.w / 2) / 100) * rect.width;
      const cy = rect.top + ((d.start.y + d.start.h / 2) / 100) * rect.height;
      const startAng = Math.atan2(d.y - cy, d.x - cx);
      const nowAng = Math.atan2(e.clientY - cy, e.clientX - cx);
      const deg = ((nowAng - startAng) * 180) / Math.PI;
      applyDraft({
        rotate: wrapDeg((d.start.rotate ?? 0) + deg),
      });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (drag.current?.pointerId === e.pointerId) {
      const mode = drag.current.mode;
      flushDraft();
      if (mode === "tail") {
        setHideBar(false);
        const studio = useStudio.getState();
        const page = studio.currentPage();
        const live = pageOverlays(page).find((x) => x.id === overlay.id) ?? overlay;
        const tip = tailPagePoint(live);
        const hit = overlayAtPoint(pageOverlays(page), tip.x, tip.y, overlay.id);
        if (hit && isDialogue(hit.kind) && isDialogue(live.kind)) {
          studio.joinOverlays(live.id, hit.id);
        }
      }
      drag.current = null;
      setLiveDrag(false);
      useStudio.getState().setSnapGuides([]);
    }
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) {
      if (pinch.current) flushDraft();
      pinch.current = null;
    }
    cancelHold();
  }

  const tail = useTailMotion(o.tailX, o.tailY, hideBar);
  const painted: Overlay = { ...o, tailX: tail.x, tailY: tail.y };
  const balloonStyle = balloonStyleOf(o);
  const chained = Boolean(o.chainId);
  const frame = balloonTextFrame(balloonStyle, o.kind);
  const refH = letterRefHeight(o.kind);
  const outlined = titleUsesOutline(o.kind, o.fontId);
  const outline =
    outlined
      ? [
          "-2px -2px 0 var(--color-paper)",
          "2px -2px 0 var(--color-paper)",
          "-2px 2px 0 var(--color-paper)",
          "2px 2px 0 var(--color-paper)",
          "0 0 6px var(--color-paper)",
        ].join(",")
      : overlay.kind === "sfx" && (!overlay.fontId || overlay.fontId === "sfx")
        ? [
            "-2px -2px 0 var(--color-paper)",
            "2px -2px 0 var(--color-paper)",
            "-2px 2px 0 var(--color-paper)",
            "2px 2px 0 var(--color-paper)",
            "0 0 6px var(--color-paper)",
          ].join(",")
        : undefined;

  const align = o.align || (o.kind === "text" ? "left" : "center");
  const textStyle: CSSProperties = {
    fontFamily: overlayFontCss(o.kind, o.fontId),
    WebkitTextSizeAdjust: "none",
    textSizeAdjust: "none",
    fontWeight: o.kind === "sfx" && (!o.fontId || o.fontId === "sfx") ? 400 : o.bold ? 800 : 500,
    fontStyle: o.italic ? "italic" : "normal",
    color: o.color,
    textShadow: outline,
    transform: o.kind === "sfx" && (!o.fontId || o.fontId === "sfx") && !o.vertical ? "rotate(-6deg)" : undefined,
    letterSpacing: o.kind === "sfx" ? "0.02em" : o.kind === "text" ? "0" : "-0.02em",
    lineHeight: o.kind === "text" ? 1.35 : 1.2,
    writingMode: o.vertical ? "vertical-rl" : undefined,
    textOrientation: o.vertical ? "mixed" : undefined,
    whiteSpace: o.vertical ? "pre" : "pre-wrap",
    overflowWrap: o.vertical ? undefined : "break-word",
    wordBreak: o.vertical ? undefined : "normal",
    minWidth: 0,
    textAlign: align,
  };

  const barStyle = overlayBarStyle(o);
  const rot = o.rotate ?? 0;
  const script = useStudio((s) => s.script);
  const cast = useStudio((s) => s.cast);
  const order = scriptOrder(script, overlay.scriptLineId);
  const speaker = speakerOf(cast, overlay.speakerId);

  return (
    <div
      ref={rootRef}
      data-overlay-id={overlay.id}
      data-kind={overlay.kind}
      data-tail-x={String(overlay.tailX)}
      data-tail-y={String(overlay.tailY)}
      data-font-size={String(overlay.fontSize)}
      data-koma-sticker={overlay.sticker}
      data-koma-opacity={String(Math.round(overlayOpacity(overlay) * 100))}
      data-koma-color={overlay.color || "original"}
      data-bold={overlay.bold ? "true" : "false"}
      data-italic={overlay.italic ? "true" : "false"}
      data-rotate={String(rot)}
      data-script-line={overlay.scriptLineId}
      data-script-order={order || undefined}
      data-balloon-style={balloonStyle}
      data-chain-id={overlay.chainId}
      className={cn(
        "koma-letter absolute touch-none outline-none",
        selected ? "z-50" : "",
        ignorePointer && "pointer-events-none",
        overlay.hidden && "opacity-40",
        liveDrag && "is-live",
        !entered && !liveDrag && "koma-letter-enter",
      )}
      tabIndex={selected ? 0 : -1}
      style={{
        left: `${o.x}%`,
        top: `${o.y}%`,
        width: `${o.w}%`,
        height: `${o.h}%`,
        zIndex: selected ? 120 : zIndex,
        outline: selected ? "2px solid var(--color-accent)" : "none",
        outlineOffset: 3,
        ["--type-pt" as string]: String(o.fontSize),
        ["--type-ref" as string]: String(refH),
        ["--type-lock-h" as string]: String(letterLockHeight(o.kind)),
        ["--type-box-h" as string]: String(o.h),
        ["--type-box-w" as string]: String(o.w),
        ["--letter-left" as string]: `${frame.padLeft}%`,
        ["--letter-right" as string]: `${frame.padRight}%`,
        ["--letter-top" as string]: `${frame.padTop}%`,
        ["--letter-bottom" as string]: `${frame.padBottom}%`,
      }}
      onPointerDown={(e) => onPointerDown(e, "move")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (overlay.kind === "sticker" || overlay.kind === "tone") return;
        setTextEditing(true);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        useStudio.getState().selectOverlay(overlay.id);
        setMenu((cur) => (cur ? null : { x: e.clientX, y: e.clientY }));
      }}
      onKeyDown={(e) => {
        if (textEditing) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          e.stopPropagation();
          remove();
          return;
        }
        if (overlay.kind === "sticker" || overlay.kind === "tone" || isDialogue(overlay.kind)) {
          if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            e.stopPropagation();
            useStudio.getState().updateOverlay(overlay.id, scaleOverlayBy(overlay, 0.7));
            return;
          }
          if (e.key === "=" || e.key === "+") {
            e.preventDefault();
            e.stopPropagation();
            useStudio.getState().updateOverlay(overlay.id, scaleOverlayBy(overlay, 1.4));
            return;
          }
        }
      }}
      onWheel={(e) => {
        if (!selected || overlay.locked) return;
        if (
          (overlay.kind === "sticker" || overlay.kind === "tone" || isDialogue(overlay.kind)) &&
          (e.ctrlKey || e.metaKey || e.altKey)
        ) {
          e.preventDefault();
          e.stopPropagation();
          const factor = e.deltaY < 0 ? 1.12 : 0.88;
          nudgeLive(scaleOverlayBy(liveOverlay(), factor));
          return;
        }
        if (canRotate(overlay.kind)) {
          e.preventDefault();
          e.stopPropagation();
          const step = e.shiftKey ? 1 : 5;
          nudgeLive({
            rotate: wrapDeg((liveOverlay().rotate ?? 0) + (e.deltaY < 0 ? -step : step)),
          });
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        bumpFont(e.deltaY < 0 ? 2 : -2);
      }}
    >
      {order > 0 ? (
        <span
          data-koma="script-order"
          className="pointer-events-none absolute -left-2 -top-2 z-[70] flex size-5 items-center justify-center rounded-full text-[10px] font-semibold text-paper shadow-tool"
          style={{ background: speaker?.color ?? "var(--color-ink)" }}
        >
          {order}
        </span>
      ) : null}
      <div
        className="absolute inset-0 overflow-visible"
        style={{
          transform: rot ? `rotate(${rot}deg)` : undefined,
          transformOrigin: "center center",
        }}
      >
      {overlay.kind === "sticker" ? (
        <div
          className="pointer-events-none size-full"
          style={{ opacity: overlayOpacity(overlay) }}
          data-koma="sticker-paint"
        >
          {overlay.src ? (
            <RasterMark src={overlay.src} color={overlay.color} />
          ) : overlay.sticker ? (
            <StickerMark id={overlay.sticker} color={stickerPaint(overlay.color, overlay.sticker)} />
          ) : null}
        </div>
      ) : overlay.kind === "tone" ? (
        <div
          className="pointer-events-none size-full"
          style={{ opacity: overlayOpacity(overlay) }}
        >
          <ToneMark id={overlay.tone || "speed"} color={overlay.color} />
        </div>
      ) : (
        <>
          <BubbleShape overlay={painted} showTail={showTail} paint={paintShape} />
          {overlay.kind === "sfx" &&
          (!overlay.fontId || overlay.fontId === "sfx") &&
          !selected &&
          !textEditing ? (
            <SfxHand
              text={overlay.text}
              color={overlay.color}
              fontSize={overlay.fontSize}
              refH={refH}
            />
          ) : (
            <div
              className={cn(
                "koma-letter-type z-10 min-w-0 leading-[1.15]",
                !textEditing && "pointer-events-none",
                align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center",
                overlay.kind === "sfx" && "koma-sfx-type",
              )}
              style={textStyle}
            >
              {textEditing ? (
            <textarea
              ref={textRef}
              value={overlay.text}
              rows={1}
              aria-label={`${overlay.kind} text`}
              autoComplete="off"
              autoCorrect="on"
              autoCapitalize={overlay.kind === "sfx" ? "characters" : "sentences"}
              enterKeyHint="done"
              spellCheck={overlay.kind !== "sfx"}
              onChange={(e) => {
                const el = e.currentTarget;
                // Curly quotes, ellipses and dashes land as you type; the caret stays put.
                const smart = smartEdit(el.value, el.selectionStart ?? el.value.length);
                if (smart) pendingCaret.current = smart.caret;
                // The store measures the words and sizes the balloon around them.
                useStudio.getState().updateOverlay(overlay.id, { text: smart ? smart.text : el.value });
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={() => setTextEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setTextEditing(false);
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
              wrap="soft"
              className="koma-letter-input"
              style={{
                caretColor: overlay.color,
                whiteSpace: "pre-wrap",
                overflowWrap: "break-word",
                wordBreak: "normal",
              }}
              placeholder={
                overlay.kind === "title"
                  ? "Headline"
                  : overlay.kind === "speech"
                    ? "Dialogue…"
                    : overlay.kind === "thought"
                      ? "Thought…"
                      : overlay.kind === "sfx"
                        ? "NNH"
                        : overlay.kind === "text"
                          ? "Write your copy…"
                          : "Caption…"
              }
            />
              ) : (
              <span
                className="block w-full min-w-0 max-w-full"
                style={{
                  whiteSpace: overlay.vertical ? "pre" : "pre-wrap",
                  overflowWrap: "break-word",
                  wordBreak: "normal",
                }}
              >
              {overlay.text || (
                <span className="text-faint">
                  {overlay.kind === "title"
                    ? "Headline"
                    : overlay.kind === "thought"
                      ? "Thought…"
                      : overlay.kind === "sfx"
                        ? "NNH"
                        : overlay.kind === "whisper"
                          ? "psst…"
                          : overlay.kind === "shout" || overlay.kind === "scream"
                            ? "HEY—!!"
                            : overlay.kind === "narration"
                              ? "Caption…"
                              : overlay.kind === "text"
                                ? "Write your copy…"
                                : "Dialogue…"}
                </span>
              )}
              </span>
              )}
            </div>
          )}
        </>
      )}
      </div>

      {selected && !hideBar ? (
        <div
          className="koma-ov-bar"
          data-koma="letter-bar"
          style={barStyle}
          onPointerDown={(e) => {
            e.stopPropagation();
            if ((e.target as HTMLElement).closest("button, input, textarea, select, label, [role='slider'], [data-koma='sticker-opacity']")) return;
            e.preventDefault();
          }}
        >
          {overlay.kind === "sticker" || overlay.kind === "tone" ? (
            <StickerLookBar overlay={overlay} />
          ) : null}
          {overlay.kind !== "sticker" && overlay.kind !== "tone" ? (
            <>
              <FontFamilyControl
                compact
                kind={overlay.kind}
                value={overlay.fontId}
                onChange={(fontId) =>
                  useStudio.getState().updateOverlay(overlay.id, { fontId })
                }
              />
              <button
                type="button"
                aria-label="Smaller text"
                onClick={() => bumpFont(-1)}
              >
                A−
              </button>
              <span className="koma-size min-w-12 px-0.5">
                <FontSizeControl
                  compact
                  value={o.fontSize}
                  onChange={(fontSize) => {
                    useStudio.getState().updateOverlay(overlay.id, { fontSize });
                  }}
                />
              </span>
              <button
                type="button"
                aria-label="Larger text"
                onClick={() => bumpFont(1)}
              >
                A+
              </button>
              {isDialogue(overlay.kind) ? (
                <>
                  <button
                    type="button"
                    data-koma="balloon-style"
                    aria-label="Balloon shape"
                    aria-pressed={styleOpen}
                    title="Balloon shape"
                    onClick={() => setStyleOpen((v) => !v)}
                  >
                    Shape
                  </button>
                  <button
                    type="button"
                    data-koma="flip-tail-x"
                    aria-label="Flip tail to the other speaker"
                    title="Point the tail at the other speaker (F)"
                    onClick={() =>
                      useStudio.getState().flipOverlayTail(overlay.id, "x")
                    }
                  >
                    <FlipHorizontal2 className="size-3.5" />
                    Speaker
                  </button>
                  <button
                    type="button"
                    data-koma="flip-tail-y"
                    aria-label="Point tail up or down"
                    title="Flip the tail up or down (Shift+F)"
                    onClick={() =>
                      useStudio.getState().flipOverlayTail(overlay.id, "y")
                    }
                  >
                    <FlipVertical2 className="size-3.5" />
                  </button>
                </>
              ) : null}
              {isDialogue(overlay.kind) || overlay.kind === "narration" ? (
                <BalloonPaintControls overlay={overlay} compact />
              ) : null}
              <button
                type="button"
                onClick={() => setTextEditing((v) => !v)}
              >
                {textEditing ? "Done" : "Edit text"}
              </button>
              <button
                type="button"
                aria-label="Bold"
                aria-pressed={overlay.bold}
                data-active={overlay.bold ? "true" : undefined}
                onClick={() =>
                  useStudio.getState().updateOverlay(overlay.id, { bold: !overlay.bold })
                }
              >
                <span className="font-extrabold">B</span>
              </button>
              <button
                type="button"
                aria-label="Italic"
                aria-pressed={overlay.italic}
                data-active={overlay.italic ? "true" : undefined}
                onClick={() =>
                  useStudio.getState().updateOverlay(overlay.id, { italic: !overlay.italic })
                }
              >
                <span className="italic">I</span>
              </button>
              <button
                type="button"
                aria-label="Fit text"
                onClick={() => {
                  const studio = useStudio.getState();
                  const box =
                    fitLetterBox({ ...overlay, autoFit: true }, pageAspect(studio.paperSize), "auto") ??
                    (() => {
                      const size = fitBubbleSize(overlay);
                      return {
                        ...size,
                        x: clamp(overlay.x + (overlay.w - size.w) / 2, 0, 100 - size.w),
                        y: clamp(overlay.y + (overlay.h - size.h) / 2, 0, 100 - size.h),
                      };
                    })();
                  studio.updateOverlay(overlay.id, { ...box, autoFit: true });
                }}
              >
                Fit
              </button>
              {isDialogue(overlay.kind) ? (
                <button
                  type="button"
                  data-koma="chain-balloon"
                  onClick={() =>
                    useStudio.getState().addChainedOverlay(overlay.id)
                  }
                >
                  Chain
                </button>
              ) : null}
              {chained ? (
                <button
                  type="button"
                  data-koma="unchain-balloon"
                  onClick={() =>
                    useStudio.getState().unchainOverlay(overlay.id)
                  }
                >
                  Unchain
                </button>
              ) : null}
            </>
          ) : null}
          {canRotate(overlay.kind) ? (
            <>
              <button
                type="button"
                aria-label="Rotate left"
                onClick={() =>
                  useStudio.getState().updateOverlay(overlay.id, {
                    rotate: wrapDeg((overlay.rotate ?? 0) - 15),
                  })
                }
              >
                ↺
              </button>
              <button
                type="button"
                aria-label="Rotate right"
                onClick={() =>
                  useStudio.getState().updateOverlay(overlay.id, {
                    rotate: wrapDeg((overlay.rotate ?? 0) + 15),
                  })
                }
              >
                ↻
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="is-danger"
            onClick={remove}
          >
            Delete
          </button>
        </div>
      ) : null}

      {selected && !hideBar && styleOpen && isDialogue(overlay.kind) ? (
        <div
          className="koma-style-pop"
          data-koma="balloon-style-pop"
          style={overlayPopStyle(overlay)}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <BalloonStylePicker overlay={overlay} compact onSelect={() => setStyleOpen(false)} />
        </div>
      ) : null}

      {selected &&
      showTail &&
      isDialogue(overlay.kind) &&
      balloonHasTail(balloonStyle) ? (
        <button
          type="button"
          aria-label="Move tail"
          data-koma="move-tail"
          className={cn(
            "absolute z-40 flex size-11 -translate-x-1/2 flex-col items-center bg-transparent",
            painted.tailY >= 70 ? "translate-y-0" : "-translate-y-full",
          )}
          style={{ left: `${painted.tailX}%`, top: `${painted.tailY}%` }}
          onPointerDown={(e) => onPointerDown(e, "tail")}
        >
          <span
            className={cn(
              "size-5 rounded-full bg-surface ring-2 ring-accent",
              painted.tailY >= 70 ? "mt-0.5" : "mt-auto mb-0.5",
            )}
          />
        </button>
      ) : null}

      {selected
        ? HANDLES.map((handle) => (
            <div
              key={handle}
              role="separator"
              aria-label={`Resize ${overlay.kind} ${handle}`}
              className={cn("koma-handle z-[90]", HANDLE_POS[handle])}
              style={{ cursor: HANDLE_CURSOR[handle] }}
              onPointerDown={(e) => onPointerDown(e, "resize", handle)}
            >
              <span className="koma-handle-knob" />
            </div>
          ))
        : null}

      {selected && canRotate(overlay.kind) && !overlay.locked ? (
        <>
          <span
            className={cn("koma-rotate-stem", barStyle.top !== "100%" && "is-below")}
            aria-hidden
          />
          <button
            type="button"
            aria-label="Rotate"
            data-koma="rotate-handle"
            className={cn("koma-rotate-knob", barStyle.top !== "100%" && "is-below")}
            onPointerDown={(e) => onPointerDown(e, "rotate")}
          />
        </>
      ) : null}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(overlay.kind === "sticker"
              ? []
              : [
                  {
                    label: "Edit text",
                    onClick: () => {
                      useStudio.getState().selectOverlay(overlay.id);
                      setTextEditing(true);
                    },
                  },
                  {
                    label: "Larger text",
                    keys: "+",
                    onClick: () => bumpFont(4),
                  },
                  {
                    label: "Smaller text",
                    keys: "−",
                    onClick: () => bumpFont(-4),
                  },
                  { separator: true as const },
                  ...(isDialogue(overlay.kind)
                    ? [
                        {
                          label: "Chain bubble",
                          onClick: () =>
                            useStudio.getState().addChainedOverlay(overlay.id),
                        },
                        ...(overlay.chainId
                          ? [
                              {
                                label: "Unchain bubble",
                                mark: "ctx-unchain",
                                onClick: () =>
                                  useStudio.getState().unchainOverlay(overlay.id),
                              },
                            ]
                          : []),
                        {
                          label: "Flip to other speaker",
                          mark: "ctx-flip-tail-x",
                          keys: "F",
                          onClick: () =>
                            useStudio.getState().flipOverlayTail(overlay.id, "x"),
                        },
                        {
                          label: "Flip tail up / down",
                          mark: "ctx-flip-tail-y",
                          keys: combo("F", { shift: true }),
                          onClick: () =>
                            useStudio.getState().flipOverlayTail(overlay.id, "y"),
                        },
                        { separator: true as const },
                      ]
                    : [{ separator: true as const }]),
                ]),
            {
              label: "Duplicate",
              keys: combo("D", { cmd: true }),
              onClick: () => useStudio.getState().duplicateOverlay(overlay.id),
            },
            ...(canRotate(overlay.kind)
              ? [
                  {
                    label: "Rotate 15°",
                    onClick: () =>
                      useStudio.getState().updateOverlay(overlay.id, {
                        rotate: wrapDeg((overlay.rotate ?? 0) + 15),
                      }),
                  },
                  {
                    label: "Rotate −15°",
                    onClick: () =>
                      useStudio.getState().updateOverlay(overlay.id, {
                        rotate: wrapDeg((overlay.rotate ?? 0) - 15),
                      }),
                  },
                  {
                    label: "Reset rotation",
                    onClick: () =>
                      useStudio.getState().updateOverlay(overlay.id, { rotate: 0 }),
                  },
                ]
              : []),
            { separator: true as const },
            {
              label: overlay.locked ? "Unlock" : "Lock",
              keys: combo("L", { cmd: true }),
              onClick: () => useStudio.getState().toggleOverlayLock(overlay.id),
            },
            {
              label: overlay.hidden ? "Show" : "Hide",
              keys: "H",
              onClick: () => useStudio.getState().toggleOverlayHidden(overlay.id),
            },
            { separator: true as const },
            {
              label: "Copy style",
              keys: combo("C", { cmd: true, alt: true }),
              onClick: () => useStudio.getState().copyOverlayStyle(overlay.id),
            },
            {
              label: "Paste style",
              keys: combo("V", { cmd: true, alt: true }),
              disabled: !useStudio.getState().styleClipboard,
              onClick: () => useStudio.getState().pasteOverlayStyle(overlay.id),
            },
            { separator: true as const },
            {
              label: "Move to front",
              keys: combo("]", { cmd: true, alt: true }),
              onClick: () => useStudio.getState().bringToFront(overlay.id),
            },
            {
              label: "Bring to back",
              keys: combo("[", { cmd: true, alt: true }),
              onClick: () => useStudio.getState().sendToBack(overlay.id),
            },
            { separator: true as const },
            {
              label: "Delete",
              keys: "⌫",
              danger: true,
              onClick: remove,
            },
          ]}
        />
      ) : null}
    </div>
  );
}

/** Balloon box proportions on the page, so the pen width reads evenly however the box is stretched. */
function inkBoxOf(overlay: Overlay, aspect: number): InkBox {
  return { boxW: Math.max(0.5, overlay.w * aspect), boxH: Math.max(0.5, overlay.h) };
}

function BalloonBody({
  overlay,
  inheritPaint = false,
  pass = "both",
  aspect = 1,
}: {
  overlay: Overlay;
  inheritPaint?: boolean;
  /** Chained balloons are painted in two passes over the whole chain. */
  pass?: "both" | "ink" | "paper";
  aspect?: number;
}) {
  const handInk = useStudio((s) => s.handInk);
  const style = balloonStyleOf(overlay);
  const fill = inheritPaint ? undefined : isClearPaint(overlay.fill) ? "none" : overlay.fill || "#ffffff";
  const stroke = inheritPaint ? undefined : overlay.stroke || "#161412";
  const e = balloonEllipse(style);
  if (handInk) {
    const shape = inkBody(style, inkSeed(overlay.id), inkBoxOf(overlay, aspect));
    const paperColor = inheritPaint ? undefined : fill;
    const inkColor = inheritPaint ? undefined : stroke;
    return (
      <>
        {pass !== "ink" && shape.paper && paperColor !== "none" ? (
          <path d={shape.paper} fill={paperColor} stroke="none" />
        ) : null}
        {pass !== "paper" && shape.ink ? <path d={shape.ink} fill={inkColor} stroke="none" /> : null}
        {pass !== "paper" && shape.line ? (
          <path
            d={shape.line.d}
            fill="none"
            stroke={inkColor}
            strokeWidth={shape.line.width}
            strokeDasharray={shape.line.dash}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </>
    );
  }
  const paint = inheritPaint
    ? {}
    : {
        fill,
        stroke,
        strokeWidth: style === "whisper" ? 1.8 : 2.8,
        strokeLinejoin: "round" as const,
        strokeLinecap: "round" as const,
        strokeDasharray: style === "whisper" ? "5 4" : undefined,
      };
  if (style === "cloud") return <path d={THOUGHT_CLOUD} {...paint} />;
  if (style === "burst" || style === "spike") {
    return (
      <path
        d={burstPath(style === "spike" ? 22 : 16, style === "spike" ? 0.22 : 0.16)}
        {...paint}
        strokeDasharray={undefined}
      />
    );
  }
  if (style === "rect" || style === "box") {
    return (
      <rect
        x={e.cx - e.rx}
        y={e.cy - e.ry}
        width={e.rx * 2}
        height={e.ry * 2}
        rx={style === "box" ? 6 : 11}
        {...paint}
        strokeDasharray={undefined}
      />
    );
  }
  return (
    <g {...paint}>
      <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} />
      {style === "radio" ? (
        <ellipse
          cx={e.cx}
          cy={e.cy}
          rx={e.rx * 0.82}
          ry={e.ry * 0.78}
          fill={inheritPaint ? "none" : fill}
        />
      ) : null}
    </g>
  );
}

function BubbleShape({
  overlay,
  showTail = true,
  paint = true,
}: {
  overlay: Overlay;
  showTail?: boolean;
  paint?: boolean;
}) {
  const handInk = useStudio((s) => s.handInk);
  const paperSize = useStudio((s) => s.paperSize);
  if (!paint) return null;
  const fill = isClearPaint(overlay.fill) ? "none" : overlay.fill || "#ffffff";
  const stroke = overlay.stroke || "#161412";
  if (overlay.kind === "title" || overlay.kind === "sfx" || overlay.kind === "tone" || overlay.kind === "text") return null;
  const style = balloonStyleOf(overlay);
  if (overlay.kind === "narration" && !overlay.balloonStyle && !handInk) {
    return (
      <svg
        viewBox="0 0 200 60"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        preserveAspectRatio="none"
        aria-hidden
      >
        <rect
          x="3"
          y="3"
          width="194"
          height="54"
          rx="5"
          fill={fill}
          stroke={stroke}
          strokeWidth="3"
        />
      </svg>
    );
  }
  const aspect = pageAspect(paperSize);
  const e = balloonEllipse(style);
  const g = speechTailGeom(overlay.tailX, overlay.tailY, e);
  const trail = balloonUsesTrail(style) ? thoughtTrail(overlay.tailX, overlay.tailY) : [];
  const tailOn = showTail && balloonHasTail(style);
  if (handInk) {
    const seed = inkSeed(overlay.id);
    const box = inkBoxOf(overlay, aspect);
    const puffs = trail.slice(0, showTail ? trail.length : Math.max(0, trail.length - 1));
    const tail = tailOn ? inkTail(g, seed, box) : null;
    return (
      <svg
        viewBox="-25 -60 150 240"
        className="pointer-events-none absolute overflow-visible"
        style={{ left: "-25%", top: "-60%", width: "150%", height: "240%" }}
        preserveAspectRatio="none"
        aria-hidden
      >
        <BalloonBody overlay={overlay} aspect={aspect} />
        {puffs.map((p, i) => {
          const puff = inkPuff(p, seed + 17 * (i + 1), box);
          return (
            <g key={i}>
              {fill !== "none" ? <path d={puff.paper} fill={fill} stroke="none" /> : null}
              <path d={puff.ink} fill={stroke} stroke="none" />
            </g>
          );
        })}
        {tail ? (
          <>
            {fill !== "none" ? <path d={tail.paper} fill={fill} stroke="none" /> : null}
            <path d={tail.ink} fill={stroke} stroke="none" />
          </>
        ) : null}
      </svg>
    );
  }
  return (
    <svg
      viewBox="-25 -60 150 240"
      className="pointer-events-none absolute overflow-visible"
      style={{ left: "-25%", top: "-60%", width: "150%", height: "240%" }}
      preserveAspectRatio="none"
      aria-hidden
    >
      <g
        fill={fill}
        stroke={stroke}
        strokeWidth={style === "whisper" ? 1.8 : 2.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <BalloonBody overlay={overlay} inheritPaint />
        {trail.slice(0, showTail ? trail.length : Math.max(0, trail.length - 1)).map((p, i) => (
          <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} />
        ))}
      </g>
      {tailOn ? (
        <>
          <path d={speechTailPath(g, true)} fill={fill} stroke="none" />
          <path
            d={speechTailPath(g, false)}
            fill="none"
            stroke={stroke}
            strokeWidth="2.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      ) : null}
    </svg>
  );
}

function ToneMark({ id, color }: { id: string; color: string }) {
  const ink = color || "#161412";
  if (id === "focus") {
    return (
      <svg viewBox="0 0 100 100" className="size-full overflow-visible" aria-hidden>
        {Array.from({ length: 28 }, (_, i) => {
          const a = (i / 28) * Math.PI * 2;
          return (
            <line
              key={i}
              x1={50 + Math.cos(a) * 10}
              y1={50 + Math.sin(a) * 10}
              x2={50 + Math.cos(a) * 48}
              y2={50 + Math.sin(a) * 48}
              stroke={ink}
              strokeWidth="1.4"
              opacity="0.55"
            />
          );
        })}
      </svg>
    );
  }
  if (id === "dots") {
    return (
      <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
        {Array.from({ length: 11 }, (_, y) =>
          Array.from({ length: 11 }, (_, x) => (
            <circle
              key={`${x}-${y}`}
              cx={6 + x * 9 + (y % 2 ? 4 : 0)}
              cy={6 + y * 9}
              r="1.6"
              fill={ink}
              opacity="0.5"
            />
          )),
        )}
      </svg>
    );
  }
  if (id === "blush") {
    return (
      <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <line
            key={i}
            x1={i * 9}
            y1="0"
            x2={i * 9 + 14}
            y2="100"
            stroke="#ec4899"
            strokeWidth="2"
            opacity="0.4"
          />
        ))}
      </svg>
    );
  }
  if (id === "rain") {
    return (
      <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
        {Array.from({ length: 16 }, (_, i) => (
          <line
            key={i}
            x1={i * 7}
            y1="-4"
            x2={i * 7 - 10}
            y2="104"
            stroke={ink}
            strokeWidth="1.3"
            opacity="0.5"
          />
        ))}
      </svg>
    );
  }
  if (id === "fog") {
    return (
      <svg viewBox="0 0 100 100" className="size-full overflow-visible" aria-hidden>
        {[
          [18, 82, 28, 16],
          [48, 74, 34, 18],
          [80, 80, 26, 15],
          [32, 50, 28, 17],
          [68, 46, 30, 16],
          [16, 28, 22, 14],
          [52, 24, 28, 16],
          [84, 30, 20, 13],
          [40, 8, 24, 12],
        ].map(([cx, cy, rx, ry], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill={ink}
            fillOpacity="0.2"
            stroke={ink}
            strokeWidth="1.2"
            opacity="0.7"
          />
        ))}
      </svg>
    );
  }
  if (id === "hatch") {
    return (
      <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
        {Array.from({ length: 18 }, (_, i) => (
          <line
            key={i}
            x1={i * 10 - 40}
            y1="0"
            x2={i * 10 + 40}
            y2="100"
            stroke={ink}
            strokeWidth="1.3"
            opacity="0.45"
          />
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
      {Array.from({ length: 16 }, (_, i) => (
        <line
          key={i}
          x1="8"
          y1={6 + i * 6}
          x2={70 + (i % 3) * 10}
          y2={8 + i * 6}
          stroke={ink}
          strokeWidth="1.6"
          opacity="0.55"
        />
      ))}
    </svg>
  );
}

function InkFilter({ id, scale }: { id: string; scale: number }) {
  return (
    <filter id={id} x="-22%" y="-22%" width="144%" height="144%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.05 0.09"
        numOctaves="3"
        seed="8"
        result="n"
      />
      <feDisplacementMap in="SourceGraphic" in2="n" scale={scale} />
    </filter>
  );
}

function SfxHand({
  text,
  color,
  fontSize,
  refH,
}: {
  text: string;
  color: string;
  fontSize: number;
  refH: number;
}) {
  const lines = (text || "NNH").split("\n");
  return (
    <div
      className="koma-sfx-hand pointer-events-none absolute inset-0 flex flex-col items-center justify-center overflow-visible"
      style={{
        fontFamily: "var(--font-sfx)",
        color,
        fontSize: "calc(var(--type-px) * var(--fit-scale, 1))",
        transform: "rotate(-6deg)",
        letterSpacing: "0.02em",
      }}
    >
      {lines.map((line, li) => (
        <span key={li} className="flex">
          {[...(line || " ")].map((ch, i) => {
            const wob = glyphWobble(i + li * 17, ch);
            return (
              <span
                key={`${li}-${i}`}
                style={{
                  fontSize: "1em",
                  display: "inline-block",
                  transform: `translate(${wob.dx * 0.4}px, ${wob.dy * 0.5}px) rotate(${wob.rotate - 4}deg) scale(${wob.scale}, ${wob.scale * 1.06})`,
                  WebkitTextStroke: "0.07em var(--color-paper)",
                  paintOrder: "stroke fill",
                }}
              >
                {ch}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}

function RasterMark({ src, color }: { src: string; color?: string }) {
  const tint = tintsRaster(color);
  return (
    <div className="relative size-full">
      <img
        src={src}
        alt=""
        draggable={false}
        className="size-full object-contain"
      />
      {tint ? (
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundColor: color,
            WebkitMaskImage: `url("${src}")`,
            maskImage: `url("${src}")`,
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        />
      ) : null}
    </div>
  );
}

function StickerLookBar({ overlay }: { overlay: Overlay }) {
  const pct = Math.round(overlayOpacity(overlay) * 100);
  const raster = Boolean(overlay.src);
  const current = (overlay.color || "").toLowerCase();
  const sizePct = overlay.w;
  return (
    <>
      <div className="koma-size-btns" data-koma="sticker-size">
        <button
          type="button"
          aria-label="Smaller sticker"
          title="Smaller (−)"
          onClick={() =>
            useStudio.getState().updateOverlay(overlay.id, scaleOverlayBy(overlay, 0.7))
          }
        >
          −
        </button>
        <output aria-live="polite">{sizePct < 10 ? sizePct.toFixed(1) : Math.round(sizePct)}%</output>
        <button
          type="button"
          aria-label="Larger sticker"
          title="Larger (+)"
          onClick={() =>
            useStudio.getState().updateOverlay(overlay.id, scaleOverlayBy(overlay, 1.4))
          }
        >
          +
        </button>
      </div>
      <div className="koma-swatches" data-koma="sticker-color">
        {raster ? (
          <button
            type="button"
            aria-label="Original color"
            aria-pressed={!tintsRaster(overlay.color)}
            title="Original"
            onClick={() => useStudio.getState().updateOverlay(overlay.id, { color: "" })}
          >
            <span className="koma-swatch koma-swatch-original" />
          </button>
        ) : null}
        {STICKER_COLORS.filter((c) =>
          ["#161412", "#ffffff", "#b42318", "#ec4899", "#9aa3ad"].includes(c.id),
        ).map((c) => (
          <button
            key={c.id}
            type="button"
            aria-label={c.label}
            aria-pressed={current === c.id}
            title={c.label}
            onClick={() => useStudio.getState().updateOverlay(overlay.id, { color: c.id })}
          >
            <span className="koma-swatch" style={{ background: c.id }} />
          </button>
        ))}
        <label className="koma-swatch-custom" title="Custom color">
          <span className="sr-only">Custom color</span>
          <input
            type="color"
            aria-label="Custom sticker color"
            value={tintsRaster(overlay.color) ? overlay.color : "#161412"}
            onChange={(e) =>
              useStudio.getState().updateOverlay(overlay.id, { color: e.target.value })
            }
          />
          <span
            className="koma-swatch"
            style={{ background: tintsRaster(overlay.color) ? overlay.color : "#161412" }}
          />
        </label>
      </div>
      <div className="koma-opacity" data-koma="sticker-opacity">
        <Slider
          min={0}
          max={100}
          step={1}
          value={[pct]}
          aria-label="Sticker opacity"
          onValueChange={([v]) =>
            useStudio.getState().updateOverlay(overlay.id, {
              opacity: clamp((v ?? 100) / 100, 0, 1),
            })
          }
        />
        <output aria-live="polite">{pct}%</output>
      </div>
    </>
  );
}

export function StickerMark({
  id,
  color,
  src,
}: {
  id?: StickerId;
  color?: string;
  src?: string;
}) {
  const rawId = useId();
  const fid = `mk${rawId.replace(/:/g, "")}`;
  const ink = color || "#161412";
  const f = `url(#${fid})`;
  const outline = isGlowInk(ink) ? ink : "#161412";
  const glow = glowStrength(ink);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        className="size-full object-contain"
      />
    );
  }
  if (!id) return null;
  return (
    <svg
      viewBox="0 0 100 100"
      className="size-full overflow-visible"
      aria-hidden
      suppressHydrationWarning
      style={
        glow > 0
          ? {
              filter:
                glow >= 1
                  ? `drop-shadow(0 0 3px ${ink}) drop-shadow(0 0 8px ${ink}) drop-shadow(0 0 16px #ff7ae8)`
                  : `drop-shadow(0 0 2px ${ink}) drop-shadow(0 0 5px ${ink})`,
            }
          : undefined
      }
    >
      <defs>
        <InkFilter id={fid} scale={id === "heart" ? 1.6 : 5.4} />
      </defs>
      {id === "heart" ? (
        <g filter={f} transform="rotate(16 50 54)">
          <path
            d={HEART_PATH}
            fill={ink}
            stroke={outline}
            strokeWidth={glow > 0 ? 3.4 : 4.4}
            strokeLinejoin="round"
          />
        </g>
      ) : id === "exclaim" ? (
        <g filter={f} fill={ink} transform="rotate(-6 50 50)">
          <path d="M46 6 C58 5 62 10 57 18 L51 62 C50 66 47 66 46 62 L40 20 C38 10 42 6 46 6 Z" />
          <ellipse cx="49" cy="84" rx="10" ry="9" transform="rotate(-8 49 84)" />
        </g>
      ) : id === "star" ? (
        <path
          d="M50 6 L59 36 L92 34 L66 54 L78 88 L48 70 L20 90 L30 56 L6 36 L40 38 Z"
          fill={ink}
          stroke={outline}
          strokeWidth="4"
          strokeLinejoin="round"
          filter={f}
          transform="rotate(-8 50 50)"
        />
      ) : id === "anger" ? (
        <g filter={f} stroke={ink} strokeWidth="8" strokeLinecap="round">
          <path d="M22 22 L42 42 M78 22 L58 42 M22 78 L42 58 M78 78 L58 58" />
        </g>
      ) : id === "sweat" ? (
        <path
          d="M50 8 C78 40 78 70 50 88 C22 70 22 40 50 8 Z"
          fill={ink}
          stroke={outline}
          strokeWidth="4"
          filter={f}
        />
      ) : id === "notes" ? (
        <g filter={f} fill={ink} fontFamily="serif" fontWeight="700" fontSize="42">
          <text x="28" y="62">
            ♪
          </text>
          <text x="58" y="48">
            ♫
          </text>
        </g>
      ) : id === "question" ? (
        <text
          x="50"
          y="68"
          textAnchor="middle"
          fontFamily="var(--font-comic)"
          fontWeight="700"
          fontSize="72"
          fill={ink}
          filter={f}
        >
          ?
        </text>
      ) : id === "sparkle" ? (
        <g filter={f} fill={ink} transform="rotate(-11 50 50)">
          <path d="M48 2 L56 38 L94 46 L56 56 L50 98 L42 56 L6 48 L42 38 Z" />
          <path d="M78 16 L82 28 L94 30 L82 34 L78 46 L74 34 L62 30 L74 28 Z" />
        </g>
      ) : id === "blush" ? (
        <g filter={f} stroke={ink} strokeWidth="7" strokeLinecap="round">
          <path d="M8 38 L28 22 M10 56 L32 38 M12 74 L34 56 M92 38 L72 22 M90 56 L68 38 M88 74 L66 56" />
        </g>
      ) : id === "tear" ? (
        <path
          d="M50 6 C78 40 74 78 50 94 C26 78 22 40 50 6 Z"
          fill={ink}
          stroke={outline}
          strokeWidth="4"
          filter={f}
        />
      ) : id === "dizzy" ? (
        <path
          d="M58 50 A8 8 0 1 1 50 42 A18 18 0 1 1 42 62 A30 30 0 1 1 70 38 A42 42 0 1 1 30 70"
          fill="none"
          stroke={ink}
          strokeWidth="8"
          strokeLinecap="round"
          filter={f}
        />
      ) : id === "sleep" ? (
        <g filter={f} fill="none" stroke={ink} strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 82 L42 80 L18 56 L46 54" strokeWidth="7" />
          <path d="M34 60 L66 56 L38 30 L72 26" strokeWidth="8" />
          <path d="M52 36 L90 30 L56 6 L96 2" strokeWidth="9" />
        </g>
      ) : id === "burst" ? (
        <path
          d="M50 8 L58 38 L90 22 L68 50 L96 58 L68 66 L90 88 L58 72 L50 98 L42 72 L12 88 L32 66 L4 58 L32 50 L12 22 L42 38 Z"
          fill={ink}
          filter={f}
        />
      ) : id === "shock" ? (
        <g filter={f} stroke={ink} strokeWidth="8" strokeLinecap="round">
          <path d="M22 15 L22 85 M40 5 L40 95 M60 8 L60 92 M78 19 L78 81" />
        </g>
      ) : id === "vein" ? (
        <g
          filter={f}
          fill="none"
          stroke={ink}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M24 14 Q46 42 50 54 Q56 40 80 12" strokeWidth="9.5" />
          <path d="M50 50 Q51 72 49 92" strokeWidth="8.5" />
          <path d="M36 26 Q50 44 66 24" strokeWidth="6" />
          <circle cx="50" cy="50" r="4.5" fill={ink} stroke="none" />
        </g>
      ) : id === "gloom" ? (
        <g filter={f} stroke={ink} strokeWidth="7" strokeLinecap="round">
          <path d="M22 18 L32 36 M48 10 L58 28 M74 20 L84 38 M30 48 L40 66 M62 42 L72 60 M40 72 L50 90 M70 68 L80 86" />
        </g>
      ) : id === "temper" ? (
        <g filter={f} strokeLinejoin="round" strokeLinecap="round">
          <path
            d="M50 22 L62 48 L92 44 L68 64 L80 94 L50 76 L20 94 L32 64 L8 44 L38 48 Z"
            fill={ink}
            fillOpacity="0.2"
            stroke={ink}
            strokeWidth="5"
          />
          <path d="M18 58 L42 78 L78 22" fill="none" stroke={ink} strokeWidth="6" />
          <ellipse cx="28" cy="16" rx="10" ry="7" transform="rotate(-16 28 16)" fill="#f3eee6" stroke={outline} strokeWidth="4" />
          <ellipse cx="48" cy="8" rx="12" ry="8" fill="#f3eee6" stroke={outline} strokeWidth="4" />
          <ellipse cx="70" cy="14" rx="9" ry="6" transform="rotate(12 70 14)" fill="#f3eee6" stroke={outline} strokeWidth="4" />
        </g>
      ) : id === "flower" ? (
        <g filter={f} stroke={outline} strokeWidth="3">
          <ellipse cx="50" cy="28" rx="14" ry="16" fill={ink} />
          <ellipse cx="72" cy="42" rx="16" ry="14" fill={ink} />
          <ellipse cx="64" cy="70" rx="14" ry="16" fill={ink} />
          <ellipse cx="36" cy="70" rx="14" ry="16" fill={ink} />
          <ellipse cx="28" cy="42" rx="16" ry="14" fill={ink} />
          <circle cx="50" cy="50" r="10" fill="#eab308" />
        </g>
      ) : id === "skull" ? (
        <g filter={f} stroke={outline} strokeWidth="4" strokeLinejoin="round">
          <path
            d="M22 44 C22 22 78 22 78 44 L78 62 L70 78 L30 78 L22 62 Z"
            fill={ink === "#161412" ? "#f3eee6" : ink}
          />
          <ellipse cx="38" cy="46" rx="8" ry="10" fill={outline} />
          <ellipse cx="62" cy="46" rx="8" ry="10" fill={outline} />
          <path d="M42 70 L42 78 M50 70 L50 78 M58 70 L58 78" fill="none" />
        </g>
      ) : id === "sigh" ? (
        <g filter={f} fill="#fff" stroke={ink} strokeWidth="4">
          <ellipse cx="36" cy="64" rx="18" ry="14" transform="rotate(-16 36 64)" />
          <ellipse cx="58" cy="46" rx="16" ry="12" transform="rotate(12 58 46)" />
          <ellipse cx="72" cy="28" rx="12" ry="10" />
        </g>
      ) : id === "focus" ? (
        <g filter={f} stroke={ink} strokeWidth="5" strokeLinecap="round">
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i * Math.PI) / 8;
            return (
              <path
                key={i}
                d={`M ${50 + Math.cos(a) * 12} ${50 + Math.sin(a) * 12} L ${50 + Math.cos(a) * 48} ${50 + Math.sin(a) * 48}`}
              />
            );
          })}
        </g>
      ) : id === "bang" ? (
        <path
          d="M8 42 L22 38 L28 8 L46 32 L72 12 L64 40 L94 48 L66 58 L78 88 L52 70 L40 94 L36 66 L10 78 L26 54 Z"
          fill="#fff"
          stroke={ink}
          strokeWidth="4"
          strokeLinejoin="round"
          filter={f}
        />
      ) : id === "dots" ? (
        <g filter={f} fill={ink}>
          <circle cx="22" cy="58" r="8" />
          <circle cx="50" cy="58" r="8" />
          <circle cx="78" cy="58" r="8" />
        </g>
      ) : id === "twitch" ? (
        <g filter={f} stroke={ink} strokeWidth="8" strokeLinecap="round">
          <path d="M32 20 L32 80 M68 20 L68 80 M68 20 L82 12" />
        </g>
      ) : id === "rage" ? (
        <g filter={f} fill="none" stroke={ink} strokeLinejoin="round" strokeLinecap="round">
          <path d={RAGE_PATH} strokeWidth="6" />
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2 + 0.12;
            const inner = 14 + (i % 3) * 2;
            const outer = 44 + (i % 2) * 8;
            return (
              <path
                key={i}
                d={`M ${50 + Math.cos(a) * inner} ${50 + Math.sin(a) * inner} L ${50 + Math.cos(a) * outer} ${50 + Math.sin(a) * outer}`}
                strokeWidth={i % 2 ? 3.5 : 6}
              />
            );
          })}
        </g>
      ) : id === "scowl" ? (
        <g filter={f} fill="none" stroke={ink} strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 44 Q30 14 48 40" strokeWidth="9" />
          <path d="M92 44 Q70 14 52 40" strokeWidth="9" />
          <path d="M72 10 L86 24 M86 10 L72 24" strokeWidth="7" />
        </g>
      ) : id === "fury" ? (
        <g filter={f} stroke={ink} strokeLinecap="round">
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2 + 0.18;
            const inner = 10 + (i % 3) * 4;
            const outer = 38 + (i % 4) * 10;
            const x1 = (50 + Math.cos(a) * inner).toFixed(2);
            const y1 = (50 + Math.sin(a) * inner).toFixed(2);
            const x2 = (50 + Math.cos(a) * outer).toFixed(2);
            const y2 = (50 + Math.sin(a) * outer).toFixed(2);
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} L ${x2} ${y2}`}
                strokeWidth={i % 2 ? 5 : 8}
              />
            );
          })}
        </g>
      ) : id === "crossvein" ? (
        <g filter={f} fill={ink} stroke={ink} strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 18 L50 50 L78 16 M18 78 L50 50 L84 80" fill="none" strokeWidth="11" />
          <path d="M50 12 L50 90" fill="none" strokeWidth="8" />
          <circle cx="50" cy="50" r="5" stroke="none" />
        </g>
      ) : id === "spike" ? (
        <g filter={f} fill={ink} fillOpacity="0.18" stroke={ink} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
          <path d="M38 94 L46 54 L32 50 L62 6 L52 48 L68 52 Z" />
          <path d="M12 78 L22 48 L10 44 L34 18 L24 46 L38 50 Z" />
          <path d="M78 82 L80 50 L70 48 L92 16 L84 48 L96 52 Z" />
        </g>
      ) : id === "clench" ? (
        <g filter={f} fill="#f3eee6" stroke={ink} strokeLinejoin="round">
          <rect x="14" y="36" width="72" height="32" rx="6" strokeWidth="5" />
          <path d="M32 38 L32 66 M44 38 L44 66 M56 38 L56 66 M68 38 L68 66 M18 52 L82 52" fill="none" strokeWidth="4" />
        </g>
      ) : id === "steam" ? (
        <g filter={f} fill="#f3eee6" stroke={ink} strokeWidth="4">
          <ellipse cx="28" cy="78" rx="15" ry="11" transform="rotate(-20 28 78)" />
          <ellipse cx="48" cy="54" rx="13" ry="10" transform="rotate(10 48 54)" />
          <ellipse cx="66" cy="32" rx="11" ry="8" transform="rotate(8 66 32)" />
          <ellipse cx="80" cy="14" rx="8" ry="6" transform="rotate(12 80 14)" />
        </g>
      ) : id === "boil" ? (
        <g filter={f} fill="none" stroke={ink} strokeLinecap="round">
          <path d="M22 88 C18 60 34 50 30 22 M50 90 C44 58 62 48 56 12 M78 86 C84 58 68 46 74 18" strokeWidth="6" />
          <path d="M70 8 L84 22 M84 8 L70 22" strokeWidth="7" />
        </g>
      ) : id === "puff" ? (
        <g filter={f} stroke={ink} strokeLinecap="round">
          <ellipse cx="24" cy="62" rx="20" ry="16" transform="rotate(-12 24 62)" fill={ink} fillOpacity="0.32" strokeWidth="6" />
          <ellipse cx="76" cy="62" rx="20" ry="16" transform="rotate(12 76 62)" fill={ink} fillOpacity="0.32" strokeWidth="6" />
          <path d="M10 54 L22 42 M14 66 L28 52 M78 42 L90 54 M72 52 L86 66" fill="none" strokeWidth="5" />
        </g>
      ) : id === "huff" ? (
        <g filter={f} fill="#f3eee6" stroke={ink} strokeWidth="5" strokeLinejoin="round">
          <path d="M18 62 C8 40 28 18 48 28 C62 12 86 24 78 44 C96 52 84 78 62 70 C48 82 22 78 18 62 Z" />
          <path d="M28 54 Q44 64 58 52" fill="none" />
        </g>
      ) : id === "heat" ? (
        <g filter={f} fill="none" stroke={ink} strokeWidth="7" strokeLinecap="round">
          <path d="M24 94 C8 70 40 52 18 22 C8 10 28 8 24 4 M50 96 C32 70 68 48 46 16 C38 4 56 6 52 2 M76 92 C94 68 62 46 82 18 C92 8 74 6 78 4" />
        </g>
      ) : id === "haze" ? (
        <g filter={f} fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round">
          <path d="M14 82 C25 70 40 92 50 82 M28 60 C40 48 56 72 70 60 M16 38 C28 26 42 50 54 38 M34 16 C46 4 56 28 66 16" />
        </g>
      ) : id === "breath" || id === "pant" || id === "vapor" ? (
        <g filter={f} fill="#f3eee6" stroke={ink} strokeWidth="4">
          {id === "pant" ? (
            <>
              <ellipse cx="18" cy="82" rx="16" ry="11" transform="rotate(-24 18 82)" />
              <ellipse cx="36" cy="62" rx="13" ry="9" transform="rotate(-18 36 62)" />
              <ellipse cx="54" cy="44" rx="11" ry="8" transform="rotate(-10 54 44)" />
              <ellipse cx="70" cy="26" rx="9" ry="6" transform="rotate(-6 70 26)" />
              <ellipse cx="84" cy="12" rx="7" ry="5" />
            </>
          ) : (
            <>
              <ellipse cx="16" cy="84" rx="17" ry="12" transform="rotate(-24 16 84)" />
              <ellipse cx="38" cy="62" rx="14" ry="10" transform="rotate(-16 38 62)" />
              <ellipse cx="58" cy="42" rx="12" ry="8" transform="rotate(-10 58 42)" />
              <ellipse cx="76" cy="22" rx="9" ry="7" transform="rotate(-4 76 22)" />
            </>
          )}
          {id === "vapor" ? (
            <g fill="#ff3d6e" stroke="none">
              <path d={HEART_PATH} transform="translate(78 2) scale(0.16)" />
              <path d={HEART_PATH} transform="translate(62 28) scale(0.11)" />
            </g>
          ) : null}
        </g>
      ) : id === "smell" || id === "scent" ? (
        <g filter={f} fill="none" stroke={ink} strokeWidth="6" strokeLinecap="round">
          <path d="M18 90 C4 58 38 48 16 18 C8 6 28 8 22 4 M50 94 C28 62 72 44 46 10 M82 88 C98 56 64 38 86 12" />
          {id === "scent" ? (
            <path d={HEART_PATH} transform="translate(64 2) scale(0.2)" fill={ink} stroke="none" />
          ) : null}
        </g>
      ) : id === "stink" ? (
        <g filter={f} stroke={ink} strokeWidth="6" strokeLinecap="round">
          <ellipse cx="38" cy="74" rx="24" ry="16" transform="rotate(-16 38 74)" fill={ink} fillOpacity="0.22" stroke="none" />
          <ellipse cx="66" cy="56" rx="20" ry="14" transform="rotate(12 66 56)" fill={ink} fillOpacity="0.22" stroke="none" />
          <path d="M24 92 C6 50 42 34 14 6 M50 94 C74 52 26 28 56 4 M78 86 C100 48 58 24 88 8" fill="none" />
          <path d="M70 12 L84 26 M84 12 L70 26" fill="none" strokeWidth="5" />
        </g>
      ) : id === "fume" ? (
        <path
          d="M60 62 A10 10 0 1 1 42 68 A18 18 0 1 1 68 44 A28 28 0 1 1 30 48"
          fill="none"
          stroke={ink}
          strokeWidth="7"
          strokeLinecap="round"
          filter={f}
        />
      ) : id === "sniff" ? (
        <g filter={f} fill="none" stroke={ink} strokeWidth="6" strokeLinecap="round">
          <path d="M12 78 Q40 70 82 28 M18 58 Q44 54 80 22 M22 38 Q46 36 78 16" />
        </g>
      ) : id === "spicy" ? (
        <path
          d="M48 96 Q18 62 42 28 Q36 48 52 58 Q46 22 62 8 Q58 40 72 52 Q86 36 70 96 Z"
          fill={ink}
          stroke={outline}
          strokeWidth="4"
          strokeLinejoin="round"
          filter={f}
        />
      ) : id === "drool" ? (
        <g filter={f} fill={ink} stroke={outline} strokeWidth="4">
          <path d="M42 8 C78 28 74 70 50 96 C28 70 22 28 42 8 Z" />
          <ellipse cx="68" cy="18" rx="7" ry="6" transform="rotate(16 68 18)" />
        </g>
      ) : id === "nosebleed" ? (
        <g filter={f} fill={ink}>
          <path d="M58 8 Q86 36 48 96 Q38 54 46 28 Q28 40 58 8 Z" />
          <ellipse cx="70" cy="22" rx="8" ry="6" transform="rotate(22 70 22)" />
        </g>
      ) : id === "shiver" ? (
        <g filter={f} fill="none" stroke={ink} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 28 L8 40 L20 52 L8 64 L18 76 M82 28 L92 40 L80 52 L92 64 L82 76" />
        </g>
      ) : id === "throb" ? (
        <g filter={f} fill="none" stroke={ink}>
          <ellipse cx="50" cy="52" rx="22" ry="18" strokeWidth="6" />
          <ellipse cx="50" cy="52" rx="34" ry="28" strokeWidth="4" />
          <path d={HEART_PATH} transform="translate(38 38) scale(0.24)" fill={ink} stroke="none" />
        </g>
      ) : id === "jets" ? (
        <g filter={f} fill="none" stroke={ink} strokeLinecap="round">
          <path d="M36 92 C22 64 44 44 24 16 M64 92 C78 64 56 44 76 16" strokeWidth="6" />
          <ellipse cx="22" cy="12" rx="9" ry="7" transform="rotate(-16 22 12)" fill="#f3eee6" strokeWidth="4" />
          <ellipse cx="78" cy="12" rx="9" ry="7" transform="rotate(16 78 12)" fill="#f3eee6" strokeWidth="4" />
        </g>
      ) : id === "haa" ? (
        <g filter={f} fill={ink} fontFamily="var(--font-sfx)" fontSize="28">
          <text x="34" y="74" textAnchor="middle" transform="rotate(-16 34 70)">HAA</text>
          <text x="70" y="36" textAnchor="middle" transform="rotate(-8 70 32)">HAA</text>
        </g>
      ) : id === "kiss" ? (
        <g filter={f} fill={ink} stroke={outline} strokeWidth="4" strokeLinejoin="round">
          <path d="M18 48 C28 28 50 22 50 40 C50 22 72 28 82 48 C70 44 58 52 50 62 C42 52 30 44 18 48 Z" />
          <path d="M22 50 C36 58 50 46 50 46 C50 46 64 58 78 50" fill="none" />
        </g>
      ) : id === "hearts" ? (
        <g filter={f} fill={ink} stroke="none">
          <path d={HEART_PATH} transform="translate(8 48) rotate(-12 50 50) scale(0.38)" />
          <path d={HEART_PATH} transform="translate(38 22) rotate(8 50 50) scale(0.28)" />
          <path d={HEART_PATH} transform="translate(64 4) rotate(-6 50 50) scale(0.2)" />
        </g>
      ) : id === "flush" ? (
        <g filter={f} fill={ink} fillOpacity="0.45" stroke={ink} strokeWidth="4">
          <ellipse cx="22" cy="52" rx="16" ry="20" transform="rotate(8 22 52)" />
          <ellipse cx="78" cy="52" rx="16" ry="20" transform="rotate(-8 78 52)" />
        </g>
      ) : id === "drip" ? (
        <g filter={f}>
          <path d="M50 6 C78 36 78 70 50 96 C22 70 22 36 50 6 Z" fill={ink} stroke={outline} strokeWidth="4" />
          <ellipse cx="40" cy="40" rx="6" ry="10" transform="rotate(-22 40 40)" fill="#fff" stroke="none" />
        </g>
      ) : id === "saliva" ? (
        <g filter={f} fill={ink} stroke={ink} strokeWidth="6" strokeLinecap="round">
          <path d="M28 8 C18 40 70 48 48 78" fill="none" />
          <ellipse cx="48" cy="88" rx="9" ry="11" stroke={outline} strokeWidth="3" />
        </g>
      ) : id === "swirl" ? (
        <g filter={f} fill="none" stroke={ink} strokeWidth="6" strokeLinecap="round">
          <path d="M78 22 C96 40 84 72 54 78 C18 86 10 48 34 36 C54 26 62 52 44 56" />
          <path d={HEART_PATH} transform="translate(70 6) scale(0.16)" fill={ink} stroke="none" />
        </g>
      ) : id === "skunk" ? (
        <g filter={f} stroke={ink} strokeWidth="5" strokeLinecap="round">
          <path d="M22 88 C8 50 40 34 18 8 M50 90 C70 52 28 30 52 6 M78 84 C96 48 62 28 84 10" fill="none" />
          <path d="M34 58 A16 16 0 0 1 66 58 L64 70 L58 80 L42 80 L36 70 Z" fill="#f3eee6" stroke={outline} strokeWidth="4" />
          <ellipse cx="44" cy="60" rx="3.5" ry="4.5" fill={outline} stroke="none" />
          <ellipse cx="56" cy="60" rx="3.5" ry="4.5" fill={outline} stroke="none" />
        </g>
      ) : id === "aroma" ? (
        <g filter={f} stroke={ink} strokeLinecap="round">
          <path d="M22 88 C8 56 40 44 24 16 M50 90 C34 58 68 40 52 12" fill="none" strokeWidth="5" />
          <g fill={ink} stroke={outline} strokeWidth="3">
            <ellipse cx="72" cy="8" rx="7" ry="5" />
            <ellipse cx="82" cy="16" rx="7" ry="5" />
            <ellipse cx="78" cy="26" rx="7" ry="5" />
            <ellipse cx="66" cy="26" rx="7" ry="5" />
            <ellipse cx="62" cy="16" rx="7" ry="5" />
            <circle cx="72" cy="18" r="4" fill="#eab308" />
          </g>
        </g>
      ) : id === "lust" ? (
        <g filter={f} fill="none" stroke={ink} strokeWidth="6" strokeLinecap="round">
          <path d="M22 94 C8 66 36 48 16 18 M50 96 C34 68 66 46 48 12 M78 90 C94 64 62 42 84 16" />
          <path d={HEART_PATH} transform="translate(38 36) scale(0.26)" fill="#ff3d6e" stroke="none" />
        </g>
      ) : id === "phew" ? (
        <g filter={f} fill="#f3eee6" stroke={ink} strokeWidth="4">
          <ellipse cx="36" cy="72" rx="20" ry="14" transform="rotate(-16 36 72)" />
          <ellipse cx="58" cy="42" rx="16" ry="12" transform="rotate(8 58 42)" />
          <ellipse cx="74" cy="16" rx="11" ry="9" />
        </g>
      ) : id === "chomp" ? (
        <g filter={f} fill="none" stroke={ink} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 38 L28 58 L44 32 L60 62 L76 30 L90 52" />
          <path d="M18 78 L32 58 L48 82 L64 56 L80 80" />
        </g>
      ) : id === "scratch" ? (
        <g filter={f} fill="none" stroke={ink} strokeWidth="7" strokeLinecap="round">
          <path d="M18 78 Q40 40 86 16 M12 62 Q38 30 82 8 M22 92 Q46 52 90 28" />
        </g>
      ) : id === "wet" ? (
        <g filter={f} fill={ink} stroke={outline} strokeWidth="3.5">
          <path d="M32 46 C46 62 42 78 32 80 C22 78 18 62 32 46 Z" />
          <path d="M58 26 C68 38 66 50 58 52 C50 50 48 38 58 26 Z" />
          <path d="M74 10 C81 18 80 26 74 28 C68 26 67 18 74 10 Z" />
        </g>
      ) : id === "moan" ? (
        <g filter={f} fill="none" stroke={ink} strokeWidth="8" strokeLinecap="round">
          <path d="M12 78 C28 58 44 96 60 78 M22 48 C38 28 54 66 72 46 M34 20 C50 2 66 38 86 18" />
        </g>
      ) : id === "fog" || id === "mist" || id === "shower" || id === "bank" ? (
        <g filter={f} fill="#f3eee6" stroke={ink} strokeWidth={id === "mist" ? 3.2 : 3.8}>
          {(id === "bank"
            ? [
                [16, 72, 22, 14, -12],
                [42, 60, 26, 16, 8],
                [70, 66, 24, 15, 6],
                [90, 76, 16, 11, -8],
                [54, 80, 20, 12, 2],
              ]
            : id === "shower"
              ? [
                  [20, 88, 22, 12, -12],
                  [48, 90, 26, 13, 6],
                  [76, 86, 22, 12, 10],
                  [14, 68, 16, 11, -8],
                  [36, 70, 18, 12, 6],
                  [58, 66, 20, 13, -5],
                  [80, 64, 16, 11, 8],
                  [28, 48, 15, 11, -10],
                  [52, 44, 18, 12, 4],
                  [74, 42, 14, 10, 8],
                  [40, 26, 13, 9, -6],
                  [62, 22, 12, 8, 5],
                  [50, 10, 10, 7, 2],
                ]
              : id === "mist"
                ? [
                    [24, 74, 20, 12, -10],
                    [52, 62, 22, 13, 6],
                    [78, 70, 18, 11, 5],
                    [38, 42, 18, 12, -5],
                    [66, 34, 16, 10, 8],
                    [48, 18, 14, 9, -4],
                  ]
                : [
                    [22, 80, 24, 14, -10],
                    [50, 72, 28, 16, 6],
                    [78, 78, 22, 13, 8],
                    [34, 52, 22, 14, -6],
                    [66, 46, 24, 15, 8],
                    [18, 36, 16, 11, 4],
                    [82, 32, 18, 12, -5],
                    [48, 24, 22, 13, 2],
                    [30, 12, 14, 9, -6],
                    [70, 10, 16, 10, 5],
                  ]
          ).map(([cx, cy, rx, ry, rot], i) => (
            <ellipse
              key={i}
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              transform={`rotate(${rot} ${cx} ${cy})`}
              fillOpacity={id === "mist" ? 0.55 : 0.82}
            />
          ))}
        </g>
      ) : id === "haha" || id === "giggle" || id === "hee" || id === "wara" ? (
        <g filter={f} fill={ink} fontFamily="var(--font-sfx)" fontSize={id === "wara" ? 36 : 30}>
          <text x="50" y="62" textAnchor="middle" transform="rotate(-8 50 50)">
            {id === "haha" ? "HAHA" : id === "giggle" ? "hee" : id === "hee" ? "HEH" : "LOL"}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

function ChainBody({ overlay, pass, aspect }: { overlay: Overlay; pass: "ink" | "paper"; aspect: number }) {
  const style = balloonStyleOf(overlay);
  return (
    <g
      transform={`translate(${overlay.x} ${overlay.y}) scale(${overlay.w / 100} ${overlay.h / 100})`}
      strokeDasharray={style === "whisper" ? "1.4 1.1" : undefined}
    >
      <BalloonBody overlay={overlay} inheritPaint pass={pass} aspect={aspect} />
    </g>
  );
}

export function ChainLayer({
  group,
  zIndex = 79,
}: {
  group: Overlay[];
  zIndex?: number;
}) {
  const handInk = useStudio((s) => s.handInk);
  const paperSize = useStudio((s) => s.paperSize);
  const aspect = pageAspect(paperSize);
  const fill = group[0]?.fill || "#ffffff";
  const stroke = group[0]?.stroke || "#161412";
  const necks = group.slice(0, -1).map((a, i) => ({ a, b: group[i + 1]! }));
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      style={{ zIndex }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      data-koma="chain-layer"
    >
      {/* Ink pass: hand-drawn ribbons are filled with the ink colour; clean lines are stroked. */}
      <g
        fill={handInk ? stroke : "none"}
        stroke={stroke}
        strokeWidth="1.05"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {necks.map(({ a, b }) => (
          <path key={`ns-${a.id}`} d={chainConnectorPath(a, b)} fill="none" />
        ))}
        {group.map((o) => (
          <ChainBody key={`bs-${o.id}`} overlay={o} pass="ink" aspect={aspect} />
        ))}
      </g>
      <g fill={fill} stroke="none">
        {necks.map(({ a, b }) => (
          <path key={`nf-${a.id}`} d={chainConnectorPath(a, b)} />
        ))}
        {group.map((o) => (
          <ChainBody key={`bf-${o.id}`} overlay={o} pass="paper" aspect={aspect} />
        ))}
      </g>
    </svg>
  );
}
/** Only the bubble being edited re-renders on a store update; its props are primitives plus its own overlay. */
export const Bubble = memo(BubbleInner);
