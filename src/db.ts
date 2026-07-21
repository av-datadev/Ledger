import Dexie, { type EntityTable } from "dexie";
import type {
  Entry,
  BoqItem,
  Settings,
  StockItem,
  StockMove,
  CustomCategory,
  PersonDetails,
  Attachment,
} from "./types";
import { CATEGORIES } from "../shared/constants";
import seedEntriesJson from "../seed-entries.json";
import seedBoqJson from "../seed-boq.json";

// Seed rows predate the updatedAt field — stamp it from createdAt on load so
// freshly-seeded entries sort correctly in the Recent tab.
const seedEntries = (
  seedEntriesJson as unknown as Omit<Entry, "updatedAt">[]
).map((e) => ({ ...e, updatedAt: e.createdAt })) as Entry[];

// Seed BOQ rows predate billId + the measure-basis fields. Assign one shared
// billId per (vendor|invoiceNo) group and default the new columns on load.
const seedBoq: BoqItem[] = (() => {
  const raw = seedBoqJson as unknown as Omit<
    BoqItem,
    "billId" | "basis" | "length" | "width"
  >[];
  const billIds = new Map<string, string>();
  return raw.map((b) => {
    const key = `${b.vendor}|${b.invoiceNo}`;
    let billId = billIds.get(key);
    if (!billId) {
      billId = crypto.randomUUID();
      billIds.set(key, billId);
    }
    return { ...b, billId, basis: "qty", length: null, width: null };
  });
})();

// NB: the IndexedDB name stays "house-ledger" even though the app is now
// branded "Brick Flow". Renaming it would make the browser open a brand-new,
// empty database and orphan every existing entry, photo and bill on-device.
export const db = new Dexie("house-ledger") as Dexie & {
  entries: EntityTable<Entry, "id">;
  boqItems: EntityTable<BoqItem, "id">;
  settings: EntityTable<Settings, "id">;
  stockItems: EntityTable<StockItem, "id">;
  stockMoves: EntityTable<StockMove, "id">;
  categories: EntityTable<CustomCategory, "id">;
  people: EntityTable<PersonDetails, "id">;
  attachments: EntityTable<Attachment, "id">;
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

// v6 adds the stable billId on BOQ rows (grouping each bill and letting Stock
// receipts hard-link back to it), the measure-basis columns on BOQ bills, the
// bill link on stock moves, and contract-pricing fields on people. Existing
// data is backfilled in the upgrade below.
db.version(6)
  .stores({
    entries: "id, date, category, paidBy, createdAt, updatedAt",
    boqItems: "id, invoiceNo, category, date, vendor, billId",
    settings: "id",
    stockItems: "id, category, name, createdAt",
    stockMoves: "id, stockId, date, createdAt, billId",
    categories: "id, name",
    people: "id, name",
  })
  .upgrade(async (tx) => {
    // Give every existing bill a stable id, shared across its rows.
    const boq = tx.table("boqItems");
    const rows = (await boq.toArray()) as BoqItem[];
    const billIds = new Map<string, string>();
    for (const r of rows) {
      const key = `${r.vendor}|${r.invoiceNo}`;
      if (!billIds.has(key)) billIds.set(key, crypto.randomUUID());
    }
    await boq.toCollection().modify((r: BoqItem) => {
      if (r.billId == null)
        r.billId = billIds.get(`${r.vendor}|${r.invoiceNo}`)!;
      if (r.basis == null) r.basis = "qty";
      if (r.length === undefined) r.length = null;
      if (r.width === undefined) r.width = null;
    });
    await tx
      .table("stockMoves")
      .toCollection()
      .modify((m: StockMove) => {
        if (m.billId === undefined) m.billId = null;
      });
    await tx
      .table("people")
      .toCollection()
      .modify((p: PersonDetails) => {
        if (p.contractBasis == null) p.contractBasis = "lumpsum";
        if (p.contractArea === undefined) p.contractArea = null;
        if (p.contractRate === undefined) p.contractRate = null;
      });
  });

// v7 adds photo attachments on ledger entries (cheques, diary pages). New table
// only — existing data is untouched.
db.version(7).stores({
  entries: "id, date, category, paidBy, createdAt, updatedAt",
  boqItems: "id, invoiceNo, category, date, vendor, billId",
  settings: "id",
  stockItems: "id, category, name, createdAt",
  stockMoves: "id, stockId, date, createdAt, billId",
  categories: "id, name",
  people: "id, name",
  attachments: "id, entryId, createdAt",
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

/**
 * Delete a whole BOQ bill (every row sharing the billId). Stock received from
 * it is kept — you physically have those materials — but the now-dangling bill
 * link on those receipts is cleared.
 */
export async function deleteBill(billId: string): Promise<void> {
  await db.transaction("rw", [db.boqItems, db.stockMoves], async () => {
    await db.boqItems.where("billId").equals(billId).delete();
    await db.stockMoves
      .where("billId")
      .equals(billId)
      .modify({ billId: null });
  });
}

/** Delete a ledger entry and every photo attached to it. */
export async function deleteEntry(entryId: string): Promise<void> {
  await db.transaction("rw", [db.entries, db.attachments], async () => {
    await db.entries.delete(entryId);
    await db.attachments.where("entryId").equals(entryId).delete();
  });
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
      db.attachments,
    ],
    async () => {
      await db.entries.clear();
      await db.boqItems.clear();
      await db.stockItems.clear();
      await db.stockMoves.clear();
      await db.categories.clear();
      await db.people.clear();
      await db.attachments.clear();
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
