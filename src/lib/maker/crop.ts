/**
 * Automatic panel framing. plan_crop picks what each panel frames and how
 * tightly (before layout); frame_panels fits the crop to the panel's final
 * shape and writes it as Panel Fox's own zoom / focusX / focusY.
 * All boxes are [x1, y1, x2, y2]; "normalized" means 0-1 of the image size.
 */
import { fold, nameWords } from "./config.ts";
import { PAGE_H, PAGE_W, type LayoutItem, type Page, type Panel } from "./layout.ts";
import { isDigitStr, maxBy, psum, pyRound, pyStr, squash, truthy } from "./py.ts";
import type { Analysis, Beat, Box, Person } from "./vision.ts";

export const TIERS: Record<string, [number, number]> = {
  tighter: [1.2, 0.08],
  tight: [1.35, 0.12],
  key: [1.75, 0.3],
  climax: [2.2, 0.5],
  wide: [2.6, 0.7],
};
const MIN_SIDE = 0.28;
export const ZOOM_MAX = 4.0;
const ASPECT_MIN = 0.5;
const ASPECT_MAX = 2.0;
const MIN_PAGE_PX = 640;
const BUBBLE_BAND = 0.22;

export const SHOTS = ["establishing", "dialogue", "reaction", "action", "climax", "aftermath"] as const;

const FOCUS_GROUPS: [string, string[]][] = [
  ["face", ["face", "faces", "head", "expression", "reaction", "eyes", "eye", "mouth", "lips", "kiss", "kissing", "smile", "blush", "blushing", "tears"]],
  ["hands", ["hand", "hands", "finger", "fingers", "grip", "grab", "grabbing", "fist", "palm"]],
  ["chest", ["chest", "breast", "breasts", "bust", "torso", "cleavage", "nipple", "nipples"]],
  ["hips", ["hips", "hip", "waist", "butt", "ass", "rear", "thigh", "thighs", "crotch", "groin", "pelvis", "legs", "leg", "lap"]],
  ["full", ["full body", "full-body", "whole body", "full", "whole", "body", "wide", "establishing", "scene", "room", "everyone", "figure", "figures"]],
  ["interaction", ["interaction", "contact", "embrace", "embracing", "hug", "hugging", "couple", "together", "between", "sex", "intercourse", "penetration", "thrust", "thrusting", "grinding", "straddling", "union"]],
];
const PLURAL_FACES = ["faces", "kiss", "kissing", "both"];
const WEAK_FACE = ["closeup", "close-up", "close up", "portrait"];
const FEMALE = ["her", "hers", "she", "woman", "women", "girl", "lady"];
const MALE = ["his", "he", "him", "man", "men", "guy", "boy"];

