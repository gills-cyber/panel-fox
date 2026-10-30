/**
 * Dynamic page and panel layout: 3 to 6 panels a page, page breaks chosen for
 * the story, and every split of a page's images into bands tried so the
 * panel shapes fit the crops they show. Output coordinates are page percent.
 */
import { minBy, psum, pyRound, sq } from "./py.ts";
import type { View } from "./crop.ts";

export const PAGE_W = 1000.0;
export const PAGE_H = 1414.0;

const GROW_W = 0.25;
const TRIM_W = 2.0;
const GROW_MAX = 1.8;
const STANDOUT = 1.5;
const LEAD_MARGIN = 1.05;
const LEAD_W = 20.0;
const AREA_W = 2.0;
const AREA_FREE = 0.25;
const MIN_ROW = 0.14;
const THIN_W = 8.0;
const ASPECT_LIMITS: [number, number] = [0.3, 3.6];
const SLIVER_W = 40.0;
const MAX_ENUM = 10;
const REFINE_QUICK = 60;
const REFINE_TOP = 4;
const REFINE_EVALS = 300;
const PAGE_LOAD = 4.5;
const KEY_LOAD = 1.5;
const CLIMAX_LOAD = 2.5;
const LOAD_W = 0.1;
const BEAT_SPLIT = 1.5;
const CLIMAX_TURN = 2.0;

export type LayoutItem = {
  name: string;
  width: number;
  height: number;
  importance: number;
  minAspect: number;
  maxAspect: number;
  fit: ((aspect: number, share: number) => number) | null;
  beat: number;
};

export function itemAspect(it: LayoutItem): number {
  return it.height ? it.width / it.height : 0.7;
}

function itemRange(it: LayoutItem): [number, number] {
  const a = itemAspect(it);
  const lo = 0 < it.minAspect && it.minAspect <= a ? it.minAspect : a;
  const hi = it.maxAspect >= a ? it.maxAspect : a;
  return [lo, hi];
}

export type Panel = { id: string; item: LayoutItem; x: number; y: number; w: number; h: number; view: View | null };
export type Page = { id: string; title: string; panels: Panel[]; kind: string };

export type LayoutOptions = {
  margin: number;
  gutter: number;
  rtl: boolean;
  climaxThreshold: number;
  keyThreshold: number;
  minPanels: number;
  maxPanels: number;
};

export function layoutOptions(o: Partial<LayoutOptions> = {}): LayoutOptions {
  return { margin: 40, gutter: 18, rtl: true, climaxThreshold: 5, keyThreshold: 4, minPanels: 3, maxPanels: 6, ...o };
}

function load(it: LayoutItem, opt: LayoutOptions) {
  if (it.importance >= opt.climaxThreshold) return CLIMAX_LOAD;
  return it.importance >= opt.keyThreshold ? KEY_LOAD : 1.0;
}

function pageKind(group: LayoutItem[], opt: LayoutOptions) {
  const top = Math.max(...group.map((it) => it.importance));
  return top >= opt.climaxThreshold ? "climax" : top >= opt.keyThreshold ? "key" : "normal";
}

