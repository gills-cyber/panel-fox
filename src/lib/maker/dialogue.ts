/** Dialogue pass: write the script a few pages at a time, keeping continuity. */
import { ROLE_WORDS, nameWords, type Character, type StoryConfig } from "./config.ts";
import type { ScriptLine } from "./bubbles.ts";
import type { Page, Panel } from "./layout.ts";
import type { ModelClient } from "./ollama.ts";
import { isDict, maxBy, plen, pslice, pyRe, pyRound, pySplit, pyStr, pyStrip, squash, truthy } from "./py.ts";
import type { Analysis, Beat, Person } from "./vision.ts";

export const KINDS = ["speech", "thought", "narration", "shout", "whisper", "scream"];
const KIND_ALIASES: Record<string, string> = {
  say: "speech", says: "speech", dialogue: "speech", talk: "speech", line: "speech",
  think: "thought", thinking: "thought", monologue: "thought", inner: "thought",
  caption: "narration", narrator: "narration", box: "narration",
  yell: "shout", exclaim: "shout", sfx: "shout", moan: "whisper",
  murmur: "whisper", soft: "whisper", cry: "scream", scream: "scream",
};

export const SCRIPT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          panel_id: { type: "string" },
          speaker: { type: "string" },
          kind: { type: "string", enum: [...KINDS] },
          text: { type: "string" },
        },
        required: ["panel_id", "speaker", "kind", "text"],
      },
    },
    summary: { type: "string" },
  },
  required: ["lines", "summary"],
};

export const DIALOGUE_SYSTEM = `You are the writer for an adult hentai manga. Every character is a consenting adult aged 18 or older; never describe or imply anyone as underage.

Write the script in the genre's style: direct, physical and character-driven. Use short, punchy lines that fit in speech bubbles. Prefer plain, explicit wording over soft or flowery language, and let reactions, desire and sensation come through each character's own voice. Mix spoken lines with inner thoughts, short narration captions and the occasional shout, whisper or scream where the image calls for it.

Keep every character's voice consistent with their personality notes across the whole chapter. The story must flow continuously from panel to panel and page to page; pick up exactly where the previous part left off.

Only characters who are visible in a panel speak or think in it, unless a line is clearly an off-panel voice. Narration uses speaker "narrator". Give every line to the person who actually says it: someone calling a character's name is someone else, not that character.

Every line must be new. Never repeat a line, or the same words, from earlier in the chapter, and never repeat words that are already drawn in the picture.

Never describe anyone as under 18 (no schoolgirl, high schooler, little girl or the like). Everyone is an adult;
college, university and adult students are fine.

Answer with one JSON object only.`;

export function maxLinesFor(panel: Panel, analysis?: Analysis | null): number {
  const area = (panel.w * panel.h) / 100.0;
  let n = Math.max(1, Math.min(5, pyRound(1 + area / 20)));
  if (analysis && truthy(analysis.art_text)) n = Math.max(1, n - 1);
  return n;
}

export function maxCharsFor(panel: Panel): number {
  const area = (panel.w * panel.h) / 100.0;
  return Math.trunc(Math.min(120, Math.max(30, pyRound(20 + area * 2.2))));
}

function person(c: Person): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["name", "pose", "action", "expression", "clothing_state"]) out[k] = c[k] ?? null;
  if (!truthy(c.id)) out.in_cast = false;
  return out;
}

function panelBrief(page: Page, panel: Panel, analysis: Analysis, importance: number, beat?: Beat | null) {
  const b = (beat ?? {}) as Partial<Beat>;
  const view = (panel.view ?? {}) as Partial<{ label: string }>;
  const art = (analysis.art_text ?? []).filter((t) => truthy(t.text)).map((t) => t.text);
  const out: Record<string, unknown> = {
    panel_id: panel.id,
    page: page.title,
    image: panel.item.name,
    importance,
    max_lines: maxLinesFor(panel, analysis),
    max_chars: maxCharsFor(panel),
    setting: analysis.setting ?? "",
    scene: analysis.scene_summary ?? "",
    mood: analysis.mood ?? "",
    characters: (analysis.characters ?? []).map(person),
  };
  if (truthy(analysis.pov_shot)) out.pov_shot = true;
  if (truthy(analysis.reader_visible)) out.reader_visible = true;
  if (art.length) out.text_in_art = art;
  if (truthy(b.beat_text)) out.beat = b.beat_text;
  if (truthy(b.shot)) out.shot = b.shot;
  if (truthy(view.label)) out.framed_on = view.label;
  return out;
}

