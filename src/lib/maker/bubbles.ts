/**
 * Automatic speech-bubble placement: each line's speaker is found through the
 * panel's framing, its bubble is sized with Panel Fox's own lettering metrics,
 * candidate spots are scored (faces, bodies, words in the art, tails), and the
 * bubbles of one panel are placed together so reading order holds.
 */
import { panelWindow } from "./crop.ts";
import { BOLD, REGULAR, table } from "./glyphs.ts";
import { PAGE_H, PAGE_W, type Page, type Panel } from "./layout.ts";
import { cube, fsum, isAlnumChar, isCombining, minBy, phypot, plen, psum, pyRe, pyRound, pySplit, sq, truthy } from "./py.ts";
import type { Analysis, Box } from "./vision.ts";

export const ALLOWED_BALLOON_STYLES = ["oval", "round", "soft", "rect", "burst", "spike", "cloud", "whisper", "radio", "box"];

const BALLOON_STYLE: Record<string, string> = {
  speech: "oval",
  thought: "cloud",
  narration: "rect",
  shout: "oval",
  whisper: "oval",
  scream: "oval",
};

const FONT_MIN = 8;
export const TEXT_STYLE: Record<string, [number, boolean, boolean]> = {
  speech: [11, false, false],
  thought: [11, false, true],
  narration: [10, false, false],
  shout: [12, true, false],
  whisper: [11, false, true],
  scream: [12, true, false],
};
export const TEXT_COLOR = "#161412";
export const PAPER_FILL = "#ffffff";
export const READER_FILL = "#cfe9ff";
const NARRATION_TAIL: [number, number] = [50.0, 84.0];

export function balloonStyle(kind: string): string {
  const style = BALLOON_STYLE[kind] ?? "oval";
  return ALLOWED_BALLOON_STYLES.includes(style) ? style : "oval";
}

const SHEET_W = 210 / 297;
const LOCK_H: Record<string, number> = { speech: 12, thought: 13, narration: 12, shout: 11, whisper: 9, scream: 12 };
const LINE_HEIGHT = 1.2;
const GLYPH_H = 1.42;
const WIDTH_SAFETY = 1.03;
const LINE_MARGIN = 0.2;
const SHAPE_SLACK = 0.95;
const RECT_TEXT_Y: [number, number] = [0.15, 0.81];
const RECT_CORNERS: [number, number][] = [
  [16, 23],
  [84, 23],
  [16, 73],
  [84, 73],
];
const RECT_CORNER_R = 8.8;
const CLOUD_KINK: [number, number, number] = [0.54, 0.62, 0.255];
const MIN_W_PCT = 6.0;
const MIN_H_PCT = 3.5;

const REG = table(REGULAR);
const BLD = table(BOLD);
const ZERO_W = "​‌‍︎️";

function charW(c: string, bold = false): number {
  const w = (bold ? BLD : REG).get(c);
  if (w !== undefined) return w;
  if (isCombining(c) || ZERO_W.includes(c)) return 0;
  if (c.codePointAt(0)! >= 0x1f000) return 1.3;
  return 1.0;
}

function textW(s: string, bold = false): number {
  return fsum(Array.from(s, (c) => charW(c, bold))) * WIDTH_SAFETY;
}

export function fontPx(kind: string, font: number): number {
  const ref = kind === "narration" ? 100 : 110;
  return (font * (LOCK_H[kind] ?? 12)) / 100 / ref;
}

function isBold(kind: string): boolean {
  return (TEXT_STYLE[kind] ?? [11, false, false])[1];
}

function ellipse(style: string): [number, number, number, number] {
  if (style === "round") return [50, 50, 42, 42];
  if (style === "soft") return [50, 46, 48, 38];
  if (style === "rect" || style === "box") return [50, 48, 45, 36];
  return [50, 46, 46, 36];
}

export function textFrame(style: string, kind: string): [number, number, number, number] {
  if (kind === "narration" || style === "box" || style === "rect") return [8.0, 8.0, 11.0, 11.0];
  const [cx, cy, rx, ry] = ellipse(style);
  const inset = style === "burst" || style === "spike" ? 0.58 : style === "cloud" ? 0.64 : 0.7;
  const hw = rx * inset;
  const hh = ry * inset;
  const r1 = (v: number) => pyRound(v * 10) / 10;
  return [r1(cx - hw), r1(100 - cx - hw), r1(cy - hh), r1(100 - (cy + hh))];
}

function rectish(kind: string, style: string) {
  return kind === "narration" || style === "box" || style === "rect";
}

export function wrapLines(text: string, maxEm: number, bold = false, breakWords = false): string[] | null {
  return wrap(text, maxEm, bold, breakWords)[0];
}

function wrap(text: string, maxEm: number, bold = false, breakWords = false): [string[] | null, number] {
  const space = charW(" ", bold) * WIDTH_SAFETY;
  const lines: string[] = [];
  let nxt = Infinity;
  for (const para of (text || "").split("\n")) {
    const words = pySplit(para);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let cur = "";
    let curW = 0;
    for (const word of words) {
      const ww = textW(word, bold);
      if (ww > maxEm) {
        if (!breakWords) return [null, nxt];
        nxt = Math.min(nxt, ww);
        if (cur) lines.push(cur);
        let chunk = "";
        let chunkW = 0;
        const cps = Array.from(word);
        for (let i = 0; i < cps.length; i++) {
          const c = cps[i]!;
          const cw = charW(c, bold) * WIDTH_SAFETY;
          if (chunk && chunkW + cw > maxEm) {
            nxt = Math.min(nxt, chunkW + cw);
            const carried = closingCarry(chunk, cps.slice(i).join(""), bold);
            let carry = carried[0];
            const need = carried[1];
            if (need > maxEm) {
              nxt = Math.min(nxt, need);
              carry = "";
            }
            const ch = Array.from(chunk);
            lines.push(ch.slice(0, ch.length - plen(carry)).join(""));
            chunk = carry;
            chunkW = textW(carry, bold);
          }
          chunk += c;
          chunkW += cw;
        }
        cur = chunk;
        curW = chunkW;
      } else if (!cur) {
        cur = word;
        curW = ww;
      } else if (curW + space + ww <= maxEm) {
        cur = `${cur} ${word}`;
        curW = curW + space + ww;
      } else {
        nxt = Math.min(nxt, curW + space + ww);
        lines.push(cur);
        cur = word;
        curW = ww;
      }
    }
    lines.push(cur);
  }
  return [lines, nxt];
}

function closingCarry(chunk: string, rest: string, bold: boolean): [string, number] {
  if (Array.from(rest).some(isAlnumChar)) return ["", 0];
  const cps = Array.from(chunk);
  let j = 0;
  cps.forEach((c, k) => {
    if (isAlnumChar(c)) j = k;
  });
  if (j === 0) return ["", 0];
  const tail = cps.slice(j).join("");
  return [tail, textW(tail + rest, bold)];
}

const LONG_WORD = 12;
const SPLIT_ROOM = 0.6;

