// Reads somebody else's file into plain rows, so it can be mapped onto the
// ledger. Nothing here understands what the columns MEAN — that is
// importMap.ts's job. This file only gets the grid out of an .xlsx, a .csv or
// a pasted note.
//
// Everything is local. No part of reading a file touches the network.

export interface RawSheet {
  name: string;
  rows: unknown[][];
}

/** Cap on what we hold in memory and hand to the mapper. A house ledger of
 * 5,000 rows is already a decade of building; beyond that something is wrong
 * with the file rather than with the limit. */
const MAX_ROWS = 20_000;
const MAX_COLS = 40;

/**
 * A CSV parser that survives what Excel actually emits: quoted fields holding
 * commas and newlines, doubled quotes as an escape, and CRLF endings.
 *
 * Written by hand rather than pulled in as a dependency — this is ~40 lines and
 * the app is deliberately dependency-light, with the two spreadsheet libraries
 * already lazy-loaded to keep the bundle down.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // A leading BOM otherwise becomes part of the first header name, which then
  // fails to match anything.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      // Swallow the \n of a \r\n pair rather than emitting a blank row.
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // A file not ending in a newline still has a final row pending.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Split pasted text into a grid.
 *
 * A note copied out of a spreadsheet arrives tab-separated; one copied from a
 * message or a phone note usually lines up its columns with runs of spaces.
 * The delimiter is chosen from whichever produces a consistent number of
 * columns across the most lines, because guessing per-line would shear a row
 * whose description happens to contain a comma.
 */
export function parsePastedText(text: string): RawSheet {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");

  const candidates: { split: (l: string) => string[]; label: string }[] = [
    { split: (l) => l.split("\t"), label: "tab" },
    { split: (l) => parseCsv(l)[0] ?? [l], label: "comma" },
    { split: (l) => l.split(/\s{2,}/), label: "spaces" },
  ];

  let best: string[][] = lines.map((l) => [l]);
  let bestScore = 0;

  for (const c of candidates) {
    const grid = lines.map(c.split);
    const widths = grid.map((r) => r.length).filter((n) => n > 1);
    if (widths.length === 0) continue;
    // Reward both "more than one column" and "the same shape on most lines".
    const mode = widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)];
    const consistent = grid.filter((r) => r.length === mode).length;
    const score = consistent * mode;
    if (score > bestScore) {
      bestScore = score;
      best = grid;
    }
  }

  return {
    name: "Pasted note",
    rows: best.map((r) => r.slice(0, MAX_COLS)).slice(0, MAX_ROWS),
  };
}

/** True when a pasted note could not be split into columns at all — every line
 * is one blob. Worth saying out loud rather than importing one useless column. */
export function looksUnstructured(sheet: RawSheet): boolean {
  const widths = sheet.rows.map((r) => r.length);
  if (widths.length === 0) return true;
  return widths.every((w) => w <= 1);
}

/**
 * Read an .xlsx into one entry per sheet.
 *
 * read-excel-file has changed the shape of its whole-workbook call between
 * majors, so both are handled: `{sheet,data}[]` (current) and a bare row array
 * (older). If neither matches, sheets are pulled one index at a time via
 * readSheet — the call the app's own backup restore already relies on — until
 * one doesn't exist.
 */
async function readWorkbook(file: File): Promise<RawSheet[]> {
  const mod = (await import("read-excel-file/browser")) as unknown as {
    default: (input: File) => Promise<unknown>;
    readSheet: (input: File, sheet: number | string) => Promise<unknown[][]>;
  };

  try {
    const all = await mod.default(file);
    if (Array.isArray(all) && all.length > 0) {
      const first = all[0] as unknown;
      if (
        first &&
        typeof first === "object" &&
        !Array.isArray(first) &&
        typeof (first as { sheet?: unknown }).sheet === "string"
      ) {
        return (all as { sheet: string; data: unknown[][] }[]).map((s) => ({
          name: s.sheet,
          rows: s.data ?? [],
        }));
      }
      if (Array.isArray(first)) {
        return [{ name: "Sheet 1", rows: all as unknown[][] }];
      }
    }
  } catch {
    // Fall through to the per-index path below.
  }

  const out: RawSheet[] = [];
  for (let i = 1; i <= 8; i++) {
    try {
      const rows = await mod.readSheet(file, i);
      if (!Array.isArray(rows)) break;
      out.push({ name: `Sheet ${i}`, rows });
    } catch {
      break;
    }
  }
  return out;
}

/** Read any supported file into sheets. Throws with a readable message. */
export async function readImportFile(file: File): Promise<RawSheet[]> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const rows = parseCsv(await file.text());
    return [{ name: file.name, rows: rows.slice(0, MAX_ROWS) }];
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const sheets = await readWorkbook(file);
    if (sheets.length === 0) {
      throw new Error("That workbook has no readable sheets in it.");
    }
    return sheets.map((s) => ({
      name: s.name,
      rows: s.rows.slice(0, MAX_ROWS).map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS) : [])),
    }));
  }

  if (name.endsWith(".xls")) {
    throw new Error(
      "That's an old .xls file. Open it in Excel or Google Sheets and save it as .xlsx, then try again.",
    );
  }

  throw new Error(
    "Pick a .xlsx or .csv file — or paste the text instead if it's a note from your phone.",
  );
}

/**
 * The small sample that is sent away to be understood.
 *
 * This is the privacy boundary of the whole feature, so it is a function of its
 * own rather than something assembled inline at the call site: everything the
 * server can ever see is decided here. Long cells are clipped because a single
 * remarks column can otherwise carry a paragraph about a person.
 */
export function structureSample(
  sheets: RawSheet[],
): { name: string; rows: unknown[][] }[] {
  const SAMPLE_ROWS = 10;
  const SAMPLE_COLS = 25;
  const MAX_CELL_CHARS = 80;

  return sheets.slice(0, 6).map((s) => ({
    name: s.name.slice(0, 120),
    rows: s.rows.slice(0, SAMPLE_ROWS).map((r) =>
      r.slice(0, SAMPLE_COLS).map((cell) => {
        if (cell === null || cell === undefined) return "";
        if (cell instanceof Date) return cell.toISOString().slice(0, 10);
        if (typeof cell === "number" || typeof cell === "boolean") return cell;
        return String(cell).slice(0, MAX_CELL_CHARS);
      }),
    ),
  }));
}
