import { clamp } from "@/lib/utils";
import { balloonStyleOf, balloonTextFrame } from "./balloons";
import { canvasFont } from "./fonts";
import { letterPixelSize } from "./lettering";
import type { Overlay } from "./types";

/**
 * Measured lettering fit.
 *
 * Bubbles are sized from real text metrics (canvas measureText with the same
 * font the page renders), so the type size never changes to make text fit:
 * the balloon grows or reshapes around the words instead. Everything is
 * measured on a virtual page REF_H px tall; type scales with the sheet height,
 * so percentages come out the same at any zoom.
 */
const REF_H = 1000;

/** Balloon kinds whose box follows the words. Titles, SFX and vertical text keep their own sizing. */
export function usesMeasuredFit(o: Pick<Overlay, "kind" | "vertical">): boolean {
  if (o.vertical) return false;
  return (
    o.kind === "speech" ||
    o.kind === "thought" ||
    o.kind === "shout" ||
    o.kind === "whisper" ||
    o.kind === "scream" ||
    o.kind === "narration" ||
    o.kind === "text"
  );
}

/** Patch keys that change how the words lay out. */
export const LAYOUT_KEYS = [
  "text",
  "fontSize",
  "fontId",
  "bold",
  "italic",
  "balloonStyle",
  "kind",
  "vertical",
] as const;

let ctx: CanvasRenderingContext2D | null | undefined;
function measureCtx(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  if (typeof document === "undefined") return (ctx = null);
  try {
    ctx = document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  return ctx;
}

type Metrics = {
  px: number;
  lh: number;
  pageW: number;
  pageH: number;
  fx: number;
  fy: number;
  width: (s: string) => number;
};

function metrics(o: Overlay, aspect: number): Metrics | null {
  const c = measureCtx();
  if (!c) return null;
  const pageH = REF_H;
  const pageW = REF_H * aspect;
  const px = letterPixelSize(o, pageH);
  c.font = canvasFont(px, Boolean(o.bold), Boolean(o.italic), o.fontId, o.kind);
  const spacing = o.kind === "text" ? 0 : -0.02 * px;
  const cache = new Map<string, number>();
  const width = (s: string) => {
    let w = cache.get(s);
    if (w == null) {
      // CSS letter-spacing is added after every character.
      w = c.measureText(s).width + spacing * [...s].length;
      cache.set(s, w);
    }
    return w;
  };
  const frame = balloonTextFrame(balloonStyleOf(o), o.kind);
  return {
    px,
    lh: px * (o.kind === "text" ? 1.35 : 1.2),
    pageW,
    pageH,
    fx: Math.max(0.2, 1 - (frame.padLeft + frame.padRight) / 100),
    fy: Math.max(0.2, 1 - (frame.padTop + frame.padBottom) / 100),
    width,
  };
}

/** Greedy whole-word wrap, the same rule the page uses. Only a word wider than the line is split. */
function wrap(m: Metrics, text: string, max: number): { lines: number; widest: number } {
  let lines = 0;
  let widest = 0;
  for (const para of text.split("\n")) {
    const words = para.split(/ +/).filter(Boolean);
    if (!words.length) {
      lines++;
      continue;
    }
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (!line || m.width(test) <= max) {
        line = test;
        continue;
      }
      widest = Math.max(widest, m.width(line));
      lines++;
      line = word;
    }
    // A single word longer than the line breaks by character, like overflow-wrap: break-word.
    const w = m.width(line);
    if (w > max) {
      lines += Math.ceil(w / max);
      widest = Math.max(widest, max);
    } else {
      lines++;
      widest = Math.max(widest, w);
    }
  }
  return { lines: Math.max(1, lines), widest };
}

function longestWord(m: Metrics, text: string) {
  let best = 0;
  for (const word of text.split(/\s+/)) if (word) best = Math.max(best, m.width(word));
  return best;
}

/** Slack so DOM wrapping (sub-pixel kerning, hinting) never breaks earlier than the measurement. */
function slackW(m: Metrics, w: number) {
  return w * 1.04 + m.px * 0.35;
}

function bubblePx(m: Metrics, innerW: number, lines: number) {
  return {
    w: slackW(m, innerW) / m.fx,
    h: (lines * m.lh + m.px * 0.2) / m.fy,
  };
}

/** Target balloon shape (width / height on the page). */
function targetAspect(o: Overlay) {
  if (o.kind === "whisper") return 1.45;
  if (o.kind === "shout" || o.kind === "scream") return 1.5;
  if (o.kind === "thought") return 1.5;
  return 1.6;
}