function sameLines(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function longWordSets(text: string, bold: boolean, capEm: number): string[][] {
  const words = pySplit(text);
  const longs = words.filter((w) => plen(w) >= LONG_WORD);
  const shorts = words.filter((w) => plen(w) < LONG_WORD).map((w) => textW(w, bold));
  const short = shorts.length ? Math.max(...shorts) : 0;
  if (!longs.length) return [];
  let word = longs[0]!;
  let wbest = textW(word, bold);
  for (const w of longs) {
    const x = textW(w, bold);
    if (x > wbest) {
      word = w;
      wbest = x;
    }
  }
  const m = wbest;
  let width = Math.max(short, 2 * Math.max(...Array.from(word, (c) => charW(c, bold))) * WIDTH_SAFETY);
  const out: string[][] = [];
  while (width <= capEm && width < m) {
    const [lines, nw] = wrap(text, width, bold, true);
    width = nw;
    if (lines && !out.some((o) => sameLines(o, lines))) out.push(lines);
  }
  return out;
}

type BreakMode = boolean | "long";

function lineSets(text: string, bold: boolean, capEm: number, breakWords: BreakMode = false): string[][] {
  const words = pySplit(text);
  if (!words.length) return [[""]];
  if (breakWords === "long") return longWordSets(text, bold, capEm);
  const space = charW(" ", bold) * WIDTH_SAFETY;
  let m = Math.max(...words.map((w) => textW(w, bold)));
  if (m > capEm) {
    if (!breakWords) return [];
    const out: string[][] = [];
    for (const f of [0.98, 0.9, 0.8, 0.7, 0.6]) {
      const lines = wrapLines(text, capEm * f, bold, true)!;
      if (!out.some((o) => sameLines(o, lines))) out.push(lines);
    }
    return out;
  }
  const out: string[][] = [];
  const seen = new Set<string>();
  while (m <= capEm + 1e-9) {
    const lines = wrapLines(text, m, bold, Boolean(breakWords));
    if (lines === null) break;
    const key = JSON.stringify(lines);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(lines);
    }
    let nxt: number | null = null;
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i]!;
      const b = lines[i + 1]!;
      if (a && b) {
        const need = textW(a, bold) + space + textW(pySplit(b)[0]!, bold);
        if (need > m + 1e-9 && (nxt === null || need < nxt)) nxt = need;
      }
    }
    if (nxt === null) break;
    m = nxt;
  }
  return out;
}

function inRectCorners(x: number, y: number): boolean {
  for (const [cx, cy] of RECT_CORNERS) {
    if ((x - cx) * (cx > 50 ? 1 : -1) > 0 && (y - cy) * (cy > 50 ? 1 : -1) > 0) {
      return phypot(x - cx, y - cy) <= RECT_CORNER_R;
    }
  }
  return true;
}

function fits(lines: string[], kind: string, font: number, style: string, bw: number, bh: number): boolean {
  const bold = isBold(kind);
  const px = fontPx(kind, font);
  const [left, right, top, bottom] = textFrame(style, kind);
  const fw = bw * (1 - (left + right) / 100);
  const fh = bh * (1 - (top + bottom) / 100);
  const widths = lines.map((ln) => textW(ln, bold));
  if (fw <= 0 || (Math.max(...widths) + LINE_MARGIN) * px > fw) return false;
  const lh = LINE_HEIGHT * px;
  const over = ((GLYPH_H - LINE_HEIGHT) / 2) * px;
  const n = lines.length;
  if (n * lh + 2 * over > fh) return false;
  const yTop = (bh * top) / 100 + (fh - n * lh) / 2;
  const xc = (bw * (left + (100 - left - right) / 2)) / 100;
  const rct = rectish(kind, style);
  const [ecx, ecy, erx, ery] = ellipse(style);
  const ex = (bw * ecx) / 100;
  const ey = (bh * ecy) / 100;
  const rx = ((bw * erx) / 100) * SHAPE_SLACK;
  const ry = ((bh * ery) / 100) * SHAPE_SLACK;
  for (let i = 0; i < widths.length; i++) {
    const lw = widths[i]!;
    if (lw <= 0) continue;
    const half = (lw * px) / 2;
    const y0 = yTop + i * lh - over;
    const y1 = yTop + (i + 1) * lh + over;
    if (rct) {
      if (y0 < bh * RECT_TEXT_Y[0] || y1 > bh * RECT_TEXT_Y[1]) return false;
      for (const x of [xc - half, xc + half]) {
        for (const y of [y0, y1]) if (!inRectCorners((x / bw) * 100, (y / bh) * 100)) return false;
      }
      continue;
    }
    for (const x of [xc - half, xc + half]) {
      for (const y of [y0, y1]) {
        const nx = (x - ex) / rx;
        const ny = (y - ey) / ry;
        if (nx * nx + ny * ny > 1) return false;
      }
    }
    if (style === "cloud" && y1 > bh * CLOUD_KINK[0] && y0 < bh * CLOUD_KINK[1] && xc - half < bw * CLOUD_KINK[2]) return false;
  }
  return true;
}

function minHeight(lines: string[], kind: string, font: number, style: string, bw: number): number | null {
  const bold = isBold(kind);
  const px = fontPx(kind, font);
  const [left, right, top, bottom] = textFrame(style, kind);
  const widths = lines.map((ln) => textW(ln, bold));
  if ((Math.max(...widths) + LINE_MARGIN) * px > bw * (1 - (left + right) / 100)) return null;
  const lh = LINE_HEIGHT * px;
  const over = ((GLYPH_H - LINE_HEIGHT) / 2) * px;
  const n = lines.length;
  const block = n * lh + 2 * over;
  let h = block / (1 - (top + bottom) / 100);
  if (rectish(kind, style)) {
    const centre = (top + (100 - top - bottom) / 2) / 100;
    const room = Math.min(centre - RECT_TEXT_Y[0], RECT_TEXT_Y[1] - centre);
    return Math.max(h, block / (2 * room));
  }
  const [, , erx, ery] = ellipse(style);
  const rx = ((bw * erx) / 100) * SHAPE_SLACK;
  for (let i = 0; i < widths.length; i++) {
    const a = (widths[i]! * px) / 2;
    if (a >= rx) return null;
    const d = Math.max(Math.abs(i * lh - over - (n * lh) / 2), Math.abs((i + 1) * lh + over - (n * lh) / 2));
    h = Math.max(h, d / ((ery / 100) * SHAPE_SLACK * Math.sqrt(1 - sq(a / rx))));
  }
  return h;
}

function targetRatio(kind: string, nLines: number): number {
  if (kind === "narration") return 2.6;
  if (kind === "thought") return nLines <= 1 ? 2.0 : nLines === 2 ? 1.6 : 1.3;
  return nLines <= 1 ? 1.9 : nLines === 2 ? 1.5 : 1.25;
}

type Found = [number, number, number, string[]];

function bestSize(
  text: string,
  kind: string,
  font: number,
  style: string,
  maxWPct: number,
  maxHPct: number,
  breakWords: BreakMode = false,
): Found | null {
  const bold = isBold(kind);
  const px = fontPx(kind, font);
  const [left, right, top, bottom] = textFrame(style, kind);
  const fwShare = 1 - (left + right) / 100;
  const maxBw = (maxWPct / 100) * SHEET_W;
  const maxBh = maxHPct / 100;
  const minBw = (MIN_W_PCT / 100) * SHEET_W;
  const minBh = MIN_H_PCT / 100;
  const capEm = (maxBw * fwShare) / px - LINE_MARGIN;
  const lh = LINE_HEIGHT * px;
  const over = ((GLYPH_H - LINE_HEIGHT) / 2) * px;
  let best: Found | null = null;
  for (const lines of lineSets(text, bold, capEm, breakWords)) {
    if ((lines.length * lh + 2 * over) / (1 - (top + bottom) / 100) > maxBh + 1e-9) continue;
    const widest = Math.max(...lines.map((ln) => textW(ln, bold)));
    const bw0 = Math.max(minBw, ((widest + LINE_MARGIN) * px) / fwShare);
    for (const k of [1.0, 1.04, 1.08, 1.13, 1.19, 1.26, 1.34, 1.43, 1.55, 1.7, 1.9]) {
      const bw = bw0 * k;
      if (bw > maxBw + 1e-9) break;
      let bh = minHeight(lines, kind, font, style, bw);
      if (bh === null) continue;
      const target = targetRatio(kind, lines.length);
      bh = Math.max(bh, minBh, bw / target);
      while (bh <= maxBh && !fits(lines, kind, font, style, bw, bh)) bh *= 1.03;
      if (bh > maxBh + 1e-9) continue;
      const ratio = bw / bh;
      const score = bw * bh * Math.exp(Math.abs(Math.log(ratio / target)));
      if (best === null || score < best[0] * (1 - 1e-9)) best = [score, bw, bh, lines];
    }
  }
  if (best === null) return null;
  const [score, bw, bh, lines] = best;
  for (const grow of [1.0, 1.01, 1.03, 1.06]) {
    const wPct = roundUp((bw / SHEET_W) * 100 * grow);
    const hPct = roundUp(bh * 100 * grow);
    if (fits(lines, kind, font, style, (wPct / 100) * SHEET_W, hPct / 100)) return [score, wPct, hPct, lines];
  }
  return null;
}

