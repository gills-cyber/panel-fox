import { clamp } from "@/lib/utils";

/**
 * Geometry for zooming the page the way Preview does: during a pinch or a
 * zoom step the page is scaled on the GPU (a transform on its container),
 * then laid out once at the real size when the motion lands. Nothing here
 * touches React; the studio applies the transform and commits the zoom.
 */

export type ZoomAnchor = {
  /** The screen point to keep still. */
  cx: number;
  cy: number;
  /** Where that point sits on the page, as fractions of its box. */
  fx: number;
  fy: number;
};

export type Rect = { left: number; top: number; width: number; height: number };

export type Placement = {
  k: number;
  /** Transform for the container (origin 0 0) that puts the page at its final place. */
  dx: number;
  dy: number;
  /** Scroll offsets that reproduce that place once the real layout lands. */
  scrollLeft: number;
  scrollTop: number;
};

/** The layout (untransformed) rect of `el` in viewport space, relative to a scrolling stage. */
export function layoutRect(stage: HTMLElement, el: HTMLElement): Rect {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== stage) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  const r = stage.getBoundingClientRect();
  return {
    left: r.left + x - stage.scrollLeft,
    top: r.top + y - stage.scrollTop,
    width: el.offsetWidth,
    height: el.offsetHeight,
  };
}

/** The smallest rect holding all of `rects`. */
export function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** The anchor for a screen point over the sheets as the user currently sees them. */
export function anchorAt(seen: Rect, x: number, y: number): ZoomAnchor {
  return {
    cx: x,
    cy: y,
    fx: clamp((x - seen.left) / Math.max(1, seen.width), 0, 1),
    fy: clamp((y - seen.top) / Math.max(1, seen.height), 0, 1),
  };
}

/**
 * Where the sheets end up when scaled by `k`: centered while they fit the
 * stage, otherwise scrolled so the anchor stays under the fingers, within
 * what the stage can scroll to.
 */
export function placeZoom(
  stage: HTMLElement,
  subject: HTMLElement,
  sheets: Rect,
  k: number,
  anchor: ZoomAnchor,
): Placement {
  const cs = getComputedStyle(stage);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const padB = parseFloat(cs.paddingBottom) || 0;
  const r = stage.getBoundingClientRect();
  const innerW = stage.clientWidth - padL - padR;
  const innerH = stage.clientHeight - padT - padB;
  const contentLeft = r.left + padL;
  const contentTop = r.top + padT;
  const W = sheets.width * k;
  const H = sheets.height * k;
  let left: number;
  let top: number;
  let scrollLeft: number;
  let scrollTop: number;
  if (W <= innerW + 0.5) {
    scrollLeft = 0;
    left = contentLeft + (innerW - W) / 2;
  } else {
    scrollLeft = clamp(contentLeft - (anchor.cx - anchor.fx * W), 0, W - innerW);
    left = contentLeft - scrollLeft;
  }
  if (H <= innerH + 0.5) {
    scrollTop = 0;
    top = contentTop;
  } else {
    scrollTop = clamp(contentTop - (anchor.cy - anchor.fy * H), 0, H - innerH);
    top = contentTop - scrollTop;
  }
  const s = layoutRect(stage, subject);
  // A point p of the subject maps to s + d + (p - s) * k; solve for d at the sheets' corner.
  const dx = left - s.left - (sheets.left - s.left) * k;
  const dy = top - s.top - (sheets.top - s.top) * k;
  return { k, dx, dy, scrollLeft, scrollTop };
}

export function transformFor(p: Placement) {
  return `translate(${p.dx.toFixed(2)}px, ${p.dy.toFixed(2)}px) scale(${p.k.toFixed(4)})`;
}
