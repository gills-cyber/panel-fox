/** End to end: images + cast -> a finished Panel Fox project. */
import { placeBubbles } from "./bubbles.ts";
import { loadConfig, type ConfigInput, type StoryConfig } from "./config.ts";
import { framePanels, planCrop, type Crop } from "./crop.ts";
import { writeScript } from "./dialogue.ts";
import { base64, imageSize, sortImages, type ImageFile } from "./imageutil.ts";
import { buildKoma, validateKoma, type KomaFile, MAKER_VERSION } from "./koma.ts";
import { buildLayout, layoutOptions } from "./layout.ts";
import { MockClient } from "./mock.ts";
import { OllamaClient, type ModelClient } from "./ollama.ts";
import { pyInt, sortedBy } from "./py.ts";
import { outline, outlineNotes, select, type SelectionInfo } from "./selection.ts";
import { analyseImages, planOrder, resolvePeople, secs, type Analysis, type Beat } from "./vision.ts";

export const DEFAULT_VISION = "huihui_ai/qwen3-vl-abliterated:8b-instruct";
export const DEFAULT_DIALOGUE = "huihui_ai/qwen2.5-coder-abliterate:32b";

export class PipelineError extends Error {}

/** Where the vision results for these images are kept, so dialogue can be re-rolled without looking again. */
export interface VisionCache {
  load(): Promise<{ analyses?: Record<string, Analysis>; who?: unknown } | null>;
  save(value: { analyses: Record<string, Analysis>; who: unknown }): Promise<void>;
}