function esc(w: string) {
  return w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const wordRe = new Map<string, RegExp>();
function findWord(w: string, low: string, cls: string): number {
  const k = `${cls}|${w}`;
  let re = wordRe.get(k);
  if (!re) {
    re = new RegExp(`(?<![${cls}])${esc(w)}(?![${cls}])`);
    wordRe.set(k, re);
  }
  const m = re.exec(low);
  return m ? m.index : -1;
}

/** Python's str.index positions are in code points; these helpers keep that. */
function cpIndex(s: string, utf16: number): number {
  return Array.from(s.slice(0, utf16)).length;
}

/** The focus group a label or phrase names, by its earliest keyword, or null. */
export function classify(text: unknown): string | null {
  const low = squash((truthy(text) ? pyStr(text) : "").toLowerCase().replace(/_/g, " "));
  if (!low) return null;
  let best: [number, string, number] | null = null;
  for (const [group, words] of FOCUS_GROUPS) {
    for (const w of words) {
      const at = findWord(w, low, "a-z");
      if (at >= 0) {
        const start = cpIndex(low, at);
        if (best === null || start < best[0] || (start === best[0] && w.length > best[2])) best = [start, group, w.length];
      }
    }
  }
  if (best === null && WEAK_FACE.some((w) => findWord(w, low, "a-z") >= 0)) return "face";
  return best ? best[1] : null;
}

/** Where the earliest of these whole words appears in the phrase, or null. */
function wordAt(words: string[], low: string): number | null {
  const hits: number[] = [];
  for (const w of words) {
    if (!w) continue;
    const at = findWord(w, low, "a-z0-9");
    if (at >= 0) hits.push(cpIndex(low, at));
  }
  return hits.length ? Math.min(...hits) : null;
}

/** The person the phrase names first: by name, "you" for the stand-in, or a fitting pronoun. */
function namedHead(chars: Person[], low: string, pronouns = true): Person | null {
  let best: [[number, number], Person] | null = null;
  for (const c of chars) {
    const name = (truthy(c.name) ? pyStr(c.name) : "").toLowerCase();
    const words = nameWords(name).filter((w) => Array.from(w).length > 1 && w !== "the" && !isDigitStr(w));
    if (["you", "reader", "the reader"].includes(name) || name.startsWith("you ")) words.push("you", "your");
    if (pronouns) words.push(...(({ female: FEMALE, male: MALE } as Record<string, string[]>)[c.gender] ?? []));
    const at = wordAt(words, low);
    if (at !== null) {
      const key: [number, number] = [at, -boxArea(c.head_box!)];
      if (best === null || key[0] < best[0][0] || (key[0] === best[0][0] && key[1] < best[0][1])) best = [key, c];
    }
  }
  return best ? best[1] : null;
}

export function normalizeShot(v: unknown): string {
  const s = (truthy(v) ? pyStr(v) : "").trim().toLowerCase();
  for (const shot of SHOTS) if (s.includes(shot)) return shot;
  return "";
}

export function tierFor(importance: number, shot = ""): string {
  const base = importance >= 5 ? "climax" : importance >= 4 ? "key" : "tight";
  if (shot === "establishing") return "wide";
  if (shot === "reaction") return base === "tight" ? "tighter" : "key";
  if (shot === "climax" && base === "tight") return "key";
  return base;
}

function union(boxes: (Box | null | undefined)[]): Box | null {
  const bs = boxes.filter((b): b is Box => truthy(b));
  if (!bs.length) return null;
  return [
    Math.min(...bs.map((b) => b[0]!)),
    Math.min(...bs.map((b) => b[1]!)),
    Math.max(...bs.map((b) => b[2]!)),
    Math.max(...bs.map((b) => b[3]!)),
  ];
}

export function boxArea(b: Box): number {
  return Math.max(0, b[2]! - b[0]!) * Math.max(0, b[3]! - b[1]!);
}

export class Crop {
  imageW: number;
  imageH: number;
  box: Box;
  focus: Box;
  label: string;
  source: string;
  tier: string;
  heads: Box[];

  constructor(iw: number, ih: number, box: Box, focus: Box, label: string, source: string, tier: string, heads: Box[] = []) {
    this.imageW = iw;
    this.imageH = ih;
    this.box = box;
    this.focus = focus;
    this.label = label;
    this.source = source;
    this.tier = tier;
    this.heads = heads;
  }

  get widthPx(): number {
    return Math.max(1, pyRound((this.box[2]! - this.box[0]!) * this.imageW));
  }

  get heightPx(): number {
    return Math.max(1, pyRound((this.box[3]! - this.box[1]!) * this.imageH));
  }

  aspectRange(): [number, number] {
    return [this.widthPx / this.imageH, this.imageW / this.heightPx];
  }

  layoutItem(name: string, importance: number): LayoutItem {
    const [lo, hi] = this.aspectRange();
    const cache = new Map<string, number>();
    const cw = (this.box[2]! - this.box[0]!) * this.imageW;
    const ch = (this.box[3]! - this.box[1]!) * this.imageH;
    const fit = (aspect: number, share = 0): number => {
      const a = pyRound(Math.log(Math.max(aspect, 1e-6)), 2);
      let s = pyRound(share, 2);
      const a_ = Math.exp(a);
      if ((cw / ch < a_ ? ch * a_ : cw) >= MIN_PAGE_PX * s) s = 0;
      const k = `${a}|${s}`;
      let v = cache.get(k);
      if (v === undefined) {
        v = fitCost(this, a_, s);
        cache.set(k, v);
      }
      return v;
    };
    return {
      name,
      width: this.widthPx,
      height: this.heightPx,
      importance,
      minAspect: lo,
      maxAspect: hi,
      fit,
      beat: 0,
    };
  }

  toDict() {
    const r = (b: Box) => b.map((v) => pyRound(v, 4));
    return { box: r(this.box), focus: r(this.focus), label: this.label, source: this.source, tier: this.tier };
  }
}

/** (normalized box, label, source) for what the panel should frame. */
export function resolveFocus(analysis: Analysis, beat: Beat | null | undefined): [Box, string, string] {
  let vision = analysis.focus_box;
  let visionLabel = analysis.focus_label || "subject";
  let visionSource = analysis.focus_source || "model";
  if (!truthy(vision)) {
    const heads = (analysis.characters ?? []).filter((c) => truthy(c.head_box)).map((c) => c.head_box!);
    const u = union(heads);
    if (u) {
      vision = [u[0]!, u[1]!, u[2]!, Math.min(1, u[3]! + (u[3]! - u[1]!) * 1.5)];
      visionLabel = "characters";
    } else {
      vision = [0.15, 0.15, 0.85, 0.85];
      visionLabel = "scene";
    }
    visionSource = "fallback";
  }
  const result: [Box, string, string] = [[...vision!], visionLabel, visionSource];
  if (!truthy(beat)) return result;
  const hint = truthy(beat!.focus) ? pyStr(beat!.focus) : "";
  const shot = normalizeShot(beat!.shot);
  let group = classify(hint);
  if (group === null && shot === "reaction") group = "face";
  if (group === null && shot === "establishing") group = "full";
  if (group === null || classify(visionLabel) === group) return result;

  const chars = (analysis.characters ?? []).filter((c) => truthy(c.head_box));
  if (group === "face" && chars.length) {
    const low = fold(hint).toLowerCase();
    const plural = chars.length > 1 && PLURAL_FACES.some((w) => low.includes(w));
    const named = namedHead(chars, low, !plural);
    let box: Box;
    if (named) box = named.head_box!;
    else if (plural) box = union(chars.map((c) => c.head_box))!;
    else box = maxBy(chars.map((c) => c.head_box!), boxArea);
    return [[...box], "face", "beat"];
  }
  for (const r of analysis.regions ?? []) {
    if (classify(r.label) === group && truthy(r.box)) return [[...r.box], r.label, "beat"];
  }
  if (group === "full") {
    const u = union([vision, ...chars.map((c) => c.head_box), ...(analysis.regions ?? []).map((r) => r.box)]);
    return [[...u!], "full body", "beat"];
  }
  if (group === "interaction" && chars.length > 1) {
    return [[...union([vision, ...chars.map((c) => c.head_box)])!], "interaction", "beat"];
  }
  return result;
}

function fitInto(x1: number, y1: number, w: number, h: number, iw: number, ih: number): Box {
  w = Math.min(w, iw);
  h = Math.min(h, ih);
  x1 = Math.min(Math.max(x1, 0), iw - w);
  y1 = Math.min(Math.max(y1, 0), ih - h);
  return [x1, y1, x1 + w, y1 + h];
}

function overlapArea(a: Box, b: Box): number {
  const dx = Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!);
  const dy = Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

type Side = "up" | "down" | "left" | "right";

/** Grow the crop toward the side with the most room when it has no strip for a bubble. */
function bubbleRoom(crop: Box, occupied: Box, empties: Box[], iw: number, ih: number): Box {
  const [cx1, cy1, cx2, cy2] = crop as [number, number, number, number];
  const cw = cx2 - cx1;
  const ch = cy2 - cy1;
  for (const e of empties) if (overlapArea(crop, e) >= 0.06 * cw * ch) return crop;
  const o = [Math.max(occupied[0]!, cx1), Math.max(occupied[1]!, cy1), Math.min(occupied[2]!, cx2), Math.min(occupied[3]!, cy2)];
  const bands: [Side, number][] = [
    ["up", (o[1]! - cy1) / ch],
    ["down", (cy2 - o[3]!) / ch],
    ["left", (o[0]! - cx1) / cw],
    ["right", (cx2 - o[2]!) / cw],
  ];
  if (Math.max(...bands.map((b) => b[1])) >= BUBBLE_BAND) return crop;
  let best: [number, Side, number] | null = null;
  const pref: Record<Side, number> = { up: 0.3, left: 0.15, right: 0.15, down: 0 };
  for (const [side, band] of bands) {
    const vertical = side === "up" || side === "down";
    const dim = vertical ? ch : cw;
    const avail = { up: cy1, down: ih - cy2, left: cx1, right: iw - cx2 }[side];
    const need = Math.max(0, (BUBBLE_BAND * dim - band * dim) / (1 - BUBBLE_BAND));
    const grow = Math.min(need, avail);
    if (grow < 0.03 * dim) continue;
    const reached = (band * dim + grow) / (dim + grow);
    const strip: Box = {
      up: [cx1, cy1 - grow, cx2, cy1],
      down: [cx1, cy2, cx2, cy2 + grow],
      left: [cx1 - grow, cy1, cx1, cy2],
      right: [cx2, cy1, cx2 + grow, cy2],
    }[side];
    const stripArea = Math.max(1e-6, (strip[2]! - strip[0]!) * (strip[3]! - strip[1]!));
    const emptyBonus = Math.min(1, psum(empties.map((e) => overlapArea(strip, e))) / stripArea);
    const newW = cw + (vertical ? 0 : grow);
    const newH = ch + (vertical ? grow : 0);
    const aspectPenalty = !(ASPECT_MIN * 0.9 <= newW / newH && newW / newH <= ASPECT_MAX * 1.1) ? 1 : 0;
    const score = 4 * Math.min(reached, BUBBLE_BAND) + emptyBonus + pref[side] - aspectPenalty;
    if (best === null || score > best[0]) best = [score, side, grow];
  }
  if (!best) return crop;
  const [, side, grow] = best;
  if (side === "up") return [cx1, cy1 - grow, cx2, cy2];
  if (side === "down") return [cx1, cy1, cx2, cy2 + grow];
  if (side === "left") return [cx1 - grow, cy1, cx2, cy2];
  return [cx1, cy1, cx2 + grow, cy2];
}

/** Pick the crop for one image. size is the image's pixel (width, height). */
export function planCrop(analysis: Analysis, size: [number, number], importance: number, beat?: Beat | null): Crop {
  const iw = Math.max(1, Math.trunc(size[0]));
  const ih = Math.max(1, Math.trunc(size[1]));
  const [focusN, label, source] = resolveFocus(analysis, beat);
  const tier = tierFor(importance, normalizeShot((beat ?? ({} as Beat)).shot));
  const [pad, minArea] = TIERS[tier]!;

  const fx1 = focusN[0]! * iw, fy1 = focusN[1]! * ih, fx2 = focusN[2]! * iw, fy2 = focusN[3]! * ih;
  const fw = Math.max(fx2 - fx1, 0.02 * iw);
  const fh = Math.max(fy2 - fy1, 0.02 * ih);
  const fcx = (fx1 + fx2) / 2;
  const fcy = (fy1 + fy2) / 2;

  let w = fw * pad;
  let h = fh * pad;
  w = Math.max(w, MIN_SIDE * iw);
  h = Math.max(h, MIN_SIDE * ih);
  if (w * h < minArea * iw * ih) {
    const k = Math.sqrt((minArea * iw * ih) / (w * h));
    w *= k;
    h *= k;
  }
  if (w / h < ASPECT_MIN) w = h * ASPECT_MIN;
  else if (w / h > ASPECT_MAX) h = w / ASPECT_MAX;
  let crop = fitInto(fcx - w / 2, fcy - h / 2, w, h, iw, ih);

  const heads = (analysis.characters ?? [])
    .filter((c) => truthy(c.head_box))
    .map((c) => [c.head_box![0]! * iw, c.head_box![1]! * ih, c.head_box![2]! * iw, c.head_box![3]! * ih]);
  const occupied = union([[fx1, fy1, fx2, fy2], ...heads.filter((hb) => overlapArea(hb, crop) > 0)])!;
  const empties = (analysis.empty_regions ?? []).map((e) => [e[0]! * iw, e[1]! * ih, e[2]! * iw, e[3]! * ih]);
  crop = bubbleRoom(crop, occupied, empties, iw, ih);

  const box = [crop[0]! / iw, crop[1]! / ih, crop[2]! / iw, crop[3]! / ih].map((v) => Math.max(0, Math.min(1, v)));
  const headBoxes = (analysis.characters ?? []).filter((c) => truthy(c.head_box)).map((c) => [...c.head_box!]);
  return new Crop(iw, ih, box, [...focusN], label, source, tier, headBoxes);
}

/** On-paper width / height of a panel whose rect is in page percent. */
export function panelAspect(panel: { w: number; h: number }): number {
  return (panel.w * PAGE_W) / Math.max(1e-6, panel.h * PAGE_H);
}

function windowSize(crop: Crop, aspect: number, panelWShare = 0): [number, number] {
  const iw = crop.imageW, ih = crop.imageH;
  const cx1 = crop.box[0]! * iw, cy1 = crop.box[1]! * ih, cx2 = crop.box[2]! * iw, cy2 = crop.box[3]! * ih;
  const cw = cx2 - cx1, ch = cy2 - cy1;
  let w: number, h: number;
  if (cw / ch < aspect) {
    h = ch;
    w = h * aspect;
  } else {
    w = cw;
    h = w / aspect;
  }
  const minW = MIN_PAGE_PX * panelWShare;
  if (w < minW) {
    w = minW;
    h = minW / aspect;
  }
  const k = Math.min(1, iw / w, ih / h);
  return [w * k, h * k];
}

/** The part of the image the panel will show: the crop grown (or trimmed) to the panel's shape. */
export function fitWindow(crop: Crop, aspect: number, panelWShare = 0): Box {
  const iw = crop.imageW, ih = crop.imageH;
  const cx1 = crop.box[0]! * iw, cy1 = crop.box[1]! * ih, cx2 = crop.box[2]! * iw, cy2 = crop.box[3]! * ih;
  const [w, h] = windowSize(crop, aspect, panelWShare);
  const fx1 = crop.focus[0]! * iw, fy1 = crop.focus[1]! * ih, fx2 = crop.focus[2]! * iw, fy2 = crop.focus[3]! * ih;
  let heads = (crop.heads ?? []).map((hb) => [hb[0]! * iw, hb[1]! * ih, hb[2]! * iw, hb[3]! * ih]);
  heads = heads.filter((hb) => overlapArea(hb, [cx1, cy1, cx2, cy2]) > 0);
  const x1 = place(cx1, cx2, w, iw, [fx1, fx2], heads.map((hb) => [hb[0]!, hb[2]!, 0]));
  const y1 = place(cy1, cy2, h, ih, [fy1, fy2], heads.map((hb) => [hb[1]!, hb[3]!, 1]));
  const b = fitInto(x1, y1, w, h, iw, ih);
  return [b[0]! / iw, b[1]! / ih, b[2]! / iw, b[3]! / ih];
}

function cover(a1: number, a2: number, b1: number, b2: number): number {
  if (b2 - b1 <= 1e-9) return a1 <= b1 && b1 <= a2 ? 1 : 0;
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)) / (b2 - b1);
}

