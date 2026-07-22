import { useCallback, useEffect, useState } from "react";

// Discrete zoom levels. Because the UI is built with hardcoded px sizes in many
// places, scaling the root font-size alone wouldn't touch them — zooming the
// document root scales every length uniformly (text, controls, spacing) and
// leaves the sticky header/tab-bar correctly positioned.
export const TEXT_SCALES = [
  { label: "S", value: 0.9 },
  { label: "M", value: 1.0 },
  { label: "L", value: 1.1 },
  { label: "XL", value: 1.25 },
] as const;

const KEY = "hl-text-scale";
const DEFAULT = 1.0;

function readScale(): number {
  const raw = Number(localStorage.getItem(KEY));
  return TEXT_SCALES.some((s) => s.value === raw) ? raw : DEFAULT;
}

/** App text/zoom scale, persisted in localStorage (a UI preference, not data). */
export function useTextScale(): {
  scale: number;
  setScale: (value: number) => void;
} {
  const [scale, setScale] = useState<number>(() => {
    try {
      return readScale();
    } catch {
      return DEFAULT;
    }
  });

  // Apply as an effect (not in the updater) so it stays pure and survives
  // StrictMode's double-invocation. Idempotent.
  useEffect(() => {
    document.documentElement.style.zoom = String(scale);
    try {
      localStorage.setItem(KEY, String(scale));
    } catch {
      /* private mode / storage disabled — scale still applies this session */
    }
  }, [scale]);

  return { scale, setScale: useCallback((v: number) => setScale(v), []) };
}
