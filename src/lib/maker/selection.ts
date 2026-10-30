/**
 * Story-first selection: sketch a rough outline from the premise and the
 * image summaries, then keep only the images that serve it, noting for each
 * the beat it serves, the kind of shot and what the panel should frame.
 */
import type { StoryConfig } from "./config.ts";
import { SHOTS, normalizeShot } from "./crop.ts";
import type { ModelClient } from "./ollama.ts";
import { clone, isDict, pslice, pyInt, pyStr, pyStrip, sortedBy, squash, truthy } from "./py.ts";
import { listingLine, type Analysis, type Beat } from "./vision.ts";

export const OUTLINE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    logline: { type: "string" },
    beats: { type: "array", items: { type: "string" } },
  },
  required: ["beats"],
};

export const SELECT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    keep: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          beat: { type: "integer" },
          shot: { type: "string", enum: [...SHOTS] },
          focus: { type: "string" },
          reason: { type: "string" },
        },
        required: ["file", "beat", "shot", "focus"],
      },
    },
    drop: {
      type: "array",
      items: {
        type: "object",
        properties: { file: { type: "string" }, reason: { type: "string" } },
        required: ["file"],
      },
    },
  },
  required: ["keep"],
};

const SYSTEM =
  "You are a manga story editor planning an adult chapter in which every character " +
  "is a consenting adult (18+). Answer with one JSON object.";

/** What the panel could frame: the vision focus first, then other regions and faces. */
/** What Python's `for x in value` walks over: list items, string characters, dict keys. */
export function iterate(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return Array.from(v);
  if (isDict(v)) return Object.keys(v);
  return [];
}

function framable(a: Analysis): string {
  const labels = [a.focus_label || "", ...(a.regions ?? []).map((r) => r.label ?? "")];
  if ((a.characters ?? []).some((c) => truthy(c.head_box))) labels.push("face");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const lb of labels) {
    if (lb && !seen.has(lb)) {
      seen.add(lb);
      out.push(lb);
    }
  }
  return out.join(", ");
}

function listing(analyses: Map<string, Analysis>, framing = false): string {
  return Array.from(analyses, ([n, a]) => {
    const f = framing ? framable(a) : "";
    return listingLine(n, a, framing && f ? `; can frame: ${f}` : "");
  }).join("\n");
}

export type Outline = { logline: string; beats: string[] };

export async function outline(
  client: ModelClient,
  model: string,
  cfg: StoryConfig,
  analyses: Map<string, Analysis>,
  log: (s: string) => void = () => {},
): Promise<Outline> {
  const cast = cfg.characters
    .map((c) => `- ${c.name}${c.pov ? " (the reader)" : ""}: ${c.personality || "no notes"}`)
    .join("\n");
  const prompt = `Premise: ${cfg.premise || "(none given: find the story in the images)"}
Cast:
${cast}

Available images (filename: [importance 1-5] summary):
${listing(analyses)}

Sketch a rough outline for ONE coherent chapter that these images could tell.
Return JSON with:
- logline: one sentence.
- beats: 4-10 short story beats in order (a few words each, no dialogue).
Not every image has to fit; build the strongest story, with a clear build-up, climax and ending.`;
  log("  sketching outline");
  const raw = await client.chatJson(model, SYSTEM, prompt, null, OUTLINE_SCHEMA, 0.6);
  const r = isDict(raw) ? raw : null;
  const beatsIn = r && truthy(r.beats) ? iterate(r.beats) : [];
  const beats = beatsIn.map((b) => pyStrip(pyStr(b))).filter((b) => b);
  return { logline: r && "logline" in r ? pyStr(r.logline) : "", beats: beats.slice(0, 12) };
}

export type SelectionInfo = {
  outline: Outline;
  kept: string[];
  beats: Record<string, Beat>;
  dropped: { file: string; reason: string }[];
};

export async function select(
  client: ModelClient,
  model: string,
  outline_: Outline,
  analyses: Map<string, Analysis>,
  maxImages: number | null = null,
  log: (s: string) => void = () => {},
): Promise<[string[], SelectionInfo]> {
  const names = Array.from(analyses.keys());
  const beats = outline_.beats.map((b, i) => `${i + 1}. ${b}`).join("\n");
  const limit = maxImages ? `Keep at most ${maxImages} images.` : "Keep as many as genuinely help the story.";
  const prompt = `Outline: ${outline_.logline ?? ""}
Beats:
${beats}

Images:
${listing(analyses, true)}

Choose the images that best tell this outline. Drop images that are redundant (near-duplicates
of a kept image), off-story, or weaker versions of the same moment. Always keep the strongest
climax image. ${limit}
Return JSON with:
- keep: list of {"file", "beat", "shot", "focus", "reason"} where
  beat = the beat number the image serves;
  shot = one of ${SHOTS.join(", ")} (its job in the story);
  focus = what the panel should frame for that beat, picked from the image's "can frame" list:
  the body part or the interaction for action and climax beats, the face for reactions
  and dialogue, the full body for establishing shots.
- drop: list of {"file", "reason"} for every image not kept.`;
  log("  selecting images");
  const raw = await client.chatJson(model, SYSTEM, prompt, null, selectSchema(names), 0.3);
  if (names.length && !modelPicks(raw, names).size) {
    log("  warning: the selection named none of the image files, so every image is kept");
  }
  const [kept, notes] = validateSelection(raw, names, analyses, maxImages);
  for (const note of Object.values(notes)) {
    const b = note.beat;
    note.beat_text = b >= 1 && b <= outline_.beats.length ? outline_.beats[b - 1]! : "";
  }
  const keptSet = new Set(kept);
  const dropped = names.filter((n) => !keptSet.has(n));
  const reasons = new Map<string, string>();
  const r = isDict(raw) ? raw : null;
  for (const d of r && truthy(r.drop) && Array.isArray(r.drop) ? r.drop : []) {
    const n = isDict(d) ? matchFile(d.file, names) : null;
    if (n) reasons.set(n, "reason" in (d as object) ? pyStr((d as Record<string, unknown>).reason) : "");
  }
  const info: SelectionInfo = {
    outline: outline_,
    kept,
    beats: notes,
    dropped: dropped.map((n) => ({ file: n, reason: reasons.get(n) ?? "" })),
  };
  log(`  kept ${kept.length} of ${names.length} images`);
  return [kept, info];
}

