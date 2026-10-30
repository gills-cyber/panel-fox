/**
 * Turn messy model output into a value: code fences, <think> blocks, trailing
 * commas and smart quotes are cleaned up before parsing.
 */
export class JSONRepairError extends Error {}

const THINK = /<think>[\s\S]*?<\/think>/gi;
const FENCE = /```(?:json)?\s*([\s\S]*?)```/i;
const TRAILING_COMMA = /,\s*([}\]])/g;

/** The first balanced {...} or [...] block, respecting strings; a cut-off one is closed. */
function extractBalanced(text: string): string | null {
  let start: number | null = null;
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (start === null) {
      if (ch === "{" || ch === "[") {
        start = i;
        stack.push(ch);
      }
      continue;
    }
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      if (!stack.length) break;
      const open = stack.pop();
      if (!((open === "{" && ch === "}") || (open === "[" && ch === "]"))) break;
      if (!stack.length) return text.slice(start, i + 1);
    }
  }
  if (start !== null && stack.length) {
    let tail = text.slice(start);
    if (inStr) tail += '"';
    return tail + stack.reverse().map((c) => (c === "{" ? "}" : "]")).join("");
  }
  return null;
}

function loads(text: string): unknown {
  return JSON.parse(text);
}

export function parseJsonLoose(text: unknown): unknown {
  if (text === null || text === undefined) throw new JSONRepairError("empty response");
  if (typeof text === "object") return text;
  const s = String(text);
  let raw = s.replace(THINK, "").trim();
  try {
    return loads(raw);
  } catch {
    /* clean up below */
  }
  const fence = FENCE.exec(raw);
  if (fence) raw = fence[1]!.trim();
  let candidate = extractBalanced(raw) ?? raw;
  candidate = candidate.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  candidate = candidate.replace(TRAILING_COMMA, "$1");
  for (const attempt of [candidate, candidate.replace(/\n/g, " ").replace(TRAILING_COMMA, "$1")]) {
    try {
      return loads(attempt);
    } catch {
      /* next */
    }
  }
  throw new JSONRepairError(`could not parse JSON from model output: ${JSON.stringify(s.slice(0, 300))}`);
}
