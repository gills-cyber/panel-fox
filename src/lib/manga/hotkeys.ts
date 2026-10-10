import { useStudio } from "./store";
import { insertTitle } from "./actions";
import { canRotate, wrapDeg, isDialogue, scaleOverlayBy } from "./lettering";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { requestOpenProjects, requestSave, requestSaveAs } from "./project";

export function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (el.getAttribute("type") || "text").toLowerCase();
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(type);
}

export function isApplePlatform() {
  if (typeof navigator === "undefined") return false;
  const plat = navigator.platform || "";
  const ua = navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(`${plat} ${ua}`);
}

export function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
}

/** Resolved after mount so the server and the first client render agree. */
export function useApplePlatform() {
  const [apple, setApple] = useState(false);
  useEffect(() => {
    setApple(isApplePlatform());
  }, []);
  return apple;
}

/** Module-load snapshot — display glyphs should use `useApplePlatform` to avoid SSR mismatch. */
export const isAppleMod = isApplePlatform();
export const modSymbol = isAppleMod ? "⌘" : "Ctrl";
export const altSymbol = isAppleMod ? "⌥" : "Alt";
export const shiftSymbol = "⇧";

/**
 * A shortcut label in the platform's order: macOS writes ⌃⌥⇧⌘ before the key
 * (⇧⌘S), other platforms spell the modifiers out (Ctrl+Shift+S).
 */
export function combo(
  key: string,
  m: { ctrl?: boolean; alt?: boolean; shift?: boolean; cmd?: boolean } = {},
  apple = isAppleMod,
) {
  if (apple) {
    return `${m.ctrl ? "⌃" : ""}${m.alt ? "⌥" : ""}${m.shift ? "⇧" : ""}${m.cmd ? "⌘" : ""}${key}`;
  }
  return [(m.ctrl || m.cmd) && "Ctrl", m.alt && "Alt", m.shift && "Shift", key]
    .filter(Boolean)
    .join("+");
}

/** Ctrl (Windows) and ⌘ (macOS / iPhone) both count as the modifier. */
export function modKey(e: KeyboardEvent | ReactKeyboardEvent) {
  return e.metaKey || e.ctrlKey;
}

