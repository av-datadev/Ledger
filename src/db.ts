import Dexie, { type EntityTable } from "dexie";
import type {
  Entry,
  BoqItem,
  Settings,
  StockItem,
  StockMove,
  CustomCategory,
  PersonDetails,
} from "./types";
import { CATEGORIES } from "../shared/constants";
import seedEntriesJson from "../seed-entries.json";
import seedBoqJson from "../seed-boq.json";

// Seed rows predate the updatedAt field — stamp it from createdAt on load so
// freshly-seeded entries sort correctly in the Recent tab.
const seedEntries = (
  seedEntriesJson as unknown as Omit<Entry, "updatedAt">[]
).map((e) => ({ ...e, updatedAt: e.createdAt })) as Entry[];
const seedBoq = seedBoqJson as unknown as BoqItem[];

export const db = new Dexie("house-ledger") as Dexie & {
  entries: EntityTable<Entry, "id">;
  boqItems: EntityTable<BoqItem, "id">;
  settings: EntityTable<Settings, "id">;
  stockItems: EntityTable<StockItem, "id">;
  stockMoves: EntityTable<StockMove, "id">;
  categories: EntityTable<CustomCategory, "id">;
  people: EntityTable<PersonDetails, "id">;
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

// v4 indexes entries.updatedAt (Recent tab ordering) and adds the `people`
// table for per-person contact/contract details.
db.version(4)
  .stores({
    entries: "id, date, category, paidBy, createdAt, updatedAt",
    boqItems: "id, invoiceNo, category, date, vendor",
    settings: "id",
    stockItems: "id, category, name, createdAt",
    stockMoves: "id, stockId, date, createdAt",
    categories: "id, name",
    people: "id, name",
  })
  .upgrade(async (tx) => {
    // Existing entries have no updatedAt — seed it from createdAt so they sort
    // sensibly in the Recent tab until they're next edited.
    await tx
      .table("entries")
      .toCollection()
      .modify((e: Entry) => {
        if (e.updatedAt == null) e.updatedAt = e.createdAt;
      });
  });

// v5 promotes built-in categories to editable rows so every category/person can
// be renamed or removed. Existing custom rows get an `order` so they sort after
// the built-ins, and any missing built-in is inserted.
db.version(5)
  .stores({
    entries: "id, date, category, paidBy, createdAt, updatedAt",
    boqItems: "id, invoiceNo, category, date, vendor",
    settings: "id",
    stockItems: "id, category, name, createdAt",
    stockMoves: "id, stockId, date, createdAt",
    categories: "id, name",
    people: "id, name",
  })
  .upgrade(async (tx) => {
    const table = tx.table("categories");
    await table.toCollection().modify((c: CustomCategory) => {
      if (c.order == null) c.order = CUSTOM_ORDER; // existing rows are all custom
    });
    await seedBuiltinCategories(table);
  });

const SETTINGS_ID = "app";

// Custom categories sort after every built-in (which occupy 0..N-1).
const CUSTOM_ORDER = 1000;

/** Built-in category rows, in their canonical order. */
function builtinCategoryRows(): CustomCategory[] {
  const now = Date.now();
  return CATEGORIES.map((name, i) => ({
    id: crypto.randomUUID(),
    name,
    order: i,
    createdAt: now,
  }));
}

/** Insert any built-in category not already present (by name, case-insensitive). */
async function seedBuiltinCategories(table: {
  toArray: () => Promise<CustomCategory[]>;
  bulkAdd: (rows: CustomCategory[]) => Promise<unknown>;
}): Promise<void> {
  const existing = await table.toArray();
  const have = new Set(existing.map((c) => c.name.toLowerCase()));
  const missing = builtinCategoryRows().filter(
    (c) => !have.has(c.name.toLowerCase()),
  );
  if (missing.length) await table.bulkAdd(missing);
}

/**
 * Rename a category everywhere: the category row itself, every record that
 * references it by name, and any attached person details.
 */
export async function renameCategory(
  oldName: string,
  newName: string,
): Promise<void> {
  const next = newName.trim().replace(/\s+/g, " ");
  if (!next || next === oldName) return;
  await db.transaction(
    "rw",
    [db.categories, db.entries, db.boqItems, db.stockItems, db.people],
    async () => {
      const row = await db.categories.where("name").equals(oldName).first();
      if (row) await db.categories.update(row.id, { name: next });
      await db.entries.where("category").equals(oldName).modify({ category: next });
      await db.boqItems.where("category").equals(oldName).modify({ category: next });
      await db.stockItems.where("category").equals(oldName).modify({ category: next });
      const pd = await db.people.where("name").equals(oldName).first();
      if (pd) await db.people.update(pd.id, { name: next });
    },
  );
}

/** Remove a category row and any attached person details. */
export async function deleteCategory(name: string): Promise<void> {
  await db.transaction("rw", [db.categories, db.people], async () => {
    const row = await db.categories.where("name").equals(name).first();
    if (row) await db.categories.delete(row.id);
    const pd = await db.people.where("name").equals(name).first();
    if (pd) await db.people.delete(pd.id);
  });
}

/** First-run-only migration: seed each table independently if empty. */
export async function seedIfEmpty(): Promise<void> {
  await db.transaction(
    "rw",
    [db.entries, db.boqItems, db.settings, db.categories],
    async () => {
      if ((await db.entries.count()) === 0) {
        await db.entries.bulkAdd(seedEntries);
      }
      if ((await db.boqItems.count()) === 0) {
        await db.boqItems.bulkAdd(seedBoq);
      }
      // Fresh install: populate the built-in categories as editable rows.
      if ((await db.categories.count()) === 0) {
        await db.categories.bulkAdd(builtinCategoryRows());
      }
      if (!(await db.settings.get(SETTINGS_ID))) {
        await db.settings.add({
          id: SETTINGS_ID,
          lastBackupDate: null,
          budget: null,
          homeAddress: "",
          state: "",
          city: "",
        });
      }
    },
  );
}

/** Wipe everything and reload the bundled seed JSON. */
export async function resetToSeed(): Promise<void> {
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
      await db.entries.bulkAdd(seedEntries);
      await db.boqItems.bulkAdd(seedBoq);
      await db.categories.bulkAdd(builtinCategoryRows());
    },
  );
}

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get(SETTINGS_ID);
  return {
    id: SETTINGS_ID,
    lastBackupDate: null,
    budget: null,
    homeAddress: "",
    state: "",
    city: "",
    ...s,
  };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await db.settings.update(SETTINGS_ID, patch);
}