function note(k: unknown): Beat {
  if (!isDict(k)) return { beat: 0, shot: "", focus: "" };
  let beat = 0;
  try {
    beat = pyInt("beat" in k ? k.beat : 0);
  } catch {
    beat = 0;
  }
  const focus = pslice(squash(truthy(k.focus) ? pyStr(k.focus) : ""), 0, 60);
  return { beat, shot: normalizeShot(k.shot), focus, reason: pslice(truthy(k.reason) ? pyStr(k.reason) : "", 0, 200) };
}

/** SELECT_SCHEMA with the file names as the only allowed values for "file". */
export function selectSchema(names: string[]): Record<string, unknown> {
  if (!names.length || names.length > 400) return SELECT_SCHEMA;
  const schema = clone(SELECT_SCHEMA) as {
    properties: Record<string, { items: { properties: { file: Record<string, unknown> } } }>;
  };
  for (const key of ["keep", "drop"]) schema.properties[key]!.items.properties.file.enum = [...names];
  return schema as unknown as Record<string, unknown>;
}

function posixName(p: string): string {
  const parts = p.split("/").filter((x) => x !== "");
  return parts.length ? parts[parts.length - 1]! : "";
}

function stem(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** The image a model's file reference means: exact (any case), or without folder, quotes or extension. */
export function matchFile(value: unknown, names: string[]): string | null {
  const text = pyStrip(pyStrip(pyStrip(truthy(value) ? pyStr(value) : ""), "'\"`").replace(/\\/g, "/"));
  if (!text) return null;
  const key = pyStrip(posixName(text)).toLowerCase();
  for (const n of names) {
    const low = n.toLowerCase();
    if (low === text.toLowerCase() || low === key) return n;
  }
  const keyStem = stem(key);
  const stems = names.filter((n) => stem(posixName(n)).toLowerCase() === keyStem);
  return stems.length === 1 ? stems[0]! : null;
}

function modelPicks(raw: unknown, names: string[]): Map<string, Beat> {
  const picked = new Map<string, Beat>();
  const r = isDict(raw) ? raw : null;
  for (const k of r && truthy(r.keep) && Array.isArray(r.keep) ? r.keep : []) {
    const n = matchFile(isDict(k) ? k.file : k, names);
    if (n && !picked.has(n)) picked.set(n, note(k));
  }
  return picked;
}

/** (kept filenames in file order, {filename: beat note}). Never drops everything. */
export function validateSelection(
  raw: unknown,
  names: string[],
  analyses: Map<string, Analysis>,
  maxImages: number | null = null,
  minKeep = 3,
): [string[], Record<string, Beat>] {
  let picked = modelPicks(raw, names);
  const chosen = new Set(picked.keys());
  const imp = (n: string) => analyses.get(n)!.importance;
  const byImportance = sortedBy(names, (n) => -imp(n));
  const filler = (n: string): Beat => ({ beat: 0, shot: imp(n) >= 5 ? "climax" : "", focus: "", reason: "" });
  if (!picked.size) picked = new Map(names.map((n) => [n, filler(n)]));
  const top = names.length ? byImportance[0]! : null;
  if (top && imp(top) >= 5 && !Array.from(picked.keys()).some((n) => imp(n) >= 5)) picked.set(top, filler(top));
  for (const n of byImportance) {
    if (picked.size >= Math.min(minKeep, names.length)) break;
    if (!picked.has(n)) picked.set(n, filler(n));
  }
  if (maxImages && picked.size > maxImages) {
    const keepSet = sortedBy(Array.from(picked.keys()), (n) => [!chosen.has(n), -imp(n)]);
    picked = new Map(keepSet.slice(0, Math.max(maxImages, 1)).map((n) => [n, picked.get(n)!]));
  }
  const kept = names.filter((n) => picked.has(n));
  const out: Record<string, Beat> = {};
  for (const n of kept) out[n] = picked.get(n)!;
  return [kept, out];
}

/** Outline as story notes for ordering and dialogue. */
export function outlineNotes(info: SelectionInfo): string {
  const o = info.outline;
  const beats = o.beats.map((b, i) => `${i + 1}) ${b}`).join("; ");
  return ((o.logline ?? "") + (beats ? ` Beats: ${beats}` : "")).trim();
}
