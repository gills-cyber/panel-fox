/**
 * Chibi stickers for AI-made chapters: a sweat drop on a nervous face, an
 * anger mark on an angry one, and so on. Chosen from what the vision model
 * said about each person's expression, placed by their head and sized to it,
 * and kept clear of the speech bubbles.
 */
import { ANIME_STICKERS } from "../manga/anime-stickers.ts";
import { imageToPageRaw, type Overlay } from "./bubbles.ts";
import { PAGE_H, PAGE_W, type Page } from "./layout.ts";
import type { Analysis, Box } from "./vision.ts";

type Spot = "corner" | "side" | "cheek" | "blush" | "above" | "ring";

/** In order of priority: the first rule that matches a person is used. */
const RULES: { re: RegExp; file: string; spot: Spot; scale: number }[] = [
  { re: /\b(angry|anger|furious|rage|raging|irritat\w*|annoyed|scowl\w*|glar\w*|livid|seething|fuming)\b/, file: "vein", spot: "corner", scale: 0.42 },
  { re: /\b(blush\w*|embarrass\w*|shy|bashful|fluster\w*|sheepish|coy)\b/, file: "blush", spot: "blush", scale: 0.75 },
  { re: /\b(cry|crying|cries|tears?|tearful|teary|sob\w*|weep\w*)\b/, file: "tear", spot: "cheek", scale: 0.2 },
  { re: /\b(nervous\w*|anxious|sweat\w*|awkward|uneasy|panick\w*|worried|flustered|tense)\b/, file: "sweat", spot: "side", scale: 0.24 },
  { re: /\b(shock\w*|surpris\w*|startl\w*|stunn\w*|gasp\w*|aghast|wide-eyed|astonish\w*)\b/, file: "shock", spot: "ring", scale: 1.7 },
  { re: /\b(sleep\w*|asleep|drows\w*|dozing|dozes|napping|yawn\w*)\b/, file: "zzz", spot: "above", scale: 0.7 },
  { re: /\b(in love|lovestruck|smitten|adoring|adoringly|affectionate\w*|dreamy|lovingly)\b/, file: "heart", spot: "above", scale: 0.42 },
  { re: /\b(sing\w*|humm\w*|whistl\w*)\b/, file: "notes", spot: "above", scale: 0.45 },
  { re: /\b(excited|delighted|joyful|overjoyed|thrilled|gleeful|beaming|starry-eyed|elated)\b/, file: "sparkle", spot: "above", scale: 0.6 },
];

type Rect = [number, number, number, number]; // x, y, w, h in page units

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

function headRect(panel: Page["panels"][number], hb: Box): Rect | null {
  if (!Array.isArray(hb) || hb.length < 4 || !hb.every((v) => Number.isFinite(v))) return null;
  const [x1, y1] = imageToPageRaw(panel, hb[0]!, hb[1]!);
  const [x2, y2] = imageToPageRaw(panel, hb[2]!, hb[3]!);
  if (x2 <= x1 || y2 <= y1) return null;
  return [x1, y1, x2 - x1, y2 - y1];
}

/**
 * Where each kind of sticker sits, the way manga draws it: the centre of the
 * sticker as a fraction of the head box (0,0 top left, 1,1 bottom right);
 * for "above" it is the sticker's bottom edge.
 * The head box includes the hair, so the brow line is about a third down.
 */
const ANCHOR: Record<Spot, [number, number]> = {
  corner: [0.78, 0.18], // anger mark: the upper corner of the forehead
  side: [0.88, 0.4], // sweat drop: on the temple, beside the brow at the edge of the face
  cheek: [0.36, 0.7], // tear: just under the eye
  blush: [0.5, 0.62], // blush: across both cheeks
  above: [0.85, -0.08], // zzz, heart, notes, sparkles: floating off the top of the head
  ring: [0.5, 0.5], // shock lines: around the whole head
};

