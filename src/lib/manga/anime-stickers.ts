export type AnimeSticker = {
  id: string;
  label: string;
  src: string;
  tags?: string;
  w?: number;
  h?: number;
};

export const ANIME_STICKER_GROUP = "Chibi stickers";

export const ANIME_STICKERS: AnimeSticker[] = [
  {
    id: "anime-steam",
    label: "Steam plume",
    src: "/stickers/anime/steam.webp",
    tags: "condensation fog vapor wispy white micro-droplet 4k anime steam plume",
    w: 16,
    h: 32,
  },
  {
    id: "anime-wisps",
    label: "Food steam",
    src: "/stickers/anime/wisps.webp",
    tags: "bowl ramen hot rising ribbons vapor",
    w: 17,
    h: 35,
  },
  {
    id: "anime-fog",
    label: "Fog bank",
    src: "/stickers/anime/fog.webp",
    tags: "shower steam room mist bath onsen",
    w: 47,
    h: 17,
  },
  {
    id: "anime-breath",
    label: "Breath puffs",
    src: "/stickers/anime/breath.webp",
    tags: "mouth steam haa puff warm",
    w: 25,
    h: 16,
  },
  {
    id: "anime-chill",
    label: "Chills",
    src: "/stickers/anime/chill.webp",
    tags: "cold shiver gloom winter icy snow scared",
    w: 18,
    h: 26,
  },
  {
    id: "anime-smoke",
    label: "Smoke wisp",
    src: "/stickers/anime/smoke.webp",
    tags: "incense vapor trail thin curl",
    w: 10,
    h: 32,
  },
  {
    id: "anime-aura",
    label: "Heat aura",
    src: "/stickers/anime/aura.webp",
    tags: "shimmer hot wavy haze blush",
    w: 19,
    h: 29,
  },
  {
    id: "anime-sparkle",
    label: "Sparkles",
    src: "/stickers/anime/sparkle.webp",
    tags: "kira shine glitter star",
    w: 22,
    h: 22,
  },
  {
    id: "anime-glint",
    label: "Glint",
    src: "/stickers/anime/glint.webp",
    tags: "eye shine star flare",
    w: 16,
    h: 16,
  },
  {
    id: "anime-heart",
    label: "Heart",
    src: "/stickers/anime/heart.webp",
    tags: "love pink glossy",
    w: 17,
    h: 17,
  },
  {
    id: "anime-blush",
    label: "Blush",
    src: "/stickers/anime/blush.webp",
    tags: "cheeks flush embarrassed",
    w: 37,
    h: 8,
  },
  {
    id: "anime-sweat",
    label: "Sweat drop",
    src: "/stickers/anime/sweat.webp",
    tags: "nervous drop",
    w: 15,
    h: 19,
  },
  {
    id: "anime-tear",
    label: "Tear",
    src: "/stickers/anime/tear.webp",
    tags: "cry drop shiny",
    w: 15,
    h: 23,
  },
  {
    id: "anime-vein",
    label: "Anger vein",
    src: "/stickers/anime/vein.webp",
    tags: "pop temper mark cross",
    w: 20,
    h: 20,
  },
  {
    id: "anime-petals",
    label: "Petals",
    src: "/stickers/anime/petals.webp",
    tags: "sakura cherry blossom",
    w: 22,
    h: 26,
  },
  {
    id: "anime-flower",
    label: "Flower",
    src: "/stickers/anime/flower.webp",
    tags: "happy bloom cute",
    w: 14,
    h: 18,
  },
  {
    id: "anime-impact",
    label: "Impact",
    src: "/stickers/anime/impact.webp",
    tags: "burst star hit flash",
    w: 24,
    h: 24,
  },
  {
    id: "anime-shock",
    label: "Shock lines",
    src: "/stickers/anime/shock.webp",
    tags: "startle surprise hatch",
    w: 20,
    h: 20,
  },
  {
    id: "anime-zzz",
    label: "Sleep",
    src: "/stickers/anime/zzz.webp",
    tags: "zzz sleepy snore",
    w: 22,
    h: 18,
  },
  {
    id: "anime-notes",
    label: "Notes",
    src: "/stickers/anime/notes.webp",
    tags: "music song humming",
    w: 16,
    h: 20,
  },
];

export function animeStickerBySrc(src?: string): AnimeSticker | undefined {
  if (!src) return undefined;
  return ANIME_STICKERS.find((s) => s.src === src);
}

export function animeStickerSize(src?: string): { w: number; h: number } {
  const hit = animeStickerBySrc(src);
  return { w: hit?.w ?? 22, h: hit?.h ?? 24 };
}

/** True for one of the built-in chibi sticker images. */
export function isAnimeStickerSrc(src?: string): boolean {
  return Boolean(src && ANIME_STICKERS.some((s) => s.src === src));
}
