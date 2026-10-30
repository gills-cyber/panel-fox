/**
 * Small helpers that behave like the Python built-ins the Manga Maker engine
 * was first written with, so the TypeScript engine makes the same chapters:
 * Python's round() (half to even on the exact value), math.fsum, int() and
 * float() parsing, truthiness, and Unicode-aware regex pieces (\w, \b).
 */

/** Python's round(x, nd): exact decimal value, ties to even. */
export function pyRound(x: number, nd = 0): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const neg = x < 0;
  const a = Math.abs(x);
  if (a >= 1e21) return x;
  const s = a.toFixed(100);
  const dot = s.indexOf(".");
  const ip = s.slice(0, dot);
  const fp = s.slice(dot + 1);
  const keep = fp.slice(0, nd);
  const rest = fp.slice(nd);
  let up = false;
  const first = rest.charCodeAt(0) - 48;
  if (first > 5) up = true;
  else if (first === 5) {
    if (/[1-9]/.test(rest.slice(1))) up = true;
    else {
      const digits = ip + keep;
      const last = digits.charCodeAt(digits.length - 1) - 48;
      up = last % 2 === 1;
    }
  }
  let n = BigInt(ip + keep);
  if (up) n += 1n;
  let str = n.toString();
  if (nd > 0) {
    str = str.padStart(nd + 1, "0");
    str = `${str.slice(0, str.length - nd)}.${str.slice(str.length - nd)}`;
  }
  const r = parseFloat(str);
  return neg ? -r : r;
}

/** math.fsum: the correctly rounded sum (Shewchuk / CPython msum). */
export function fsum(values: Iterable<number>): number {
  const partials: number[] = [];
  let special = 0;
  for (let x of values) {
    if (!Number.isFinite(x)) {
      special += x;
      continue;
    }
    let i = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  if (special) return special;
  let n = partials.length;
  let hi = 0;
  if (n > 0) {
    hi = partials[--n]!;
    let lo = 0;
    while (n > 0) {
      const x = hi;
      const y = partials[--n]!;
      hi = x + y;
      const yr = hi - x;
      lo = y - yr;
      if (lo) break;
    }
    if (n > 0 && ((lo < 0 && partials[n - 1]! < 0) || (lo > 0 && partials[n - 1]! > 0))) {
      const y = lo * 2;
      const x = hi + y;
      const yr = x - hi;
      if (y === yr) hi = x;
    }
  }
  return hi;
}

export class PyValueError extends Error {}

/** Python int(v): bools, whole-number strings, floats (truncated). Throws like Python. */
export function pyInt(v: unknown): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new PyValueError("cannot convert");
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const t = v.trim().replace(/_/g, "");
    if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
  }
  throw new PyValueError(`invalid literal for int(): ${String(v)}`);
}

/** Python float(v). Throws like Python. */
export function pyFloat(v: unknown): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase().replace(/_/g, "");
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(t)) return parseFloat(t);
    if (/^[+-]?(inf|infinity)$/.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
    if (/^[+-]?nan$/.test(t)) return NaN;
  }
  throw new PyValueError(`could not convert to float: ${String(v)}`);
}

/** Python truthiness. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (typeof v === "number" && Number.isNaN(v)) return true;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map || v instanceof Set) return v.size > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/** `v or []` for list-valued fields. */
export function list<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) && v.length ? (v as T[]) : [];
}

export function isNum(v: unknown): v is number {
  return typeof v === "number";
}

/** Python str() of a value as the engine uses it (strings, numbers, bools, None). */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "string") return v;
  if (typeof v === "number") return pyNumStr(v);
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function pyNumStr(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e16) return String(v);
  return String(v);
}

/** str(v or "") */
export function orStr(v: unknown): string {
  return truthy(v) ? pyStr(v) : "";
}

/** Python " ".join(s.split()) */
export function squash(s: string): string {
  return pySplit(s).join(" ");
}

/** Python str.split() with no arguments. */
export function pySplit(s: string): string[] {
  // eslint-disable-next-line no-control-regex
  const t = s.split(/[\s\x1c-\x1f\x85]+/u);
  return t.filter((w) => w.length > 0);
}

