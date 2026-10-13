import { fileToPanelSrc } from "./image";
import { selectionIds, useStudio } from "./store";
import type { Overlay, PanelImage } from "./types";

let copied: PanelImage | null = null;

export function hasCopiedImage() {
  return copied != null;
}

async function srcToBlob(src: string): Promise<Blob> {
  const res = await fetch(src);
  return res.blob();
}

export async function copyPanelImage(panelId: string) {
  const panel = useStudio
    .getState()
    .currentPage()
    .panels.find((p) => p.id === panelId);
  if (!panel?.image) throw new Error("This panel has no image");
  copied = { ...panel.image };
  try {
    const blob = await srcToBlob(panel.image.src);
    const type = blob.type || "image/png";
    await navigator.clipboard.write([
      new ClipboardItem({ [type]: blob }),
    ]);
  } catch {
    /* in-app copy still works */
  }
}

export async function pastePanelImage(panelId: string) {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      const file = new File([blob], "paste.png", { type });
      const src = await fileToPanelSrc(file);
      useStudio.getState().setPanelImage(panelId, src);
      return;
    }
  } catch {
    /* fall through to in-app copy */
  }
  if (copied) {
    useStudio.getState().stampImage(panelId, copied);
    return;
  }
  throw new Error("Nothing to paste");
}

const OVERLAY_MIME_TAG = "koma/overlay";

/** Copy (or cut) a balloon in the app and mirror it to the system clipboard as JSON. */
const OVERLAY_ATTR = "data-koma-overlay";

function toBase64(text: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function fromBase64(b64: string) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Copy (or cut) a balloon, or every balloon of a multi-selection. The system
 * clipboard gets the words as plain text, so a later paste into a text field
 * inserts the words, and the balloons themselves ride along in an HTML
 * flavour that only this app reads.
 */
export function copyOverlayToClipboard(id?: string | null, cut = false) {
  const s = useStudio.getState();
  const ids = selectionIds(s);
  const group = ids.length > 1 && (id == null || ids.includes(id));
  let clips: Overlay[];
  if (group) {
    clips = cut ? s.cutOverlays(ids) : s.copyOverlays(ids);
  } else {
    const one = cut ? s.cutOverlay(id) : s.copyOverlay(id);
    clips = one ? [one] : [];
  }
  if (!clips.length) return null;
  const json = JSON.stringify({
    koma: OVERLAY_MIME_TAG,
    v: 2,
    overlay: clips[clips.length - 1],
    ...(clips.length > 1 ? { overlays: clips } : {}),
  });
  const text = clips
    .map((c) => (c.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  const html = `<span ${OVERLAY_ATTR}="${toBase64(json)}">${escapeHtml(text)}</span>`;
  try {
    const cb = navigator.clipboard;
    if (cb && typeof ClipboardItem !== "undefined" && cb.write) {
      void cb
        .write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ])
        .catch(() => cb.writeText(text).catch(() => {}));
    } else {
      void cb?.writeText(text).catch(() => {});
    }
  } catch {
    /* no clipboard access: the in-app copy still pastes */
  }
  return clips[clips.length - 1]!;
}

/** The balloons inside pasted content, when it is ours. */
export function parseOverlayClipboard(text: string, html = ""): Overlay[] | null {
  const carried = /data-koma-overlay="([A-Za-z0-9+/=]+)"/.exec(html);
  if (carried) {
    try {
      return parseOverlayJson(fromBase64(carried[1]!));
    } catch {
      return null;
    }
  }
  return parseOverlayJson(text);
}

function isOverlay(o: Partial<Overlay> | null | undefined): o is Overlay {
  return (
    !!o &&
    typeof o.kind === "string" &&
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.w === "number" &&
    typeof o.h === "number"
  );
}

function parseOverlayJson(text: string): Overlay[] | null {
  if (!text || text[0] !== "{" || !text.includes(OVERLAY_MIME_TAG)) return null;
  try {
    const data = JSON.parse(text) as {
      koma?: unknown;
      overlay?: Partial<Overlay>;
      overlays?: Partial<Overlay>[];
    };
    if (data.koma !== OVERLAY_MIME_TAG) return null;
    if (Array.isArray(data.overlays)) {
      const list = data.overlays.filter(isOverlay);
      if (list.length) return list;
    }
    return isOverlay(data.overlay) ? [data.overlay] : null;
  } catch {
    return null;
  }
}

let pasteFallback = 0;

/** ⌘V was pressed: if no paste event arrives shortly, paste the in-app balloon. */
export function schedulePasteFallback() {
  window.clearTimeout(pasteFallback);
  pasteFallback = window.setTimeout(() => {
    pasteFallback = 0;
    useStudio.getState().pasteOverlay();
  }, 120);
}

/** A paste event arrived, so it decides what to paste. */
export function cancelPasteFallback() {
  window.clearTimeout(pasteFallback);
  pasteFallback = 0;
}
