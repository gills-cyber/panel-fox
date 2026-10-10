/**
 * Letterer's typography: the small substitutions a pro letterer makes by hand.
 *
 * Only the text before the caret is touched, so the result can be written back
 * as `smart(prefix) + suffix` with the caret at the end of the new prefix.
 */
export function smartType(prefix: string): string {
  if (!prefix) return prefix;
  let s = prefix;
  // Three dots become an ellipsis as soon as the third dot lands.
  s = s.replace(/\.\.\./g, "…");
  // A double hyphen becomes an em dash; a spaced single hyphen becomes an en dash.
  s = s.replace(/--/g, "—");
  s = s.replace(/(\S) - (?=\S)/g, "$1 – ");
  // Straight quotes curl: opening after a space / line start / opening bracket, closing otherwise.
  s = s.replace(/(^|[\s([{—–])"/g, "$1“").replace(/"/g, "”");
  s = s.replace(/(^|[\s([{—–])'/g, "$1‘").replace(/'/g, "’");
  return s;
}

/**
 * Apply `smartType` to a textarea edit while keeping the caret where the user
 * expects it. Returns null when nothing changed.
 */
export function smartEdit(
  value: string,
  caret: number,
): { text: string; caret: number } | null {
  const at = Math.max(0, Math.min(value.length, caret));
  const prefix = value.slice(0, at);
  const next = smartType(prefix);
  if (next === prefix) return null;
  return { text: next + value.slice(at), caret: next.length };
}
