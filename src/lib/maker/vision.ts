/** Vision pass: analyse each image, then pick a reading order. */
import type { StoryConfig } from "./config.ts";
import type { ModelClient } from "./ollama.ts";
import { isDict, list, maxBy, pslice, pyFloat, pyRound, pyStr, pyStrip, squash, truthy } from "./py.ts";

export type Box = number[];

export type Person = {
  name: string;
  id: string | null;
  gender: string;
  confidence: number;
  is_adult: boolean;
  pose: string;
  action: string;
  expression: string;
  clothing_state: string;
  head_box: Box | null;
  mouth: number[] | null;
  [k: string]: unknown;
};

export type Analysis = {
  characters: Person[];
  setting: string;
  scene_summary: string;
  mood: string;
  importance: number;
  importance_reason: string;
  empty_regions: Box[];
  focus_label: string;
  focus_box: Box | null;
  focus_source: string;
  regions: { label: string; box: Box }[];
  art_text: { text: string; box: Box }[];
  pov_model: boolean;
  pov_shot: boolean;
  reader_visible: boolean;
  [k: string]: unknown;
};

const NUM = { type: "number" };
const BOX = { type: "array", items: NUM };

export const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    characters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          gender: { type: "string", enum: ["female", "male", "unclear"] },
          confidence: NUM,
          is_adult: { type: "boolean" },
          pose: { type: "string" },
          action: { type: "string" },
          expression: { type: "string" },
          clothing_state: { type: "string" },
          head_box: BOX,
          mouth: BOX,
        },
        required: ["name", "gender", "is_adult", "pose", "action", "expression", "clothing_state", "head_box", "mouth"],
      },
    },
    setting: { type: "string" },
    scene_summary: { type: "string" },
    mood: { type: "string" },
    importance: { type: "integer" },
    importance_reason: { type: "string" },
    empty_regions: { type: "array", items: BOX },
    pov_shot: { type: "boolean" },
    focus_label: { type: "string" },
    focus_box: BOX,
    regions: {
      type: "array",
      items: { type: "object", properties: { label: { type: "string" }, box: BOX }, required: ["label", "box"] },
    },
    art_text: {
      type: "array",
      items: { type: "object", properties: { text: { type: "string" }, box: BOX }, required: ["text", "box"] },
    },
  },
  required: ["characters", "setting", "scene_summary", "importance", "focus_label", "focus_box"],
};

export const ORDER_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    order: { type: "array", items: { type: "string" } },
    importance: { type: "object" },
    story_notes: { type: "string" },
  },
  required: ["order"],
};

export const VISION_SYSTEM =
  "You are a precise visual analyst preparing panels for an adult manga. " +
  "You describe what is visible accurately and objectively, and you always answer " +
  "with a single JSON object that matches the requested schema. " +
  "Coordinates are integers on a 0-1000 grid relative to the scene image " +
  "(x from left, y from top).";

function castBlock(cfg: StoryConfig): string {
  return cfg.characters
    .map((c) => {
      const desc = c.appearance || "(no appearance notes; use reference image if given)";
      const age = c.age ? ` (adult, age ${c.age})` : "";
      return `- ${c.name}${age}: ${desc}`;
    })
    .join("\n");
}

function readerBlock(cfg: StoryConfig): string {
  const r = cfg.reader;
  if (!r) {
    return `
- pov_shot: true if the image is drawn from the point of view of someone in the scene (the
  camera is their eyes, so at most their hands, arms or body are seen from their own viewpoint),
  otherwise false. Do not list that unseen viewer under characters.
`;
  }
  return `
Reader / POV: ${r.name} is the reader's stand-in. Many images are drawn from ${r.name}'s
point of view: the camera is ${r.name}'s eyes, so at most their hands, arms or body are seen
from their own viewpoint while others look at or interact with the camera.
- pov_shot: true if this image is drawn from ${r.name}'s point of view, otherwise false.
- If ${r.name} is visible as a person in the scene (not just from their own viewpoint),
  list them under characters with name "${r.name}". In a pure POV shot, do not list them.
`;
}

