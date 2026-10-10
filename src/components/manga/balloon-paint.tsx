import type { Overlay } from "@/lib/manga/types";
import {
  BALLOON_FILLS,
  BALLOON_OUTLINES,
  balloonFillColor,
  balloonStrokeColor,
  isClearPaint,
} from "@/lib/manga/lettering";
import { useStudio } from "@/lib/manga/store";
import { cn } from "@/lib/utils";

function hexOrFallback(color: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function Swatches({
  value,
  colors,
  onChange,
  name,
}: {
  value: string;
  colors: readonly { id: string; label: string }[];
  onChange: (id: string) => void;
  name: string;
}) {
  const current = (value || "").toLowerCase();
  return (
    <div className="flex flex-wrap items-center gap-1" data-koma={name}>
      {colors.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-label={c.label}
          aria-pressed={current === c.id.toLowerCase()}
          title={c.label}
          onClick={() => onChange(c.id)}
          className={cn(
            "size-7 rounded-full shadow-tool",
            (c.id === "#ffffff" || isClearPaint(c.id)) && "ring-1 ring-ink/25",
            current === c.id.toLowerCase() &&
              "ring-2 ring-accent ring-offset-2 ring-offset-surface",
          )}
        >
          <span
            className="block size-full rounded-full"
            data-clear={isClearPaint(c.id) ? "true" : undefined}
            style={isClearPaint(c.id) ? undefined : { background: c.id }}
          />
        </button>
      ))}
      <label className="koma-well">
        <span className="sr-only">Custom {name}</span>
        <input
          type="color"
          value={hexOrFallback(value, "#ffffff")}
          aria-label={`Custom ${name}`}
          onChange={(e) => onChange(e.target.value)}
        />
        <span
          className="koma-well-dot"
          data-clear={isClearPaint(value) ? "true" : undefined}
          style={isClearPaint(value) ? undefined : { background: hexOrFallback(value, "#ffffff") }}
        />
      </label>
    </div>
  );
}

function Chip({
  label,
  value,
  fallback,
  name,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  name: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="koma-swatch-custom" title={label} data-koma={name}>
      <span className="sr-only">{label}</span>
      <input
        type="color"
        aria-label={label}
        value={hexOrFallback(value, fallback)}
        onChange={(e) => onChange(e.target.value)}
      />
      <span
        className="koma-swatch"
        data-clear={isClearPaint(value) ? "true" : undefined}
        style={isClearPaint(value) ? undefined : { background: hexOrFallback(value, fallback) }}
      />
    </label>
  );
}

export function BalloonPaintControls({
  overlay,
  compact = false,
}: {
  overlay: Overlay;
  compact?: boolean;
}) {
  const fill = balloonFillColor(overlay.fill);
  const stroke = balloonStrokeColor(overlay.stroke);
  function set(patch: Partial<Overlay>) {
    useStudio.getState().updateOverlay(overlay.id, patch);
  }
  if (compact) {
    return (
      <div className="koma-swatches" data-koma="balloon-paint">
        <Chip
          label="Fill color"
          name="balloon-fill"
          value={fill}
          fallback="#ffffff"
          onChange={(fill) => set({ fill })}
        />
        <Chip
          label="Outline color"
          name="balloon-outline"
          value={stroke}
          fallback="#161412"
          onChange={(stroke) => set({ stroke })}
        />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[11px] font-medium text-muted">Fill</p>
        <Swatches
          name="balloon-fill"
          value={fill}
          colors={BALLOON_FILLS}
          onChange={(fill) => set({ fill })}
        />
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-medium text-muted">Outline</p>
        <Swatches
          name="balloon-outline"
          value={stroke}
          colors={BALLOON_OUTLINES}
          onChange={(stroke) => set({ stroke })}
        />
      </div>
    </div>
  );
}