/** Break the chapter (in reading order) into pages: the best set of page breaks wins. */
export function groupPages(items: LayoutItem[], opt: LayoutOptions, yieldEvery?: () => void): [string, LayoutItem[]][] {
  const n = items.length;
  if (n === 0) return [];
  const lo = Math.min(opt.minPanels, n);
  const hi = Math.max(1, opt.maxPanels);
  const plans = new Map<string, number>();
  const pageCost = (i: number, j: number) => {
    const group = items.slice(i, j);
    const k = `${i},${j}`;
    if (!plans.has(k)) {
      plans.set(k, plan(group, opt)[0]);
      yieldEvery?.();
    }
    const ld = psum(group.map((it) => load(it, opt)));
    let cost = plans.get(k)! + LOAD_W * sq(ld - PAGE_LOAD);
    if (i > 0 && items[i]!.beat && items[i]!.beat === items[i - 1]!.beat && items[i]!.importance < opt.climaxThreshold) {
      cost += BEAT_SPLIT;
    }
    cost += CLIMAX_TURN * group.slice(1).filter((it) => it.importance >= opt.climaxThreshold).length;
    return cost;
  };
  const best: ([number, number] | null)[] = new Array(n + 1).fill(null);
  best[0] = [0, -1];
  for (let j = 1; j <= n; j++) {
    for (let size = lo; size <= hi; size++) {
      const i = j - size;
      if (i < 0 || best[i] === null) continue;
      const c = best[i]![0] + pageCost(i, j);
      if (best[j] === null || c < best[j]![0] - 1e-9) best[j] = [c, i];
    }
  }
  if (best[n] === null) {
    const out: [string, LayoutItem[]][] = [];
    for (let k = 0; k < n; k += hi) out.push([pageKind(items.slice(k, k + hi), opt), items.slice(k, k + hi)]);
    return out;
  }
  const cuts: [number, number][] = [];
  let j = n;
  while (j > 0) {
    const i = best[j]![1];
    cuts.push([i, j]);
    j = i;
  }
  return cuts.reverse().map(([i, jj]) => [pageKind(items.slice(i, jj), opt), items.slice(i, jj)]);
}

type Cell = LayoutItem[];
type Band = Cell[];
type Plan = Band[];
type Geom = [number[], number[][], (number | null)[][]];

function compositions(n: number, ok: (start: number, size: number) => boolean): number[][] {
  const out: number[][] = [];
  const sizes: number[] = [];
  const rec = (start: number) => {
    if (start === n) {
      out.push([...sizes]);
      return;
    }
    for (let k = 1; k <= n - start; k++) {
      if (ok(start, k)) {
        sizes.push(k);
        rec(start + k);
        sizes.pop();
      }
    }
  };
  rec(0);
  return out;
}

function bandOptions(row: LayoutItem[]): Band[] {
  const k = row.length;
  const out: Band[] = [];
  if (k <= 3 || (k === 4 && row.every((it) => itemAspect(it) < 0.62))) out.push(row.map((it) => [it]));
  if (k >= 3 && k <= 4) {
    for (let s = 0; s < k - 1; s++) {
      out.push([...row.slice(0, s).map((it) => [it]), [row[s]!, row[s + 1]!], ...row.slice(s + 2).map((it) => [it])]);
    }
  }
  return out;
}

function plansFor(items: LayoutItem[]): Plan[] {
  const n = items.length;
  if (n > MAX_ENUM) {
    const k = Math.ceil(n / 3);
    const size = Math.ceil(n / k);
    const bands: Plan = [];
    for (let i = 0; i < n; i += size) bands.push(items.slice(i, i + size).map((it) => [it]));
    return [bands];
  }
  const options = new Map<string, Band[]>();
  for (let start = 0; start < n; start++) {
    for (let k = 1; k <= Math.min(4, n - start); k++) options.set(`${start},${k}`, bandOptions(items.slice(start, start + k)));
  }
  const plans: Plan[] = [];
  for (const sizes of compositions(n, (s, k) => (options.get(`${s},${k}`)?.length ?? 0) > 0)) {
    let partial: Plan[] = [[]];
    let i = 0;
    for (const k of sizes) {
      const opts = options.get(`${i},${k}`)!;
      const next: Plan[] = [];
      for (const p of partial) for (const band of opts) next.push([...p, band]);
      partial = next;
      i += k;
    }
    plans.push(...partial);
  }
  return plans;
}