export function handleStudioHotkey(e: KeyboardEvent) {
  if (e.isComposing) return false;
  if (typeof document !== "undefined" && document.querySelector("[data-koma-dialog]")) {
    return false;
  }

  const studio = useStudio.getState();
  const key = e.key;
  const mod = modKey(e);
  const overlayId = studio.selectedOverlayId;
  const typing = isTypingTarget(e.target);

  if (mod && key.toLowerCase() === "d") {
    e.preventDefault();
    if (e.shiftKey) studio.duplicatePage();
    else studio.duplicateOverlay();
    return true;
  }
  if (mod && key.toLowerCase() === "s") {
    e.preventDefault();
    if (e.shiftKey) requestSaveAs(true);
    else requestSave();
    return true;
  }
  if (mod && key.toLowerCase() === "o") {
    e.preventDefault();
    requestOpenProjects();
    return true;
  }
  if (mod && (key === "]" || key === "BracketRight")) {
    e.preventDefault();
    if (!overlayId) return true;
    if (e.altKey) studio.bringToFront(overlayId);
    else studio.bringForward(overlayId);
    return true;
  }
  if (mod && (key === "[" || key === "BracketLeft")) {
    e.preventDefault();
    if (!overlayId) return true;
    if (e.altKey) studio.sendToBack(overlayId);
    else studio.sendBackward(overlayId);
    return true;
  }

  // Ctrl (Windows) and ⌘ (macOS / iPad) both toggle lettering.
  if (mod && key.toLowerCase() === "b") {
    if (!overlayId) return false;
    e.preventDefault();
    const o = studio.currentPage().overlays.find((x) => x.id === overlayId);
    if (o) studio.updateOverlay(overlayId, { bold: !o.bold });
    return true;
  }
  if (mod && key.toLowerCase() === "i") {
    if (!overlayId) return false;
    e.preventDefault();
    const o = studio.currentPage().overlays.find((x) => x.id === overlayId);
    if (o) studio.updateOverlay(overlayId, { italic: !o.italic });
    return true;
  }

  if ((key === "r" || key === "R") && !typing && !mod) {
    e.preventDefault();
    studio.setReadMode(!studio.readMode);
    return true;
  }

  if (key === "Escape") {
    if (typing && e.target instanceof HTMLElement) e.target.blur();
    studio.selectPanel(null);
    studio.selectOverlay(null);
    studio.setPendingSrc(null);
    studio.setPendingBackground(null);
    studio.setPlacing(false);
    if (studio.readMode) studio.setReadMode(false);
    e.preventDefault();
    return true;
  }

  if (key === "Delete" || key === "Backspace") {
    if (studio.readMode) return false;
    if (typing) {
      const field = e.target;
      if (
        overlayId &&
        field instanceof HTMLTextAreaElement &&
        field.value === "" &&
        (field.selectionStart ?? 0) === 0
      ) {
        e.preventDefault();
        studio.removeOverlay(overlayId);
        return true;
      }
      return false;
    }
    if (overlayId || studio.selectedPanelId) {
      e.preventDefault();
      studio.deleteSelection();
      return true;
    }
    return false;
  }

  if (typing) return false;
  if (studio.readMode) return false;

  if (mod && key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) studio.redo();
    else studio.undo();
    return true;
  }
  if (mod && key.toLowerCase() === "y") {
    e.preventDefault();
    studio.redo();
    return true;
  }
  if (mod && key.toLowerCase() === "c" && e.altKey) {
    e.preventDefault();
    studio.copyOverlayStyle();
    return true;
  }
  if (mod && key.toLowerCase() === "v" && e.altKey) {
    e.preventDefault();
    studio.pasteOverlayStyle();
    return true;
  }
  if (mod && key.toLowerCase() === "l") {
    e.preventDefault();
    if (overlayId) studio.toggleOverlayLock(overlayId);
    else if (studio.selectedPanelId) studio.togglePanelLock(studio.selectedPanelId);
    return true;
  }
  if (key === "h" || key === "H") {
    e.preventDefault();
    if (overlayId) studio.toggleOverlayHidden(overlayId);
    return true;
  }

  if ((key === "f" || key === "F") && !mod) {
    if (!overlayId) return false;
    e.preventDefault();
    studio.flipOverlayTail(overlayId, e.shiftKey ? "y" : "x");
    return true;
  }

  if (overlayId && (key === "-" || key === "_" || key === "=" || key === "+")) {
    const o = studio.currentPage().overlays.find((x) => x.id === overlayId);
    if (
      o &&
      (o.kind === "sticker" || o.kind === "tone" || isDialogue(o.kind))
    ) {
      e.preventDefault();
      studio.updateOverlay(
        overlayId,
        scaleOverlayBy(o, key === "=" || key === "+" ? 1.4 : 0.7),
      );
      return true;
    }
  }

  if (key === "v" || key === "V") {
    e.preventDefault();
    studio.selectOverlay(null);
    studio.selectPanel(null);
    studio.setImageTool("frame");
    return true;
  }
  if (key === "t" || key === "T") {
    e.preventDefault();
    if (e.shiftKey) insertTitle();
    else studio.addOverlay("speech");
    return true;
  }
  if (key === "p" || key === "P") {
    e.preventDefault();
    studio.setPlacing(true);
    return true;
  }
  if ((key === "[" || key === "]") && !mod) {
    const step = e.shiftKey ? 1 : 15;
    const delta = key === "]" ? step : -step;
    if (overlayId) {
      const o = studio.currentPage().overlays.find((x) => x.id === overlayId);
      if (o && canRotate(o.kind)) {
        e.preventDefault();
        studio.updateOverlay(overlayId, {
          rotate: wrapDeg((o.rotate ?? 0) + delta),
        });
        return true;
      }
    }
    const pid = studio.selectedPanelId;
    if (pid) {
      const p = studio.currentPage().panels.find((x) => x.id === pid);
      if (p) {
        e.preventDefault();
        studio.setPanelRotate(pid, wrapDeg((p.rotate ?? 0) + delta));
        return true;
      }
    }
  }
  if (
    overlayId &&
    (key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "ArrowUp" ||
      key === "ArrowDown")
  ) {
    e.preventDefault();
    const step = e.shiftKey ? 2 : 0.5;
    const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
    const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
    studio.nudgeOverlay(overlayId, dx, dy);
    return true;
  }
  return false;
}
