import { db } from "../db";
import type { StockItem, StockMove } from "../types";

export interface StockWithBalance extends StockItem {
  inQty: number;
  outQty: number;
  balance: number;
}

export function withBalances(
  items: StockItem[],
  moves: StockMove[],
): StockWithBalance[] {
  const inMap = new Map<string, number>();
  const outMap = new Map<string, number>();
  for (const m of moves) {
    const map = m.kind === "in" ? inMap : outMap;
    map.set(m.stockId, (map.get(m.stockId) ?? 0) + m.qty);
  }
  return items.map((it) => {
    const inQty = inMap.get(it.id) ?? 0;
    const outQty = outMap.get(it.id) ?? 0;
    return {
      ...it,
      inQty,
      outQty,
      balance: Math.round((inQty - outQty) * 1000) / 1000,
    };
  });
}

const TAX_ROW =
  /\b(sgst|cgst|igst|gst|freight|packing|round\w*|discount|cartage)\b/i;

/** A real material line (not a tax/freight/rounding row) worth stocking. */
export function isMaterialRow(name: string): boolean {
  return !TAX_ROW.test(name) && name.trim().length >= 2;
}

export interface BillStockRow {
  name: string;
  qty: number;
  unit: string;
}

/**
 * Feed a saved bill's quantity rows into inventory: reuse an existing stock
 * item with the same name+category, else create one, and record an "in" move
 * hard-linked to the source bill (billId) so the two-way BOQ↔Stock views work.
 */
export async function addBillRowsToStock(
  rows: BillStockRow[],
  category: string,
  date: string,
  note: string,
  billId: string,
): Promise<number> {
  const usable = rows.filter(
    (r) => r.qty > 0 && !TAX_ROW.test(r.name) && r.name.trim().length >= 2,
  );
  if (!usable.length) return 0;

  await db.transaction("rw", [db.stockItems, db.stockMoves], async () => {
    const existing = await db.stockItems.toArray();
    for (const row of usable) {
      const name = row.name.trim();
      let item = existing.find(
        (s) =>
          s.category === category &&
          s.name.toLowerCase() === name.toLowerCase(),
      );
      if (!item) {
        item = {
          id: crypto.randomUUID(),
          name,
          category,
          unit: row.unit.trim(),
          done: false,
          createdAt: Date.now(),
        };
        existing.push(item);
        await db.stockItems.add(item);
      }
      await db.stockMoves.add({
        id: crypto.randomUUID(),
        stockId: item.id,
        date,
        kind: "in",
        qty: row.qty,
        note,
        billId,
        createdAt: Date.now(),
      });
    }
  });
  return usable.length;
}

/**
 * Delete several stock items and everything recorded against them, in one
 * transaction.
 *
 * A bill saved with "add to stock" ticked can put twenty rows into inventory at
 * once — twenty unions and a washer off one plumbing bill — and clearing those
 * one at a time is a confirmation per row. One transaction rather than a loop
 * of deletes: a bulk delete that fails halfway leaves a selection the person
 * can no longer reason about, since they cannot tell which half went.
 *
 * This destroys the movement history too, which is the point (the item is
 * going) but also why the caller counts the movements first and says so.
 */
export async function deleteStockItems(
  ids: string[],
): Promise<{ items: number; moves: number }> {
  if (ids.length === 0) return { items: 0, moves: 0 };
  return db.transaction("rw", [db.stockItems, db.stockMoves], async () => {
    let moves = 0;
    for (const id of ids) {
      moves += await db.stockMoves.where("stockId").equals(id).delete();
    }
    await db.stockItems.bulkDelete(ids);
    return { items: ids.length, moves };
  });
}

