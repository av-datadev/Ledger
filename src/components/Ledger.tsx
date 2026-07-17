import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { MODES, PAYERS } from "../../shared/constants";
import { useCategories } from "../hooks/useCategories";
import { useBackClose } from "../hooks/useBackClose";
import { inr, formatDate } from "../lib/format";
import { toCsv, downloadFile, timestampSlug } from "../lib/csv";
import { EntryForm } from "./EntryForm";
import type { Entry } from "../types";

/** Filter hand-off from other tabs (dashboard drill-down, People tab). */
export interface LedgerPreset {
  category?: string;
  paidBy?: string;
  seq: number; // changes on every hand-off so repeat taps re-apply
}

function EditOverlay({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
}) {
  const requestClose = useBackClose(true, onClose);
  return (
    <div className="fixed inset-0 z-40 bg-paper overflow-y-auto">
      <EntryForm initial={entry} onDone={requestClose} onCancel={requestClose} />
    </div>
  );
}

export function Ledger({ preset }: { preset: LedgerPreset | null }) {
  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const categories = useCategories();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);

  // Apply a hand-off filter whenever one arrives (seq changes each time).
  useEffect(() => {
    if (!preset) return;
    setSearch("");
    setCategory(preset.category ?? "");
    setPaidBy(preset.paidBy ?? "");
    setMode("");
  }, [preset]);

  const visible = useMemo(() => {
    if (!entries) return [];
    const q = search.trim().toLowerCase();
    return entries
      .filter((e) => (category ? e.category === category : true))
      .filter((e) => (mode ? e.mode === mode : true))
      .filter((e) => (paidBy ? e.paidBy === paidBy : true))
      .filter((e) => {
        if (!q) return true;
        // Search matches text fields AND the date, both as typed (2026-07-03)
        // and as displayed (3 Jul 26).
        return [
          e.event,
          e.detail,
          e.notes,
          e.paidBy,
          e.mode,
          e.category,
          e.date,
          formatDate(e.date),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) =>
        a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
      );
  }, [entries, search, category, mode, paidBy]);

  const exportCsv = () => {
    const headers = [
      "date",
      "category",
      "event",
      "detail",
      "amount",
      "mode",
      "paidBy",
      "notes",
    ];
    downloadFile(
      `house-ledger-entries-${timestampSlug()}.csv`,
      toCsv(headers, visible as unknown as Record<string, unknown>[]),
      "text/csv",
    );
  };

  const visibleTotal = visible.reduce((s, e) => s + e.amount, 0);
  const filtered = !!(search.trim() || category || mode || paidBy);

  return (
    <div className="px-4 py-4">
      <input
        className="input mb-2"
        placeholder="Search — name, detail, date (e.g. 3 Jul), payer…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex gap-1.5 mb-3">
        <select
          className="input flex-1 !px-2 !text-[13px]"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">Category: all</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select
          className="input flex-1 !px-2 !text-[13px]"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          aria-label="Filter by payment mode"
        >
          <option value="">Mode: all</option>
          {MODES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select
          className="input flex-1 !px-2 !text-[13px]"
          value={paidBy}
          onChange={(e) => setPaidBy(e.target.value)}
          aria-label="Filter by payer"
        >
          <option value="">Paid by: all</option>
          {PAYERS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between mb-3 text-[13px] text-ink-soft">
        <span>
          {visible.length} shown · <span className="money">{inr(visibleTotal)}</span>
        </span>
        <div className="flex gap-1.5">
          {filtered && (
            <button
              className="btn !py-1.5 !px-3 !text-[13px]"
              onClick={() => {
                setSearch("");
                setCategory("");
                setMode("");
                setPaidBy("");
              }}
            >
              Clear
            </button>
          )}
          <button className="btn !py-1.5 !px-3 !text-[13px]" onClick={exportCsv}>
            Backup CSV
          </button>
        </div>
      </div>

      <div className="bg-white border border-rule rounded-md divide-y divide-rule">
        {visible.map((e) => (
          <div key={e.id} className="px-3 py-2.5">
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
                  <span>{e.mode}</span>
                  <span>· {e.paidBy}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="money font-semibold">{inr(e.amount)}</div>
                {confirmId === e.id ? (
                  <div className="flex gap-1 mt-1">
                    <button
                      className="text-[11px] text-white bg-crimson rounded px-2 py-0.5"
                      onClick={() => {
                        void db.entries.delete(e.id);
                        setConfirmId(null);
                      }}
                    >
                      Delete
                    </button>
                    <button
                      className="text-[11px] border border-rule rounded px-2 py-0.5"
                      onClick={() => setConfirmId(null)}
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-1 justify-end">
                    <button
                      className="text-[11px] text-ink-soft underline underline-offset-2"
                      onClick={() => setEditing(e)}
                    >
                      edit
                    </button>
                    <button
                      className="text-[11px] text-crimson"
                      onClick={() => setConfirmId(e.id)}
                    >
                      delete
                    </button>
                  </div>
                )}
              </div>
            </div>
            {e.notes && (
              <div className="text-[12px] text-ink-soft mt-1 italic">
                {e.notes}
              </div>
            )}
          </div>
        ))}
        {entries && visible.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-ink-soft">
            No entries match.
          </div>
        )}
      </div>

      {editing && (
        <EditOverlay entry={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
