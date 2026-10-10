function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export type PageZoom = "fit" | number;

export const ZOOM_MIN = 25;
export const ZOOM_MAX = 400;

export const ZOOM_PRESETS: { id: PageZoom; label: string }[] = [
  { id: "fit", label: "Fit" },
  { id: 50, label: "50%" },
  { id: 75, label: "75%" },
  { id: 100, label: "100%" },
  { id: 125, label: "125%" },
  { id: 150, label: "150%" },
  { id: 200, label: "200%" },
  { id: 300, label: "300%" },
  { id: 400, label: "400%" },
];

const ZOOM_STEPS: PageZoom[] = ZOOM_PRESETS.map((p) => p.id);

export function zoomLabel(zoom: PageZoom) {
  if (zoom === "fit") return "Fit";
  return `${Math.round(zoom)}%`;
}

export function numericZoom(zoom: PageZoom, fitFallback = 100) {
  return zoom === "fit" ? fitFallback : zoom;
}

export function pageCssWidth(zoom: PageZoom) {
  if (zoom === "fit") return "100%";
  return `${Math.round(5.6 * zoom)}px`;
}

export function stepZoom(zoom: PageZoom, dir: 1 | -1): PageZoom {
  if (zoom === "fit") return dir > 0 ? 100 : "fit";
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < ZOOM_STEPS.length; i++) {
    const step = ZOOM_STEPS[i]!;
    if (step === "fit") continue;
    const dist = Math.abs(step - zoom);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  const next = ZOOM_STEPS[best + dir];
  if (next == null) return dir < 0 ? "fit" : ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  return next;
}

export function nudgeZoom(zoom: PageZoom, delta: number): number {
  const n = numericZoom(zoom);
  return clamp(Math.round((n + delta) / 5) * 5, ZOOM_MIN, ZOOM_MAX);
}

/** Scale the zoom by a factor, as a pinch does; "fit" scales from its real percentage. */
export function scaleZoom(zoom: PageZoom, factor: number, fitPercent = 100): number {
  const n = zoom === "fit" ? fitPercent : zoom;
  return clamp(n * factor, ZOOM_MIN, ZOOM_MAX);
}

/**
 * Where a pinch lets go: a preset (or Fit) within reach acts as a magnet, so
 * 100% and Fit are easy to land on; anywhere else keeps the exact size.
 */
export function settleZoom(zoom: PageZoom, fitPercent = 100): PageZoom {
  if (zoom === "fit") return zoom;
  if (Math.abs(fitPercent - zoom) <= 3) return "fit";
  for (const step of ZOOM_STEPS) {
    if (step !== "fit" && Math.abs(step - zoom) <= 3) return step;
  }
  return Math.round(zoom);
}
