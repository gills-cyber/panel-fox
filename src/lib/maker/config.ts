/** The cast: characters, the reader (POV), and matching names the writer uses to them. */
import { isNumericChar, isUpperChar, pyRe, pySplit, pyStrip } from "./py.ts";

export const PALETTE = ["#e4572e", "#2e86ab", "#a23b72", "#3bb273", "#f1a208", "#6c4ab6", "#118ab2", "#ef476f"];
export const READER_COLOR = "#4a90d9";

export class ConfigError extends Error {}

/** A reference photo: its file name and bytes. */
export type Photo = { name: string; bytes: Uint8Array };

export type Character = {
  id: string;
  name: string;
  personality: string;
  appearance: string;
  reference: Photo | null;
  age: number | null;
  color: string;
  /** the reader stand-in: dialogue addresses this character as "you" */
  pov: boolean;
  /** not in the config: the app added them (the reader stand-in, a walk-on speaker) */
  added: boolean;
};

export const HONORIFICS = ["san", "chan", "kun", "sama", "senpai", "sempai", "sensei", "tan", "dono", "nee", "nii"];
export const TITLES = ["miss", "mr", "mrs", "ms", "mister", "lady", "sir"];
const CJK_HONORIFICS = /(?<=.)(ちゃん|さん|くん|君|様|さま|先輩|先生|たん|殿)$/u;
const CJK_CHAR = /[぀-ヿ㐀-䶿一-鿿]/u;
// extra words that make a longer label someone else: "Old Man", "Hana and Taro"
export const ROLE_WORDS = new Set([
  "man", "men", "woman", "women", "stranger", "voice", "voices", "boy", "boys", "girl", "girls",
  "guy", "guys", "lady", "ladies", "gentleman", "dude", "gal", "person", "people", "someone",
  "somebody", "everyone", "crowd", "boyfriend", "girlfriend", "husband", "wife", "friend",
  "friends", "partner", "lover", "mom", "mother", "dad", "father", "sister", "brother", "son",
  "daughter", "aunt", "uncle", "boss", "teacher", "student", "fan", "fans", "kid", "child",
  "other", "another", "old", "young", "new", "first", "second", "third", "one", "two", "three",
  "thoughts", "thought", "narrator", "reader", "you", "me", "i", "he", "she", "him", "her",
  "his", "hers", "they", "them", "we", "us", "and", "or", "with", "to", "of",
]);

/** Full-width letters, accents and curly apostrophes made plain: "Zoë" -> "Zoe". Kana keep their marks. */
export function fold(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFKC")) {
    const base = Array.from(ch.normalize("NFKD"))
      .filter((x) => !/^\p{Mn}$/u.test(x))
      .join("");
    out += base && Array.from(base).every((x) => x.charCodeAt(0) < 128) ? base : ch;
  }
  return out.replace(/’/g, "'").replace(/‘/g, "'");
}

const WORD_SPLIT = /[\s_*/+–—]+/u;
const HAS_WORD = pyRe("\\w");

/** Name words without honorifics or titles: "Miss Hana-chan" -> ["hana"]. */
export function nameWords(text: string): string[] {
  const words: string[] = [];
  let t = fold(text);
  t = t.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  for (let w of pyStrip(t).toLowerCase().split(WORD_SPLIT)) {
    w = pyStrip(w, '.,!?:;"()[]');
    const parts = w.split("-");
    while (parts.length > 1 && HONORIFICS.includes(parts[parts.length - 1]!)) parts.pop();
    w = parts.join("-").replace(CJK_HONORIFICS, "");
    if (w && !TITLES.includes(w) && HAS_WORD.test(w)) words.push(w);
  }
  return words;
}