export function buildVisionPrompt(cfg: StoryConfig, refNames: string[]): string {
  let refs = "";
  if (refNames.length) {
    refs =
      "The first images are character references, in this order: " +
      refNames.join(", ") +
      ". The LAST image is the scene to analyse.\n\n";
  }
  return `${refs}Known characters:
${castBlock(cfg)}

Analyse the scene image and return JSON with:
- characters: one entry per visible person. "name" must be one of the known names if you
  recognise them (from references or descriptions), otherwise "unknown". Include
  "gender" ("female", "male" or "unclear", as drawn), "confidence" (0-1),
  "is_adult" (false if the person is drawn as under 18: a child's or young teen's body and
  proportions; otherwise true. The known characters are adults. Manga often draws adults with
  youthful faces: a young-looking face or the art style alone does not make someone under 18,
  but a stated age never outweighs a body drawn as a child's),
  "pose", "action", "expression", "clothing_state" (short, factual),
  "head_box" [x1,y1,x2,y2] around the head, and "mouth" [x,y] for the mouth position.
- setting: where the scene takes place.
- scene_summary: one or two sentences on what is happening.
- mood: one or two words.
- importance: 1-5. 5 = climax or key turning point, 4 = strong key moment,
  3 = notable, 1-2 = ordinary/transitional.
- importance_reason: short reason.
- empty_regions: up to 3 boxes [x1,y1,x2,y2] of background with no faces or key
  action, good for placing speech bubbles.
- focus_label: the single most narratively important region of the image, the part a manga
  artist would frame for this panel. A short label such as "face", "hands", "chest", "hips",
  "full body" or "interaction" (or similar). Do NOT default to the face: when the image shows
  explicit or physical action, choose the body part or the interaction where it happens.
  Choose "face" only when the expression is the point (a reaction, a line, an emotional beat).
- focus_box: [x1,y1,x2,y2] tightly around that region.
- regions: up to 4 OTHER regions worth framing, each {"label", "box"}, for example each
  person's face, the hands, the point of contact, the full body. Can be empty.
- art_text: words already drawn in the image (speech bubbles, captions, sound effects, signs),
  each {"text", "box"} with the words as written and a box around them. Empty if there are none.
Still give every person's head_box and mouth, even when the focus is elsewhere.
${readerBlock(cfg)}`;
}

/** Python `isinstance(x, (int, float))` (bools count). */
function numLike(x: unknown): x is number | boolean {
  return typeof x === "number" || typeof x === "boolean";
}

function normPoint(vals: unknown[], scale: number): number[] | null {
  try {
    return vals.map((v) => Math.max(0, Math.min(1, pyFloat(v) / scale)));
  } catch {
    return null;
  }
}

export const MIN_FOCUS_AREA = 0.0004; // boxes smaller than 2% x 2% of the image are noise

/** A 4-number box in model coordinates -> ordered [x1, y1, x2, y2] in 0-1, or null. */
function normBox(vals: unknown, scale: number): Box | null {
  if (!Array.isArray(vals) || vals.length !== 4) return null;
  const p = normPoint(vals, scale);
  if (!p || !p.length) return null;
  return [Math.min(p[0]!, p[2]!), Math.min(p[1]!, p[3]!), Math.max(p[0]!, p[2]!), Math.max(p[1]!, p[3]!)];
}

export function area(b: Box): number {
  return Math.max(0, b[2]! - b[0]!) * Math.max(0, b[3]! - b[1]!);
}

function label(v: unknown): string {
  return pslice(squash((truthy(v) ? pyStr(v) : "").toLowerCase().replace(/_/g, " ")), 0, 40);
}

/** Python dict.get(key, default) followed by str(). */
function sget(obj: Record<string, unknown>, key: string, def = ""): string {
  return key in obj ? pyStr(obj[key]) : def;
}

