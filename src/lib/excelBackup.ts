// A full backup of the ledger as a real .xlsx workbook, and the reader that
// takes one back in.
//
// This exists alongside the JSON backup rather than replacing it. JSON is still
// the primary safety net because it is lossless: it carries the photo blobs,
// and a photographed kaccha slip is often the only evidence a payment happened
// at all. A spreadsheet cannot hold those, so the Excel file is DATA ONLY —
// every table, no photos — and the UI says so where it's offered.
//
// What Excel buys in exchange is that the backup is legible. The JSON file can
// only be read back by this app; the workbook opens on any phone or laptop, and
// a wrong figure can be corrected in the sheet and imported back. That makes it
// the format to hand an accountant, or to check a year's spend against.
//
// One column spec per table drives BOTH directions. A single list is the only
// way the writer and reader cannot drift apart — add a field in one place and
// the round trip keeps working.
// The two xlsx libraries are loaded on demand rather than imported at the top.
// They cost ~40 KB gzipped between them, and taking a backup is a once-a-week
// action on a phone that may be on a site with one bar of signal — no reason to
// make every cold start carry it. The /browser builds skip the Node filesystem
// paths entirely.
import { db } from "../db";
import type {
  Entry,
  BoqItem,
  StockItem,
  StockMove,
  CustomCategory,
  PersonDetails,
} from "../types";

/**
 * How one field survives the trip to a spreadsheet cell and back.
 *   text   — a plain string
 *   number — a number; blank cell means null
 *   bool   — TRUE/FALSE
 *   json   — anything structured (a person's floor-wise contract lines), kept
 *            as JSON text in the cell so it round-trips without inventing a
 *            column per nested field
 */
type ColType = "text" | "number" | "bool" | "json";

interface Column<T> {
  key: keyof T & string;
  type: ColType;
  /** Blank cells become null rather than 0/"" — the two mean different things
   * on a bill (no rate written vs a rate of zero). */
  nullable?: boolean;
}

interface TableSpec<T> {
  /** Worksheet name, and the name the reader looks for on the way back. */
  sheet: string;
  columns: Column<T>[];
}

const ENTRIES: TableSpec<Entry> = {
  sheet: "Entries",
  columns: [
    { key: "id", type: "text" },
    { key: "date", type: "text" },
    { key: "category", type: "text" },
    { key: "event", type: "text" },
    { key: "detail", type: "text" },
    { key: "amount", type: "number" },
    { key: "mode", type: "text" },
    { key: "paidBy", type: "text" },
    { key: "notes", type: "text" },
    { key: "createdAt", type: "number" },
    { key: "updatedAt", type: "number" },
  ],
};

const BOQ: TableSpec<BoqItem> = {
  sheet: "BOQ",
  columns: [
    { key: "id", type: "text" },
    { key: "billId", type: "text" },
    { key: "date", type: "text" },
    { key: "category", type: "text" },
    { key: "vendor", type: "text" },
    { key: "invoiceNo", type: "text" },
    { key: "invoiceTotal", type: "number" },
    { key: "item", type: "text" },
    { key: "hsn", type: "text", nullable: true },
    { key: "gstPct", type: "number", nullable: true },
    { key: "basis", type: "text" },
    { key: "length", type: "number", nullable: true },
    { key: "width", type: "number", nullable: true },
    { key: "thickness", type: "number", nullable: true },
    { key: "pieces", type: "number", nullable: true },
    { key: "writtenQty", type: "number", nullable: true },
    { key: "qty", type: "number", nullable: true },
    { key: "unit", type: "text", nullable: true },
    { key: "rate", type: "number", nullable: true },
    { key: "discPct", type: "number", nullable: true },
    { key: "amount", type: "number" },
  ],
};

const STOCK_ITEMS: TableSpec<StockItem> = {
  sheet: "Stock items",
  columns: [
    { key: "id", type: "text" },
    { key: "name", type: "text" },
    { key: "category", type: "text" },
    { key: "unit", type: "text" },
    { key: "done", type: "bool" },
    { key: "createdAt", type: "number" },
  ],
};

