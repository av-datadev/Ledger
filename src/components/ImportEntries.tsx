import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useCategories } from "../hooks/useCategories";
import { usePayers, useModes } from "../hooks/useFacets";
import { useAiConsent, IMPORT_AI_CONSENT } from "../hooks/useAiConsent";
import { useBackClose } from "../hooks/useBackClose";
import { inr, formatDate } from "../lib/format";
import { readSpreadsheet, isSpreadsheetFile, type SheetTable } from "../lib/sheetRead";
import {
  guessColumns,
  needsAiHelp,
  rowsToDrafts,
  IMPORT_FIELDS,
  type ColumnPlan,
  type DraftEntry,
  type ImportField,
} from "../lib/importParse";
import { scanLedgerText } from "../lib/ledgerScan";
import { markDuplicates, saveableDrafts, commitImport } from "../lib/importCommit";

type Stage = "pick" | "map" | "review" | "done";

/**
 * Bring an expense history in from wherever it was kept before this app — a
 * phone note, a WhatsApp thread, an Excel sheet.
 *
 * Two paths, and which one runs is the privacy decision at the heart of this
 * screen. A spreadsheet with recognisable columns is mapped and parsed on the
 * phone, and nothing is uploaded. Only free text, or a sheet too irregular to
 * map, goes to the AI reader — and only after the person has been told what
 * that means and agreed.
 */
