// Turns a grid of spreadsheet cells into draft ledger entries, entirely on the
// device.
//
// This is the half of the importer that means a tidy sheet never leaves the
// phone. Someone keeping expenses in Excel almost always has a date column, a
// description column and an amount column; when we can find those with
// confidence there is nothing an AI reader would add, and sending a person's
// whole financial history off-device to re-derive what a header row already
// says would be a poor trade.
//
// Gemini (scan-ledger) is the fallback for what this genuinely cannot do:
// free-form text, a sheet with no headers and mixed content, Hindi column
// names, amounts written in words. `needsAiHelp` below is the judgement call
// between the two paths.

import { guessCategory } from "./scanParse";

/** Which entry field a spreadsheet column feeds. */
export type ImportField =
  | "ignore"
  | "date"
  | "event"
  | "detail"
  | "amount"
  | "mode"
  | "paidBy"
  | "category"
  | "notes";

/** Field order for the column-mapping picker, with the labels shown there. */
export const IMPORT_FIELDS: { field: ImportField; label: string }[] = [
  { field: "ignore", label: "Ignore" },
  { field: "date", label: "Date" },
  { field: "event", label: "Description" },
  { field: "detail", label: "Paid to / vendor" },
  { field: "amount", label: "Amount" },
  { field: "mode", label: "Payment mode" },
  { field: "paidBy", label: "Paid by" },
  { field: "category", label: "Category" },
  { field: "notes", label: "Notes" },
];

/** One row of somebody's old expense list, ready for the review table. */
export interface DraftEntry {
  /** Ticked rows are the ones that get saved. */
  include: boolean;
  date: string; // YYYY-MM-DD, or "" when unreadable
  category: string;
  event: string;
  detail: string;
  amount: string;
  mode: string;
  paidBy: string;
  notes: string;
  /** The source row/line verbatim, shown under the fields so a misread is
   * visible without reopening the original file. */
  raw: string;
  /** Id of an existing ledger entry this looks like a repeat of. */
  duplicateOf: string | null;
  /** Why this row can't be saved as-is ("no amount", "no date"). */
  issues: string[];
}

// ---------------------------------------------------------------- amounts --

/**
 * Read a money cell. Handles what people actually type: ₹ and Rs prefixes,
 * Indian lakh grouping (1,50,000), a trailing /-, a negative in brackets the
 * accounting way, and a stray "only".
 *
 * Returns null when there is no number in there at all. A zero is a real value
 * and comes back as 0 — an expense list can legitimately carry one.
 */
export function parseImportAmount(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;

  // (1,234) is how a sheet writes -1234.
  const bracketed = /^\((.*)\)$/.exec(s);
  const negate = bracketed != null || s.startsWith("-");
  if (bracketed) s = bracketed[1];

  s = s
    .replace(/^-/, "")
    .replace(/(^|\s)(rs|inr|₹|rupees?)\.?\s*/g, " ")
    .replace(/\/-\s*$/, "")
    .replace(/\bonly\b/g, "")
    .replace(/[,\s]/g, "");

  // Anything left that isn't a number means this wasn't a money cell.
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negate ? -n : n;
}

// ------------------------------------------------------------------ dates --

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isoOf(y: number, m: number, d: number): string | null {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1970 || y > 2100) return null;
  // Reject a day the month doesn't have, so 31/02 fails rather than rolling
  // over into March and quietly moving the expense.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Read a date cell as an Indian person writes it — DAY FIRST. "5/7/26" is
 * 5 July, never 7 May. Where a value is genuinely ambiguous this convention
 * decides it; where the first number is above 12 the order is unambiguous and
 * is honoured whichever way round it falls.
 *
 * Excel serials arrive here already turned into ISO by sheetRead, so the only
 * numeric case left is a serial pasted as text.
 */
export function parseImportDate(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";

  // Already ISO (including what sheetRead produced from a real date cell).
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return isoOf(+iso[1], +iso[2], +iso[3]) ?? "";

  // 5/7/26, 05-07-2026, 5.7.26
  const numeric = /^(\d{1,4})[/\-. ](\d{1,2})[/\-. ](\d{2,4})$/.exec(s);
  if (numeric) {
    const [, a, b, c] = numeric;
    // A four-digit first field is a year — that's ISO with slashes.
    if (a.length === 4) return isoOf(+a, +b, +c) ?? "";
    // Day-first unless the first number can't be a day and the second can.
    if (+a > 12 || +b <= 12) return isoOf(+c, +b, +a) ?? "";
    return isoOf(+c, +a, +b) ?? "";
  }

  // 5 Jul 26 / 5-July-2026 / Jul 5 2026
  const dayFirst = /^(\d{1,2})[\s\-./]*([a-z]{3,9})[\s\-./,]*(\d{2,4})$/i.exec(s);
  if (dayFirst) {
    const m = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()];
    if (m) return isoOf(+dayFirst[3], m, +dayFirst[1]) ?? "";
  }
  const monthFirst = /^([a-z]{3,9})[\s\-./]*(\d{1,2})[\s\-./,]*(\d{2,4})$/i.exec(s);
  if (monthFirst) {
    const m = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()];
    if (m) return isoOf(+monthFirst[3], m, +monthFirst[2]) ?? "";
  }

  // A bare serial pasted as text ("45678").
  const bare = /^\d{5}$/.exec(s);
  if (bare) {
    const n = +s;
    if (n >= 20000 && n <= 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) ?? "";
    }
  }

  return "";
}

