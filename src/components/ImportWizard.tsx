import { useMemo, useState } from "react";
import { useCategories } from "../hooks/useCategories";
import {
  readImportFile,
  parsePastedText,
  looksUnstructured,
  structureSample,
  type RawSheet,
} from "../lib/importSource";
import {
  applyMapping,
  distinctCategories,
  type ImportMapping,
  type DraftEntry,
  type DateOrder,
  type CategorySuggestion,
} from "../lib/importParse";
import { analyseStructure, suggestCategories } from "../lib/importMap";
import { commitImport } from "../lib/importCommit";
import { inr, formatDate } from "../lib/format";

type Stage = "pick" | "review" | "done";

/** Every ledger field the import can fill, for the correction dropdowns. */
const FIELDS: { key: keyof ImportMapping; label: string }[] = [
  { key: "dateCol", label: "Date" },
  { key: "amountCol", label: "Amount" },
  { key: "eventCol", label: "What it was for" },
  { key: "detailCol", label: "Paid to" },
  { key: "categoryCol", label: "Category" },
  { key: "modeCol", label: "Cash / UPI / Cheque" },
  { key: "paidByCol", label: "Who paid" },
  { key: "notesCol", label: "Remarks" },
];

const BLANK_MAPPING: ImportMapping = {
  sheetName: "", headerRowIndex: -1, firstDataRowIndex: 0,
  dateCol: -1, amountCol: -1, categoryCol: -1, detailCol: -1, eventCol: -1,
  modeCol: -1, paidByCol: -1, notesCol: -1,
  dateOrder: "unknown", negativeMeansExpense: false,
  skipRowPatterns: [], confidence: 0, warnings: [], questions: [],
};

/**
 * Bring an expense history in from somewhere else — a spreadsheet a person has
 * kept for years, or a note off their phone.
 *
 * Distinct from the Backup & restore block above it, which reads a file this
 * app wrote and replaces everything. This one reads a file with no agreed
 * shape at all and ADDS to what's here.
 *
 * The layout is worked out by sending a ten-row sample to be read; the rows
 * themselves are converted on this device. Nothing is written until the person
 * has seen the result, because a mis-read date column moves every payment in
 * the file to the wrong month and it is not obvious afterwards.
 */