export function ImportEntries({ onClose }: { onClose: () => void }) {
  const categories = useCategories();
  const payers = usePayers();
  const modes = useModes();
  const existing = useLiveQuery(() => db.entries.toArray(), []);
  const consent = useAiConsent(IMPORT_AI_CONSENT);
  const requestClose = useBackClose(true, onClose);
  const fileRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("pick");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [pastedText, setPastedText] = useState("");

  // Sheet path state.
  const [tables, setTables] = useState<SheetTable[]>([]);
  const [tableIdx, setTableIdx] = useState(0);
  const [plan, setPlan] = useState<ColumnPlan>({ headerRow: -1, map: [] });

  // Review state.
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [flagged, setFlagged] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [showOnlyProblems, setShowOnlyProblems] = useState(false);
  /** Set when the AI reader was used, so the review screen can say so. */
  const [usedAi, setUsedAi] = useState(false);
  /** Shown before the first upload; resolves when they choose. */
  const [pendingAi, setPendingAi] = useState<null | { text: string; label: string }>(null);

  const table = tables[tableIdx];

  const intoReview = (rows: DraftEntry[], label: string, ai: boolean) => {
    const { drafts: marked, flagged: n } = markDuplicates(rows, existing ?? []);
    setDrafts(marked);
    setFlagged(n);
    setSource(label);
    setUsedAi(ai);
    setStage("review");
  };

  // ------------------------------------------------------------- picking --

  const onPickFile = async (file: File) => {
    setError(null);
    setWarning("");
    try {
      if (!isSpreadsheetFile(file)) {
        setError(
          `"${file.name}" isn't a spreadsheet. Pick a .xlsx or .csv file, or paste the list as text below.`,
        );
        return;
      }
      setBusy("Reading the file…");
      const read = await readSpreadsheet(file);
      const first = read[0];
      const guessed = guessColumns(first.rows);
      setTables(read);
      setTableIdx(0);
      setPlan(guessed);
      setSource(file.name);
      setStage("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(null);
    }
  };

  const onSheetChange = (idx: number) => {
    setTableIdx(idx);
    setPlan(guessColumns(tables[idx].rows));
  };

  /**
   * Run the AI reader, asking for consent the first time. `force` is set by the
   * consent prompt's own button: grant() has written the choice through, but
   * this render still closes over the old `granted`, so the gate is skipped
   * explicitly rather than waiting a render.
   */
  const readWithAi = async (text: string, label: string, force = false) => {
    if (!consent.granted && !force) {
      setPendingAi({ text, label });
      return;
    }
    setError(null);
    try {
      setBusy("Reading the list…");
      const scan = await scanLedgerText(text, (done, total) =>
        setBusy(total > 1 ? `Reading the list… part ${done + 1} of ${total}` : "Reading the list…"),
      );
      setWarning(
        [
          scan.warning,
          scan.confidence === "low"
            ? "The reader wasn't confident about this format — check every row."
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      intoReview(scan.drafts, label, true);
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : "Could not read that list.") +
          " Free-form text can only be read online.",
      );
    } finally {
      setBusy(null);
    }
  };

  // -------------------------------------------------------------- mapping --

  const mappedDrafts = useMemo(
    () => (table ? rowsToDrafts(table.rows, plan) : []),
    [table, plan],
  );
  const mappingWeak = useMemo(
    () => (table ? needsAiHelp(table.rows, plan) : false),
    [table, plan],
  );

  const setColumn = (col: number, field: ImportField) => {
    const map = plan.map.slice();
    // Fields other than "ignore" are one-per-sheet; assigning one moves it.
    if (field !== "ignore") {
      for (let i = 0; i < map.length; i++) if (map[i] === field) map[i] = "ignore";
    }
    map[col] = field;
    setPlan({ ...plan, map });
  };

  // --------------------------------------------------------------- review --

  const setDraft = (i: number, patch: Partial<DraftEntry>) => {
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  };

  const saveable = useMemo(() => saveableDrafts(drafts), [drafts]);
  const totalValue = useMemo(
    () => saveable.reduce((s, d) => s + parseFloat(d.amount), 0),
    [saveable],
  );
  const visible = useMemo(
    () =>
      drafts
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => !showOnlyProblems || d.issues.length > 0 || d.duplicateOf),
    [drafts, showOnlyProblems],
  );

  const save = async () => {
    setError(null);
    try {
      setBusy(`Saving ${saveable.length} entries…`);
      const n = await commitImport(drafts, source || "an imported file");
      setSavedCount(n);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save these entries.");
    } finally {
      setBusy(null);
    }
  };

  // ----------------------------------------------------------------- view --

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">Import past expenses</h2>
        <button className="btn !py-1.5 !px-3 !text-[13px]" onClick={requestClose}>
          {stage === "done" ? "Close" : "Cancel"}
        </button>
      </div>

      {busy && (
        <div className="text-[13px] px-3 py-2 rounded-md border border-rule bg-surface text-ink-soft mb-3">
          {busy}
        </div>
      )}
      {error && (
        <div className="text-[13px] px-3 py-2 rounded-md border border-crimson bg-crimson/5 text-crimson mb-3">
          {error}
        </div>
      )}

      {/* Consent gate — shown only when something is actually about to be sent,
          with the size of it stated, rather than as an abstract setting. */}
      {pendingAi && (
        <div className="card p-3 mb-3 space-y-2 border-crimson">
          <div className="text-sm font-semibold">Send this list to the AI reader?</div>
          <div className="text-[13px] text-ink-soft space-y-1.5">
            <p>
              This list can't be read on the phone alone, so the text below would
              be sent to Google's Gemini to be read:{" "}
              <b>
                {pendingAi.text.split(/\r?\n/).filter((l) => l.trim()).length} lines,{" "}
                {pendingAi.text.length.toLocaleString("en-IN")} characters
              </b>
              .
            </p>
            <p>
              That is your spending history — dates, amounts, and who you paid.
              It is used to read this list and nothing else, and nothing is saved
              until you've checked it on the next screen.
            </p>
            <p>
              This choice is remembered on <b>this phone only</b>. A tidy
              spreadsheet never needs it — map the columns instead and nothing
              leaves the device.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-primary flex-1"
              onClick={() => {
                const p = pendingAi;
                setPendingAi(null);
                consent.grant();
                void readWithAi(p.text, p.label, true);
              }}
            >
              Send and read it
            </button>
            <button className="btn flex-1" onClick={() => setPendingAi(null)}>
              No, don't send
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ pick -- */}
      {stage === "pick" && (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-soft">
            Already keeping expenses somewhere else? Bring them in once, and
            carry on in the app from there. Nothing is saved until you've checked
            every row.
          </p>

          <section className="space-y-2">
            <h3 className="eyebrow">From a spreadsheet</h3>
            <button
              className="btn btn-primary w-full"
              disabled={!!busy}
              onClick={() => fileRef.current?.click()}
            >
              Choose a .xlsx or .csv file
            </button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPickFile(f);
                e.target.value = "";
              }}
            />
            <p className="text-[11px] text-ink-soft">
              Read on this phone. If the columns are recognisable — a date, a
              description, an amount — nothing is uploaded at all.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="eyebrow">From a note or a message</h3>
            <textarea
              className="input !h-40 font-mono !text-[12px]"
              placeholder={"Paste your list here, e.g.\n\n12/3 cement 4500 cash\n15/3 mistri 8000\n18-3-26 sariya 62,000 cheque"}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
            />
            <button
              className="btn w-full"
              disabled={!!busy || pastedText.trim().length < 10}
              onClick={() => void readWithAi(pastedText, "a pasted note")}
            >
              Read this list
            </button>
            <p className="text-[11px] text-ink-soft">
              Free-form text is read by the AI reader, which needs a connection
              and sends the text off the phone. You'll be asked first.
            </p>
          </section>
        </div>
      )}

      {/* ------------------------------------------------------------- map -- */}
      {stage === "map" && table && (
        <div className="space-y-3">
          {tables.length > 1 && (
            <div>
              <label className="field-label">Sheet</label>
              <select
                className="input"
                value={tableIdx}
                onChange={(e) => onSheetChange(Number(e.target.value))}
              >
                {tables.map((t, i) => (
                  <option key={t.name + i} value={i}>
                    {t.name} ({t.rows.length} rows)
                  </option>
                ))}
              </select>
            </div>
          )}

          <p className="text-[13px] text-ink-soft">
            Tell the app what each column holds. It has guessed from the{" "}
            {plan.headerRow >= 0 ? "header row" : "contents"} — correct anything
            wrong.
          </p>

          <div className="space-y-2">
            {table.rows[0]?.map((_, col) => {
              const header =
                plan.headerRow >= 0 ? table.rows[plan.headerRow][col] : "";
              const sample = table.rows
                .slice(plan.headerRow + 1, plan.headerRow + 4)
                .map((r) => (r[col] ?? "").trim())
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={col} className="card p-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">
                      {header || `Column ${col + 1}`}
                    </div>
                    <div className="text-[11px] text-ink-soft truncate money">
                      {sample || "(empty)"}
                    </div>
                  </div>
                  <select
                    className="input !py-1 !text-[12px] !w-36 shrink-0"
                    value={plan.map[col] ?? "ignore"}
                    onChange={(e) => setColumn(col, e.target.value as ImportField)}
                  >
                    {IMPORT_FIELDS.map((f) => (
                      <option key={f.field} value={f.field}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="px-3 py-2 rounded-md border border-rule bg-surface text-[13px]">
            {mappedDrafts.length} rows read ·{" "}
            {mappedDrafts.filter((d) => d.issues.length === 0).length} complete
          </div>

          {mappingWeak && (
            <div className="text-[13px] px-3 py-2 rounded-md border border-crimson bg-crimson/5 text-crimson">
              Most rows are missing a date or an amount, so the columns probably
              aren't set right. Fix them above if you can — the app reads the
              sheet itself that way and nothing is uploaded. If the sheet is too
              irregular for that, the AI reader can have a go.
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn btn-primary"
              disabled={mappedDrafts.length === 0}
              onClick={() => intoReview(mappedDrafts, table.name || source, false)}
            >
              Check {mappedDrafts.length} rows
            </button>
            <button
              className="btn"
              disabled={!!busy}
              onClick={() =>
                void readWithAi(
                  // Hand the reader the sheet as text, exactly as it sits.
                  table.rows.map((r) => r.join("\t")).join("\n"),
                  table.name || source,
                )
              }
            >
              Use the AI reader
            </button>
          </div>
          <button className="btn w-full" onClick={() => setStage("pick")}>
            Back
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------- review -- */}
      {stage === "review" && (
        <div className="space-y-3">
          <div className="px-3 py-2 rounded-md border border-rule bg-surface text-[13px] money space-y-0.5">
            <div className="flex justify-between">
              <span>Rows read</span>
              <span>{drafts.length}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Ticked to import</span>
              <span>
                {saveable.length} · {inr(totalValue)}
              </span>
            </div>
            {flagged > 0 && (
              <div className="flex justify-between text-crimson">
                <span>Look like repeats (unticked)</span>
                <span>{flagged}</span>
              </div>
            )}
          </div>

          {usedAi && (
            <div className="text-[13px] px-3 py-2 rounded-md border border-crimson bg-crimson/5 text-crimson">
              Read by AI — it makes mistakes with numbers. Check every amount and
              date against your original before saving.
            </div>
          )}
          {warning && (
            <div className="text-[13px] px-3 py-2 rounded-md border border-rule bg-surface text-ink-soft">
              {warning}
            </div>
          )}

          <div className="flex items-center gap-2 text-[13px]">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showOnlyProblems}
                onChange={(e) => setShowOnlyProblems(e.target.checked)}
              />
              Only show rows needing attention
            </label>
            <button
              className="ml-auto text-[12px] text-ink-soft border border-rule rounded px-2 py-0.5"
              onClick={() =>
                setDrafts((ds) =>
                  ds.map((d) =>
                    d.issues.length === 0 && !d.duplicateOf ? { ...d, include: true } : d,
                  ),
                )
              }
            >
              Tick all clean rows
            </button>
          </div>

          <div className="space-y-2">
            {visible.map(({ d, i }) => (
              <ImportRow
                key={i}
                d={d}
                categories={categories}
                payers={payers}
                modes={modes}
                onField={(patch) => setDraft(i, patch)}
              />
            ))}
            {visible.length === 0 && (
              <div className="text-sm text-ink-soft text-center py-6">
                Nothing needs attention — every row read cleanly.
              </div>
            )}
          </div>

          <button
            className="btn btn-primary w-full !py-3 !text-base"
            disabled={!!busy || saveable.length === 0}
            onClick={() => void save()}
          >
            {saveable.length === 0
              ? "Nothing ticked to import"
              : `Import ${saveable.length} entries (${inr(totalValue)})`}
          </button>
          <button className="btn w-full" onClick={() => setStage("pick")}>
            Start over
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------ done -- */}
      {stage === "done" && (
        <div className="space-y-3">
          <div className="px-3 py-3 rounded-md border border-moss bg-moss/5 text-moss text-[13px]">
            Imported <b>{savedCount}</b> entries from {source}. They're in the
            Ledger now, each one tagged "Imported from {source}" in its notes so
            you can find them again.
          </div>
          <p className="text-[13px] text-ink-soft">
            From here on, add expenses as they happen and nothing needs importing
            — or reading by AI — again.
          </p>
          <button className="btn btn-primary w-full" onClick={requestClose}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

/** One reviewable row: the parsed fields, with the source line underneath. */
function ImportRow({
  d,
  categories,
  payers,
  modes,
  onField,
}: {
  d: DraftEntry;
  categories: string[];
  payers: string[];
  modes: string[];
  onField: (patch: Partial<DraftEntry>) => void;
}) {
  const bad = d.issues.length > 0;
  return (
    <div
      className={`card p-2 space-y-1.5 ${
        d.duplicateOf ? "border-crimson" : bad ? "border-crimson/40" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 shrink-0"
          checked={d.include}
          onChange={(e) => onField({ include: e.target.checked })}
        />
        <input
          className="input !py-1.5 !text-[13px] flex-1"
          placeholder="Description"
          value={d.event}
          onChange={(e) => onField({ event: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <input
          type="date"
          className="input !py-1.5 !text-[12px]"
          value={d.date}
          onChange={(e) => onField({ date: e.target.value })}
        />
        <input
          className="input !py-1.5 !text-[13px] money !font-semibold"
          placeholder="Amount"
          inputMode="decimal"
          value={d.amount}
          onChange={(e) => onField({ amount: e.target.value })}
        />
        <select
          className="input !py-1.5 !text-[12px]"
          value={d.category}
          onChange={(e) => onField({ category: e.target.value })}
        >
          <option value="">(category)</option>
          {/* A category read off the old sheet may not exist yet; keep it
              selectable rather than silently snapping to something else. */}
          {!categories.includes(d.category) && d.category && (
            <option value={d.category}>{d.category} (new)</option>
          )}
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <input
          className="input !py-1.5 !text-[12px]"
          placeholder="Paid to"
          value={d.detail}
          onChange={(e) => onField({ detail: e.target.value })}
        />
        <select
          className="input !py-1.5 !text-[12px]"
          value={d.mode}
          onChange={(e) => onField({ mode: e.target.value })}
        >
          <option value="">(mode)</option>
          {!modes.includes(d.mode) && d.mode && <option value={d.mode}>{d.mode}</option>}
          {modes.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select
          className="input !py-1.5 !text-[12px]"
          value={d.paidBy}
          onChange={(e) => onField({ paidBy: e.target.value })}
        >
          <option value="">(paid by)</option>
          {!payers.includes(d.paidBy) && d.paidBy && (
            <option value={d.paidBy}>{d.paidBy}</option>
          )}
          {payers.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>

      {d.duplicateOf && (
        <div className="text-[11px] text-crimson">
          {d.duplicateOf === "batch"
            ? "The same payment appears earlier in this list."
            : `Your ledger already has ${inr(parseFloat(d.amount) || 0)} on ${
                d.date ? formatDate(d.date) : "this date"
              } that looks like this.`}{" "}
          Ticked only if you're sure it's a second payment.
        </div>
      )}
      {bad && (
        <div className="text-[11px] text-crimson">
          Can't import yet: {d.issues.join(", ")}.
        </div>
      )}
      {d.raw && (
        <div className="text-[11px] text-ink-soft money truncate" title={d.raw}>
          from: {d.raw}
        </div>
      )}
    </div>
  );
}
