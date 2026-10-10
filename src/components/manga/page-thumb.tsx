import { memo, useMemo, useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import { boxesForPage } from "@/lib/manga/templates";
import { useStudio } from "@/lib/manga/store";
import type { PageState } from "@/lib/manga/types";
import { paperSpec } from "@/lib/manga/paper";
import { tiltCover } from "@/lib/manga/image";
import { cn } from "@/lib/utils";

function PageThumbInner({
  page,
  index,
  selected,
  onClick,
  onMove,
  onMenu,
  className,
  passive = false,
  label,
}: {
  page: PageState;
  index: number;
  selected: boolean;
  onClick: () => void;
  onMove?: (fromId: string, toId: string) => void;
  onMenu?: (x: number, y: number, host: HTMLElement) => void;
  className?: string;
  passive?: boolean;
  label?: string;
}) {
  const gutter = useStudio((s) => s.gutter);
  const margin = useStudio((s) => s.margin);
  const rtl = useStudio((s) => s.rtl);
  const paper = useStudio((s) => s.paper);
  const paperSize = useStudio((s) => s.paperSize);
  const spec = paperSpec(paperSize);
  const boxes = useMemo(
    () => boxesForPage(page, margin, gutter, rtl),
    [page, margin, gutter, rtl],
  );
  const byId = useMemo(
    () => new Map(page.panels.map((p) => [p.id, p])),
    [page.panels],
  );
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const dragging = useRef(false);
  const hold = useRef<number | null>(null);
  const heldMenu = useRef(false);

  function clearHold() {
    if (hold.current != null) {
      window.clearTimeout(hold.current);
      hold.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    dragging.current = false;
    heldMenu.current = false;
    start.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    clearHold();
    const cx = e.clientX;
    const cy = e.clientY;
    const target = e.currentTarget;
    hold.current = window.setTimeout(() => {
      heldMenu.current = true;
      dragging.current = false;
      target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: cx,
          clientY: cy,
          view: window,
        }),
      );
    }, 480);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    const s = start.current;
    if (!s || s.pointerId !== e.pointerId) return;
    if (
      !dragging.current &&
      onMove &&
      Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8
    ) {
      dragging.current = true;
      clearHold();
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLElement>) {
    const s = start.current;
    if (!s || s.pointerId !== e.pointerId) return;
    start.current = null;
    clearHold();
    if (heldMenu.current) {
      heldMenu.current = false;
      dragging.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }
    if (dragging.current && onMove) {
      dragging.current = false;
      const src = e.currentTarget;
      src.style.pointerEvents = "none";
      try {
        src.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      src.style.pointerEvents = "";
      const target = el?.closest("[data-page-id]");
      const id = target?.getAttribute("data-page-id");
      if (id && id !== page.id) onMove(page.id, id);
      return;
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragging.current = false;
    onClick();
  }

  const Comp = passive ? "div" : "button";

  return (
    <div
      data-page-id={page.id}
      className={cn(
        "koma-thumb group relative flex w-full flex-col items-center gap-2 px-4 py-3 select-none",
        className,
      )}
      style={{ ["--koma-thumb-i" as string]: String(Math.max(0, index)) }}
      onContextMenu={
        passive || !onMenu
          ? undefined
          : (e) => {
              e.preventDefault();
              onMenu(e.clientX, e.clientY, e.currentTarget);
            }
      }
    >
      <Comp
        type={passive ? undefined : "button"}
        onPointerDown={passive ? undefined : onPointerDown}
        onPointerMove={passive ? undefined : onPointerMove}
        onPointerUp={passive ? undefined : onPointerUp}
        onPointerCancel={
          passive
            ? undefined
            : (e) => {
                start.current = null;
                dragging.current = false;
                clearHold();
                heldMenu.current = false;
                try {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                } catch {
                  /* ignore */
                }
              }
        }
        className="flex w-full flex-col items-center gap-2"
        aria-current={!passive && selected ? "page" : undefined}
        aria-label={passive ? undefined : label ?? `Page ${index}`}
      >
        <div
          className={cn(
            "koma-thumb-sheet relative w-full overflow-hidden rounded-[2px] bg-paper shadow-page",
            selected
              ? "ring-2 ring-accent ring-offset-2 ring-offset-sidebar"
              : "shadow-tool group-hover:ring-1 group-hover:ring-ink/15",
          )}
          style={{ aspectRatio: `${spec.w} / ${spec.h}` }}
          data-paper={paper}
        >
          {boxes.map((box) => {
            const panel = byId.get(box.id);
            const background = panel?.background;
            const image = panel?.image;
            const tilt = panel?.rotate ?? 0;
            const fill = tiltCover(tilt, box.w / Math.max(box.h, 0.01));
            return (
              <div
                key={box.id}
                className="absolute overflow-hidden bg-paper"
                style={{
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.w}%`,
                  height: `${box.h}%`,
                  boxShadow: "inset 0 0 0 1px rgb(29 29 31 / 0.55)",
                  transform: tilt ? `rotate(${tilt}deg)` : undefined,
                }}
              >
                {background ? (
                  <img
                    src={background.src}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 size-full object-cover"
                    style={{
                      transform: tilt ? `rotate(${-tilt}deg) scale(${fill})` : undefined,
                      transformOrigin: "center center",
                    }}
                  />
                ) : null}
                {image ? (
                  <img
                    src={image.src}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 size-full object-cover"
                    style={{
                      objectPosition: `${image.focusX}% ${image.focusY}%`,
                      transform: tilt ? `rotate(${-tilt}deg) scale(${fill})` : undefined,
                      transformOrigin: "center center",
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <span
          className={cn(
            "koma-thumb-label text-xs tabular-nums",
            selected ? "font-medium text-ink" : "text-muted",
          )}
        >
          {label ?? (index === 1 ? "Page 1" : `Page ${index}`)}
        </span>
      </Comp>
      {!passive && onMenu ? (
        <button
          type="button"
          data-koma="page-thumb-menu"
          aria-label="Page actions"
          className="koma-thumb-more"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const host = e.currentTarget.parentElement;
            if (host) onMenu(e.clientX, e.clientY, host);
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** Thumbnails of untouched pages skip re-rendering; the callbacks only reach stable store actions. */
export const PageThumb = memo(
  PageThumbInner,
  (a, b) =>
    a.page === b.page &&
    a.index === b.index &&
    a.selected === b.selected &&
    a.label === b.label &&
    a.className === b.className &&
    a.passive === b.passive,
);
