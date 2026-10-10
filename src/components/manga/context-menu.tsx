import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cn, prefersReducedMotion } from "@/lib/utils";
import { Floating } from "@/components/manga/floating";

export type ContextItem = {
  label?: string;
  /** A hairline between groups. */
  separator?: true;
  /** Shortcut hint, right-aligned like an NSMenu key column. */
  keys?: string;
  disabled?: boolean;
  danger?: boolean;
  mark?: string;
  keepOpen?: boolean;
  onClick?: () => void;
};

const ITEM_H = 28;
const ITEM_H_TOUCH = 44;
const SEP_H = 9;

export function ContextMenu({
  x,
  y,
  items,
  extra,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextItem[];
  extra?: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  // Refs keep the window listeners registered once: re-registering them during
  // a keydown (Escape also clears the selection, which re-renders the owner)
  // would drop the event on the floor.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closingRef = useRef(false);
  const closeTimer = useRef(0);
  const touch =
    typeof window !== "undefined" && window.matchMedia
      ? !window.matchMedia("(min-width: 768px)").matches
      : false;
  const height = items.reduce(
    (h, it) => h + (it.separator ? SEP_H : touch ? ITEM_H_TOUCH : ITEM_H),
    (extra ? 88 : 0) + 12,
  );
  const left = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : x) - 220);
  const top = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : y) - height);

  /**
   * Fade out, then tell the owner to unmount. The timer is deliberately not
   * cleared on unmount so the owner's close still lands if the menu is
   * remounted mid-way.
   */
  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }
    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), 150);
  }

  useEffect(() => {
    if (!extra) ref.current?.focus({ preventScroll: true });
  }, [extra]);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (e.button === 2) return;
      const t = e.target;
      if (t instanceof Element && t.closest("[data-koma-menu]")) return;
      close();
    }
    function onContext(e: Event) {
      e.preventDefault();
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest("[data-koma='page-rail'],[data-koma='page-rail-mobile']")
      ) {
        return;
      }
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function choose(item: ContextItem, el: HTMLElement) {
    if (item.disabled || closingRef.current) return;
    if (item.keepOpen) {
      item.onClick?.();
      return;
    }
    const delay = prefersReducedMotion() ? 0 : 140;
    el.setAttribute("data-flash", "");
    window.setTimeout(() => {
      item.onClick?.();
      close();
    }, delay);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[role=menuitem]:not(:disabled)")];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => buttons[(n + buttons.length) % buttons.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
        go(i + 1);
        break;
      case "ArrowUp":
        go(i < 0 ? buttons.length - 1 : i - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(buttons.length - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  return (
    <Floating
      ref={ref}
      at={{ x: left, y: top }}
      offset={0}
      role="menu"
      tabIndex={-1}
      data-koma-menu=""
      data-state={closing ? "closing" : "open"}
      className="min-w-[13.5rem] rounded-[12px] bg-surface/92 p-1 shadow-float outline-none backdrop-blur-2xl"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} role="separator" className="mx-2 my-1 h-px bg-line" />
        ) : (
          <button
            key={item.mark ?? item.label ?? i}
            type="button"
            role="menuitem"
            data-koma={item.mark}
            disabled={item.disabled}
            onPointerDown={(e) => e.currentTarget.focus()}
            onClick={(e) => choose(item, e.currentTarget)}
            className={cn(
              "koma-menu-item flex min-h-11 w-full items-center justify-between gap-6 rounded-[5px] px-2.5 text-left text-[15px] text-ink outline-none md:min-h-7 md:text-[13px]",
              item.disabled
                ? "opacity-40"
                : "hover:bg-accent hover:text-accent-fg focus-visible:bg-accent focus-visible:text-accent-fg",
            )}
          >
            <span>{item.label}</span>
            {item.keys ? (
              <span className="koma-keys text-[13px] tabular-nums opacity-55">{item.keys}</span>
            ) : null}
          </button>
        ),
      )}
      {extra}
    </Floating>
  );
}
