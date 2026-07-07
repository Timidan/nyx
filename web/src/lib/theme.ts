export type Theme = "light" | "dark";

const STORAGE_KEY = "nyx.theme";

/** The theme currently applied to <html> (set pre-paint by index.html). */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Apply + persist a theme choice. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage blocked: the choice still applies for this session
  }
}
