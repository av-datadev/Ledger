import { db, updateSettings } from "../db";
import type {
  Entry,
  BoqItem,
  StockItem,
  StockMove,
  CustomCategory,
  PersonDetails,
} from "../types";
import { CATEGORIES } from "../../shared/constants";
import { downloadFile, timestampSlug } from "./csv";

// Custom categories sort after every built-in (mirrors CUSTOM_ORDER in db.ts).
const CUSTOM_ORDER = 1000;

interface BackupFile {
  app: "house-ledger";
  version: 1 | 2 | 3 | 4 | 5 | 6;
  exportedAt: string;
  entries: Entry[];
  boqItems: BoqItem[];
  // Added in version 2 — absent from older backup files.
  stockItems?: StockItem[];
  stockMoves?: StockMove[];
  // Added in version 3 — user-defined categories/payees.
  categories?: CustomCategory[];
  // Added in version 4 — per-person contact/contract details.
  people?: PersonDetails[];
}

/** Full-database JSON export — the primary safety net. */
export async function exportBackup(): Promise<void> {
  const [entries, boqItems, stockItems, stockMoves, categories, people] =
    await Promise.all([
      db.entries.toArray(),
      db.boqItems.toArray(),
      db.stockItems.toArray(),
      db.stockMoves.toArray(),
      db.categories.toArray(),
      db.people.toArray(),
    ]);
  const payload: BackupFile = {
    app: "house-ledger",
    version: 6,
    exportedAt: new Date().toISOString(),
    entries,
    boqItems,
    stockItems,
    stockMoves,
    categories,
    people,
  };
  downloadFile(
    `house-ledger-backup-${timestampSlug()}.json`,
    JSON.stringify(payload, null, 1),
    "application/json",
  );
  await updateSettings({ lastBackupDate: new Date().toISOString() });
}

export interface ParsedBackup {
  version: number;
  entries: Entry[];
  boqItems: BoqItem[];
  stockItems: StockItem[];
  stockMoves: StockMove[];
  categories: CustomCategory[];
  people: PersonDetails[];
}

/** Parse and sanity-check a backup file. Throws with a readable message. */
export async function readBackupFile(file: File): Promise<ParsedBackup> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const data = raw as Partial<BackupFile>;
  if (!Array.isArray(data.entries) || !Array.isArray(data.boqItems)) {
    throw new Error(
      "That file doesn't look like a House Ledger backup (missing entries/boqItems arrays).",
    );
  }
  for (const e of data.entries) {
    if (typeof e.id !== "string" || typeof e.amount !== "number") {
      throw new Error("Backup entries are malformed — import aborted.");
    }
  }
  for (const b of data.boqItems) {
    if (typeof b.id !== "string" || typeof b.amount !== "number") {
      throw new Error("Backup BOQ items are malformed — import aborted.");
    }
  }
  // Pre-v6 BOQ rows have no billId — give each (vendor|invoiceNo) group one
  // shared id — nor the measure-basis columns.
  const billIds = new Map<string, string>();
  const boqItems = data.boqItems.map((b) => {
    const key = `${b.vendor}|${b.invoiceNo}`;
    let billId: string;
    if (b.billId) {
      billId = b.billId;
    } else {
      const cached = billIds.get(key);
      if (cached) {
        billId = cached;
      } else {
        billId = crypto.randomUUID();
        billIds.set(key, billId);
      }
    }
    return {
      ...b,
      billId,
      basis: b.basis ?? "qty",
      length: b.length ?? null,
      width: b.width ?? null,
    };
  });

  return {
    version: typeof data.version === "number" ? data.version : 1,
    // Older backups (v1–v3) have no updatedAt — seed it from createdAt so
    // restored entries sort correctly in the Recent tab.
    entries: data.entries.map((e) => ({
      ...e,
      updatedAt: e.updatedAt ?? e.createdAt,
    })),
    boqItems,
    stockItems: Array.isArray(data.stockItems) ? data.stockItems : [],
    // Pre-v6 stock moves have no bill link.
    stockMoves: (Array.isArray(data.stockMoves) ? data.stockMoves : []).map(
      (m) => ({ ...m, billId: m.billId ?? null }),
    ),
    // Pre-v5 category rows have no `order` — slot them after the built-ins.
    categories: (Array.isArray(data.categories) ? data.categories : []).map(
      (c) => ({ ...c, order: c.order ?? CUSTOM_ORDER }),
    ),
    // Pre-v5 people rows have no bank fields; pre-v6 have no contract basis.
    people: (Array.isArray(data.people) ? data.people : []).map((p) => ({
      ...p,
      bankName: p.bankName ?? "",
      accountHolder: p.accountHolder ?? "",
      accountNumber: p.accountNumber ?? "",
      ifsc: p.ifsc ?? "",
      upi: p.upi ?? "",
      contractBasis: p.contractBasis ?? "lumpsum",
      contractArea: p.contractArea ?? null,
      contractRate: p.contractRate ?? null,
      updatedAt: p.updatedAt ?? p.createdAt,
    })),
  };
}

/** Overwrite the database with backup contents (single transaction). */
export async function applyBackup(backup: ParsedBackup): Promise<void> {
  // Pre-v5 backups predate categories-as-rows: the built-ins weren't stored.
  const isLegacy = backup.version < 5;
  const builtin = new Set<string>(CATEGORIES.map((c) => c.toLowerCase()));
  const restored = new Set(backup.categories.map((c) => c.name.toLowerCase()));
  const now = Date.now();

  // Recover any category referenced by the data but missing from the file
  // (skip built-ins for legacy files — they're re-seeded in full below).
  const derived: CustomCategory[] = [];
  for (const cat of new Set([
    ...backup.entries.map((e) => e.category),
    ...backup.boqItems.map((b) => b.category),
    ...backup.stockItems.map((s) => s.category),
  ])) {
    if (
      cat &&
      !restored.has(cat.toLowerCase()) &&
      !(isLegacy && builtin.has(cat.toLowerCase()))
    ) {
      derived.push({ id: crypto.randomUUID(), name: cat, order: CUSTOM_ORDER, createdAt: now });
      restored.add(cat.toLowerCase());
    }
  }

  // Legacy files: re-seed every built-in category that isn't already present.
  const builtinRows: CustomCategory[] = isLegacy
    ? CATEGORIES.map((name, i) => ({
        id: crypto.randomUUID(),
        name,
        order: i,
        createdAt: now,
      })).filter((c) => !restored.has(c.name.toLowerCase()))
    : [];

  await db.transaction(
    "rw",
    [
      db.entries,
      db.boqItems,
      db.stockItems,
      db.stockMoves,
      db.categories,
      db.people,
    ],
    async () => {
      await db.entries.clear();
      await db.boqItems.clear();
      await db.stockItems.clear();
      await db.stockMoves.clear();
      await db.categories.clear();
      await db.people.clear();
      await db.entries.bulkAdd(backup.entries);
      await db.boqItems.bulkAdd(backup.boqItems);
      await db.stockItems.bulkAdd(backup.stockItems);
      await db.stockMoves.bulkAdd(backup.stockMoves);
      await db.categories.bulkAdd([
        ...backup.categories,
        ...derived,
        ...builtinRows,
      ]);
      await db.people.bulkAdd(backup.people);
    },
  );
}