function focus(raw: Record<string, unknown>, chars: Person[], scale: number): [string, Box, string] {
  const box = normBox(raw.focus_box, scale);
  const lbl = label(raw.focus_label);
  if (box && area(box) >= MIN_FOCUS_AREA) return [lbl || "subject", box, "model"];
  const heads = chars.filter((c) => c.head_box).map((c) => c.head_box!);
  if (heads.length) {
    const x1 = Math.min(...heads.map((h) => h[0]!));
    const y1 = Math.min(...heads.map((h) => h[1]!));
    const x2 = Math.max(...heads.map((h) => h[2]!));
    const y2 = Math.max(...heads.map((h) => h[3]!));
    const down = (y2 - y1) * 1.5; // the people, not just their heads
    return ["characters", [x1, y1, x2, Math.min(1, y2 + down)], "fallback"];
  }
  return ["scene", [0.15, 0.15, 0.85, 0.85], "fallback"];
}

/** Only a clear yes counts: true, 1, "true" or "yes". */
export function isAdult(v: unknown): boolean {
  if (typeof v === "string") return ["true", "yes"].includes(pyStrip(v).toLowerCase());
  return v === true || (typeof v === "number" && v === 1);
}

/** Coerce a raw vision result into the shape the rest of the pipeline expects. */
export function normalizeAnalysis(rawIn: unknown, cfg: StoryConfig): Analysis {
  const raw = (isDict(rawIn) ? rawIn : {}) as Record<string, unknown>;
  const charsIn = (truthy(raw.characters) && Array.isArray(raw.characters) ? raw.characters : []).filter(isDict) as Record<
    string,
    unknown
  >[];
  const nums: number[] = [];
  const pushNums = (v: unknown) => {
    if (Array.isArray(v)) for (const x of v) if (numLike(x)) nums.push(Number(x));
  };
  for (const c of charsIn) {
    pushNums(c.head_box);
    pushNums(c.mouth);
  }
  for (const r of list(raw.empty_regions)) pushNums(r);
  const boxes: unknown[] = [raw.focus_box];
  for (const g of [...list(raw.regions), ...list(raw.art_text)]) if (isDict(g)) boxes.push(g.box);
  for (const b of boxes) pushNums(b);
  const scale = nums.length && Math.max(...nums) <= 1.5 ? 1 : 1000;

  const chars: Person[] = [];
  for (const c of charsIn) {
    const name = truthy(c.name) ? pyStr(c.name) : "unknown";
    const match = cfg.byName(name);
    let box = normPoint(truthy(c.head_box) && Array.isArray(c.head_box) ? c.head_box : [], scale);
    if (!box || box.length !== 4) box = null;
    else {
      const [x1, y1, x2, y2] = box as [number, number, number, number];
      box = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    }
    let mouth = normPoint(truthy(c.mouth) && Array.isArray(c.mouth) ? c.mouth : [], scale);
    if (!mouth || mouth.length !== 2) mouth = null;
    if (mouth === null && box) mouth = [(box[0]! + box[2]!) / 2, box[1]! + (box[3]! - box[1]!) * 0.72];
    if (box === null && mouth) box = [mouth[0]! - 0.06, mouth[1]! - 0.12, mouth[0]! + 0.06, mouth[1]! + 0.03];
    const gender = pyStrip(truthy(c.gender) ? pyStr(c.gender) : "").toLowerCase();
    let confidence = 0.5;
    try {
      const v = "confidence" in c ? c.confidence : 0.5;
      confidence = pyFloat(truthy(v) ? v : 0.5);
    } catch {
      confidence = 0.5;
    }
    chars.push({
      name: match ? match.name : name,
      id: match ? match.id : null,
      gender: gender === "female" || gender === "male" ? gender : "unclear",
      confidence,
      is_adult: isAdult("is_adult" in c ? c.is_adult : true),
      pose: sget(c, "pose"),
      action: sget(c, "action"),
      expression: sget(c, "expression"),
      clothing_state: sget(c, "clothing_state"),
      head_box: box,
      mouth,
    });
  }
  let importance = 2;
  try {
    importance = pyRound(pyFloat("importance" in raw ? raw.importance : 2));
    if (!Number.isFinite(importance)) importance = 2;
  } catch {
    importance = 2;
  }
  const regions: Box[] = [];
  for (const r of list(raw.empty_regions)) {
    const p = normBox(r, scale);
    if (p) regions.push(p);
  }
  const [focusLabel, focusBox, focusSource] = focus(raw, chars, scale);
  const frames: { label: string; box: Box }[] = [];
  for (const g of list(raw.regions)) {
    if (!isDict(g)) continue;
    const b = normBox(g.box, scale);
    const lb = label(g.label);
    if (b && lb && area(b) >= MIN_FOCUS_AREA) frames.push({ label: lb, box: b });
  }
  const artText: { text: string; box: Box }[] = [];
  for (const g of list(raw.art_text)) {
    if (!isDict(g)) continue;
    const b = normBox(g.box, scale);
    const words = pslice(squash(truthy(g.text) ? pyStr(g.text) : ""), 0, 80);
    if (b && words && area(b) >= MIN_FOCUS_AREA) artText.push({ text: words, box: b });
  }
  return {
    characters: chars,
    setting: sget(raw, "setting"),
    scene_summary: sget(raw, "scene_summary"),
    mood: sget(raw, "mood"),
    importance: Math.max(1, Math.min(5, importance)),
    importance_reason: sget(raw, "importance_reason"),
    empty_regions: regions.slice(0, 3),
    focus_label: focusLabel,
    focus_box: focusBox,
    focus_source: focusSource,
    regions: frames.slice(0, 4),
    art_text: artText.slice(0, 6),
    pov_model: raw.pov_shot === true,
    pov_shot: isPov(raw, chars, cfg),
    reader_visible: readerSeen(chars, cfg),
  };
}