export type RunOptions = {
  images: ImageFile[];
  config: ConfigInput;
  /** the chapter's name; defaults to the cast title, then the folder's name */
  name?: string;
  folderName?: string;
  visionModel?: string;
  dialogueModel?: string;
  host?: string;
  mock?: boolean;
  keepOrder?: boolean;
  useRefs?: boolean;
  rtl?: boolean;
  pagesPerCall?: number;
  language?: string;
  temperature?: number;
  numCtx?: number | null;
  selectImages?: boolean;
  maxImages?: number | null;
  /** how many images the vision model looks at at once (Ollama must allow it: OLLAMA_NUM_PARALLEL) */
  parallel?: number;
  /** how long Ollama keeps models loaded after each call, in seconds (-1: until Ollama quits) */
  keepAlive?: number;
  cache?: VisionCache | null;
  /** a model client to use instead of Ollama (tests) */
  client?: ModelClient;
  /** the image as the vision model sees it (base64); the browser shrinks big photos here */
  forModel?: (img: { name: string; bytes: Uint8Array }, maxSide: number) => Promise<string>;
  signal?: AbortSignal;
  /** lets the page breathe between heavy steps */
  pause?: () => Promise<void>;
};

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes as unknown as ArrayBuffer));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the vision step was told: its model and the cast. A cached result is reused only when this is unchanged. */
export async function visionSignature(opt: RunOptions, cfg: StoryConfig) {
  const cast: unknown[] = [];
  for (const c of cfg.characters) {
    const ref = c.reference ? await sha1Hex(c.reference.bytes) : "";
    cast.push([c.name, c.appearance || "", Boolean(c.pov), ref]);
  }
  return { vision_model: opt.mock ? "mock" : opt.visionModel ?? DEFAULT_VISION, use_refs: opt.useRefs ?? true, cast };
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type RunResult = { file: KomaFile; selection: SelectionInfo | null; log: string[] };

export async function run(opt: RunOptions, log: (s: string) => void = () => {}): Promise<RunResult> {
  const lines: string[] = [];
  const say = (s: string) => {
    lines.push(s);
    log(s);
  };
  const check = () => {
    if (opt.signal?.aborted) throw new DOMException("Stopped", "AbortError");
  };
  const pause = async () => {
    check();
    if (opt.pause) await opt.pause();
  };
  const visionModel = opt.visionModel || DEFAULT_VISION;
  const dialogueModel = opt.dialogueModel || DEFAULT_DIALOGUE;
  const rtl = opt.rtl ?? true;
  const started = Date.now();
  let phaseStart = started;
  const timed = (label: string) => {
    const now = Date.now();
    say(`[TIME] ${label}: ${secs(now - phaseStart)}`);
    phaseStart = now;
  };
  say(`Manga Maker ${MAKER_VERSION}`);
  const cfg = loadConfig(opt.config);
  const images = sortImages(opt.images);
  if (!images.length) throw new PipelineError(`No images found in ${opt.folderName ?? "the folder"}`);
  const byName = new Map(images.map((p) => [p.name, p]));
  say(`${images.length} images, ${cfg.characters.length} characters`);

  let client: ModelClient;
  if (opt.client) client = opt.client;
  else if (opt.mock) {
    const m = new MockClient(cfg);
    m.imageNames = images.map((p) => p.name);
    client = m;
    say("mock mode: no models are called");
  } else {
    client = new OllamaClient(
      opt.host ?? "http://localhost:11434",
      opt.numCtx === undefined ? 16384 : opt.numCtx,
      opt.signal,
      opt.keepAlive ?? 3600,
    );
    if (visionModel !== dialogueModel) (client as OllamaClient).models = [visionModel, dialogueModel];
    const missing = await client.checkModels([visionModel, dialogueModel]);
    if (missing.length) {
      throw new PipelineError(
        `Missing Ollama models: ${missing.join(", ")}\nPull them with: ${missing.map((m) => `ollama pull ${m}`).join("; ")}`,
      );
    }
  }
  if (opt.mock && opt.client instanceof MockClient) opt.client.imageNames = images.map((p) => p.name);
  const forModel = opt.forModel ?? (async (img: { bytes: Uint8Array }) => base64(img.bytes));

  timed("Setup and model check");

  // 1. vision (cached so dialogue can be re-rolled without looking again)
  let analyses: Map<string, Analysis> | null = null;
  let fromCache = false;
  const who = await visionSignature({ ...opt, visionModel }, cfg);
  // images a stopped (or failed) run already looked at, picked up where it left off
  const known = new Map<string, Analysis>();
  if (opt.cache) {
    const cached = await opt.cache.load();
    const ca = cached?.analyses;
    if (cached && ca) {
      const keys = Object.keys(ca);
      const sameImages = keys.length === byName.size && keys.every((k) => byName.has(k));
      const current = Object.values(ca).every((a) => "focus_box" in a && "art_text" in a);
      if (sameImages && current && same(cached.who ?? who, who)) {
        analyses = new Map(Object.entries(ca));
        fromCache = true;
        say("using cached vision results");
        if (cached.who === undefined) await opt.cache.save({ analyses: ca, who }).catch(() => {});
      } else if (current && cached.who !== undefined && same(cached.who, who)) {
        for (const k of keys) if (byName.has(k)) known.set(k, ca[k]!);
      }
    }
  }
  if (analyses === null) {
    say("vision pass");
    const sofar: Record<string, Analysis> = Object.fromEntries(known);
    const cache = opt.cache;
    analyses = await analyseImages(
      client, visionModel, cfg, images, forModel, opt.useRefs ?? true,
      (s) => {
        check();
        say(s);
      },
      opt.parallel ?? 1,
      {
        known,
        // saved after every image, so pressing Stop keeps what is done
        onEach: cache
          ? (n, a) => {
              sofar[n] = a;
              void cache.save({ analyses: { ...sofar }, who }).catch(() => {});
            }
          : undefined,
      },
    );
    if (opt.cache) await opt.cache.save({ analyses: Object.fromEntries(analyses), who }).catch(() => {});
    // the cache keeps what the model saw; the steps below change the analyses in memory only
    analyses = new Map(JSON.parse(JSON.stringify(Array.from(analyses))) as [string, Analysis][]);
  }
  await pause();
  timed(fromCache ? "Vision analysis (reused from last time)" : `Vision analysis, ${images.length} images`);

  const standIn = resolvePeople(analyses, cfg);
  if (standIn) {
    const seen = Array.from(analyses.values()).some((a) => (a.characters ?? []).some((c) => c.id === standIn.id));
    if (seen) {
      say(`reader: the unnamed man in the pictures is the reader ("${standIn.name}"); pictures with no man are seen through his eyes`);
    } else say(`reader: no man in the pictures, so they are seen through the reader's eyes ("${standIn.name}")`);
  }

  // 2a. story-first selection
  let selection: SelectionInfo | null = null;
  let kept = images;
  if (opt.selectImages ?? true) {
    say("story-first selection");
    const rough = await outline(client, dialogueModel, cfg, analyses, say);
    await pause();
    const [keptNames, info] = await select(client, dialogueModel, rough, analyses, opt.maxImages ?? null, say);
    selection = info;
    const all = analyses;
    analyses = new Map(keptNames.map((n) => [n, all.get(n)!]));
    kept = images.filter((p) => analyses!.has(p.name));
    timed("Story outline and image selection");
  }
  const context = selection ? outlineNotes(selection) : "";
  const beats = new Map<string, Beat>(selection ? Object.entries(selection.beats) : []);
  await pause();

  // 2b. reading order + importance
  let order: string[];
  let importance: Map<string, number>;
  let storyNotes: string;
  if (opt.keepOrder) {
    order = kept.map((p) => p.name);
    importance = new Map(Array.from(analyses, ([n, a]) => [n, a.importance]));
    storyNotes = context;
  } else {
    [order, importance, storyNotes] = await planOrder(client, visionModel, analyses, say, context, beats);
    if (context) storyNotes = `${context} ${storyNotes}`.trim();
    timed("Reading order");
  }
  await pause();

  // 3. framing
  const crops = new Map<string, Crop>();
  for (const n of order) {
    crops.set(n, planCrop(analyses.get(n)!, imageSize(byName.get(n)!.bytes), importance.get(n) ?? 2, beats.get(n)));
  }
  const labels = new Map<string, number>();
  for (const c of crops.values()) labels.set(c.label, (labels.get(c.label) ?? 0) + 1);
  say(`framing: ${sortedBy(Array.from(labels), ([, v]) => -v).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  // 4. layout
  const items = order.map((n) => crops.get(n)!.layoutItem(n, importance.get(n) ?? 2));
  for (const it of items) {
    try {
      it.beat = pyInt(beats.get(it.name)?.beat || 0);
    } catch {
      it.beat = 0;
    }
  }
  await pause();
  const pages = buildLayout(items, layoutOptions({ rtl }));
  framePanels(pages, crops);
  say(`layout: ${pages.length} pages, panels per page: [${pages.map((p) => p.panels.length).join(", ")}]`);
  await pause();
  timed("Framing and page layout");

  // 5. dialogue
  say("dialogue pass");
  const script = await writeScript(
    client, dialogueModel, cfg, pages, analyses, importance, storyNotes,
    Math.max(1, opt.pagesPerCall ?? 3), opt.language || "English", opt.temperature ?? 0.85,
    (s) => {
      check();
      say(s);
    },
    beats,
  );
  script.forEach((l, i) => (l.id = `line-${i + 1}`));
  say(`script: ${script.length} lines`);
  await pause();
  timed("Script generation (dialogue)");

  // 6. bubbles + project
  const overlays = await placeBubbles(pages, script, analyses, rtl, cfg.reader ? cfg.reader.id : null, pause);
  const name = opt.name || cfg.title || opt.folderName || "Chapter";
  const file = buildKoma(name, cfg, pages, script, overlays, byName, rtl);
  const added = cfg.characters.filter((c) => c.added && !c.pov).map((c) => c.name);
  if (added.length) say(`speakers not in your cast: ${added.join(", ")}`);
  const problems = validateKoma(file);
  if (problems.length) throw new PipelineError(`Generated project failed validation:\n${problems.slice(0, 20).join("\n")}`);
  timed("Speech bubbles and project");
  say(`[TIME] Total: ${secs(Date.now() - started)}`);
  say("done");
  return { file, selection, log: lines };
}