export function readerRules(cfg: StoryConfig): string {
  const r = cfg.reader;
  if (!r) return "";
  let who: string;
  let he: string;
  let his: string;
  if (r.added) {
    who =
      `The reader: a man listed as "${r.name}" (use speaker "${r.name}" for his lines). He is the unnamed\n` +
      `man in the pictures that show one; pictures with no man in them are seen through his eyes.\n` +
      `The reader experiences the story as him.`;
    he = "he";
    his = "his";
  } else {
    who = `The reader: ${r.name} is the reader's stand-in, so the reader experiences the story as ${r.name}.`;
    he = r.name;
    his = `${r.name}'s`;
  }
  const cap = Array.from(he);
  const He = (cap[0] ?? "").toUpperCase() + cap.slice(1).join("");
  return `
${who}
- Other characters speak directly to the reader: they call ${r.added ? "him" : r.name} "you", never by
  a name or in the third person.
- Narration and ${his} inner thoughts are in second person ("You feel…", "Your heart pounds…").
- ${He} speaks rarely and briefly, if at all; the other characters carry the dialogue.
- Panels marked "pov_shot" are seen through ${his} eyes: ${he} is not visible there, and the
  other characters look at and talk to "you". Panels marked "reader_visible" show ${r.added ? "him" : r.name}
  in the scene; keep the same second-person voice there.
`;
}

export function buildDialoguePrompt(
  cfg: StoryConfig,
  storyNotes: string,
  summarySoFar: string,
  recentLines: ScriptLine[],
  briefs: Record<string, unknown>[],
  language: string,
): string {
  const cast = cfg.characters.map((c) => `- ${c.name}${c.pov ? " (the reader)" : ""}: ${c.personality || "no notes"}`).join("\n");
  const recent = recentLines.map((l) => `${l.speaker} (${l.kind}): ${l.text}`).join("\n") || "(this is the start)";
  const premise = cfg.premise ? `Premise: ${cfg.premise}\n` : "";
  return `${premise}Cast and personalities:
${cast}

${readerRules(cfg)}
Story arc: ${storyNotes || "(not given)"}
Story so far: ${summarySoFar || "(this is the start)"}
Lines written so far (do not repeat any of them):
${recent}

Write the script for these panels, in order (JSON):
${JSON.stringify(briefs, null, 1)}

Rules:
- Return "lines": a list of {"panel_id", "speaker", "kind", "text"} in reading order.
- "speaker" is a cast name, the name given for a person marked "in_cast": false (such as
  "Man"), or "narrator". "kind" is one of: ${KINDS.join(", ")}.
- Respect each panel's max_lines. Give high-importance panels the strongest lines.
- Where a panel gives "beat" (the story beat it serves) or "framed_on" (what the panel shows
  close up), write lines that fit that moment.
- Where a panel gives "text_in_art", those words are already drawn in the picture: do not
  repeat them in any line (a reaction to them is fine).
- Every line is new: never repeat a line from "Lines written so far" or from this answer.
- Keep each text within its panel's max_chars (small panels need short lines).
- Write in ${language}.
- Also return "summary": two or three sentences on what has happened so far, including these panels.`;
}

const NARRATOR_WORDS = new Set(["", "narrator", "narration", "none", "null", "n/a", "-", "–", "—", "caption", "narrative"]);
const READER_WORDS = new Set(["you", "reader", "the reader", "me", "i", "myself", "pov", "viewer", "the viewer"]);
const MAN_WORDS = new Set([
  "man", "the man", "guy", "the guy", "boyfriend", "him", "he", "male", "stranger",
  "unknown", "unknown man", "unnamed man", "the unnamed man", "partner", "lover", "someone",
  "voice", "off-panel voice", "unnamed person", "unknown person", "boy",
]);
const VAGUE_WORDS = ["unknown", "unnamed", "the", "a", "an", "off-panel", "offscreen", "off-screen", "person"];
const ROLE_LABELS: Record<string, string> = {
  boy: "Man", girl: "Woman", lady: "Woman", guy: "Man", dude: "Man",
  student: "Stranger", kid: "Stranger", child: "Stranger",
};

