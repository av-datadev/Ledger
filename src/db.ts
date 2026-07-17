import Dexie, { type EntityTable } from "dexie";
import type {
  Entry,
  BoqItem,
  Settings,
  StockItem,
  StockMove,
  CustomCategory,
} from "./types";
import seedEntriesJson from "../seed-entries.json";
import seedBoqJson from "../seed-boq.json";

const seedEntries = seedEntriesJson as unknown as Entry[];
const seedBoq = seedBoqJson as unknown as BoqItem[];

export const db = new Dexie("house-ledger") as Dexie & {
  entries: EntityTable<Entry, "id">;
  boqItems: EntityTable<BoqItem, "id">;
  settings: EntityTable<Settings, "id">;
  stockItems: EntityTable<StockItem, "id">;
  stockMoves: EntityTable<StockMove, "id">;
  categories: EntityTable<CustomCategory, "id">;
};

db.version(1).stores({
  entries: "id, date, category, paidBy, createdAt",
  boqItems: "id, invoiceNo, category, date, vendor",
  settings: "id",
});

// v2 adds the inventory tables; existing tables and data are untouched.
db.version(2).stores({
  entries: "id, date, category, paidBy, createdAt",
  boqItems: "id, invoiceNo, category, date, vendor",
  settings: "id",
  stockItems: "id, category, name, createdAt",
  stockMoves: "id, stockId, date, createdAt",
});

// v3 adds user-defined categories/payees (People tab).
db.version(3).stores({
  entries: "id, date, category, paidBy, createdAt",
  boqItems: "id, invoiceNo, category, date, vendor",
  settings: "id",
  stockItems: "id, category, name, createdAt",
  stockMoves: "id, stockId, date, createdAt",
  categories: "id, name",
});

const SETTINGS_ID = "app";

/** First-run-only migration: seed each table independently if empty. */
export async function seedIfEmpty(): Promise<void> {
  await db.transaction("rw", db.entries, db.boqItems, db.settings, async () => {
    if ((await db.entries.count()) === 0) {
      await db.entries.bulkAdd(seedEntries);
    }
    if ((await db.boqItems.count()) === 0) {
      await db.boqItems.bulkAdd(seedBoq);
    }
    if (!(await db.settings.get(SETTINGS_ID))) {
      await db.settings.add({
        id: SETTINGS_ID,
        lastBackupDate: null,
      });
    }
  });
}

/** Wipe everything and reload the bundled seed JSON. */
export async function resetToSeed(): Promise<void> {
  await db.transaction(
    "rw",
    [db.entries, db.boqItems, db.stockItems, db.stockMoves, db.categories],
    async () => {
      await db.entries.clear();
      await db.boqItems.clear();
      await db.stockItems.clear();
      await db.stockMoves.clear();
      await db.categories.clear();
      await db.entries.bulkAdd(seedEntries);
      await db.boqItems.bulkAdd(seedBoq);
    },
  );
}

export async function getSettings(): Promise<Settings> {
  return (
    (await db.settings.get(SETTINGS_ID)) ?? {
      id: SETTINGS_ID,
      lastBackupDate: null,
    }
  );
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await db.settings.update(SETTINGS_ID, patch);
}
