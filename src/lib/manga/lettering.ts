// @ts-nocheck
import { clamp, uid } from "@/lib/utils";
import { animeStickerSize } from "./anime-stickers";
import { clinicIconSize, isClinicIconSrc } from "./clinic-icons";
import {
	SFX_STACK,
	canvasFont,
	defaultFontId,
	titleUsesOutline,
} from "./fonts";
import type {
  LaidOutPanel,
  Overlay,
  OverlayKind,
  ResizeHandle,
  StickerId,
  ToneId,
} from "./types";
import { balloonStyleOf, balloonHasTail, styleFromKind, burstPath, balloonEllipse, balloonTextFrame } from "./balloons";
import { inkBody, inkPuff, inkSeed, inkTail, type InkShape } from "./ink";

export const HOT_PINK = "#ff2bd6";
export const NEON_RED = "#ff1f3d";
export { COMIC_STACK, SFX_STACK, ensureLetterFonts as ensureComicFont } from "./fonts";
export const THOUGHT_CLOUD = "M22 58 C8 60 4 42 16 36 C10 20 28 10 42 18 C48 6 68 6 76 18 C90 10 106 24 98 40 C110 48 104 68 86 68 C82 84 58 88 46 74 C30 86 10 76 12 60 C6 62 10 56 22 58 Z";
export const HEART_PATH = "M50 96 C30 74 10 50 14 30 C16 12 28 5 40 12 C44 18 48 30 50 38 C52 26 58 5 72 8 C88 12 94 32 84 50 C74 66 60 82 50 96 Z";
export const LETTER_COLORS: readonly { id: string; label: string }[] = [
	{
		id: "#161412",
		label: "Ink"
	},
	{
		id: "#ffffff",
		label: "White"
	},
	{
		id: "#b42318",
		label: "Red"
	},
	{
		id: "#ff1f3d",
		label: "Neon red"
	},
	{
		id: "#0071e3",
		label: "Blue"
	},
	{
		id: "#ec4899",
		label: "Pink"
	},
	{
		id: "#ff2bd6",
		label: "Hot pink"
	},
	{
		id: "#eab308",
		label: "Yellow"
	},
	{
		id: "#16a34a",
		label: "Green"
	},
	{
		id: "#7c3aed",
		label: "Purple"
	},
	{
		id: "#ea580c",
		label: "Orange"
	}
];
export const BALLOON_FILLS: readonly { id: string; label: string }[] = [
	{ id: "#ffffff", label: "White" },
	{ id: "#f3eee6", label: "Paper" },
	{ id: "#fff4c2", label: "Lemon" },
	{ id: "#ffe4ef", label: "Blush" },
	{ id: "#dbeafe", label: "Sky" },
	{ id: "#161412", label: "Ink" },
	{ id: "transparent", label: "None" },
];
export const BALLOON_OUTLINES: readonly { id: string; label: string }[] = [
	{ id: "#161412", label: "Ink" },
	{ id: "#ffffff", label: "White" },
	{ id: "#b42318", label: "Red" },
	{ id: "#0071e3", label: "Blue" },
	{ id: "#ec4899", label: "Pink" },
	{ id: "#eab308", label: "Yellow" },
	{ id: "#16a34a", label: "Green" },
	{ id: "#7c3aed", label: "Purple" },
];
export function balloonFillColor(fill?: string) {
	return fill || "#ffffff";
}
export function balloonStrokeColor(stroke?: string) {
	return stroke || "#161412";
}
export function isClearPaint(color?: string) {
	return color === "transparent" || color === "none";
}
export const STICKER_COLORS: readonly { id: string; label: string }[] = [
	...LETTER_COLORS,
	{
		id: "#9aa3ad",
		label: "Fog"
	},
	{
		id: "#f3eee6",
		label: "Cream"
	},
	{
		id: "#c5d5de",
		label: "Mist"
	}
];
export function overlayOpacity(o: { opacity?: number | null }): number {
	const n = o.opacity;
	if (typeof n !== "number" || Number.isNaN(n)) return 1;
	return clamp(n, 0, 1);
}
/** Raster / photo stickers keep their printed colors until the user picks a hex. */
export function tintsRaster(color?: string): boolean {
	return Boolean(color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color));
}
export function stickerPaint(color: string | undefined, sticker?: StickerId): string {
	if (tintsRaster(color)) return color as string;
	return stickerInk(sticker);
}
export function glowStrength(color?: string) {
	const c = (color ?? "").toLowerCase();
	if (c === "#ff2bd6") return 1;
	if (c === "#ff1f3d") return .42;
	return 0;
}
export function isGlowInk(color?: string) {
	return glowStrength(color) > 0;
}
export const BUBBLE_FILLS: readonly { id: string; label: string }[] = [
	{
		id: "#ffffff",
		label: "White"
	},
	{
		id: "#fff6c2",
		label: "Shout"
	},
	{
		id: "#f3eee6",
		label: "Cream"
	},
	{
		id: "#fee2e2",
		label: "Blush"
	},
	{
		id: "#dbeafe",
		label: "Cool"
	},
	{
		id: "#dcfce7",
		label: "Mint"
	},
	{
		id: "#161412",
		label: "Ink"
	}
];
export const STICKER_GROUPS: { title: string; items: { id: StickerId; label: string; tags?: string }[] }[] = [
	{
		title: "Heat",
		items: [
			{
				id: "fog",
				label: "Fog",
				tags: "steam shower mist bath"
			},
			{
				id: "mist",
				label: "Mist",
				tags: "steam haze room"
			},
			{
				id: "shower",
				label: "Shower steam",
				tags: "hot bath fog"
			},
			{
				id: "bank",
				label: "Steam bank",
				tags: "floor fog onsen"
			},
			{
				id: "heat",
				label: "Heat",
				tags: "hot wavy shimmer"
			},
			{
				id: "haze",
				label: "Haze",
				tags: "hot shimmer"
			},
			{
				id: "lust",
				label: "Lust haze",
				tags: "hentai heat heart"
			},
			{
				id: "vapor",
				label: "Hot breath",
				tags: "hentai steam puff mouth haa"
			},
			{
				id: "breath",
				label: "Breath",
				tags: "steam puff mouth"
			},
			{
				id: "pant",
				label: "Panting",
				tags: "haa breath steam"
			},
			{
				id: "haa",
				label: "HAA",
				tags: "breath pant hentai"
			},
			{
				id: "jets",
				label: "Nose steam",
				tags: "nostril puff flustered"
			},
			{
				id: "steam",
				label: "Steam",
				tags: "hot vapor cloud"
			},
			{
				id: "puff",
				label: "Puff",
				tags: "steam cheeks"
			},
			{
				id: "huff",
				label: "Huff",
				tags: "sigh steam"
			},
			{
				id: "phew",
				label: "Phew",
				tags: "relief steam"
			},
			{
				id: "boil",
				label: "Boiling",
				tags: "anger heat"
			},
			{
				id: "moan",
				label: "Moan",
				tags: "hentai wave"
			}
		]
	},
	{
		title: "Scent",
		items: [
			{
				id: "smell",
				label: "Smell",
				tags: "aroma wisp kun"
			},
			{
				id: "scent",
				label: "Scent",
				tags: "perfume heart"
			},
			{
				id: "aroma",
				label: "Aroma",
				tags: "flower perfume"
			},
			{
				id: "swirl",
				label: "Pheromone",
				tags: "hentai swirl scent"
			},
			{
				id: "sniff",
				label: "Sniff",
				tags: "kun kun"
			},
			{
				id: "spicy",
				label: "Spicy",
				tags: "chili heat"
			},
			{
				id: "stink",
				label: "Stink",
				tags: "fume pungent"
			},
			{
				id: "skunk",
				label: "Reek",
				tags: "stink skull pun pun"
			},
			{
				id: "fume",
				label: "Fumes",
				tags: "stink swirl"
			}
		]
	},
	{
		title: "Desire",
		items: [
			{
				id: "kiss",
				label: "Kiss",
				tags: "lips chu"
			},
			{
				id: "hearts",
				label: "Hearts",
				tags: "love flying mouth"
			},
			{
				id: "flush",
				label: "Flush",
				tags: "blush cheeks"
			},
			{
				id: "wet",
				label: "Drops",
				tags: "sweat sparkle"
			},
			{
				id: "drip",
				label: "Drip",
				tags: "fluid drop"
			},
			{
				id: "saliva",
				label: "Saliva",
				tags: "drool string"
			},
			{
				id: "drool",
				label: "Drool",
				tags: "drip"
			},
			{
				id: "nosebleed",
				label: "Nosebleed",
				tags: "arousal"
			},
			{
				id: "throb",
				label: "Throb",
				tags: "heart pulse"
			},
			{
				id: "chomp",
				label: "Bite",
				tags: "teeth mark"
			},
			{
				id: "scratch",
				label: "Scratch",
				tags: "claw"
			},
			{
				id: "shiver",
				label: "Shiver",
				tags: "cold thrill"
			}
		]
	},
	{
		title: "Anger",
		items: [
			{
				id: "anger",
				label: "Anger"
			},
			{
				id: "vein",
				label: "Pop vein"
			},
			{
				id: "crossvein",
				label: "Vein burst"
			},
			{
				id: "temper",
				label: "Temper"
			},
			{
				id: "rage",
				label: "Rage aura"
			},
			{
				id: "scowl",
				label: "Scowl"
			},
			{
				id: "fury",
				label: "Fury"
			},
			{
				id: "spike",
				label: "Energy"
			},
			{
				id: "clench",
				label: "Grit"
			}
		]
	},
	{
		title: "Marks",
		items: [
			{
				id: "heart",
				label: "Heart"
			},
			{
				id: "exclaim",
				label: "Exclaim"
			},
			{
				id: "question",
				label: "Question"
			},
			{
				id: "sparkle",
				label: "Sparkle"
			},
			{
				id: "star",
				label: "Star"
			},
			{
				id: "notes",
				label: "Notes"
			},
			{
				id: "sweat",
				label: "Sweat"
			},
			{
				id: "tear",
				label: "Tear"
			},
			{
				id: "blush",
				label: "Blush"
			},
			{
				id: "shock",
				label: "Shock"
			},
			{
				id: "dizzy",
				label: "Dizzy"
			},
			{
				id: "gloom",
				label: "Gloom"
			},
			{
				id: "sleep",
				label: "Sleep"
			},
			{
				id: "sigh",
				label: "Sigh"
			},
			{
				id: "dots",
				label: "Speechless"
			},
			{
				id: "twitch",
				label: "Twitch"
			},
			{
				id: "flower",
				label: "Flower"
			},
			{
				id: "skull",
				label: "Skull"
			},
			{
				id: "burst",
				label: "Burst"
			},
			{
				id: "bang",
				label: "Bang"
			},
			{
				id: "focus",
				label: "Focus"
			}
		]
	},
	{
		title: "Laugh",
		items: [
			{
				id: "haha",
				label: "HAHA"
			},
			{
				id: "giggle",
				label: "Giggle"
			},
			{
				id: "hee",
				label: "Hee"
			},
			{
				id: "wara",
				label: "LOL"
			}
		]
	}
];
export const STICKERS = STICKER_GROUPS.flatMap((g) => g.items);
export const RAGE_PATH = "M50 3 L57 26 L74 8 L66 32 L96 18 L74 44 L99 52 L74 58 L94 82 L68 68 L76 98 L54 74 L50 99 L46 74 L24 98 L32 68 L6 82 L26 58 L1 52 L26 44 L4 18 L34 32 L26 8 L43 26 Z";
export const SFX_GROUPS: { title: string; items: { id: string; label: string }[] }[] = [
	{
		title: "Laugh",
		items: [
			{
				id: "HAHA",
				label: "HAHA"
			},
			{
				id: "AHAHA",
				label: "AHAHA"
			},
			{
				id: "HEE HEE",
				label: "HEE HEE"
			},
			{
				id: "HOHO",
				label: "HOHO"
			},
			{
				id: "HEH HEH",
				label: "HEH HEH"
			},
			{
				id: "UFUFU",
				label: "UFUFU"
			},
			{
				id: "SNIK",
				label: "SNIK"
			},
			{
				id: "www",
				label: "www"
			}
		]
	},
	{
		title: "Voice",
		items: [
			{
				id: "NNH",
				label: "NNH"
			},
			{
				id: "AH",
				label: "AH"
			},
			{
				id: "HAA",
				label: "HAA"
			},
			{
				id: "AHN",
				label: "AHN"
			},
			{
				id: "NNHA…",
				label: "NNHA…"
			},
			{
				id: "HAA HAA",
				label: "HAA HAA"
			},
			{
				id: "HYAA",
				label: "HYAA"
			},
			{
				id: "FUU",
				label: "FUU"
			},
			{
				id: "NNGH",
				label: "NNGH"
			},
			{
				id: "CUMMING",
				label: "CUMMING"
			},
			{
				id: "NO MORE",
				label: "NO MORE"
			},
			{
				id: "MORE",
				label: "MORE"
			}
		]
	},
	{
		title: "Senses",
		items: [
			{
				id: "HAA~",
				label: "HAA~"
			},
			{
				id: "FUUU",
				label: "FUUU"
			},
			{
				id: "PUWA",
				label: "PUWA"
			},
			{
				id: "KUN KUN",
				label: "KUN KUN"
			},
			{
				id: "PUN PUN",
				label: "PUN PUN"
			},
			{
				id: "MOWA",
				label: "MOWA"
			},
			{
				id: "STEAM",
				label: "STEAM"
			},
			{
				id: "SNIFF",
				label: "SNIFF"
			}
		]
	},
	{
		title: "Kiss",
		items: [
			{
				id: "CHU",
				label: "CHU"
			},
			{
				id: "SMOOCH",
				label: "SMOOCH"
			},
			{
				id: "SLURP",
				label: "SLURP"
			},
			{
				id: "LICK",
				label: "LICK"
			},
			{
				id: "SCHLURP",
				label: "SCHLURP"
			}
		]
	},
	{
		title: "Body",
		items: [
			{
				id: "SQUISH",
				label: "SQUISH"
			},
			{
				id: "SCHLICK",
				label: "SCHLICK"
			},
			{
				id: "SQUELCH",
				label: "SQUELCH"
			},
			{
				id: "SPLORCH",
				label: "SPLORCH"
			},
			{
				id: "PLAP",
				label: "PLAP"
			},
			{
				id: "PLAP PLAP",
				label: "PLAP PLAP"
			},
			{
				id: "SLAP",
				label: "SLAP"
			},
			{
				id: "THRUST",
				label: "THRUST"
			},
			{
				id: "TWITCH",
				label: "TWITCH"
			},
			{
				id: "THUMP",
				label: "THUMP"
			},
			{
				id: "SHUDDER",
				label: "SHUDDER"
			}
		]
	},
	{
		title: "Impact",
		items: [
			{
				id: "BAM",
				label: "BAM"
			},
			{
				id: "POW",
				label: "POW"
			},
			{
				id: "GASP",
				label: "GASP"
			},
			{
				id: "SLAM",
				label: "SLAM"
			},
			{
				id: "SPLAT",
				label: "SPLAT"
			},
			{
				id: "THUD",
				label: "THUD"
			},
			{
				id: "BANG",
				label: "BANG"
			}
		]
	},
	{
		title: "Battle",
		items: [
			{
				id: "CLANG",
				label: "CLANG"
			},
			{
				id: "CLASH",
				label: "CLASH"
			},
			{
				id: "SHING",
				label: "SHING"
			},
			{
				id: "SLASH",
				label: "SLASH"
			},
			{
				id: "SCHWING",
				label: "SCHWING"
			},
			{
				id: "SWISH",
				label: "SWISH"
			},
			{
				id: "WHOOSH",
				label: "WHOOSH"
			},
			{
				id: "KRANG",
				label: "KRANG"
			},
			{
				id: "SHINK",
				label: "SHINK"
			},
			{
				id: "RIP",
				label: "RIP"
			},
			{
				id: "CRACK",
				label: "CRACK"
			},
			{
				id: "WHAM",
				label: "WHAM"
			}
		]
	},
	{
		title: "Stomp",
		items: [
			{
				id: "STOMP",
				label: "STOMP"
			},
			{
				id: "STOMP STOMP",
				label: "STOMP STOMP"
			},
			{
				id: "BOOM",
				label: "BOOM"
			},
			{
				id: "CRASH",
				label: "CRASH"
			},
			{
				id: "POUND",
				label: "POUND"
			},
			{
				id: "RUMBLE",
				label: "RUMBLE"
			},
			{
				id: "CRUNCH",
				label: "CRUNCH"
			}
		]
	},
	{
		title: "Squeeze",
		items: [
			{
				id: "SQUEEZE",
				label: "SQUEEZE"
			},
			{
				id: "GRIP",
				label: "GRIP"
			},
			{
				id: "CRUSH",
				label: "CRUSH"
			},
			{
				id: "WRING",
				label: "WRING"
			},
			{
				id: "CREAK",
				label: "CREAK"
			}
		]
	},
	{
		title: "Gag",
		items: [
			{
				id: "GAG",
				label: "GAG"
			},
			{
				id: "URK",
				label: "URK"
			},
			{
				id: "HURK",
				label: "HURK"
			},
			{
				id: "BLEH",
				label: "BLEH"
			},
			{
				id: "RETCH",
				label: "RETCH"
			},
			{
				id: "ULP",
				label: "ULP"
			},
			{
				id: "GULP",
				label: "GULP"
			},
			{
				id: "KOFF",
				label: "KOFF"
			}
		]
	}
];
export const SIZES = {
	speech: {
		w: 22,
		h: 12
	},
	thought: {
		w: 24,
		h: 13
	},
	narration: {
		w: 58,
		h: 12
	},
	title: {
		w: 82,
		h: 14
	},
	sticker: {
		w: 16,
		h: 14
	},
	sfx: {
		w: 40,
		h: 18
	},
	shout: {
		w: 20,
		h: 11
	},
	whisper: {
		w: 16,
		h: 9
	},
	scream: {
		w: 22,
		h: 12
	},
	tone: {
		w: 36,
		h: 32
	},
	text: {
		w: 44,
		h: 16
	}
};
export function letterRefHeight(kind: OverlayKind) {
	if (kind === "sfx") return 64;
	if (kind === "title") return 72;
	if (kind === "narration" || kind === "text") return 100;
	return 110;
}
export function letterLockHeight(kind: OverlayKind) {
	return SIZES[kind]?.h ?? 12;
}
/** Lettering size is locked to the kind's default balloon, not the live overlay.
 *  Live overlay height used to feed back into font-size while typing (auto-grow → huge type). */