/** True if the text, wrapped like the browser does, sits inside the balloon at this size (page %). */
export function textFits(text: string, kind: string, font: number, wPct: number, hPct: number, style?: string): boolean {
  const st = style || balloonStyle(kind);
  const bw = (wPct / 100) * SHEET_W;
  const bh = hPct / 100;
  const [left, right] = textFrame(st, kind);
  const maxEm = (bw * (1 - (left + right) / 100)) / fontPx(kind, font) - LINE_MARGIN;
  const lines = wrapLines(text, maxEm, isBold(kind));
  return lines !== null && fits(lines, kind, font, st, bw, bh);
}

const NOT_A_WORD = pyRe("(\\w)\\1{4,}|\\S+://|www\\.\\S+");

/** (width, height, fontSize, lettered text) so the text sits fully inside the balloon. */
export function bubbleSize(
  textIn: string,
  kind: string,
  maxW: number,
  maxH: number,
  roomW: number | null = null,
  roomH: number | null = null,
): [number, number, number, string] {
  const style = balloonStyle(kind);
  const text = pySplit(textIn || "").join(" ") || "...";
  const base = (TEXT_STYLE[kind] ?? [11, false, false])[0];
  const maxWPct = Math.max(8.0, (maxW / PAGE_W) * 100);
  const maxHPct = Math.max(5.0, (maxH / PAGE_H) * 100);
  const roomWPct = Math.max(maxWPct, ((roomW !== null ? roomW : maxW) / PAGE_W) * 100);
  const roomHPct = Math.max(maxHPct, ((roomH !== null ? roomH : maxH) / PAGE_H) * 100);
  let found: Found | null = null;
  let font = base;
  for (font = base; font >= FONT_MIN; font--) {
    found = bestSize(text, kind, font, style, maxWPct, maxHPct);
    if (found) break;
  }
  if (found) {
    /* font is the size found */
  } else if ((roomWPct !== maxWPct || roomHPct !== maxHPct) && !NOT_A_WORD.test(text)) {
    found = bestSize(text, kind, FONT_MIN, style, roomWPct, roomHPct);
    if (found) return [(found[1] / 100) * PAGE_W, (found[2] / 100) * PAGE_H, FONT_MIN, found[3].join("\n")];
  }
  if (!found) {
    for (font = base; font >= FONT_MIN; font--) {
      found = bestSize(text, kind, font, style, maxWPct, maxHPct, "long");
      if (found && (font === FONT_MIN || found[1] * found[2] <= SPLIT_ROOM * maxWPct * maxHPct)) break;
      found = null;
    }
  }
  if (!found) {
    font = FONT_MIN;
    found =
      bestSize(text, kind, font, style, maxWPct, maxHPct, true) ??
      bestSize(text, kind, font, style, roomWPct, roomHPct, "long") ??
      bestSize(text, kind, font, style, roomWPct, roomHPct, true) ??
      bestSize(text, kind, font, style, 80.0, 60.0) ??
      bestSize(text, kind, font, style, 80.0, 90.0, true);
  }
  if (!found) return [0.8 * PAGE_W, 0.6 * PAGE_H, FONT_MIN, text];
  const [, wPct, hPct, lines] = found;
  return [(wPct / 100) * PAGE_W, (hPct / 100) * PAGE_H, font, lines.join("\n")];
}

// ---------- geometry -----------------------------------------------------------

type Rect = [number, number, number, number]; // x, y, w, h (page units)
type Pt = [number, number];

function panelUnits(panel: Panel): Rect {
  return [(panel.x / 100) * PAGE_W, (panel.y / 100) * PAGE_H, (panel.w / 100) * PAGE_W, (panel.h / 100) * PAGE_H];
}

/** Map a 0-1 image point to page units through the panel's framing (outside the panel when cropped out). */
export function imageToPageRaw(panel: Panel, u: number, v: number): Pt {
  const [px, py, pw, ph] = panelUnits(panel);
  const [x0, y0, x1, y1] = panelWindow(panel) as [number, number, number, number];
  return [px + ((u - x0) / Math.max(1e-9, x1 - x0)) * pw, py + ((v - y0) / Math.max(1e-9, y1 - y0)) * ph];
}

export function imageToPage(panel: Panel, u: number, v: number): Pt {
  const [px, py, pw, ph] = panelUnits(panel);
  const [x, y] = imageToPageRaw(panel, u, v);
  return [Math.min(Math.max(x, px), px + pw), Math.min(Math.max(y, py), py + ph)];
}

function visibleRect(panel: Panel, box: Box, prect: Rect): [Rect | null, number] {
  const [px, py, pw, ph] = prect;
  const [rx1, ry1] = imageToPageRaw(panel, box[0]!, box[1]!);
  const [rx2, ry2] = imageToPageRaw(panel, box[2]!, box[3]!);
  const vx1 = Math.max(rx1, px), vy1 = Math.max(ry1, py), vx2 = Math.min(rx2, px + pw), vy2 = Math.min(ry2, py + ph);
  const vis = Math.max(0, vx2 - vx1) * Math.max(0, vy2 - vy1);
  if (vis <= 0) return [null, 0];
  return [[vx1, vy1, vx2 - vx1, vy2 - vy1], vis / Math.max(1.0, (rx2 - rx1) * (ry2 - ry1))];
}

function inside(pt: Pt, rect: Rect): boolean {
  const [px, py, pw, ph] = rect;
  return px <= pt[0] && pt[0] <= px + pw && py <= pt[1] && pt[1] <= py + ph;
}

function exitPoint(a: Pt, b: Pt, rect: Rect): Pt {
  const [px, py, pw, ph] = rect;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t = 1.0;
  if (dx > 1e-9) t = Math.min(t, (px + pw - a[0]) / dx);
  else if (dx < -1e-9) t = Math.min(t, (px - a[0]) / dx);
  if (dy > 1e-9) t = Math.min(t, (py + ph - a[1]) / dy);
  else if (dy < -1e-9) t = Math.min(t, (py - a[1]) / dy);
  t = Math.max(0, t);
  return [a[0] + dx * t, a[1] + dy * t];
}

