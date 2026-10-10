import { fileToPanelSrc } from "./image";
import { useStudio } from "./store";
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
export function copyOverlayToClipboard(id?: string | null, cut = false) {
  const s = useStudio.getState();
  const clip = cut ? s.cutOverlay(id) : s.copyOverlay(id);
  if (!clip) return null;
  const text = JSON.stringify({ koma: OVERLAY_MIME_TAG, v: 1, overlay: clip });
  try {
    void navigator.clipboard?.writeText(text).catch(() => {});
  } catch {
    /* no clipboard access: the in-app copy still pastes */
  }
  return clip;
}

/** The balloon inside pasted text, when the text is one of ours. */
export function parseOverlayClipboard(text: string): Overlay | null {
  if (!text || text[0] !== "{" || !text.includes(OVERLAY_MIME_TAG)) return null;
  try {
    const data = JSON.parse(text) as { koma?: unknown; overlay?: Partial<Overlay> };
    const o = data.overlay;
    if (
      data.koma !== OVERLAY_MIME_TAG ||
      !o ||
      typeof o.kind !== "string" ||
      typeof o.x !== "number" ||
      typeof o.y !== "number" ||
      typeof o.w !== "number" ||
      typeof o.h !== "number"
    ) {
      return null;
    }
    return o as Overlay;
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
