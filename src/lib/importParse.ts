// Pure conversion logic for importing somebody else's expense file.
//
// Deliberately free of any network import so it can be exercised directly:
// these are the functions that decide what a person's money actually says, and
// a wrong date order or a mis-parsed lakh figure is not the kind of thing to
// find out about in production. See importMap.ts for the two calls that ask the
// server to work out the layout in the first place.

import type { RawSheet } from "./importSource";
import { guessCategory } from "./scanParse";

export type DateOrder = "dmy" | "mdy" | "ymd" | "unknown";

export interface ImportQuestion {
  id: string;
  question: string;
  options: string[];
}

/** Column indices into a row; -1 means the sheet has no such column. */
export interface ImportMapping {
  sheetName: string;
  headerRowIndex: number;
  firstDataRowIndex: number;
  dateCol: number;
  amountCol: number;
  categoryCol: number;
  detailCol: number;
  eventCol: number;
  modeCol: number;
  paidByCol: number;
  notesCol: number;
  dateOrder: DateOrder;
  negativeMeansExpense: boolean;
  skipRowPatterns: string[];
  confidence: number;
  warnings: string[];
  questions: ImportQuestion[];
}

export interface CategorySuggestion {
  raw: string;
  suggested: string;
  confidence: number;
  alternatives: string[];
}

export interface DraftEntry {
  /** 1-based row number in the source file, so the review table can point at
   * the row a person can actually go and look at. */
  sourceRow: number;
  date: string;
  rawDate: string;
  amount: number;
  rawAmount: string;
  rawCategory: string;
  category: string;
  event: string;
  detail: string;
  mode: string;
  paidBy: string;
  notes: string;
  issues: string[];
}

// ---------- dates ----------

/** An Excel date cell arrives as a Date. read-excel-file builds it at UTC
 * midnight, so the UTC parts are the ones the user typed; reading it with local
 * getters in a positive-offset zone (IST is +5:30) would be fine, but reading a
 * locally-built Date with UTC getters would shift it back a day. Pick per cell
 * rather than assuming either. */
function dateCellToIso(d: Date): string {
  const utcMidnight =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  const y = utcMidnight ? d.getUTCFullYear() : d.getFullYear();
  const m = (utcMidnight ? d.getUTCMonth() : d.getMonth()) + 1;
  const day = utcMidnight ? d.getUTCDate() : d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const SEPARATED = /^(\d{1,4})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{1,4})$/;

/**
 * Settle day-first vs month-first from the data itself.
 *
 * Any first part above 12 can only be a day; any second part above 12 can only
 * be a month in the other order. That is proof, and it beats whatever the model
 * guessed. Only when every row is ambiguous (all parts <= 12) does the caller
 * fall back to the model, and then to day-first for an Indian sheet.
 */
export function detectDateOrder(values: unknown[]): DateOrder {
  let sawIso = 0;
  let dayFirstProof = 0;
  let monthFirstProof = 0;

  for (const v of values) {
    if (v instanceof Date) continue;
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      sawIso++;
      continue;
    }
    const m = SEPARATED.exec(s);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (m[1].length === 4) {
      sawIso++;
      continue;
    }
    if (a > 12 && b <= 12) dayFirstProof++;
    else if (b > 12 && a <= 12) monthFirstProof++;
  }

  if (dayFirstProof > 0 && monthFirstProof === 0) return "dmy";
  if (monthFirstProof > 0 && dayFirstProof === 0) return "mdy";
  if (sawIso > 0 && dayFirstProof === 0 && monthFirstProof === 0) return "ymd";
  return "unknown";
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (y < 1990 || y > 2100) return null;
  // Reject a real-looking but impossible day (31 April, 30 February).
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parse one cell into YYYY-MM-DD, or "" when it cannot be read. */
export function parseImportDate(raw: unknown, order: DateOrder): string {
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return dateCellToIso(raw);

  // A bare number in a date column is almost always an Excel serial that lost
  // its formatting. Day 1 is 1900-01-01, offset by Excel's phantom 1900 leap day.
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 20000 && raw < 80000) {
      const ms = (raw - 25569) * 86400000;
      return dateCellToIso(new Date(ms));
    }
    return "";
  }

  const s = String(raw).trim();
  if (!s) return "";

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (isoMatch) {
    return iso(+isoMatch[1], +isoMatch[2], +isoMatch[3]) ?? "";
  }

  // "5 Jul 2026", "5-July-26", "Jul 5, 2026"
  const named = /^(\d{1,2})[\s\-/]+([A-Za-z]{3,9})[\s\-/,]+(\d{2,4})$/.exec(s);
  if (named) {
    const mon = MONTH_NAMES[named[2].slice(0, 4).toLowerCase()] ??
      MONTH_NAMES[named[2].slice(0, 3).toLowerCase()];
    if (mon) return iso(+named[3], mon, +named[1]) ?? "";
  }
  const namedFirst = /^([A-Za-z]{3,9})[\s\-/]+(\d{1,2})[\s\-/,]+(\d{2,4})$/.exec(s);
  if (namedFirst) {
    const mon = MONTH_NAMES[namedFirst[1].slice(0, 4).toLowerCase()] ??
      MONTH_NAMES[namedFirst[1].slice(0, 3).toLowerCase()];
    if (mon) return iso(+namedFirst[3], mon, +namedFirst[2]) ?? "";
  }

  const parts = SEPARATED.exec(s);
  if (!parts) return "";
  const a = +parts[1];
  const b = +parts[2];
  const c = +parts[3];

  if (parts[1].length === 4) return iso(a, b, c) ?? "";
  if (order === "mdy") return iso(c, a, b) ?? "";
  if (order === "ymd") return iso(a, b, c) ?? "";
  // dmy, and the fallback for "unknown": day-first is right far more often on
  // an Indian sheet, and a wrong guess here is visible in the review table.
  return iso(c, b, a) ?? "";
}