export function letterPixelSize(o: { kind: OverlayKind; fontSize?: number }, pageH: number) {
	const ref = letterRefHeight(o.kind);
	const lock = Math.max(8, pageH * letterLockHeight(o.kind) / 100);
	return Math.max(4, (o.fontSize || 15) * (lock / ref));
}
export const TONES: { id: ToneId; label: string }[] = [
	{
		id: "speed",
		label: "Speed lines"
	},
	{
		id: "focus",
		label: "Focus lines"
	},
	{
		id: "dots",
		label: "Screentone"
	},
	{
		id: "blush",
		label: "Blush tone"
	},
	{
		id: "rain",
		label: "Rain"
	},
	{
		id: "hatch",
		label: "Hatch"
	},
	{
		id: "fog",
		label: "Fog"
	}
];
export function isDialogue(kind: OverlayKind) {
	return kind === "speech" || kind === "thought" || kind === "shout" || kind === "whisper" || kind === "scream";
}
export function canRotate(kind: OverlayKind) {
	return kind === "sticker" || kind === "sfx";
}
export function wrapDeg(n: number) {
	let d = ((n + 180) % 360 + 360) % 360 - 180;
	if (d === -180) d = 180;
	return Math.round(d * 10) / 10;
}
export function flipDialogueTail(o: Overlay, axis: "x" | "y"): { tailX: number; tailY: number } {
	const n = (v: number) => Math.round(v * 10) / 10;
	if (axis === "x") {
		const x = Math.abs(o.tailX - 50) < 6 ? (o.tailX <= 50 ? 24 : 76) : o.tailX;
		return { tailX: n(100 - x), tailY: o.tailY };
	}
	const y = Math.abs(o.tailY - 46) < 10 ? (o.tailY >= 46 ? 128 : -20) : o.tailY;
	return { tailX: o.tailX, tailY: n(92 - y) };
}
export function fitBubbleSize(o: Overlay): { w: number; h: number } {
	const text = o.text || " ";
	const lines = text.split(/\n/);
	const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
	const wrapped = Math.max(lines.length, Math.ceil(text.replace(/\n/g, " ").length / 16));
	const sizeBoost = clamp((o.fontSize - 14) * .12, -6, 10);
	let w = 7.5 + longest * 1.02 + sizeBoost;
	let h = 5.6 + wrapped * 3.6 + sizeBoost * .5;
	if (o.kind === "whisper") {
		w *= .82;
		h *= .78;
	}
	if (o.kind === "shout" || o.kind === "scream") {
		w *= 1.12;
		h *= 1.14;
	}
	if (o.kind === "narration" || o.kind === "text") {
		w = clamp(o.w || 58, 8, 94);
		h = wrapHeightForBox({ ...o, w });
		return { w, h };
	}
	if (o.kind === "title") {
		w = clamp(w * 1.4, 40, 90);
		h = clamp(h, 10, 20);
	}
	if (o.vertical) {
		const t = w;
		w = h * .7;
		h = t * 1.1;
	}
	return {
		w: clamp(w, DIALOGUE_MIN_WIDTH, 86),
		h: clamp(h, DIALOGUE_MIN_HEIGHT, 62)
	};
}
/** Grow a fixed-width bubble so wrapped lines stay visible. */
export function wrapHeightForBox(o: Overlay): number {
	const text = o.text || " ";
	const font = Math.max(4, o.fontSize || 16);
	const charsPerPct = 18 / font * (o.kind === "narration" || o.kind === "text" ? .4 : o.kind === "title" ? .32 : .28);
	const cols = Math.max(2, o.w * charsPerPct);
	const lines = text.split("\n").reduce((n, ln) => n + Math.max(1, Math.ceil(Math.max(1, [...ln].length) / cols)), 0);
	const unit = font / 20 * (o.kind === "narration" || o.kind === "text" ? 4.6 : 5.4);
	const pad = o.kind === "narration" || o.kind === "text" ? 4 : 5;
	return clamp(Math.max(o.h, pad + lines * unit), DIALOGUE_MIN_HEIGHT, 86);
}
export function stickerSize(id?: StickerId): { w: number; h: number } {
	if (id === "focus" || id === "burst" || id === "bang") return {
		w: 30,
		h: 26
	};
	if (id === "rage" || id === "fury" || id === "spike") return {
		w: 28,
		h: 26
	};
	if (id === "gloom" || id === "shock" || id === "blush" || id === "flush") return {
		w: 22,
		h: 18
	};
	if (id === "temper" || id === "vein" || id === "crossvein") return {
		w: 22,
		h: 22
	};
	if (id === "steam" || id === "boil" || id === "huff" || id === "breath" || id === "pant" || id === "vapor" || id === "haa" || id === "jets" || id === "phew") return {
		w: 22,
		h: 20
	};
	if (id === "heat" || id === "haze" || id === "shiver" || id === "lust" || id === "moan") return {
		w: 18,
		h: 24
	};
	if (id === "stink" || id === "fume" || id === "smell" || id === "scent" || id === "skunk" || id === "aroma" || id === "swirl") return {
		w: 22,
		h: 22
	};
	if (id === "nosebleed" || id === "drool" || id === "drip" || id === "saliva" || id === "wet") return {
		w: 16,
		h: 22
	};
	if (id === "scowl" || id === "clench" || id === "puff" || id === "kiss" || id === "hearts") return {
		w: 24,
		h: 18
	};
	if (id === "chomp" || id === "scratch") return {
		w: 22,
		h: 16
	};
	if (id === "haha" || id === "giggle" || id === "hee" || id === "wara") return {
		w: 24,
		h: 16
	};
	if (id === "fog" || id === "mist" || id === "shower") return {
		w: 48,
		h: 36
	};
	if (id === "bank") return {
		w: 56,
		h: 20
	};
	return SIZES.sticker;
}
export function stickerInk(id?: StickerId): string {
	if (id === "heart" || id === "throb" || id === "scent" || id === "kiss" || id === "hearts" || id === "flush") return "#ff3d6e";
	if (id === "puff") return "#ec4899";
	if (id === "steam" || id === "stink" || id === "fume" || id === "skunk" || id === "phew" || id === "fog" || id === "mist" || id === "shower" || id === "bank") return "#9aa3ad";
	if (id === "clench" || id === "huff") return "#161412";
	if (id === "heat" || id === "haze" || id === "spicy" || id === "breath" || id === "pant" || id === "vapor" || id === "haa" || id === "jets" || id === "lust" || id === "moan") return "#ea580c";
	if (id === "smell" || id === "sniff" || id === "swirl" || id === "aroma") return "#7c3aed";
	if (id === "nosebleed" || id === "chomp" || id === "scratch") return "#b42318";
	if (id === "shiver") return "#0071e3";
	if (id === "drool" || id === "drip" || id === "saliva" || id === "wet") return "#4aa3df";
	if (id === "anger" || id === "vein" || id === "temper" || id === "rage" || id === "scowl" || id === "fury" || id === "crossvein" || id === "spike" || id === "boil") return "#b42318";
	if (id === "sweat" || id === "tear") return "#4aa3df";
	if (id === "blush" || id === "flower") return "#ec4899";
	return "#161412";
}
export function pageOverlays(page: { overlays?: Overlay[] }): Overlay[] {
	return page.overlays ?? [];
}
export function pageTitle(page: { title?: string }): string {
	return page.title?.trim() ? page.title : "Untitled";
}
export function makeOverlay(kind: OverlayKind, boxes: LaidOutPanel[], panelId: string | null, sticker?: StickerId, textOverride?: string, src?: string): Overlay {
	const size = kind === "sticker" ? src ? isClinicIconSrc(src) ? clinicIconSize() : animeStickerSize(src) : stickerSize(sticker) : SIZES[kind];
	const box = boxes.find((b) => b.id === panelId) ?? boxes[0];
	let x;
	let y;
	if (kind === "title") {
		x = (100 - size.w) / 2;
		y = 2.4;
	} else if (kind === "sticker" && box) {
		x = box.x + Math.max(1, box.w - size.w - 3);
		y = box.y + Math.max(1, box.h - size.h - 4);
	} else if (kind === "narration" && box) {
		x = box.x + (box.w - size.w) / 2;
		y = box.y + 1.4;
	} else if (kind === "text" && box) {
		x = box.x + 4;
		y = box.y + Math.max(2, box.h * .12);
	} else if (kind === "thought" && box) {
		x = box.x + (box.w - size.w) / 2 + 8;
		y = box.y + (box.h - size.h) / 2 + 6;
	} else if (kind === "sfx" && box) {
		x = box.x + Math.max(2, box.w - size.w - 2);
		y = box.y + box.h * .55;
	} else if (box) {
		x = box.x + (box.w - size.w) / 2;
		y = box.y + (box.h - size.h) / 2;
	} else {
		x = (100 - size.w) / 2;
		y = 36;
	}
	x = clamp(x, 0, 100 - size.w);
	y = clamp(y, 0, 100 - size.h);
	const text = textOverride ?? (kind === "speech" ? "Hello…!" : kind === "thought" ? "What if…" : kind === "shout" ? "HEY—!!" : kind === "whisper" ? "psst…" : kind === "scream" ? "AAAAH!!" : kind === "narration" ? "Meanwhile…" : kind === "title" ? "CHAPTER 1" : kind === "sfx" ? "NNH" : kind === "text" ? "Write your copy…" : "");
	const overlay: Overlay = {
		id: uid("ov"),
		kind,
		x,
		y,
		w: size.w,
		h: size.h,
		text: kind === "tone" ? "" : text,
		fontSize: kind === "sfx" ? 7 : kind === "title" ? 42 : kind === "narration" || kind === "text" ? 16 : kind === "whisper" ? 11 : kind === "shout" || kind === "scream" ? 22 : 15,
		bold: kind !== "thought" && kind !== "sticker" && kind !== "whisper" && kind !== "tone" && kind !== "text",
		italic: kind === "thought" || kind === "whisper",
		color: kind === "sfx" ? "#b42318" : kind === "sticker" ? (src ? "" : stickerInk(sticker)) : kind === "tone" ? "#161412" : "#161412",
		fill: kind === "text" ? "transparent" : "#ffffff",
		stroke: kind === "text" ? "transparent" : "#161412",
		tailX: kind === "thought" ? 22 : 30,
		tailY: 128,
		sticker,
		src,
		autoFit: kind !== "sticker" && kind !== "tone" && kind !== "sfx",
		tone: kind === "tone" ? textOverride || "speed" : void 0,
		behind: kind === "tone" ? true : void 0,
		fontId: defaultFontId(kind),
		align: kind === "text" ? "left" : "center",
		balloonStyle: styleFromKind(kind),
	};
	if (kind === "tone" && box) {
		overlay.w = Math.min(56, Math.max(24, box.w * .92));
		overlay.h = Math.min(50, Math.max(20, box.h * .92));
		overlay.x = box.x + (box.w - overlay.w) / 2;
		overlay.y = box.y + (box.h - overlay.h) / 2;
	}
	if (box && isDialogue(kind)) {
		const min = overlayMinSize(kind);
		overlay.w = clamp(Math.min(size.w, box.w * .42), min, 90);
		overlay.h = clamp(Math.min(size.h, box.h * .32), min, 90);
		overlay.x = clamp(box.x + (box.w - overlay.w) / 2, 0, 100 - overlay.w);
		overlay.y = clamp(box.y + Math.max(1.2, box.h * .08), 0, 100 - overlay.h);
	}
	if (kind === "sticker" && box && (sticker === "fog" || sticker === "mist" || sticker === "shower" || sticker === "bank")) {
		overlay.w = Math.min(size.w, Math.max(28, box.w * .92));
		overlay.h = Math.min(size.h, Math.max(18, box.h * .78));
		overlay.x = box.x + (box.w - overlay.w) / 2;
		overlay.y = box.y + (box.h - overlay.h) / 2;
		overlay.opacity = .78;
	}
	if (kind === "sticker" && src && /fog|steam|wisps|breath|smoke|aura|chill|mist/i.test(src)) {
		overlay.opacity = overlay.opacity ?? .82;
	}
	if (kind === "sticker" && src && isClinicIconSrc(src) && box) {
		overlay.x = box.x + (box.w - overlay.w) / 2;
		overlay.y = box.y + Math.max(2, box.h * .06);
	}
	if (kind === "text" && box) {
		overlay.w = clamp(Math.min(size.w, box.w * .86), 12, 92);
		overlay.x = box.x + (box.w - overlay.w) / 2;
	}
	return overlay;
}
export function chainGroups(overlays: Overlay[]): Overlay[][] {
	const map = /* @__PURE__ */ new Map();
	for (const o of overlays) {
		if (!o.chainId) continue;
		if (!isDialogue(o.kind)) continue;
		const list = map.get(o.chainId) ?? [];
		list.push(o);
		map.set(o.chainId, list);
	}
	return [...map.values()].map((g) => [...g].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))).filter((g) => g.length >= 2);
}
export function isChainTail(overlay: Overlay, overlays: Overlay[]) {
	if (!overlay.chainId) return true;
	const group = chainGroups(overlays).find((g) => g[0]?.chainId === overlay.chainId);
	if (!group) return true;
	return group[group.length - 1]?.id === overlay.id;
}
export function isChained(overlay: Overlay, overlays: Overlay[]) {
	if (!overlay.chainId) return false;
	return chainGroups(overlays).some((g) => g.some((o) => o.id === overlay.id));
}
export function jaggedBalloonPath(spikes = 16, jag = .16) {
	return burstPath(spikes, jag);
}
export type SpeechTailGeom = {
	tipX: number;
	tipY: number;
	leftX: number;
	leftY: number;
	rightX: number;
	rightY: number;
};
/** Tail triangle in the same coordinate space as the ellipse. */
export function speechTailGeom(
	tipX: number,
	tipY: number,
	ellipse: { cx: number; cy: number; rx: number; ry: number } = { cx: 50, cy: 46, rx: 46, ry: 36 },
): SpeechTailGeom {
	const { cx, cy, rx, ry } = ellipse;
	const dx = tipX - cx;
	const dy = tipY - cy;
	const ang = Math.atan2(dy / Math.max(ry, 0.001), dx / Math.max(rx, 0.001));
	const ax = cx + Math.cos(ang) * rx * 0.98;
	const ay = cy + Math.sin(ang) * ry * 0.98;
	const txd = -Math.sin(ang) * rx;
	const tyd = Math.cos(ang) * ry;
	const tlen = Math.hypot(txd, tyd) || 1;
	const reach = Math.hypot(dx, dy);
	const hw = Math.min(rx, ry) * 0.22 + Math.min(Math.max(rx, ry) * 0.04, reach * 0.05);
	const ux = txd / tlen * hw;
	const uy = tyd / tlen * hw;
	const n = (v: number) => +v.toFixed(3);
	return {
		tipX: n(tipX),
		tipY: n(tipY),
		leftX: n(ax - ux),
		leftY: n(ay - uy),
		rightX: n(ax + ux),
		rightY: n(ay + uy),
	};
}
export function speechTailPath(g: SpeechTailGeom, close = true) {
	return `M ${g.leftX} ${g.leftY} L ${g.tipX} ${g.tipY} L ${g.rightX} ${g.rightY}${close ? " Z" : ""}`;
}
export function thoughtTrail(
	tailX: number,
	tailY: number,
): { cx: number; cy: number; rx: number; ry: number }[] {
	const up = tailY < 40;
	const ox = 50;
	const oy = up ? 18 : 78;
	const n = (v: number) => +v.toFixed(3);
	return [
		{ cx: n(ox + (tailX - ox) * 0.28), cy: n(oy + (tailY - oy) * 0.22), rx: 7.5, ry: 6 },
		{ cx: n(ox + (tailX - ox) * 0.58), cy: n(oy + (tailY - oy) * 0.55), rx: 5, ry: 4.2 },
		{ cx: n(tailX), cy: n(tailY), rx: 3.6, ry: 3.2 },
	];
}
export function speechEllipse(o: Overlay) {
	return {
		cx: o.x + o.w / 2,
		cy: o.y + o.h * .46,
		rx: o.w * .46,
		ry: o.h * .36
	};
}
export function chainConnectorPath(a: Overlay, b: Overlay) {
	const ax = a.x + a.w / 2;
	const ay = a.y + a.h * .46;
	const bx = b.x + b.w / 2;
	const by = b.y + b.h * .46;
	const dx = bx - ax;
	const dy = by - ay;
	const len = Math.hypot(dx, dy) || 1;
	const ux = dx / len;
	const uy = dy / len;
	const nx = -uy;
	const ny = ux;
	const ra = Math.min(a.w, a.h) * .22;
	const rb = Math.min(b.w, b.h) * .22;
	const r = Math.min(ra, rb);
	const a0x = ax + ux * Math.min(a.w, a.h) * .12 + nx * r;
	const a0y = ay + uy * Math.min(a.w, a.h) * .12 + ny * r;
	const a1x = ax + ux * Math.min(a.w, a.h) * .12 - nx * r;
	const a1y = ay + uy * Math.min(a.w, a.h) * .12 - ny * r;
	const b0x = bx - ux * Math.min(b.w, b.h) * .12 + nx * r;
	const b0y = by - uy * Math.min(b.w, b.h) * .12 + ny * r;
	const b1x = bx - ux * Math.min(b.w, b.h) * .12 - nx * r;
	const b1y = by - uy * Math.min(b.w, b.h) * .12 - ny * r;
	const mx = (ax + bx) / 2;
	const my = (ay + by) / 2;
	return `M ${a0x} ${a0y} L ${b0x} ${b0y} Q ${mx} ${my} ${b1x} ${b1y} L ${a1x} ${a1y} Q ${mx} ${my} ${a0x} ${a0y} Z`;
}
export function demoOverlays(): Overlay[] {
	return [
		{
			id: "ov_demo_title",
			kind: "title",
			x: 9,
			y: 3.2,
			w: 82,
			h: 12,
			text: "NIGHT RUN",
			fontSize: 46,
			bold: true,
			italic: false,
			color: "#161412",
			fill: "#ffffff",
			stroke: "#161412",
			tailX: 50,
			tailY: 120
		},
		{
			id: "ov_demo_speech",
			kind: "speech",
			x: 54,
			y: 16,
			w: 40,
			h: 18,
			text: "Wait—!",
			fontSize: 24,
			bold: true,
			italic: false,
			color: "#161412",
			fill: "#ffffff",
			stroke: "#161412",
			tailX: 28,
			tailY: 118,
			scriptLineId: "line_demo_1",
			speakerId: "cast_aiko",
			balloonStyle: "oval"
		},
		{
			id: "ov_demo_thought",
			kind: "thought",
			x: 8,
			y: 58,
			w: 40,
			h: 20,
			text: "If I miss this train…",
			fontSize: 18,
			bold: false,
			italic: true,
			color: "#161412",
			fill: "#ffffff",
			stroke: "#161412",
			tailX: 22,
			tailY: 128,
			scriptLineId: "line_demo_2",
			speakerId: "cast_ren",
			balloonStyle: "cloud"
		},
		{
			id: "ov_demo_heart",
			kind: "sticker",
			x: 78,
			y: 72,
			w: 16,
			h: 14,
			text: "",
			fontSize: 18,
			bold: false,
			italic: false,
			color: "#b42318",
			fill: "#ffffff",
			stroke: "#161412",
			tailX: 50,
			tailY: 120,
			sticker: "heart"
		}
	];
}
export function glyphWobble(i: number, ch: string) {
	const seed = (ch.charCodeAt(0) * 13 + i * 19) % 97;
	return {
		rotate: (seed / 97 - .5) * 16,
		dx: (seed % 7 - 3) * .35,
		dy: (seed % 9 - 4) * .45,
		scale: .92 + seed % 11 * .012
	};
}
export function moveOverlay(start: Overlay, dx: number, dy: number) {
	return {
		x: clamp(start.x + dx, 0, 100 - start.w),
		y: clamp(start.y + dy, 0, 100 - start.h)
	};
}
/** Page-% floor. Stickers can shrink to a facial mole (~0.35% of the page). */
export const STICKER_MIN_SIZE = 0.35;
export const STICKER_MAX_SIZE = 92;
export const DIALOGUE_MIN_SIZE = 1;
export const DIALOGUE_MIN_WIDTH = 1.2;
export const DIALOGUE_MIN_HEIGHT = 0.9;
export const DIALOGUE_ASPECT_MIN = 0.12;
export const DIALOGUE_ASPECT_MAX = 2.4;
export const LETTER_MIN_SIZE = 3;
export const LETTER_FONT_MIN = 4;
export const LETTER_FONT_MAX = 96;
export function overlayMinSize(kind?: OverlayKind): number {
	if (kind === "sticker" || kind === "tone") return STICKER_MIN_SIZE;
	if (kind && isDialogue(kind)) return DIALOGUE_MIN_SIZE;
	return LETTER_MIN_SIZE;
}
export function overlayMinWidth(kind?: OverlayKind): number {
	if (kind === "sticker" || kind === "tone") return STICKER_MIN_SIZE;
	if (kind && isDialogue(kind)) return DIALOGUE_MIN_WIDTH;
	return LETTER_MIN_SIZE;
}
export function overlayMinHeight(kind?: OverlayKind): number {
	if (kind === "sticker" || kind === "tone") return STICKER_MIN_SIZE;
	if (kind && isDialogue(kind)) return DIALOGUE_MIN_HEIGHT;
	return LETTER_MIN_SIZE;
}
function roundBox(b: { x: number; y: number; w: number; h: number }) {
	const n = (v: number) => Math.round(v * 100) / 100;
	return { x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h) };
}
function clampDialogueAspect(w: number, h: number) {
	const a = h / Math.max(w, 0.001);
	if (a > DIALOGUE_ASPECT_MAX) h = w * DIALOGUE_ASPECT_MAX;
	else if (a < DIALOGUE_ASPECT_MIN) h = w * DIALOGUE_ASPECT_MIN;
	return { w, h };
}
export function scaleOverlaySize(o: Overlay, nextW: number): Pick<Overlay, "x" | "y" | "w" | "h"> {
	const minW = overlayMinWidth(o.kind);
	const minH = overlayMinHeight(o.kind);
	const aspect = o.w > 0.001 ? o.h / o.w : 1;
	let w = clamp(nextW, minW, STICKER_MAX_SIZE);
	let h = w * aspect;
	if (h < minH) {
		h = minH;
		w = h / (aspect || 1);
	}
	if (h > STICKER_MAX_SIZE) {
		h = STICKER_MAX_SIZE;
		w = h / (aspect || 1);
	}
	w = clamp(w, minW, STICKER_MAX_SIZE);
	h = clamp(w * aspect, minH, STICKER_MAX_SIZE);
	const x = clamp(o.x + (o.w - w) / 2, 0, 100 - w);
	const y = clamp(o.y + (o.h - h) / 2, 0, 100 - h);
	return roundBox({ x, y, w, h });
}
export function scaleOverlayBy(o: Overlay, factor: number): Pick<Overlay, "x" | "y" | "w" | "h"> {
	return scaleOverlaySize(o, o.w * factor);
}
function resizeDialogueCorner(start: Overlay, handle: ResizeHandle, dx: number, dy: number) {
	const moveE = handle === "e" || handle === "ne" || handle === "se";
	const moveW = handle === "w" || handle === "nw" || handle === "sw";
	const moveN = handle === "n" || handle === "ne" || handle === "nw";
	const moveS = handle === "s" || handle === "se" || handle === "sw";
	const aspect = start.h / Math.max(start.w, 0.001);
	const minW = overlayMinWidth(start.kind);
	const minH = overlayMinHeight(start.kind);
	const right = start.x + start.w;
	const bottom = start.y + start.h;
	const pw = moveE ? start.w + dx : start.w - dx;
	const ph = moveS ? start.h + dy : start.h - dy;
	const sx = pw / Math.max(start.w, 0.001);
	const sy = ph / Math.max(start.h, 0.001);
	const scale = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
	let w = clamp(start.w * scale, minW, 94);
	let h = w * aspect;
	if (h < minH) {
		h = minH;
		w = h / aspect;
	}
	if (h > 90) {
		h = 90;
		w = h / aspect;
	}
	w = clamp(w, minW, 94);
	h = clamp(w * aspect, minH, 90);
	let x = moveW ? right - w : start.x;
	let y = moveN ? bottom - h : start.y;
	x = clamp(x, 0, 100 - w);
	y = clamp(y, 0, 100 - h);
	if (moveW) w = clamp(right - x, minW, 94);
	if (moveN) h = clamp(bottom - y, minH, 90);
	if (moveE) w = clamp(w, minW, 100 - x);
	if (moveS) h = clamp(h, minH, 100 - y);
	h = clamp(w * aspect, minH, 90);
	w = clamp(h / aspect, minW, 94);
	if (moveW) x = clamp(right - w, 0, 100 - w);
	if (moveN) y = clamp(bottom - h, 0, 100 - h);
	return roundBox({ x, y, w, h });
}
export function resizeOverlay(start: Overlay, handle: ResizeHandle, dx: number, dy: number) {
	const minW = overlayMinWidth(start.kind);
	const minH = overlayMinHeight(start.kind);
	const moveE = handle === "e" || handle === "ne" || handle === "se";
	const moveW = handle === "w" || handle === "nw" || handle === "sw";
	const moveN = handle === "n" || handle === "ne" || handle === "nw";
	const moveS = handle === "s" || handle === "se" || handle === "sw";
	const corner = (moveE || moveW) && (moveN || moveS);
	if (corner && (start.kind === "sticker" || start.kind === "tone") && start.w > 0.001) {
		const aspect = start.h / start.w;
		const fromW = moveE ? dx : -dx;
		const fromH = moveS ? dy : -dy;
		const delta = Math.abs(fromW) >= Math.abs(fromH) ? fromW : fromH / (aspect || 1);
		return scaleOverlaySize(start, start.w + delta);
	}
	if (corner && isDialogue(start.kind) && start.w > 0.001) {
		return resizeDialogueCorner(start, handle, dx, dy);
	}
	let { x, y, w, h } = start;
	if (moveE) w = clamp(w + dx, minW, 100 - x);
	if (moveS) h = clamp(h + dy, minH, 100 - y);
	if (moveW) {
		const nextX = clamp(x + dx, 0, x + w - minW);
		w += x - nextX;
		x = nextX;
	}
	if (moveN) {
		const nextY = clamp(y + dy, 0, y + h - minH);
		h += y - nextY;
		y = nextY;
	}
	if (isDialogue(start.kind)) {
		const next = clampDialogueAspect(w, h);
		w = next.w;
		h = next.h;
		if (moveW) x = clamp(start.x + start.w - w, 0, 100 - w);
		if (moveN) y = clamp(start.y + start.h - h, 0, 100 - h);
		w = clamp(w, minW, 100 - x);
		h = clamp(h, minH, 100 - y);
	}
	return roundBox({ x, y, w, h });
}
function comicFont(px, bold, italic, fontId, kind) {
	return canvasFont(px, bold, italic, fontId, kind);
}
function drawHandSfx(ctx, text, w, h, px, color) {
	ctx.font = `400 ${px}px ${SFX_STACK}`;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	const lines = text.split("\n");
	const lh = px * 1.08;
	const startY = h / 2 - (lines.length - 1) * lh / 2;
	lines.forEach((line, li) => {
		const chars = [...line || " "];
		const widths = chars.map((ch) => ctx.measureText(ch).width);
		let cx = (w - widths.reduce((a, b) => a + b, 0)) / 2;
		const ly = startY + li * lh;
		chars.forEach((ch, i) => {
			const cw = widths[i] ?? px * .5;
			const wob = glyphWobble(i + li * 17, ch);
			ctx.save();
			ctx.translate(cx + cw / 2 + wob.dx * px * .04, ly + wob.dy * px * .08);
			ctx.rotate(wob.rotate * Math.PI / 180 - .08);
			ctx.scale(wob.scale, wob.scale * 1.06);
			ctx.strokeStyle = "#f3eee6";
			ctx.lineWidth = Math.max(5, px * .16);
			ctx.strokeText(ch, -cw / 2, 0);
			ctx.fillStyle = color;
			ctx.fillText(ch, -cw / 2, 0);
			ctx.globalAlpha = .28;
			ctx.fillText(ch, -cw / 2 + px * .02, px * .025);
			ctx.restore();
			cx += cw;
		});
	});
}
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const lines = [];
	const max = Math.max(8, maxWidth);
	function breakWord(word) {
		if (!word) return [""];
		if (ctx.measureText(word).width <= max) return [word];
		const out = [];
		let chunk = "";
		for (const ch of [...word]) {
			const test = chunk + ch;
			if (chunk && ctx.measureText(test).width > max) {
				out.push(chunk);
				chunk = ch;
			} else chunk = test;
		}
		if (chunk) out.push(chunk);
		return out.length ? out : [word];
	}
	for (const raw of text.split("\n")) {
		if (!raw) {
			lines.push("");
			continue;
		}
		const words = raw.split(/\s+/);
		let line = "";
		for (const word of words) for (const piece of breakWord(word)) {
			const test = line ? `${line} ${piece}` : piece;
			if (line && ctx.measureText(test).width > max) {
				lines.push(line);
				line = piece;
			} else line = test;
		}
		lines.push(line);
	}
	return lines.length ? lines : [""];
}
export function drawOverlay(ctx: CanvasRenderingContext2D, o: Overlay, pageW: number, pageH: number, opts?: { showTail?: boolean; skipShape?: boolean; handInk?: boolean }) {
	if (o.hidden) return;
	const x = o.x / 100 * pageW;
	const y = o.y / 100 * pageH;
	const w = o.w / 100 * pageW;
	const h = o.h / 100 * pageH;
	ctx.save();
	ctx.translate(x, y);
	const rot = o.rotate ?? 0;
	if (rot) {
		ctx.translate(w / 2, h / 2);
		ctx.rotate(rot * Math.PI / 180);
		ctx.translate(-w / 2, -h / 2);
	}
	ctx.globalAlpha *= (o.kind === "sticker" || o.kind === "tone") ? overlayOpacity(o) : 1;
	if (o.kind === "sticker") {
		if (o.sticker) drawSticker(ctx, o.sticker, w, h, stickerPaint(o.color, o.sticker));
		ctx.restore();
		return;
	}
	if (o.kind === "sfx" && (!o.fontId || o.fontId === "sfx")) {
		const sfxPx = letterPixelSize(o, pageH);
		drawHandSfx(ctx, o.text || "NNH", w, h, sfxPx, o.color);
		ctx.restore();
		return;
	}
	if (o.kind === "tone") {
		drawTone(ctx, w, h, o.tone || "speed", o.color);
		ctx.restore();
		return;
	}
	if (!opts?.skipShape) {
		const style = balloonStyleOf(o);
		if (o.kind === "title" || o.kind === "sfx" || o.kind === "tone" || o.kind === "text") {
			/* no balloon body */
		} else if (opts?.handInk !== false) drawInkBalloon(ctx, o, w, h, opts?.showTail !== false);
		else if (style === "cloud") drawThought(ctx, w, h, o.tailX, o.tailY, o.fill, o.stroke, opts?.showTail !== false);
		else if (style === "box") drawNarration(ctx, w, h, o.fill, o.stroke);
		else if (o.kind === "narration" && !o.balloonStyle) drawNarration(ctx, w, h, o.fill, o.stroke);
		else drawSpeech(ctx, w, h, o.tailX, o.tailY, o.fill, o.stroke, opts?.showTail !== false && balloonHasTail(style), style);
	}
	const outlined = titleUsesOutline(o.kind, o.fontId);
	const style = balloonStyleOf(o);
	const frame = balloonTextFrame(style, o.kind);
	const padL = w * frame.padLeft / 100;
	const padR = w * frame.padRight / 100;
	const padT = h * frame.padTop / 100;
	const padB = h * frame.padBottom / 100;
	const innerW = Math.max(8, w - padL - padR);
	const innerH = Math.max(8, h - padT - padB);
	let px = letterPixelSize(o, pageH);
	const align = o.align || (o.kind === "text" ? "left" : "center");
	ctx.fillStyle = o.color;
	ctx.textAlign = align;
	ctx.textBaseline = "middle";
	if (o.kind !== "title") ctx.letterSpacing = "-0.02em";
	const text = o.text || " ";
	let lines: string[] = [];
	let lh = px * (o.vertical ? 1.05 : 1.2);
	for (let i = 0; i < 8; i++) {
		ctx.font = comicFont(px, o.bold, o.italic, o.fontId, o.kind);
		lines = o.vertical ? text.split("\n").flatMap((line) => line.split("")) : wrapLines(ctx, text, innerW);
		lh = px * (o.vertical ? 1.05 : 1.2);
		const used = lines.length * lh;
		if (used <= innerH + 0.5) break;
		px = Math.max(4, px * (innerH / used) * 0.98);
	}
	const startY = padT + innerH / 2 - (lines.length - 1) * lh / 2;
	if (outlined) {
		ctx.lineJoin = "round";
		ctx.miterLimit = 2;
		ctx.strokeStyle = "#f3eee6";
		ctx.lineWidth = Math.max(6, px * .18);
	}
	const tx = align === "left" ? padL : align === "right" ? w - padR : padL + innerW / 2;
	lines.forEach((line, i) => {
		const ly = startY + i * lh;
		if (outlined) ctx.strokeText(line, tx, ly, innerW);
		ctx.fillStyle = o.color;
		ctx.fillText(line, tx, ly, innerW);
	});
	ctx.restore();
}
/** Fill the paper and ink of a hand-drawn shape; the context is already scaled to balloon units. */
export function paintInkShape(ctx: CanvasRenderingContext2D, shape: InkShape, paper: string, ink: string) {
	if (!isClearPaint(paper) && shape.paper) {
		ctx.fillStyle = paper;
		ctx.fill(new Path2D(shape.paper));
	}
	if (shape.ink) {
		ctx.fillStyle = ink;
		ctx.fill(new Path2D(shape.ink));
	}
	if (shape.line) {
		ctx.strokeStyle = ink;
		ctx.lineWidth = shape.line.width;
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		ctx.setLineDash(shape.line.dash ? shape.line.dash.split(" ").map(Number) : []);
		ctx.stroke(new Path2D(shape.line.d));
		ctx.setLineDash([]);
	}
}
/** Hand-drawn (G-pen) balloon: same generator as the on-screen SVG, so export matches the editor. */
function drawInkBalloon(ctx: CanvasRenderingContext2D, o: Overlay, w: number, h: number, showTail: boolean) {
	const style = balloonStyleOf(o);
	const ink = balloonStrokeColor(o.stroke);
	const paper = balloonFillColor(o.fill);
	const seed = inkSeed(o.id);
	const box = { boxW: w, boxH: h };
	ctx.save();
	ctx.scale(w / 100, h / 100);
	paintInkShape(ctx, inkBody(style, seed, box), paper, ink);
	if (style === "cloud" || style === "whisper") {
		const trail = thoughtTrail(o.tailX, o.tailY);
		trail.forEach((p, i) => {
			if (!showTail && i === trail.length - 1) return;
			paintInkShape(ctx, inkPuff(p, seed + 17 * (i + 1), box), paper, ink);
		});
	} else if (showTail && balloonHasTail(style)) {
		const g = speechTailGeom(o.tailX, o.tailY, balloonEllipse(style));
		paintInkShape(ctx, inkTail(g, seed, box), paper, ink);
	}
	ctx.restore();
}
function strokeFill(ctx, fill = "#ffffff", stroke = "#161412") {
	if (!isClearPaint(fill)) {
		ctx.fillStyle = fill;
		ctx.fill();
	}
	ctx.strokeStyle = stroke;
	ctx.lineWidth = Math.max(2.5, ctx.lineWidth || 3);
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.stroke();
}
function drawSpeech(ctx, w, h, tailX, tailY, fill, stroke, showTail = true, style = "oval") {
	const ink = balloonStrokeColor(stroke);
	const paper = balloonFillColor(fill);
	const clear = isClearPaint(paper);
	const e = balloonEllipse(style);
	const cx = e.cx / 100 * w;
	const cy = e.cy / 100 * h;
	const rx = e.rx / 100 * w;
	const ry = e.ry / 100 * h;
	const tx = tailX / 100 * w;
	const ty = tailY / 100 * h;
	const tail = speechTailGeom(tx, ty, { cx, cy, rx, ry });
	ctx.fillStyle = paper;
	ctx.strokeStyle = ink;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	if (style === "burst" || style === "spike") {
		const spikes = style === "spike" ? 22 : 16;
		const jag = style === "spike" ? .22 : .16;
		ctx.beginPath();
		for (let i = 0; i < spikes; i++) {
			const a = i / spikes * Math.PI * 2 - Math.PI / 2;
			const r = i % 2 === 0 ? 1 : 1 - jag;
			const x = cx + Math.cos(a) * rx * r;
			const y = cy + Math.sin(a) * ry * r;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
		if (!clear) {
			ctx.fillStyle = paper;
			ctx.fill();
		}
		ctx.lineWidth = Math.max(2.2, Math.min(w, h) * .03);
		ctx.strokeStyle = ink;
		ctx.stroke();
		if (showTail) drawTail(ctx, tail, paper, ink);
		return;
	}
	ctx.lineWidth = style === "whisper" ? Math.max(1.4, Math.min(w, h) * .018) : Math.max(2.4, Math.min(w, h) * .028);
	if (style === "whisper") ctx.setLineDash([6, 5]);
	ctx.beginPath();
	if (style === "rect") {
		const r = Math.min(rx, ry) * .28;
		ctx.roundRect(cx - rx, cy - ry, rx * 2, ry * 2, r);
	} else {
	ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
	}
	if (!clear) {
		ctx.fillStyle = paper;
		ctx.fill();
	}
	ctx.strokeStyle = ink;
	ctx.stroke();
	if (style === "radio") {
		ctx.setLineDash([]);
		ctx.beginPath();
		ctx.ellipse(cx, cy, rx * .82, ry * .78, 0, 0, Math.PI * 2);
		ctx.stroke();
	}
	if (showTail && style !== "whisper") {
		ctx.setLineDash([]);
		drawTail(ctx, tail, paper, ink);
	} else if (showTail && style === "whisper") {
		ctx.beginPath();
		ctx.ellipse(tx, ty, w * .03, h * .024, 0, 0, Math.PI * 2);
		if (!clear) ctx.fill();
		ctx.stroke();
	}
	ctx.setLineDash([]);
}
function drawTail(ctx, tail, paper, ink) {
	ctx.beginPath();
	ctx.moveTo(tail.leftX, tail.leftY);
	ctx.lineTo(tail.tipX, tail.tipY);
	ctx.lineTo(tail.rightX, tail.rightY);
	ctx.closePath();
	if (!isClearPaint(paper)) {
		ctx.fillStyle = paper;
		ctx.fill();
	}
	ctx.beginPath();
	ctx.moveTo(tail.leftX, tail.leftY);
	ctx.lineTo(tail.tipX, tail.tipY);
	ctx.lineTo(tail.rightX, tail.rightY);
	ctx.strokeStyle = ink;
	ctx.stroke();
}
function drawTone(ctx, w, h, id, color = "#161412") {
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, w, h);
	ctx.clip();
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.globalAlpha = .55;
	ctx.lineCap = "round";
	if (id === "speed") {
		ctx.lineWidth = Math.max(1.2, w * .012);
		for (let i = 0; i < 18; i++) {
			const y = i / 17 * h;
			ctx.beginPath();
			ctx.moveTo(w * .08, y);
			ctx.lineTo(w * (.55 + i % 3 * .12), y + (i % 2 ? 4 : -3));
			ctx.stroke();
		}
	} else if (id === "focus") {
		ctx.lineWidth = Math.max(1, w * .01);
		const cx = w * .5;
		const cy = h * .48;
		for (let i = 0; i < 28; i++) {
			const a = i / 28 * Math.PI * 2;
			ctx.beginPath();
			ctx.moveTo(cx + Math.cos(a) * w * .08, cy + Math.sin(a) * h * .08);
			ctx.lineTo(cx + Math.cos(a) * w * .62, cy + Math.sin(a) * h * .62);
			ctx.stroke();
		}
	} else if (id === "dots") {
		const step = Math.max(6, Math.min(w, h) * .08);
		for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) {
			ctx.beginPath();
			ctx.arc(x + (y / step % 2 === 0 ? 0 : step / 2), y, step * .16, 0, Math.PI * 2);
			ctx.fill();
		}
	} else if (id === "blush") {
		ctx.strokeStyle = "#ec4899";
		ctx.globalAlpha = .45;
		ctx.lineWidth = Math.max(1.4, w * .014);
		for (let i = 0; i < 12; i++) {
			const x = i / 11 * w;
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x + w * .12, h);
			ctx.stroke();
		}
	} else if (id === "rain") {
		ctx.lineWidth = Math.max(1, w * .01);
		ctx.globalAlpha = .5;
		for (let i = 0; i < 22; i++) {
			const x = i / 21 * w;
			ctx.beginPath();
			ctx.moveTo(x, -h * .1);
			ctx.lineTo(x - w * .08, h * 1.1);
			ctx.stroke();
		}
	} else if (id === "fog") drawFogFill(ctx, w, h, color);
	else {
		ctx.lineWidth = Math.max(1, w * .012);
		for (let i = -8; i < 16; i++) {
			ctx.beginPath();
			ctx.moveTo(i * w * .1, 0);
			ctx.lineTo(i * w * .1 + h, h);
			ctx.stroke();
		}
	}
	ctx.restore();
}
function drawThought(ctx, w, h, tailX, tailY, fill, stroke, showTail = true) {
	const ink = balloonStrokeColor(stroke);
	const paper = balloonFillColor(fill);
	ctx.save();
	ctx.scale(w / 100, h * .92 / 80);
	const cloud = new Path2D(THOUGHT_CLOUD);
	if (!isClearPaint(paper)) {
		ctx.fillStyle = paper;
		ctx.fill(cloud);
	}
	ctx.strokeStyle = ink;
	ctx.lineWidth = 3.1;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.stroke(cloud);
	ctx.restore();
	const trail = thoughtTrail(tailX, tailY);
	const sx = w / 100;
	const sy = h / 100;
	trail.forEach((p, i) => {
		if (!showTail && i === trail.length - 1) return;
		ctx.beginPath();
		ctx.ellipse(p.cx * sx, p.cy * sy, p.rx * sx, p.ry * sy, 0, 0, Math.PI * 2);
		strokeFill(ctx, paper, ink);
	});
}
function drawNarration(ctx, w, h, fill, stroke) {
	const ink = balloonStrokeColor(stroke);
	const paper = balloonFillColor(fill);
	const r = Math.min(6, h * .1);
	ctx.beginPath();
	ctx.roundRect(2, 2, w - 4, h - 4, r);
	if (!isClearPaint(paper)) {
		ctx.fillStyle = paper;
		ctx.fill();
	}
	ctx.strokeStyle = ink;
	ctx.lineWidth = Math.max(2, Math.min(w, h) * .03);
	ctx.stroke();
}
function drawFogFill(ctx, w, h, color) {
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	ctx.globalAlpha = .22;
	const puffs = [
		[
			.18,
			.82,
			.28,
			.18
		],
		[
			.48,
			.74,
			.34,
			.2
		],
		[
			.8,
			.8,
			.28,
			.16
		],
		[
			.32,
			.5,
			.3,
			.2
		],
		[
			.68,
			.46,
			.32,
			.18
		],
		[
			.16,
			.28,
			.24,
			.16
		],
		[
			.52,
			.24,
			.3,
			.18
		],
		[
			.84,
			.3,
			.22,
			.14
		],
		[
			.4,
			.08,
			.26,
			.14
		]
	];
	for (const [x, y, rx, ry] of puffs) {
		ctx.beginPath();
		ctx.ellipse(w * x, h * y, w * rx, h * ry, 0, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.globalAlpha = .35;
	ctx.lineWidth = Math.max(1.2, Math.min(w, h) * .012);
	for (const [x, y, rx, ry] of puffs) {
		ctx.beginPath();
		ctx.ellipse(w * x, h * y, w * rx, h * ry, 0, 0, Math.PI * 2);
		ctx.stroke();
	}
}
function fogPuffs(id) {
	if (id === "bank") return [
		[
			16,
			72,
			22,
			14,
			-.2
		],
		[
			42,
			60,
			26,
			16,
			.12
		],
		[
			70,
			66,
			24,
			15,
			.08
		],
		[
			90,
			76,
			16,
			11,
			-.12
		],
		[
			54,
			80,
			20,
			12,
			.04
		]
	];
	if (id === "shower") return [
		[
			20,
			88,
			22,
			12,
			-.2
		],
		[
			48,
			90,
			26,
			13,
			.08
		],
		[
			76,
			86,
			22,
			12,
			.16
		],
		[
			14,
			68,
			16,
			11,
			-.12
		],
		[
			36,
			70,
			18,
			12,
			.1
		],
		[
			58,
			66,
			20,
			13,
			-.08
		],
		[
			80,
			64,
			16,
			11,
			.14
		],
		[
			28,
			48,
			15,
			11,
			-.16
		],
		[
			52,
			44,
			18,
			12,
			.06
		],
		[
			74,
			42,
			14,
			10,
			.12
		],
		[
			40,
			26,
			13,
			9,
			-.1
		],
		[
			62,
			22,
			12,
			8,
			.08
		],
		[
			50,
			10,
			10,
			7,
			.04
		]
	];
	if (id === "mist") return [
		[
			24,
			74,
			20,
			12,
			-.16
		],
		[
			52,
			62,
			22,
			13,
			.1
		],
		[
			78,
			70,
			18,
			11,
			.08
		],
		[
			38,
			42,
			18,
			12,
			-.08
		],
		[
			66,
			34,
			16,
			10,
			.12
		],
		[
			48,
			18,
			14,
			9,
			-.06
		]
	];
	return [
		[
			22,
			80,
			24,
			14,
			-.18
		],
		[
			50,
			72,
			28,
			16,
			.1
		],
		[
			78,
			78,
			22,
			13,
			.12
		],
		[
			34,
			52,
			22,
			14,
			-.1
		],
		[
			66,
			46,
			24,
			15,
			.14
		],
		[
			18,
			36,
			16,
			11,
			.06
		],
		[
			82,
			32,
			18,
			12,
			-.08
		],
		[
			48,
			24,
			22,
			13,
			.04
		],
		[
			30,
			12,
			14,
			9,
			-.1
		],
		[
			70,
			10,
			16,
			10,
			.08
		]
	];
}
function drawFogMark(ctx, id, color) {
	const puffs = fogPuffs(id);
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.strokeStyle = color;
	ctx.fillStyle = "#f3eee6";
	ctx.lineWidth = id === "mist" ? 3.2 : 3.8;
	const fillA = id === "mist" ? .55 : id === "shower" ? .82 : .78;
	for (const [cx, cy, rx, ry, rot] of puffs) {
		ctx.beginPath();
		ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
		ctx.globalAlpha = fillA;
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.stroke();
	}
}
function drawSticker(ctx, id, w, h, color = "#161412") {
	const s = Math.min(w, h);
	ctx.translate((w - s) / 2, (h - s) / 2);
	ctx.scale(s / 100, s / 100);
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.lineWidth = 6;
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	const glow = glowStrength(color);
	if (glow > 0) {
		ctx.shadowColor = color;
		ctx.shadowBlur = glow >= 1 ? 18 : 8;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;
	}
	if (id === "heart") {
		ctx.save();
		ctx.translate(50, 52);
		ctx.rotate(.28);
		ctx.translate(-50, -52);
		ctx.lineJoin = "round";
		ctx.lineWidth = isGlowInk(color) ? 3.4 : 4.4;
		ctx.strokeStyle = isGlowInk(color) ? color : "#161412";
		ctx.fillStyle = color;
		const heart = new Path2D(HEART_PATH);
		ctx.fill(heart);
		ctx.stroke(heart);
		ctx.restore();
	} else if (id === "exclaim") {
		ctx.beginPath();
		ctx.moveTo(42, 8);
		ctx.lineTo(58, 8);
		ctx.lineTo(52, 68);
		ctx.lineTo(48, 68);
		ctx.closePath();
		ctx.fill();
		ctx.beginPath();
		ctx.arc(50, 84, 9, 0, Math.PI * 2);
		ctx.fill();
	} else if (id === "star") {
		ctx.beginPath();
		for (let i = 0; i < 5; i++) {
			const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
			const b = a + Math.PI / 5;
			ctx.lineTo(50 + Math.cos(a) * 42, 50 + Math.sin(a) * 42);
			ctx.lineTo(50 + Math.cos(b) * 18, 50 + Math.sin(b) * 18);
		}
		ctx.closePath();
		ctx.fill();
	} else if (id === "anger") {
		ctx.strokeStyle = color;
		ctx.lineWidth = 8;
		for (const [x1, y1, x2, y2] of [
			[
				22,
				22,
				42,
				42
			],
			[
				78,
				22,
				58,
				42
			],
			[
				22,
				78,
				42,
				58
			],
			[
				78,
				78,
				58,
				58
			]
		]) {
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
		}
	} else if (id === "sweat") {
		ctx.fillStyle = color;
		ctx.strokeStyle = "#161412";
		ctx.beginPath();
		ctx.moveTo(50, 8);
		ctx.bezierCurveTo(78, 40, 78, 70, 50, 88);
		ctx.bezierCurveTo(22, 70, 22, 40, 50, 8);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
	} else if (id === "notes") {
		ctx.font = "700 70px serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("♪", 38, 52);
		ctx.fillText("♫", 68, 42);
	} else if (id === "question") {
		ctx.font = `700 80px ${COMIC_STACK}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("?", 50, 54);
	} else if (id === "sparkle") {
		ctx.beginPath();
		ctx.moveTo(50, 4);
		ctx.lineTo(58, 42);
		ctx.lineTo(96, 50);
		ctx.lineTo(58, 58);
		ctx.lineTo(50, 96);
		ctx.lineTo(42, 58);
		ctx.lineTo(4, 50);
		ctx.lineTo(42, 42);
		ctx.closePath();
		ctx.fill();
	} else if (id === "blush") {
		ctx.strokeStyle = color;
		ctx.lineWidth = 7;
		for (const [x1, y1, x2, y2] of [
			[
				8,
				38,
				28,
				22
			],
			[
				10,
				56,
				32,
				38
			],
			[
				12,
				74,
				34,
				56
			],
			[
				92,
				38,
				72,
				22
			],
			[
				90,
				56,
				68,
				38
			],
			[
				88,
				74,
				66,
				56
			]
		]) {
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
		}
	} else if (id === "tear") {
		ctx.fillStyle = color;
		ctx.strokeStyle = "#161412";
		ctx.beginPath();
		ctx.moveTo(50, 6);
		ctx.bezierCurveTo(78, 40, 74, 78, 50, 94);
		ctx.bezierCurveTo(26, 78, 22, 40, 50, 6);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
	} else if (id === "dizzy") {
		ctx.lineWidth = 8;
		ctx.beginPath();
		ctx.arc(50, 50, 8, 0, Math.PI * 2);
		ctx.moveTo(58, 50);
		ctx.arc(50, 50, 18, 0, 1.4 * Math.PI);
		ctx.arc(50, 50, 30, .4 * Math.PI, 1.7 * Math.PI);
		ctx.arc(50, 50, 42, .2 * Math.PI, 1.5 * Math.PI);
		ctx.stroke();
	} else if (id === "sleep") {
		ctx.lineWidth = 7;
		ctx.beginPath();
		ctx.moveTo(16, 82);
		ctx.lineTo(42, 80);
		ctx.lineTo(18, 56);
		ctx.lineTo(46, 54);
		ctx.stroke();
		ctx.lineWidth = 8;
		ctx.beginPath();
		ctx.moveTo(34, 60);
		ctx.lineTo(66, 56);
		ctx.lineTo(38, 30);
		ctx.lineTo(72, 26);
		ctx.stroke();
		ctx.lineWidth = 9;
		ctx.beginPath();
		ctx.moveTo(52, 36);
		ctx.lineTo(90, 30);
		ctx.lineTo(56, 6);
		ctx.lineTo(96, 2);
		ctx.stroke();
	} else if (id === "burst") {
		ctx.beginPath();
		for (let i = 0; i < 12; i++) {
			const a = i * Math.PI / 6;
			const r = i % 2 ? 22 : 48;
			ctx.lineTo(50 + Math.cos(a) * r, 50 + Math.sin(a) * r);
		}
		ctx.closePath();
		ctx.fill();
	} else if (id === "shock") {
		ctx.lineWidth = 8;
		for (const [x, hh] of [
			[22, 70],
			[40, 90],
			[60, 84],
			[78, 62]
		]) {
			ctx.beginPath();
			ctx.moveTo(x, 50 - hh / 2);
			ctx.lineTo(x, 50 + hh / 2);
			ctx.stroke();
		}
	} else if (id === "vein") {
		ctx.strokeStyle = color;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.lineWidth = 9;
		ctx.beginPath();
		ctx.moveTo(24, 14);
		ctx.quadraticCurveTo(46, 42, 50, 54);
		ctx.quadraticCurveTo(56, 40, 80, 12);
		ctx.stroke();
		ctx.lineWidth = 8.5;
		ctx.beginPath();
		ctx.moveTo(50, 50);
		ctx.quadraticCurveTo(51, 72, 49, 92);
		ctx.stroke();
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(36, 26);
		ctx.quadraticCurveTo(50, 44, 66, 24);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(50, 50, 4.5, 0, Math.PI * 2);
		ctx.fillStyle = color;
		ctx.fill();
	} else if (id === "gloom") {
		ctx.lineWidth = 7;
		for (const [x, y] of [
			[22, 18],
			[48, 10],
			[74, 20],
			[30, 48],
			[62, 42],
			[40, 72],
			[70, 68]
		]) {
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x + 10, y + 18);
			ctx.stroke();
		}
	} else if (id === "temper") {
		ctx.strokeStyle = color;
		ctx.fillStyle = color;
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(18, 58);
		ctx.lineTo(42, 78);
		ctx.lineTo(78, 22);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(50, 18);
		ctx.lineTo(62, 46);
		ctx.lineTo(92, 42);
		ctx.lineTo(68, 62);
		ctx.lineTo(78, 92);
		ctx.lineTo(50, 74);
		ctx.lineTo(22, 92);
		ctx.lineTo(32, 62);
		ctx.lineTo(8, 46);
		ctx.lineTo(38, 46);
		ctx.closePath();
		ctx.globalAlpha = .22;
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.stroke();
		ctx.fillStyle = "#f3eee6";
		ctx.strokeStyle = "#161412";
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.ellipse(28, 16, 10, 7, -.4, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(48, 8, 12, 8, .1, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(70, 14, 9, 6, .3, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	} else if (id === "flower") {
		ctx.fillStyle = color;
		ctx.strokeStyle = "#161412";
		for (let i = 0; i < 5; i++) {
			const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
			ctx.beginPath();
			ctx.ellipse(50 + Math.cos(a) * 22, 50 + Math.sin(a) * 22, 16, 12, a, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
		ctx.beginPath();
		ctx.arc(50, 50, 10, 0, Math.PI * 2);
		ctx.fillStyle = "#eab308";
		ctx.fill();
		ctx.stroke();
	} else if (id === "skull") {
		ctx.beginPath();
		ctx.arc(50, 42, 28, Math.PI, 0);
		ctx.lineTo(78, 62);
		ctx.lineTo(70, 78);
		ctx.lineTo(30, 78);
		ctx.lineTo(22, 62);
		ctx.closePath();
		ctx.fillStyle = color === "#161412" ? "#f3eee6" : color;
		ctx.fill();
		ctx.strokeStyle = "#161412";
		ctx.stroke();
		ctx.fillStyle = "#161412";
		ctx.beginPath();
		ctx.ellipse(38, 44, 8, 10, 0, 0, Math.PI * 2);
		ctx.ellipse(62, 44, 8, 10, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo(42, 70);
		ctx.lineTo(42, 78);
		ctx.moveTo(50, 70);
		ctx.lineTo(50, 78);
		ctx.moveTo(58, 70);
		ctx.lineTo(58, 78);
		ctx.stroke();
	} else if (id === "sigh") {
		ctx.beginPath();
		ctx.ellipse(38, 62, 18, 14, -.4, 0, Math.PI * 2);
		ctx.ellipse(58, 48, 16, 12, .3, 0, Math.PI * 2);
		ctx.ellipse(70, 30, 12, 10, .2, 0, Math.PI * 2);
		ctx.fillStyle = "#ffffff";
		ctx.fill();
		ctx.stroke();
	} else if (id === "focus") {
		ctx.lineWidth = 5;
		for (let i = 0; i < 16; i++) {
			const a = i * Math.PI / 8;
			ctx.beginPath();
			ctx.moveTo(50 + Math.cos(a) * 12, 50 + Math.sin(a) * 12);
			ctx.lineTo(50 + Math.cos(a) * 48, 50 + Math.sin(a) * 48);
			ctx.stroke();
		}
	} else if (id === "bang") {
		ctx.beginPath();
		const pts = [
			8,
			42,
			22,
			38,
			28,
			8,
			46,
			32,
			72,
			12,
			64,
			40,
			94,
			48,
			66,
			58,
			78,
			88,
			52,
			70,
			40,
			94,
			36,
			66,
			10,
			78,
			26,
			54
		];
		ctx.moveTo(pts[0], pts[1]);
		for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
		ctx.closePath();
		ctx.fillStyle = "#ffffff";
		ctx.fill();
		ctx.stroke();
	} else if (id === "dots") {
		ctx.beginPath();
		ctx.arc(22, 58, 8, 0, Math.PI * 2);
		ctx.arc(50, 58, 8, 0, Math.PI * 2);
		ctx.arc(78, 58, 8, 0, Math.PI * 2);
		ctx.fill();
	} else if (id === "twitch") {
		ctx.lineWidth = 8;
		ctx.beginPath();
		ctx.moveTo(32, 20);
		ctx.lineTo(32, 80);
		ctx.moveTo(68, 20);
		ctx.lineTo(68, 80);
		ctx.moveTo(68, 20);
		ctx.lineTo(82, 12);
		ctx.stroke();
	} else if (id === "haha") {
		ctx.font = `400 36px ${SFX_STACK}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.strokeStyle = "#f3eee6";
		ctx.lineWidth = 8;
		ctx.save();
		ctx.translate(32, 36);
		ctx.rotate(-.22);
		ctx.strokeText("HA", 0, 0);
		ctx.fillText("HA", 0, 0);
		ctx.restore();
		ctx.save();
		ctx.translate(70, 72);
		ctx.rotate(.16);
		ctx.strokeText("HA", 0, 0);
		ctx.fillText("HA", 0, 0);
		ctx.restore();
	} else if (id === "giggle") {
		ctx.font = `400 28px ${SFX_STACK}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.save();
		ctx.translate(36, 38);
		ctx.rotate(-.18);
		ctx.fillText("hee", 0, 0);
		ctx.restore();
		ctx.save();
		ctx.translate(66, 70);
		ctx.rotate(.2);
		ctx.fillText("hee", 0, 0);
		ctx.restore();
	} else if (id === "hee") {
		ctx.font = `400 32px ${SFX_STACK}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.save();
		ctx.translate(50, 54);
		ctx.rotate(-.12);
		ctx.fillText("HEH", 0, 0);
		ctx.restore();
	} else if (id === "wara") {
		ctx.font = `400 40px ${SFX_STACK}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.strokeStyle = "#f3eee6";
		ctx.lineWidth = 8;
		ctx.save();
		ctx.translate(50, 58);
		ctx.rotate(.1);
		ctx.strokeText("LOL", 0, 0);
		ctx.fillText("LOL", 0, 0);
		ctx.restore();
	} else if (id === "rage") {
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		const aura = new Path2D(RAGE_PATH);
		ctx.fillStyle = "rgba(0,0,0,0)";
		ctx.lineWidth = 6.5;
		ctx.stroke(aura);
		for (let i = 0; i < 10; i++) {
			const a = i / 10 * Math.PI * 2 - Math.PI / 2 + .12;
			const inner = 14 + i % 3 * 2;
			const outer = 44 + i % 2 * 8;
			ctx.lineWidth = i % 2 ? 3.5 : 6;
			ctx.beginPath();
			ctx.moveTo(50 + Math.cos(a) * inner, 50 + Math.sin(a) * inner);
			ctx.lineTo(50 + Math.cos(a) * outer, 50 + Math.sin(a) * outer);
			ctx.stroke();
		}
	} else if (id === "scowl") {
		ctx.lineWidth = 9;
		ctx.beginPath();
		ctx.moveTo(8, 44);
		ctx.quadraticCurveTo(30, 14, 48, 40);
		ctx.moveTo(92, 44);
		ctx.quadraticCurveTo(70, 14, 52, 40);
		ctx.stroke();
		ctx.lineWidth = 7;
		ctx.beginPath();
		ctx.moveTo(72, 10);
		ctx.lineTo(86, 24);
		ctx.moveTo(86, 10);
		ctx.lineTo(72, 24);
		ctx.stroke();
	} else if (id === "fury") {
		ctx.lineCap = "round";
		for (let i = 0; i < 16; i++) {
			const a = i / 16 * Math.PI * 2 + .18;
			const inner = 10 + i % 3 * 4;
			const outer = 38 + i % 4 * 10;
			ctx.lineWidth = i % 2 ? 5 : 8;
			ctx.beginPath();
			ctx.moveTo(50 + Math.cos(a) * inner, 50 + Math.sin(a) * inner);
			ctx.lineTo(50 + Math.cos(a) * outer, 50 + Math.sin(a) * outer);
			ctx.stroke();
		}
	} else if (id === "crossvein") {
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.lineWidth = 11;
		ctx.beginPath();
		ctx.moveTo(22, 18);
		ctx.lineTo(50, 50);
		ctx.lineTo(78, 16);
		ctx.moveTo(18, 78);
		ctx.lineTo(50, 50);
		ctx.lineTo(84, 80);
		ctx.stroke();
		ctx.lineWidth = 8;
		ctx.beginPath();
		ctx.moveTo(50, 12);
		ctx.lineTo(50, 50);
		ctx.moveTo(50, 50);
		ctx.lineTo(50, 90);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(50, 50, 5, 0, Math.PI * 2);
		ctx.fill();
	} else if (id === "spike") {
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		ctx.lineWidth = 4;
		for (const pts of [
			[
				[38, 94],
				[46, 54],
				[32, 50],
				[62, 6],
				[52, 48],
				[68, 52],
				[58, 94]
			],
			[
				[12, 78],
				[22, 48],
				[10, 44],
				[34, 18],
				[24, 46],
				[38, 50]
			],
			[
				[78, 82],
				[80, 50],
				[70, 48],
				[92, 16],
				[84, 48],
				[96, 52]
			]
		]) {
			ctx.beginPath();
			ctx.moveTo(pts[0][0], pts[0][1]);
			for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
			ctx.closePath();
			ctx.globalAlpha = .18;
			ctx.fill();
			ctx.globalAlpha = 1;
			ctx.stroke();
		}
	} else if (id === "clench") {
		ctx.lineJoin = "round";
		ctx.lineWidth = 5;
		ctx.fillStyle = "#f3eee6";
		ctx.strokeStyle = color;
		ctx.beginPath();
		ctx.roundRect(14, 36, 72, 32, 6);
		ctx.fill();
		ctx.stroke();
		ctx.strokeStyle = color;
		ctx.lineWidth = 4;
		for (const x of [
			32,
			44,
			56,
			68
		]) {
			ctx.beginPath();
			ctx.moveTo(x, 38);
			ctx.lineTo(x, 66);
			ctx.stroke();
		}
		ctx.beginPath();
		ctx.moveTo(18, 52);
		ctx.lineTo(82, 52);
		ctx.stroke();
	} else if (id === "steam") {
		ctx.lineWidth = 4;
		ctx.fillStyle = "#f3eee6";
		ctx.strokeStyle = color;
		ctx.beginPath();
		ctx.ellipse(28, 78, 15, 11, -.35, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(48, 54, 13, 10, .18, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(66, 32, 11, 8, .12, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(80, 14, 8, 6, .2, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	} else if (id === "boil") {
		ctx.lineCap = "round";
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(22, 88);
		ctx.bezierCurveTo(18, 60, 34, 50, 30, 22);
		ctx.moveTo(50, 90);
		ctx.bezierCurveTo(44, 58, 62, 48, 56, 12);
		ctx.moveTo(78, 86);
		ctx.bezierCurveTo(84, 58, 68, 46, 74, 18);
		ctx.stroke();
		ctx.lineWidth = 7;
		ctx.beginPath();
		ctx.moveTo(70, 8);
		ctx.lineTo(84, 22);
		ctx.moveTo(84, 8);
		ctx.lineTo(70, 22);
		ctx.stroke();
	} else if (id === "puff") {
		ctx.fillStyle = color;
		ctx.globalAlpha = .35;
		ctx.beginPath();
		ctx.ellipse(24, 62, 20, 16, -.2, 0, Math.PI * 2);
		ctx.ellipse(76, 62, 20, 16, .2, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.strokeStyle = color;
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.ellipse(24, 62, 20, 16, -.2, 0, Math.PI * 2);
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(76, 62, 20, 16, .2, 0, Math.PI * 2);
		ctx.stroke();
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo(10, 54);
		ctx.lineTo(22, 42);
		ctx.moveTo(14, 66);
		ctx.lineTo(28, 52);
		ctx.moveTo(78, 42);
		ctx.lineTo(90, 54);
		ctx.moveTo(72, 52);
		ctx.lineTo(86, 66);
		ctx.stroke();
	} else if (id === "huff") {
		ctx.lineWidth = 5;
		ctx.fillStyle = "#f3eee6";
		ctx.strokeStyle = color;
		ctx.beginPath();
		ctx.moveTo(18, 62);
		ctx.bezierCurveTo(8, 40, 28, 18, 48, 28);
		ctx.bezierCurveTo(62, 12, 86, 24, 78, 44);
		ctx.bezierCurveTo(96, 52, 84, 78, 62, 70);
		ctx.bezierCurveTo(48, 82, 22, 78, 18, 62);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(28, 54);
		ctx.quadraticCurveTo(44, 64, 58, 52);
		ctx.stroke();
	} else if (id === "heat") {
		ctx.lineCap = "round";
		ctx.lineWidth = 7;
		ctx.beginPath();
		ctx.moveTo(24, 94);
		ctx.bezierCurveTo(8, 70, 40, 52, 18, 22);
		ctx.bezierCurveTo(8, 10, 28, 8, 24, 4);
		ctx.moveTo(50, 96);
		ctx.bezierCurveTo(32, 70, 68, 48, 46, 16);
		ctx.bezierCurveTo(38, 4, 56, 6, 52, 2);
		ctx.moveTo(76, 92);
		ctx.bezierCurveTo(94, 68, 62, 46, 82, 18);
		ctx.bezierCurveTo(92, 8, 74, 6, 78, 4);
		ctx.stroke();
	} else if (id === "haze") {
		ctx.lineCap = "round";
		ctx.lineWidth = 5;
		ctx.globalAlpha = .85;
		for (const [x, y, w] of [
			[
				14,
				82,
				36
			],
			[
				28,
				60,
				42
			],
			[
				16,
				38,
				38
			],
			[
				34,
				16,
				32
			]
		]) {
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.bezierCurveTo(x + w * .3, y - 12, x + w * .7, y + 10, x + w, y);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
	} else if (id === "breath" || id === "pant" || id === "vapor") {
		ctx.fillStyle = "#f3eee6";
		ctx.strokeStyle = color;
		ctx.lineWidth = 4;
		const puffs = id === "pant" ? [
			[
				18,
				82,
				16,
				11,
				-.42
			],
			[
				36,
				62,
				13,
				9,
				-.3
			],
			[
				54,
				44,
				11,
				8,
				-.18
			],
			[
				70,
				26,
				9,
				6,
				-.1
			],
			[
				84,
				12,
				7,
				5,
				-.04
			]
		] : id === "vapor" ? [
			[
				16,
				84,
				17,
				12,
				-.4
			],
			[
				38,
				62,
				14,
				10,
				-.28
			],
			[
				58,
				42,
				12,
				8,
				-.16
			],
			[
				76,
				22,
				9,
				7,
				-.06
			]
		] : [
			[
				18,
				80,
				16,
				11,
				-.38
			],
			[
				42,
				54,
				13,
				9,
				-.22
			],
			[
				66,
				30,
				10,
				7,
				-.1
			],
			[
				82,
				14,
				7,
				5,
				-.04
			]
		];
		for (const [cx, cy, rx, ry, a] of puffs) {
			ctx.beginPath();
			ctx.ellipse(cx, cy, rx, ry, a, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
		if (id === "vapor") {
			ctx.fillStyle = "#ff3d6e";
			const heart = new Path2D(HEART_PATH);
			ctx.save();
			ctx.translate(78, 2);
			ctx.scale(.16, .16);
			ctx.fill(heart);
			ctx.restore();
			ctx.save();
			ctx.translate(62, 28);
			ctx.scale(.11, .11);
			ctx.fill(heart);
			ctx.restore();
		}
	} else if (id === "smell" || id === "scent") {
		ctx.lineCap = "round";
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(18, 90);
		ctx.bezierCurveTo(4, 58, 38, 48, 16, 18);
		ctx.bezierCurveTo(8, 6, 28, 8, 22, 4);
		ctx.moveTo(50, 94);
		ctx.bezierCurveTo(28, 62, 72, 44, 46, 10);
		ctx.moveTo(82, 88);
		ctx.bezierCurveTo(98, 56, 64, 38, 86, 12);
		ctx.stroke();
		if (id === "scent") {
			ctx.fillStyle = color;
			const heart = new Path2D(HEART_PATH);
			ctx.save();
			ctx.translate(64, 2);
			ctx.scale(.2, .2);
			ctx.fill(heart);
			ctx.restore();
		}
	} else if (id === "stink") {
		ctx.lineCap = "round";
		ctx.fillStyle = color;
		ctx.globalAlpha = .22;
		ctx.beginPath();
		ctx.ellipse(38, 74, 24, 16, -.28, 0, Math.PI * 2);
		ctx.ellipse(66, 56, 20, 14, .22, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(24, 92);
		ctx.bezierCurveTo(6, 50, 42, 34, 14, 6);
		ctx.moveTo(50, 94);
		ctx.bezierCurveTo(74, 52, 26, 28, 56, 4);
		ctx.moveTo(78, 86);
		ctx.bezierCurveTo(100, 48, 58, 24, 88, 8);
		ctx.stroke();
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo(70, 12);
		ctx.lineTo(84, 26);
		ctx.moveTo(84, 12);
		ctx.lineTo(70, 26);
		ctx.stroke();
	} else if (id === "fume") {
		ctx.lineCap = "round";
		ctx.lineWidth = 7;
		ctx.beginPath();
		ctx.arc(50, 62, 10, .2, 1.6 * Math.PI);
		ctx.arc(50, 50, 18, 1.2 * Math.PI, .1 * Math.PI);
		ctx.arc(50, 42, 28, .4 * Math.PI, 1.5 * Math.PI);
		ctx.stroke();
	} else if (id === "sniff") {
		ctx.lineCap = "round";
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(12, 78);
		ctx.quadraticCurveTo(40, 70, 82, 28);
		ctx.moveTo(18, 58);
		ctx.quadraticCurveTo(44, 54, 80, 22);
		ctx.moveTo(22, 38);
		ctx.quadraticCurveTo(46, 36, 78, 16);
		ctx.stroke();
	} else if (id === "spicy") {
		ctx.lineJoin = "round";
		ctx.beginPath();
		ctx.moveTo(48, 96);
		ctx.quadraticCurveTo(18, 62, 42, 28);
		ctx.quadraticCurveTo(36, 48, 52, 58);
		ctx.quadraticCurveTo(46, 22, 62, 8);
		ctx.quadraticCurveTo(58, 40, 72, 52);
		ctx.quadraticCurveTo(86, 36, 70, 96);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
	} else if (id === "drool") {
		ctx.fillStyle = color;
		ctx.strokeStyle = "#161412";
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.moveTo(42, 8);
		ctx.bezierCurveTo(78, 28, 74, 70, 50, 96);
		ctx.bezierCurveTo(28, 70, 22, 28, 42, 8);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(68, 18, 7, 6, .3, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	} else if (id === "nosebleed") {
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(58, 8);
		ctx.quadraticCurveTo(86, 36, 48, 96);
		ctx.quadraticCurveTo(38, 54, 46, 28);
		ctx.quadraticCurveTo(28, 40, 58, 8);
		ctx.fill();
		ctx.beginPath();
		ctx.ellipse(70, 22, 8, 6, .4, 0, Math.PI * 2);
		ctx.fill();
	} else if (id === "shiver") {
		ctx.lineCap = "round";
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(18, 28);
		ctx.lineTo(8, 40);
		ctx.lineTo(20, 52);
		ctx.lineTo(8, 64);
		ctx.lineTo(18, 76);
		ctx.moveTo(82, 28);
		ctx.lineTo(92, 40);
		ctx.lineTo(80, 52);
		ctx.lineTo(92, 64);
		ctx.lineTo(82, 76);
		ctx.stroke();
	} else if (id === "throb") {
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.ellipse(50, 52, 22, 18, 0, 0, Math.PI * 2);
		ctx.stroke();
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.ellipse(50, 52, 34, 28, 0, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = color;
		const heart = new Path2D(HEART_PATH);
		ctx.save();
		ctx.translate(38, 38);
		ctx.scale(.24, .24);
		ctx.fill(heart);
		ctx.restore();
	} else if (id === "jets") {
		ctx.lineCap = "round";
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(36, 92);
		ctx.bezierCurveTo(22, 64, 44, 44, 24, 16);
		ctx.moveTo(64, 92);
		ctx.bezierCurveTo(78, 64, 56, 44, 76, 16);
		ctx.stroke();
		ctx.fillStyle = "#f3eee6";
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.ellipse(22, 12, 9, 7, -.3, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(78, 12, 9, 7, .3, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	} else if (id === "haa") {
		ctx.font = `400 28px ${SFX_STACK}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = color;
		ctx.strokeStyle = "#f3eee6";
		ctx.lineWidth = 7;
		ctx.save();
		ctx.translate(34, 70);
		ctx.rotate(-.28);
		ctx.strokeText("HAA", 0, 0);
		ctx.fillText("HAA", 0, 0);
		ctx.restore();
		ctx.save();
		ctx.translate(70, 32);
		ctx.rotate(-.12);
		ctx.strokeText("HAA", 0, 0);
		ctx.fillText("HAA", 0, 0);
		ctx.restore();
	} else if (id === "kiss") {
		ctx.fillStyle = color;
		ctx.strokeStyle = "#161412";
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.moveTo(18, 48);
		ctx.bezierCurveTo(28, 28, 50, 22, 50, 40);
		ctx.bezierCurveTo(50, 22, 72, 28, 82, 48);
		ctx.bezierCurveTo(70, 44, 58, 52, 50, 62);
		ctx.bezierCurveTo(42, 52, 30, 44, 18, 48);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(22, 50);
		ctx.bezierCurveTo(36, 58, 50, 46, 50, 46);
		ctx.bezierCurveTo(50, 46, 64, 58, 78, 50);
		ctx.stroke();
	} else if (id === "hearts") {
		ctx.fillStyle = color;
		const heart = new Path2D(HEART_PATH);
		for (const [x, y, sc, rot] of [
			[
				8,
				48,
				.38,
				-.2
			],
			[
				38,
				22,
				.28,
				.15
			],
			[
				64,
				4,
				.2,
				-.1
			]
		]) {
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(rot);
			ctx.scale(sc, sc);
			ctx.fill(heart);
			ctx.restore();
		}
	} else if (id === "flush") {
		ctx.fillStyle = color;
		ctx.globalAlpha = .45;
		ctx.beginPath();
		ctx.ellipse(22, 52, 16, 20, .15, 0, Math.PI * 2);
		ctx.ellipse(78, 52, 16, 20, -.15, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.strokeStyle = color;
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.ellipse(22, 52, 16, 20, .15, 0, Math.PI * 2);
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(78, 52, 16, 20, -.15, 0, Math.PI * 2);
		ctx.stroke();
	} else if (id === "drip") {
		ctx.fillStyle = color;
		ctx.strokeStyle = "#161412";
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.moveTo(50, 6);
		ctx.bezierCurveTo(78, 36, 78, 70, 50, 96);
		ctx.bezierCurveTo(22, 70, 22, 36, 50, 6);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#ffffff";
		ctx.beginPath();
		ctx.ellipse(40, 40, 6, 10, -.4, 0, Math.PI * 2);
		ctx.fill();
	} else if (id === "saliva") {
		ctx.strokeStyle = color;
		ctx.fillStyle = color;
		ctx.lineCap = "round";
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(28, 8);
		ctx.bezierCurveTo(18, 40, 70, 48, 48, 78);
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(48, 88, 9, 11, .1, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "#161412";
		ctx.lineWidth = 3;
		ctx.stroke();
	} else if (id === "swirl") {
		ctx.lineCap = "round";
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(78, 22);
		ctx.bezierCurveTo(96, 40, 84, 72, 54, 78);
		ctx.bezierCurveTo(18, 86, 10, 48, 34, 36);
		ctx.bezierCurveTo(54, 26, 62, 52, 44, 56);
		ctx.stroke();
		ctx.fillStyle = color;
		const heart = new Path2D(HEART_PATH);
		ctx.save();
		ctx.translate(70, 6);
		ctx.scale(.16, .16);
		ctx.fill(heart);
		ctx.restore();
	} else if (id === "skunk") {
		ctx.lineCap = "round";
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo(22, 88);
		ctx.bezierCurveTo(8, 50, 40, 34, 18, 8);
		ctx.moveTo(50, 90);
		ctx.bezierCurveTo(70, 52, 28, 30, 52, 6);
		ctx.moveTo(78, 84);
		ctx.bezierCurveTo(96, 48, 62, 28, 84, 10);
		ctx.stroke();
		ctx.fillStyle = color === "#6b7280" ? "#f3eee6" : color;
		ctx.strokeStyle = "#161412";
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.arc(50, 58, 16, Math.PI, 0);
		ctx.lineTo(64, 70);
		ctx.lineTo(58, 80);
		ctx.lineTo(42, 80);
		ctx.lineTo(36, 70);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#161412";
		ctx.beginPath();
		ctx.ellipse(44, 60, 3.5, 4.5, 0, 0, Math.PI * 2);
		ctx.ellipse(56, 60, 3.5, 4.5, 0, 0, Math.PI * 2);
		ctx.fill();
	} else if (id === "aroma") {
		ctx.lineCap = "round";
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo(22, 88);
		ctx.bezierCurveTo(8, 56, 40, 44, 24, 16);
		ctx.moveTo(50, 90);
		ctx.bezierCurveTo(34, 58, 68, 40, 52, 12);
		ctx.stroke();
		ctx.fillStyle = color;
		ctx.strokeStyle = "#161412";
		ctx.lineWidth = 3;
		for (let i = 0; i < 5; i++) {
			const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
			ctx.beginPath();
			ctx.ellipse(72 + Math.cos(a) * 10, 18 + Math.sin(a) * 10, 7, 5, a, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
		ctx.beginPath();
		ctx.arc(72, 18, 4, 0, Math.PI * 2);
		ctx.fillStyle = "#eab308";
		ctx.fill();
	} else if (id === "lust") {
		ctx.lineCap = "round";
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(22, 94);
		ctx.bezierCurveTo(8, 66, 36, 48, 16, 18);
		ctx.moveTo(50, 96);
		ctx.bezierCurveTo(34, 68, 66, 46, 48, 12);
		ctx.moveTo(78, 90);
		ctx.bezierCurveTo(94, 64, 62, 42, 84, 16);
		ctx.stroke();
		ctx.fillStyle = "#ff3d6e";
		const heart = new Path2D(HEART_PATH);
		ctx.save();
		ctx.translate(38, 36);
		ctx.scale(.26, .26);
		ctx.fill(heart);
		ctx.restore();
	} else if (id === "phew") {
		ctx.fillStyle = "#f3eee6";
		ctx.strokeStyle = color;
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.ellipse(36, 72, 20, 14, -.3, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(58, 42, 16, 12, .15, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(74, 16, 11, 9, .1, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	} else if (id === "chomp") {
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(12, 38);
		ctx.lineTo(28, 58);
		ctx.lineTo(44, 32);
		ctx.lineTo(60, 62);
		ctx.lineTo(76, 30);
		ctx.lineTo(90, 52);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(18, 78);
		ctx.lineTo(32, 58);
		ctx.lineTo(48, 82);
		ctx.lineTo(64, 56);
		ctx.lineTo(80, 80);
		ctx.stroke();
	} else if (id === "scratch") {
		ctx.lineCap = "round";
		ctx.lineWidth = 7;
		ctx.beginPath();
		ctx.moveTo(18, 78);
		ctx.quadraticCurveTo(40, 40, 86, 16);
		ctx.moveTo(12, 62);
		ctx.quadraticCurveTo(38, 30, 82, 8);
		ctx.moveTo(22, 92);
		ctx.quadraticCurveTo(46, 52, 90, 28);
		ctx.stroke();
	} else if (id === "wet") {
		ctx.fillStyle = color;
		ctx.strokeStyle = "#161412";
		ctx.lineWidth = 3.5;
		for (const [cx, cy, s] of [
			[
				32,
				62,
				1
			],
			[
				58,
				38,
				.72
			],
			[
				74,
				18,
				.5
			]
		]) {
			ctx.beginPath();
			ctx.moveTo(cx, cy - 16 * s);
			ctx.bezierCurveTo(cx + 14 * s, cy, cx + 10 * s, cy + 16 * s, cx, cy + 18 * s);
			ctx.bezierCurveTo(cx - 10 * s, cy + 16 * s, cx - 14 * s, cy, cx, cy - 16 * s);
			ctx.fill();
			ctx.stroke();
		}
	} else if (id === "moan") {
		ctx.lineCap = "round";
		ctx.lineWidth = 8;
		ctx.beginPath();
		ctx.moveTo(12, 78);
		ctx.bezierCurveTo(28, 58, 44, 96, 60, 78);
		ctx.moveTo(22, 48);
		ctx.bezierCurveTo(38, 28, 54, 66, 72, 46);
		ctx.moveTo(34, 20);
		ctx.bezierCurveTo(50, 2, 66, 38, 86, 18);
		ctx.stroke();
	} else if (id === "fog" || id === "mist" || id === "shower" || id === "bank") drawFogMark(ctx, id, color);
}
