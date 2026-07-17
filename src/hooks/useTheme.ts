import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "hl-theme";

function readTheme(): Theme {
  // The inline script in index.html has already set this before first paint.
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

/** Light/dark theme, persisted in localStorage (a UI preference, not data). */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(readTheme);

  // Apply as an effect (not inside the state updater) so it stays a pure
  // update and survives StrictMode's double-invocation. apply() is idempotent.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode / storage disabled — theme still applies this session */
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "dark" ? "#0b1015" : "#182B3A");
    }
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((prev) => (prev === "dark" ? "light" : "dark")),
    [],
  );

  return { theme, toggle };
}