/** Start of a window of `size` along one axis (see the Python original for the rules). */
function place(c1: number, c2: number, size: number, length: number, focus: [number, number], heads: number[][]): number {
  size = Math.min(size, length);
  let lo = 0;
  let hi = Math.max(0, length - size);
  const [f1, f2] = focus;
  let def: number;
  if (size >= c2 - c1 - 1e-6) {
    lo = Math.max(lo, c2 - size);
    hi = Math.min(hi, c1);
    def = (c1 + c2) / 2 - size / 2;
  } else {
    if (f2 - f1 <= size) {
      lo = Math.max(lo, f2 - size);
      hi = Math.min(hi, f1);
    } else {
      lo = Math.max(lo, f1);
      hi = Math.min(hi, f2 - size);
    }
    const lo2 = Math.max(lo, Math.min(c1, hi));
    const hi2 = Math.min(hi, Math.max(c2 - size, lo));
    lo = lo2;
    hi = hi2;
    def = Math.min(Math.max((f1 + f2) / 2, c1 + size / 2), c2 - size / 2) - size / 2;
  }
  if (hi < lo) return def;
  def = Math.min(Math.max(def, lo), hi);
  if (!heads.length) return def;
  // Python iterates a set of floats; insertion order is a fair stand-in (ties are rare)
  const cands: number[] = [];
  const addC = (v: number) => {
    if (!cands.includes(v)) cands.push(v);
  };
  addC(lo);
  addC(hi);
  addC(def);
  for (const [h1, h2] of heads) {
    for (const v of [h1!, h2! - size, h1! + (h2! - h1!) / 2 - size]) addC(Math.min(Math.max(v, lo), hi));
  }
  const score = (t: number) => {
    let s = 0;
    for (const [h1, h2, top] of heads) {
      s += cover(t, t + size, h1!, h2!);
      if (top && size >= h2! - h1!) s += cover(t, t + size, h1!, h1! + (h2! - h1!) / 2);
    }
    return s;
  };
  return maxBy(cands, (t) => [pyRound(score(t), 6), -Math.abs(t - def)]);
}