/** Match a (cached) analysis to the current cast again and recompute the reader tags. */
export function applyCast(analysis: Analysis, cfg: StoryConfig): Analysis {
  const chars = analysis.characters ?? [];
  for (const c of chars) {
    const match = cfg.byName(truthy(c.name) ? pyStr(c.name) : "");
    c.id = match ? match.id : null;
    if (match) c.name = match.name;
  }
  analysis.pov_shot = isPov({ pov_shot: analysis.pov_model === true }, chars, cfg);
  analysis.reader_visible = readerSeen(chars, cfg);
  return analysis;
}

export const STAND_INS = ["You", "Reader", "The reader"];

function standInPick(analysis: Analysis): Person | null {
  const chars = analysis.characters ?? [];
  const known = chars.some((c) => truthy(c.id));
  const picks = chars.filter((c) => !truthy(c.id) && (c.gender === "male" || (c.gender !== "female" && known)));
  if (!picks.length) return null;
  return maxBy(picks, (c) => [c.gender === "male", c.head_box ? area(c.head_box) : 0]);
}

function wantsStandIn(analyses: Map<string, Analysis>, cfg: StoryConfig): boolean {
  if (cfg.reader || cfg.extra.auto_reader === false) return false;
  const seen = new Map<string, string[]>();
  for (const a of analyses.values()) {
    for (const c of a.characters ?? []) {
      if (truthy(c.id)) {
        const v = seen.get(c.id!) ?? [];
        v.push(c.gender || "unclear");
        seen.set(c.id!, v);
      }
    }
  }
  for (const c of cfg.characters) {
    if (c.added) continue;
    const votes = seen.get(c.id);
    if (!votes) return false;
    const male = votes.filter((v) => v === "male").length;
    const female = votes.filter((v) => v === "female").length;
    if (male && male >= female) return false;
  }
  return seen.size > 0;
}

export class MinorDetectedError extends Error {}

/** Stops the run when the model said a person is not an adult (fresh or cached). */
export function checkAdults(analyses: Map<string, Analysis>): void {
  for (const [n, a] of analyses) {
    if ((a.characters ?? []).some((c) => !isAdult("is_adult" in c ? c.is_adult : true))) {
      throw new MinorDetectedError(
        `The vision model flagged a person in ${n} as possibly under 18. ` +
          "This tool only works with adult characters, so it stopped. " +
          "Remove that image (or fix the character config) and run again.",
      );
    }
  }
}

