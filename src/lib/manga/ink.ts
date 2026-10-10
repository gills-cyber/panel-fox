/**
 * Hand-drawn balloon ink.
 *
 * One generator feeds both the on-screen SVG (as `d` attributes) and the
 * canvas export (via `new Path2D(d)`), so a balloon looks the same in the
 * editor and on the printed page. Everything is deterministic: a balloon's
 * character comes from a seed derived from its id, never from Math.random.
 *
 * Geometry lives in the balloon's 0..100 unit box, the same space as
 * `balloonEllipse` / `balloonTextFrame`, so the text frame is untouched. The
 * box is stretched non-uniformly on screen (`preserveAspectRatio="none"`), so
 * callers pass the box's on-page proportions (`boxW`, `boxH`, any consistent
 * unit) and the ink is pre-compensated to read as one even pen width.
 *
 * The line itself is a "G-pen" ribbon: a filled shape with pressure-driven
 * thick/thin modulation and a low-frequency hand wobble, rather than a stroked
 * path. Whisper balloons keep a (wobbly) stroked outline so they stay dashed.
 */
import type { BalloonStyle } from "./types";
import { balloonEllipse } from "./balloons";

/** Tail triangle in balloon units (same shape as lettering's SpeechTailGeom). */
export type TailGeom = {
  tipX: number;
  tipY: number;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
};

export type InkBox = { boxW: number; boxH: number };

export type InkShape = {
  /** Closed path of the paper fill (the inner edge of the ink ribbon). */
  paper: string;
  /** Closed path(s) of the ink ribbon, filled with the stroke colour. */
  ink: string;
  /** Optional stroked outline (whisper's dashed line, radio's inner ring). */
  line?: { d: string; width: number; dash?: string };
};

/** Smallest / largest pen width as a fraction of the smaller box side. */
const PEN_MIN = 0.018;
const PEN_MAX = 0.032;

// ---------------------------------------------------------------- seeding

export function inkSeed(id: string | undefined): number {
  let h = 2166136261;
  const s = id || "balloon";
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Periodic, smooth noise on [0,1): a few low harmonics with seeded phases. Closes seamlessly. */
function periodicNoise(rand: () => number, harmonics = 4) {
  const parts: { k: number; amp: number; phase: number }[] = [];
  for (let i = 0; i < harmonics; i++) {
    parts.push({ k: 2 + i, amp: 1 / (i + 1.6), phase: rand() * Math.PI * 2 });
  }
  const norm = parts.reduce((a, p) => a + p.amp, 0);
  return (t: number) => {
    let v = 0;
    for (const p of parts) v += p.amp * Math.sin(p.k * t * Math.PI * 2 + p.phase);
    return v / norm; // roughly -0.7..0.7
  };
}

// --------------------------------------------------------------- geometry

type Pt = { x: number; y: number };

function fmt(n: number) {
  return (Math.round(n * 100) / 100).toString();
}

/** Closed Catmull-Rom spline through the points, as cubic beziers. */
function smoothClosed(pts: Pt[]): string {
  const n = pts.length;
  if (n < 3) return "";
  let d = `M ${fmt(pts[0]!.x)} ${fmt(pts[0]!.y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return d + " Z";
}

/** Open Catmull-Rom spline. */
function smoothOpen(pts: Pt[]): string {
  const n = pts.length;
  if (n < 2) return "";
  let d = `M ${fmt(pts[0]!.x)} ${fmt(pts[0]!.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(n - 1, i + 2)]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return d;
}

/** Outer loop plus a reversed inner loop: a ring under the default nonzero fill rule. */
function ring(outer: string, innerReversed: string): string {
  return `${outer} ${innerReversed}`;
}

function polygon(pts: Pt[]): string {
  return `M ${pts.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(" L ")} Z`;
}

/**
 * Turn a centre line into a ribbon: offset each point along its screen-space
 * normal by half the pen width on each side. `width(i)` is in box units of the
 * smaller side; the offset is converted back into balloon units per axis so
 * the ribbon reads evenly however the box is stretched.
 */
function ribbon(
  pts: Pt[],
  closed: boolean,
  box: InkBox,
  width: (i: number) => number,
  /**
   * Share of the pen that lies outside the centre line: 0.5 straddles it (tail
   * edges), 1 keeps the inner edge on the line so a body's ink only ever grows
   * away from the text.
   */
  outward = 0.5,
): { outer: Pt[]; inner: Pt[] } {
  const sx = box.boxW / 100;
  const sy = box.boxH / 100;
  const unit = Math.min(box.boxW, box.boxH);
  const n = pts.length;
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!;
    const b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!;
    // tangent in screen space
    const tx = (b.x - a.x) * sx;
    const ty = (b.y - a.y) * sy;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const w = width(i) * unit;
    const out = w * outward;
    const inn = w - out;
    const p = pts[i]!;
    outer.push({ x: p.x + (nx * out) / sx, y: p.y + (ny * out) / sy });
    inner.push({ x: p.x - (nx * inn) / sx, y: p.y - (ny * inn) / sy });
  }
  return { outer, inner };
}

/**
 * Stroke width in balloon units for a stroked (not ribboned) line: the SVG and
 * the canvas both stretch units per axis, so aim for the average scale.
 */
function lineUnits(box: InkBox, scale: number) {
  return (PEN_MIN * scale * Math.min(box.boxW, box.boxH) * 200) / (box.boxW + box.boxH);
}

/** Pressure curve: heavier on the lower-left sweep, lighter at the top-right, plus seeded drift. */
function penWidth(rand: () => number, scale = 1) {
  const drift = periodicNoise(rand, 3);
  const bias = rand() * Math.PI * 2;
  return (t: number) => {
    const pressure = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 + bias);
    const w = PEN_MIN + (PEN_MAX - PEN_MIN) * (0.35 + 0.65 * pressure) + drift(t) * 0.004;
    return Math.max(PEN_MIN * 0.8, w) * scale;
  };
}