function crosses(a: Pt, b: Pt, rects: Rect[], pad = 4.0): boolean {
  for (let k = 1; k < 12; k++) {
    const t = k / 12;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    for (const r of rects) {
      if (r[0] - pad <= x && x <= r[0] + r[2] + pad && r[1] - pad <= y && y <= r[1] + r[3] + pad) return true;
    }
  }
  return false;
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = side(c, d, a), d2 = side(c, d, b);
  const d3 = side(a, b, c), d4 = side(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function readBefore(rect: Rect, placed: Rect[], rtl = true): number {
  let n = 0;
  const cx = rect[0] + rect[2] / 2;
  for (const p of placed) {
    if (rect[1] >= p[1] + p[3] / 2) continue;
    const level = Math.abs(rect[1] - p[1]) < 0.5 * Math.min(rect[3], p[3]);
    const pcx = p[0] + p[2] / 2;
    if (level && (rtl ? cx < pcx : cx > pcx)) continue;
    n++;
  }
  return n;
}

function overlap(a: Rect, b: Rect): number {
  const dx = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const dy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

function lengthInside(a: Pt, b: Pt, rect: Rect, steps = 24): number {
  let n = 0;
  for (let k = 0; k < steps; k++) {
    if (inside([a[0] + ((b[0] - a[0]) * (k + 0.5)) / steps, a[1] + ((b[1] - a[1]) * (k + 0.5)) / steps], rect)) n++;
  }
  return (phypot(b[0] - a[0], b[1] - a[1]) * n) / steps;
}

function faceCore(panel: Panel, c: { head_box: Box | null; mouth: number[] | null }, prect: Rect): Rect | null {
  const hb = c.head_box!;
  const hw = hb[2]! - hb[0]!;
  const hh = hb[3]! - hb[1]!;
  const m = truthy(c.mouth) ? c.mouth! : [(hb[0]! + hb[2]!) / 2, hb[1]! + hh * 0.72];
  const core: Box = [
    Math.max(hb[0]!, m[0]! - 0.35 * hw),
    Math.max(hb[1]!, m[1]! - 0.45 * hh),
    Math.min(hb[2]!, m[0]! + 0.35 * hw),
    Math.min(hb[3]!, m[1]! + 0.2 * hh),
  ];
  if (core[2]! <= core[0]! || core[3]! <= core[1]!) return null;
  return visibleRect(panel, core, prect)[0];
}

function rectDist(pt: Pt, r: Rect): number {
  const dx = Math.max(r[0] - pt[0], 0, pt[0] - r[0] - r[2]);
  const dy = Math.max(r[1] - pt[1], 0, pt[1] - r[1] - r[3]);
  return phypot(dx, dy);
}

function segRectDist(a: Pt, b: Pt, r: Rect, steps = 24): number {
  let best = Infinity;
  for (let k = 0; k <= steps; k++) {
    const d = rectDist([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps], r);
    if (d < best) best = d;
  }
  return best;
}

function iou(a: Rect, b: Rect): number {
  const ov = overlap(a, b);
  return ov / Math.max(1e-9, a[2] * a[3] + b[2] * b[3] - ov);
}

function clampInto(rect: Rect, panelRect: Rect, inset = 6.0): Rect {
  let [x, y] = rect;
  const [, , w, h] = rect;
  const [px, py, pw, ph] = panelRect;
  if (w <= pw - 2 * inset) x = Math.min(Math.max(x, px + inset), px + pw - inset - w);
  else x = px + (pw - w) / 2;
  if (h <= ph - 2 * inset) y = Math.min(Math.max(y, py + inset), py + ph - inset - h);
  else y = py + (ph - h) / 2;
  x = Math.min(Math.max(x, 0), PAGE_W - w);
  y = Math.min(Math.max(y, 0), PAGE_H - h);
  return [x, y, w, h];
}

function roundUp(v: number): number {
  return Math.ceil(v * 100 - 1e-6) / 100;
}

// ---------- balloon outline and tails ---------------------------------------------

const TAIL_FREE = 30.0;
const TAIL_COST: Record<string, number> = { thought: 18.0 };
const TAIL_COST_SPEECH = 12.0;
const EDGE_PAST = 2.5;
const PAST_SHARE = 0.25;
const HAIR_SHARE = 0.5;
const READ_ORDER_COST = 100.0;
const SEARCH_BUDGET = 60000;

type Ell = [number, number, number, number];

function balloon(rect: Rect, style: string): Ell {
  const [ecx, ecy, erx, ery] = ellipse(style);
  const [x, y, w, h] = rect;
  return [x + (ecx / 100) * w, y + (ecy / 100) * h, (erx / 100) * w, (ery / 100) * h];
}

function balloonRect(e: Ell): Rect {
  return [e[0] - e[2], e[1] - e[3], 2 * e[2], 2 * e[3]];
}

function outlinePoint(e: Ell, toward: Pt): Pt {
  const [cx, cy, rx, ry] = e;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  const k = phypot(dx / rx, dy / ry);
  if (k < 1e-9) return [cx, cy + ry];
  return [cx + dx / k, cy + dy / k];
}

function ellipseR(e: Ell, pt: Pt): number {
  return phypot((pt[0] - e[0]) / e[2], (pt[1] - e[1]) / e[3]);
}

function minTail(kind: string, h: number): number {
  return kind === "thought" ? Math.max(18.0, 0.4 * h) : Math.max(12.0, 0.22 * h);
}

const TAIL_HARD: Record<string, number> = { thought: 12.0 };
const TAIL_HARD_SPEECH = 8.0;

function beyond(e: Ell, pt: Pt): number {
  const d = phypot(pt[0] - e[0], pt[1] - e[1]);
  if (d < 1e-6) return -Math.min(e[2], e[3]);
  return d - d / phypot((pt[0] - e[0]) / e[2], (pt[1] - e[1]) / e[3]);
}

function clearOf(tip: Pt, e: Ell, minLen: number): [Pt, boolean] {
  const [cx, cy, rx, ry] = e;
  let dx = tip[0] - cx;
  let dy = tip[1] - cy;
  let d = phypot(dx, dy);
  if (d < 1e-6) {
    dx = 0;
    dy = 1;
    d = 1;
  }
  const edge = d / phypot(dx / rx, dy / ry);
  if (d >= edge + minLen - 1e-6) return [tip, false];
  const s = (edge + minLen) / d;
  return [[cx + dx * s, cy + dy * s], true];
}

const THOUGHT_CLOUD =
  "M22 58 C8 60 4 42 16 36 C10 20 28 10 42 18 C48 6 68 6 76 18 C90 10 106 24 98 40 " +
  "C110 48 104 68 86 68 C82 84 58 88 46 74 C30 86 10 76 12 60 C6 62 10 56 22 58 Z";
const CLOUD_MARGIN = 4.6;

function cloudOutline(steps = 16): Pt[] {
  const n = (THOUGHT_CLOUD.match(/-?[\d.]+/g) ?? []).map(Number);
  const pts: Pt[] = [];
  let cur: Pt = [n[0]!, n[1]!];
  for (let i = 2; i < n.length - 5; i += 6) {
    const c1: Pt = [n[i]!, n[i + 1]!];
    const c2: Pt = [n[i + 2]!, n[i + 3]!];
    const end: Pt = [n[i + 4]!, n[i + 5]!];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const a = cube(1 - t);
      const b = 3 * sq(1 - t) * t;
      const c = 3 * (1 - t) * t * t;
      const d = cube(t);
      pts.push([a * cur[0] + b * c1[0] + c * c2[0] + d * end[0], a * cur[1] + b * c1[1] + c * c2[1] + d * end[1]]);
    }
    cur = end;
  }
  return pts;
}

const CLOUD = cloudOutline();

function cloudClear(rect: Rect, pt: Pt): boolean {
  const [x, y, w, h] = rect;
  const u = ((pt[0] - x) / w) * 100;
  const v = ((pt[1] - y) / h) * 100;
  const r = phypot((u - 50) / ((u > 50 ? 54.2 : 46.0) + 5.0), (v - 46) / 42.1);
  if (r >= 1.15) return true;
  if (r < 0.8) return false;
  let ins = false;
  let near = CLOUD_MARGIN;
  for (let i = 0; i < CLOUD.length; i++) {
    const [x1, y1] = CLOUD[i]!;
    const [x2, y2] = CLOUD[(i + 1) % CLOUD.length]!;
    if (y1 > v !== y2 > v && u < x1 + ((v - y1) * (x2 - x1)) / (y2 - y1)) ins = !ins;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy || 1.0)));
    near = Math.min(near, phypot(u - x1 - t * dx, v - y1 - t * dy));
  }
  return !ins && near >= CLOUD_MARGIN;
}

