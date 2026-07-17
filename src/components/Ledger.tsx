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

type FilterKey = "category" | "mode" | "paidBy";

function EditOverlay({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const requestClose = useBackClose(true, onClose);
  return (
    <div className="fixed inset-0 z-40 bg-paper overflow-y-auto">
      <EntryForm initial={entry} onDone={requestClose} onCancel={requestClose} />
    </div>
  );
}

function summarize(label: string, sel: string[]): string {
  if (sel.length === 0) return `${label}: all`;
  if (sel.length === 1) return sel[0];
  return `${sel[0]} +${sel.length - 1}`;
}

export function Ledger({ preset }: { preset: LedgerPreset | null }) {
  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const categories = useCategories();
  const [search, setSearch] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [modes, setModes] = useState<string[]>([]);
  const [payers, setPayers] = useState<string[]>([]);
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);

  // Apply a hand-off filter whenever one arrives (seq changes each time).
  useEffect(() => {
    if (!preset) return;
    setSearch("");
    setCats(preset.category ? [preset.category] : []);
    setPayers(preset.paidBy ? [preset.paidBy] : []);
    setModes([]);
    setOpenFilter(null);
  }, [preset]);

  const visible = useMemo(() => {
    if (!entries) return [];
    const q = search.trim().toLowerCase();
    return entries
      .filter((e) => cats.length === 0 || cats.includes(e.category))
      .filter((e) => modes.length === 0 || modes.includes(e.mode))
      .filter((e) => payers.length === 0 || payers.includes(e.paidBy))
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
  }, [entries, search, cats, modes, payers]);

  const filters: {
    key: FilterKey;
    label: string;
    options: readonly string[];
    sel: string[];
    set: (v: string[]) => void;
  }[] = [
    { key: "category", label: "Category", options: categories, sel: cats, set: setCats },
    { key: "mode", label: "Mode", options: MODES, sel: modes, set: setModes },
    { key: "paidBy", label: "Paid by", options: PAYERS, sel: payers, set: setPayers },
  ];
  const active = filters.find((f) => f.key === openFilter);

  const toggleOption = (f: (typeof filters)[number], opt: string) => {
    f.set(f.sel.includes(opt) ? f.sel.filter((x) => x !== opt) : [...f.sel, opt]);
  };

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
  const filtered = !!(search.trim() || cats.length || modes.length || payers.length);

  return (
    <div className="px-4 py-4">
      <input
        className="input mb-2"
        placeholder="Search — name, detail, date (e.g. 3 Jul), payer…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Multi-select filters: tick any combination in each dropdown. */}
      <div className="relative mb-3">
        <div className="flex gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              className={`input flex-1 !px-2 !text-[13px] flex items-center justify-between gap-1 ${
                f.sel.length ? "!border-ink" : ""
              }`}
              onClick={() =>
                setOpenFilter((o) => (o === f.key ? null : f.key))
              }
              aria-expanded={openFilter === f.key}
            >
              <span className="truncate">{summarize(f.label, f.sel)}</span>
              <span className="text-ink-soft shrink-0">▾</span>
            </button>
          ))}
        </div>

        {active && (
          <>
            {/* tap-away backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpenFilter(null)}
            />
            <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface border border-rule rounded-md max-h-64 overflow-y-auto shadow-lg">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-rule sticky top-0 bg-surface">
                <span className="text-[11px] uppercase tracking-[0.1em] text-ink-soft">
                  {active.label} — tick any
                </span>
                <div className="flex gap-2">
                  {active.sel.length > 0 && (
                    <button
                      className="text-[12px] text-crimson"
                      onClick={() => active.set([])}
                    >
                      clear
                    </button>
                  )}
                  <button
                    className="text-[12px] text-ink-soft"
                    onClick={() => setOpenFilter(null)}
                  >
                    done
                  </button>
                </div>
              </div>
              {active.options.map((opt) => {
                const checked = active.sel.includes(opt);
                return (
                  <label
                    key={opt}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm active:bg-ink/5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-[#182b3a]"
                      checked={checked}
                      onChange={() => toggleOption(active, opt)}
                    />
                    <span>{opt}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between mb-3 text-[13px] text-ink-soft">
        <span>
          {visible.length} shown ·{" "}
          <span className="money">{inr(visibleTotal)}</span>
        </span>
        <div className="flex gap-1.5">
          {filtered && (
            <button
              className="btn !py-1.5 !px-3 !text-[13px]"
              onClick={() => {
                setSearch("");
                setCats([]);
                setModes([]);
                setPayers([]);
                setOpenFilter(null);
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

      <div className="bg-surface border border-rule rounded-md divide-y divide-rule">
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