export const YOUTH = pyRe(
  "\\b(school[\\s-]?(girl|boy)\\w*|school[\\s-]?uniforms?|" +
    "(high|middle|elementary|junior[\\s-]high)[\\s-]?school[\\s-]?(girl|boy|student|kid)s?|" +
    "(high|middle|elementary)[\\s-]?schoolers?|minors|" +
    "((?<!\\bin\\s)\\b(a|the)|\\b(she|he|i|you)\\s*(['’]s|['’]m|['’]re|\\s+is|\\s+am|\\s+are|\\s+was|\\s+were))\\s+minor" +
    "(?!\\s+(?!(girls?|boys?|kids?|child|children|or|and|who|tonight|like|with|i|you|he|she|we|they)\\b)[a-z])|" +
    "minor\\s+(girls?|boys?|kids?|child|children)|minor,?\\s+or\\s+not|" +
    "pre-?teens?|young[\\s-]+teens?|underage\\w*|jail[\\s-]?bait|lolis?|lolita|(little|young)[\\s-]+(girl|boy)s?)\\b",
  "i",
);
const SENTENCE_END = /(?<=[.!?…~♥♡])\s+|(?<=[。！？])\s*|(?<=[!?…])(?=[぀-ヿ㐀-鿿])|\n+/u;
const SAID_SPLIT =
  /(?<=[.!?♥♡])(?<!\.\.\.)\s+|(?:(?<=\.\.\.)|(?<=[…~]))\s+(?![a-z])|(?<=[。！？])\s*|(?<=[!?…])(?=[぀-ヿ㐀-鿿])|\n+/u;
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/u;
const CJK_G = /[぀-ヿ㐀-䶿一-鿿가-힯]/gu;
const NON_WORD = pyRe("[^\\w\\s]", "g");

export function cleanText(text: string): string {
  const t = text.normalize("NFKC").toLowerCase().replace(/['’‘]/g, "");
  return squash(t.replace(NON_WORD, " "));
}

export function sentences(text: string): string[] {
  return text
    .split(SENTENCE_END)
    .filter((p) => p)
    .map(cleanText)
    .filter((p) => p);
}

export function counts(sentence: string): boolean {
  if (pySplit(sentence).length >= 2 || plen(sentence) >= 8) return true;
  return (
    CJK.test(sentence) &&
    (plen(sentence.replace(/ /g, "")) >= 5 || (sentence.match(/[㐀-䶿一-鿿]/gu) ?? []).length >= 3)
  );
}

export function walkOnLabel(name: string): string {
  const words = pySplit(name.replace(/\([^)]*\)|\[[^\]]*\]/g, " ")).filter(
    (w) => !VAGUE_WORDS.includes(pyStrip(w.toLowerCase(), ".,:;!?")),
  );
  const label = pslice(pyStrip(words.slice(0, 3).join(" "), " .,:;!?\"'"), 0, 24);
  if (!label || ["someone", "voice", "?"].includes(label.toLowerCase())) return "Voice";
  if (Object.hasOwn(ROLE_LABELS, label.toLowerCase())) return ROLE_LABELS[label.toLowerCase()]!;
  if (YOUTH.test(label)) return "Stranger";
  const cps = Array.from(label);
  return cps[0]!.toUpperCase() + cps.slice(1).join("");
}

const PLAIN_LABEL = /^(?:(man|woman|stranger)( \d+)?|voice)$/i;
const MALE_WORDS = new Set([
  "man", "men", "male", "guy", "guys", "boy", "boys", "boyfriend", "husband", "gentleman", "dude",
  "father", "dad", "brother", "son", "uncle", "sir", "mr", "he", "him", "waiter", "king",
]);
const FEMALE_WORDS = new Set([
  "woman", "women", "female", "girl", "girls", "lady", "ladies", "girlfriend", "wife", "mother",
  "mom", "sister", "daughter", "aunt", "miss", "mrs", "ms", "she", "waitress", "queen", "gal",
]);
const GROUP_WORDS = new Set([
  "voices", "crowd", "everyone", "all", "both", "group", "sfx", "sound", "effect", "people", "chorus",
  "null", "none", "others", "thoughts", "thought", "monologue", "text", "sign", "caption", "voice",
  "someone", "somebody", "phone", "tv", "radio", "intercom", "pov",
]);
const PERSON_WORDS = new Set([
  "man", "men", "woman", "women", "stranger", "person", "people", "someone", "somebody", "guy",
  "guys", "girl", "girls", "boy", "boys", "lady", "ladies", "gentleman", "dude", "gal", "voice",
  "voices",
]);
const HAS_W = pyRe("\\w");

