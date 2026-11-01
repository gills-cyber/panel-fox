/** Assemble the project document in Panel Fox's own shape (the same as a .koma file). */
import { ALLOWED_BALLOON_STYLES, type Overlay, type ScriptLine } from "./bubbles.ts";
import type { StoryConfig } from "./config.ts";
import type { View } from "./crop.ts";
import { dataUrl, type ImageFile } from "./imageutil.ts";
import type { Page } from "./layout.ts";

export const MAKER_VERSION = "2.0.0";

const SCRIPT_KINDS = ["speech", "thought", "narration", "shout", "whisper", "scream"];
const OVERLAY_KINDS = [...SCRIPT_KINDS, "title", "sticker", "sfx", "tone", "text"];
const PAPER_TONES = ["cream", "white", "newsprint"];
const OVERLAY_FIELDS = ["id", "kind", "x", "y", "w", "h", "text", "fontSize", "bold", "italic", "color", "tailX", "tailY", "balloonStyle", "scriptLineId", "speakerId"];
const OVERLAY_DEFAULTS: Record<string, unknown> = {
  fontSize: 11, bold: false, italic: false, color: "#161412", tailX: 50.0, tailY: 128.0, balloonStyle: "oval",
};
const PANEL_IMAGE_FIELDS = ["src", "zoom", "focusX", "focusY", "fit", "brightness", "contrast", "rotate", "flipX", "flipY"];

export function panelImage(src: string, view: View | null) {
  return {
    src,
    zoom: view?.zoom ?? 1,
    focusX: view?.focusX ?? 50,
    focusY: view?.focusY ?? 50,
    fit: "cover" as const,
    brightness: 100,
    contrast: 100,
    rotate: 0,
    flipX: false,
    flipY: false,
  };
}

function withOverlayDefaults(o: Overlay): Overlay {
  const out = { ...o } as Record<string, unknown>;
  for (const [k, v] of Object.entries(OVERLAY_DEFAULTS)) if (out[k] === null || out[k] === undefined) out[k] = v;
  if (!("speakerId" in out)) out.speakerId = null;
  if (!ALLOWED_BALLOON_STYLES.includes(out.balloonStyle as string)) out.balloonStyle = "oval";
  return out as Overlay;
}

export type KomaFile = {
  kind: "koma-project";
  version: 1;
  name: string;
  savedAt: string;
  generator: string;
  doc: Record<string, unknown> & { pages: Record<string, unknown>[] };
};

export function buildKoma(
  name: string,
  cfg: StoryConfig,
  pages: Page[],
  lines: ScriptLine[],
  overlays: Map<string, Overlay[]>,
  images: Map<string, ImageFile>,
  rtl = true,
): KomaFile {
  const cache = new Map<string, string>();
  const src = (n: string) => {
    let v = cache.get(n);
    if (v === undefined) {
      v = dataUrl(images.get(n)!);
      cache.set(n, v);
    }
    return v;
  };
  const outPages: Record<string, unknown>[] = [];
  const overlayForLine = new Map<string, string>();
  for (const p of pages) {
    const pageOverlays = (overlays.get(p.id) ?? []).map(withOverlayDefaults);
    for (const o of pageOverlays) if (o.scriptLineId) overlayForLine.set(o.scriptLineId, o.id);
    outPages.push({
      id: p.id,
      title: p.title,
      templateId: "blank",
      panels: p.panels.map((pn) => ({
        id: pn.id,
        x: pn.x,
        y: pn.y,
        w: pn.w,
        h: pn.h,
        image: panelImage(src(pn.item.name), pn.view),
        rect: { x: pn.x, y: pn.y, w: pn.w, h: pn.h },
      })),
      overlays: pageOverlays,
    });
  }
  const script = lines.map((l) => ({
    id: l.id,
    speakerId: l.speaker_id,
    kind: l.kind,
    text: l.text,
    pageId: l.page_id,
    overlayId: overlayForLine.get(l.id) ?? null,
  }));
  const cast = cfg.characters.map((c) => {
    const m: Record<string, unknown> = { id: c.id, name: c.name, color: c.color };
    if (c.reference) m.portrait = dataUrl(c.reference);
    return m;
  });
  const doc = {
    pages: outPages,
    currentPageId: outPages.length ? (outPages[0]!.id as string) : "",
    gutter: 0.9,
    margin: 3.2,
    border: 0.22,
    paper: "white",
    paperSize: "a4",
    bleed: 0,
    rtl,
    showNumbers: true,
    projectId: null,
    projectName: name,
    script,
    cast,
    chapters: [],
    book: { title: name, author: "", series: "", volume: "", coverFirst: false },
  };
  return {
    kind: "koma-project",
    version: 1,
    name,
    savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    generator: `Panel Fox Manga Maker ${MAKER_VERSION}`,
    doc,
  };
}

function num(v: unknown): v is number {
  return typeof v === "number";
}