function spread(total: number, specs: [number, number, number][]): number[] {
  const nat = psum(specs.map((x) => x[0]));
  let base: number[];
  if (total >= nat) {
    const hi = psum(specs.map((x) => x[2]));
    if (hi - nat > 1e-9 && total <= hi) {
      const f = (total - nat) / (hi - nat);
      return specs.map((s) => s[0] + (s[2] - s[0]) * f);
    }
    base = hi - nat > 1e-9 ? specs.map((s) => s[2]) : specs.map((s) => s[0]);
  } else {
    const lo = psum(specs.map((x) => x[1]));
    if (nat - lo > 1e-9 && total >= lo) {
      const f = (nat - total) / (nat - lo);
      return specs.map((s) => s[0] - (s[0] - s[1]) * f);
    }
    base = nat - lo > 1e-9 ? specs.map((s) => s[1]) : specs.map((s) => s[0]);
  }
  const k = total / Math.max(1e-9, psum(base));
  return base.map((b) => b * k);
}

function softRange(it: LayoutItem): [number, number, number] {
  const a = itemAspect(it);
  const [lo, hi] = itemRange(it);
  return [a, Math.max(lo, a / GROW_MAX), Math.min(hi, a * GROW_MAX)];
}

function cellRange(cell: Cell): [number, number, number] {
  if (cell.length === 1) return softRange(cell[0]!);
  const r1 = softRange(cell[0]!);
  const r2 = softRange(cell[1]!);
  return [0, 1, 2].map((i) => 1 / (1 / r1[i]! + 1 / r2[i]!)) as [number, number, number];
}

function fitCostOf(it: LayoutItem, p: number, share = 0): number {
  if (it.fit) return it.fit(p, share);
  const a = Math.max(1e-6, itemAspect(it));
  const [lo, hi] = itemRange(it);
  const u = Math.log(p / a);
  const t = p < lo ? Math.log(lo / p) : p > hi ? Math.log(p / hi) : 0;
  return GROW_W * u * u + TRIM_W * t * t;
}

function weight(it: LayoutItem) {
  return 0.6 + 0.2 * Math.max(1, Math.min(5, it.importance));
}

function standoutOf(items: LayoutItem[]): LayoutItem | null {
  if (items.length < 2) return null;
  const top = Math.max(...items.map((it) => it.importance));
  const tops = items.filter((it) => it.importance === top);
  return tops.length === 1 ? tops[0]! : null;
}

function arrange(plan: Plan, W: number, H: number, g: number, even = false): Geom {
  const totalH = H - g * (plan.length - 1);
  const specs: [number, number, number][] = [];
  const ranges: [number, number, number][][] = [];
  for (const band of plan) {
    const avail = W - g * (band.length - 1);
    const rs = band.map(cellRange);
    ranges.push(rs);
    specs.push([
      avail / psum(rs.map((r) => r[0])),
      avail / psum(rs.map((r) => r[2])),
      avail / psum(rs.map((r) => r[1])),
    ]);
  }
  const heights = even ? plan.map(() => totalH / plan.length) : spread(totalH, specs);
  const widths: number[][] = [];
  const splits: (number | null)[][] = [];
  plan.forEach((band, bi) => {
    const rs = ranges[bi]!;
    const bh = heights[bi]!;
    const avail = W - g * (band.length - 1);
    widths.push(spread(avail / bh, rs).map((p) => p * bh));
    splits.push(
      band.map((c) =>
        c.length === 2 ? 1 / itemAspect(c[0]!) / (1 / itemAspect(c[0]!) + 1 / itemAspect(c[1]!)) : null,
      ),
    );
  });
  return [heights, widths, splits];
}

type BoxOut = [LayoutItem, number, number, number, number];

