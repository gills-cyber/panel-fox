/**
 * Test mode: an offline stand-in for Ollama that returns harmless placeholder
 * answers shaped like real model output, so layout, bubbles and the project
 * can be checked end to end without any models.
 */
import type { StoryConfig } from "./config.ts";
import { SCRIPT_SCHEMA } from "./dialogue.ts";
import type { ModelClient } from "./ollama.ts";
import { pyRe } from "./py.ts";
import { OUTLINE_SCHEMA, SELECT_SCHEMA } from "./selection.ts";
import { ANALYSIS_SCHEMA, ORDER_SCHEMA } from "./vision.ts";

type B = number[];

export function bodyRegions(cx: number, cy: number): Record<string, B> {
  const box = (x1: number, y1: number, x2: number, y2: number) => [Math.max(0, x1), Math.max(0, y1), Math.min(1000, x2), Math.min(1000, y2)];
  return {
    face: box(cx - 70, cy - 90, cx + 70, cy + 80),
    chest: box(cx - 110, cy + 100, cx + 110, cy + 250),
    hands: box(cx - 190, cy + 210, cx + 190, cy + 300),
    hips: box(cx - 120, cy + 280, cx + 120, cy + 420),
    "full body": box(cx - 200, cy - 100, cx + 200, cy + 560),
  };
}

const FOCUS_BY_NAME: [string, string][] = [
  ["hands", "hands"], ["climax", "hips"], ["embrace", "interaction"], ["talk", "face"], ["arrival", "full body"],
  ["morning", "full body"], ["glance", "chest"], ["closer", "chest"], ["key", "interaction"], ["after", "face"],
];

type MockPerson = Record<string, unknown> & { name: string; head_box: number[] };

export function mockFocus(name: string, chars: MockPerson[]): [string, B, { label: string; box: B }[]] {
  const low = name.toLowerCase();
  let label = FOCUS_BY_NAME.find(([w]) => low.includes(w))?.[1] ?? "chest";
  const parts = chars.map((c) => bodyRegions((c.head_box[0]! + c.head_box[2]!) / 2, c.head_box[1]! + 90));
  let focus: B;
  if (label === "interaction" && parts.length > 1) {
    const a = parts[0]!.chest!;
    const b = parts[1]!.hips!;
    focus = [Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.max(a[2]!, b[2]!), Math.max(a[3]!, b[3]!)];
  } else if (label === "interaction") {
    label = "hips";
    focus = parts[0]!.hips!;
  } else focus = parts[0]![label]!;
  const regions = Object.entries(parts[0]!)
    .filter(([k]) => k !== label && k !== "face")
    .map(([k, v]) => ({ label: k, box: v }))
    .slice(0, 4);
  return [label, focus, regions];
}

async function rng(seed: string): Promise<() => number> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)));
  let i = 0;
  return () => h[i++ % h.length]! / 255.0;
}

const MALE_NOTES = pyRe("\\b(he|his|him|man|guy)\\b");

export class MockClient implements ModelClient {
  cfg: StoryConfig;
  imageNames: string[] = [];
  private visionCalls = 0;

  constructor(cfg: StoryConfig) {
    this.cfg = cfg;
  }

  async checkModels(): Promise<string[]> {
    return [];
  }

  async chatJson(_model: string, _system: string, user: string, _images?: string[] | null, schema?: Record<string, unknown> | null): Promise<unknown> {
    if (schema === ANALYSIS_SCHEMA) return this.vision();
    if (schema === ORDER_SCHEMA) return this.order(user);
    if (schema === SCRIPT_SCHEMA) return this.dialogue(user);
    if (schema === OUTLINE_SCHEMA) {
      return { logline: "Placeholder outline (mock mode).", beats: ["meeting", "tension", "turning point", "climax", "aftermath"] };
    }
    const props = (schema?.properties ?? {}) as Record<string, unknown>;
    if (schema === SELECT_SCHEMA || "keep" in props) {
      const names = Array.from(user.matchAll(/^- (.+?): \[(\d)\]/gm), (m) => [m[1]!, m[2]!] as const);
      const keep = names.filter(([, imp], i) => i % 4 !== 1 || parseInt(imp, 10) >= 4).map(([n]) => n);
      return {
        keep: keep.map((n, i) => ({
          file: n,
          beat: Math.min(5, 1 + Math.floor((i * 5) / Math.max(1, keep.length))),
          reason: "mock",
          ...MockClient.shot(n),
        })),
        drop: names.filter(([n]) => !keep.includes(n)).map(([n]) => ({ file: n, reason: "mock: redundant" })),
      };
    }
    return {};
  }