// ---------- amounts ----------

/**
 * Parse a money cell. Handles the rupee sign, Indian lakh grouping
 * (1,50,000), accounting negatives in brackets, and a trailing Dr/Cr.
 * Returns null when there is no number in the cell at all.
 */
export function parseImportAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  let s = String(raw).trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\bdr\b/i.test(s)) negative = false; // a debit IS the expense
  if (/\bcr\b/i.test(s)) negative = true;

  s = s
    .replace(/[₹$]|(?:\b(?:rs|inr|dr|cr)\b\.?)/gi, "")
    .replace(/[,\s]/g, "")
    .trim();

  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ---------- applying the mapping ----------

function cell(row: unknown[], index: number): string {
  if (index < 0 || index >= row.length) return "";
  const v = row[index];
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return dateCellToIso(v);
  return String(v).trim();
}

export interface ApplyResult {
  drafts: DraftEntry[];
  /** Rows deliberately dropped, with why — shown so a person can see that the
   * count of imported rows is smaller than their file on purpose. */
  skipped: { sourceRow: number; reason: string; preview: string }[];
  dateOrderUsed: DateOrder;
}

/**
 * Convert every row of the chosen sheet into a draft entry.
 *
 * Rows with no readable amount are skipped rather than imported as zero: a
 * total line, a blank separator or a stray note would otherwise become a
 * ₹0 payment sitting in the ledger forever.
 */
export function applyMapping(
  sheet: RawSheet,
  mapping: ImportMapping,
): ApplyResult {
  const start = Math.max(
    0,
    mapping.firstDataRowIndex >= 0
      ? mapping.firstDataRowIndex
      : mapping.headerRowIndex + 1,
  );
  const body = sheet.rows.slice(start);

  // Evidence from the whole column beats the model's guess from ten rows.
  const dateSamples = body.map((r) => (mapping.dateCol >= 0 ? r[mapping.dateCol] : null));
  const detected = detectDateOrder(dateSamples);
  const dateOrderUsed: DateOrder =
    detected !== "unknown"
      ? detected
      : mapping.dateOrder !== "unknown"
        ? mapping.dateOrder
        : "dmy";

  const skipPatterns = mapping.skipRowPatterns
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  const drafts: DraftEntry[] = [];
  const skipped: ApplyResult["skipped"] = [];

  body.forEach((row, i) => {
    const sourceRow = start + i + 1;
    const joined = row
      .map((c) => (c === null || c === undefined ? "" : String(c)))
      .join(" ")
      .trim();

    if (!joined) return; // silent: a blank spacer row isn't worth reporting

    if (skipPatterns.some((p) => joined.toLowerCase().includes(p))) {
      skipped.push({ sourceRow, reason: "Looks like a total or summary row", preview: joined.slice(0, 80) });
      return;
    }

    const rawAmount = cell(row, mapping.amountCol);
    const parsedAmount = parseImportAmount(
      mapping.amountCol >= 0 ? row[mapping.amountCol] : null,
    );
    if (parsedAmount === null || parsedAmount === 0) {
      skipped.push({ sourceRow, reason: "No amount in this row", preview: joined.slice(0, 80) });
      return;
    }

    // On a sheet that writes expenses as negatives, a positive figure is money
    // coming IN. This is an expense ledger, so that row is not ours to import —
    // silently flipping its sign would invent a payment that never happened.
    if (mapping.negativeMeansExpense && parsedAmount > 0) {
      skipped.push({
        sourceRow,
        reason: "Money received, not a payment",
        preview: joined.slice(0, 80),
      });
      return;
    }
    const amount = Math.abs(parsedAmount);

    const rawDate = cell(row, mapping.dateCol);
    const date = parseImportDate(
      mapping.dateCol >= 0 ? row[mapping.dateCol] : null,
      dateOrderUsed,
    );

    const issues: string[] = [];
    if (!date) issues.push(rawDate ? `Couldn't read the date "${rawDate}"` : "No date");
    if (parsedAmount < 0 && !mapping.negativeMeansExpense) {
      issues.push("Was negative in your file — imported as a payment out");
    }

    const event = cell(row, mapping.eventCol);
    const detail = cell(row, mapping.detailCol);

    // Plenty of personal sheets have no category column at all — one line per
    // payment and nothing else. Rather than importing everything uncategorised,
    // fall back to the same keyword guesser the bill scanner uses. It runs on
    // the device, so this costs nothing and needs no network.
    const rawCategory =
      cell(row, mapping.categoryCol) || guessCategory(`${event} ${detail}`);

    drafts.push({
      sourceRow,
      date,
      rawDate,
      amount,
      rawAmount,
      rawCategory,
      category: rawCategory,
      // When one column carried both, don't repeat it in two fields.
      event: event || detail,
      detail: detail && detail !== event ? detail : "",
      mode: cell(row, mapping.modeCol),
      paidBy: cell(row, mapping.paidByCol),
      notes: cell(row, mapping.notesCol),
      issues,
    });
  });

  return { drafts, skipped, dateOrderUsed };
}

/** Distinct category names in the drafts, in first-seen order. */
export function distinctCategories(drafts: DraftEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of drafts) {
    const c = d.rawCategory.trim();
    if (c && !seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase());
      out.push(c);
    }
  }
  return out;
}