/** Python str.strip(chars) (no chars: whitespace). */
export function pyStrip(s: string, chars?: string): string {
  // eslint-disable-next-line no-control-regex
  if (chars === undefined) return s.replace(/^[\s\x1c-\x1f\x85]+|[\s\x1c-\x1f\x85]+$/gu, "");
  const set = new Set(Array.from(chars));
  const cps = Array.from(s);
  let a = 0;
  let b = cps.length;
  while (a < b && set.has(cps[a]!)) a++;
  while (b > a && set.has(cps[b - 1]!)) b--;
  return cps.slice(a, b).join("");
}

/** len() in code points. */
export function plen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** s[a:b] in code points. */
export function pslice(s: string, a: number, b?: number): string {
  const cps = Array.from(s);
  return cps.slice(a, b).join("");
}

// Python's Unicode \w: letters, numbers and the underscore.
export const W = "[\\p{L}\\p{N}_]";
export const NW = "[^\\p{L}\\p{N}_]";
/** Python's \b for str patterns. */
export const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;

/** Build a Unicode regex from a Python-style pattern: \w, \W, \b and \d become Unicode-aware. */
export function pyRe(pattern: string, flags = ""): RegExp {
  let out = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\" && i + 1 < pattern.length) {
      const nx = pattern[i + 1]!;
      i++;
      if (nx === "w") out += inClass ? "\\p{L}\\p{N}_" : W;
      else if (nx === "W") out += inClass ? "" : NW;
      else if (nx === "b" && !inClass) out += B;
      else if (nx === "d") out += "\\p{Nd}";
      else out += `\\${nx}`;
      continue;
    }
    if (ch === "[" && !inClass) inClass = true;
    else if (ch === "]" && inClass) inClass = false;
    out += ch;
  }
  return new RegExp(out, flags.includes("u") ? flags : `${flags}u`);
}

/** The first element with the largest key (Python max(key=...)). */
export function maxBy<T>(items: Iterable<T>, key: (t: T) => number | (number | string | boolean)[]): T {
  let best: T | undefined;
  let bestK: number | (number | string | boolean)[] | undefined;
  let any = false;
  for (const it of items) {
    const k = key(it);
    if (!any || cmp(k, bestK!) > 0) {
      best = it;
      bestK = k;
      any = true;
    }
  }
  if (!any) throw new PyValueError("max() arg is an empty sequence");
  return best as T;
}

/** The first element with the smallest key (Python min(key=...)). */
export function minBy<T>(items: Iterable<T>, key: (t: T) => number | (number | string | boolean)[]): T {
  let best: T | undefined;
  let bestK: number | (number | string | boolean)[] | undefined;
  let any = false;
  for (const it of items) {
    const k = key(it);
    if (!any || cmp(k, bestK!) < 0) {
      best = it;
      bestK = k;
      any = true;
    }
  }
  if (!any) throw new PyValueError("min() arg is an empty sequence");
  return best as T;
}

type Key = number | string | boolean | Key[];