/** The sticker's box for this spot by this head (page units), before it is kept inside the panel. */
function spotRect(spot: Spot, head: Rect, w: number, h: number, mirror: boolean): Rect {
  const [hx, hy, hw, hh] = head;
  const [ax, ay] = ANCHOR[spot];
  const cx = hx + hw * (mirror ? 1 - ax : ax); // mirrored: the other temple / cheek
  const cy = spot === "above" ? hy + hh * ay - h / 2 : hy + hh * ay;
  return [cx - w / 2, cy - h / 2, w, h];
}

/**
 * Adds stickers to `overlays` (per page id) and returns how many were placed.
 * At most one per panel, on the first person whose expression has a matching rule.
 */
export function placeStickers(pages: Page[], analyses: Map<string, Analysis>, overlays: Map<string, Overlay[]>): number {
  let placed = 0;
  let n = 0;
  for (const page of pages) {
    const list = overlays.get(page.id) ?? [];
    overlays.set(page.id, list);
    const taken: Rect[] = list.map((o) => [(o.x / 100) * PAGE_W, (o.y / 100) * PAGE_H, (o.w / 100) * PAGE_W, (o.h / 100) * PAGE_H]);
    for (const panel of page.panels) {
      const a = analyses.get(panel.item.name);
      if (!a) continue;
      const prect: Rect = [(panel.x / 100) * PAGE_W, (panel.y / 100) * PAGE_H, (panel.w / 100) * PAGE_W, (panel.h / 100) * PAGE_H];
      let done = false;
      for (const c of a.characters ?? []) {
        if (done) break;
        const said = `${c.expression ?? ""} ${c.action ?? ""}`.toLowerCase();
        const rule = RULES.find((r) => r.re.test(said));
        if (!rule) continue;
        const head = headRect(panel, c.head_box as Box);
        if (!head) continue;
        // the face must be mostly inside the panel's frame
        if (overlapArea(head, prect) < 0.6 * head[2] * head[3]) continue;
        const art = ANIME_STICKERS.find((s) => s.id === `anime-${rule.file}`);
        if (!art) continue;
        // sized to the head; the art's own shape decides the height
        // faces too small to read (a crowd in the distance) get no sticker, rather than an oversized one
        if (head[2] < PAGE_W * 0.05) continue;
        const w = Math.min(Math.max(head[2] * rule.scale, PAGE_W * 0.015), PAGE_W * 0.3);
        const h = (w * (art.h ?? 20)) / (art.w ?? 20);
        for (const mirror of [false, true]) {
          const want = spotRect(rule.spot, head, w, h, mirror);
          if (want[2] > prect[2] - 8 || want[3] > prect[3] - 8) break;
          // keep it inside the panel, but only by a nudge: pushed further it would land on the face
          const r: Rect = [
            Math.min(Math.max(want[0], prect[0] + 4), prect[0] + prect[2] - want[2] - 4),
            Math.min(Math.max(want[1], prect[1] + 4), prect[1] + prect[3] - want[3] - 4),
            want[2],
            want[3],
          ];
          if (Math.abs(r[0] - want[0]) > 0.25 * w || Math.abs(r[1] - want[1]) > 0.25 * h) continue;
          // and clear of the bubbles and other stickers
          if (taken.some((t) => overlapArea(r, t) > 0.15 * r[2] * r[3])) continue;
          taken.push(r);
          n++;
          const sticker = {
            id: `sticker-${n}`,
            kind: "sticker",
            x: Math.round((r[0] / PAGE_W) * 10000) / 100,
            y: Math.round((r[1] / PAGE_H) * 10000) / 100,
            w: Math.round((r[2] / PAGE_W) * 10000) / 100,
            h: Math.round((r[3] / PAGE_H) * 10000) / 100,
            text: "",
            fontSize: 11,
            bold: false,
            italic: false,
            color: "",
            fill: "#ffffff",
            stroke: "#161412",
            tailX: 50,
            tailY: 128,
            balloonStyle: "oval",
            fontId: "comic",
            align: "center",
            autoFit: false,
            scriptLineId: null,
            speakerId: null,
            src: art.src,
          } as unknown as Overlay;
          list.push(sticker);
          placed++;
          done = true;
          break;
        }
      }
    }
  }
  return placed;
}
