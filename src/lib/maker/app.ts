/**
 * The Manga Maker inside Panel Fox: remembered settings and cast, the vision
 * cache, reading a folder of images, talking to Ollama, and running a chapter
 * in a background worker so the editor stays responsive.
 */
import { idbDelete, idbGet, idbSet } from "@/lib/manga/idb";
import { isImageName, sortImages, type ImageFile } from "./imageutil.ts";
import type { KomaFile } from "./koma.ts";
import { normalizeHost, OllamaClient, type OllamaModel } from "./ollama.ts";
import { DEFAULT_DIALOGUE, DEFAULT_VISION } from "./pipeline.ts";

export type MakerPhoto = { name: string; dataUrl: string };
export type MakerCharacter = { id: string; name: string; personality: string; pov: boolean; photo: MakerPhoto | null };

export type MakerAdvanced = {
  visionModel: string;
  dialogueModel: string;
  host: string;
  temperature: number;
  rtl: boolean;
  keepOrder: boolean;
  pagesPerCall: number;
  /** images the vision model looks at at once */
  parallel: number;
  language: string;
  testMode: boolean;
};

export type MakerSettings = {
  characters: MakerCharacter[];
  chapterName: string;
  premise: string;
  useAllImages: boolean;
  adultsOk: boolean;
  advanced: MakerAdvanced;
};

export const DEFAULT_ADVANCED: MakerAdvanced = {
  visionModel: DEFAULT_VISION,
  dialogueModel: DEFAULT_DIALOGUE,
  host: "http://localhost:11434",
  temperature: 0.85,
  rtl: true,
  keepOrder: false,
  pagesPerCall: 3,
  parallel: 4,
  language: "English",
  testMode: false,
};

const SETTINGS_KEY = "maker-settings-v1";
const CACHE_INDEX = "maker-cache-index-v1";
const CACHE_KEEP = 6;

export function newCharacter(): MakerCharacter {
  return { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: "", personality: "", pov: false, photo: null };
}

export function defaultSettings(): MakerSettings {
  return {
    characters: [newCharacter()],
    chapterName: "",
    premise: "",
    useAllImages: false,
    adultsOk: false,
    advanced: { ...DEFAULT_ADVANCED },
  };
}

export async function loadSettings(): Promise<MakerSettings> {
  try {
    const raw = await idbGet("kv", SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const s = JSON.parse(raw) as Partial<MakerSettings>;
    const base = defaultSettings();
    return {
      ...base,
      ...s,
      characters: Array.isArray(s.characters) && s.characters.length ? s.characters : base.characters,
      advanced: { ...DEFAULT_ADVANCED, ...(s.advanced ?? {}) },
    };
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(s: MakerSettings): Promise<void> {
  try {
    await idbSet("kv", SETTINGS_KEY, s);
  } catch {
    /* private mode: settings last for this session only */
  }
}

// ---------- images --------------------------------------------------------------

export type ChosenImages = { folderName: string; files: File[] };

/** The top-level images of a folder chosen with a folder picker (sub-folders are left out, like the old app). */
export function imagesFromPicker(list: FileList | File[]): ChosenImages {
  const all = Array.from(list);
  const withPath = all.map((f) => ({ f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name }));
  const top = withPath.filter((x) => x.path.split("/").length <= 2);
  const use = (top.length ? top : withPath).filter((x) => isImageName(x.f.name));
  const first = withPath[0]?.path ?? "";
  const folderName = first.includes("/") ? first.split("/")[0]! : "Images";
  return { folderName, files: sortImages(use.map((x) => x.f)) };
}

type Entry = FileSystemEntry & { isFile: boolean; isDirectory: boolean };

function readEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const out: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) resolve(out);
        else {
          out.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

function entryFile(e: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => e.file(resolve, reject));
}

/** Images from a drop: a dropped folder (its top level), or loose image files. */
export async function imagesFromDrop(dt: DataTransfer): Promise<ChosenImages | null> {
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === "file");
  const entries = items.map((i) => (i.webkitGetAsEntry?.() ?? null) as Entry | null);
  const dir = entries.find((e) => e?.isDirectory) as FileSystemDirectoryEntry | undefined;
  if (dir) {
    const kids = await readEntries(dir);
    const files: File[] = [];
    for (const k of kids) if (k.isFile && isImageName(k.name)) files.push(await entryFile(k as FileSystemFileEntry));
    return { folderName: dir.name, files: sortImages(files) };
  }
  const files = Array.from(dt.files ?? []).filter((f) => isImageName(f.name));
  if (!files.length) return null;
  return { folderName: "Dropped images", files: sortImages(files) };
}

export async function readImages(files: File[], stopped: () => boolean = () => false): Promise<ImageFile[]> {
  const out: ImageFile[] = [];
  for (const f of files) {
    if (stopped()) break;
    out.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), size: f.size, lastModified: f.lastModified });
  }
  return out;
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** A character photo, shrunk to 768 px so the settings stay small. */
export async function photoFromFile(file: File): Promise<MakerPhoto> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 768 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return { name: file.name.replace(/\.[^.]+$/, "") + ".jpg", dataUrl: canvas.toDataURL("image/jpeg", 0.9) };
}