function sameWords(a: string[], b: string[]) {
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

function isSubset(a: Iterable<string>, b: Iterable<string>) {
  const s = new Set(b);
  for (const x of a) if (!s.has(x)) return false;
  return true;
}

export function slug(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "char";
}

/** One letter changed, added or left out ("usaki" for "uzaki"), in words of four letters or more. */
function oneOff(a: string, b: string): boolean {
  const A = Array.from(a);
  const Bs = Array.from(b);
  if (Math.min(A.length, Bs.length) < 4 || Math.abs(A.length - Bs.length) > 1) return false;
  if (A.length === Bs.length) return A.reduce((n, x, i) => n + (x !== Bs[i] ? 1 : 0), 0) === 1;
  const [short, long] = A.length < Bs.length ? [A, Bs] : [Bs, A];
  for (let i = 0; i < long.length; i++) {
    const cut = long.slice(0, i).concat(long.slice(i + 1));
    if (cut.join("") === short.join("")) return true;
  }
  return false;
}

function cjkPart(words: string[], mine: string[]): boolean {
  const a = words.join("");
  const b = mine.filter((w) => CJK_CHAR.test(w)).join("");
  return !!b && words.every((w) => CJK_CHAR.test(w)) && (a.includes(b) || b.includes(a));
}

/** A capitalised extra word in a label is someone's name, not a descriptor. */
function namedExtra(label: string, mine: Set<string>): boolean {
  if (label.toUpperCase() === label) return false;
  const raw = fold(label).replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  for (const w of raw.split(/[\s_*/+&,:;–—]+/u)) {
    const first = Array.from(w)[0] ?? "";
    const nw = first && isUpperChar(first) ? nameWords(w).slice(0, 1) : [];
    if (!nw.length || mine.has(nw[0]!) || /(ing|ly)$/.test(nw[0]!) || nw[0] === "inner" || nw[0] === "pov") continue;
    const w0 = nw[0]!;
    let near = false;
    for (const m of mine) {
      if (Array.from(w0).length === 1 ? m.startsWith(w0) : oneOff(w0, m)) {
        near = true;
        break;
      }
    }
    if (near) continue;
    return true;
  }
  return false;
}

export class StoryConfig {
  characters: Character[];
  title: string;
  premise: string;
  extra: Record<string, unknown>;

  constructor(characters: Character[], title = "", premise = "", extra: Record<string, unknown> = {}) {
    this.characters = characters;
    this.title = title;
    this.premise = premise;
    this.extra = extra;
  }

  get reader(): Character | null {
    return this.characters.find((c) => c.pov) ?? null;
  }

  /** The cast member a name refers to, or null when it is unclear (see the Python original). */
  byName(name: string, loose = true): Character | null {
    if (!name) return null;
    const key = pyStrip(name).toLowerCase();
    for (const c of this.characters) {
      if (c.name.toLowerCase() === key || c.id.toLowerCase() === key) return c;
    }
    const words = nameWords(key);
    if (!words.length) return null;
    let hits = this.characters.filter((c) => sameWords(nameWords(c.name), words));
    if (!hits.length && loose) {
      const cast = this.characters.filter((c) => !c.added);
      hits = cast.filter((c) => isSubset(words, nameWords(c.name)));
      if (!hits.length) hits = cast.filter((c) => this.fuller(words, c));
      if (!hits.length) hits = cast.filter((c) => cjkPart(words, nameWords(c.name)));
      if (!hits.length) {
        const ws = new Set(words);
        hits = cast.filter((c) => nameWords(c.name).some((w) => !ROLE_WORDS.has(w) && ws.has(w)));
        const n = hits.length;
        hits = hits.filter((c) => {
          if (n !== 1) return false;
          const union = Array.from(new Set([...words, ...nameWords(c.name)]));
          return this.fuller(union, c) && !namedExtra(name, new Set(nameWords(c.name)));
        });
      }
    }
    const fromCast = hits.filter((c) => !c.added);
    if (fromCast.length) hits = fromCast;
    return hits.length === 1 ? hits[0]! : null;
  }

  /** words hold all of c's name words plus at most two harmless extra words. */
  fuller(words: string[], c: Character): boolean {
    const mine = new Set(nameWords(c.name));
    if (!mine.size || !isSubset(mine, words)) return false;
    const extra = new Set(words.filter((w) => !mine.has(w)));
    const others = new Set<string>();
    for (const o of this.characters) {
      if (o !== c && (!o.added || o.pov)) for (const w of nameWords(o.name)) others.add(w);
    }
    if (extra.size > 2) return false;
    for (const w of extra) {
      if (ROLE_WORDS.has(w) || others.has(w) || Array.from(w).some(isNumericChar) || /['’]s?$/u.test(w)) return false;
    }
    return true;
  }

  /** Add someone the config does not list (a walk-on, or the reader stand-in) for this run only. */
  addSpeaker(name: string, reader = false, loose = true): Character {
    const found = this.byName(name, loose);
    if (found) return found;
    const taken = new Set(this.characters.map((c) => c.id));
    let cid = `char-${slug(name)}`;
    while (taken.has(cid)) cid += "-2";
    const color = reader ? READER_COLOR : PALETTE[this.characters.length % PALETTE.length]!;
    const member: Character = {
      id: cid, name, personality: "", appearance: "", reference: null, age: null,
      color, pov: reader, added: true,
    };
    this.characters.push(member);
    return member;
  }
}

/** One character as the app's cast list stores it. */
export type CastInput = {
  id?: string;
  name?: string;
  personality?: string;
  appearance?: string;
  description?: string;
  age?: number | string | null;
  color?: string;
  pov?: boolean;
  reader?: boolean;
  is_reader?: boolean;
  photo?: Photo | null;
};

export type ConfigInput = {
  characters: CastInput[];
  title?: string;
  premise?: string;
  [k: string]: unknown;
};

/** load_config(): check the cast and fill in ids and colours. */
export function loadConfig(raw: ConfigInput | CastInput[]): StoryConfig {
  const cfg: ConfigInput = Array.isArray(raw) ? { characters: raw } : raw;
  const charsRaw = cfg.characters ?? (cfg.cast as CastInput[] | undefined) ?? [];
  if (!charsRaw.length) throw new ConfigError("config has no characters");
  const chars: Character[] = [];
  const seen = new Set<string>();
  charsRaw.forEach((c, i) => {
    const name = pyStrip(c.name || "");
    if (!name) throw new ConfigError(`character #${i + 1} has no name`);
    let age: number | null = null;
    if (c.age !== undefined && c.age !== null) {
      const n = typeof c.age === "number" ? Math.trunc(c.age) : /^\s*[+-]?\d+\s*$/.test(c.age) ? parseInt(c.age, 10) : NaN;
      if (Number.isNaN(n)) throw new ConfigError(`${name}: age must be a number`);
      if (n < 18) throw new ConfigError(`${name}: every character must be an adult (18+); got age ${n}`);
      age = n;
    }
    let cid = c.id || `char-${slug(name)}`;
    while (seen.has(cid)) cid += "-2";
    seen.add(cid);
    chars.push({
      id: cid,
      name,
      personality: pyStrip(c.personality || ""),
      appearance: pyStrip(c.appearance || c.description || ""),
      reference: c.photo ?? null,
      age,
      color: c.color || PALETTE[i % PALETTE.length]!,
      pov: Boolean(c.pov || c.is_reader || c.reader),
      added: false,
    });
  });
  if (chars.filter((c) => c.pov).length > 1) throw new ConfigError("only one character can be the reader (POV)");
  const known = new Set(["characters", "cast", "title", "premise"]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) if (!known.has(k)) extra[k] = v;
  return new StoryConfig(chars, (cfg.title as string) ?? "", (cfg.premise as string) ?? "", extra);
}

export { pySplit };