// ------------------------------------------------------- column detection --

/**
 * Header keywords per field, most specific first. Order inside a field doesn't
 * matter, but the ORDER OF FIELDS below does: a header reading "paid by" must
 * match paidBy before `amount` gets a chance at the word "paid", and "paid to"
 * must land on detail. Longer phrases are therefore tested ahead of the bare
 * words that appear inside them.
 */
const HEADER_KEYWORDS: [ImportField, string[]][] = [
  ["paidBy", ["paid by", "paidby", "payer", "paid from", "spent by", "by whom", "who paid"]],
  ["detail", ["paid to", "vendor", "supplier", "shop", "party", "firm", "dealer", "seller", "to whom", "payee", "contractor name"]],
  ["date", ["date", "dt", "dinank", "day", "when", "दिनांक", "तारीख"]],
  ["amount", ["amount", "amt", "rupees", "rs.", "rs", "inr", "₹", "value", "price", "cost", "total", "debit", "withdrawal", "expense", "paid", "spend", "राशि", "रकम"]],
  ["mode", ["mode", "payment mode", "method", "payment type", "via", "through", "paid via", "instrument"]],
  ["category", ["category", "head", "type", "class", "group", "account head", "श्रेणी"]],
  ["event", ["description", "particular", "narration", "detail", "item", "work", "purpose", "for", "expense head", "spent on", "remarks", "विवरण", "काम"]],
  ["notes", ["note", "comment", "remark", "reference", "ref"]],
];

const norm = (s: string): string => s.toLowerCase().replace(/[_\s]+/g, " ").trim();

/** Match one header cell to a field, or null when nothing fits. */
function fieldForHeader(header: string): ImportField | null {
  const h = norm(header);
  if (!h) return null;
  for (const [field, words] of HEADER_KEYWORDS) {
    for (const w of words) {
      // Whole-word-ish match: "date" must not fire on "candidate", but
      // "Date of payment" and "Txn Date" both should.
      if (h === w || h.startsWith(w + " ") || h.endsWith(" " + w) || h.includes(" " + w + " ")) {
        return field;
      }
    }
  }
  // A one-word header that IS the keyword, with punctuation around it.
  const bare = h.replace(/[^a-z₹ऀ-ॿ]/g, "");
  for (const [field, words] of HEADER_KEYWORDS) {
    if (words.some((w) => w.replace(/[^a-z₹ऀ-ॿ]/g, "") === bare && bare)) {
      return field;
    }
  }
  return null;
}

/** How many of a column's non-empty cells parse as X. */
function hitRate(rows: string[][], col: number, test: (s: string) => boolean): number {
  let seen = 0;
  let ok = 0;
  for (const r of rows) {
    const v = (r[col] ?? "").trim();
    if (!v) continue;
    seen++;
    if (test(v)) ok++;
  }
  return seen === 0 ? 0 : ok / seen;
}

export interface ColumnPlan {
  /** Index of the header row, or -1 when the sheet has no headers. */
  headerRow: number;
  /** One field per column. */
  map: ImportField[];
}

/**
 * Work out which column is which. Headers are used when they're there; when
 * they're not, columns are judged by what's actually in them — a column that
 * parses as dates is the date, the numeric one is the amount, and the wordiest
 * one is the description.
 */
