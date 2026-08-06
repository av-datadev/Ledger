import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";

export type AppMode = "builder" | "contractor";

const KEY = "hl-app-mode";

function readMode(): AppMode | null {
  const v = localStorage.getItem(KEY);
  return v === "builder" || v === "contractor" ? v : null;
}

/**
 * Decides whether a device sees the "home builder or contractor?" role gate.
 *
 * The gate exists only for a genuinely fresh device — no local ledger entries
 * and no signed-in session. Any device that already has data or a session
 * (every existing Brick Book user right now) is auto-set to "builder" and
 * never sees the gate at all, so this ships with zero disruption to daily use.
 * Once a choice is made (auto or explicit), it's remembered — asked at most
 * once per device.
 */
export function useAppMode(
  hasSession: boolean,
  authLoading: boolean,
): { mode: AppMode | null; settled: boolean; choose: (m: AppMode) => void } {
  const [mode, setMode] = useState<AppMode | null>(readMode);
  const entryCount = useLiveQuery(() => db.entries.count(), []);

  const choose = (m: AppMode) => {
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* private mode / storage disabled — choice still applies this session */
    }
    setMode(m);
  };

  useEffect(() => {
    if (mode) return; // already decided (explicitly or previously auto-set)
    if (authLoading || entryCount === undefined) return; // still resolving
    if (hasSession || entryCount > 0) choose("builder"); // an existing user
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hasSession, authLoading, entryCount]);

  const settled = mode !== null || (!authLoading && entryCount !== undefined);
  return { mode, settled, choose };
}