function center(o: Overlay, w: number, h: number): Pick<Overlay, "x" | "y" | "w" | "h"> {
  const W = clamp(w, 2, 96);
  const H = clamp(h, 2, 94);
  return {
    w: round2(W),
    h: round2(H),
    x: round2(clamp(o.x + (o.w - W) / 2, 0, 100 - W)),
    y: round2(clamp(o.y + (o.h - H) / 2, 0, 100 - H)),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Size a balloon around its words.
 *
 * - `auto`: pick a pleasing balanced shape. While typing (`prev` given) the
 *   current width is kept as long as it still looks right, so the balloon
 *   grows calmly instead of reshaping on every key.
 * - `grow`: the user sized this balloon by hand. Never shrink it; only grow
 *   enough that whole words and every line fit inside.
 */
export function fitLetterBox(
  o: Overlay,
  aspect: number,
  mode: "auto" | "grow",
  prev?: Overlay,
): Pick<Overlay, "x" | "y" | "w" | "h"> | null {
  if (!usesMeasuredFit(o)) return null;
  const m = metrics(o, aspect);
  if (!m) return null;
  const text = o.text || " ";
  const toPctW = (px: number) => (px / m.pageW) * 100;
  const toPctH = (px: number) => (px / m.pageH) * 100;
  const maxInner = ((o.kind === "narration" || o.kind === "text" ? 96 : 88) / 100) * m.pageW * m.fx / 1.04;
  const word = Math.min(longestWord(m, text), maxInner);

  // Captions and text boxes keep their width; height follows the words.
  if (o.kind === "narration" || o.kind === "text") {
    let innerW = (o.w / 100) * m.pageW * m.fx;
    let w = o.w;
    if (slackW(m, word) > innerW) {
      innerW = slackW(m, word);
      w = toPctW(innerW / m.fx);
    }
    const r = wrap(m, text, innerW / 1.04 - m.px * 0.35);
    const need = toPctH(bubblePx(m, r.widest, r.lines).h);
    const h = mode === "grow" ? Math.max(o.h, need) : need;
    const box = center(o, w, h);
    // Captions grow downward from their top edge.
    box.y = round2(clamp(o.y, 0, 100 - box.h));
    if (box.w === o.w) box.x = o.x;
    return box;
  }

  if (mode === "grow") {
    const innerNow = (o.w / 100) * m.pageW * m.fx;
    const innerW = Math.max(innerNow, slackW(m, word));
    const r = wrap(m, text, innerW / 1.04 - m.px * 0.35);
    const need = bubblePx(m, r.widest, r.lines);
    const w = Math.max(o.w, toPctW(innerW / m.fx));
    const h = Math.max(o.h, toPctH(need.h));
    if (Math.abs(w - o.w) < 0.05 && Math.abs(h - o.h) < 0.05) return center(o, o.w, o.h);
    return center(o, w, h);
  }

  const target = targetAspect(o);
  const minInner = Math.max(word, m.px * 2.6);
  const full = wrap(m, text, Number.POSITIVE_INFINITY).widest;
  const score = (b: { w: number; h: number }) => Math.abs(Math.log(b.w / b.h / target));

  // Keep the balloon's width while typing if the words still sit well in it.
  if (prev && usesMeasuredFit(prev)) {
    const innerNow = (prev.w / 100) * m.pageW * m.fx;
    const usable = innerNow / 1.04 - m.px * 0.35;
    if (usable >= minInner) {
      const r = wrap(m, text, usable);
      const b = { w: innerNow / m.fx, h: bubblePx(m, r.widest, r.lines).h };
      const shape = b.w / b.h / target;
      if (r.widest >= usable * 0.72 && shape > 0.62 && shape < 1.7) {
        return center(o, toPctW(b.w), toPctH(b.h));
      }
    }
  }

  let best: { w: number; h: number } | null = null;
  let bestScore = Infinity;
  const hi = Math.max(minInner, Math.min(full, maxInner));
  const steps = 36;
  for (let i = 0; i <= steps; i++) {
    const cand = minInner + ((hi - minInner) * i) / steps;
    const r = wrap(m, text, cand);
    const b = bubblePx(m, Math.max(r.widest, m.px * 2.6), r.lines);
    // Ragged, half-empty last lines read badly; nudge toward full lines.
    const s = score(b) + (r.widest < cand * 0.8 ? 0.05 : 0);
    if (s < bestScore - 1e-6) {
      best = b;
      bestScore = s;
    }
  }
  if (!best) return null;
  return center(o, toPctW(best.w), toPctH(best.h));
}

/**
 * Smallest box that still holds the words at this width — used while
 * dragging a resize handle so lettering can never be squeezed out.
 */
export function letterMinBox(o: Overlay, aspect: number): { minW: number; minH: number } | null {
  if (!usesMeasuredFit(o)) return null;
  const m = metrics(o, aspect);
  if (!m) return null;
  const text = o.text || " ";
  const word = longestWord(m, text);
  const minInner = slackW(m, Math.max(word, m.px));
  const minW = (minInner / m.fx / m.pageW) * 100;
  const innerW = Math.max((o.w / 100) * m.pageW * m.fx, minInner);
  const r = wrap(m, text, innerW / 1.04 - m.px * 0.35);
  const minH = (bubblePx(m, r.widest, r.lines).h / m.pageH) * 100;
  return { minW, minH };
}
