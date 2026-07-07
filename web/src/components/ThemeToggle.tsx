import { useState } from "react";
import { applyTheme, currentTheme, type Theme } from "../lib/theme";

/** Quiet header control: the label names the theme it switches TO. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      title={`Switch to ${next} mode`}
      className="btn95 bg-surface px-2.5 py-2 font-mono text-[0.6875rem] text-text"
    >
      <span aria-hidden="true">■</span> {next}
    </button>
  );
}