/** Settle who everyone in the pictures is, after the vision pass (fresh or cached). */
export function resolvePeople(analyses: Map<string, Analysis>, cfg: StoryConfig) {
  checkAdults(analyses);
  for (const a of analyses.values()) applyCast(a, cfg);
  const picks = new Map<string, Person | null>();
  for (const [n, a] of analyses) picks.set(n, standInPick(a));
  let reader = null;
  if (wantsStandIn(analyses, cfg)) {
    let name: string | null = STAND_INS.find((n) => cfg.byName(n) === null) ?? null;
    if (!name) {
      for (let i = 2; i < 100; i++) {
        if (cfg.byName(`You ${i}`) === null) {
          name = `You ${i}`;
          break;
        }
      }
    }
    reader = name ? cfg.addSpeaker(name, true) : null;
  }
  if (reader) {
    const anyPick = Array.from(picks.values()).some((p) => p !== null);
    reader.personality =
      (anyPick
        ? "the reader's stand-in: the unnamed man in some of the pictures; "
        : "the reader's stand-in, never seen: pictures are seen through his eyes; ") + "speaks rarely and briefly";
    for (const pick of picks.values()) if (pick !== null) pick.name = reader.name;
  }
  for (const a of analyses.values()) {
    applyCast(a, cfg);
    const taken = new Map<string, number>();
    for (const c of a.characters ?? []) {
      if (!truthy(c.id)) {
        const base = ({ male: "Man", female: "Woman" } as Record<string, string>)[c.gender] ?? "Stranger";
        let n = (taken.get(base) ?? 0) + 1;
        for (let k = 0; k < 99; k++) {
          if (cfg.byName(n === 1 ? base : `${base} ${n}`) === null) break;
          n += 1;
        }
        taken.set(base, n);
        c.name = n === 1 ? base : `${base} ${n}`;
      }
    }
  }
  return reader;
}

function readerSeen(chars: Person[], cfg: StoryConfig): boolean {
  const r = cfg.reader;
  return !!r && chars.some((c) => c.id === r.id && truthy(c.head_box));
}

function isPov(raw: Record<string, unknown>, chars: Person[], cfg: StoryConfig): boolean {
  const r = cfg.reader;
  if (!r) return false;
  if (raw.pov_shot === true) return true;
  if (readerSeen(chars, cfg)) return false;
  if (r.added) return !chars.some((c) => !truthy(c.id) && c.gender !== "female");
  return chars.length > 0 && chars.every((c) => truthy(c.id));
}

export type Beat = { beat: number; shot: string; focus: string; reason?: string; beat_text?: string };

