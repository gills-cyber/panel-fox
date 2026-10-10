import { clamp } from "@/lib/utils";
import type { BalloonStyle, Overlay, OverlayKind, ResizeHandle } from "./types";

export const BALLOON_STYLES: readonly {
  id: BalloonStyle;
  label: string;
  blurb: string;
}[] = [
  { id: "oval", label: "Oval", blurb: "Classic speech" },
  { id: "round", label: "Round", blurb: "Even circle" },
  { id: "soft", label: "Soft", blurb: "Fat ellipse" },
  { id: "rect", label: "Box tail", blurb: "Rounded box" },
  { id: "burst", label: "Burst", blurb: "Jagged shout" },
  { id: "spike", label: "Spike", blurb: "Angry scream" },
  { id: "cloud", label: "Cloud", blurb: "Thought" },
  { id: "whisper", label: "Whisper", blurb: "Dashed line" },
  { id: "radio", label: "Radio", blurb: "Double line" },
  { id: "box", label: "Caption", blurb: "No tail" },
];

export function styleFromKind(kind: OverlayKind): BalloonStyle {
  if (kind === "thought") return "cloud";
  if (kind === "shout") return "burst";
  if (kind === "scream") return "spike";
  if (kind === "whisper") return "whisper";
  if (kind === "narration") return "box";
  return "oval";
}

export function balloonStyleOf(o: {
  kind: OverlayKind;
  balloonStyle?: BalloonStyle;
}): BalloonStyle {
  return o.balloonStyle ?? styleFromKind(o.kind);
}

export function balloonHasTail(style: BalloonStyle) {
  return style !== "box" && style !== "whisper";
}

export function balloonUsesTrail(style: BalloonStyle) {
  return style === "cloud" || style === "whisper";
}

export function balloonEllipse(style: BalloonStyle): {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
} {
  if (style === "round") return { cx: 50, cy: 50, rx: 42, ry: 42 };
  if (style === "soft") return { cx: 50, cy: 46, rx: 48, ry: 38 };
  if (style === "rect" || style === "box") return { cx: 50, cy: 48, rx: 45, ry: 36 };
  return { cx: 50, cy: 46, rx: 46, ry: 36 };
}

export function balloonTextFrame(
  style: BalloonStyle,
  kind: OverlayKind,
): {
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  clip?: string;
} {
  if (
    kind === "title" ||
    kind === "sfx" ||
    kind === "text" ||
    kind === "sticker" ||
    kind === "tone"
  ) {
    return { padLeft: 4, padRight: 4, padTop: 8, padBottom: 8 };
  }
  if (kind === "narration" || style === "box") {
    return { padLeft: 8, padRight: 8, padTop: 11, padBottom: 11 };
  }
  if (style === "rect") {
    // The box-tail body is the 45×36 rectangle (y 12..84); keep the words inside it.
    return { padLeft: 9, padRight: 9, padTop: 16, padBottom: 20 };
  }
  const e = balloonEllipse(style);
  const inset =
    style === "burst" || style === "spike" ? 0.58 : style === "cloud" ? 0.64 : 0.7;
  const halfW = e.rx * inset;
  const halfH = e.ry * inset;
  return {
    padLeft: round1(e.cx - halfW),
    padRight: round1(100 - e.cx - halfW),
    padTop: round1(e.cy - halfH),
    padBottom: round1(100 - (e.cy + halfH)),
    clip: `ellipse(${round1(e.rx * 0.94)}% ${round1(e.ry * 0.9)}% at ${e.cx}% ${e.cy}%)`,
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function pointInBalloon(
  x: number,
  y: number,
  box: { left: number; top: number; width: number; height: number },
  style: BalloonStyle,
  kind: OverlayKind,
  slack = 1,
) {
  const frame = balloonTextFrame(style, kind);
  if (!frame.clip) {
    const l = box.left + (box.width * frame.padLeft) / 100;
    const r = box.left + box.width - (box.width * frame.padRight) / 100;
    const t = box.top + (box.height * frame.padTop) / 100;
    const b = box.top + box.height - (box.height * frame.padBottom) / 100;
    return x >= l - 1 && x <= r + 1 && y >= t - 1 && y <= b + 1;
  }
  const e = balloonEllipse(style);
  const cx = box.left + (box.width * e.cx) / 100;
  const cy = box.top + (box.height * e.cy) / 100;
  const rx = (box.width * e.rx) / 100 * slack;
  const ry = (box.height * e.ry) / 100 * slack;
  const nx = (x - cx) / Math.max(1, rx);
  const ny = (y - cy) / Math.max(1, ry);
  return nx * nx + ny * ny <= 1;
}

export function burstPath(spikes = 16, jag = 0.16) {
  const cx = 50;
  const cy = 46;
  const rx = 46;
  const ry = 36;
  const pts: string[] = [];
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 1 - jag;
    pts.push(
      `${+(cx + Math.cos(a) * rx * r).toFixed(3)} ${+(cy + Math.sin(a) * ry * r).toFixed(3)}`,
    );
  }
  return `M ${pts.join(" L ")} Z`;
}

export type SnapBox = { id: string; x: number; y: number; w: number; h: number };

export type SnapGuide = {
  id: string;
  axis: "x" | "y";
  at: number;
};

const SNAP_TH = 1.25;

function collectLines(others: SnapBox[], extrasX: number[], extrasY: number[]) {
  const linesX = [...extrasX];
  const linesY = [...extrasY];
  for (const o of others) {
    linesX.push(o.x, o.x + o.w, o.x + o.w / 2);
    linesY.push(o.y, o.y + o.h, o.y + o.h / 2);
  }
  return { linesX, linesY };
}

function bestSnap(
  value: number,
  lines: number[],
  threshold: number,
): { at: number; dist: number } | null {
  let at = value;
  let dist = threshold;
  let hit = false;
  for (const line of lines) {
    const d = Math.abs(value - line);
    if (d < dist) {
      dist = d;
      at = line;
      hit = true;
    }
  }
  return hit ? { at, dist } : null;
}

function pickEdgeSnap(
  candidates: { x: number; at: number; dist: number }[],
): { x: number; at: number } | null {
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  const top = candidates[0]!;
  return { x: top.x, at: top.at };
}

export function extraSnapLines(
  margin: number,
  boxes: SnapBox[],
  gutter: number,
): { x: number[]; y: number[] } {
  const x = [50, margin, 100 - margin];
  const y = [50, margin, 100 - margin];
  const slack = Math.max(0.4, gutter * 0.5);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = 0; j < boxes.length; j++) {
      if (i === j) continue;
      const a = boxes[i]!;
      const b = boxes[j]!;
      const gapX = b.x - (a.x + a.w);
      if (gapX > 0.15 && Math.abs(gapX - gutter) < slack + 0.5) {
        x.push(a.x + a.w + gapX / 2);
      }
      const gapY = b.y - (a.y + a.h);
      if (gapY > 0.15 && Math.abs(gapY - gutter) < slack + 0.5) {
        y.push(a.y + a.h + gapY / 2);
      }
    }
  }
  return { x, y };
}

