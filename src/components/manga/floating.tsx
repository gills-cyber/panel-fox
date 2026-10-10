import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type Props = HTMLAttributes<HTMLDivElement> & {
  /** The control the panel hangs from; the panel follows it on resize. */
  anchor?: HTMLElement | null;
  /** A point instead of an anchor, for context menus. */
  at?: { x: number; y: number } | null;
  /** Horizontal placement against the anchor's edges. */
  align?: "start" | "center" | "end";
  /** Gap below the anchor. */
  offset?: number;
  /** NSPopover: an arrow points at the anchor and the panel grows from it. */
  arrow?: boolean;
  children: ReactNode;
};

/**
 * A panel in its own layer, like an NSMenu or NSPopover window: it is never
 * clipped by the toolbar, and its glass blurs the page, not the toolbar's
 * already-blurred backdrop. Positioned before first paint, kept inside the
 * viewport, flipped above the anchor when there is no room below.
 */
export const Floating = forwardRef<HTMLDivElement, Props>(function Floating(
  { anchor, at, align = "start", offset = 4, arrow, className, style, children, ...rest },
  ref,
) {
  const inner = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLDivElement);
  const [pos, setPos] = useState({ left: 0, top: 0, arrowX: 0, below: true, avail: 0 });
  const atX = at?.x ?? null;
  const atY = at?.y ?? null;

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || (!anchor && atX == null)) return;
    const place = () => {
      const pad = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const a =
        anchor?.getBoundingClientRect() ??
        new DOMRect(atX ?? 0, atY ?? 0, 0, 0);
      let left =
        align === "center"
          ? a.left + a.width / 2 - w / 2
          : align === "end"
            ? a.right - w
            : a.left;
      left = Math.max(pad, Math.min(vw - pad - w, left));
      let top = a.bottom + offset;
      let below = true;
      const availBelow = vh - pad - top;
      const availAbove = a.top - offset - pad;
      let avail = availBelow;
      if (h > availBelow && availAbove > availBelow) {
        below = false;
        top = Math.max(pad, a.top - offset - h);
        avail = availAbove;
      }
      if (below && h <= availBelow) top = Math.min(vh - pad - h, top);
      const arrowX = Math.max(18, Math.min(w - 18, a.left + a.width / 2 - left));
      setPos({
        left: Math.round(left),
        top: Math.round(top),
        arrowX: Math.round(arrowX),
        below,
        avail: Math.max(120, Math.round(avail)),
      });
    };
    place();
    window.addEventListener("resize", place);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", place);
      ro?.disconnect();
    };
  }, [anchor, atX, atY, align, offset]);

  if (typeof document === "undefined") return null;
  const origin = arrow
    ? `${pos.arrowX}px ${pos.below ? "top" : "bottom"}`
    : `${align === "end" ? "right" : align === "center" ? "center" : "left"} ${pos.below ? "top" : "bottom"}`;
  return createPortal(
    <div
      ref={inner}
      {...rest}
      data-koma-floating=""
      data-arrow={arrow ? (pos.below ? "top" : "bottom") : undefined}
      className={cn("fixed z-[120]", className)}
      style={{
        ...style,
        left: pos.left,
        top: pos.top,
        ["--arrow-x" as string]: `${pos.arrowX}px`,
        ["--koma-avail" as string]: `${pos.avail}px`,
        ["--koma-origin" as string]: origin,
      }}
    >
      {children}
    </div>,
    document.body,
  );
});