/** What removing a bill's stock would do, worked out before anything is done. */
export interface BillStockImpact {
  /** Receipts this bill put into stock. */
  receipts: number;
  /** Total quantity across those receipts. */
  qty: number;
  /** Stock items this bill contributed to. */
  itemsTouched: number;
  /** Of those, the ones that exist only because of this bill and would go. */
  itemsRemoved: number;
  /**
   * Quantity already given out from the items this bill fed — the reason this
   * needs a warning rather than a plain confirm. Those handouts happened and
   * are not deleted, so removing the receipts behind them leaves the item
   * showing a negative balance.
   */
  givenOut: number;
}

/**
 * What `removeBillFromStock` would do, computed from lists already in hand so
 * the confirmation can state real numbers instead of "are you sure?".
 */
export function billStockImpact(
  billId: string,
  moves: StockMove[],
): BillStockImpact {
  const receipts = moves.filter((m) => m.billId === billId);
  const touched = new Set(receipts.map((m) => m.stockId));
  let itemsRemoved = 0;
  let givenOut = 0;
  for (const stockId of touched) {
    const others = moves.filter(
      (m) => m.stockId === stockId && m.billId !== billId,
    );
    // Nothing else ever touched this item, so it exists only because of this
    // bill and goes with it rather than being left behind at zero.
    if (others.length === 0) itemsRemoved++;
    givenOut += others
      .filter((m) => m.kind === "out")
      .reduce((s, m) => s + m.qty, 0);
  }
  return {
    receipts: receipts.length,
    qty: Math.round(receipts.reduce((s, m) => s + m.qty, 0) * 1000) / 1000,
    itemsTouched: touched.size,
    itemsRemoved,
    givenOut: Math.round(givenOut * 1000) / 1000,
  };
}

/**
 * Undo everything one BOQ bill put into stock, in a single action.
 *
 * The counterpart to addBillRowsToStock. Removing a mis-scanned bill's stock
 * line by line means as many confirmations as the bill had rows — and a
 * handwritten bill saved with the wrong quantities is exactly the case where
 * every row is wrong at once.
 *
 * What it does NOT do:
 *
 * - It does not touch the bill. The BOQ rows are the record of what was
 *   purchased; this only unwinds what was taken into inventory from them.
 * - It does not delete anything given out to labour. Those handouts are
 *   records of things that actually happened, and are not this bill's to
 *   erase — see `givenOut` on the impact, which is why the caller warns first.
 *
 * An item is deleted only when nothing else ever touched it. One that also
 * holds a manual receipt, or a receipt from another bill, keeps its history
 * and simply loses this bill's contribution.
 */
export async function removeBillFromStock(billId: string): Promise<{
  receiptsRemoved: number;
  itemsRemoved: number;
}> {
  return db.transaction("rw", [db.stockItems, db.stockMoves], async () => {
    const receipts = await db.stockMoves
      .where("billId")
      .equals(billId)
      .toArray();
    const touched = new Set(receipts.map((m) => m.stockId));
    await db.stockMoves.where("billId").equals(billId).delete();

    let itemsRemoved = 0;
    // Counted after the delete, so an item is judged on what is actually left
    // rather than on what the caller believed a moment ago.
    for (const stockId of touched) {
      const left = await db.stockMoves.where("stockId").equals(stockId).count();
      if (left === 0) {
        await db.stockItems.delete(stockId);
        itemsRemoved++;
      }
    }
    return { receiptsRemoved: receipts.length, itemsRemoved };
  });
}

/**
 * Add a single stock item under a category, reusing an existing item with the
 * same name+category. Returns the item id — used when adding stock straight
 * from a BOQ bill's linked-stock panel.
 */
export async function findOrCreateStockItem(
  name: string,
  category: string,
  unit: string,
): Promise<string> {
  const trimmed = name.trim();
  const existing = await db.stockItems
    .where("category")
    .equals(category)
    .toArray();
  const match = existing.find(
    (s) => s.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (match) return match.id;
  const id = crypto.randomUUID();
  await db.stockItems.add({
    id,
    name: trimmed,
    category,
    unit: unit.trim(),
    done: false,
    createdAt: Date.now(),
  });
  return id;
}