export function guessColumns(rows: string[][]): ColumnPlan {
  if (rows.length === 0) return { headerRow: -1, map: [] };
  const width = Math.max(...rows.map((r) => r.length));

  // The header is the first row in the top few whose cells mostly match known
  // field names. Expense sheets often carry a title line above it ("June
  // expenses"), so this looks past the first row rather than assuming it.
  let headerRow = -1;
  let bestHits = 0;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const hits = rows[i].filter((c) => fieldForHeader(c) != null).length;
    if (hits >= 2 && hits > bestHits) {
      bestHits = hits;
      headerRow = i;
    }
  }

  const map: ImportField[] = new Array(width).fill("ignore");
  const taken = new Set<ImportField>();

  if (headerRow >= 0) {
    for (let c = 0; c < width; c++) {
      const f = fieldForHeader(rows[headerRow][c] ?? "");
      // One column per field: a sheet with "Amount" and "Total" columns should
      // map the first and ignore the second rather than silently overwrite.
      if (f && !taken.has(f)) {
        map[c] = f;
        taken.add(f);
      }
    }
  }

  // Fill whatever the headers didn't settle by looking at the data itself.
  const body = rows.slice(headerRow >= 0 ? headerRow + 1 : 0, (headerRow >= 0 ? headerRow + 1 : 0) + 40);

  if (!taken.has("date")) {
    let best = -1;
    let bestRate = 0.6; // must be mostly dates to claim the column
    for (let c = 0; c < width; c++) {
      if (map[c] !== "ignore") continue;
      const rate = hitRate(body, c, (s) => parseImportDate(s) !== "");
      if (rate > bestRate) {
        bestRate = rate;
        best = c;
      }
    }
    if (best >= 0) {
      map[best] = "date";
      taken.add("date");
    }
  }

  if (!taken.has("amount")) {
    // The right-most numeric column, not the first: sheets put running totals
    // and quantities to the left of the money more often than after it.
    let best = -1;
    for (let c = 0; c < width; c++) {
      if (map[c] !== "ignore") continue;
      if (hitRate(body, c, (s) => parseImportAmount(s) != null) > 0.7) best = c;
    }
    if (best >= 0) {
      map[best] = "amount";
      taken.add("amount");
    }
  }

  if (!taken.has("event")) {
    // The wordiest remaining column is the description.
    let best = -1;
    let bestLen = 2;
    for (let c = 0; c < width; c++) {
      if (map[c] !== "ignore") continue;
      const lens = body
        .map((r) => (r[c] ?? "").trim())
        .filter(Boolean)
        .map((v) => (/^[\d.,₹\-() ]+$/.test(v) ? 0 : v.length));
      if (lens.length === 0) continue;
      const avg = lens.reduce((s, n) => s + n, 0) / lens.length;
      if (avg > bestLen) {
        bestLen = avg;
        best = c;
      }
    }
    if (best >= 0) map[best] = "event";
  }

  return { headerRow, map };
}

/**
 * Whether the deterministic path is good enough, or the text should go to the
 * AI reader instead. The test is deliberately about the two fields an entry
 * cannot exist without: without an amount there is no expense, and without a
 * date it can't sit anywhere in the ledger.
 */
export function needsAiHelp(rows: string[][], plan: ColumnPlan): boolean {
  if (!plan.map.includes("amount")) return true;
  const drafts = rowsToDrafts(rows, plan);
  if (drafts.length === 0) return true;
  const usable = drafts.filter((d) => d.issues.length === 0).length;
  return usable / drafts.length < 0.7;
}

// -------------------------------------------------------------- row → row --

/** Build the draft entries a mapped grid describes. */
export function rowsToDrafts(rows: string[][], plan: ColumnPlan): DraftEntry[] {
  const body = rows.slice(plan.headerRow + 1);
  const colOf = (f: ImportField) => plan.map.indexOf(f);
  const cDate = colOf("date");
  const cEvent = colOf("event");
  const cDetail = colOf("detail");
  const cAmount = colOf("amount");
  const cMode = colOf("mode");
  const cPaidBy = colOf("paidBy");
  const cCategory = colOf("category");
  const cNotes = colOf("notes");

  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const out: DraftEntry[] = [];
  for (const r of body) {
    if (!r.some((c) => c.trim())) continue;

    const amountRaw = at(r, cAmount);
    const amount = parseImportAmount(amountRaw);
    const date = parseImportDate(at(r, cDate));
    const event = at(r, cEvent);
    const detail = at(r, cDetail);

    // A row with no money and no words is a spacer or a stray total line.
    if (amount == null && !event && !detail) continue;

    // Sheets almost always end with a grand-total row that has an amount and
    // either no date or the word "total" where the description goes. Importing
    // it would double the year — so it's dropped, not flagged.
    if (/^\s*(grand\s*)?total\b/i.test(event) || /^\s*(grand\s*)?total\b/i.test(detail)) {
      continue;
    }

    const issues: string[] = [];
    if (amount == null) issues.push(amountRaw ? `amount "${amountRaw}" isn't a number` : "no amount");
    if (!date) issues.push("no date");
    if (!event && !detail) issues.push("no description");

    const category = at(r, cCategory) || guessCategory([event, detail].join(" ")) || "";

    out.push({
      // A row that can't be saved starts unticked — the person opts in after
      // fixing it, rather than having to notice and untick it.
      include: issues.length === 0,
      date,
      category,
      event: event || detail,
      detail: event ? detail : "",
      amount: amount == null ? "" : String(amount),
      mode: at(r, cMode),
      paidBy: at(r, cPaidBy),
      notes: at(r, cNotes),
      raw: r.filter(Boolean).join(" · "),
      duplicateOf: null,
      issues,
    });
  }
  return out;
}
