import { useEffect, useRef, useState } from "react";
import type { ImageTool, LaidOutPanel, PanelState, ResizeHandle } from "@/lib/manga/types";
import { HANDLE_CURSOR } from "@/lib/manga/resize";
import { cn, clamp } from "@/lib/utils";
import {
  clampImageZoom,
  fittedImageCss,
  imageFilter,
  imageFlipRotate,
  imageTransform,
  tiltCover,
} from "@/lib/manga/image";
import { pageAspect } from "@/lib/manga/paper";
import { useStudio } from "@/lib/manga/store";
import { wrapDeg } from "@/lib/manga/lettering";

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

const EDGE_STRIPS: { id: ResizeHandle; className: string }[] = [
  { id: "n", className: "koma-edge koma-edge-n" },
  { id: "s", className: "koma-edge koma-edge-s" },
  { id: "e", className: "koma-edge koma-edge-e" },
  { id: "w", className: "koma-edge koma-edge-w" },
];

type Props = {
  box: LaidOutPanel;
  panel: PanelState;
  selected: boolean;
  pending: boolean;
  showNumber: boolean;
  borderPct: number;
  onSelect: () => void;
  onOpenFile: () => void;
  onArmFile?: () => void;
  onDropSrc: (src: string, file?: File, asBackground?: boolean) => void;
  onDropBackground?: (src: string) => void;
  onPan: (focusX: number, focusY: number) => void;
  onZoom: (zoom: number) => void;
  onResizePointerDown: (e: React.PointerEvent, handle: ResizeHandle) => void;
  onMovePointerDown?: (e: React.PointerEvent) => void;
  onAbortMove?: () => void;
  onEdit: () => void;
  onLiftMove?: (x: number, y: number) => void;
  onLiftEnd?: (x: number, y: number) => void;
  onContextMenu?: (x: number, y: number) => void;
  editing?: boolean;
  arranging?: boolean;
  lifting?: boolean;
  imageTool?: ImageTool;
  readOnly?: boolean;
};

