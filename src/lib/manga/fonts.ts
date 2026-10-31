export type FontGroup = "manga" | "sans" | "serif" | "soft";

export type LetterFont = {
  id: string;
  label: string;
  stack: string;
  css: string;
  group: FontGroup;
  /** Manga display fonts keep the white outline on titles. */
  outline: boolean;
};

export const COMIC_STACK =
  `"M PLUS Rounded 1c", Nunito, "Comic Neue", "Comic Sans MS", sans-serif`;
export const SFX_STACK =
  `"Gochi Hand", "Permanent Marker", "Yomogi", "Comic Neue", cursive`;

/** Sound effects: round, bouncy chibi lettering. */
export const CHIBI_SFX_STACK =
  `"Mochiy Pop One", "M PLUS Rounded 1c", Nunito, sans-serif`;

export const LETTER_FONTS: readonly LetterFont[] = [
  {
    id: "comic",
    label: "Comic",
    stack: COMIC_STACK,
    css: "var(--font-comic)",
    group: "manga",
    outline: true,
  },
  {
    id: "sfx",
    label: "SFX",
    stack: CHIBI_SFX_STACK,
    css: "var(--font-sfx-chibi)",
    group: "manga",
    outline: true,
  },
  {
    id: "nunito",
    label: "Nunito",
    stack: `Nunito, "M PLUS Rounded 1c", sans-serif`,
    css: "var(--font-nunito)",
    group: "soft",
    outline: false,
  },
  {
    id: "quicksand",
    label: "Quicksand",
    stack: `Quicksand, Nunito, sans-serif`,
    css: "var(--font-quicksand)",
    group: "soft",
    outline: false,
  },
  {
    id: "outfit",
    label: "Outfit",
    stack: `Outfit, Inter, sans-serif`,
    css: "var(--font-outfit)",
    group: "sans",
    outline: false,
  },
  {
    id: "inter",
    label: "Inter",
    stack: `Inter, "Segoe UI", sans-serif`,
    css: "var(--font-sans)",
    group: "sans",
    outline: false,
  },
  {
    id: "karla",
    label: "Karla",
    stack: `Karla, Inter, sans-serif`,
    css: "var(--font-karla)",
    group: "sans",
    outline: false,
  },
  {
    id: "dm",
    label: "DM Sans",
    stack: `"DM Sans", Inter, sans-serif`,
    css: "var(--font-dm)",
    group: "sans",
    outline: false,
  },
  {
    id: "playfair",
    label: "Playfair",
    stack: `"Playfair Display", "Times New Roman", serif`,
    css: "var(--font-playfair)",
    group: "serif",
    outline: false,
  },
  {
    id: "lora",
    label: "Lora",
    stack: `Lora, Georgia, serif`,
    css: "var(--font-lora)",
    group: "serif",
    outline: false,
  },
  {
    id: "fraunces",
    label: "Fraunces",
    stack: `Fraunces, Georgia, serif`,
    css: "var(--font-fraunces)",
    group: "serif",
    outline: false,
  },
];

export const FONT_GROUPS: { id: FontGroup; label: string }[] = [
  { id: "manga", label: "Manga" },
  { id: "soft", label: "Friendly" },
  { id: "sans", label: "Clean" },
  { id: "serif", label: "Editorial" },
];

export function letterFont(id?: string | null): LetterFont {
  return LETTER_FONTS.find((f) => f.id === id) ?? LETTER_FONTS[0]!;
}

export function defaultFontId(kind?: string): string {
  if (kind === "sfx") return "sfx";
  if (kind === "text") return "lora";
  return "comic";
}

export function overlayFontCss(kind?: string, fontId?: string | null): string {
  return letterFont(fontId || defaultFontId(kind)).css;
}

export function canvasFont(
  px: number,
  bold: boolean,
  italic: boolean,
  fontId?: string | null,
  kind?: string,
): string {
  const spec = letterFont(fontId || defaultFontId(kind));
  const weight = spec.id === "sfx" ? 400 : bold ? 800 : 500;
  return `${italic ? "italic " : ""}${weight} ${px}px ${spec.stack}`;
}

export function titleUsesOutline(kind?: string, fontId?: string | null): boolean {
  if (kind !== "title") return false;
  return letterFont(fontId || defaultFontId(kind)).outline;
}

export async function ensureLetterFonts() {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all(
      [
        `400 24px "M PLUS Rounded 1c"`,
        `700 24px "M PLUS Rounded 1c"`,
        `800 24px "M PLUS Rounded 1c"`,
        `italic 400 24px "M PLUS Rounded 1c"`,
        `400 24px Nunito`,
        `700 24px Nunito`,
        `italic 400 24px Nunito`,
        `400 24px "Comic Neue"`,
        `700 24px "Comic Neue"`,
        `400 48px "Gochi Hand"`,
        `400 48px "Permanent Marker"`,
        `400 48px Yomogi`,
        `400 24px Outfit`,
        `700 24px Outfit`,
        `500 24px Quicksand`,
        `700 24px Quicksand`,
        `400 24px Inter`,
        `600 24px Inter`,
        `400 24px Karla`,
        `700 24px Karla`,
        `400 24px "DM Sans"`,
        `700 24px "DM Sans"`,
        `500 36px "Playfair Display"`,
        `700 36px "Playfair Display"`,
        `italic 500 36px "Playfair Display"`,
        `400 24px Lora`,
        `700 24px Lora`,
        `italic 400 24px Lora`,
        `500 36px Fraunces`,
        `700 36px Fraunces`,
      ].map((spec) => document.fonts.load(spec)),
    );
  } catch {
    /* fonts are progressive */
  }
}