const STOCK_MOVES: TableSpec<StockMove> = {
  sheet: "Stock moves",
  columns: [
    { key: "id", type: "text" },
    { key: "stockId", type: "text" },
    { key: "date", type: "text" },
    { key: "kind", type: "text" },
    { key: "qty", type: "number" },
    { key: "note", type: "text" },
    { key: "billId", type: "text", nullable: true },
    { key: "createdAt", type: "number" },
  ],
};

const CATEGORIES: TableSpec<CustomCategory> = {
  sheet: "Categories",
  columns: [
    { key: "id", type: "text" },
    { key: "name", type: "text" },
    { key: "order", type: "number" },
    { key: "createdAt", type: "number" },
  ],
};

const PEOPLE: TableSpec<PersonDetails> = {
  sheet: "People",
  columns: [
    { key: "id", type: "text" },
    { key: "name", type: "text" },
    { key: "role", type: "text" },
    { key: "phone", type: "text" },
    { key: "idNumber", type: "text" },
    { key: "contractBasis", type: "text" },
    { key: "contractArea", type: "number", nullable: true },
    { key: "contractRate", type: "number", nullable: true },
    { key: "contractAmount", type: "number", nullable: true },
    { key: "contractLines", type: "json" },
    { key: "contractDetails", type: "text" },
    { key: "bankName", type: "text" },
    { key: "accountHolder", type: "text" },
    { key: "accountNumber", type: "text" },
    { key: "ifsc", type: "text" },
    { key: "upi", type: "text" },
    { key: "createdAt", type: "number" },
    { key: "updatedAt", type: "number" },
  ],
};

/** Marks the workbook as ours, and records which app version wrote it — the
 * same job the JSON backup's `app`/`version` keys do. Without it, any
 * spreadsheet at all would look like a candidate for import. */
const META_SHEET = "Brick Flow";
const FORMAT_VERSION = 1;

type Row = (string | number | boolean | null)[];

function toCell(value: unknown, type: ColType): string | number | boolean | null {
  if (type === "json") return JSON.stringify(value ?? null);
  if (value === null || value === undefined) return null;
  if (type === "number") return typeof value === "number" ? value : Number(value);
  if (type === "bool") return value === true;
  return String(value);
}

function sheetFor<T>(spec: TableSpec<T>, rows: T[]) {
  const header: Row = spec.columns.map((c) => c.key);
  const body: Row[] = rows.map((r) =>
    spec.columns.map((c) => toCell(r[c.key], c.type)),
  );
  return {
    sheet: spec.sheet,
    // A header row of plain strings; write-excel-file infers the type per cell
    // from the value, which is why toCell hands it real numbers and booleans
    // rather than pre-formatted text.
    data: [header, ...body],
  };
}

/** Everything, as one workbook. Photos are deliberately not included. */
export async function exportExcelBackup(): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const [entries, boqItems, stockItems, stockMoves, categories, people] =
    await Promise.all([
      db.entries.toArray(),
      db.boqItems.toArray(),
      db.stockItems.toArray(),
      db.stockMoves.toArray(),
      db.categories.toArray(),
      db.people.toArray(),
    ]);

  const meta = {
    sheet: META_SHEET,
    data: [
      ["app", "brick-flow-excel"],
      ["formatVersion", FORMAT_VERSION],
      ["exportedAt", new Date().toISOString()],
      ["note", "Data only — entry photos are not included. Keep a .json backup for those."],
    ] as Row[],
  };

  return writeXlsxFile(
    [
      meta,
      sheetFor(ENTRIES, entries),
      sheetFor(BOQ, boqItems),
      sheetFor(STOCK_ITEMS, stockItems),
      sheetFor(STOCK_MOVES, stockMoves),
      sheetFor(CATEGORIES, categories),
      sheetFor(PEOPLE, people),
    ],
    { fontFamily: "Calibri", fontSize: 11 },
  ).toBlob();
}