export async function analyseImages(
  client: ModelClient,
  model: string,
  cfg: StoryConfig,
  images: { name: string; bytes: Uint8Array }[],
  forModel: (img: { name: string; bytes: Uint8Array }, maxSide: number) => Promise<string>,
  useRefs = true,
  log: (s: string) => void = () => {},
  parallel = 1,
  /** images already looked at (a stopped run): reused, not sent again; `onEach` hears each new result */
  more: { known?: Map<string, Analysis>; onEach?: (name: string, a: Analysis) => void } = {},
): Promise<Map<string, Analysis>> {
  const refs = useRefs ? cfg.characters.filter((c) => c.reference) : [];
  const refB64: string[] = [];
  for (const c of refs) refB64.push(await forModel(c.reference!, 768));
  const prompt = buildVisionPrompt(cfg, refs.map((c) => c.name));
  // Up to `parallel` images are looked at at once. Results keep the folder's order, and
  // when several fail, the error of the earliest image is the one reported.
  const n = images.length;
  const out: Analysis[] = new Array(n);
  let next = 0;
  let finished = 0;
  const fail: { first: { i: number; e: unknown } | null } = { first: null };
  images.forEach((img, i) => {
    const a = more.known?.get(img.name);
    if (a) out[i] = a;
  });
  finished = out.filter(Boolean).length;
  if (finished) log(`  vision ${finished}/${n}: reusing ${finished} images looked at before`);
  const worker = async () => {
    for (;;) {
      if (fail.first) return;
      const i = next++;
      if (i >= n) return;
      if (out[i]) continue;
      const img = images[i]!;
      const t0 = Date.now();
      try {
        let raw = await client.chatJson(model, VISION_SYSTEM, prompt, [...refB64, await forModel(img, 1280)], ANALYSIS_SCHEMA, 0.2);
        if (Array.isArray(raw)) raw = { characters: raw };
        const res = normalizeAnalysis(raw, cfg);
        checkAdults(new Map([[img.name, res]]));
        out[i] = res;
        more.onEach?.(img.name, res);
      } catch (e) {
        // another image may have failed while this one was waiting
        const prev = fail.first as { i: number; e: unknown } | null;
        if (!prev || i < prev.i) fail.first = { i, e };
        return;
      }
      finished++;
      log(`  vision ${finished}/${n}: ${img.name}`);
      log(`[TIME] Image ${i + 1} vision analysis (${img.name}): ${secs(Date.now() - t0)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(Math.trunc(parallel) || 1, n)) }, worker));
  if (fail.first) throw fail.first.e;
  const results = new Map<string, Analysis>();
  images.forEach((img, i) => results.set(img.name, out[i]!));
  return results;
}

/** 12345 ms -> "12.3s" */
export function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function beatNote(b: Beat | undefined): string {
  if (!b || !b.beat) return "";
  let text = `; beat ${b.beat}`;
  if (b.beat_text) text += `: ${b.beat_text}`;
  if (b.shot) text += ` (${b.shot})`;
  return text;
}

export function listingLine(n: string, a: Analysis, extra = ""): string {
  return (
    `- ${n}: [${a.importance}] ${a.scene_summary} (characters: ` +
    `${a.characters.map((c) => c.name).join(", ") || "none"}; mood: ${a.mood}` +
    `${a.pov_shot ? "; POV shot" : ""}${extra})`
  );
}

export async function planOrder(
  client: ModelClient,
  model: string,
  analyses: Map<string, Analysis>,
  log: (s: string) => void = () => {},
  storyContext = "",
  beats: Map<string, Beat> = new Map(),
): Promise<[string[], Map<string, number>, string]> {
  const names = Array.from(analyses.keys());
  const listing = Array.from(analyses, ([n, a]) => listingLine(n, a, beatNote(beats.get(n)))).join("\n");
  const context = storyContext ? `\nPlanned story outline: ${storyContext}\nFollow this outline's beat order.\n` : "";
  const prompt = `These images will become one manga chapter. Current file order:
${listing}
${context}
Return JSON with:
- order: every filename exactly once, in the best reading order for a coherent story
  (build-up first, climax near the end, aftermath last). Keep the file order where it already makes sense.
- importance: object mapping filename -> 1-5 (5 = climax/key moment). Adjust the bracketed
  first-pass scores only when the story context changes them. Use 5 sparingly.
- story_notes: two or three sentences describing the story arc.`;
  log("  planning reading order");
  const raw = await client.chatJson(model, "You are a manga editor. Answer with one JSON object.", prompt, null, ORDER_SCHEMA, 0.3);
  return validateOrder(raw, names, analyses);
}

export function validateOrder(raw: unknown, names: string[], analyses: Map<string, Analysis>): [string[], Map<string, number>, string] {
  const r = isDict(raw) ? raw : null;
  const orderIn = r && "order" in r ? r.order : [];
  const order: string[] = [];
  const seen = new Set<string>();
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
  for (const n of Array.isArray(orderIn) ? orderIn : []) {
    const key = lower.get(pyStrip(pyStr(n)).toLowerCase());
    if (key && !seen.has(key)) {
      order.push(key);
      seen.add(key);
    }
  }
  for (const n of names) if (!seen.has(n)) order.push(n);
  const imp = new Map(names.map((n) => [n, analyses.get(n)!.importance]));
  if (r && isDict(r.importance)) {
    for (const [n, v] of Object.entries(r.importance)) {
      const key = lower.get(pyStrip(pyStr(n)).toLowerCase());
      try {
        if (key) {
          const x = pyRound(pyFloat(v));
          if (!Number.isFinite(x)) throw new Error("nan");
          imp.set(key, Math.max(1, Math.min(5, x)));
        }
      } catch {
        /* keep the first-pass score */
      }
    }
  }
  const notes = r && "story_notes" in r ? pyStr(r.story_notes) : "";
  return [order, imp, notes];
}
