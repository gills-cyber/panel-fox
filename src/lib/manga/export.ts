import { boxesForPage } from "./templates";
import { paperSpec, type PaperSizeId } from "./paper";
import { drawFitted, imageFilter, loadHtmlImage, tiltCover } from "./image";
import { drawOverlay, ensureComicFont, pageOverlays, pageTitle, chainGroups, chainConnectorPath, isChainTail, isChained, THOUGHT_CLOUD, overlayOpacity, tintsRaster } from "./lettering";
import { balloonStyleOf, burstPath, balloonEllipse } from "./balloons";
import type { Overlay, PageState, PaperTone, BookInfo, Chapter } from "./types";
import { zipStore } from "./zip";
import { jpegPagesToPdf } from "./pdf";
import {
  bookDisplayTitle,
  comicInfoXml,
  exportSpreadsFor,
  pageFolio,
  type BookRange,
} from "./book";
import {
  packVerticalCuts,
  tileHeight,
  WEBTOON_MAX_CUT,
  WEBTOON_MIN_CUT,
  WEBTOON_SAFE_EDGE,
  WEBTOON_WIDTH,
  type WebtoonBlit,
} from "./webtoon";

export type ExportProgress = (done: number, total: number) => void;

const PAPER: Record<PaperTone, string> = {
  cream: "#f3eee6",
  white: "#f6f5f1",
  newsprint: "#e7dcc6",
};

export type ExportFormat = "png" | "jpeg" | "pdf" | "cbz" | "strip" | "canvas";
export type ExportRange = BookRange;

export type ExportOpts = {
  page: PageState;
  gutter: number;
  margin: number;
  border: number;
  paper: PaperTone;
  rtl: boolean;
  paperSize?: PaperSizeId;
  bleed?: number;
  width?: number;
  folio?: string;
  pixelScale?: number;
};

export type ExportBookOpts = {
  twoUp?: boolean;
  book?: BookInfo;
  chapters?: Chapter[];
  allPages?: PageState[];
  fallbackTitle?: string;
  onProgress?: ExportProgress;
};

const imageCache = new Map<string, Promise<HTMLImageElement>>();
let exportSession = 0;

function beginExportImages() {
  if (exportSession === 0) imageCache.clear();
  exportSession += 1;
}

function endExportImages() {
  exportSession = Math.max(0, exportSession - 1);
  if (exportSession === 0) imageCache.clear();
}

async function withExportSession<T>(fn: () => Promise<T>): Promise<T> {
  beginExportImages();
  try {
    return await fn();
  } finally {
    endExportImages();
  }
}

function loadExportImage(src: string) {
  let hit = imageCache.get(src);
  if (!hit) {
    hit = loadHtmlImage(src);
    imageCache.set(src, hit);
  }
  return hit;
}

