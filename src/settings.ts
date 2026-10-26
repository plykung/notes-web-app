// Per-device preferences. Browser storage is fine here: losing them only
// resets the defaults.

export type Language = "en" | "th";
export type Theme = "system" | "light" | "dark";

export type Settings = {
  /** Lines of each note shown on the main page; 0 shows the whole note. */
  previewLines: number;
  /** Download every note's images after a sync, so they're there offline. */
  offlineImages: boolean;
  /** Seconds of no typing before an open note saves to the device. */
  autosaveSeconds: number;
  /** Seconds of no changes before saved edits go to Microsoft; 0 = only when the note closes. */
  syncDelaySeconds: number;
  theme: Theme;
  language: Language;
  pinnedCollapsed: boolean;
  /** Show a toast for new Releases. Releases that need a reload or reinstall always show one. */
  updateToasts: boolean;
};

const KEY = "notes-settings";
const DEFAULTS: Settings = {
  previewLines: 5,
  offlineImages: true,
  autosaveSeconds: 1.5,
  syncDelaySeconds: 10,
  theme: "system",
  language: navigator.language?.toLowerCase().startsWith("th") ? "th" : "en",
  pinnedCollapsed: false,
  updateToasts: true,
};

// Read often (every piece of translated text), so kept in memory.
let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;
  try {
    cached = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached!;
}

export function saveSettings(next: Partial<Settings>): Settings {
  const merged = { ...getSettings(), ...next };
  cached = merged;
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    // Private mode or storage blocked: the change still applies until reload.
  }
  return merged;
}

/** Light, dark, or follow the device; set on <html> so pop-out windows can copy it. */
export function applyTheme(doc = document) {
  const { theme } = getSettings();
  if (theme === "system") delete doc.documentElement.dataset.theme;
  else doc.documentElement.dataset.theme = theme;
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][media]')) {
    const dark = meta.media.includes("dark");
    // A forced theme makes both tags (light and dark device) show that theme.
    meta.content = theme === "system" ? (dark ? "#1b1b1d" : "#f4f3ef") : theme === "dark" ? "#1b1b1d" : "#f4f3ef";
  }
}