  static shot(name: string): { shot: string; focus: string } {
    const low = name.toLowerCase();
    if (low.includes("climax")) return { shot: "climax", focus: "hips" };
    if (low.includes("glance") || low.includes("talk") || low.includes("after")) return { shot: "reaction", focus: "face" };
    if (low.includes("arrival") || low.includes("morning")) return { shot: "establishing", focus: "full body" };
    return { shot: "action", focus: "" };
  }

  private async vision(): Promise<unknown> {
    const name = this.visionCalls < this.imageNames.length ? this.imageNames[this.visionCalls]! : String(this.visionCalls);
    this.visionCalls++;
    const r = await rng(name);
    const cast = this.cfg.characters;
    const nChars = 1 + Math.trunc(r() * Math.min(2, cast.length));
    let chars: MockPerson[] = [];
    const start = Math.trunc(r() * cast.length);
    for (let k = 0; k < nChars; k++) {
      const c = cast[(start + k) % cast.length]!;
      const cx = nChars > 1 ? 250 + 500 * (k / Math.max(1, nChars - 1)) : 380 + r() * 240;
      const cy = 280 + r() * 200;
      const notes = `${c.personality} ${c.appearance}`.toLowerCase();
      chars.push({
        name: c.name, confidence: 0.9, is_adult: true,
        gender: MALE_NOTES.test(notes) ? "male" : "female",
        pose: "standing", action: "talking", expression: "focused", clothing_state: "dressed",
        head_box: [cx - 70, cy - 90, cx + 70, cy + 80], mouth: [cx, cy + 45],
      });
    }
    const low = name.toLowerCase();
    if (cast.length === 1 && ["embrace", "climax", "key"].some((w) => low.includes(w))) {
      const cx = chars[0]!.head_box[0]! < 430 ? 700 : 250;
      chars.push({
        name: "unknown", gender: "male", confidence: 0.6, is_adult: true,
        pose: "leaning in", action: "talking", expression: "intent", clothing_state: "dressed",
        head_box: [cx - 70, 200, cx + 70, 370], mouth: [cx, 325],
      });
    }
    let pov = false;
    const reader = this.cfg.reader;
    if (reader && r() < 0.4) {
      pov = true;
      const rest = chars.filter((c) => c.name !== reader.name);
      chars = rest.length
        ? rest
        : [cast.length > 1 ? { ...chars[0]!, name: cast.find((c) => !c.pov)!.name } : chars[0]!];
    }
    const importance = low.includes("climax") ? 5 : low.includes("key") ? 4 : 1 + Math.trunc(r() * 2.4);
    const [focusLabel, focusBox, regions] = mockFocus(name, chars);
    return {
      characters: chars, setting: "placeholder room", mood: "tense",
      scene_summary: `Placeholder scene for ${name}.`,
      importance, importance_reason: "mock",
      empty_regions: [[50, 40, 450, 200], [550, 800, 950, 960]],
      pov_shot: pov,
      focus_label: focusLabel, focus_box: focusBox, regions,
      art_text: [],
    };
  }

  private order(prompt: string): unknown {
    const names = Array.from(prompt.matchAll(/^- (.+?): \[\d\]/gm), (m) => m[1]!);
    return { order: names, story_notes: "Placeholder story arc (mock mode)." };
  }

  private dialogue(prompt: string): unknown {
    const m = /in order \(JSON\):\n([\s\S]*?)\n\nRules:/.exec(prompt);
    const briefs = (m ? JSON.parse(m[1]!) : []) as {
      panel_id: string; page: string; image: string; max_lines: number; pov_shot?: boolean; characters: { name: string }[];
    }[];
    const lines: Record<string, string>[] = [];
    const kinds = ["speech", "thought", "shout", "whisper", "scream"];
    for (const b of briefs) {
      const names = b.characters.map((c) => c.name);
      if (!names.length) names.push("narrator");
      lines.push({ panel_id: b.panel_id, speaker: "narrator", kind: "narration", text: `${b.page}, ${b.image}.` });
      const reader = this.cfg.reader;
      if (reader && b.pov_shot && b.max_lines > 1) {
        lines.push({ panel_id: b.panel_id, speaker: reader.name, kind: "speech", text: `(reader, off-panel) placeholder for ${b.panel_id}.` });
      }
      for (let k = 0; k < b.max_lines - 1; k++) {
        const spk = names[k % names.length]!;
        lines.push({ panel_id: b.panel_id, speaker: spk, kind: kinds[k % kinds.length]!, text: `${spk}: placeholder line ${k + 1} for ${b.panel_id}.` });
      }
    }
    return { lines, summary: `Mock summary through ${briefs.length ? briefs[briefs.length - 1]!.panel_id : "start"}.` };
  }
}