/** Check the document against Panel Fox's types. Returns a list of problems. */
export function validateKoma(file: KomaFile): string[] {
  const errs: string[] = [];
  if (file.kind !== "koma-project" || file.version !== 1) errs.push("bad kind/version");
  const d = (file.doc ?? {}) as Record<string, any>;
  for (const key of ["pages", "script", "cast"]) if (!Array.isArray(d[key])) errs.push(`doc.${key} missing`);
  if (!d.pages?.length) errs.push("doc.pages is empty (the editor refuses the file)");
  for (const key of ["gutter", "margin", "border"]) if (!num(d[key])) errs.push(`doc.${key} must be a number`);
  for (const key of ["rtl", "showNumbers"]) if (typeof d[key] !== "boolean") errs.push(`doc.${key} must be true/false`);
  if (!PAPER_TONES.includes(d.paper)) errs.push("doc.paper must be cream, white or newsprint");
  const pages = (d.pages ?? []) as any[];
  const pageIds = new Set(pages.map((p) => p.id));
  if (!pageIds.has(d.currentPageId)) errs.push("doc.currentPageId is not a page");
  const cast = (d.cast ?? []) as any[];
  const castIds = new Set(cast.map((c) => c.id));
  if (castIds.size !== cast.length) errs.push("doc.cast has two members with the same id");
  for (const c of cast) {
    if (!["id", "name", "color"].every((k) => typeof c[k] === "string")) errs.push(`cast ${c.id}: needs id, name, color`);
  }
  const overlayPage = new Map<string, string>();
  for (const p of pages) for (const o of p.overlays ?? []) overlayPage.set(o.id, p.id);
  const linePage = new Map<string, string>();
  for (const l of (d.script ?? []) as any[]) {
    if (linePage.has(l.id)) errs.push(`line ${l.id}: duplicate id`);
    linePage.set(l.id, l.pageId);
    if (!SCRIPT_KINDS.includes(l.kind)) errs.push(`line ${l.id}: bad kind ${l.kind}`);
    if (!pageIds.has(l.pageId)) errs.push(`line ${l.id}: pageId ${l.pageId} is not a page`);
    if (l.speakerId !== null && l.speakerId !== undefined && !castIds.has(l.speakerId)) errs.push(`line ${l.id}: unknown speaker`);
    if (!("overlayId" in l)) errs.push(`line ${l.id}: missing overlayId`);
    else if (l.overlayId !== null && overlayPage.get(l.overlayId) !== l.pageId) errs.push(`line ${l.id}: overlayId is not a bubble on its page`);
  }
  for (const p of pages) {
    for (const k of ["id", "title", "overlays", "panels"]) if (!(k in p)) errs.push(`page ${p.id}: missing ${k}`);
    if (typeof p.templateId !== "string") errs.push(`page ${p.id}: templateId must be a string`);
    if (p.templateId === "blank" && !p.panels?.length) errs.push(`page ${p.id}: freeform page has no panels`);
    for (const pn of p.panels ?? []) {
      const r = pn.rect;
      if (p.templateId === "blank") {
        if (!r || !["x", "y", "w", "h"].every((k) => num(r[k]) && r[k] >= 0 && r[k] <= 100)) {
          errs.push(`panel ${pn.id}: freeform panel needs rect x/y/w/h in 0-100`);
        }
      }
      const img = pn.image;
      if (img !== null && img !== undefined) {
        const missing = PANEL_IMAGE_FIELDS.filter((k) => !(k in img));
        if (missing.length) errs.push(`panel ${pn.id}: image missing ${missing}`);
        if (!String(img.src ?? "").startsWith("data:image/")) errs.push(`panel ${pn.id}: image is not a data URL`);
        if (!["cover", "contain"].includes(img.fit)) errs.push(`panel ${pn.id}: bad fit`);
        if (!(num(img.zoom) && img.zoom >= 0.02 && img.zoom <= 4)) errs.push(`panel ${pn.id}: zoom must be 0.02-4 (PanelFox's range)`);
        for (const k of ["focusX", "focusY"]) if (!(num(img[k]) && img[k] >= 0 && img[k] <= 100)) errs.push(`panel ${pn.id}: ${k} must be 0-100`);
      }
    }
    for (const o of p.overlays ?? []) {
      for (const k of OVERLAY_FIELDS) if (!(k in o)) errs.push(`overlay ${o.id}: missing ${k}`);
      if (!OVERLAY_KINDS.includes(o.kind)) errs.push(`overlay ${o.id}: bad kind ${o.kind}`);
      if (!ALLOWED_BALLOON_STYLES.includes(o.balloonStyle)) errs.push(`overlay ${o.id}: balloonStyle ${o.balloonStyle} not allowed`);
      // decorations (stickers and the like) belong to no line
      if (!SCRIPT_KINDS.includes(o.kind) && o.scriptLineId === null) {
        /* fine */
      } else if (!linePage.has(o.scriptLineId)) errs.push(`overlay ${o.id}: scriptLineId ${o.scriptLineId} is not a line`);
      else if (linePage.get(o.scriptLineId) !== p.id) errs.push(`overlay ${o.id}: its line belongs to another page`);
      for (const k of ["tailX", "tailY", "fontSize"]) if (!num(o[k])) errs.push(`overlay ${o.id}: ${k} must be a number`);
      for (const k of ["x", "y", "w", "h"]) {
        const v = o[k];
        if (!num(v) || v < 0 || v > 100) errs.push(`overlay ${o.id}: ${k}=${v} out of range`);
      }
    }
  }
  return errs;
}
