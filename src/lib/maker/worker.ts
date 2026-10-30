/// <reference lib="webworker" />
/** Runs a chapter in the background so the editor never freezes. */
import { base64, displayOrientation, extOf, imageSize, mimeFor } from "./imageutil.ts";
import { run, type RunOptions } from "./pipeline.ts";

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** The image as the vision model sees it: big photos shrunk, turned photos upright, other formats as JPEG. */
async function forModel(img: { name: string; bytes: Uint8Array }, maxSide: number): Promise<string> {
  const [w, h] = imageSize(img.bytes);
  const plain = [".png", ".jpg", ".jpeg"].includes(extOf(img.name));
  if (plain && Math.max(w, h) <= maxSide && displayOrientation(img.bytes) === 1) return base64(img.bytes);
  try {
    const bmp = await createImageBitmap(new Blob([img.bytes as BlobPart], { type: mimeFor(img.name) }));
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return base64(new Uint8Array(await out.arrayBuffer()));
  } catch {
    return base64(img.bytes);
  }
}

scope.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { type: "run"; cached: unknown; options: RunOptions & { useCache: boolean } };
  if (msg.type !== "run") return;
  const { useCache, ...options } = msg.options;
  try {
    const result = await run(
      {
        ...options,
        forModel,
        cache: useCache
          ? {
              load: async () => (msg.cached as never) ?? null,
              save: async (value) => scope.postMessage({ type: "cache", value }),
            }
          : null,
      },
      (line) => scope.postMessage({ type: "log", line }),
    );
    scope.postMessage({ type: "done", file: result.file });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    scope.postMessage({ type: "error", message: err.message, name: err.name || err.constructor?.name || "Error" });
  }
};