/** How badly a panel of this shape and width share frames the crop (0 = exactly the crop). */
export function fitCost(crop: Crop, aspect: number, panelWShare = 0): number {
  const win = fitWindow(crop, aspect, panelWShare);
  const own = windowSize(crop, aspect);
  const sized = windowSize(crop, aspect, panelWShare);
  if (sized[0] === own[0] && sized[1] === own[1]) return windowCost(crop, win);
  return windowCost(crop, win, (own[0] * own[1]) / (crop.imageW * crop.imageH));
}

export function windowCost(crop: Crop, win: Box, looseArea = 0): number {
  const box = crop.box;
  const inter = overlapArea(win, box);
  const lostCrop = 1 - inter / Math.max(boxArea(box), 1e-9);
  const grow = Math.max(0, Math.log(Math.max(looseArea || boxArea(win), 1e-9) / Math.max(inter, 1e-9)));
  const fa = Math.max(boxArea(crop.focus), 1e-9);
  const lostFocus = Math.max(0, (overlapArea(box, crop.focus) - overlapArea(win, crop.focus)) / fa);
  let heads = 0;
  for (const hb of crop.heads ?? []) {
    const ha = boxArea(hb);
    if (ha <= 0 || overlapArea(hb, box) <= 0) continue;
    const inCrop = overlapArea(hb, box) / ha;
    const inWin = overlapArea(hb, win) / ha;
    const topCut = (y: number) => Math.min(1, Math.max(0, (y - hb[1]!) / (hb[3]! - hb[1]!)));
    heads += 1.5 * (Math.max(0, inCrop - inWin) + Math.max(0, topCut(win[1]!) - topCut(box[1]!)));
    heads += 0.25 * (1 - inWin + topCut(win[1]!));
  }
  return 0.25 * grow * grow + lostCrop * lostCrop + 0.5 * lostCrop + 3.0 * lostFocus + heads;
}

