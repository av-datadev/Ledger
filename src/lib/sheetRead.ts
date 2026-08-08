// Reads a spreadsheet or delimited text file into plain rows of strings.
//
// This is the front half of importing an expense history someone already keeps
// somewhere else. It is deliberately dumb: it produces a grid, and nothing
// here decides what any column MEANS — that is importParse.ts, and keeping the
// two apart is what lets a tidy sheet be imported without anything leaving the
// phone.
//
// .xlsx goes through read-excel-file, already a dependency for the Excel
// backup and already loaded on demand there. Reusing it costs nothing extra
// and avoids a second spreadsheet library in a PWA that precaches its whole
// bundle for offline use.
//
// .csv is parsed here rather than by a library because the whole job is forty
// lines and a CSV dependency would be bigger than the code it replaces.

/** One sheet of a workbook, or the single table of a CSV. */
export interface SheetTable {
  name: string;
  rows: string[][];
}

/** How many rows we are willing to pull off one file. A hand-kept expense list
 * is hundreds of rows; anything past this is a different kind of document and
 * would only bog the review table down. */
const MAX_ROWS = 5000;

/** Excel stores a date as a day count from 1899-12-30. Only values inside a
 * sane calendar window are treated as serials, so a plain amount in a date
 * column doesn't silently become a date in 1902. */
const SERIAL_MIN = 20000; // 1954-10-03
const SERIAL_MAX = 80000; // 2119-01-19

/** True for a number that could plausibly be an Excel date serial. */
export function isDateSerial(n: number): boolean {
  return Number.isFinite(n) && n >= SERIAL_MIN && n <= SERIAL_MAX;
}

/** Excel serial → YYYY-MM-DD. Uses UTC throughout: the serial is a date with
 * no timezone, and reading it back with local getters shifts it a day west of
 * Greenwich. */
export function serialToIso(serial: number): string {
  const ms = Math.round(serial) * 86400000;
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  return isoFromUtc(d);
}

function isoFromUtc(d: Date): string {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

/**
 * One spreadsheet cell as the string the mapper will read. Dates are the case
 * that matters: read-excel-file hands back a real Date for a date-formatted
 * cell, and turning it into an ISO string here means the mapper never has to
 * care whether a date arrived formatted or as raw text.
 */
function cellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return isoFromUtc(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v).trim();
}

/**
 * Split delimited text into rows, honouring quoted fields. Handles the three
 * separators a phone or a laptop actually exports (comma, tab, semicolon —
 * the last is what Excel writes in locales that use a decimal comma), embedded
 * newlines inside quotes, and "" as an escaped quote.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const sep = delimiter ?? sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // Strip a UTF-8 BOM: Excel writes one, and it would otherwise become part of
  // the first header cell and break header matching on that column alone.
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      row.push(field.trim());
      field = "";
    } else if (c === "\n" || c === "\r") {
      // Swallow the \n of a \r\n pair rather than emitting a blank row.
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
      if (rows.length >= MAX_ROWS) return rows;
    } else {
      field += c;
    }
  }
  row.push(field.trim());
  rows.push(row);
  // A trailing newline leaves one empty row; blank rows anywhere are noise.
  return rows.filter((r) => r.some((cell) => cell !== ""));
}

/** Pick the separator that yields the most columns on the busiest early line. */
function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20);
  let best = ",";
  let bestScore = 0;
  for (const sep of [",", "\t", ";", "|"]) {
    // Count outside quotes only — a description holding a comma would
    // otherwise make the comma look like the winner on a tab-separated file.
    const score = sample.reduce((s, line) => {
      let q = false;
      let n = 0;
      for (const ch of line) {
        if (ch === '"') q = !q;
        else if (ch === sep && !q) n++;
      }
      return s + n;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      best = sep;
    }
  }
  return best;
}

const XLSX_RE = /\.(xlsx|xlsm)$/i;
const DELIMITED_RE = /\.(csv|tsv|txt)$/i;

/** True when this file is one we can read into a grid at all. */
export function isSpreadsheetFile(file: File): boolean {
  return (
    XLSX_RE.test(file.name) ||
    DELIMITED_RE.test(file.name) ||
    file.type === "text/csv" ||
    file.type === "text/tab-separated-values" ||
    file.type.includes("spreadsheetml")
  );
}

/**
 * Read a spreadsheet into one table per sheet, in workbook order. Throws with a
 * message worth showing when the file isn't something we can open — the old
 * binary .xls in particular, which looks identical to the user but isn't a zip
 * of XML and can't be read here.
 */
export async function readSpreadsheet(file: File): Promise<SheetTable[]> {
  if (/\.xls$/i.test(file.name)) {
    throw new Error(
      "That's the older .xls format, which can't be read here. Open it and use File → Save As to save it as .xlsx or .csv, then try again.",
    );
  }

  if (XLSX_RE.test(file.name) || file.type.includes("spreadsheetml")) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    let sheets: { sheet: string; data: unknown[][] }[];
    try {
      sheets = (await readXlsxFile(file)) as unknown as {
        sheet: string;
        data: unknown[][];
      }[];
    } catch (err) {
      throw new Error(
        `That .xlsx file couldn't be opened (${
          err instanceof Error ? err.message : String(err)
        }). Saving it again as .csv usually works.`,
      );
    }
    const tables = sheets.map((s) => ({
      name: s.sheet,
      rows: s.data
        .slice(0, MAX_ROWS)
        .map((r) => r.map(cellToString))
        .filter((r) => r.some((cell) => cell !== "")),
    }));
    const withRows = tables.filter((t) => t.rows.length > 0);
    if (withRows.length === 0) {
      throw new Error("Every sheet in that workbook is empty.");
    }
    return withRows;
  }

  if (DELIMITED_RE.test(file.name) || file.type.startsWith("text/")) {
    const rows = parseDelimited(await file.text());
    if (rows.length === 0) throw new Error("That file has no rows in it.");
    return [{ name: file.name.replace(DELIMITED_RE, ""), rows }];
  }

  throw new Error(
    `"${file.name}" isn't a spreadsheet. Pick a .xlsx or .csv file, or paste the list as text instead.`,
  );
}