function panModifier(e: { ctrlKey: boolean; metaKey: boolean }) {
  return e.ctrlKey || e.metaKey;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function PanelFrame({
  box,
  panel,
  selected,
  pending,
  showNumber,
  borderPct,
  onSelect,
  onOpenFile,
  onArmFile,
  onDropSrc,
  onDropBackground,
  onPan,
  onZoom,
  onResizePointerDown,
  onMovePointerDown,
  onAbortMove,
  onEdit,
  onLiftMove,
  onLiftEnd,
  onContextMenu,
  editing = false,
  arranging = false,
  lifting = false,
  imageTool = "frame",
  readOnly = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    fx: number;
    fy: number;
    moved: boolean;
    pointerId: number;
    mode: "pan" | "lift" | "relocate";
    started?: boolean;
  } | null>(null);
  const scale = useRef<{
    pointerId: number;
    zoom: number;
    dist: number;
    cx: number;
    cy: number;
  } | null>(null);
  const lastTap = useRef(0);
  const hold = useRef<number | null>(null);
  const holdFrom = useRef({ x: 0, y: 0 });
  const openedMenu = useRef(false);
  const spin = useRef<{
    pointerId: number;
    x: number;
    y: number;
    cx: number;
    cy: number;
    rot: number;
  } | null>(null);

  function cancelHold() {
    if (hold.current != null) {
      window.clearTimeout(hold.current);
      hold.current = null;
    }
  }

  function openMenu(x: number, y: number) {
    openedMenu.current = true;
    cancelHold();
    drag.current = null;
    onAbortMove?.();
    onContextMenu?.(x, y);
  }

  const image = panel.image;
  const background = panel.background ?? null;
  const paperSize = useStudio((s) => s.paperSize);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  useEffect(() => {
    setNatural({ w: 0, h: 0 });
  }, [image?.src]);
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const apply = () => {
      if (el.naturalWidth && el.naturalHeight) {
        setNatural({ w: el.naturalWidth, h: el.naturalHeight });
      }
    };
    if (el.complete) apply();
    else el.addEventListener("load", apply, { once: true });
    return () => el.removeEventListener("load", apply);
  }, [image?.src]);
  const panelAspect = (box.w / Math.max(box.h, 0.001)) * pageAspect(paperSize);
  const fitted = image
    ? fittedImageCss(
        natural.w,
        natural.h,
        panelAspect,
        image.fit,
        image.zoom,
        image.focusX,
        image.focusY,
      )
    : null;

  function handlePointerDown(e: React.PointerEvent) {
    if (readOnly) return;
    if (e.button !== 0) return;
    openedMenu.current = false;
    cancelHold();
    const now = Date.now();
    const isDouble = now - lastTap.current < 480;
    lastTap.current = now;
    if (isDouble && !panModifier(e)) {
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      drag.current = null;
      if (image) onEdit();
      else {
        onArmFile?.();
        onOpenFile();
      }
      return;
    }

    if (image && panModifier(e)) {
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      cancelHold();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        fx: image.focusX,
        fy: image.focusY,
        moved: false,
        pointerId: e.pointerId,
        mode: "pan",
      };
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      return;
    }

    onSelect();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    holdFrom.current = { x: e.clientX, y: e.clientY };
    hold.current = window.setTimeout(() => {
      openMenu(holdFrom.current.x, holdFrom.current.y);
    }, 520);

    const edge = selected && image && !arranging ? edgeHandleAt(e) : null;
    if (edge && imageTool !== "crop") {
      startResize(e, edge);
      return;
    }

    if (arranging && onMovePointerDown && imageTool !== "crop") {
      onMovePointerDown(e);
      return;
    }

    if (image && pointers.current.size === 2 && editing) {
      const pts = [...pointers.current.values()];
      pinch.current = { dist: dist(pts[0]!, pts[1]!), zoom: image.zoom };
      drag.current = null;
      cancelHold();
      try {
        rootRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    if (!image) {
      if (panel.locked || !onMovePointerDown) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        fx: 0,
        fy: 0,
        moved: false,
        pointerId: e.pointerId,
        mode: "relocate",
        started: true,
      };
      onMovePointerDown(e);
      return;
    }

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      fx: image.focusX,
      fy: image.focusY,
      moved: false,
      pointerId: e.pointerId,
      mode: editing ? "pan" : "lift",
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (readOnly) return;
    if (
      Math.hypot(e.clientX - holdFrom.current.x, e.clientY - holdFrom.current.y) > 10
    ) {
      cancelHold();
    }
    const sc = scale.current;
    if (sc && sc.pointerId === e.pointerId) {
      const d = Math.hypot(e.clientX - sc.cx, e.clientY - sc.cy);
      onZoom(clampImageZoom(sc.zoom * (d / sc.dist)));
      return;
    }
    const sp = spin.current;
    if (sp && sp.pointerId === e.pointerId) {
      const startAng = Math.atan2(sp.y - sp.cy, sp.x - sp.cx);
      const nowAng = Math.atan2(e.clientY - sp.cy, e.clientX - sp.cx);
      useStudio.getState().setPanelRotate(
        panel.id,
        wrapDeg(sp.rot + ((nowAng - startAng) * 180) / Math.PI),
      );
      return;
    }

    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinch.current && image && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const d = dist(pts[0]!, pts[1]!);
      if (pinch.current.dist > 10) {
        onZoom(clampImageZoom(pinch.current.zoom * (d / pinch.current.dist)));
      }
      return;
    }

    const d = drag.current;
    const el = rootRef.current;
    if (!d || d.pointerId !== e.pointerId || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const slop = e.pointerType === "mouse" ? 4 : 10;
    if (Math.abs(dx) + Math.abs(dy) > slop) d.moved = true;
    if (d.moved) cancelHold();
    if (!d.moved) return;

    if (d.mode === "relocate") {
      if (!d.started) {
        d.started = true;
        onMovePointerDown?.({
          clientX: d.x,
          clientY: d.y,
        } as React.PointerEvent);
      }
      return;
    }

    if (!image) return;

    if (d.mode === "lift") {
      onLiftMove?.(e.clientX, e.clientY);
      return;
    }

    const rect = el.getBoundingClientRect();
    const nx = clamp(d.fx - (dx / rect.width) * 100, 0, 100);
    const ny = clamp(d.fy - (dy / rect.height) * 100, 0, 100);
    onPan(nx, ny);
  }

  function endPointer(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;

    const d = drag.current;
    const moved = d?.moved ?? false;
    const mode = d?.mode;
    const menu = openedMenu.current;
    openedMenu.current = false;
    cancelHold();
    if (d && d.pointerId === e.pointerId) {
      drag.current = null;
      if (mode === "pan") {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    }
    if (scale.current?.pointerId === e.pointerId) scale.current = null;
    if (spin.current?.pointerId === e.pointerId) spin.current = null;
    else if (moved && mode === "lift" && !menu) {
      onLiftEnd?.(e.clientX, e.clientY);
    }

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    if (readOnly || arranging || (editing && imageTool === "crop")) return;
    if ((e.target as HTMLElement).closest("[data-overlay-id]")) return;
    // Double-click on the artwork drops a speech balloon right there, ready to type.
    const sheet = rootRef.current?.closest<HTMLElement>(".paper-sheet");
    if (!sheet) return;
    const r = sheet.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    e.stopPropagation();
    useStudio.getState().addOverlayAt(
      "speech",
      ((e.clientX - r.left) / r.width) * 100,
      ((e.clientY - r.top) / r.height) * 100,
      box.id,
    );
  }

  function handleWheel(e: React.WheelEvent) {
    if (readOnly || !image) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0018);
    onZoom(clampImageZoom(image.zoom * factor));
  }

  function handleDragOver(e: React.DragEvent) {
    if (readOnly) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(e: React.DragEvent) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const uri =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain");
    const bg =
      e.dataTransfer.getData("application/x-koma-background") ||
      (uri.startsWith("koma-bg:") ? uri.slice(8) : "");
    const asBackground = e.altKey || e.shiftKey;
    if (bg && !asBackground) {
      onDropBackground?.(bg);
      return;
    }
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      onDropSrc("", file, asBackground);
      return;
    }
    if (
      uri &&
      (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(uri) ||
        uri.startsWith("/samples/") ||
        uri.startsWith("data:image"))
    ) {
      onDropSrc(uri.trim(), undefined, asBackground);
    }
  }

  function startResize(e: React.PointerEvent, handle: ResizeHandle) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = null;
    pinch.current = null;
    cancelHold();
    onAbortMove?.();
    onResizePointerDown(e, handle);
  }

  function edgeHandleAt(e: React.PointerEvent): ResizeHandle | null {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return null;
    const pad = Math.max(18, Math.min(r.width, r.height) * 0.08);
    const left = e.clientX - r.left < pad;
    const right = r.right - e.clientX < pad;
    const top = e.clientY - r.top < pad;
    const bottom = r.bottom - e.clientY < pad;
    if (top && left) return "nw";
    if (top && right) return "ne";
    if (bottom && left) return "sw";
    if (bottom && right) return "se";
    if (top) return "n";
    if (bottom) return "s";
    if (left) return "w";
    if (right) return "e";
    return null;
  }

  function startImageScale(e: React.PointerEvent) {
    if (!image) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = null;
    pinch.current = null;
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    scale.current = {
      pointerId: e.pointerId,
      zoom: image.zoom,
      dist: Math.max(12, Math.hypot(e.clientX - cx, e.clientY - cy)),
      cx,
      cy,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  const cropping = !readOnly && editing && selected && Boolean(image) && imageTool === "crop";
  const framing = !readOnly && selected && imageTool !== "crop" && !arranging && !lifting;
  const showKnobs = !readOnly && selected && imageTool !== "crop" && !arranging && !lifting;
  const tilt = panel.rotate ?? 0;
  const fill = tiltCover(tilt, box.w / Math.max(box.h, 0.01));

  const frame = Math.max(1.6, borderPct * 1.55);
  const shape = panel.shape ?? "rect";
  const clipPath =
    shape === "circle"
      ? "ellipse(50% 50% at 50% 50%)"
      : shape === "round"
        ? "inset(0 round 14%)"
        : shape === "break"
          ? "polygon(-8% -20%, 108% -14%, 100% 100%, 0% 100%)"
          : undefined;

  return (
    <div
      ref={rootRef}
      role={readOnly ? undefined : "button"}
      tabIndex={readOnly ? -1 : 0}
      data-panel-id={panel.id}
      data-tilt={String(tilt)}
      aria-label={`Panel ${box.index}${image ? "" : ", empty"}`}
      onPointerDown={readOnly ? undefined : handlePointerDown}
      onPointerMove={readOnly ? undefined : handlePointerMove}
      onPointerUp={readOnly ? undefined : endPointer}
      onPointerCancel={readOnly ? undefined : endPointer}
      onDoubleClick={readOnly ? undefined : handleDoubleClick}
      onWheel={readOnly ? undefined : handleWheel}
      onDragOver={readOnly ? undefined : handleDragOver}
      onDrop={readOnly ? undefined : handleDrop}
      onContextMenu={
        readOnly
          ? undefined
          : (e) => {
        if (panModifier(e)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.clientX, e.clientY);
      }
      }
      onKeyDown={
        readOnly
          ? undefined
          : (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          useStudio.getState().deleteSelection();
        }
      }
      }
      className={cn(
        "absolute select-none group",
        selected ? "z-20 touch-none" : "z-[1]",
        readOnly && "pointer-events-none",
      )}
      style={{
        left: `${box.x}%`,
        top: `${box.y}%`,
        width: `${box.w}%`,
        height: `${box.h}%`,
        zIndex: selected ? 70 : 2 + box.index,
        touchAction: selected || lifting || arranging || !image ? "none" : "manipulation",
        outline: editing && selected
          ? cropping
            ? "2px solid var(--color-paper-white)"
            : "2px solid var(--color-hanko)"
          : selected
            ? "2px solid var(--color-accent)"
          : pending
            ? "2px dashed var(--color-hanko)"
            : "none",
        outlineOffset: selected || pending ? "3px" : undefined,
        cursor: readOnly
          ? "default"
          : !image
          ? lifting
            ? "grabbing"
            : "grab"
          : arranging
            ? "move"
            : editing
              ? "grab"
              : lifting
                ? "grabbing"
                : "grab",
        opacity: lifting ? 0.45 : 1,
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
        transformOrigin: "center center",
      }}
    >
      <div
        className="absolute inset-0 bg-paper"
        style={{
          overflow: shape === "break" ? "visible" : "hidden",
          clipPath: shape === "break" ? undefined : clipPath,
          borderRadius: shape === "round" ? "14%" : shape === "circle" ? "50%" : undefined,
          boxShadow: shape === "break" ? `inset 0 -${frame}px 0 #161412, inset ${frame}px 0 0 #161412, inset -${frame}px 0 0 #161412` : `inset 0 0 0 ${frame}px #161412`,
        }}
      >
        {background ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              transform: tilt ? `rotate(${-tilt}deg) scale(${fill})` : undefined,
              transformOrigin: "center center",
            }}
          >
            <img
              src={background.src}
              alt=""
              draggable={false}
              crossOrigin="anonymous"
              className="absolute inset-0 size-full max-w-none"
              style={{
                objectFit: "cover",
                objectPosition: `${background.focusX}% ${background.focusY}%`,
                filter: imageFilter(background),
              }}
            />
          </div>
        ) : null}
        {image ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              transform: tilt ? `rotate(${-tilt}deg) scale(${fill})` : undefined,
              transformOrigin: "center center",
            }}
          >
            <img
              ref={imgRef}
              src={image.src}
              alt=""
              draggable={false}
              crossOrigin="anonymous"
              className="absolute max-w-none"
              onLoad={(e) => {
                const el = e.currentTarget;
                if (el.naturalWidth && el.naturalHeight) {
                  setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                }
              }}
              style={{
                objectFit: fitted ? "fill" : image.zoom < 1 ? "contain" : image.fit,
                objectPosition: fitted ? "center" : `${image.focusX}% ${image.focusY}%`,
                filter: imageFilter(image),
                ...(fitted
                  ? {
                      ...fitted,
                      transform: imageFlipRotate(image),
                      transformOrigin: "center center",
                    }
                  : {
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      transform: imageTransform(image),
                      transformOrigin: `${image.focusX}% ${image.focusY}%`,
                    }),
              }}
            />
          </div>
        ) : readOnly ? null : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              className={cn(
                "rounded-full bg-ink/6 px-2 py-1 text-[10px] font-medium text-muted transition-opacity duration-[var(--motion-quick)]",
                selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              {background ? "Drop a character" : "Drop a photo"}
            </span>
          </div>
        )}
        {showNumber ? (
          <span
            className="absolute left-1 top-1 z-10 flex size-5 cursor-move items-center justify-center bg-ink text-[10px] font-medium tabular-nums text-paper"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onSelect();
              onMovePointerDown?.(e);
            }}
          >
            {box.index}
          </span>
        ) : null}
        {cropping ? (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-1/3 w-px bg-paper-white/50" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-paper-white/50" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-paper-white/50" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-paper-white/50" />
          </div>
        ) : null}
      </div>

      {framing
        ? EDGE_STRIPS.map((strip) => (
            <div
              key={strip.id}
              aria-hidden
              className={strip.className}
              style={{ cursor: HANDLE_CURSOR[strip.id] }}
              onPointerDown={(e) => startResize(e, strip.id)}
            />
          ))
        : null}

      {showKnobs
        ? HANDLES.map((handle) => (
            <div
              key={handle}
              role="separator"
              aria-label={`Resize panel ${handle}`}
              className={cn("koma-handle", HANDLE_POS[handle])}
              style={{ cursor: HANDLE_CURSOR[handle] }}
              onPointerDown={(e) => startResize(e, handle)}
            >
              <span className="koma-handle-knob" />
            </div>
          ))
        : null}

      {cropping
        ? HANDLES.map((handle) => (
            <div
              key={`img-${handle}`}
              role="separator"
              aria-label={`Scale image ${handle}`}
              className={cn("koma-handle", HANDLE_POS[handle])}
              style={{ cursor: HANDLE_CURSOR[handle] }}
              onPointerDown={startImageScale}
              onPointerMove={handlePointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
            >
              <span className="koma-handle-knob koma-handle-knob-crop" />
            </div>
          ))
        : null}

      {showKnobs && !panel.locked ? (
        <>
          <span className="koma-rotate-stem" aria-hidden />
          <button
            type="button"
            aria-label="Tilt frame, photo stays upright"
            data-koma="panel-tilt"
            className="koma-rotate-knob"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect();
              const r = rootRef.current?.getBoundingClientRect();
              if (!r) return;
              spin.current = {
                pointerId: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                cx: r.left + r.width / 2,
                cy: r.top + r.height / 2,
                rot: panel.rotate ?? 0,
              };
              try {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          />
        </>
      ) : null}
    </div>
  );
}
