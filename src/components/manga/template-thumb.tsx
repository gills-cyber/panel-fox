import { layoutTemplate, type GridSpec } from "@/lib/manga/templates";
import { cn } from "@/lib/utils";

export function TemplateThumb({
  spec,
  active,
  onClick,
}: {
  spec: GridSpec;
  active?: boolean;
  onClick: () => void;
}) {
  const panels = layoutTemplate(spec, 7, 3.2, false);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col gap-1.5 rounded-lg p-1.5 text-left transition-[background-color] duration-[var(--motion-quick)]",
        active ? "bg-ink/5" : "hover:bg-ink/5",
      )}
    >
      <div
        className={cn(
          "relative aspect-[210/297] w-full overflow-hidden rounded-sm bg-paper-white shadow-tool",
          active && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
        )}
      >
        {panels.map((p) => (
          <span
            key={p.id}
            className="absolute bg-[#2a2a2c]"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.w}%`,
              height: `${p.h}%`,
            }}
          />
        ))}
      </div>
      <span className="block">
        <span className="block text-xs font-medium text-ink">{spec.name}</span>
        <span className="block text-xs leading-snug text-muted">
          {spec.blurb}
        </span>
      </span>
    </button>
  );
}