function mouthGap(head: Rect): number {
  return Math.min(60.0, Math.max(10.0, 0.15 * Math.min(head[2], head[3])));
}

function faceTip(bubbleC: Pt, mouth: Pt, face: Rect, gap: number | null = null): Pt {
  const [, fy, , fh] = face;
  if (gap === null) gap = mouthGap(face);
  const dx = bubbleC[0] - mouth[0];
  const dy = bubbleC[1] - mouth[1];
  const d = phypot(dx, dy) || 1.0;
  const g = Math.min(gap, d);
  const near: Pt = [mouth[0] + (dx / d) * g, mouth[1] + (dy / d) * g];
  if (inside(bubbleC, face) || !inside(mouth, face)) return near;
  const [ex, ey] = exitPoint(mouth, bubbleC, face);
  if (ey >= fy + fh * 0.55) return near;
  return [ex + (mouth[0] - ex) * 0.06, ey + (mouth[1] - ey) * 0.06];
}

function roomOutside(panel: Panel, page: Page): [number, number, number, number] {
  const [px, py, pw, ph] = panelUnits(panel);
  const room = [px, py, PAGE_W - px - pw, PAGE_H - py - ph];
  for (const other of page.panels) {
    if (other === panel) continue;
    const [ox, oy, ow, oh] = panelUnits(other);
    if (oy < py + ph && oy + oh > py) {
      if (ox + ow <= px + 1e-6) room[0] = Math.min(room[0]!, px - ox - ow);
      else if (ox >= px + pw - 1e-6) room[2] = Math.min(room[2]!, ox - px - pw);
    }
    if (ox < px + pw && ox + ow > px) {
      if (oy + oh <= py + 1e-6) room[1] = Math.min(room[1]!, py - oy - oh);
      else if (oy >= py + ph - 1e-6) room[3] = Math.min(room[3]!, oy - py - ph);
    }
  }
  return room.map((r) => Math.max(0, r)) as [number, number, number, number];
}

function tipArea(prect: Rect, room: [number, number, number, number]): Rect {
  const [px, py, pw, ph] = prect;
  const [l, t, r, b] = room.map((v) => Math.min(EDGE_PAST, PAST_SHARE * v)) as [number, number, number, number];
  return [px - l, py - t, pw + l + r, ph + t + b];
}

function textBox(lines: string[], kind: string, font: number, style: string, w: number, h: number): Box {
  const bold = isBold(kind);
  const px = fontPx(kind, font);
  const [left, right, top, bottom] = textFrame(style, kind);
  const tw = ((Math.max(...lines.map((ln) => textW(ln, bold))) * px) / (w / PAGE_H)) * 100;
  const th = (((lines.length * LINE_HEIGHT + GLYPH_H - LINE_HEIGHT) * px) / (h / PAGE_H)) * 100;
  const cx = left + (100 - left - right) / 2;
  const cy = top + (100 - top - bottom) / 2;
  return [cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2];
}

function trailOverText(rect: Rect, tip: Pt, tb: Box): boolean {
  const [x, y, w, h] = rect;
  const tx = ((tip[0] - x) / w) * 100;
  const ty = ((tip[1] - y) / h) * 100;
  const ox = 50.0;
  const oy = ty < 40 ? 18.0 : 78.0;
  for (const [fx, fy, rx, ry] of [
    [0.28, 0.22, 7.5, 6.0],
    [0.58, 0.55, 5.0, 4.2],
  ] as const) {
    const cx = ox + (tx - ox) * fx;
    const cy = oy + (ty - oy) * fy;
    if (tb[0]! - rx < cx && cx < tb[2]! + rx && tb[1]! - ry < cy && cy < tb[3]! + ry) return true;
  }
  return false;
}

// ---------- placement ----------------------------------------------------------

export type ScriptLine = {
  id: string;
  panel_id: string;
  page_id?: string;
  speaker_id: string | null;
  speaker: string;
  kind: string;
  text: string;
};

type Tail = [Pt, Pt, boolean, number]; // start, tip, moved, short
type Option = [number, Rect, Rect, Tail | null]; // cost, rect, balloon box, tail
type Cand = [number, number, number]; // x, y, base cost

class Slot {
  line: ScriptLine;
  panel: Panel;
  page: Page;
  kind: string;
  style: string;
  prect: Rect;
  tipArea: Rect;
  faces: [Rect, Rect | null][];
  bodies: Rect[];
  art: Rect[];
  isReader: boolean;
  mode: string;
  offframeMouth: Pt | null;
  mouth: Pt | null;
  head: Rect | null;
  otherFaces: Rect[];
  otherCores: Rect[];
  bw: number;
  bh: number;
  font: number;
  lettered: string;
  textBox: Box;
  target: Pt | null;
  options: Option[];
  rect: Rect | null = null;
  tip: Pt | null = null;

  constructor(line: ScriptLine, panel: Panel, page: Page, a: Analysis, readerId: string | null, rtl: boolean) {
    this.line = line;
    this.panel = panel;
    this.page = page;
    this.kind = line.kind;
    this.style = balloonStyle(this.kind);
    const prect = panelUnits(panel);
    this.prect = prect;
    const [px, py, pw, ph] = prect;
    const panelArea = pw * ph;
    this.tipArea = tipArea(prect, roomOutside(panel, page));

    const faces: [Rect, Rect | null][] = [];
    let others: [Rect, Rect | null][] = [];
    let speakerFace: Rect | null = null;
    let speakerHead: Rect | null = null;
    let speakerMouth: Pt | null = null;
    let offframeMouth: Pt | null = null;
    let ownFace: Rect | null = null;
    for (const c of a.characters ?? []) {
      if (!truthy(c.head_box)) continue;
      const [box, share] = visibleRect(panel, c.head_box!, prect);
      if (box && share >= 0.3) {
        faces.push([box, faceCore(panel, c, prect)]);
        if (!line.speaker_id || c.id !== line.speaker_id) others.push(faces[faces.length - 1]!);
      }
      if (line.speaker_id && c.id === line.speaker_id && speakerFace === null && offframeMouth === null) {
        const hb = c.head_box!;
        const m = truthy(c.mouth) ? c.mouth! : [(hb[0]! + hb[2]!) / 2, hb[1]! + (hb[3]! - hb[1]!) * 0.72];
        const mouth = imageToPageRaw(panel, m[0]!, m[1]!);
        ownFace = box;
        if (inside(mouth, prect)) {
          speakerMouth = mouth;
          speakerFace = box ?? [mouth[0] - 20, mouth[1] - 40, 40, 50];
          const [hx1, hy1] = imageToPageRaw(panel, hb[0]!, hb[1]!);
          const [hx2, hy2] = imageToPageRaw(panel, hb[2]!, hb[3]!);
          speakerHead = box ? [hx1, hy1, hx2 - hx1, hy2 - hy1] : speakerFace;
        } else offframeMouth = mouth;
      }
    }
    const bodies: Rect[] = [];
    const bodyBoxes: (Box | null | undefined)[] = [
      a.focus_box,
      ...(a.regions ?? []).filter((r) => r.label !== "full body").map((r) => r.box),
    ];
    for (const b of bodyBoxes) {
      if (truthy(b)) {
        const [rect] = visibleRect(panel, b!, prect);
        if (rect && rect[2] * rect[3] < 0.6 * panelArea) bodies.push(rect);
      }
    }
    const art: Rect[] = [];
    for (const t of a.art_text ?? []) {
      const [rect] = visibleRect(panel, t.box, prect);
      if (rect) art.push(rect);
    }

    this.isReader = Boolean(readerId) && line.speaker_id === readerId;
    const readerPov = this.isReader && truthy(a.pov_shot) && speakerFace === null && offframeMouth === null;
    if (this.kind === "narration") this.mode = "caption";
    else if (offframeMouth !== null) this.mode = "offframe";
    else if (readerPov) this.mode = "pov";
    else if (speakerFace === null) this.mode = "voice";
    else this.mode = "face";
    this.faces = faces;
    this.bodies = bodies;
    this.art = art;
    this.offframeMouth = offframeMouth;
    this.mouth = null;
    this.head = speakerHead ?? speakerFace;
    if (this.mode === "face") {
      this.mouth = speakerMouth ?? [speakerFace![0] + speakerFace![2] / 2, speakerFace![1] + speakerFace![3] / 2];
    }
    const mine = speakerFace ?? ownFace;
    others = others.filter((o) => !(mine && iou(o[0], mine) > 0.7));
    this.otherFaces = others.map(([f]) => f);
    this.otherCores = others.map(([f, core]) => core ?? f);
    [this.bw, this.bh, this.font, this.lettered] = bubbleSize(line.text, this.kind, pw * 0.85, ph * 0.7, pw - 12, ph - 12);
    this.textBox = textBox(this.lettered.split("\n"), this.kind, this.font, this.style, this.bw, this.bh);
    this.target = this.mode === "pov" ? [px + pw / 2, py + ph] : null;
    this.options = this.buildOptions(a, speakerFace, rtl);
  }

