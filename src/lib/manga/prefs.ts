import type { PaperTone } from "./types";
import type { PaperSizeId } from "./paper";

export const PREFS_KEY = "koma-prefs-v1";
export const THEME_KEY = "koma-theme";

export type StudioPrefs = {
  theme: "light" | "dark";
  paper: PaperTone;
  paperSize: PaperSizeId;
  gutter: number;
  margin: number;
  border: number;
  bleed: number;
  rtl: boolean;
  showNumbers: boolean;
  spread: boolean;
  snapEdges: boolean;
  /** Hand-drawn (G-pen) balloon ink on screen and in export; false draws clean geometric lines. */
  handInk: boolean;
  thumbs: boolean;
  updatedAt?: number;
  exportFormat?: "png" | "jpeg" | "pdf" | "cbz" | "strip" | "canvas";
  exportRange?: "page" | "spread" | "chapter" | "all";
  exportTwoUp?: boolean;
};

function isTheme(v: unknown): v is "light" | "dark" {
  return v === "light" || v === "dark";
}

export function readPrefs(): Partial<StudioPrefs> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StudioPrefs>) : {};
    const prefs = parsed && typeof parsed === "object" ? { ...parsed } : {};
    if (!isTheme(prefs.theme)) {
      const lone = localStorage.getItem(THEME_KEY);
      if (isTheme(lone)) prefs.theme = lone;
    }
    return prefs;
  } catch {
    try {
      const lone = localStorage.getItem(THEME_KEY);
      return isTheme(lone) ? { theme: lone } : {};
    } catch {
      return {};
    }
  }
}

function syncDesktopPrefs(prefs: Partial<StudioPrefs>) {
  if (typeof window === "undefined") return;
  if (window.location.port !== "47821") return;
  try {
    void fetch("/__prefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prefs),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* desktop shell unavailable */
  }
}

let desktopSyncTimer: number | undefined;
let lastSyncedTheme: string | undefined;

export function writePrefs(prefs: Partial<StudioPrefs>) {
  if (typeof window === "undefined") return;
  try {
    const next: Partial<StudioPrefs> = {
      ...readPrefs(),
      ...prefs,
      updatedAt: Date.now(),
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    if (isTheme(next.theme)) localStorage.setItem(THEME_KEY, next.theme);
    const themeChanged = isTheme(next.theme) && next.theme !== lastSyncedTheme;
    lastSyncedTheme = next.theme;
    if (themeChanged) {
      if (desktopSyncTimer != null) window.clearTimeout(desktopSyncTimer);
      syncDesktopPrefs(next);
    } else {
      if (desktopSyncTimer != null) window.clearTimeout(desktopSyncTimer);
      desktopSyncTimer = window.setTimeout(() => syncDesktopPrefs(next), 400);
    }
  } catch {
    /* quota / private mode */
  }
}

export function applyTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#1c1c1e" : "#ececee");
}
