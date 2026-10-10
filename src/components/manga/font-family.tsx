import { useEffect, useRef, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  FONT_GROUPS,
  LETTER_FONTS,
  defaultFontId,
  letterFont,
} from "@/lib/manga/fonts";

export function FontFamilyControl({
  value,
  kind,
  onChange,
  compact = false,
}: {
  value?: string | null;
  kind?: string;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  const current = letterFont(value || defaultFontId(kind));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: PointerEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (compact) {
    return (
      <div ref={rootRef} className="relative">
        <button
          type="button"
          data-koma="font-family"
          aria-label="Font"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="min-w-[5.5rem] px-2 text-left"
          style={{ fontFamily: current.css }}
        >
          {current.label}
        </button>
        {open ? (
          <div className="absolute left-0 top-[calc(100%+6px)] z-[80] max-h-72 w-48 overflow-auto rounded-lg bg-surface p-1 shadow-float">
            {LETTER_FONTS.map((font) => (
              <button
                key={font.id}
                type="button"
                data-active={font.id === current.id ? "true" : undefined}
                className="flex h-8 w-full items-center rounded-md px-2 text-left text-[13px]"
                style={{ fontFamily: font.css }}
                onClick={() => {
                  onChange(font.id);
                  setOpen(false);
                }}
              >
                {font.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // The inspector's Font row is an NSPopUpButton: the current family in its
  // own face, a grouped menu with every family set in itself and a ✓ on the
  // current one.
  return (
    <Select.Root value={current.id} onValueChange={onChange}>
      <Select.Trigger
        data-koma="font-family"
        aria-label="Font"
        className="koma-field relative flex w-full items-center justify-between pr-8 text-left outline-none"
        style={{ fontFamily: current.css }}
      >
        <span className="truncate">
          <Select.Value />
        </span>
        <span aria-hidden className="koma-popup-badge">
          <ChevronsUpDown className="size-3" strokeWidth={2.5} />
        </span>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          onPointerDown={(e) => e.stopPropagation()}
          className="koma-fade-in z-[125] max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[10px] bg-surface/95 p-1 shadow-float backdrop-blur-2xl"
        >
          <Select.Viewport>
            {FONT_GROUPS.map((group) => (
              <Select.Group key={group.id}>
                <Select.Label className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-muted">
                  {group.label}
                </Select.Label>
                {LETTER_FONTS.filter((f) => f.group === group.id).map((font) => (
                  <Select.Item
                    key={font.id}
                    value={font.id}
                    className="relative flex h-7 cursor-default select-none items-center rounded-[5px] pl-6 pr-2 text-[13px] text-ink outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-fg"
                    style={{ fontFamily: font.css }}
                  >
                    <Select.ItemIndicator className="absolute left-1.5">
                      <Check className="size-3.5" strokeWidth={2.5} />
                    </Select.ItemIndicator>
                    <Select.ItemText>{font.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Group>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