  candidates(a: Analysis, speakerFace: Rect | null, rtl: boolean): Cand[] {
    const [px, py, pw, ph] = this.prect;
    const bw = this.bw;
    const bh = this.bh;
    const inset = 8;
    const emptySpots = (base: number): Cand[] => {
      const out: Cand[] = [];
      for (const r of a.empty_regions ?? []) {
        const [rx1, ry1] = imageToPage(this.panel, r[0]!, r[1]!);
        const [rx2, ry2] = imageToPage(this.panel, r[2]!, r[3]!);
        if (rx2 - rx1 > 1 && ry2 - ry1 > 1) out.push([(rx1 + rx2) / 2 - bw / 2, (ry1 + ry2) / 2 - bh / 2, base]);
      }
      return out;
    };
    const grid = (base: number): Cand[] => {
      const out: Cand[] = [];
      for (const gy of [0.0, 0.25, 0.5, 0.75, 1.0]) {
        for (const gx of [0.0, 0.25, 0.5, 0.75, 1.0]) {
          out.push([px + inset + (pw - bw - 2 * inset) * gx, py + inset + (ph - bh - 2 * inset) * gy, base]);
        }
      }
      return out;
    };
    const corners: Pt[] = [
      [px + pw - bw - inset, py + inset],
      [px + inset, py + inset],
      [px + inset, py + ph - bh - inset],
      [px + pw - bw - inset, py + ph - bh - inset],
    ];
    let cands: Cand[] = [];
    if (this.mode === "offframe") {
      const [ex, ey] = exitPoint([px + pw / 2, py + ph / 2], this.offframeMouth!, this.prect);
      const ml = minTail(this.kind, bh);
      let edge: string;
      if (Math.abs(ey - py) < 1e-6) edge = "top";
      else if (Math.abs(ey - py - ph) < 1e-6) edge = "bottom";
      else edge = Math.abs(ex - px) < 1e-6 ? "left" : "right";
      const share = ({ top: 0.1, bottom: 0.18 } as Record<string, number>)[edge] ?? 0.04;
      const rooms: [number, number][] = [
        [Math.max(6.0, ml - share * (edge === "top" || edge === "bottom" ? bh : bw)), 0.0],
        [6.0, 4.0],
      ];
      for (const [room, extra] of rooms) {
        [0.0, -0.6, 0.6, -1.2, 1.2, -1.9, 1.9, -2.7, 2.7].forEach((shift, k) => {
          if (edge === "top") cands.push([ex - bw / 2 + shift * bw, py + room, k * 2.0 + extra]);
          else if (edge === "bottom") cands.push([ex - bw / 2 + shift * bw, py + ph - room - bh, k * 2.0 + extra]);
          else if (edge === "left") cands.push([px + room, ey - bh / 2 + shift * bh, k * 2.0 + extra]);
          else cands.push([px + pw - room - bw, ey - bh / 2 + shift * bh, k * 2.0 + extra]);
        });
      }
      cands.push(...corners.map(([cx, cy]) => [cx, cy, 10.0] as Cand), ...emptySpots(4.0), ...grid(14.0));
    } else if (this.mode === "pov") {
      const low = py + ph - bh - inset;
      [0.5, 0.25, 0.75, 0.0, 1.0].forEach((fx, k) => cands.push([px + inset + (pw - bw - 2 * inset) * fx, low, k * 1.5]));
      cands.push([px + inset, py + ph * 0.62 - bh / 2, 6.0], [px + pw - bw - inset, py + ph * 0.62 - bh / 2, 6.0]);
      cands.push(...corners.map(([cx, cy]) => [cx, cy, cy < py + ph / 2 ? 12.0 : 4.0] as Cand));
      cands.push(...emptySpots(3.0).filter((c) => c[1] + bh / 2 > py + ph * 0.4));
      if (this.style === "cloud") {
        const shift = Math.max(0, 0.1 * bw - inset);
        const more = [...cands]
          .filter(([cx]) => cx + bw >= px + pw - inset - 1e-6)
          .map(([cx, cy, b]) => [cx - shift, cy, b + 0.5] as Cand);
        cands.push(...more);
      }
    } else if (this.mode === "caption" || this.mode === "voice") {
      const caps: Pt[] = [corners[0]!, corners[1]!, [px + (pw - bw) / 2, py + inset], corners[2]!, corners[3]!];
      if (!rtl) [caps[0], caps[1]] = [caps[1]!, caps[0]!];
      cands = caps.map(([cx, cy], k) => [cx, cy, k * 3.0] as Cand);
      const [near, far] = rtl ? [0.75, 0.25] : [0.25, 0.75];
      const [start, end] = rtl ? [corners[0]![0], corners[1]![0]] : [corners[1]![0], corners[0]![0]];
      const third = py + ph / 3 - bh / 2;
      cands.push(
        [px + inset + (pw - bw - 2 * inset) * near, py + inset, 13.0],
        [px + inset + (pw - bw - 2 * inset) * far, py + inset, 14.0],
        [start, third, 15.0],
        [end, third, 16.0],
      );
    } else {
      const [fx, fy, fw, fh] = speakerFace!;
      const hx = fx + fw / 2;
      const hy = fy + fh / 2;
      const gap = 14;
      cands = [
        [hx - bw / 2, fy - bh - gap, 0],
        [fx - bw - gap, fy - bh * 0.6, 4],
        [fx + fw + gap, fy - bh * 0.6, 4],
        [fx - bw - gap, hy - bh / 2, 8],
        [fx + fw + gap, hy - bh / 2, 8],
        [hx - bw / 2, fy + fh + gap, 20],
        [corners[0]![0], corners[0]![1], 12],
        [corners[1]![0], corners[1]![1], 12],
      ];
      for (const f of [0.0, 0.25, 0.5, 0.75, 1.0]) {
        cands.push([fx + fw * f - bw / 2, fy - gap - bh, 1 + 2 * Math.abs(f - 0.5)]);
        cands.push([fx - gap - bw, fy + fh * f - bh / 2, 3 + (f > 0.6 ? 6 : 0)]);
        cands.push([fx + fw + gap, fy + fh * f - bh / 2, 3 + (f > 0.6 ? 6 : 0)]);
        cands.push([fx + fw * f - bw / 2, fy + fh + gap, 14]);
      }
      const degToRad = Math.PI / 180.0;
      for (const ring of [1.0, 1.4, 1.9, 2.6]) {
        for (let ang = 0; ang < 360; ang += 30) {
          const rad = ang * degToRad;
          const rx = hx + Math.cos(rad) * (fw / 2 + gap + bw / 2) * ring - bw / 2;
          const ry = hy - Math.sin(rad) * (fh / 2 + gap + bh / 2) * ring - bh / 2;
          cands.push([rx, ry, 2 + 5 * (ring - 1) + (ang <= 180 ? 0 : 8)]);
        }
      }
      cands.push(...emptySpots(2.0), ...grid(10.0));
    }
    return cands;
  }

