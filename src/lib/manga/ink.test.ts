import { test } from "node:test";
import assert from "node:assert/strict";
import { inkBody, inkPuff, inkSeed, inkTail } from "./ink.ts";
import { balloonEllipse, balloonTextFrame } from "./balloons.ts";
import type { BalloonStyle } from "./types.ts";

const STYLES: BalloonStyle[] = [
  "oval",
  "round",
  "soft",
  "rect",
  "burst",
  "spike",
  "cloud",
  "whisper",
  "radio",
  "box",
];
const BOXES = [
  { boxW: 75, boxH: 300 },
  { boxW: 150, boxH: 300 },
  { boxW: 300, boxH: 300 },
  { boxW: 600, boxH: 300 },
  { boxW: 1200, boxH: 300 },
];
const SEEDS = Array.from({ length: 40 }, (_, i) => inkSeed(`balloon-${i}`));

/** Every coordinate pair in a path string, control points included. */
function points(d: string): { x: number; y: number }[] {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i]!, y: nums[i + 1]! });
  return out;
}

/** How far outside the base ellipse a point sits (1 = on the ellipse). */
function radial(style: BalloonStyle, p: { x: number; y: number }) {
  const e = balloonEllipse(style);
  const nx = (p.x - e.cx) / e.rx;
  const ny = (p.y - e.cy) / e.ry;
  return style === "rect" || style === "box"
    ? Math.max(Math.abs(nx), Math.abs(ny))
    : Math.hypot(nx, ny);
}

/**
 * The paper edge must stay at least this far out, per style. The ink ribbon
 * only grows outward, so the edge is the wobbled base outline itself (ovals
 * ±2.2%, cloud dips 6%, burst/spike valleys at 1 − jag).
 */
const FLOOR: Record<BalloonStyle, number> = {
  oval: 0.97,
  round: 0.97,
  soft: 0.97,
  radio: 0.97,
  whisper: 0.98,
  cloud: 0.93,
  burst: 0.83,
  spike: 0.77,
  // Rounded corners pull the max-norm radial in (10- and 5-unit radii).
  rect: 0.9,
  box: 0.94,
};

/** Where the clean (geometric) stroke's inner edge sat: 2.8 units centred on the outline. */
function cleanInnerEdge(style: BalloonStyle) {
  const e = balloonEllipse(style);
  const jag = style === "spike" ? 0.22 : style === "burst" ? 0.16 : 0;
  return 1 - jag - 1.4 / Math.min(e.rx, e.ry);
}

/** The text frame rectangle in balloon units for a kind. */
function frameRect(style: BalloonStyle, kind: "speech" | "narration") {
  const f = balloonTextFrame(style, kind);
  return { l: f.padLeft, r: 100 - f.padRight, t: f.padTop, b: 100 - f.padBottom };
}

test("the paper edge never reaches the text frame", () => {
  for (const style of STYLES) {
    const clean = cleanInnerEdge(style);
    for (const box of BOXES) {
      for (const seed of SEEDS) {
        const shape = inkBody(style, seed, box);
        const edge = shape.paper || shape.line?.d || "";
        assert.ok(edge.length > 20, `${style} has a paper edge`);
        let min = Infinity;
        for (const p of points(edge)) min = Math.min(min, radial(style, p));
        assert.ok(
          min >= FLOOR[style],
          `${style} seed ${seed} box ${box.boxW}x${box.boxH}: edge dips to ${min.toFixed(3)} < ${FLOOR[style]}`,
        );
        // Never closer to the text than the clean geometry was (whisper's line
        // straddles the outline, so allow its half width; the rectangles are
        // covered by the caption test below).
        const slack = style === "whisper" ? 0.02 : 0;
        // The clean cloud is a bezier with its own dips, not the ellipse.
        if (style === "rect" || style === "box" || style === "cloud") continue;
        assert.ok(
          min + slack >= clean - 0.005,
          `${style} seed ${seed}: ink edge ${min.toFixed(3)} is inside the clean stroke edge ${clean.toFixed(3)}`,
        );
      }
    }
  }
});

test("captions keep their whole text frame on paper", () => {
  const frame = frameRect("box", "narration");
  for (const box of BOXES) {
    for (const seed of SEEDS) {
      const shape = inkBody("box", seed, box);
      for (const p of points(shape.paper)) {
        const inside = p.x > frame.l + 0.5 && p.x < frame.r - 0.5 && p.y > frame.t + 0.5 && p.y < frame.b - 0.5;
        assert.ok(!inside, `box seed ${seed}: paper edge ${p.x},${p.y} enters the caption frame`);
      }
    }
  }
  // Box-tail dialogue keeps the clean rectangle's flanks clear of its frame.
  const dlg = frameRect("rect", "speech");
  const e = balloonEllipse("rect");
  for (const seed of SEEDS) {
    for (const p of points(inkBody("rect", seed, BOXES[2]!).paper)) {
      const onFlank = Math.abs(p.y - e.cy) < e.ry - 10;
      assert.ok(!(onFlank && p.x > dlg.l + 0.5 && p.x < dlg.r - 0.5), `rect seed ${seed}: flank enters the frame`);
    }
  }
});

test("ink is outside paper and both are deterministic", () => {
  for (const style of STYLES) {
    for (const box of BOXES) {
      const a = inkBody(style, SEEDS[3]!, box);
      const b = inkBody(style, SEEDS[3]!, box);
      assert.deepEqual(a, b, `${style} is stable for one seed`);
      const c = inkBody(style, SEEDS[4]!, box);
      assert.notEqual(a.paper, c.paper, `${style} differs between seeds`);
      if (a.ink) {
        // The ink ring's outer loop sits outside the paper edge everywhere.
        const paperMax = Math.max(...points(a.paper).map((p) => radial(style, p)));
        const inkMax = Math.max(...points(a.ink).map((p) => radial(style, p)));
        assert.ok(inkMax >= paperMax, `${style} ink reaches past the paper edge`);
      }
    }
  }
});

test("hand-drawn amount 0 is the clean shape", () => {
  for (const style of ["oval", "round", "soft", "radio"] as BalloonStyle[]) {
    const clean = inkBody(style, SEEDS[0]!, BOXES[2]!, 0);
    const radii = points(clean.paper).map((p) => radial(style, p));
    const spread = Math.max(...radii) - Math.min(...radii);
    assert.ok(spread < 0.12, `${style} without wobble is a smooth ring (spread ${spread.toFixed(3)})`);
  }
});

test("tails and puffs are deterministic and non-empty", () => {
  const g = { tipX: 40, tipY: 128, leftX: 38, leftY: 80, rightX: 60, rightY: 80 };
  const t1 = inkTail(g, SEEDS[1]!, BOXES[2]!);
  const t2 = inkTail(g, SEEDS[1]!, BOXES[2]!);
  assert.deepEqual(t1, t2);
  assert.ok(t1.paper.length > 10 && t1.ink.length > 10);
  const p1 = inkPuff({ cx: 30, cy: 110, rx: 5, ry: 4 }, SEEDS[2]!, BOXES[2]!);
  const p2 = inkPuff({ cx: 30, cy: 110, rx: 5, ry: 4 }, SEEDS[2]!, BOXES[2]!);
  assert.deepEqual(p1, p2);
  assert.ok(p1.paper.length > 10 && p1.ink.length > 10);
});

test("seeds come from ids and are stable", () => {
  assert.equal(inkSeed("ov-1"), inkSeed("ov-1"));
  assert.notEqual(inkSeed("ov-1"), inkSeed("ov-2"));
  assert.equal(typeof inkSeed(undefined), "number");
});