function visible(ir: number, aspect: number, zoom: number): [number, number] {
  if (ir > aspect) return [aspect / ir / zoom, 1 / zoom];
  return [1 / zoom, ir / aspect / zoom];
}

/** Panel Fox zoom, focusX, focusY that show `window` in a panel of this aspect (cover fit). */
export function viewForWindow(window: Box, iw: number, ih: number, aspect: number): [number, number, number] {
  const ir = iw / ih;
  const ww = window[2]! - window[0]!;
  const wh = window[3]! - window[1]!;
  let z = ir > aspect ? 1 / Math.max(wh, 1e-6) : 1 / Math.max(ww, 1e-6);
  z = Math.min(Math.max(z, 1), ZOOM_MAX);
  const [vw, vh] = visible(ir, aspect, z);
  const fx = vw >= 0.9999 ? 50 : Math.min(Math.max(window[0]! / (1 - vw), 0), 1) * 100;
  const fy = vh >= 0.9999 ? 50 : Math.min(Math.max(window[1]! / (1 - vh), 0), 1) * 100;
  return [pyRound(z, 4), pyRound(fx, 2), pyRound(fy, 2)];
}

/** Inverse of viewForWindow: the normalized image window Panel Fox shows. */
export function windowFromView(iw: number, ih: number, aspect: number, zoom = 1, focusX = 50, focusY = 50): Box {
  const z = Math.min(Math.max(zoom, 1), ZOOM_MAX);
  const [vw, vh] = visible(iw / Math.max(1, ih), aspect, z);
  const u0 = (focusX / 100) * (1 - vw);
  const v0 = (focusY / 100) * (1 - vh);
  return [u0, v0, u0 + vw, v0 + vh];
}

