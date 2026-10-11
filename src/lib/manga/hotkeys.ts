import { useStudio } from "./store";
import { insertTitle } from "./actions";
import { canRotate, wrapDeg, isDialogue, scaleOverlayBy } from "./lettering";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { requestOpenProjects, requestSave, requestSaveAs } from "./project";
import { copyOverlayToClipboard, schedulePasteFallback } from "./clipboard";
import { pageOverlays } from "./lettering";

export function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  // A pop-up button or an open list owns the keys it is given (typeahead,
  // arrows, Return), the way an NSPopUpButton does.
  if (el.closest('[role="combobox"],[role="listbox"],[role="option"]')) return true;
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
  const typing = isTypingTarget(e.target);
  // Windows reports AltGr as Ctrl+Alt: a glyph typed on a Polish, Czech or
  // US-International layout (AltGr+S is ś) must never read as a Ctrl chord.
  const altGr = !isAppleMod && e.ctrlKey && e.altKey && !e.metaKey;
  if (altGr && typing) return false;
  // With ⌥ held, macOS reports the dead-key glyph (⌥C is "ç"), so read the
  // physical key for letter and bracket chords.
  const key =
    e.altKey && !altGr && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key;
  const code = e.code;
  const mod = !altGr && modKey(e);
  const overlayId = studio.selectedOverlayId;

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
  if (mod && (key === "]" || code === "BracketRight")) {
    e.preventDefault();
    if (!overlayId) return true;
    if (e.altKey) studio.bringToFront(overlayId);
    else studio.bringForward(overlayId);
    return true;
  }
  if (mod && (key === "[" || code === "BracketLeft")) {
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
  // ⌘C / ⌘X carry the balloon; ⌘V arrives as a paste event (see the studio).
  if (mod && !e.altKey && !e.shiftKey && (key.toLowerCase() === "c" || key.toLowerCase() === "x")) {
    if (!overlayId) return false;
    e.preventDefault();
    copyOverlayToClipboard(overlayId, key.toLowerCase() === "x");
    return true;
  }
  if (mod && key.toLowerCase() === "l") {
    e.preventDefault();
    if (overlayId) studio.toggleOverlayLock(overlayId);
    else if (studio.selectedPanelId) studio.togglePanelLock(studio.selectedPanelId);
    return true;
  }
  if ((key === "h" || key === "H") && !mod) {
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

  // Tab walks the page's balloons in stacking order, like objects in Keynote:
  // from the page itself (not from the format bar's buttons, and not from a
  // fresh document, where Tab belongs to the toolbar), and it lets go at the
  // last balloon so the keyboard can leave the page.
  if (key === "Tab" && !mod && !e.altKey) {
    const focus = document.activeElement;
    const onStage =
      focus instanceof HTMLElement &&
      focus !== document.body &&
      Boolean(focus.closest("[data-koma='page-stage']")) &&
      !focus.closest("[data-koma='letter-bar'],[data-koma-popover],[data-koma-menu],[role='toolbar']");
    const fromBody = (!focus || focus === document.body) && Boolean(overlayId);
    if (!onStage && !fromBody) return false;
    const list = pageOverlays(studio.currentPage()).filter((o) => !o.hidden);
    if (!list.length) return false;
    const i = list.findIndex((o) => o.id === overlayId);
    const dir = e.shiftKey ? -1 : 1;
    const j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
    if (j < 0 || j >= list.length) return false;
    e.preventDefault();
    studio.selectPanel(null);
    studio.selectOverlay(list[j]!.id);
    return true;
  }
  // Page keys walk the document.
  if (!mod && (key === "PageDown" || key === "PageUp" || key === "Home" || key === "End")) {
    const pages = studio.pages;
    const i = pages.findIndex((p) => p.id === studio.currentPageId);
    const to =
      key === "Home" ? 0 : key === "End" ? pages.length - 1 : key === "PageDown" ? i + 1 : i - 1;
    const target = pages[Math.max(0, Math.min(pages.length - 1, to))];
    if (!target) return false;
    e.preventDefault();
    if (target.id !== studio.currentPageId) studio.setCurrentPage(target.id);
    return true;
  }

  // ⌘V: the paste event carries the balloon; when no paste event follows
  // (no clipboard access, or nothing editable has focus) the in-app copy pastes.
  if (mod && !e.altKey && !e.shiftKey && key.toLowerCase() === "v") {
    if (!studio.overlayClipboard) return false;
    schedulePasteFallback();
    return true;
  }
  if ((key === "v" || key === "V") && !mod) {
    e.preventDefault();
    studio.selectOverlay(null);
    studio.selectPanel(null);
    studio.setImageTool("frame");
    return true;
  }
  if ((key === "t" || key === "T") && !mod) {
    e.preventDefault();
    if (e.shiftKey) insertTitle();
    else studio.addOverlay("speech");
    return true;
  }
  if ((key === "p" || key === "P") && !mod) {
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
