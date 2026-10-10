import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ContextMenu } from "@/components/manga/context-menu";
import {
  gapPositionFromRects,
  insertIndexFromRects,
  labelForIndex,
  pageLabel,
  parseSendTo,
} from "@/lib/manga/book";
import { useStudio } from "@/lib/manga/store";

export type PageRailMenu = {
  x: number;
  y: number;
  insertAt: number;
  pageId: string | null;
  axis: "x" | "y";
  gap: number;
  rail: { left: number; top: number; width: number; height: number };
};

const RAIL_SEL = "[data-koma='page-rail'],[data-koma='page-rail-mobile']";

export function pageRailMenuFromPoint(
  root: HTMLElement,
  x: number,
  y: number,
  axis: "x" | "y",
  target: EventTarget | null,
): PageRailMenu {
  const thumbs = [...root.querySelectorAll("[data-page-id]")];
  const rects = thumbs.map((el) => el.getBoundingClientRect());
  const insertAt = insertIndexFromRects(rects, { x, y }, axis);
  const hit =
    target instanceof Element ? target.closest("[data-page-id]") : null;
  const pageId = hit?.getAttribute("data-page-id") ?? null;
  return {
    x,
    y,
    insertAt,
    pageId,
    axis,
    gap: gapPositionFromRects(rects, insertAt, axis),
    rail: root.getBoundingClientRect(),
  };
}

export function pageRailMenuFromEvent(
  e: MouseEvent<HTMLElement>,
  axis: "x" | "y",
): PageRailMenu {
  return pageRailMenuFromPoint(
    e.currentTarget,
    e.clientX,
    e.clientY,
    axis,
    e.target,
  );
}

/** Capture-phase listeners so right-click still works when the host iframe
 *  swallows `contextmenu` (Grok preview) or Electron intercepts the default menu. */
export function usePageRailMenus(onOpen: (menu: PageRailMenu) => void) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    function openFrom(e: Event) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-koma-menu]")) return;
      const rail = t.closest<HTMLElement>(RAIL_SEL);
      if (!rail) return;
      const axis =
        rail.getAttribute("data-koma") === "page-rail-mobile" ? "x" : "y";
      e.preventDefault();
      e.stopPropagation();
      const ev = e as MouseEvent;
      onOpenRef.current(
        pageRailMenuFromPoint(rail, ev.clientX, ev.clientY, axis, t),
      );
    }
    function onAux(e: MouseEvent) {
      if (e.button !== 2) return;
      openFrom(e);
    }
    window.addEventListener("auxclick", onAux, true);
    window.addEventListener("contextmenu", openFrom, true);
    return () => {
      window.removeEventListener("auxclick", onAux, true);
      window.removeEventListener("contextmenu", openFrom, true);
    };
  }, []);
}

export function PageInsertMark({ menu }: { menu: PageRailMenu }) {
  if (menu.axis === "y") {
    return (
      <div
        data-koma="page-insert-mark"
        data-axis="y"
        className="koma-page-insert-mark pointer-events-none fixed z-[99] h-0.5 bg-accent"
        style={{
          left: menu.rail.left + 12,
          width: Math.max(24, menu.rail.width - 24),
          top: menu.gap,
        }}
      />
    );
  }
  return (
    <div
      data-koma="page-insert-mark"
      data-axis="x"
      className="koma-page-insert-mark pointer-events-none fixed z-[99] w-0.5 bg-accent"
      style={{
        top: menu.rail.top + 8,
        height: Math.max(24, menu.rail.height - 16),
        left: menu.gap,
      }}
    />
  );
}

export function PageContextMenu({
  menu,
  onClose,
}: {
  menu: PageRailMenu;
  onClose: () => void;
}) {
  const pages = useStudio((s) => s.pages);
  const coverFirst = useStudio((s) => s.book.coverFirst);
  const [sendOpen, setSendOpen] = useState(false);
  const [value, setValue] = useState("");
  const becomes = labelForIndex(menu.insertAt, coverFirst);
  const page = menu.pageId
    ? pages.find((p) => p.id === menu.pageId)
    : null;
  const isCover = Boolean(
    coverFirst && menu.pageId && pages[0]?.id === menu.pageId,
  );

  function addHere() {
    useStudio.getState().addPage(menu.insertAt);
    toast.success(`Added ${becomes}`);
  }

  function submitSend() {
    if (!menu.pageId) return;
    const dest = parseSendTo(value);
    if (dest == null) {
      toast.error("Type a page number, or “cover”");
      return;
    }
    useStudio.getState().sendPageTo(menu.pageId, dest);
    const s = useStudio.getState();
    toast.success(`Moved to ${pageLabel(s.pages, menu.pageId, s.book.coverFirst)}`);
    onClose();
  }

  const extra: ReactNode = sendOpen ? (
    <form
      data-koma="send-to-form"
      className="flex flex-col gap-1.5 px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        submitSend();
      }}
    >
      <label className="text-[11px] font-medium text-muted" htmlFor="koma-send-to">
        Send to page
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id="koma-send-to"
          data-koma="send-to-input"
          autoFocus
          inputMode="numeric"
          placeholder="7"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="koma-field h-7 min-w-0 flex-1"
        />
        <button
          type="submit"
          data-koma="send-to-go"
          className="h-8 shrink-0 rounded-[8px] bg-ink px-2.5 text-[12px] font-medium text-surface"
        >
          Go
        </button>
      </div>
      <p className="text-[10px] text-muted">Number, or “cover”</p>
    </form>
  ) : null;

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      extra={extra}
      items={
        sendOpen
          ? [
              {
                label: "Back",
                mark: "send-to-back",
                keepOpen: true,
                onClick: () => setSendOpen(false),
              },
            ]
          : [
              {
                label: `Add Page Here (${becomes})`,
                mark: "add-page-here",
                onClick: addHere,
              },
              ...(page
                ? [
                    {
                      label: "Duplicate Page",
                      mark: "dup-page",
                      onClick: () => {
                        useStudio.getState().duplicatePage(page.id);
                        toast.success("Duplicated page");
                      },
                    },
                    {
                      label: "Send to…",
                      mark: "send-to-page",
                      keepOpen: true,
                      onClick: () => setSendOpen(true),
                    },
                    {
                      label: "Make Cover",
                      mark: "make-cover",
                      disabled: isCover,
                      onClick: () => {
                        useStudio.getState().sendPageTo(page.id, "cover");
                        toast.success("Set as cover");
                      },
                    },
                    { separator: true as const },
                    {
                      label: "Delete Page",
                      mark: "delete-page",
                      danger: true,
                      disabled: pages.length <= 1,
                      onClick: () => useStudio.getState().removePage(page.id),
                    },
                  ]
                : []),
            ]
      }
    />
  );
}