/** Python comparison of numbers, strings (by code point), bools and tuples. */
export function cmp(a: Key, b: Key): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const c = cmp(a[i]!, b[i]!);
      if (c) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === "string" && typeof b === "string") return cmpStr(a, b);
  const x = Number(a);
  const y = Number(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function cmpStr(a: string, b: string): number {
  if (a === b) return 0;
  const A = Array.from(a);
  const Bs = Array.from(b);
  const n = Math.min(A.length, Bs.length);
  for (let i = 0; i < n; i++) {
    const x = A[i]!.codePointAt(0)!;
    const y = Bs[i]!.codePointAt(0)!;
    if (x !== y) return x - y;
  }
  return A.length - Bs.length;
}

/** Stable sort by key (Python sorted(key=...)). */
export function sortedBy<T>(items: Iterable<T>, key: (t: T) => Key): T[] {
  const arr = Array.from(items).map((v, i) => ({ v, k: key(v), i }));
  arr.sort((p, q) => cmp(p.k, q.k) || p.i - q.i);
  return arr.map((p) => p.v);
}

export function sum(values: Iterable<number>): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

/** Python's str.isalnum() for one character. */
export function isAlnumChar(c: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(c);
}

const CJK_NUMERALS = "〇一二三四五六七八九十百千万萬億兆零壹贰貳叁參肆伍陆陸柒捌玖拾佰仟";

/** Python's str.isnumeric() for one character (approximately). */
export function isNumericChar(c: string): boolean {
  return /^\p{N}$/u.test(c) || CJK_NUMERALS.includes(c);
}

/** Python str.isdigit() */
export function isDigitStr(s: string): boolean {
  return s.length > 0 && /^[\p{Nd}²³¹⁰-⁹₀-₉]+$/u.test(s);
}

/** Python str.isupper() for one character. */
export function isUpperChar(c: string): boolean {
  return c !== c.toLowerCase() && c === c.toUpperCase();
}

/** Python unicodedata.combining(c) != 0 (approximately: nonspacing marks). */
export function isCombining(c: string): boolean {
  return /^\p{Mn}$/u.test(c);
}

export function hypot(a: number, b: number): number {
  return Math.hypot(a, b);
}

/** Python's a % b for numbers (result has the sign of b). */
export function pmod(a: number, b: number): number {
  const r = a % b;
  return r !== 0 && r < 0 !== b < 0 ? r + b : r;
}

/** Python's a // b */
export function floordiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function range(a: number, b?: number, step = 1): number[] {
  const out: number[] = [];
  const [lo, hi] = b === undefined ? [0, a] : [a, b];
  if (step > 0) for (let i = lo; i < hi; i += step) out.push(i);
  else for (let i = lo; i > hi; i += step) out.push(i);
  return out;
}

/** A JSON-able deep copy. */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Python dict-like get: obj[key] when obj is a plain object. */
export function get(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) return (obj as Record<string, unknown>)[key];
  return undefined;
}

export function isDict(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Python 3.12+ sum() of floats: Neumaier-compensated, as CPython does it. */
export function psum(values: Iterable<number>): number {
  let s = 0;
  let c = 0;
  for (const x of values) {
    const t = s + x;
    if (Math.abs(s) >= Math.abs(x)) c += s - t + x;
    else c += x - t + s;
    s = t;
  }
  if (c && Number.isFinite(c)) s += c;
  return s;
}

const SPLIT = 134217729; // 2^27 + 1

function twoProd(a: number, b: number): [number, number] {
  const p = a * b;
  let t = SPLIT * a;
  const ah = t - (t - a);
  const al = a - ah;
  t = SPLIT * b;
  const bh = t - (t - b);
  const bl = b - bh;
  const e = al * bl - (p - ah * bh - al * bh - ah * bl);
  return [p, e];
}

/** math.hypot(x, y) as CPython computes it: correctly rounded in nearly all cases. */
export function phypot(x: number, y: number): number {
  x = Math.abs(x);
  y = Math.abs(y);
  if (x === Infinity || y === Infinity) return Infinity;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x < y) [x, y] = [y, x];
  if (y === 0) return x;
  if (x > 1e150 || x < 1e-150) return Math.hypot(x, y);
  const [p1, e1] = twoProd(x, x);
  const [p2, e2] = twoProd(y, y);
  const s = p1 + p2;
  const bb = s - p1;
  const e3 = p1 - (s - bb) + (p2 - bb);
  const lo = e1 + e2 + e3;
  let h = Math.sqrt(s + lo);
  const [hh, ehh] = twoProd(h, h);
  const r = s - hh - ehh + lo;
  h += r / (2 * h);
  return h;
}

export function sq(x: number): number {
  return x * x;
}

/** x ** 3 rounded once, like C's pow(x, 3.0). */
export function cube(x: number): number {
  const [p, e] = twoProd(x, x);
  const [q, f] = twoProd(p, x);
  return q + (f + e * x);
}