function ellipsePoints(
  e: { cx: number; cy: number; rx: number; ry: number },
  n: number,
  radial: (t: number) => number,
  start = -Math.PI / 2,
): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = start + t * Math.PI * 2;
    const r = radial(t);
    pts.push({ x: e.cx + Math.cos(a) * e.rx * r, y: e.cy + Math.sin(a) * e.ry * r });
  }
  return pts;
}

function roundedRectPoints(
  e: { cx: number; cy: number; rx: number; ry: number },
  radius: number,
  n: number,
  jitter: (t: number) => number,
): Pt[] {
  // Walk the perimeter: four edges and four quarter arcs, roughly equal spacing.
  const l = e.cx - e.rx;
  const r = e.cx + e.rx;
  const t = e.cy - e.ry;
  const b = e.cy + e.ry;
  const rad = Math.min(radius, e.rx, e.ry);
  const segs: { from: Pt; to: Pt; arc?: { cx: number; cy: number; a0: number } }[] = [
    { from: { x: l + rad, y: t }, to: { x: r - rad, y: t } },
    { from: { x: r - rad, y: t }, to: { x: r, y: t + rad }, arc: { cx: r - rad, cy: t + rad, a0: -Math.PI / 2 } },
    { from: { x: r, y: t + rad }, to: { x: r, y: b - rad } },
    { from: { x: r, y: b - rad }, to: { x: r - rad, y: b }, arc: { cx: r - rad, cy: b - rad, a0: 0 } },
    { from: { x: r - rad, y: b }, to: { x: l + rad, y: b } },
    { from: { x: l + rad, y: b }, to: { x: l, y: b - rad }, arc: { cx: l + rad, cy: b - rad, a0: Math.PI / 2 } },
    { from: { x: l, y: b - rad }, to: { x: l, y: t + rad } },
    { from: { x: l, y: t + rad }, to: { x: l + rad, y: t }, arc: { cx: l + rad, cy: t + rad, a0: Math.PI } },
  ];
  const lengths = segs.map((s) =>
    s.arc ? (Math.PI / 2) * rad : Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y),
  );
  const total = lengths.reduce((a, v) => a + v, 0);
  const pts: Pt[] = [];
  let acc = 0;
  segs.forEach((s, si) => {
    const count = Math.max(2, Math.round((lengths[si]! / total) * n));
    for (let i = 0; i < count; i++) {
      const u = i / count;
      const tt = (acc + u * lengths[si]!) / total;
      let p: Pt;
      if (s.arc) {
        const a = s.arc.a0 + (u * Math.PI) / 2;
        p = { x: s.arc.cx + Math.cos(a) * rad, y: s.arc.cy + Math.sin(a) * rad };
      } else {
        p = { x: s.from.x + (s.to.x - s.from.x) * u, y: s.from.y + (s.to.y - s.from.y) * u };
      }
      // jitter along the outward normal of the box (toward the edge the point sits on)
      const j = jitter(tt);
      const ox = p.x - e.cx;
      const oy = p.y - e.cy;
      const ol = Math.hypot(ox / e.rx, oy / e.ry) || 1;
      pts.push({ x: p.x + (ox / e.rx / ol) * j, y: p.y + (oy / e.ry / ol) * j });
    }
    acc += lengths[si]!;
  });
  return pts;
}

