import { useStudio } from "@/lib/manga/store";
import {
  BALLOON_STYLES,
  balloonStyleOf,
  burstPath,
  balloonEllipse,
  type SnapGuide,
} from "@/lib/manga/balloons";
import { THOUGHT_CLOUD } from "@/lib/manga/lettering";
import { inkBody, inkSeed } from "@/lib/manga/ink";
import type { BalloonStyle, Overlay } from "@/lib/manga/types";
import { cn } from "@/lib/utils";

function ThumbShape({ id }: { id: BalloonStyle }) {
  const e = balloonEllipse(id);
  const handInk = useStudio((s) => s.handInk);
  const fill = "var(--color-paper)";
  const stroke = "currentColor";
  if (handInk) {
    // Same generator as the page, with a heavier nib so the line survives at 28px.
    const shape = inkBody(id, inkSeed(`thumb-${id}`), { boxW: 100, boxH: 100 }, 1, 1.9);
    return (
      <svg viewBox="0 0 100 100" className="size-full overflow-visible" aria-hidden>
        <path d={shape.paper} fill={fill} stroke="none" />
        {shape.ink ? <path d={shape.ink} fill={stroke} stroke="none" /> : null}
        {shape.line ? (
          <path
            d={shape.line.d}
            fill="none"
            stroke={stroke}
            strokeWidth={shape.line.width}
            strokeDasharray={shape.line.dash}
            strokeLinecap="round"
          />
        ) : null}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
      {id === "cloud" ? (
        <path
          d={THOUGHT_CLOUD}
          fill={fill}
          stroke={stroke}
          strokeWidth="5"
          strokeLinejoin="round"
        />
      ) : id === "burst" || id === "spike" ? (
        <path
          d={burstPath(id === "spike" ? 22 : 16, id === "spike" ? 0.22 : 0.16)}
          fill={fill}
          stroke={stroke}
          strokeWidth="5"
          strokeLinejoin="round"
        />
      ) : id === "rect" || id === "box" ? (
        <rect
          x={e.cx - e.rx}
          y={e.cy - e.ry}
          width={e.rx * 2}
          height={e.ry * 2}
          rx={id === "box" ? 8 : 14}
          fill={fill}
          stroke={stroke}
          strokeWidth="5"
        />
      ) : (
        <g fill={fill} stroke={stroke} strokeWidth="5">
          <ellipse
            cx={e.cx}
            cy={e.cy}
            rx={e.rx}
            ry={e.ry}
            strokeDasharray={id === "whisper" ? "8 6" : undefined}
          />
          {id === "radio" ? (
            <ellipse
              cx={e.cx}
              cy={e.cy}
              rx={e.rx * 0.78}
              ry={e.ry * 0.74}
              fill="none"
            />
          ) : null}
        </g>
      )}
    </svg>
  );
}

export function BalloonStylePicker({
  overlay,
  compact = false,
  onSelect,
}: {
  overlay: Overlay;
  compact?: boolean;
  onSelect?: () => void;
}) {
  const current = balloonStyleOf(overlay);
  return (
    <div
      className={cn("koma-style-grid", compact && "is-compact")}
      data-koma="balloon-style-grid"
      role="listbox"
      aria-label="Balloon shape"
    >
      {BALLOON_STYLES.map((style) => (
        <button
          key={style.id}
          type="button"
          role="option"
          aria-label={style.label}
          aria-selected={current === style.id}
          title={style.blurb}
          data-koma={`balloon-style-${style.id}`}
          data-active={current === style.id ? "true" : undefined}
          className={cn(
            "koma-style-thumb",
            current === style.id && "is-active",
          )}
          onClick={() => {
            useStudio.getState().updateOverlay(overlay.id, {
              balloonStyle: style.id,
            });
            onSelect?.();
          }}
        >
          <ThumbShape id={style.id} />
          {compact ? null : <span>{style.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function SnapGuides({ guides }: { guides: SnapGuide[] }) {
  if (!guides.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[140]" data-koma="snap-guides">
      {guides.map((g) => (
        <span
          key={g.id}
          data-koma="snap-guide"
          className={cn("koma-snap-guide", g.axis === "x" ? "is-x" : "is-y")}
          style={g.axis === "x" ? { left: `${g.at}%` } : { top: `${g.at}%` }}
        />
      ))}
    </div>
  );
}
