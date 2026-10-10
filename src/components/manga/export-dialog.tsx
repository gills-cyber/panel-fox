import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  downloadBlob,
  exportPageBlob,
  exportPagesPdf,
  exportPagesZip,
  exportPagesCbz,
  exportWebtoonCanvas,
  exportWebtoonStrip,
  formatExt,
  isWebtoonExport,
  pageFileName,
  type ExportFormat,
  type ExportRange,
} from "@/lib/manga/export";
import { bookDisplayTitle, pagesForRange } from "@/lib/manga/book";
import { describeWebtoonExport, WEBTOON_WIDTH } from "@/lib/manga/webtoon";
import { paperSpec } from "@/lib/manga/paper";
import { readPrefs, writePrefs } from "@/lib/manga/prefs";
import { useStudio } from "@/lib/manga/store";

function opts() {
  const s = useStudio.getState();
  return {
    gutter: s.gutter,
    margin: s.margin,
    border: s.border,
    paper: s.paper,
    rtl: s.rtl,
    paperSize: s.paperSize,
    bleed: s.bleed,
    handInk: s.handInk,
  };
}

function bookOpts(
  twoUp: boolean,
  onProgress?: (done: number, total: number) => void,
) {
  const s = useStudio.getState();
  return {
    twoUp,
    book: s.book,
    chapters: s.chapters,
    allPages: s.pages,
    fallbackTitle: s.projectName,
    onProgress,
  };
}

function slugBase() {
  const s = useStudio.getState();
  const title = bookDisplayTitle(s.book, s.projectName || "koma");
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "koma"
  );
}

const PRINT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "png", label: "PNG" },
  { id: "jpeg", label: "JPEG" },
  { id: "pdf", label: "PDF" },
  { id: "cbz", label: "CBZ" },
];

function initialFormat(paperSize: string): ExportFormat {
  const saved = readPrefs().exportFormat;
  if (paperSize === "webtoon") {
    return saved === "canvas" ? "canvas" : "strip";
  }
  if (
    saved === "png" ||
    saved === "jpeg" ||
    saved === "pdf" ||
    saved === "cbz"
  ) {
    return saved;
  }
  return "pdf";
}

export async function runExport(
  format: ExportFormat,
  range: ExportRange,
  twoUp: boolean,
  onProgress?: (done: number, total: number) => void,
) {
  const s = useStudio.getState();
  const pages = pagesForRange(s.pages, range, s.currentPageId, s.chapters, {
    coverFirst: s.book.coverFirst,
    rtl: s.rtl,
  });
  const page = s.currentPage();
  const n = s.pages.findIndex((p) => p.id === page.id) + 1;
  const base = slugBase();
  const book = bookOpts(twoUp && range !== "page" && !isWebtoonExport(format), onProgress);
  const suffix =
    range === "spread" ? "-spread" : range === "chapter" ? "-chapter" : "";

  if (format === "strip") {
    const result = await exportWebtoonStrip(pages, opts(), onProgress);
    const name =
      result.tiles === 1
        ? `${base}${suffix}-webtoon.png`
        : `${base}${suffix}-webtoon.zip`;
    downloadBlob(result.blob, name);
    return name;
  }

  if (format === "canvas") {
    const blob = await exportWebtoonCanvas(pages, opts(), onProgress);
    const name = `${base}${suffix}-canvas.zip`;
    downloadBlob(blob, name);
    return name;
  }

  if (format === "pdf") {
    const blob = await exportPagesPdf(pages, opts(), book);
    const name =
      range === "page" ? pageFileName(page, n, "pdf") : `${base}${suffix}.pdf`;
    downloadBlob(blob, name);
    return name;
  }

  if (format === "cbz") {
    const blob = await exportPagesCbz(pages, opts(), book);
    const name = `${base}${suffix}.cbz`;
    downloadBlob(blob, name);
    return name;
  }

  if (range !== "page") {
    const blob = await exportPagesZip(pages, opts(), format, book);
    const name = `${base}${suffix}-${formatExt(format)}.zip`;
    downloadBlob(blob, name);
    return name;
  }

  onProgress?.(0, 1);
  const blob = await exportPageBlob(
    {
      page,
      ...opts(),
      folio: s.book.coverFirst && n === 1 ? "Cover" : String(s.book.coverFirst ? n - 1 : n),
    },
    format,
  );
  onProgress?.(1, 1);
  const name = pageFileName(page, n, formatExt(format));
  downloadBlob(blob, name);
  return name;
}

