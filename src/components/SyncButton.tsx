import { useEffect, useState } from "react";
import { useSyncStatus, agoLabel } from "../hooks/useSyncStatus";

/**
 * Pull the shared ledger again, on demand.
 *
 * Only rendered when a household is actually active — with no shared ledger
 * there is nothing to fetch, and a button that visibly does nothing is worse
 * than no button. The label carries the last pull time so the answer to "is
 * this up to date?" is on screen rather than something to find out by pressing.
 */
export function SyncButton() {
  const { state, lastSyncedAt, error, refresh } = useSyncStatus(true);
  // Re-render on a timer so "just now" becomes "5 min ago" without needing an
  // interaction to trigger it.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const busy = state === "syncing";
  const label =
    state === "syncing" ? "Checking…"
    : state === "done" ? "Up to date"
    : state === "error" ? "Try again"
    : "Refresh";

  return (
    <div className="shrink-0 text-right">
      <button
        className={`inline-flex items-center gap-1.5 rounded-full border border-onhead/25 px-3 py-1.5 text-[12px] text-onhead/90 disabled:opacity-60 ${
          state === "done" ? "border-moss/60" : ""
        }`}
        onClick={refresh}
        disabled={busy}
        aria-label="Check for entries added on other phones"
      >
        <svg
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          className={busy ? "animate-spin" : ""}
          aria-hidden="true"
        >
          <path d="M20 11a8 8 0 1 0-.6 4" />
          <path d="M20 4v7h-7" />
        </svg>
        {label}
      </button>
      {/* Errors matter more than the timestamp, so they replace it. */}
      {error ? (
        <div className="text-[10px] text-onhead/70 mt-1 max-w-[8.5rem] leading-tight">
          {error}
        </div>
      ) : (
        lastSyncedAt !== null && (
          <div className="text-[10px] text-onhead/50 mt-1">
            Synced {agoLabel(lastSyncedAt)}
          </div>
        )
      )}
    </div>
  );
}
