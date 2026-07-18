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

interface BackupFile {
  app: "house-ledger";
  version: 1 | 2 | 3 | 4;
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
    version: 4,
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
  return {
    // Older backups (v1–v3) have no updatedAt — seed it from createdAt so
    // restored entries sort correctly in the Recent tab.
    entries: data.entries.map((e) => ({
      ...e,
      updatedAt: e.updatedAt ?? e.createdAt,
    })),
    boqItems: data.boqItems,
    stockItems: Array.isArray(data.stockItems) ? data.stockItems : [],
    stockMoves: Array.isArray(data.stockMoves) ? data.stockMoves : [],
    categories: Array.isArray(data.categories) ? data.categories : [],
    people: Array.isArray(data.people) ? data.people : [],
  };
}

/** Overwrite the database with backup contents (single transaction). */
export async function applyBackup(backup: ParsedBackup): Promise<void> {
  // Older backups have no categories table — recover any custom category
  // names referenced by the data so dropdowns and the dashboard stay complete.
  const builtin = new Set<string>(
    CATEGORIES.map((c) => c.toLowerCase()),
  );
  const restored = new Set(backup.categories.map((c) => c.name.toLowerCase()));
  const derived: CustomCategory[] = [];
  for (const cat of new Set([
    ...backup.entries.map((e) => e.category),
    ...backup.boqItems.map((b) => b.category),
    ...backup.stockItems.map((s) => s.category),
  ])) {
    if (cat && !builtin.has(cat.toLowerCase()) && !restored.has(cat.toLowerCase())) {
      derived.push({ id: crypto.randomUUID(), name: cat, createdAt: Date.now() });
      restored.add(cat.toLowerCase());
    }
  }

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
      await db.categories.bulkAdd([...backup.categories, ...derived]);
      await db.people.bulkAdd(backup.people);
    },
  );
}