export function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- vision cache --------------------------------------------------------

async function sha1(text: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cache key: these files (name, size, date), the vision model and the cast it was told about. */
export async function cacheKey(chosen: ChosenImages, s: MakerSettings): Promise<string> {
  const files = chosen.files.map((f) => `${f.name}:${f.size}:${Math.trunc(f.lastModified / 1000)}`);
  const cast: unknown[] = [];
  for (const c of s.characters) {
    if (!c.name.trim()) continue;
    cast.push([c.name.trim(), Boolean(c.pov), c.photo ? await sha1(c.photo.dataUrl) : ""]);
  }
  const who = JSON.stringify([s.advanced.visionModel, cast]);
  return `maker-cache:${(await sha1(`${chosen.folderName}|${files.join("|")}|${who}`)).slice(0, 16)}`;
}

export async function readCache(key: string): Promise<unknown | null> {
  try {
    const raw = await idbGet("kv", key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await idbSet("kv", key, value);
    const raw = await idbGet("kv", CACHE_INDEX);
    const idx = (raw ? (JSON.parse(raw) as string[]) : []).filter((k) => k !== key);
    idx.push(key);
    while (idx.length > CACHE_KEEP) {
      const old = idx.shift()!;
      await idbDelete("kv", old);
    }
    await idbSet("kv", CACHE_INDEX, idx);
  } catch {
    /* the cache is only a speed-up */
  }
}

// ---------- Ollama --------------------------------------------------------------

export type OllamaStatus = { running: boolean; models: OllamaModel[]; missing: string[]; badAddress?: boolean };

export async function ollamaStatus(adv: MakerAdvanced): Promise<OllamaStatus> {
  if (!normalizeHost(adv.host)) return { running: false, models: [], missing: [], badAddress: true };
  const client = new OllamaClient(adv.host);
  try {
    const models = await client.listModels();
    const have = new Set<string>();
    for (const m of models) {
      have.add(m.name);
      if (m.name.endsWith(":latest")) have.add(m.name.slice(0, -7));
    }
    const missing = [adv.visionModel, adv.dialogueModel].filter((m) => !have.has(m));
    return { running: true, models, missing };
  } catch {
    return { running: false, models: [], missing: [] };
  }
}

// ---------- progress ------------------------------------------------------------

export type Step = "starting" | "looking" | "ordering" | "layout" | "writing" | "saving" | "done";
export type Progress = {
  step: Step;
  detail: string;
  fraction: number;
  notes: string[];
  timings: string[];
  /** images reused from a stopped run, so the time-left estimate counts only new ones */
  reused?: number;
};

/** Turn the engine's log lines into plain-language progress. */
export function progressFromLog(line: string, p: Progress): Progress {
  const l = line.trim();
  const next = { ...p, notes: [...p.notes] };
  let m: RegExpExecArray | null;
  if (l.startsWith("[TIME]")) {
    console.info(l);
    return { ...next, timings: [...p.timings, l.slice(6).trim()] };
  }
  if ((m = /vision (\d+)\/(\d+)/.exec(l))) {
    const i = +m[1]!;
    const n = +m[2]!;
    const reused = l.includes("reusing") ? i : p.reused;
    return { ...next, reused, step: "looking", detail: `${i} of ${n} images done`, fraction: 0.05 + (0.5 * i) / Math.max(1, n) };
  }
  if (l.startsWith("mock mode")) next.notes.push("Test run: placeholder text, no models were used.");
  else if (l.includes("using cached vision")) return { ...next, step: "looking", detail: "Already seen these images, reusing", fraction: 0.5 };
  else if (l.includes("sketching outline")) return { ...next, step: "ordering", detail: "Sketching the story", fraction: 0.56 };
  else if (l.includes("selecting images")) return { ...next, step: "ordering", detail: "Picking images that fit", fraction: 0.57 };
  else if ((m = /kept (\d+) of (\d+) images/.exec(l))) {
    next.notes = next.notes.filter((n) => !n.startsWith("Kept "));
    next.notes.unshift(`Kept ${m[1]} of ${m[2]} images that fit the story.`);
    return { ...next, detail: `Keeping ${m[1]} of ${m[2]} images` };
  } else if (l.startsWith("reader: the unnamed man")) {
    const who = /\("(.+?)"\)/.exec(l)?.[1] ?? "You";
    next.notes.push(`An unnamed man in your images is the reader (“${who}”); images with no man are seen through his eyes.`);
  } else if (l.startsWith("reader: no man")) {
    const who = /\("(.+?)"\)/.exec(l)?.[1] ?? "You";
    next.notes.push(`No man in your images, so they are seen through the reader’s eyes (“${who}”).`);
  } else if (l.startsWith("speakers not in your cast:")) next.notes.push(`Also speaking: ${l.split(":").slice(1).join(":").trim()}.`);
  else if (l.includes("planning reading order")) return { ...next, step: "ordering", detail: "Finding the story", fraction: 0.58 };
  else if (l.startsWith("framing:")) return { ...next, step: "layout", detail: "Framing each panel", fraction: 0.6 };
  else if (l.startsWith("layout:")) {
    const pages = /(\d+) pages/.exec(l)?.[1];
    return { ...next, step: "layout", detail: pages ? `${pages} pages` : "", fraction: 0.62 };
  } else if ((m = /dialogue: pages (\d+)-(\d+) of (\d+)/.exec(l))) {
    const a = +m[1]!;
    const b = +m[2]!;
    const n = +m[3]!;
    return { ...next, step: "writing", detail: `Pages ${a}–${b} of ${n}`, fraction: 0.65 + (0.3 * (a - 1)) / Math.max(1, n) };
  } else if (l.startsWith("script:")) return { ...next, step: "saving", detail: "", fraction: 0.96 };
  return next;
}

/** "Vision analysis, 10 images: 84.2s" lines -> "Took 2m 5s: looking at images 1m 24s, writing 31s." */
export function timingSummary(timings: string[]): string {
  const value = (label: RegExp) => {
    let total = 0;
    let found = false;
    for (const t of timings) {
      const m = /^(.*): ([\d.]+)s$/.exec(t);
      if (m && label.test(m[1]!)) {
        total += Number(m[2]);
        found = true;
      }
    }
    return found ? total : null;
  };
  const fmt = (x: number) => (x >= 60 ? `${Math.floor(x / 60)}m ${Math.round(x % 60)}s` : `${x < 10 ? x.toFixed(1) : Math.round(x)}s`);
  const total = value(/^Total$/);
  if (total === null) return "";
  const parts: string[] = [];
  const looking = value(/^Vision analysis/);
  const story = value(/^(Story outline|Reading order)/);
  const writing = value(/^Script generation/);
  if (looking !== null) parts.push(`looking at images ${fmt(looking)}`);
  if (story !== null) parts.push(`story ${fmt(story)}`);
  if (writing !== null) parts.push(`writing ${fmt(writing)}`);
  return `Took ${fmt(total)}${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}

export function friendlyError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e ?? "");
  if (text.includes("Cannot reach Ollama")) {
    return "Can’t reach Ollama. Make sure the Ollama app is open, then try again.";
  }
  const http = /^Ollama HTTP (\d+) on \S+: ([\s\S]*)$/.exec(text);
  if (http) {
    // Ollama's own errors come as {"error": "..."} or from inside a streamed answer
    let said = http[2]!.trim();
    try {
      const j = JSON.parse(said) as { error?: unknown };
      if (typeof j.error === "string") said = j.error;
    } catch {
      /* plain text */
    }
    const fromOllama = /"error"/.test(http[2]!) || http[1] === "500";
    if (!fromOllama) return "Something at that address answered, but it isn’t Ollama. Check the Ollama address in Advanced.";
    return `Ollama had a problem: ${said.slice(0, 300)}`;
  }
  if (text.includes("Missing Ollama models")) {
    return text.replace("Missing Ollama models:", "These models aren’t installed yet:").replace("Pull them with:", "Install them in Terminal with:");
  }
  if (text.includes("under 18")) return text;
  if (text.includes("No images found")) return "That folder has no images in it (PNG, JPG, WEBP, GIF or BMP).";
  const kept = " The images it already looked at are kept, so trying again is quicker.";
  const who = /^Model (\S+) /.exec(text)?.[1];
  const short = who ? who.split("/").pop()!.replace(/-GGUF.*$/i, "").replace(/:.*$/, "") : "The model";
  if (text.includes("ran out of room")) {
    return `${short}’s answer got too long and was cut off. Try fewer “Pages written at a time”, or a model with a bigger context.${kept}`;
  }
  if (text.includes("did not return valid JSON")) {
    return `${short} gave an answer the app couldn’t read. Try again, or choose a different model for this step.${kept}`;
  }
  return text || "Something went wrong.";
}

// ---------- running a chapter ---------------------------------------------------

export type RunRequest = {
  chosen: ChosenImages;
  settings: MakerSettings;
  onProgress: (p: Progress) => void;
};

export type RunResultInfo = { file: KomaFile; notes: string[]; timings: string[] };
export type RunHandle = { done: Promise<RunResultInfo>; stop: () => void };

export function startChapter(req: RunRequest): RunHandle {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let progress: Progress = { step: "starting", detail: "", fraction: 0.02, notes: [], timings: [] };
  type Settle = { resolve: (v: RunResultInfo) => void; reject: (e: unknown) => void };
  const holder: { s: Settle | null } = { s: null };
  const done = new Promise<RunResultInfo>((resolve, reject) => {
    holder.s = { resolve, reject };
  });
  let stopped = false;
  const stop = () => {
    stopped = true;
    worker.terminate();
    holder.s?.reject(new DOMException("Stopped", "AbortError"));
    holder.s = null;
  };
  void (async () => {
    try {
      const s = req.settings;
      const key = s.advanced.testMode ? null : await cacheKey(req.chosen, s);
      const cached = key ? await readCache(key) : null;
      const images = await readImages(req.chosen.files, () => stopped);
      if (stopped) return;
      const characters = s.characters
        .filter((c) => c.name.trim())
        .map((c) => ({
          name: c.name.trim(),
          personality: c.personality.trim(),
          pov: c.pov || undefined,
          photo: c.photo ? { name: c.photo.name, bytes: dataUrlBytes(c.photo.dataUrl) } : null,
        }));
      worker.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as
          | { type: "log"; line: string }
          | { type: "cache"; value: unknown }
          | { type: "done"; file: KomaFile }
          | { type: "error"; message: string; name: string };
        if (msg.type === "log") {
          progress = progressFromLog(msg.line, progress);
          req.onProgress(progress);
        } else if (msg.type === "cache") {
          if (key) void writeCache(key, msg.value);
        } else if (msg.type === "done") {
          worker.terminate();
          holder.s?.resolve({ file: msg.file, notes: progress.notes, timings: progress.timings });
          holder.s = null;
        } else if (msg.type === "error") {
          worker.terminate();
          const err = new Error(msg.message);
          err.name = msg.name;
          holder.s?.reject(err);
          holder.s = null;
        }
      };
      worker.onerror = (ev) => {
        worker.terminate();
        holder.s?.reject(new Error(ev.message || "The chapter maker stopped unexpectedly."));
        holder.s = null;
      };
      req.onProgress(progress);
      const a = s.advanced;
      worker.postMessage(
        {
          type: "run",
          cached,
          options: {
            images,
            config: { title: s.chapterName.trim(), premise: s.premise.trim(), characters },
            name: s.chapterName.trim() || req.chosen.folderName,
            folderName: req.chosen.folderName,
            visionModel: a.visionModel,
            dialogueModel: a.dialogueModel,
            host: normalizeHost(a.host) ?? a.host,
            mock: a.testMode,
            keepOrder: a.keepOrder,
            rtl: a.rtl,
            pagesPerCall: Math.max(1, Math.trunc(a.pagesPerCall) || 3),
            parallel: Math.min(8, Math.max(1, Math.trunc(a.parallel) || 4)),
            keepAlive: 3600,
            language: a.language || "English",
            temperature: Number.isFinite(a.temperature) ? a.temperature : 0.85,
            selectImages: !s.useAllImages,
            useCache: Boolean(key),
          },
        },
        images.map((i) => i.bytes.buffer as ArrayBuffer),
      );
    } catch (e) {
      worker.terminate();
      holder.s?.reject(e);
      holder.s = null;
    }
  })();
  return { done, stop };
}