function headArea(c: Person): number {
  const hb = c.head_box;
  return hb ? (hb[2]! - hb[0]!) * (hb[3]! - hb[1]!) : 0.0;
}

function intersects(a: Set<string>, b: Set<string>) {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/** Tie a walk-on speaker to a person in the panel the cast does not include, so the tail points at them. */
function claimPerson(analysis: Analysis, member: Character, anyHead = true): void {
  const chars = analysis.characters ?? [];
  if (chars.some((c) => c.id === member.id)) return;
  let free = chars.filter((c) => !truthy(c.id));
  if (!free.length) return;
  const named = free.filter((c) => pyStr(c.name ?? "").toLowerCase() === member.name.toLowerCase());
  if (!named.length && (!anyHead || PLAIN_LABEL.test(pyStrip(member.name)))) return;
  if (!named.length) {
    const words = new Set(member.name.toLowerCase().match(/[a-z]+/g) ?? []);
    if (intersects(words, GROUP_WORDS) || !HAS_W.test(member.name)) return;
    if (intersects(words, MALE_WORDS)) free = free.filter((c) => c.gender !== "female");
    if (intersects(words, FEMALE_WORDS)) free = free.filter((c) => c.gender !== "male");
    if (!free.length) return;
  }
  const p = named.length ? named[0]! : maxBy(free, headArea);
  p.id = member.id;
}

function callsOwnName(text: string, char: Character): boolean {
  const words = nameWords(text.replace(pyRe("[^\\w\\s'-]", "g"), " "));
  const mine = new Set(nameWords(char.name));
  return words.length > 0 && mine.size > 0 && words.every((w) => mine.has(w));
}

/** The cast member (or reader stand-in, or walk-on) who says a line; null for narration. */
function resolveSpeaker(nameIn: string, text: string, cfg: StoryConfig, analysis: Analysis): Character | null {
  const name = nameIn.replace(/['’]s(\s+(inner\s+)?(thoughts?|voice|mind|monologue)(\s+bubble)?)?$/iu, "");
  const low = pyStrip(squash(name.toLowerCase().replace(/\([^)]*\)/g, " ")), " .,:;");
  if (NARRATOR_WORDS.has(low)) return null;
  const r = cfg.reader;
  let char = cfg.byName(name, false);
  const charsHere = analysis.characters ?? [];
  if (
    char !== null && char.added && !char.pov && r && r.added && MAN_WORDS.has(low) &&
    !charsHere.some((c) => c.id === char!.id || (!truthy(c.id) && pyStr(c.name ?? "").toLowerCase() === low))
  ) {
    char = r;
  }
  if (char === null && r && READER_WORDS.has(low)) char = r;
  if (char === null) {
    const labelled = charsHere.find((c) => !truthy(c.id) && pyStr(c.name ?? "").toLowerCase() === low);
    if (labelled) char = cfg.addSpeaker(labelled.name, false, false);
  }
  const words = new Set(nameWords(name));
  const roleOrVague = new Set([...ROLE_WORDS, ...VAGUE_WORDS]);
  const vague = [...words].every((w) => roleOrVague.has(w)) && intersects(words, PERSON_WORDS);
  if (char === null) {
    char = cfg.byName(name);
    if (char && vague) {
      const rest = nameWords(char.name).filter((w) => !VAGUE_WORDS.includes(w));
      if (!rest.every((w) => words.has(w))) {
        const toks = new Set(name.toLowerCase().match(pyRe("[\\w-]+", "g")) ?? []);
        const bare = !VAGUE_WORDS.some((w) => toks.has(w));
        if (!(bare && charsHere.some((c) => c.id === char!.id))) char = null;
      }
    }
  }
  if (char === null && r && r.added && MAN_WORDS.has(low)) char = r;
  if (char === null) char = cfg.addSpeaker(walkOnLabel(name), false, !vague);
  if (!(char.pov && char.added) && callsOwnName(text, char)) {
    const here = new Set(charsHere.filter((c) => truthy(c.id)).map((c) => c.id!));
    const others = cfg.characters.filter((c) => here.has(c.id) && c.id !== char!.id);
    if (r && r.id !== char.id && here.has(r.id)) char = r;
    else if (others.length === 1) char = others[0]!;
    else if (r && r.id !== char.id) char = r;
    else if (!others.length && charsHere.some((c) => !truthy(c.id) && truthy(c.name))) {
      const free = charsHere.filter((c) => !truthy(c.id) && truthy(c.name));
      const big = maxBy(free, headArea);
      char = cfg.addSpeaker(big.name, false, false);
    } else char = cfg.addSpeaker("Voice");
  }
  if (char.added && !char.pov) {
    const castWords = new Set<string>();
    for (const c of cfg.characters) if (!c.added) for (const w of nameWords(c.name)) if (!ROLE_WORDS.has(w)) castWords.add(w);
    claimPerson(analysis, char, !intersects(new Set(nameWords(char.name)), castWords));
  }
  return char;
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Take sentences said before, or drawn in the art, out of a line. Returns the rest and why a whole line goes. */
function dropSaid(text: string, said: Set<string>, art: Set<string>): [string, string] {
  const pieces = text
    .split(SAID_SPLIT)
    .filter((p) => p && pyStrip(p))
    .map((p) => pyStrip(p));
  const why: string[] = pieces.map((p) => {
    const c = cleanText(p);
    return c && art.has(c) ? "art" : c && counts(c) && said.has(c) ? "repeat" : "";
  });
  const gone = why.filter((w) => w);
  if (!gone.length) return [text, ""];
  const keep: string[] = [];
  pieces.forEach((p, i) => {
    if (why[i] || !cleanText(p.replace(/\([^)]*\)|\*[^*]*\*/g, " "))) return;
    const lead = pySplit(cleanText(p));
    if (/(\.{2,}|…)$/u.test(p) && i + 1 < pieces.length && why[i + 1]) {
      const next1 = pySplit(cleanText(pieces[i + 1]!)).slice(0, lead.length);
      const next2 = pySplit(cleanText(pieces[i + 1]!.replace(pyRe("(?<=\\w)['’]\\w+", "g"), ""))).slice(0, lead.length);
      if (sameList(lead, next1) || sameList(lead, next2)) return;
    }
    keep.push(p);
  });
  if (!keep.length) return [text, new Set(gone).size === 1 && gone[0] === "art" ? "art" : "repeat"];
  const rest = pyStrip(keep.map((p) => p + ("。！？".includes(Array.from(p).pop()!) ? "" : " ")).join(""));
  return [rest.replace(/^([」』）)”]|"(?=[^"]*$))+\s*/u, "") || rest, ""];
}