  buildOptions(a: Analysis, speakerFace: Rect | null, rtl: boolean): Option[] {
    const seen = new Map<string, [Rect, number]>();
    for (const [cx, cy, base] of this.candidates(a, speakerFace, rtl)) {
      const rect = clampInto([cx, cy, this.bw, this.bh], this.prect);
      const key = `${pyRound(rect[0] / 2)},${pyRound(rect[1] / 2)}`;
      const had = seen.get(key);
      if (!had || base < had[1]) seen.set(key, [rect, base]);
    }
    const scored: Option[] = [];
    for (const [rect, base] of seen.values()) {
      const tail = this.tail(rect);
      scored.push([this.cost(rect, tail, base), rect, balloonRect(balloon(rect, this.style)), tail]);
    }
    const order = scored.map((o, i) => [o, i] as const);
    order.sort((x, y) => (x[0][0] < y[0][0] ? -1 : x[0][0] > y[0][0] ? 1 : x[1] - y[1]));
    const sorted = order.map((x) => x[0]);
    let picked: Option[] = [];
    for (const o of sorted) {
      if (picked.every((p) => iou(o[1], p[1]) < 0.3)) {
        picked.push(o);
        if (picked.length >= 16) break;
      }
    }
    if (picked.length < 16) {
      picked = [...picked, ...sorted.filter((o) => !picked.includes(o)).slice(0, 16 - picked.length)];
      const po = picked.map((o, i) => [o, i] as const);
      po.sort((x, y) => (x[0][0] < y[0][0] ? -1 : x[0][0] > y[0][0] ? 1 : x[1] - y[1]));
      picked = po.map((x) => x[0]);
    }
    const extra: Option[] = [];
    for (const o of sorted) {
      if (extra.length >= 16) break;
      if (!picked.includes(o) && [...picked, ...extra].every((p) => iou(o[1], p[1]) < 0.3)) extra.push(o);
    }
    return [...picked, ...extra];
  }

  cleanTrail(rect: Rect, tip: Pt, aim: (start: Pt) => Pt): Pt {
    if (this.style !== "cloud" || !trailOverText(rect, tip, this.textBox)) return tip;
    const cx = rect[0] + rect[2] / 2;
    for (const sy of [rect[1] + rect[3], rect[1]]) {
      const t = exitPoint([cx, sy], aim([cx, sy]), this.tipArea);
      if (!trailOverText(rect, t, this.textBox) && cloudClear(rect, t)) return t;
    }
    return tip;
  }

  tail(rect: Rect): Tail | null {
    if (this.mode === "caption") return null;
    const e = balloon(rect, this.style);
    const c: Pt = [e[0], e[1]];
    const area = this.tipArea;
    const [px, py, pw, ph] = this.prect;
    const far = 4 * (PAGE_W + PAGE_H);
    let tip: Pt;
    if (this.mode === "face") {
      const gap = mouthGap(this.head!) + (this.style === "cloud" ? 0.05 * rect[2] : 0.0);
      tip = faceTip(c, this.mouth!, this.head!, gap);
    } else if (this.mode === "offframe") {
      tip = this.cleanTrail(rect, exitPoint(c, this.offframeMouth!, area), () => this.offframeMouth!);
    } else if (this.mode === "pov") {
      let best: [number, Pt] | null = null;
      const exits: [Pt, Pt, number][] = [
        [c, [c[0], py + ph + far], 0.0],
        [c, [px - far, c[1]], 0.35],
        [c, [px + pw + far, c[1]], 0.35],
      ];
      if (this.style === "cloud") {
        const low: Pt = [c[0], rect[1] + rect[3]];
        exits.push([low, [px - far, low[1]], 0.35], [low, [px + pw + far, low[1]], 0.35]);
      }
      for (const [start, toward, pref] of exits) {
        const t = exitPoint(start, toward, area);
        let cost = (phypot(t[0] - c[0], t[1] - c[1]) / Math.max(pw, ph)) * (1 + pref);
        cost += crosses(c, t, this.faces.map(([f]) => f)) ? 5 : 0;
        if (this.style === "cloud" && (!cloudClear(rect, t) || trailOverText(rect, t, this.textBox))) cost += 5;
        if (best === null || cost < best[0]) best = [cost, t];
      }
      tip = best![1];
    } else {
      const edges: [Pt, number][] = [
        [[c[0], py - far], c[1] - py],
        [[c[0], py + ph + far], py + ph - c[1]],
        [[px - far, c[1]], c[0] - px],
        [[px + pw + far, c[1]], px + pw - c[0]],
      ];
      const toward = minBy(edges, (t) => t[1])[0];
      const side = toward[1] === c[1];
      tip = this.cleanTrail(rect, exitPoint(c, toward, area), (st) => (side ? [toward[0], st[1]] : [st[0], toward[1]]));
    }
    const hard = Math.max(TAIL_HARD[this.kind] ?? TAIL_HARD_SPEECH, 0.02 * Math.max(rect[2], rect[3]));
    const cleared = clearOf(tip, e, hard);
    tip = cleared[0];
    const moved = cleared[1];
    let ins: Pt = [Math.min(Math.max(tip[0], area[0]), area[0] + area[2]), Math.min(Math.max(tip[1], area[1]), area[1] + area[3])];
    if (beyond(e, ins) < hard - 1e-6) ins = clearOf(ins, e, hard)[0];
    tip = [Math.min(Math.max(ins[0], 0), PAGE_W), Math.min(Math.max(ins[1], 0), PAGE_H)];
    const minLen = minTail(this.kind, rect[3]);
    const short = Math.max(0, Math.min(1, (minLen - beyond(e, tip)) / minLen));
    return [outlinePoint(e, tip), tip, moved, short];
  }

  cost(rect: Rect, tail: Tail | null, base: number): number {
    const [, , w, h] = rect;
    const [, , pw, ph] = this.prect;
    const area = w * h;
    const e = balloon(rect, this.style);
    const body = balloonRect(e);
    let score = base;
    for (const [f, core] of this.faces) {
      const fp: Rect = [f[0] - 6, f[1] - 6, f[2] + 12, f[3] + 12];
      const ov = overlap(body, fp);
      if (!ov) continue;
      const cp: Rect = core ? [core[0] - 6, core[1] - 6, core[2] + 12, core[3] + 12] : fp;
      const oc = overlap(body, cp);
      const rest = Math.max(0, ov - oc);
      score += (120 * oc) / area + (70 * oc) / (cp[2] * cp[3]);
      score += HAIR_SHARE * ((120 * rest) / area + (70 * rest) / (fp[2] * fp[3]));
    }
    score += ((this.mode === "pov" ? 70 : 35) * psum(this.bodies.map((b) => overlap(body, b)))) / area;
    score += (150 * psum(this.art.map((t) => overlap(rect, [t[0] - 4, t[1] - 4, t[2] + 8, t[3] + 8])))) / area;
    if (this.target) score += (phypot(e[0] - this.target[0], e[1] - this.target[1]) / Math.max(pw, ph)) * 25;
    if (tail) {
      const [start, tip, moved, short] = tail;
      const length = phypot(tip[0] - start[0], tip[1] - start[1]);
      score += ((TAIL_COST[this.kind] ?? TAIL_COST_SPEECH) * Math.max(0, length - TAIL_FREE)) / 100;
      if (this.mode !== "pov") score += 25 * short;
      if (this.mode === "face") {
        if (ellipseR(e, this.mouth!) < 1.0) score += 80;
        else if (moved) score += 15;
        score += 6 * this.bodies.filter((b) => crosses(start, tip, [b], 0.0)).length;
        score += (30 * Math.max(0, lengthInside(start, tip, this.head!) - 30)) / 100;
      }
      if (this.mode === "face" || this.mode === "offframe") {
        score += 40 * this.otherFaces.filter((f) => crosses(start, tip, [f], 2.0)).length;
      }
      if (this.mode === "face") {
        const margin = Math.max(15.0, 0.1 * Math.min(this.head![2], this.head![3]));
        score += 60 * this.otherCores.filter((f) => segRectDist(tip, this.mouth!, f) < margin).length;
      }
      if (this.kind === "thought" && trailOverText(rect, tip, this.textBox)) score += 100;
      if (this.style === "cloud" && !cloudClear(rect, tip)) score += 150;
    }
    return score;
  }
}

