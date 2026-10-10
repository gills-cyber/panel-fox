import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Library,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { MangaPage } from "@/components/manga/manga-page";
import { PageThumb } from "@/components/manga/page-thumb";
import {
  chapterOfPage,
  facingSpread,
  pageLabel,
  sanitizeChapters,
} from "@/lib/manga/book";
import { useStudio } from "@/lib/manga/store";
import { cn, clamp } from "@/lib/utils";

const HINT_KEY = "koma-reader-hint";
const READ_ZOOM_MIN = 1;
const READ_ZOOM_MAX = 4;

function hintSeen() {
  try {
    return sessionStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function markHintSeen() {
  try {
    sessionStorage.setItem(HINT_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function Reader({ onLibrary }: { onLibrary: () => void }) {
  const pages = useStudio((s) => s.pages);
  const currentPageId = useStudio((s) => s.currentPageId);
  const paperSize = useStudio((s) => s.paperSize);
  const rtl = useStudio((s) => s.rtl);
  const spreadPref = useStudio((s) => s.spread);
  const coverFirst = useStudio((s) => s.book.coverFirst);
  const book = useStudio((s) => s.book);
  const projectName = useStudio((s) => s.projectName);
  const chapters = useStudio((s) => s.chapters);
  const webtoon = paperSize === "webtoon";
  const [spread, setSpread] = useState(!webtoon && spreadPref);
  const [chrome, setChrome] = useState(true);
  const [turn, setTurn] = useState<1 | -1>(1);
  const [finished, setFinished] = useState(false);
  const [hint, setHint] = useState(() => !hintSeen());
  const hideTimer = useRef(0);
  const hintTimer = useRef(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [readZoom, setReadZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const readZoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  readZoomRef.current = readZoom;
  panRef.current = pan;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    dist: number;
    zoom: number;
    panX: number;
    panY: number;
  } | null>(null);
  const gesture = useRef<"tap" | "pan" | "pinch" | null>(null);
  const panDrag = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);

  function limitPan(x: number, y: number, zoom: number) {
    if (zoom <= 1.02) return { x: 0, y: 0 };
    const el = scrollRef.current;
    const w = el?.clientWidth ?? 800;
    const h = el?.clientHeight ?? 600;
    const maxX = (w * (zoom - 1)) / 2 + 24;
    const maxY = (h * (zoom - 1)) / 2 + 24;
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }

  function applyZoom(next: number, origin?: { x: number; y: number }) {
    const prev = readZoomRef.current;
    const zoom = clamp(Math.round(next * 100) / 100, READ_ZOOM_MIN, READ_ZOOM_MAX);
    if (zoom <= 1.02) {
      readZoomRef.current = 1;
      panRef.current = { x: 0, y: 0 };
      setReadZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const el = scrollRef.current;
    let panX = panRef.current.x;
    let panY = panRef.current.y;
    if (origin && el && prev > 0) {
      const rect = el.getBoundingClientRect();
      const cx = origin.x - rect.left - rect.width / 2;
      const cy = origin.y - rect.top - rect.height / 2;
      const k = zoom / prev;
      panX = cx - (cx - panX) * k;
      panY = cy - (cy - panY) * k;
    }
    const limited = limitPan(panX, panY, zoom);
    readZoomRef.current = zoom;
    panRef.current = limited;
    setReadZoom(zoom);
    setPan(limited);
  }

  function stepReadZoom(dir: 1 | -1) {
    const factor = dir > 0 ? 1.25 : 0.8;
    applyZoom(readZoomRef.current * factor);
    pokeChrome();
  }

  const index = Math.max(
    0,
    pages.findIndex((p) => p.id === currentPageId),
  );
  const page = pages[index] ?? pages[0];
  const label = page ? pageLabel(pages, page.id, coverFirst) : "";
  const chapterList = sanitizeChapters(chapters, pages);
  const chapter = page
    ? chapterOfPage(chapters, pages, page.id)
    : null;
  const slot =
    !webtoon && spread && page
      ? facingSpread(pages, page.id, { coverFirst, rtl })
      : null;

  function pokeChrome() {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChrome(false), 3600);
  }

  function dismissHint() {
    if (!hint) return;
    setHint(false);
    markHintSeen();
    window.clearTimeout(hintTimer.current);
  }

  function goTo(id: string, dir: 1 | -1) {
    setFinished(false);
    setTurn(dir);
    setPan({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0 };
    useStudio.getState().setCurrentPage(id);
    pokeChrome();
  }

  function edgeIndex(dir: 1 | -1) {
    if (slot) {
      const edge =
        dir > 0
          ? slot.reading[slot.reading.length - 1]
          : slot.reading[0];
      return pages.findIndex((p) => p.id === edge?.id);
    }
    return index;
  }

  function neighbor(dir: 1 | -1) {
    if (!pages.length) return null;
    if (webtoon) return pages[index + dir] ?? null;
    return pages[edgeIndex(dir) + dir] ?? null;
  }

  const canPrev = Boolean(neighbor(-1));

  function storyDelta(dir: 1 | -1) {
    const next = neighbor(dir);
    if (!next) {
      if (dir > 0 && pages.length) {
        if (webtoon) {
          scrollRef.current
            ?.querySelector("[data-koma='reader-end-mark']")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          setFinished(true);
        }
      }
      pokeChrome();
      return;
    }
    goTo(next.id, dir);
    if (webtoon) {
      const el = scrollRef.current?.querySelector(
        `[data-reader-page="${next.id}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function restart() {
    const first = pages[0];
    if (!first) return;
    goTo(first.id, -1);
    if (webtoon) {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function close() {
    dismissHint();
    useStudio.getState().setReadMode(false);
  }

  function tapFromPoint(clientX: number, width: number) {
    const t = clientX / Math.max(1, width);
    if (t < 0.28) {
      storyDelta(rtl ? 1 : -1);
      return;
    }
    if (t > 0.72) {
      storyDelta(rtl ? -1 : 1);
      return;
    }
    if (chrome) {
      setChrome(false);
      window.clearTimeout(hideTimer.current);
    } else pokeChrome();
  }

  useEffect(() => {
    pokeChrome();
    if (hint) {
      hintTimer.current = window.setTimeout(() => dismissHint(), 4800);
    }
    return () => {
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(hintTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nav = useRef({
    tapFromPoint,
    storyDelta,
    goTo,
    pages,
    webtoon,
    finished,
    setSpread,
    pokeChrome,
    setFinished,
    rtl,
    restart,
    close,
    stepReadZoom,
    applyZoom,
  });
  nav.current = {
    tapFromPoint,
    storyDelta,
    goTo,
    pages,
    webtoon,
    finished,
    setSpread,
    pokeChrome,
    setFinished,
    rtl,
    restart,
    close,
    stepReadZoom,
    applyZoom,
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") return;
      // A sheet (Projects, Save, the template chooser) owns the keyboard.
      if (document.querySelector("[data-koma-dialog]")) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const n = nav.current;
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        n.close();
        return;
      }
      if (n.finished) {
        if (
          e.key === "ArrowLeft" ||
          e.key === "PageUp" ||
          e.key === "Backspace"
        ) {
          e.preventDefault();
          n.setFinished(false);
          n.pokeChrome();
        } else if (e.key === "Home") {
          e.preventDefault();
          n.restart();
        }
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        n.rtl ? n.storyDelta(-1) : n.storyDelta(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        n.rtl ? n.storyDelta(1) : n.storyDelta(-1);
      } else if (e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        n.storyDelta(1);
      } else if (e.key === "PageUp") {
        e.preventDefault();
        n.storyDelta(-1);
      } else if (e.key === "Home") {
        e.preventDefault();
        n.restart();
      } else if (e.key === "End") {
        e.preventDefault();
        const last = n.pages[n.pages.length - 1];
        if (last) n.goTo(last.id, 1);
      } else if (e.key === "s" || e.key === "S") {
        if (n.webtoon) return;
        e.preventDefault();
        n.setSpread((v) => !v);
        n.pokeChrome();
      } else if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") {
        e.preventDefault();
        n.stepReadZoom(1);
      } else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") {
        e.preventDefault();
        n.stepReadZoom(-1);
      } else if (e.key === "0") {
        e.preventDefault();
        n.applyZoom(1);
        n.pokeChrome();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const btn = stripRef.current?.querySelector(
      `[data-page-id="${currentPageId}"]`,
    );
    btn?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
  }, [currentPageId]);

  useEffect(() => {
    if (!webtoon || !scrollRef.current) return;
    const root = scrollRef.current;
    const els = [...root.querySelectorAll("[data-reader-page]")];
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = hit?.target.getAttribute("data-reader-page");
        if (id && id !== useStudio.getState().currentPageId) {
          useStudio.getState().setCurrentPage(id);
        }
      },
      { root, threshold: [0.45, 0.7] },
    );
    for (const el of els) io.observe(el);
    const current = root.querySelector(
      `[data-reader-page="${currentPageId}"]`,
    );
    current?.scrollIntoView({ block: "start" });
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webtoon, pages.map((p) => p.id).join("|")]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      const pinch = e.ctrlKey || e.metaKey;
      if (webtoon && !pinch && readZoomRef.current <= 1.02) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.88;
      applyZoom(readZoomRef.current * factor, { x: e.clientX, y: e.clientY });
      pokeChrome();
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [webtoon]);

  const title =
    book.title?.trim() || projectName?.trim() || "Untitled";
  const progress =
    pages.length > 0 ? ((index + 1) / pages.length) * 100 : 0;

  function sheet(pageState: typeof page, key: string) {
    if (!pageState) return null;
    return (
      <div
        key={key}
        className="koma-reader-sheet"
        style={{ ["--turn" as string]: `${turn * (rtl ? -16 : 16)}px` }}
      >
        <MangaPage
          pageOverride={pageState}
          readOnly
          fitHost
          spreadSlot={Boolean(slot)}
          onPickFile={() => {}}
        />
      </div>
    );
  }

  function onStagePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const t = e.target;
    if (
      t instanceof Element &&
      t.closest(
        ".koma-reader-chrome, .koma-reader-end, button, input, select, a, [data-koma='reader-strip']",
      )
    ) {
      swipe.current = null;
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    swipe.current = { x: e.clientX, y: e.clientY };
    gesture.current = "tap";
    if (pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      pinch.current = {
        dist: Math.max(16, Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)),
        zoom: readZoomRef.current,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      gesture.current = "pinch";
      panDrag.current = null;
      return;
    }
    if (readZoomRef.current > 1.02) {
      panDrag.current = {
        x: e.clientX,
        y: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
    } else {
      panDrag.current = null;
    }
  }

  function onStagePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    pokeChrome();
    if (pinch.current && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.max(16, Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y));
      applyZoom(pinch.current.zoom * (dist / pinch.current.dist), {
        x: (pts[0]!.x + pts[1]!.x) / 2,
        y: (pts[0]!.y + pts[1]!.y) / 2,
      });
      gesture.current = "pinch";
      return;
    }
    const drag = panDrag.current;
    if (drag && readZoomRef.current > 1.02) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) gesture.current = "pan";
      const next = limitPan(drag.panX + dx, drag.panY + dy, readZoomRef.current);
      panRef.current = next;
      setPan(next);
    }
  }

  function onStagePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const kind = gesture.current;
    const s = swipe.current;
    swipe.current = null;
    panDrag.current = null;
    if (kind === "pan" || kind === "pinch") {
      gesture.current = null;
      return;
    }
    gesture.current = null;
    if (!s) return;
    dismissHint();
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (webtoon) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        if (chrome) {
          setChrome(false);
          window.clearTimeout(hideTimer.current);
        } else pokeChrome();
      }
      return;
    }
    if (readZoomRef.current > 1.05) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        if (chrome) {
          setChrome(false);
          window.clearTimeout(hideTimer.current);
        } else pokeChrome();
      }
      return;
    }
    if (Math.abs(dx) >= 72 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      storyDelta((dx < 0 ? (rtl ? -1 : 1) : rtl ? 1 : -1) as 1 | -1);
      return;
    }
    if (Math.abs(dx) > 18 || Math.abs(dy) > 18) return;
    tapFromPoint(e.clientX, e.currentTarget.clientWidth);
  }

  return (
    <div
      data-koma="reader"
      className="koma-reader relative flex h-dvh min-h-0 flex-col overflow-hidden text-surface"
      onPointerMove={onStagePointerMove}
      onPointerDown={onStagePointerDown}
      onPointerUp={onStagePointerUp}
      onPointerCancel={onStagePointerUp}
      onDoubleClick={(e) => {
        const t = e.target;
        if (
          t instanceof Element &&
          t.closest(
            ".koma-reader-chrome, .koma-reader-end, button, input, select, a, [data-koma='reader-strip']",
          )
        ) {
          return;
        }
        if (readZoomRef.current > 1.05) applyZoom(1);
        else applyZoom(2.2, { x: e.clientX, y: e.clientY });
        pokeChrome();
      }}
    >
      <div className="koma-reader-progress" aria-hidden>
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="koma-reader-edit-pin" data-koma="reader-done">
        <button
          type="button"
          data-koma="read-open"
          className="koma-reader-btn is-solid"
          title="Exit read (R)"
          aria-label="Read"
          aria-pressed="true"
          onClick={close}
        >
          <BookOpen className="size-4" />
          Read
        </button>
        <button
          type="button"
          className="koma-reader-icon"
          data-koma="reader-zoom-out"
          aria-label="Zoom out"
          title="Zoom out (−)"
          disabled={readZoom <= READ_ZOOM_MIN}
          onClick={() => stepReadZoom(-1)}
        >
          <ZoomOut className="size-4" />
        </button>
        <button
          type="button"
          className="koma-reader-icon tabular-nums"
          data-koma="reader-zoom-fit"
          aria-label="Reset zoom"
          title="Fit page (0)"
          onClick={() => {
            applyZoom(1);
            pokeChrome();
          }}
        >
          {readZoom <= 1.02 ? "Fit" : `${Math.round(readZoom * 100)}%`}
        </button>
        <button
          type="button"
          className="koma-reader-icon"
          data-koma="reader-zoom-in"
          aria-label="Zoom in"
          title="Zoom in (+)"
          disabled={readZoom >= READ_ZOOM_MAX}
          onClick={() => stepReadZoom(1)}
        >
          <ZoomIn className="size-4" />
        </button>
      </div>

      <header
        className={cn(
          "koma-reader-chrome pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 pb-10 pl-[16.5rem] pr-3 pt-[max(0.7rem,env(safe-area-inset-top))]",
          chrome ? "is-on" : "is-off",
        )}
      >
        <div className="pointer-events-auto min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold tracking-tight">
              {title}
            </p>
            <p className="flex min-w-0 items-center gap-1 truncate text-[11px] text-surface/65">
              {chapterList.length > 1 ? (
                <select
                  className="koma-reader-select"
                  data-koma="reader-chapter"
                  aria-label="Chapter"
                  value={chapter?.id ?? ""}
                  onChange={(e) => {
                    const ch = chapterList.find((c) => c.id === e.target.value);
                    if (ch) goTo(ch.startPageId, 1);
                  }}
                >
                  {chapterList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              ) : chapter ? (
                <span className="truncate">{chapter.title}</span>
              ) : null}
              {chapter || chapterList.length > 1 ? (
                <span aria-hidden>·</span>
              ) : null}
              <span className="tabular-nums">
                {label}
                {pages.length > 1 ? ` of ${pages.length}` : ""}
              </span>
              {book.author?.trim() ? (
                <span className="hidden truncate sm:inline">
                  {" "}
                  · {book.author}
                </span>
              ) : null}
            </p>
          </div>
        <div className="pointer-events-auto flex items-center gap-1">
          <button
            type="button"
            className="koma-reader-icon"
            data-koma="reader-restart"
            aria-label="Start over"
            title="Start over"
            disabled={!pages.length || index === 0}
            onClick={restart}
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            type="button"
            className="koma-reader-icon"
            data-koma="reader-library"
            aria-label="Projects"
            title="Projects"
            onClick={onLibrary}
          >
            <Library className="size-4" />
          </button>
          {!webtoon ? (
            <button
              type="button"
              className={cn("koma-reader-icon", spread && "is-active")}
              data-koma="reader-spread"
              aria-label={spread ? "Single page" : "Two-page spread"}
              title={spread ? "Single page" : "Two-page spread"}
              onClick={() => {
                setSpread((v) => !v);
                pokeChrome();
              }}
            >
              <Columns2 className="size-4" />
            </button>
          ) : null}
        </div>
      </header>

      <div
        ref={scrollRef}
        className={cn(
          "relative min-h-0 flex-1",
          webtoon
            ? "overflow-y-auto overscroll-contain"
            : "flex items-center justify-center overflow-hidden px-2 py-[4.5rem]",
        )}
        style={{ touchAction: webtoon && readZoom <= 1.02 ? "pan-y" : "none" }}
      >
        <div
          data-koma="reader-stage"
          className={cn(
            webtoon
              ? "mx-auto w-full max-w-[52rem]"
              : "flex h-full w-full max-w-full items-stretch justify-center",
          )}
          style={{
            ["--read-zoom" as string]: String(readZoom),
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
            transformOrigin: webtoon ? "top center" : "center center",
            willChange: readZoom > 1.02 ? "transform" : undefined,
          }}
        >
        {webtoon ? (
          <div className="flex w-full flex-col py-14">
            {pages.map((p) => (
              <div
                key={p.id}
                data-reader-page={p.id}
                className="koma-reader-webtoon-page"
              >
                <MangaPage
                  pageOverride={p}
                  readOnly
                  onPickFile={() => {}}
                />
              </div>
            ))}
            {pages.length ? (
              <div
                data-koma="reader-end-mark"
                className="flex flex-col items-center gap-3 px-6 py-20 text-center"
              >
                <p className="text-[11px] font-semibold tracking-[0.18em] text-surface/45 uppercase">
                  The end
                </p>
                <p className="max-w-sm text-[15px] font-medium">{title}</p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    className="koma-reader-btn"
                    onClick={restart}
                  >
                    Start over
                  </button>
                  <button
                    type="button"
                    className="koma-reader-btn"
                    onClick={close}
                  >
                    Back to editor
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : slot ? (
          <div
            data-koma="reader-spread-view"
            className="flex h-full max-h-full w-full max-w-[1100px] items-stretch justify-center"
          >
            {slot.left ? (
              sheet(slot.left, "left")
            ) : (
              <div className="hidden min-w-0 flex-1 sm:block" />
            )}
            {slot.left && slot.right ? (
              <div className="koma-spine self-stretch" aria-hidden />
            ) : null}
            {slot.right ? (
              sheet(slot.right, "right")
            ) : (
              <div className="hidden min-w-0 flex-1 sm:block" />
            )}
          </div>
        ) : (
          <div
            key={page?.id}
            className="h-full w-full max-w-[46rem]"
          >
            {sheet(page, page?.id ?? "page")}
          </div>
        )}
        </div>

        {hint && !webtoon && !finished ? (
          <div
            data-koma="reader-hint"
            className="koma-reader-hint"
            aria-hidden
          >
            <span className="koma-reader-hint-side">
              {rtl ? "Next" : "Back"}
            </span>
            <span className="koma-reader-hint-mid">Tap for controls</span>
            <span className="koma-reader-hint-side is-end">
              {rtl ? "Back" : "Next"}
            </span>
          </div>
        ) : null}
        {hint && webtoon ? (
          <div
            data-koma="reader-hint"
            className="koma-reader-hint koma-reader-hint-webtoon"
            aria-hidden
          >
            Scroll to read · tap for controls
          </div>
        ) : null}
      </div>

      {finished && !webtoon ? (
        <div
          data-koma="reader-end"
          className="koma-reader-end absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 px-6 text-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setFinished(false);
              pokeChrome();
            }
          }}
        >
          <p className="text-[11px] font-semibold tracking-[0.18em] text-surface/45 uppercase">
            The end
          </p>
          <p className="max-w-md text-2xl font-semibold tracking-tight">
            {title}
          </p>
          <p className="text-[13px] text-surface/55">
            {pages.length} page{pages.length === 1 ? "" : "s"}
            {book.author?.trim() ? ` · ${book.author}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className="koma-reader-btn is-solid"
              data-koma="reader-end-restart"
              onClick={restart}
            >
              Start over
            </button>
            <button
              type="button"
              className="koma-reader-btn"
              onClick={onLibrary}
            >
              Projects
            </button>
            <button
              type="button"
              className="koma-reader-btn is-solid"
              data-koma="reader-end-edit"
              onClick={close}
            >
              Edit
            </button>
          </div>
        </div>
      ) : null}

      <footer
        className={cn(
          "koma-reader-chrome pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(0.8rem,env(safe-area-inset-bottom))] pt-10",
          chrome ? "is-on" : "is-off",
        )}
      >
        <div className="pointer-events-auto mx-auto flex max-w-3xl flex-col gap-2">
          {!webtoon && pages.length > 1 ? (
            <div
              ref={stripRef}
              className="koma-reader-strip flex items-end gap-2 overflow-x-auto px-1 py-1"
              data-koma="reader-strip"
            >
              {pages.map((p, i) => (
                <PageThumb
                  key={p.id}
                  page={p}
                  index={i + 1}
                  label={pageLabel(pages, p.id, coverFirst)}
                  selected={p.id === currentPageId}
                  onClick={() => goTo(p.id, i > index ? 1 : -1)}
                  className="w-11 shrink-0 px-0 py-0"
                />
              ))}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="koma-reader-icon"
              data-koma="reader-prev"
              aria-label="Previous page"
              disabled={!canPrev || finished}
              onClick={() => storyDelta(-1)}
            >
              {rtl ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, pages.length - 1)}
              value={index}
              data-koma="reader-scrub"
              aria-label="Page"
              className="koma-reader-range min-w-0 flex-1"
              onChange={(e) => {
                const p = pages[Number(e.target.value)];
                if (p) goTo(p.id, Number(e.target.value) > index ? 1 : -1);
              }}
            />
            <button
              type="button"
              className="koma-reader-icon"
              data-koma="reader-next"
              aria-label="Next page"
              disabled={finished}
              onClick={() => storyDelta(1)}
            >
              {rtl ? (
                <ChevronLeft className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
            <p className="hidden min-w-[4.5rem] text-right text-[11px] tabular-nums text-surface/70 sm:block">
              {index + 1} / {pages.length}
            </p>
          </div>
          <p className="hidden text-center text-[10px] text-surface/45 sm:block">
            {webtoon
              ? "Scroll to read · Edit or Esc returns to studio"
              : rtl
                ? "Tap left for next · Edit or Esc returns to studio"
                : "Tap right for next · Edit or Esc returns to studio"}
          </p>
        </div>
      </footer>

      {!pages.length ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center">
          <BookOpen className="size-8 text-surface/40" />
          <p className="text-sm text-surface/70">
            This project has no pages yet.
          </p>
          <button type="button" className="koma-reader-btn" onClick={close}>
            Back to editor
          </button>
        </div>
      ) : null}
    </div>
  );
}
