import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** NSSegmentedControl: a knob slides under the chosen option. */
export function Segmented({
  options,
  value,
  onChange,
  className,
}: {
  options: { id: string; label: string; icon?: ReactNode }[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const n = options.length;
  const i = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div
      role="radiogroup"
      className={cn("relative flex rounded-[7px] bg-ink/5 p-0.5", className)}
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 rounded-[5px] bg-surface shadow-tool transition-[left] duration-[var(--motion-fast)] ease-[var(--ease-spring)] motion-reduce:transition-none"
        style={{
          width: `calc((100% - 4px) / ${n})`,
          left: `calc(2px + (100% - 4px) * ${i} / ${n})`,
        }}
      />
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={value === opt.id}
          aria-label={opt.icon ? opt.label : undefined}
          onClick={() => onChange(opt.id)}
          className={cn(
            "relative z-10 flex min-h-11 flex-1 items-center justify-center rounded-[5px] text-[12px] font-medium transition-colors duration-[var(--motion-quick)] md:h-7 md:min-h-7",
            value === opt.id ? "text-ink" : "text-muted hover:text-ink",
          )}
        >
          {opt.icon ?? opt.label}
        </button>
      ))}
    </div>
  );
}

/** NSSwitch: the Big Sur toggle. */
export function CheckRow({
  label,
  checked,
  onChange,
  koma,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  koma?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-3 text-[13px]",
        disabled && "opacity-40",
      )}
      data-koma={koma}
    >
      <span>{label}</span>
      <span
        className={cn(
          "relative h-5 w-8 shrink-0 rounded-full shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)] transition-colors duration-[var(--motion-quick)]",
          checked && !disabled ? "bg-accent" : "bg-ink/15",
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-[var(--motion-fast)] ease-[var(--ease-spring)] motion-reduce:transition-none",
            checked && "translate-x-3",
          )}
        />
      </span>
    </label>
  );
}