export function ImportWizard() {
  const [stage, setStage] = useState<Stage>("pick");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sheets, setSheets] = useState<RawSheet[]>([]);
  const [mapping, setMapping] = useState<ImportMapping>(BLANK_MAPPING);
  const [dateOrder, setDateOrder] = useState<DateOrder>("dmy");
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [skipAi, setSkipAi] = useState(false);

  /** raw category name -> what it should be filed as ("" = leave blank). */
  const [catMap, setCatMap] = useState<Record<string, string>>({});
  const [catHints, setCatHints] = useState<Record<string, CategorySuggestion>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ entries: number; newCategories: string[] } | null>(null);

  // Via the shared hook rather than a query of its own: `order` is not a Dexie
  // index, so orderBy() on it throws and takes the whole Data tab down with it.
  const existingCategories = useCategories();

  const sheet = useMemo(
    () => sheets.find((s) => s.name === mapping.sheetName) ?? sheets[0],
    [sheets, mapping.sheetName],
  );

  const applied = useMemo(() => {
    if (!sheet) return null;
    return applyMapping(sheet, { ...mapping, dateOrder });
  }, [sheet, mapping, dateOrder]);

  /** Drafts with the person's category choices folded in. */
  const drafts: DraftEntry[] = useMemo(() => {
    if (!applied) return [];
    return applied.drafts.map((d) => {
      const key = d.rawCategory.trim().toLowerCase();
      const chosen = key in catMap ? catMap[key] : d.rawCategory;
      return { ...d, category: chosen };
    });
  }, [applied, catMap]);

  const rawCats = useMemo(
    () => (applied ? distinctCategories(applied.drafts) : []),
    [applied],
  );

  const reset = () => {
    setStage("pick");
    setSheets([]);
    setMapping(BLANK_MAPPING);
    setCatMap({});
    setCatHints({});
    setAnswers({});
    setPasted("");
    setShowPaste(false);
    setError(null);
    setResult(null);
  };

  const analyse = async (loaded: RawSheet[]) => {
    setSheets(loaded);
    setError(null);

    // The no-network path. Straight to the review screen with nothing mapped;
    // the person picks the columns themselves from the dropdowns. The privacy
    // note on the previous screen promises this, so it has to actually exist.
    if (skipAi) {
      const first = loaded[0];
      setMapping({
        ...BLANK_MAPPING,
        sheetName: first?.name ?? "",
        // Assume a header on the first row — true of most sheets, and easy to
        // change if not.
        headerRowIndex: 0,
        firstDataRowIndex: 1,
      });
      setDateOrder("dmy");
      setStage("review");
      return;
    }

    setBusy("Working out how your file is laid out…");
    try {
      const m = await analyseStructure(structureSample(loaded));
      setMapping(m);
      setDateOrder(m.dateOrder === "unknown" ? "dmy" : m.dateOrder);
      setStage("review");

      // Second, much smaller call: only the category NAMES, no figures.
      const target = loaded.find((s) => s.name === m.sheetName) ?? loaded[0];
      if (target) {
        const names = distinctCategories(applyMapping(target, m).drafts);
        if (names.length) {
          setBusy("Matching your categories…");
          try {
            const hints = await suggestCategories(names, existingCategories);
            const byRaw: Record<string, CategorySuggestion> = {};
            const chosen: Record<string, string> = {};
            for (const h of hints) {
              const key = h.raw.trim().toLowerCase();
              byRaw[key] = h;
              // Only auto-apply a confident merge. Anything less stays as their
              // own name with the suggestion offered — a wrong merge is silent.
              chosen[key] = h.suggested && h.confidence >= 0.8 ? h.suggested : h.raw;
            }
            setCatHints(byRaw);
            setCatMap(chosen);
          } catch {
            /* categories are a nicety — a failure here shouldn't sink the import */
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
      // Still let them map it by hand rather than dead-ending.
      setStage("review");
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File) => {
    setError(null);
    try {
      const loaded = await readImportFile(file);
      await analyse(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    }
  };

  const onPaste = async () => {
    const s = parsePastedText(pasted);
    if (s.rows.length === 0) {
      setError("There's nothing in that box yet.");
      return;
    }
    if (looksUnstructured(s)) {
      setError(
        "That note doesn't have separate columns, so the amounts can't be told apart from the descriptions. Put a comma or a tab between the date, what it was for, and the amount — or use a spreadsheet.",
      );
      return;
    }
    await analyse([s]);
  };

  const doImport = async () => {
    setBusy("Adding to your ledger…");
    setError(null);
    try {
      const res = await commitImport(drafts.filter((d) => d.date && d.amount > 0));
      setResult(res);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  };

  const setCol = (key: keyof ImportMapping, value: number) =>
    setMapping((m) => ({ ...m, [key]: value }));

  const columnChoices = useMemo(() => {
    if (!sheet) return [];
    const width = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
    const header =
      mapping.headerRowIndex >= 0 ? sheet.rows[mapping.headerRowIndex] : undefined;
    return Array.from({ length: width }, (_, i) => ({
      index: i,
      label: header?.[i] ? String(header[i]).slice(0, 24) : `Column ${i + 1}`,
    }));
  }, [sheet, mapping.headerRowIndex]);

  const importable = drafts.filter((d) => d.date && d.amount > 0);
  const undated = drafts.length - importable.length;

  // ---------- done ----------
  if (stage === "done" && result) {
    return (
      <div className="card p-3 space-y-2">
        <div className="text-sm font-medium text-moss">
          Added {result.entries} payments to your ledger.
        </div>
        {result.newCategories.length > 0 && (
          <p className="text-[12px] text-ink-soft">
            New categories created: {result.newCategories.join(", ")}
          </p>
        )}
        <p className="text-[12px] text-ink-soft">
          They're in the Ledger tab now. If something looks wrong you can edit or
          delete any of them there.
        </p>
        <button className="btn w-full !py-2.5" onClick={reset}>
          Import another file
        </button>
      </div>
    );
  }

  // ---------- pick ----------
  if (stage === "pick") {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-ink-soft">
          Already tracking your spending in Excel, or in a note on your phone?
          Bring it in — the columns don't have to match anything.
        </p>
        <div className="flex gap-2">
          <label className="btn flex-1 !py-2.5 text-center cursor-pointer">
            Choose a file
            <input
              type="file"
              accept=".xlsx,.xlsm,.csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onFile(f);
              }}
            />
          </label>
          <button
            className="btn flex-1 !py-2.5"
            onClick={() => setShowPaste((v) => !v)}
          >
            Paste text
          </button>
        </div>

        {showPaste && (
          <div className="space-y-2">
            <textarea
              className="input !h-32 font-mono text-[12px]"
              placeholder={"05/07/2026, Cement, Kisan Traders, 150000\n15/07/2026, Sariya, Gupta Steel, 120500"}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button className="btn btn-primary w-full !py-2.5" onClick={() => void onPaste()}>
              Read this
            </button>
          </div>
        )}

        <p className="text-[11px] text-ink-soft">
          To work out which column is which, the sheet names, headings and about
          ten rows are sent to the AI reader. The rest of the file is read on
          this phone and never uploaded.
        </p>
        <label className="flex items-start gap-2 text-[12px] text-ink-soft">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={skipAi}
            onChange={(e) => setSkipAi(e.target.checked)}
          />
          <span>Don't send anything — I'll pick the columns myself</span>
        </label>
        {busy && <div className="text-[13px] text-ink-soft">{busy}</div>}
        {error && <div className="text-[13px] text-crimson">{error}</div>}
      </div>
    );
  }

  // ---------- review ----------
  return (
    <div className="space-y-3">
      {busy && <div className="text-[13px] text-ink-soft">{busy}</div>}
      {error && <div className="text-[13px] text-crimson">{error}</div>}

      {sheets.length > 1 && (
        <div>
          <label className="field-label" htmlFor="imp-sheet">Sheet</label>
          <select
            id="imp-sheet"
            className="input"
            value={mapping.sheetName || sheets[0]?.name}
            onChange={(e) => setMapping((m) => ({ ...m, sheetName: e.target.value }))}
          >
            {sheets.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.rows.length} rows)
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="text-sm">
        Found <b>{importable.length}</b> payments
        {applied && applied.skipped.length > 0 && (
          <> · {applied.skipped.length} rows skipped</>
        )}
        {undated > 0 && <> · {undated} without a usable date</>}
      </div>

      {mapping.warnings.map((w, i) => (
        <div key={i} className="text-[12px] text-crimson">⚠ {w}</div>
      ))}

      {/* Anything the reader couldn't settle. Answering re-maps immediately. */}
      {mapping.questions.length > 0 && (
        <div className="card p-3 space-y-2">
          <div className="eyebrow">Needs your answer</div>
          {mapping.questions.map((q) => (
            <div key={q.id} className="space-y-1">
              <div className="text-[13px]">{q.question}</div>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    className={`text-[12px] rounded px-2.5 py-1.5 border ${
                      answers[q.id] === opt
                        ? "bg-ink text-paper border-ink"
                        : "border-rule text-ink-soft"
                    }`}
                    onClick={() => {
                      setAnswers((a) => ({ ...a, [q.id]: opt }));
                      // The one question we can act on automatically.
                      if (/date/i.test(q.id)) {
                        if (/month/i.test(opt)) setDateOrder("mdy");
                        else if (/day/i.test(opt)) setDateOrder("dmy");
                      }
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Date order gets its own control regardless: it is the single guess
          most able to be confidently wrong across every row at once. */}
      <div className="card p-3 space-y-1.5">
        <div className="eyebrow">Dates</div>
        <div className="flex gap-1.5">
          {([
            { v: "dmy" as const, label: "Day first (15/07 = 15 July)" },
            { v: "mdy" as const, label: "Month first (07/15 = 15 July)" },
          ]).map((o) => (
            <button
              key={o.v}
              className={`flex-1 text-[12px] rounded px-2 py-2 border ${
                dateOrder === o.v ? "bg-ink text-paper border-ink" : "border-rule text-ink-soft"
              }`}
              onClick={() => setDateOrder(o.v)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-soft">
          Check the dates in the preview below match your file before importing.
        </p>
      </div>

      {/* Column mapping — always editable, so the import still works if the
          reader was unavailable or wrong. */}
      <details className="card p-3">
        <summary className="text-[13px] cursor-pointer">Which column is which</summary>
        <div className="mt-2 space-y-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex items-center gap-2">
              <span className="text-[12px] text-ink-soft w-32 shrink-0">{f.label}</span>
              <select
                className="input !py-1.5 text-[13px]"
                value={String(mapping[f.key] as number)}
                onChange={(e) => setCol(f.key, Number(e.target.value))}
              >
                <option value="-1">— not in my file —</option>
                {columnChoices.map((c) => (
                  <option key={c.index} value={String(c.index)}>{c.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </details>

      {/* Categories: their name by default, with the suggestion offered. */}
      {rawCats.length > 0 && (
        <details className="card p-3" open>
          <summary className="text-[13px] cursor-pointer">
            Categories ({rawCats.length})
          </summary>
          <p className="text-[11px] text-ink-soft mt-1.5">
            Keeping your own name is fine — it'll be created as a new category.
          </p>
          <div className="mt-2 space-y-2">
            {rawCats.map((raw) => {
              const key = raw.toLowerCase();
              const hint = catHints[key];
              const value = key in catMap ? catMap[key] : raw;
              const options = Array.from(
                new Set([raw, ...(hint?.suggested ? [hint.suggested] : []), ...(hint?.alternatives ?? []), ...existingCategories]),
              ).filter(Boolean);
              return (
                <div key={raw} className="flex items-center gap-2">
                  <span className="text-[12px] w-32 shrink-0 truncate" title={raw}>{raw}</span>
                  <select
                    className="input !py-1.5 text-[13px]"
                    value={value}
                    onChange={(e) => setCatMap((m) => ({ ...m, [key]: e.target.value }))}
                  >
                    {options.map((o) => {
                      // "(new)" only when it really would be one — the offline
                      // guesser often lands on a category that already exists.
                      const isNew =
                        o === raw &&
                        !existingCategories.some(
                          (e) => e.toLowerCase() === o.toLowerCase(),
                        );
                      return (
                        <option key={o} value={o}>
                          {isNew ? `${o} (new category)` : o}
                        </option>
                      );
                    })}
                  </select>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* The actual rows. This is what makes a wrong mapping obvious. */}
      <div className="card p-3">
        <div className="eyebrow mb-2">Preview</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-ink-soft text-left">
                <th className="pr-2 font-normal">Date</th>
                <th className="pr-2 font-normal">What</th>
                <th className="pr-2 font-normal">Category</th>
                <th className="font-normal text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {drafts.slice(0, 12).map((d) => (
                <tr key={d.sourceRow} className="border-t border-rule">
                  <td className={`pr-2 py-1 ${d.date ? "" : "text-crimson"}`}>
                    {d.date ? formatDate(d.date) : d.rawDate || "—"}
                  </td>
                  <td className="pr-2 py-1 truncate max-w-[9rem]">{d.event || d.detail}</td>
                  <td className="pr-2 py-1 truncate max-w-[6rem]">{d.category || "—"}</td>
                  <td className="py-1 text-right money">{inr(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {drafts.length > 12 && (
          <p className="text-[11px] text-ink-soft mt-1.5">
            …and {drafts.length - 12} more.
          </p>
        )}
        {importable.length > 0 && (
          <p className="text-[12px] text-ink-soft mt-2">
            Total being imported: <b className="money">{inr(importable.reduce((a, d) => a + d.amount, 0))}</b> — check this against your file.
          </p>
        )}
      </div>

      {applied && applied.skipped.length > 0 && (
        <details className="card p-3">
          <summary className="text-[13px] cursor-pointer">
            {applied.skipped.length} rows skipped
          </summary>
          <div className="mt-2 space-y-1">
            {applied.skipped.slice(0, 20).map((s) => (
              <div key={s.sourceRow} className="text-[11px] text-ink-soft">
                Row {s.sourceRow}: {s.reason} — <span className="opacity-70">{s.preview}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <button
        className="btn btn-primary w-full !py-2.5"
        disabled={!!busy || importable.length === 0}
        onClick={() => void doImport()}
      >
        {importable.length === 0
          ? "Nothing to import yet"
          : `Add ${importable.length} payments to my ledger`}
      </button>
      <button className="text-[12px] text-ink-soft underline w-full text-center" onClick={reset}>
        Start over
      </button>
    </div>
  );
}