export interface ParsedExcelBackup {
  entries: Entry[];
  boqItems: BoqItem[];
  stockItems: StockItem[];
  stockMoves: StockMove[];
  categories: CustomCategory[];
  people: PersonDetails[];
}

function fromCell(raw: unknown, col: Column<unknown>): unknown {
  const blank = raw === null || raw === undefined || raw === "";
  switch (col.type) {
    case "json":
      if (blank) return [];
      try {
        return JSON.parse(String(raw)) ?? [];
      } catch {
        return [];
      }
    case "number": {
      if (blank) return col.nullable ? null : 0;
      // Excel may hand back a string where a user retyped a figure by hand.
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
      return Number.isFinite(n) ? n : col.nullable ? null : 0;
    }
    case "bool":
      if (blank) return false;
      if (typeof raw === "boolean") return raw;
      return /^(true|yes|1)$/i.test(String(raw).trim());
    default:
      if (blank) return col.nullable ? null : "";
      // Dates come back as Date objects when Excel has typed the column;
      // normalise to the YYYY-MM-DD the rest of the app stores.
      if (raw instanceof Date) return raw.toISOString().slice(0, 10);
      return String(raw);
  }
}

/**
 * Read one sheet by name into objects, mapping columns by their HEADER rather
 * than by position — so a column moved or an extra note column added by hand in
 * Excel doesn't silently shift every value one field to the left.
 */
async function readTable<T>(file: File, spec: TableSpec<T>): Promise<T[]> {
  const { readSheet } = await import("read-excel-file/browser");
  let rows: unknown[][];
  try {
    rows = (await readSheet(file, spec.sheet)) as unknown[][];
  } catch {
    // A missing sheet is not fatal: an older or hand-trimmed workbook may
    // simply have no Stock tab.
    return [];
  }
  if (!rows.length) return [];

  const header = rows[0].map((h) => String(h ?? "").trim());
  const index = new Map(header.map((h, i) => [h, i]));

  return rows.slice(1).flatMap((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of spec.columns) {
      const at = index.get(col.key);
      obj[col.key] = fromCell(
        at === undefined ? null : row[at],
        col as Column<unknown>,
      );
    }
    // A row with no id is a stray note or a blank line left in the sheet, not a
    // record — dropping it beats importing a ghost with a generated id.
    return obj.id ? [obj as T] : [];
  });
}

/** Parse and sanity-check a workbook. Throws with a readable message. */
export async function readExcelBackupFile(file: File): Promise<ParsedExcelBackup> {
  const { readSheet } = await import("read-excel-file/browser");
  let metaRows: unknown[][];
  try {
    metaRows = (await readSheet(file, META_SHEET)) as unknown[][];
  } catch {
    throw new Error(
      "That workbook wasn't written by Brick Flow — it has no \"Brick Flow\" sheet. Export one from Data → Backup first.",
    );
  }
  const app = metaRows.find((r) => String(r[0]).trim() === "app")?.[1];
  if (String(app ?? "").trim() !== "brick-flow-excel") {
    throw new Error(
      "That workbook wasn't written by Brick Flow. Export one from Data → Backup first.",
    );
  }

  const [entries, boqItems, stockItems, stockMoves, categories, people] =
    await Promise.all([
      readTable(file, ENTRIES),
      readTable(file, BOQ),
      readTable(file, STOCK_ITEMS),
      readTable(file, STOCK_MOVES),
      readTable(file, CATEGORIES),
      readTable(file, PEOPLE),
    ]);

  // The same guard the JSON path applies: a file that parses but carries no
  // money is far more likely to be the wrong file than a real empty ledger.
  if (entries.length === 0 && boqItems.length === 0) {
    throw new Error(
      "That workbook has no entries and no bills in it — nothing to restore.",
    );
  }
  for (const e of entries) {
    if (typeof e.amount !== "number" || !Number.isFinite(e.amount)) {
      throw new Error(
        `Entry "${e.event || e.id}" has an amount Excel couldn't read as a number — fix it in the sheet and try again.`,
      );
    }
  }

  return { entries, boqItems, stockItems, stockMoves, categories, people };
}
