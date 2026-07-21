import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useBackClose } from "../hooks/useBackClose";
import { inr, formatDate } from "../lib/format";
import { EntryForm } from "./EntryForm";
import type { Entry } from "../types";

function EditOverlay({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const requestClose = useBackClose(true, onClose);
  return (
    <div className="fixed inset-0 z-40 bg-paper overflow-y-auto">
      <EntryForm initial={entry} onDone={requestClose} onCancel={requestClose} />
    </div>
  );
}

/** Human-friendly "how long ago" for a timestamp. */
function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return formatDate(new Date(ts).toISOString().slice(0, 10));
}

const RECENT_LIMIT = 50;
// An entry counts as "edited" (vs just added) if its updatedAt is meaningfully
// later than createdAt — a small gap absorbs same-tick save jitter.
const EDIT_GAP_MS = 2000;

export function Recent() {
  const entries = useLiveQuery(
    () => db.entries.orderBy("updatedAt").reverse().limit(RECENT_LIMIT).toArray(),
    [],
  );
  // Which entries have photos — read only the entryId index, not the blobs.
  const photoKeys = useLiveQuery(
    () => db.attachments.orderBy("entryId").keys(),
    [],
  );
  const withPhotos = useMemo(
    () => new Set((photoKeys ?? []) as string[]),
    [photoKeys],
  );
  const [editing, setEditing] = useState<Entry | null>(null);

  return (
    <div className="px-4 py-4 max-w-lg mx-auto">
      <h2 className="text-base font-semibold mb-1">Recently updated</h2>
      <p className="text-[13px] text-ink-soft mb-3">
        The {RECENT_LIMIT} most recently added or edited entries, newest first.
        Tap any entry to edit it.
      </p>

      <div className="bg-surface border border-rule rounded-md divide-y divide-rule">
        {entries?.map((e) => {
          const edited = e.updatedAt - e.createdAt > EDIT_GAP_MS;
          return (
            <button
              key={e.id}
              className="w-full text-left px-3 py-2.5 active:bg-ink/5"
              onClick={() => setEditing(e)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{e.event}</div>
                  {e.detail && (
                    <div className="text-[12px] text-ink-soft truncate">
                      {e.detail}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-ink-soft">
                    <span className="money">{formatDate(e.date)}</span>
                    <span className="badge">{e.category}</span>
                    <span>· {e.paidBy}</span>
                    {withPhotos.has(e.id) && <span className="badge">📎</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="money font-semibold">{inr(e.amount)}</div>
                  <div className="text-[10px] text-ink-soft mt-1">
                    {edited ? "edited" : "added"} {relTime(e.updatedAt)}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
        {entries && entries.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-ink-soft">
            No entries yet — add one from the Entry tab.
          </div>
        )}
      </div>

      {editing && (
        <EditOverlay entry={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