export type View = {
  zoom: number;
  focusX: number;
  focusY: number;
  window: Box;
  image_w: number;
  image_h: number;
  box: Box;
  focus: Box;
  label: string;
  source: string;
  tier: string;
};

/** Set panel.view (zoom, focus and the visible window) for every panel. */
export function framePanels(pages: Page[], crops: Map<string, Crop>): void {
  for (const page of pages) {
    for (const panel of page.panels) {
      const crop = crops.get(panel.item.name);
      if (!crop) continue;
      const aspect = panelAspect(panel);
      const window = fitWindow(crop, aspect, panel.w / 100);
      const [zoom, fx, fy] = viewForWindow(window, crop.imageW, crop.imageH, aspect);
      const shown = windowFromView(crop.imageW, crop.imageH, aspect, zoom, fx, fy);
      panel.view = {
        zoom,
        focusX: fx,
        focusY: fy,
        window: shown.map((v) => pyRound(v, 5)),
        image_w: crop.imageW,
        image_h: crop.imageH,
        ...crop.toDict(),
      };
    }
  }
}

/** The normalized image window a panel shows (centred cover fit when unframed). */
export function panelWindow(panel: Panel): Box {
  if (panel.view) return [...panel.view.window];
  return windowFromView(panel.item.width, panel.item.height, panelAspect(panel));
}