export function ExportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [range, setRange] = useState<ExportRange>("all");
  const [twoUp, setTwoUp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chapters = useStudio((s) => s.chapters);
  const spread = useStudio((s) => s.spread);
  const pages = useStudio((s) => s.pages);
  const paperSize = useStudio((s) => s.paperSize);
  const currentPageId = useStudio((s) => s.currentPageId);
  const coverFirst = useStudio((s) => s.book.coverFirst);
  const rtl = useStudio((s) => s.rtl);
  const webtoon = isWebtoonExport(format);

  useEffect(() => {
    if (!open) return;
    const prefs = readPrefs();
    setFormat(initialFormat(useStudio.getState().paperSize));
    if (prefs.exportRange) setRange(prefs.exportRange);
    if (typeof prefs.exportTwoUp === "boolean") setTwoUp(prefs.exportTwoUp);
    setBusy(false);
    setError(null);
    setProgress(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (busy) return;
      e.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  useEffect(() => {
    if (format === "pdf" || format === "cbz") setTwoUp(true);
    if (webtoon) {
      setTwoUp(false);
      setRange((r) => (r === "spread" ? "all" : r));
    }
  }, [format, webtoon]);

  const selectedPages = useMemo(
    () =>
      pagesForRange(pages, range, currentPageId, chapters, {
        coverFirst,
        rtl,
      }),
    [pages, range, currentPageId, chapters, coverFirst, rtl],
  );

  const estimate = useMemo(() => {
    const spec = paperSpec(paperSize);
    const pageH = Math.round(WEBTOON_WIDTH * (spec.h / spec.w));
    return describeWebtoonExport(selectedPages.length, pageH);
  }, [selectedPages.length, paperSize]);

  if (!open) return null;

  const bookish = format === "pdf" || format === "cbz";
  const progressLabel =
    busy && progress && progress.total > 0
      ? `Exporting ${Math.min(progress.done + 1, progress.total)}/${progress.total}…`
      : busy
        ? "Exporting…"
        : "Export";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        className="koma-scrim absolute inset-0"
        aria-label="Close"
        disabled={busy}
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        role="dialog"
        aria-labelledby="export-title"
        data-koma-dialog="export"
        className="koma-glass-surface relative max-h-[min(40rem,calc(100dvh-2rem))] w-full max-w-md overflow-y-auto rounded-[16px] p-5 shadow-float"
      >
        <h2 id="export-title" className="text-[15px] font-semibold">
          Export
        </h2>
        <p className="mt-1 text-[12px] text-muted">
          {webtoon
            ? "Strip is one tall scroll. Canvas is 800px JPEG cuts ready for WEBTOON Canvas."
            : "PDF opens like a printed volume. CBZ includes ComicInfo so readers show title, author, and chapters."}
        </p>
        <p className="mt-4 text-[11px] font-medium text-muted">Print</p>
        <div className="koma-seg mt-1.5">
          {PRINT_FORMATS.map((item) => (
            <button
              key={item.id}
              type="button"
              data-koma={`export-format-${item.id}`}
              data-active={format === item.id}
              disabled={busy}
              onClick={() => setFormat(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] font-medium text-muted">Webtoon</p>
        <div className="koma-seg mt-1.5">
          <button
            type="button"
            data-koma="export-strip"
            data-active={format === "strip"}
            disabled={busy}
            onClick={() => setFormat("strip")}
          >
            Strip
          </button>
          <button
            type="button"
            data-koma="export-canvas"
            data-active={format === "canvas"}
            disabled={busy}
            onClick={() => setFormat("canvas")}
          >
            Canvas
          </button>
        </div>
        <p className="mt-3 text-[11px] font-medium text-muted">Pages</p>
        <div className="koma-seg mt-1.5">
          {(
            [
              ["page", "Page"],
              ["spread", "Spread"],
              ["chapter", "Chapter"],
              ["all", "Book"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-koma={`export-${id === "all" ? "book" : id}`}
              data-active={range === id}
              disabled={
                busy ||
                (id === "chapter" && chapters.length === 0) ||
                (id === "spread" && (pages.length < 1 || webtoon))
              }
              onClick={() => setRange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {!webtoon && (bookish || range !== "page") ? (
          <label className="mt-3 flex items-center justify-between gap-3 text-sm">
            <span>Two-up facing pages</span>
            <span
              className={`relative h-5 w-8 shrink-0 rounded-full ${
                twoUp && range !== "page" ? "bg-accent" : "bg-line"
              }`}
            >
              <input
                type="checkbox"
                data-koma="two-up-export"
                checked={twoUp && range !== "page"}
                disabled={busy || range === "page"}
                onChange={(e) => setTwoUp(e.target.checked)}
                className="absolute inset-0 z-10 cursor-pointer opacity-0"
              />
              <span
                className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-surface shadow-tool transition-transform duration-[var(--motion-quick)] ${
                  twoUp && range !== "page" ? "translate-x-3" : ""
                }`}
              />
            </span>
          </label>
        ) : null}
        {webtoon && paperSize !== "webtoon" ? (
          <button
            type="button"
            data-koma="export-use-webtoon-page"
            disabled={busy}
            onClick={() => useStudio.getState().setPaperSize("webtoon")}
            className="mt-3 w-full rounded-[9px] bg-ink/5 px-3 py-2 text-left text-[12px] font-medium text-ink hover:bg-ink/8"
          >
            Switch page to Webtoon (800 × 1280)
          </button>
        ) : null}
        <p
          className="mt-2 text-[11px] leading-relaxed text-muted"
          data-koma="export-hint"
        >
          {format === "strip"
            ? estimate.stripFiles > 1
              ? `${estimate.pageCount} pages → ${estimate.stripFiles} strip files, 800 × ${estimate.stripHeight.toLocaleString()} px total.`
              : `${estimate.pageCount} page${estimate.pageCount === 1 ? "" : "s"} → one 800 × ${estimate.stripHeight.toLocaleString()} px scroll.`
            : format === "canvas"
              ? `${estimate.canvasCuts} JPEG cut${estimate.canvasCuts === 1 ? "" : "s"}, 800px wide, numbered for WEBTOON Canvas.`
              : range === "page"
                ? "This page as a single sheet."
                : twoUp
                  ? spread || range === "spread"
                    ? "Cover stays portrait; interiors export as landscape spreads with folio numbers."
                    : "Cover stays portrait; interiors pair into landscape spreads."
                  : "One portrait page after another, with folio numbers."}
        </p>
        {error ? (
          <p className="mt-3 text-[12px] text-hanko">{error}</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || selectedPages.length === 0}
            data-koma="export-run"
            onClick={() => {
              setBusy(true);
              setError(null);
              setProgress({ done: 0, total: selectedPages.length });
              void runExport(format, range, twoUp, (done, total) =>
                setProgress({ done, total }),
              )
                .then((name) => {
                  writePrefs({
                    exportFormat: format,
                    exportRange: range,
                    exportTwoUp: twoUp,
                  });
                  toast.success(`Saved ${name}`);
                  onClose();
                })
                .catch((err) =>
                  setError(err instanceof Error ? err.message : "Export failed"),
                )
                .finally(() => {
                  setBusy(false);
                  setProgress(null);
                });
            }}
          >
            <span data-koma="export-progress">{progressLabel}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