export function snapMove(
  box: { x: number; y: number; w: number; h: number },
  others: SnapBox[],
  extras: { x: number[]; y: number[] },
  threshold = SNAP_TH,
): { x: number; y: number; guides: SnapGuide[] } {
  const { linesX, linesY } = collectLines(others, extras.x, extras.y);
  const guides: SnapGuide[] = [];
  let { x, y, w, h } = box;

  const xc = pickEdgeSnap(
    [
      snapTo("l", x, linesX, threshold, (at) => at),
      snapTo("r", x + w, linesX, threshold, (at) => at - w),
      snapTo("cx", x + w / 2, linesX, threshold, (at) => at - w / 2),
    ].filter(Boolean) as { x: number; at: number; dist: number }[],
  );
  if (xc) {
    x = clamp(xc.x, 0, 100 - w);
    guides.push({ id: `x:${xc.at.toFixed(2)}`, axis: "x", at: xc.at });
  }

  const yc = pickEdgeSnap(
    [
      snapTo("t", y, linesY, threshold, (at) => at),
      snapTo("b", y + h, linesY, threshold, (at) => at - h),
      snapTo("cy", y + h / 2, linesY, threshold, (at) => at - h / 2),
    ].filter(Boolean) as { x: number; at: number; dist: number }[],
  );
  if (yc) {
    y = clamp(yc.x, 0, 100 - h);
    guides.push({ id: `y:${yc.at.toFixed(2)}`, axis: "y", at: yc.at });
  }

  return { x, y, guides };
}

function snapTo(
  _id: string,
  value: number,
  lines: number[],
  threshold: number,
  toOrigin: (at: number) => number,
): { x: number; at: number; dist: number } | null {
  const hit = bestSnap(value, lines, threshold);
  if (!hit) return null;
  return { x: toOrigin(hit.at), at: hit.at, dist: hit.dist };
}

export function snapResize(
  box: { x: number; y: number; w: number; h: number },
  handle: ResizeHandle,
  others: SnapBox[],
  extras: { x: number[]; y: number[] },
  threshold = SNAP_TH,
): { x: number; y: number; w: number; h: number; guides: SnapGuide[] } {
  const { linesX, linesY } = collectLines(others, extras.x, extras.y);
  const guides: SnapGuide[] = [];
  let { x, y, w, h } = box;
  const moveE = handle.includes("e");
  const moveW = handle.includes("w");
  const moveN = handle.includes("n");
  const moveS = handle.includes("s");

  if (moveE) {
    const hit = bestSnap(x + w, linesX, threshold);
    if (hit) {
      w = Math.max(1.2, hit.at - x);
      guides.push({ id: `x:${hit.at.toFixed(2)}`, axis: "x", at: hit.at });
    }
  }
  if (moveW) {
    const hit = bestSnap(x, linesX, threshold);
    if (hit) {
      const right = x + w;
      x = hit.at;
      w = Math.max(1.2, right - x);
      guides.push({ id: `x:${hit.at.toFixed(2)}`, axis: "x", at: hit.at });
    }
  }
  if (moveS) {
    const hit = bestSnap(y + h, linesY, threshold);
    if (hit) {
      h = Math.max(0.9, hit.at - y);
      guides.push({ id: `y:${hit.at.toFixed(2)}`, axis: "y", at: hit.at });
    }
  }
  if (moveN) {
    const hit = bestSnap(y, linesY, threshold);
    if (hit) {
      const bottom = y + h;
      y = hit.at;
      h = Math.max(0.9, bottom - y);
      guides.push({ id: `y:${hit.at.toFixed(2)}`, axis: "y", at: hit.at });
    }
  }
  return { x, y, w, h, guides };
}

export function overlayAtPoint(
  overlays: Overlay[],
  px: number,
  py: number,
  ignoreId?: string | null,
): Overlay | null {
  let best: Overlay | null = null;
  let bestArea = Infinity;
  for (const o of overlays) {
    if (ignoreId && o.id === ignoreId) continue;
    if (o.hidden) continue;
    if (px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h) {
      const area = o.w * o.h;
      if (area < bestArea) {
        bestArea = area;
        best = o;
      }
    }
  }
  return best;
}

export function tailPagePoint(o: Overlay) {
  return {
    x: o.x + (o.tailX / 100) * o.w,
    y: o.y + (o.tailY / 100) * o.h,
  };
}