function boxes(plan: Plan, geom: Geom, g: number): BoxOut[] {
  const [heights, widths, splits] = geom;
  const out: BoxOut[] = [];
  let y = 0;
  plan.forEach((band, bi) => {
    const bh = heights[bi]!;
    const ws = widths[bi]!;
    const ss = splits[bi]!;
    let x = 0;
    band.forEach((cell, ci) => {
      const w = ws[ci]!;
      const f = ss[ci];
      if (cell.length === 1) out.push([cell[0]!, x, y, w, bh]);
      else {
        const h1 = (bh - g) * f!;
        out.push([cell[0]!, x, y, w, h1]);
        out.push([cell[1]!, x, y + h1 + g, w, bh - g - h1]);
      }
      x += w + g;
    });
    y += bh + g;
  });
  return out;
}

function score(plan: Plan, geom: Geom, standout: LayoutItem | null, totalH: number, g: number, lead: LayoutItem | null): number {
  const bx = boxes(plan, geom, g);
  const low = Math.min(...bx.map((b) => b[0].importance));
  let cost = 0;
  const areas: number[] = [];
  const targets: number[] = [];
  const floor = MIN_ROW * totalH;
  for (const [it, , , w, h] of bx) {
    if (w <= 1e-6 || h <= 1e-6) return Infinity;
    const p = w / h;
    cost += weight(it) * fitCostOf(it, p, w / PAGE_W);
    const [loLim, hiLim] = ASPECT_LIMITS;
    if (p < loLim) cost += SLIVER_W * sq(Math.log(loLim / p));
    else if (p > hiLim) cost += SLIVER_W * sq(Math.log(p / hiLim));
    if (bx.length > 1 && h < floor) cost += THIN_W * sq(Math.log(floor / h));
    areas.push(w * h);
    targets.push((1.0 + 0.25 * (it.importance - low)) * (it === standout ? STANDOUT : 1.0));
  }
  if (bx.length > 1) {
    const sa = psum(areas);
    const st = psum(targets);
    areas.forEach((a, i) => {
      const off = Math.abs(Math.log(a / sa / (targets[i]! / st)));
      cost += AREA_W * sq(Math.max(0, off - AREA_FREE));
    });
  }
  if (lead !== null) {
    let mine = 0;
    let other = -Infinity;
    bx.forEach((b, i) => {
      if (b[0] === lead) {
        if (!mine) mine = areas[i]!;
      } else other = Math.max(other, areas[i]!);
    });
    const short = Math.log((other * LEAD_MARGIN) / mine);
    if (short > 0) cost += LEAD_W * short * short;
  }
  return cost;
}

function refine(
  plan: Plan,
  geom: Geom,
  standout: LayoutItem | null,
  W: number,
  totalH: number,
  g: number,
  minStep = 0.006,
  maxEvals = 0,
  lead: LayoutItem | null = null,
): [number, Geom] {
  let heights = [...geom[0]];
  let widths = geom[1].map((w) => [...w]);
  let splits = geom[2].map((s) => [...s]);
  let cur = score(plan, [heights, widths, splits], standout, totalH, g, lead);
  const minH = 0.06 * totalH;
  const minW = 0.08 * W;
  let step = 0.06;
  let evals = 0;
  maxEvals = maxEvals || REFINE_EVALS;
  while (step > minStep && evals < maxEvals) {
    let improved = false;
    for (let r = 0; r < plan.length - 1; r++) {
      for (const d of [step * totalH, -step * totalH]) {
        const a = heights[r]! + d;
        const b = heights[r + 1]! - d;
        if (a < minH || b < minH) continue;
        const trial = [...heights.slice(0, r), a, b, ...heights.slice(r + 2)];
        const sc = score(plan, [trial, widths, splits], standout, totalH, g, lead);
        evals++;
        if (sc < cur - 1e-9) {
          heights = trial;
          cur = sc;
          improved = true;
          break;
        }
      }
    }
    for (let r = 0; r < plan.length; r++) {
      let ws = widths[r]!;
      for (let i = 0; i < ws.length - 1; i++) {
        for (const d of [step * W, -step * W]) {
          const a = ws[i]! + d;
          const b = ws[i + 1]! - d;
          if (a < minW || b < minW) continue;
          const trial = [...widths.slice(0, r), [...ws.slice(0, i), a, b, ...ws.slice(i + 2)], ...widths.slice(r + 1)];
          const sc = score(plan, [heights, trial, splits], standout, totalH, g, lead);
          evals++;
          if (sc < cur - 1e-9) {
            widths = trial;
            ws = trial[r]!;
            cur = sc;
            improved = true;
            break;
          }
        }
      }
      const row = splits[r]!;
      for (let i = 0; i < row.length; i++) {
        let f = row[i];
        if (f === null || f === undefined) continue;
        for (const d of [step * 1.5, -step * 1.5]) {
          const nf = f + d;
          if (!(nf >= 0.15 && nf <= 0.85)) continue;
          const trial = splits.map((x) => [...x]);
          trial[r]![i] = nf;
          const sc = score(plan, [heights, widths, trial], standout, totalH, g, lead);
          evals++;
          if (sc < cur - 1e-9) {
            splits = trial;
            f = nf;
            cur = sc;
            improved = true;
            break;
          }
        }
      }
    }
    if (!improved) step /= 2;
  }
  return [cur, [heights, widths, splits]];
}