function yieldUi() {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function tick(onProgress: ExportProgress | undefined, done: number, total: number) {
  onProgress?.(done, total);
  await yieldUi();
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

async function renderPageCanvas(opts: ExportOpts) {
  const spec = paperSpec(opts.paperSize ?? "a4");
  const width = opts.width ?? (spec.id === "webtoon" ? WEBTOON_WIDTH : 1240);
  const height = Math.round(width * (spec.h / spec.w));
  const bleedPct = Math.max(0, opts.bleed ?? 0);
  const bleedPx = (bleedPct / 100) * width;
  const scale = Math.max(1, opts.pixelScale ?? 2);
  const canvas = document.createElement("canvas");
  canvas.width = (width + bleedPx * 2) * scale;
  canvas.height = (height + bleedPx * 2) * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not export");
  ctx.scale(scale, scale);

  ctx.fillStyle = PAPER[opts.paper];
  ctx.fillRect(0, 0, width + bleedPx * 2, height + bleedPx * 2);
  ctx.translate(bleedPx, bleedPx);
  await ensureComicFont();

  const laid = boxesForPage(opts.page, opts.margin, opts.gutter, opts.rtl);
  const byId = new Map(opts.page.panels.map((p) => [p.id, p]));
  const borderPx = (opts.border / 100) * width;
  const overlays = pageOverlays(opts.page).filter((o) => !o.hidden);

  for (const box of laid) {
    const x = (box.x / 100) * width;
    const y = (box.y / 100) * height;
    const w = (box.w / 100) * width;
    const h = (box.h / 100) * height;
    const panel = byId.get(box.id);
    const shape = panel?.shape ?? "rect";
    const tilt = panel?.rotate ?? 0;
    const cover = tiltCover(tilt, w / Math.max(h, 1));

    ctx.save();
    if (tilt) {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate((tilt * Math.PI) / 180);
      ctx.translate(-(x + w / 2), -(y + h / 2));
    }
    ctx.beginPath();
    if (shape === "circle") {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (shape === "round") {
      const r = Math.min(w, h) * 0.14;
      ctx.roundRect(x, y, w, h, r);
    } else if (shape === "break") {
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y - h * 0.18);
      ctx.lineTo(x + w, y - h * 0.12);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.clip();

    ctx.fillStyle = PAPER[opts.paper];
    ctx.fillRect(x - 8, y - h * 0.2, w + 16, h * 1.3);

    const layers = [panel?.background, panel?.image].filter(Boolean);
    for (const pic of layers) {
      if (!pic) continue;
      try {
        const img = await loadExportImage(pic.src);
        drawFitted(
          ctx,
          img,
          img.naturalWidth,
          img.naturalHeight,
          x,
          y,
          w,
          h,
          pic === panel?.background ? "cover" : pic.fit,
          (pic === panel?.background ? 1 : pic.zoom) * cover,
          pic.focusX,
          pic.focusY,
          imageFilter(pic),
          (pic === panel?.background ? 0 : pic.rotate ?? 0) - tilt,
          pic === panel?.background ? false : pic.flipX ?? false,
          pic === panel?.background ? false : pic.flipY ?? false,
        );
      } catch {
        /* leave paper if a source fails */
      }
    }

    if (borderPx > 0) {
      ctx.strokeStyle = "#161412";
      ctx.lineWidth = Math.max(1.6, borderPx);
      ctx.beginPath();
      if (shape === "circle") {
        ctx.ellipse(x + w / 2, y + h / 2, w / 2 - borderPx / 2, h / 2 - borderPx / 2, 0, 0, Math.PI * 2);
      } else if (shape === "round") {
        const r = Math.max(0, Math.min(w, h) * 0.14 - borderPx / 2);
        ctx.roundRect(x + borderPx / 2, y + borderPx / 2, Math.max(0, w - borderPx), Math.max(0, h - borderPx), r);
      } else if (shape === "break") {
        ctx.moveTo(x + borderPx / 2, y + h - borderPx / 2);
        ctx.lineTo(x + borderPx / 2, y - h * 0.18);
        ctx.lineTo(x + w - borderPx / 2, y - h * 0.12);
        ctx.lineTo(x + w - borderPx / 2, y + h - borderPx / 2);
        ctx.closePath();
      } else {
        ctx.rect(
          x + borderPx / 2,
          y + borderPx / 2,
          Math.max(0, w - borderPx),
          Math.max(0, h - borderPx),
        );
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  await paintOverlays(
    ctx,
    overlays.filter((o) => o.behind),
    width,
    height,
  );

  await paintOverlays(
    ctx,
    overlays.filter((o) => !o.behind),
    width,
    height,
  );

  if (opts.folio) {
    ctx.save();
    ctx.fillStyle = "rgba(22, 20, 18, 0.52)";
    const size = Math.max(11, Math.round(width * 0.013));
    ctx.font = `${size}px "Times New Roman", Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(opts.folio, width / 2, height - Math.max(12, height * 0.016));
    ctx.restore();
  }

  return { canvas, width: canvas.width, height: canvas.height };
}

async function paintOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: Overlay[],
  width: number,
  height: number,
) {
  if (!overlays.length) return;
  ctx.save();
  ctx.scale(width / 100, height / 100);
  for (const group of chainGroups(overlays)) {
    const fill = group[0]?.fill || "#ffffff";
    const stroke = group[0]?.stroke || "#161412";
    const paint = (mode: "stroke" | "fill") => {
      if (mode === "stroke") {
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.05;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
      } else {
        ctx.fillStyle = fill;
        ctx.strokeStyle = "rgba(0,0,0,0)";
        ctx.lineWidth = 0;
      }
      for (let i = 0; i < group.length - 1; i++) {
        const path = new Path2D(chainConnectorPath(group[i]!, group[i + 1]!));
        if (mode === "fill") ctx.fill(path);
        else ctx.stroke(path);
      }
      for (const o of group) {
        const style = balloonStyleOf(o);
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.scale(o.w / 100, o.h / 100);
        if (style === "whisper") ctx.setLineDash(mode === "stroke" ? [2.2, 1.8] : []);
        if (style === "cloud") {
          const cloud = new Path2D(THOUGHT_CLOUD);
          if (mode === "fill") ctx.fill(cloud);
          else ctx.stroke(cloud);
        } else if (style === "burst" || style === "spike") {
          const path = new Path2D(
            burstPath(style === "spike" ? 22 : 16, style === "spike" ? 0.22 : 0.16),
          );
          if (mode === "fill") ctx.fill(path);
          else ctx.stroke(path);
        } else {
          const e = balloonEllipse(style);
          ctx.beginPath();
          if (style === "rect" || style === "box") {
            ctx.roundRect(
              e.cx - e.rx,
              e.cy - e.ry,
              e.rx * 2,
              e.ry * 2,
              Math.min(e.rx, e.ry) * 0.28,
            );
          } else {
            ctx.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2);
          }
          if (mode === "fill") ctx.fill();
          else ctx.stroke();
          if (style === "radio" && mode === "stroke") {
            ctx.beginPath();
            ctx.ellipse(e.cx, e.cy, e.rx * 0.82, e.ry * 0.78, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.setLineDash([]);
        ctx.restore();
      }
    };
    paint("stroke");
    paint("fill");
  }
  ctx.restore();

  for (const overlay of overlays) {
    if (overlay.kind === "sticker" && overlay.src) {
      try {
        const img = await loadExportImage(overlay.src);
        const x = (overlay.x / 100) * width;
        const y = (overlay.y / 100) * height;
        const w = (overlay.w / 100) * width;
        const h = (overlay.h / 100) * height;
        const rot = overlay.rotate ?? 0;
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        if (rot) ctx.rotate((rot * Math.PI) / 180);
        ctx.globalAlpha = overlayOpacity(overlay);
        const iw = img.naturalWidth || 1;
        const ih = img.naturalHeight || 1;
        const scale = Math.min(w / iw, h / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        if (tintsRaster(overlay.color)) {
          // tint on a separate canvas, so only the mark's own shape takes the colour
          const k = Math.max(1, Math.min(4, Math.ceil(Math.max(dw / iw, dh / ih) * 2)));
          const off = document.createElement("canvas");
          off.width = Math.max(1, Math.round(dw * k));
          off.height = Math.max(1, Math.round(dh * k));
          const o = off.getContext("2d")!;
          o.drawImage(img, 0, 0, off.width, off.height);
          o.globalCompositeOperation = "source-in";
          o.fillStyle = overlay.color;
          o.fillRect(0, 0, off.width, off.height);
          ctx.drawImage(off, -dw / 2, -dh / 2, dw, dh);
        } else {
          ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        }
        ctx.restore();
      } catch {
        /* skip broken custom mark */
      }
      continue;
    }
    drawOverlay(ctx, overlay, width, height, {
      showTail: isChainTail(overlay, overlays),
      skipShape: isChained(overlay, overlays),
    });
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode image"))),
      mime,
      quality,
    );
  });
}

export async function exportPagePng(opts: ExportOpts): Promise<Blob> {
  return withExportSession(async () => {
    const { canvas } = await renderPageCanvas(opts);
    const blob = await canvasToBlob(canvas, "image/png");
    releaseCanvas(canvas);
    return blob;
  });
}

export async function exportPageJpeg(opts: ExportOpts): Promise<Blob> {
  return withExportSession(async () => {
    const { canvas } = await renderPageCanvas(opts);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    releaseCanvas(canvas);
    return blob;
  });
}

export async function exportPageBlob(
  opts: ExportOpts,
  format: "png" | "jpeg",
): Promise<Blob> {
  return format === "jpeg" ? exportPageJpeg(opts) : exportPagePng(opts);
}

async function canvasJpegBytes(opts: ExportOpts): Promise<{
  jpeg: Uint8Array;
  width: number;
  height: number;
}> {
  const { canvas, width, height } = await renderPageCanvas(opts);
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
  releaseCanvas(canvas);
  return {
    jpeg: new Uint8Array(await blob.arrayBuffer()),
    width,
    height,
  };
}

async function renderSpreadCanvas(
  left: PageState | null,
  right: PageState | null,
  opts: Omit<ExportOpts, "page">,
  folios: { left?: string; right?: string },
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const leftR = left
    ? await renderPageCanvas({ ...opts, page: left, folio: folios.left })
    : null;
  const rightR = right
    ? await renderPageCanvas({ ...opts, page: right, folio: folios.right })
    : null;
  const w = leftR?.width ?? rightR?.width ?? 1240;
  const h = leftR?.height ?? rightR?.height ?? 1754;
  const canvas = document.createElement("canvas");
  canvas.width = w * 2;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not export");
  ctx.fillStyle = PAPER[opts.paper];
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (leftR) ctx.drawImage(leftR.canvas, 0, 0);
  if (rightR) ctx.drawImage(rightR.canvas, w, 0);
  if (leftR) releaseCanvas(leftR.canvas);
  if (rightR) releaseCanvas(rightR.canvas);
  return { canvas, width: canvas.width, height: canvas.height };
}

async function spreadJpegBytes(
  left: PageState | null,
  right: PageState | null,
  opts: Omit<ExportOpts, "page">,
  folios: { left?: string; right?: string },
) {
  const { canvas, width, height } = await renderSpreadCanvas(
    left,
    right,
    opts,
    folios,
  );
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
  releaseCanvas(canvas);
  return {
    jpeg: new Uint8Array(await blob.arrayBuffer()),
    width,
    height,
  };
}

function folioFor(
  page: PageState | null,
  allPages: PageState[],
  coverFirst: boolean,
) {
  if (!page) return undefined;
  return pageFolio(allPages, page.id, coverFirst);
}

function slugTitle(page: PageState) {
  return (
    pageTitle(page)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "koma"
  );
}

export function pageFileName(page: PageState, index: number, ext: string) {
  return `${slugTitle(page)}-page-${index}.${ext}`;
}

function withFolio(
  page: PageState,
  opts: Omit<ExportOpts, "page">,
  allPages: PageState[],
  coverFirst: boolean,
): ExportOpts {
  return {
    ...opts,
    page,
    folio: folioFor(page, allPages, coverFirst),
  };
}

export async function exportPagesZip(
  pages: PageState[],
  opts: Omit<ExportOpts, "page">,
  format: "png" | "jpeg" = "png",
  book?: ExportBookOpts,
): Promise<Blob> {
  return withExportSession(async () => {
    const files: { name: string; data: Uint8Array }[] = [];
    const ext = format === "jpeg" ? "jpg" : "png";
    const allPages = book?.allPages ?? pages;
    const coverFirst = book?.book?.coverFirst ?? true;
    const total = pages.length;
    for (let i = 0; i < pages.length; i++) {
      await tick(book?.onProgress, i, total);
      const page = pages[i]!;
      const blob = await exportPageBlob(
        withFolio(page, opts, allPages, coverFirst),
        format,
      );
      files.push({
        name: pageFileName(page, i + 1, ext),
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    await tick(book?.onProgress, total, total);
    return zipStore(files);
  });
}

export async function exportPagesCbz(
  pages: PageState[],
  opts: Omit<ExportOpts, "page">,
  book?: ExportBookOpts,
): Promise<Blob> {
  return withExportSession(async () => {
    const files: { name: string; data: Uint8Array }[] = [];
    const allPages = book?.allPages ?? pages;
    const coverFirst = book?.book?.coverFirst ?? true;
    const info = book?.book;
    const fallback = book?.fallbackTitle ?? "Untitled";
    const xml = comicInfoXml(info ?? { title: fallback, author: "", series: "", volume: "", coverFirst }, pages, book?.chapters ?? [], {
      rtl: opts.rtl,
      fallbackTitle: fallback,
    });
    files.push({
      name: "ComicInfo.xml",
      data: new TextEncoder().encode(xml),
    });

    if (book?.twoUp) {
      const slots = exportSpreadsFor(pages, allPages, {
        coverFirst,
        rtl: opts.rtl,
      });
      let n = 1;
      for (let i = 0; i < slots.length; i++) {
        await tick(book?.onProgress, i, slots.length);
        const slot = slots[i]!;
        if (slot.isCover && slot.reading[0]) {
          const blob = await exportPageJpeg(
            withFolio(slot.reading[0], opts, allPages, coverFirst),
          );
          files.push({
            name: `${String(n).padStart(3, "0")}.jpg`,
            data: new Uint8Array(await blob.arrayBuffer()),
          });
          n += 1;
          continue;
        }
        const { jpeg } = await spreadJpegBytes(slot.left, slot.right, opts, {
          left: folioFor(slot.left, allPages, coverFirst),
          right: folioFor(slot.right, allPages, coverFirst),
        });
        files.push({
          name: `${String(n).padStart(3, "0")}.jpg`,
          data: jpeg,
        });
        n += 1;
      }
      await tick(book?.onProgress, slots.length, slots.length);
    } else {
      for (let i = 0; i < pages.length; i++) {
        await tick(book?.onProgress, i, pages.length);
        const page = pages[i]!;
        const blob = await exportPageJpeg(
          withFolio(page, opts, allPages, coverFirst),
        );
        const n = String(i + 1).padStart(3, "0");
        files.push({
          name: `${n}.jpg`,
          data: new Uint8Array(await blob.arrayBuffer()),
        });
      }
      await tick(book?.onProgress, pages.length, pages.length);
    }
    const zip = zipStore(files);
    return new Blob([await zip.arrayBuffer()], {
      type: "application/vnd.comicbook+zip",
    });
  });
}

export async function exportPagesPdf(
  pages: PageState[],
  opts: Omit<ExportOpts, "page">,
  book?: ExportBookOpts,
): Promise<Blob> {
  return withExportSession(async () => {
    const allPages = book?.allPages ?? pages;
    const coverFirst = book?.book?.coverFirst ?? true;
    const title = bookDisplayTitle(
      book?.book ?? {
        title: "",
        author: "",
        series: "",
        volume: "",
        coverFirst,
      },
      book?.fallbackTitle ?? "Untitled",
    );
    const author = book?.book?.author?.trim() ?? "";
    const jpegs = [];
    if (book?.twoUp) {
      const slots = exportSpreadsFor(pages, allPages, {
        coverFirst,
        rtl: opts.rtl,
      });
      for (let i = 0; i < slots.length; i++) {
        await tick(book?.onProgress, i, slots.length);
        const slot = slots[i]!;
        if (slot.isCover && slot.reading[0]) {
          jpegs.push(
            await canvasJpegBytes(
              withFolio(slot.reading[0], opts, allPages, coverFirst),
            ),
          );
          continue;
        }
        jpegs.push(
          await spreadJpegBytes(slot.left, slot.right, opts, {
            left: folioFor(slot.left, allPages, coverFirst),
            right: folioFor(slot.right, allPages, coverFirst),
          }),
        );
      }
      await tick(book?.onProgress, slots.length, slots.length);
    } else {
      for (let i = 0; i < pages.length; i++) {
        await tick(book?.onProgress, i, pages.length);
        jpegs.push(
          await canvasJpegBytes(withFolio(pages[i]!, opts, allPages, coverFirst)),
        );
      }
      await tick(book?.onProgress, pages.length, pages.length);
    }
    return jpegPagesToPdf(jpegs, { title, author });
  });
}

function webtoonOpts(opts: Omit<ExportOpts, "page">): Omit<ExportOpts, "page"> {
  return {
    ...opts,
    width: WEBTOON_WIDTH,
    bleed: 0,
    pixelScale: 1,
  };
}

async function renderWebtoonPages(
  pages: PageState[],
  opts: Omit<ExportOpts, "page">,
  onProgress?: ExportProgress,
) {
  const base = webtoonOpts(opts);
  const rendered: { canvas: HTMLCanvasElement; width: number; height: number }[] =
    [];
  for (let i = 0; i < pages.length; i++) {
    await tick(onProgress, i, pages.length);
    rendered.push(
      await renderPageCanvas({
        ...base,
        page: pages[i]!,
        folio: undefined,
      }),
    );
  }
  return rendered;
}

function composeBlits(
  sources: { canvas: HTMLCanvasElement; width: number; height: number }[],
  blits: WebtoonBlit[],
  paper: PaperTone,
  minHeight = 0,
) {
  const width = sources[0]?.width ?? WEBTOON_WIDTH;
  const height = tileHeight(blits, minHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not export");
  ctx.fillStyle = PAPER[paper];
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const blit of blits) {
    const src = sources[blit.src];
    if (!src) continue;
    ctx.drawImage(
      src.canvas,
      0,
      blit.sy,
      src.width,
      blit.sh,
      0,
      y,
      width,
      blit.sh,
    );
    y += blit.sh;
  }
  return canvas;
}

export async function exportWebtoonStrip(
  pages: PageState[],
  opts: Omit<ExportOpts, "page">,
  onProgress?: ExportProgress,
): Promise<{ blob: Blob; filename: string; tiles: number }> {
  return withExportSession(async () => {
    if (!pages.length) throw new Error("Nothing to export");
    const rendered = await renderWebtoonPages(pages, opts, onProgress);
    const tiles = packVerticalCuts(
      rendered.map((r) => r.height),
      Math.min(WEBTOON_SAFE_EDGE, WEBTOON_MAX_CUT),
    );
    if (!tiles.length) throw new Error("Nothing to export");
    if (tiles.length === 1) {
      const canvas = composeBlits(rendered, tiles[0]!, opts.paper);
      for (const r of rendered) releaseCanvas(r.canvas);
      const blob = await canvasToBlob(canvas, "image/png");
      releaseCanvas(canvas);
      await tick(onProgress, pages.length, pages.length);
      return { blob, filename: "webtoon-strip.png", tiles: 1 };
    }
    const files: { name: string; data: Uint8Array }[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const canvas = composeBlits(rendered, tiles[i]!, opts.paper);
      const blob = await canvasToBlob(canvas, "image/png");
      releaseCanvas(canvas);
      files.push({
        name: `strip-${String(i + 1).padStart(2, "0")}.png`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    for (const r of rendered) releaseCanvas(r.canvas);
    await tick(onProgress, pages.length, pages.length);
    return {
      blob: zipStore(files),
      filename: "webtoon-strip.zip",
      tiles: tiles.length,
    };
  });
}

export async function exportWebtoonCanvas(
  pages: PageState[],
  opts: Omit<ExportOpts, "page">,
  onProgress?: ExportProgress,
): Promise<Blob> {
  return withExportSession(async () => {
    if (!pages.length) throw new Error("Nothing to export");
    const base = webtoonOpts(opts);
    const files: { name: string; data: Uint8Array }[] = [];
    let n = 1;
    for (let i = 0; i < pages.length; i++) {
      await tick(onProgress, i, pages.length);
      const page = await renderPageCanvas({
        ...base,
        page: pages[i]!,
        folio: undefined,
      });
      const chunks = packVerticalCuts([page.height], WEBTOON_MAX_CUT);
      for (const blits of chunks) {
        const canvas = composeBlits([page], blits, opts.paper, WEBTOON_MIN_CUT);
        let out = canvas;
        if (canvas.width !== WEBTOON_WIDTH) {
          const scaled = document.createElement("canvas");
          scaled.width = WEBTOON_WIDTH;
          scaled.height = Math.round(
            (canvas.height / canvas.width) * WEBTOON_WIDTH,
          );
          const ctx = scaled.getContext("2d");
          if (!ctx) throw new Error("Could not export");
          ctx.fillStyle = PAPER[opts.paper];
          ctx.fillRect(0, 0, scaled.width, scaled.height);
          ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
          releaseCanvas(canvas);
          out = scaled;
        }
        const blob = await canvasToBlob(out, "image/jpeg", 0.92);
        releaseCanvas(out);
        files.push({
          name: `${String(n).padStart(3, "0")}.jpg`,
          data: new Uint8Array(await blob.arrayBuffer()),
        });
        n += 1;
      }
      releaseCanvas(page.canvas);
    }
    await tick(onProgress, pages.length, pages.length);
    return new Blob([await zipStore(files).arrayBuffer()], {
      type: "application/zip",
    });
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  try {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    const ios =
      /iPad|iPhone|iPod/i.test(ua) ||
      (typeof navigator !== "undefined" &&
        navigator.platform === "MacIntel" &&
        (navigator.maxTouchPoints ?? 0) > 1);
    if (ios && typeof navigator !== "undefined" && typeof navigator.share === "function") {
      const file = new File([blob], filename, {
        type: blob.type || "application/octet-stream",
      });
      const can = !navigator.canShare || navigator.canShare({ files: [file] });
      if (can) {
        void navigator.share({ files: [file], title: filename }).catch((err) => {
          if (err && (err as Error).name === "AbortError") return;
          fallbackDownload(blob, filename);
        });
        return;
      }
    }
  } catch {
    /* fall through */
  }
  fallbackDownload(blob, filename);
}

function fallbackDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}

export function formatExt(format: ExportFormat) {
  if (format === "jpeg") return "jpg";
  if (format === "strip") return "png";
  if (format === "canvas") return "zip";
  return format;
}

export function isWebtoonExport(format: ExportFormat) {
  return format === "strip" || format === "canvas";
}