/** A tuple key in the said set: (panel id, cleaned text). */
export function tupleKey(pid: string, key: string) {
  return `\u0000${pid}\u0000${key}`;
}

/** Clean the model's lines (see the Python original for the rules). */
export function normalizeLines(
  raw: unknown,
  cfg: StoryConfig,
  pagePanels: Map<string, [Panel, Page]>,
  analysesByPanel: Map<string, Analysis>,
  saidIn: Set<string> | null = null,
  log?: (s: string) => void,
): ScriptLine[] {
  const said = saidIn ?? new Set<string>();
  const linesIn = isDict(raw) ? ("lines" in raw ? raw.lines : []) : Array.isArray(raw) ? raw : [];
  const out: (ScriptLine & { _i: number })[] = [];
  const perPanel = new Map<string, number>();
  const order = Array.from(pagePanels.keys());
  const dropped = { repeat: 0, art: 0, youth: 0 };
  for (const l of Array.isArray(linesIn) ? linesIn : []) {
    if (!isDict(l)) continue;
    const pid = pyStrip(pyStr("panel_id" in l ? l.panel_id : ""));
    if (!pagePanels.has(pid)) continue;
    let text = squash(pyStr("text" in l ? l.text : ""));
    if (!text) continue;
    if (plen(text) > 180) {
      const cps = Array.from(text);
      let cut = -1;
      for (let i = Math.min(180, cps.length) - 1; i >= 0; i--) {
        if (".!?…".includes(cps[i]!)) {
          cut = i;
          break;
        }
      }
      text = cut > 60 ? cps.slice(0, cut + 1).join("") : `${cps.slice(0, 177).join("")}…`;
    }
    const analysis = analysesByPanel.get(pid)!;
    if (YOUTH.test(text)) {
      dropped.youth++;
      continue;
    }
    const artTexts = (analysis.art_text ?? []).map((t) => (t.text ?? "") as string);
    const art = new Set(artTexts.map(cleanText));
    if (art.has(cleanText(text))) {
      dropped.art++;
      continue;
    }
    const artAll = new Set(art);
    for (const t of artTexts) for (const x of sentences(t)) artAll.add(x);
    const kept = dropSaid(text, said, artAll);
    text = kept[0];
    const why = kept[1];
    if (why) {
      dropped[why as "repeat" | "art"]++;
      continue;
    }
    const sents = sentences(text);
    const longOnes = sents.filter(counts);
    const key = cleanText(text);
    if ((longOnes.length && longOnes.every((x) => said.has(x))) || said.has(tupleKey(pid, key))) {
      dropped.repeat++;
      continue;
    }
    const [panel] = pagePanels.get(pid)!;
    if ((perPanel.get(pid) ?? 0) >= maxLinesFor(panel, analysis)) continue;
    let kind = pyStrip(pyStr("kind" in l ? l.kind : "speech")).toLowerCase();
    kind = KINDS.includes(kind) ? kind : Object.hasOwn(KIND_ALIASES, kind) ? KIND_ALIASES[kind]! : "speech";
    const ch = kind === "narration" ? null : resolveSpeaker(pyStrip(pyStr("speaker" in l ? l.speaker : "")), text, cfg, analysis);
    if (ch === null) kind = "narration";
    perPanel.set(pid, (perPanel.get(pid) ?? 0) + 1);
    for (const x of longOnes) said.add(x);
    said.add(tupleKey(pid, key));
    out.push({
      panel_id: pid,
      speaker_id: ch ? ch.id : null,
      speaker: ch ? ch.name : "narrator",
      kind,
      text,
      id: "",
      _i: out.length,
    });
  }
  out.sort((a, b) => order.indexOf(a.panel_id) - order.indexOf(b.panel_id) || a._i - b._i);
  if (log && (dropped.repeat || dropped.art || dropped.youth)) {
    const parts = (
      [
        ["repeated", dropped.repeat],
        ["already in the art", dropped.art],
        ["youth wording", dropped.youth],
      ] as const
    )
      .filter(([, n]) => n)
      .map(([w, n]) => `${n} ${w}`);
    log(`  dropped ${parts.join(", ")}`);
  }
  return out.map(({ _i, ...l }) => l);
}