// ------------------------------------------------------------------ bodies

/**
 * Hand-drawn balloon body for a style. Returns the paper and ink shapes in
 * balloon units. `amount` scales the roughness (1 = default, 0 = clean).
 */
export function inkBody(
  style: BalloonStyle,
  seed: number,
  box: InkBox,
  amount = 1,
  /** Pen width multiplier (thumbnails use a heavier nib so the line survives at 28px). */
  pen = 1,
): InkShape {
  const rand = mulberry(seed);
  const e = balloonEllipse(style);
  const width = penWidth(rand, pen);

  if (style === "burst" || style === "spike") {
    const spikes = style === "spike" ? 22 : 16;
    const jag = style === "spike" ? 0.22 : 0.16;
    const pts: Pt[] = [];
    for (let i = 0; i < spikes; i++) {
      // uneven spike length and lean, the way a hand rushes a shout
      const lean = (rand() - 0.5) * 0.35 * amount;
      const a = ((i + lean) / spikes) * Math.PI * 2 - Math.PI / 2;
      const base = i % 2 === 0 ? 1 : 1 - jag;
      // Tips vary freely; valleys only ever move outward from the clean valley.
      const r = base + (i % 2 === 0 ? (rand() - 0.3) * 0.09 : rand() * 0.04) * amount;
      pts.push({ x: e.cx + Math.cos(a) * e.rx * r, y: e.cy + Math.sin(a) * e.ry * r });
    }
    const rb = ribbon(pts, true, box, (i) => width(i / spikes) * 1.05, 1);
    return { paper: polygon(rb.inner), ink: ring(polygon(rb.outer), polygon(rb.inner.slice().reverse())) };
  }

  if (style === "rect" || style === "box") {
    const wob = periodicNoise(rand, 5);
    const amp = (style === "box" ? 0.5 : 0.7) * amount;
    const n = 64;
    // A caption's text frame is the padded box (balloonTextFrame), so its body
    // fills the box like the clean caption rect does, instead of the dialogue ellipse.
    const rect = style === "box" ? { cx: 50, cy: 50, rx: 47.5, ry: 47 } : e;
    const pts = roundedRectPoints(rect, style === "box" ? 5 : 10, n, (t) => wob(t) * amp);
    const rb = ribbon(pts, true, box, (i) => width(i / pts.length) * (style === "box" ? 0.95 : 1), 1);
    return { paper: smoothClosed(rb.inner), ink: ring(smoothClosed(rb.outer), smoothClosed(rb.inner.slice().reverse())) };
  }

  if (style === "cloud") {
    // Scalloped thought cloud: bumps of uneven width bulging out of the base ellipse.
    const bumps = 9 + Math.floor(rand() * 3);
    const edges: number[] = [0];
    let acc = 0;
    const weights: number[] = [];
    for (let i = 0; i < bumps; i++) weights.push(0.7 + rand() * 0.6);
    const wsum = weights.reduce((a, v) => a + v, 0);
    for (let i = 0; i < bumps; i++) {
      acc += weights[i]! / wsum;
      edges.push(acc);
    }
    const heights = weights.map(() => 0.1 + rand() * 0.08);
    const dip = 0.06;
    const n = 160;
    const radial = (t: number) => {
      let b = 0;
      while (b < bumps - 1 && t >= edges[b + 1]!) b++;
      const u = (t - edges[b]!) / (edges[b + 1]! - edges[b]!);
      const bump = Math.sin(u * Math.PI) ** 0.75;
      return 1 - dip * amount + heights[b]! * amount * bump;
    };
    const pts = ellipsePoints(e, n, radial, -Math.PI / 2 + rand() * 0.6);
    const rb = ribbon(pts, true, box, (i) => width(i / n) * 0.95, 1);
    return { paper: smoothClosed(rb.inner), ink: ring(smoothClosed(rb.outer), smoothClosed(rb.inner.slice().reverse())) };
  }

  // Ovals (oval, round, soft, radio) and whisper: ellipse with a hand wobble.
  const wob = periodicNoise(rand, 4);
  // ±2% of the radius (±1% for whisper, whose stroked line straddles the outline).
  const amp = (style === "whisper" ? 0.011 : 0.022) * amount;
  const n = 72;
  const pts = ellipsePoints(e, n, (t) => 1 + wob(t) * amp, -Math.PI / 2 + rand() * Math.PI * 2);

  if (style === "whisper") {
    // Whisper stays a light dashed line, so it is stroked rather than inked as a ribbon.
    const d = smoothClosed(pts);
    return { paper: d, ink: "", line: { d, width: lineUnits(box, 0.7 * pen), dash: "5 4" } };
  }

  const rb = ribbon(pts, true, box, (i) => width(i / n), 1);
  const shape: InkShape = {
    paper: smoothClosed(rb.inner),
    ink: ring(smoothClosed(rb.outer), smoothClosed(rb.inner.slice().reverse())),
  };
  if (style === "radio") {
    const inner = ellipsePoints(
      { cx: e.cx, cy: e.cy, rx: e.rx * 0.82, ry: e.ry * 0.78 },
      n,
      (t) => 1 + wob(t + 0.37) * amp,
      -Math.PI / 2,
    );
    shape.line = { d: smoothClosed(inner), width: lineUnits(box, 0.75 * pen) };
  }
  return shape;
}

