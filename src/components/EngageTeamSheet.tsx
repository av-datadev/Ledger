import { useEffect, useMemo, useRef, useState } from "react";
import { useBackClose } from "../hooks/useBackClose";
import { engageTeam, type EngageCandidate, type EngageResult } from "../lib/engage";

/**
 * "I've hired them" — the one crossing from the public directory into the
 * private ledger.
 *
 * Everything the sheet does is local: it writes Dexie rows on this device. It
 * sends nothing to the directory, and it does not notify the people being
 * added. The note says so, because a screen that quietly contacted a stranger
 * on your behalf would be the single worst surprise this app could spring.
 *
 * Each person arrives with their trade already linked, so a payment recorded
 * against them counts towards that trade from the first entry — which is the
 * whole reason to add them here rather than typing the names in later.
 */
export function EngageTeamSheet({
  firmName,
  candidates,
  onClose,
}: {
  firmName: string;
  candidates: EngageCandidate[];
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const requestClose = useBackClose(true, onClose);

  // Everyone is checked to start — the common case is hiring the whole team.
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(candidates.map((c) => c.name)),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EngageResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const chosen = useMemo(
    () => candidates.filter((c) => picked.has(c.name)),
    [candidates, picked],
  );

  const toggle = (name: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await engageTeam(chosen));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add them.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => requestClose()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${firmName}'s team to your people`}
        className="absolute inset-x-0 bottom-0 bg-surface rounded-t-lg shadow-float
                   max-h-[85dvh] overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <div className="w-9 h-1 rounded-full bg-rule-strong mx-auto mb-3" />

        {result ? (
          <div className="space-y-3">
            <h2 className="text-[17px] font-semibold">
              {result.added.length > 0
                ? `Added ${result.added.length} ${result.added.length === 1 ? "person" : "people"}`
                : "Nothing to add"}
            </h2>
            {result.added.length > 0 && (
              <p className="text-[13px] text-ink-soft">
                {result.added.join(", ")} now appear in People, and in every
                category dropdown.
              </p>
            )}
            {result.skipped.length > 0 && (
              <p className="text-[13px] text-ink-soft">
                Already in your list, left as they were:{" "}
                {result.skipped.join(", ")}.
              </p>
            )}
            {result.tradeTaken.length > 0 && (
              <div className="rounded-md bg-paper-2 p-3 space-y-1">
                {result.tradeTaken.map((t) => (
                  <p key={t.name} className="text-[13px] text-ink-soft">
                    <b className="text-ink">{t.name}</b> was added, but{" "}
                    <b className="text-ink">{t.trade}</b> is already linked to{" "}
                    {t.heldBy}. A trade can only point at one person — otherwise
                    the ledger could not say which of them a payment was for.
                    Change it in People if {t.name} is the one doing that work.
                  </p>
                ))}
              </div>
            )}
            <button
              className="btn btn-primary w-full !py-3 !text-base"
              onClick={() => requestClose()}
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-[17px] font-semibold">
              Add this team to your people?
            </h2>
            <p className="text-[13px] text-ink-soft">
              Each one is added with their trade already linked, so payments you
              record against them count towards that trade from the first entry.
            </p>

            <div className="divide-y divide-rule">
              {candidates.map((c) => {
                const on = picked.has(c.name);
                return (
                  <label
                    key={c.name}
                    className="flex items-center gap-3 py-2.5 min-h-11 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="w-[18px] h-[18px] accent-crimson shrink-0"
                      checked={on}
                      onChange={() => toggle(c.name)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-[13px] font-medium">{c.name}</span>
                      <span className="text-[12px] text-ink-soft"> · {c.trade}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="rounded-md bg-paper-2 p-3">
              <p className="text-[12px] text-ink-soft">
                Saved on this device only. Adding someone here does not tell them
                anything, and sends nothing back to the directory.
              </p>
            </div>

            {error && <p className="text-[13px] text-danger">{error}</p>}

            <div className="flex gap-2">
              <button
                ref={cancelRef}
                className="btn flex-1 !py-3 !text-base"
                onClick={() => requestClose()}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary flex-[1.4] !py-3 !text-base"
                onClick={() => void add()}
                disabled={busy || chosen.length === 0}
              >
                {busy
                  ? "Adding…"
                  : `Add ${chosen.length} ${chosen.length === 1 ? "person" : "people"}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
