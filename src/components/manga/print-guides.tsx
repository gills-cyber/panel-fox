import type { CSSProperties } from "react";
import type { PaperSizeId } from "@/lib/manga/paper";

type Spec = { id: PaperSizeId; w: number; h: number };

/** Grid pitch in page units (mm on paper sizes, px on the webtoon canvas): 10, coarser when that would be a thicket. */
export function gridStep(spec: Spec): number {
  let step = 10;
  while (spec.w / step > 40) step *= 5;
  return step;
}

export function pageUnit(spec: Spec): string {
  return spec.id === "webtoon" ? "px" : "mm";
}

/**
 * Rules every `gridStep` units, a heavier one every fifth; a sheet-sized layer
 * over the panels and under the balloons (z 78, below the chain layer at 79
 * and the balloons at 80 and up) that takes no pointer events.
 */
export function PageGrid({ spec }: { spec: Spec }) {
  const step = gridStep(spec);
  const cx = (step / spec.w) * 100;
  const cy = (step / spec.h) * 100;
  return (
    <div
      className="koma-grid pointer-events-none absolute inset-0 z-[78]"
      data-koma="page-grid"
      data-step={step}
      aria-hidden
      style={{
        ["--grid-x" as string]: `${cx}%`,
        ["--grid-y" as string]: `${cy}%`,
        ["--grid-major-x" as string]: `${cx * 5}%`,
        ["--grid-major-y" as string]: `${cy * 5}%`,
      }}
    />
  );
}

const CORNERS = ["tl", "tr", "bl", "br"] as const;

/**
 * Printer's marks on the live page: the trim (page edge), the safe area the
 * layout keeps panels inside, the bleed export pads around the page, and crop
 * marks outside the corners. `margin` is the page-setup margin (percent of
 * each axis, as the layout uses it); `bleed` is a percent of the page width.
 */
export function PrintGuides({
  spec,
  margin,
  bleed,
}: {
  spec: Spec;
  margin: number;
  bleed: number;
}) {
  const bx = Math.max(0, bleed);
  const by = (bx * spec.w) / spec.h;
  // Crop marks start a hair outside the bleed and run a short way out.
  const gapX = bx + 1;
  const gapY = (gapX * spec.w) / spec.h;
  const lenX = 2.6;
  const lenY = (lenX * spec.w) / spec.h;
  const bleedUnits = (bx / 100) * spec.w;
  const unit = pageUnit(spec);
  const legend =
    bx > 0
      ? `Trim · Safe area · Bleed ${bleedUnits.toFixed(unit === "mm" ? 1 : 0)} ${unit}`
      : "Trim · Safe area";
  return (
    <div
      className="koma-guides pointer-events-none absolute inset-0 z-[116]"
      data-koma="print-guides"
      aria-hidden
    >
      {bx > 0 ? (
        <>
          <div className="koma-bleed-strip" style={{ left: `-${bx}%`, right: `-${bx}%`, top: `-${by}%`, height: `${by}%` }} />
          <div className="koma-bleed-strip" style={{ left: `-${bx}%`, right: `-${bx}%`, top: "100%", height: `${by}%` }} />
          <div className="koma-bleed-strip" style={{ left: `-${bx}%`, width: `${bx}%`, top: 0, bottom: 0 }} />
          <div className="koma-bleed-strip" style={{ left: "100%", width: `${bx}%`, top: 0, bottom: 0 }} />
          <div
            className="koma-guide koma-guide-bleed"
            data-koma="guide-bleed"
            style={{ left: `-${bx}%`, right: `-${bx}%`, top: `-${by}%`, bottom: `-${by}%` }}
          />
        </>
      ) : null}
      <div className="koma-guide koma-guide-trim" data-koma="guide-trim" />
      <div className="koma-guide koma-guide-safe" data-koma="guide-safe" style={{ inset: `${margin}%` }} />
      {CORNERS.map((c) => {
        const top = c[0] === "t";
        const left = c[1] === "l";
        const h: CSSProperties = {
          height: 1,
          width: `${lenX}%`,
          [left ? "right" : "left"]: `calc(100% + ${gapX}%)`,
          [top ? "top" : "bottom"]: -0.5,
        };
        const v: CSSProperties = {
          width: 1,
          height: `${lenY}%`,
          [top ? "bottom" : "top"]: `calc(100% + ${gapY}%)`,
          [left ? "left" : "right"]: -0.5,
        };
        return (
          <span key={c} data-koma={`crop-${c}`}>
            <span className="koma-crop" style={h} />
            <span className="koma-crop" style={v} />
          </span>
        );
      })}
      <span
        className="koma-guide-legend"
        data-koma="guide-legend"
        style={{ bottom: `calc(100% + ${by}% + 5px)` }}
      >
        {legend}
      </span>
    </div>
  );
}