// ------------------------------------------------------------------- tails

/**
 * Hand-drawn speech tail: two slightly bowed, tapering edges meeting at the
 * tip. `paper` closes over the balloon edge so the body's ink is covered where
 * the tail joins; `ink` holds the two tapered edge ribbons.
 */
export function inkTail(g: TailGeom, seed: number, box: InkBox, amount = 1): InkShape {
  const rand = mulberry(seed ^ 0x9e3779b9);
  const width = penWidth(rand);
  const mx = (g.leftX + g.rightX) / 2;
  const my = (g.leftY + g.rightY) / 2;
  const dx = g.tipX - mx;
  const dy = g.tipY - my;
  const len = Math.hypot(dx, dy) || 1;
  // bow the edges a little toward each other, like a pen pulled toward the tip
  const bow = (0.08 + rand() * 0.08) * amount;
  const sign = rand() < 0.5 ? 1 : -1;
  const px = (-dy / len) * len * bow * sign;
  const py = (dx / len) * len * bow * sign;
  const steps = 10;
  const edge = (from: Pt, to: Pt, bend: number): Pt[] => {
    const c = { x: (from.x + to.x) / 2 + px * bend, y: (from.y + to.y) / 2 + py * bend };
    const out: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      out.push({
        x: (1 - u) ** 2 * from.x + 2 * (1 - u) * u * c.x + u * u * to.x,
        y: (1 - u) ** 2 * from.y + 2 * (1 - u) * u * c.y + u * u * to.y,
      });
    }
    return out;
  };
  const left = edge({ x: g.leftX, y: g.leftY }, { x: g.tipX, y: g.tipY }, 1);
  const right = edge({ x: g.rightX, y: g.rightY }, { x: g.tipX, y: g.tipY }, 0.6);
  const taper = (i: number) => width(0.25) * (1 - 0.55 * (i / steps));
  const lr = ribbon(left, false, box, taper);
  const rr = ribbon(right, false, box, taper);
  const paper = polygon([...left, ...right.slice().reverse()]);
  const inkL = polygon([...lr.outer, ...lr.inner.slice().reverse()]);
  const inkR = polygon([...rr.outer, ...rr.inner.slice().reverse()]);
  return { paper, ink: `${inkL} ${inkR}` };
}

/** Thought-trail puff with a wobbly edge. */
export function inkPuff(
  p: { cx: number; cy: number; rx: number; ry: number },
  seed: number,
  box: InkBox,
  amount = 1,
): InkShape {
  const rand = mulberry(seed);
  const wob = periodicNoise(rand, 3);
  const n = 24;
  const pts = ellipsePoints(p, n, (t) => 1 + wob(t) * 0.06 * amount, rand() * Math.PI * 2);
  const width = penWidth(rand, 0.85);
  const rb = ribbon(pts, true, box, (i) => width(i / n), 1);
  return { paper: smoothClosed(rb.inner), ink: ring(smoothClosed(rb.outer), smoothClosed(rb.inner.slice().reverse())) };
}