function plan(items: LayoutItem[], opt: LayoutOptions): [number, Plan, Geom] {
  const m = opt.margin;
  const g = opt.gutter;
  const W = PAGE_W - 2 * m;
  const H = PAGE_H - 2 * m;
  const standout = standoutOf(items);
  const lead = standout !== null && standout.importance >= opt.keyThreshold ? standout : null;
  const scored: [number, Plan, Geom][] = [];
  for (const p of plansFor(items)) {
    const totalH = H - g * (p.length - 1);
    const starts = [arrange(p, W, H, g), ...(p.length > 1 ? [arrange(p, W, H, g, true)] : [])];
    const [sc, geom] = minBy(
      starts.map((st) => refine(p, st, standout, W, totalH, g, 0.012, REFINE_QUICK, lead)),
      (r) => r[0],
    );
    scored.push([sc, p, geom]);
  }
  const order = scored.map((s, i) => [s, i] as const);
  order.sort((x, y) => (x[0][0] < y[0][0] ? -1 : x[0][0] > y[0][0] ? 1 : x[1] - y[1]));
  let best: [number, Plan, Geom] | null = null;
  for (const [[, p, geom]] of order.slice(0, REFINE_TOP)) {
    const [sc, g2] = refine(p, geom, standout, W, H - g * (p.length - 1), g, 0.006, 0, lead);
    if (best === null || sc < best[0] - 1e-9) best = [sc, p, g2];
  }
  return best!;
}

/** (item, x, y, w, h) in page units, in reading order. */
export function layoutPage(items: LayoutItem[], opt: LayoutOptions): BoxOut[] {
  const m = opt.margin;
  const g = opt.gutter;
  const [, p, geom] = plan(items, opt);
  return boxes(p, geom, g).map(([it, x, y, w, h]) => [it, opt.rtl ? PAGE_W - m - x - w : m + x, m + y, w, h]);
}

export function buildLayout(items: LayoutItem[], opt: LayoutOptions = layoutOptions()): Page[] {
  const pages: Page[] = [];
  let pc = 0;
  groupPages(items, opt).forEach(([kind, group], idx) => {
    const p = idx + 1;
    const page: Page = { id: `page-${p}`, title: `Page ${p}`, panels: [], kind };
    for (const [it, x, y, w, h] of layoutPage(group, opt)) {
      pc++;
      page.panels.push({
        id: `panel-${pc}`,
        item: it,
        x: pyRound((x / PAGE_W) * 100, 3),
        y: pyRound((y / PAGE_H) * 100, 3),
        w: pyRound((w / PAGE_W) * 100, 3),
        h: pyRound((h / PAGE_H) * 100, 3),
        view: null,
      });
    }
    pages.push(page);
  });
  return pages;
}