function pairCost(a: [Rect, Rect, Tail | null], b: [Rect, Rect, Tail | null], rtl: boolean): number {
  const [ra, ba, ta] = a;
  const [rb, bb, tb] = b;
  let cost = (400 * overlap(rb, [ra[0] - 10, ra[1] - 10, ra[2] + 20, ra[3] + 20])) / Math.min(ra[2] * ra[3], rb[2] * rb[3]);
  cost += READ_ORDER_COST * readBefore(rb, [ra], rtl);
  if (ta && (crosses(ta[0], ta[1], [bb], 2.0) || inside(ta[1], bb))) cost += 35;
  if (tb && (crosses(tb[0], tb[1], [ba], 2.0) || inside(tb[1], ba))) cost += 35;
  if (ta && tb && segmentsCross(ta[0], ta[1], tb[0], tb[1])) cost += 20;
  return cost;
}

function placePanel(group: Slot[], rtl: boolean, budget = SEARCH_BUDGET): void {
  const n = group.length;
  const k = n <= 6 ? 16 : n <= 10 ? 10 : 6;
  let [cost, choice] = searchPanel(group, rtl, k, budget);
  const rects = group.map((s, i) => s.options[choice[i]!]![1]);
  if (rects.some((r, j) => readBefore(r, rects.slice(0, j), rtl)) && group.some((s) => s.options.length > k)) {
    const wide = searchPanel(group, rtl, 2 * k, budget);
    if (wide[0] < cost - 1e-9) [cost, choice] = wide;
  }
  group.forEach((s, i) => {
    const o = s.options[choice[i]!]!;
    s.rect = o[1];
    s.tip = o[3] ? o[3][1] : null;
  });
}

function searchPanel(group: Slot[], rtl: boolean, k: number, budget: number): [number, number[]] {
  const n = group.length;
  const opts = group.map((s) => s.options.slice(0, k));
  const pair = new Map<string, number[][]>();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < j; i++) {
      pair.set(
        `${i},${j}`,
        opts[i]!.map((oa) => opts[j]!.map((ob) => pairCost([oa[1], oa[2], oa[3]], [ob[1], ob[2], ob[3]], rtl))),
      );
    }
  }
  const pairs: number[][][][] = [];
  for (let j = 0; j < n; j++) {
    pairs.push([]);
    for (let i = 0; i < j; i++) pairs[j]!.push(pair.get(`${i},${j}`)!);
  }
  const added = (j: number, b: number, choice: number[]) => {
    const parts: number[] = [];
    for (let i = 0; i < j; i++) parts.push(pairs[j]![i]![choice[i]!]![b]!);
    return opts[j]![b]![0] + psum(parts);
  };
  const choice: number[] = [];
  let total = 0;
  for (let j = 0; j < n; j++) {
    const idx = Array.from({ length: opts[j]!.length }, (_, i) => i);
    const b = minBy(idx, (bb) => added(j, bb, choice));
    total += added(j, b, choice);
    choice.push(b);
  }
  let bestCost = total;
  let bestChoice = [...choice];
  const rest = new Array<number>(n + 1).fill(0);
  for (let j = n - 1; j >= 0; j--) rest[j] = rest[j + 1]! + opts[j]![0]![0];
  let nodes = 0;
  const cur: number[] = [];
  const search = (j: number, cost: number) => {
    if (j === n) {
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        bestChoice = [...cur];
      }
      return;
    }
    for (let b = 0; b < opts[j]!.length; b++) {
      nodes++;
      if (nodes > budget) return;
      const c = cost + added(j, b, cur);
      if (c + rest[j + 1]! >= bestCost - 1e-9) continue;
      cur.push(b);
      search(j + 1, c);
      cur.pop();
    }
  };
  search(0, 0.0);
  return [bestCost, bestChoice];
}

export type Overlay = {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  fill: string;
  stroke: string;
  tailX: number;
  tailY: number;
  balloonStyle: string;
  fontId: string;
  align: string;
  autoFit: boolean;
  scriptLineId: string;
  speakerId: string | null;
};

/** Overlays per page id. readerId: the reader / POV stand-in, whose bubbles are light blue. */
export async function placeBubbles(
  pages: Page[],
  lines: ScriptLine[],
  analyses: Map<string, Analysis>,
  rtl = true,
  readerId: string | null = null,
  pause?: () => Promise<void>,
): Promise<Map<string, Overlay[]>> {
  const overlays = new Map<string, Overlay[]>(pages.map((p) => [p.id, []]));
  const lookup = new Map<string, [Panel, Page]>();
  for (const pg of pages) for (const pn of pg.panels) lookup.set(pn.id, [pn, pg]);
  const slots: Slot[] = [];
  const byPanel = new Map<string, Slot[]>();
  for (const line of lines) {
    const [panel, page] = lookup.get(line.panel_id)!;
    const s = new Slot(line, panel, page, analyses.get(panel.item.name)!, readerId, rtl);
    slots.push(s);
    const g = byPanel.get(panel.id) ?? [];
    g.push(s);
    byPanel.set(panel.id, g);
    if (pause) await pause();
  }
  for (const group of byPanel.values()) {
    placePanel(group, rtl);
    if (pause) await pause();
  }
  slots.forEach((s, idx) => {
    const [x, y, w, h] = s.rect!;
    let tailX: number;
    let tailY: number;
    if (s.tip === null) [tailX, tailY] = NARRATION_TAIL;
    else {
      tailX = ((s.tip[0] - x) / w) * 100;
      tailY = ((s.tip[1] - y) / h) * 100;
    }
    const [, bold, italic] = TEXT_STYLE[s.kind] ?? [11, false, false];
    overlays.get(s.page.id)!.push({
      id: `bubble-${idx + 1}`,
      kind: s.kind,
      x: pyRound((x / PAGE_W) * 100, 2),
      y: pyRound((y / PAGE_H) * 100, 2),
      w: roundUp((w / PAGE_W) * 100),
      h: roundUp((h / PAGE_H) * 100),
      text: s.lettered,
      fontSize: s.font,
      bold,
      italic,
      color: TEXT_COLOR,
      fill: s.isReader ? READER_FILL : PAPER_FILL,
      stroke: TEXT_COLOR,
      tailX: pyRound(tailX, 2),
      tailY: pyRound(tailY, 2),
      balloonStyle: s.style,
      fontId: "comic",
      align: "center",
      autoFit: true,
      scriptLineId: s.line.id,
      speakerId: s.line.speaker_id,
    });
  });
  return overlays;
}
