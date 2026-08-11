import { useCallback, useEffect, useRef, useState } from "react";
import { resyncNow, currentHouseholdId } from "../lib/sync";

export type SyncState = "idle" | "syncing" | "done" | "error";

/** How stale a pull has to be before coming back to the app triggers another.
 * Short enough that a phone picked up after lunch refreshes, long enough that
 * flicking between apps doesn't re-pull the whole ledger every few seconds. */
const STALE_AFTER_MS = 30_000;

/**
 * Drives the Dashboard's refresh control, and quietly does the same thing when
 * the app is brought back to the foreground.
 *
 * The manual button is the visible half. The automatic half is the actual fix:
 * sync pulls once at startup and then depends on a realtime channel, which a
 * sleeping phone or a network change can kill silently — so an entry added on
 * one phone could sit unseen on another until the app was fully restarted.
 * Nobody should have to know to press a button for their own ledger to be
 * right, so returning to the app re-pulls too.
 */
export function useSyncStatus(enabled: boolean) {
  const [state, setState] = useState<SyncState>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastRunRef = useRef(0);
  // Survives unmount (tab switches) so a returning user doesn't re-pull just
  // because the Dashboard was rebuilt.
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (manual: boolean) => {
      if (!enabled || !currentHouseholdId()) return;
      lastRunRef.current = Date.now();
      if (manual) {
        setState("syncing");
        setError(null);
      }
      try {
        await resyncNow();
        setLastSyncedAt(Date.now());
        if (manual) {
          setState("done");
          if (doneTimer.current) clearTimeout(doneTimer.current);
          doneTimer.current = setTimeout(() => setState("idle"), 2500);
        }
      } catch (err) {
        // A background pull failing is not worth shouting about — the phone is
        // probably just offline, and the local ledger is still correct.
        if (manual) {
          setState("error");
          setError(
            err instanceof Error && /fetch|network/i.test(err.message)
              ? "No connection. Your entries are safe on this phone."
              : "Couldn't reach the shared ledger. Try again in a moment.",
          );
        }
      }
    },
    [enabled],
  );

  const refresh = useCallback(() => void run(true), [run]);

  useEffect(() => {
    if (!enabled) return;

    const maybeRun = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRunRef.current < STALE_AFTER_MS) return;
      void run(false);
    };

    // Coming back to the app is the moment a dropped realtime channel matters.
    document.addEventListener("visibilitychange", maybeRun);
    // Regaining signal is the other one.
    window.addEventListener("online", maybeRun);
    return () => {
      document.removeEventListener("visibilitychange", maybeRun);
      window.removeEventListener("online", maybeRun);
    };
  }, [enabled, run]);

  useEffect(
    () => () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    },
    [],
  );

  return { state, lastSyncedAt, error, refresh };
}

/** "just now" / "5 min ago" / "2 h ago" — deliberately coarse. */
export function agoLabel(at: number | null): string {
  if (!at) return "";
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} h ago`;
}