/** Every line so far; only the newest when a chapter is very long. */
function history(lines: ScriptLine[], maxChars = 12000): ScriptLine[] {
  const out: ScriptLine[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    const s = l.text + l.speaker;
    total += plen(s) + 3 * (s.match(CJK_G) ?? []).length + 16;
    if (total > maxChars) break;
    out.push(l);
  }
  return out.reverse();
}

export async function writeScript(
  client: ModelClient,
  model: string,
  cfg: StoryConfig,
  pages: Page[],
  analyses: Map<string, Analysis>,
  importance: Map<string, number>,
  storyNotes: string,
  pagesPerCall = 3,
  language = "English",
  temperature = 0.85,
  log: (s: string) => void = () => {},
  beats: Map<string, Beat> = new Map(),
): Promise<ScriptLine[]> {
  const all: ScriptLine[] = [];
  const said = new Set<string>();
  let summary = "";
  for (let start = 0; start < pages.length; start += pagesPerCall) {
    const chunk = pages.slice(start, start + pagesPerCall);
    const pagePanels = new Map<string, [Panel, Page]>();
    const byPanel = new Map<string, Analysis>();
    const briefs: Record<string, unknown>[] = [];
    for (const page of chunk) {
      for (const panel of page.panels) {
        const a = analyses.get(panel.item.name)!;
        pagePanels.set(panel.id, [panel, page]);
        byPanel.set(panel.id, a);
        briefs.push(panelBrief(page, panel, a, importance.get(panel.item.name) ?? 2, beats.get(panel.item.name)));
      }
    }
    for (const a of byPanel.values()) {
      for (const t of a.art_text ?? []) for (const x of sentences(t.text ?? "")) if (counts(x)) said.add(x);
    }
    log(`  dialogue: pages ${start + 1}-${start + chunk.length} of ${pages.length}`);
    const prompt = buildDialoguePrompt(cfg, storyNotes, summary, history(all), briefs, language);
    const t0 = Date.now();
    const raw = await client.chatJson(model, DIALOGUE_SYSTEM, prompt, null, SCRIPT_SCHEMA, temperature);
    log(`[TIME] Dialogue for pages ${start + 1}-${start + chunk.length}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const lines = normalizeLines(raw, cfg, pagePanels, byPanel, said, log);
    for (const l of lines) l.page_id = pagePanels.get(l.panel_id)![1].id;
    all.push(...lines);
    if (isDict(raw) && truthy(raw.summary)) summary = pyStr(raw.summary);
  }
  return all;
}
