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

const TAX_ROW = /\b(sgst|cgst|igst|gst|freight|packing|round|discount|cartage)\b/i;

export interface BillStockRow {
  name: string;
  qty: number;
  unit: string;
}

/**
 * Feed a saved bill's quantity rows into inventory: reuse an existing stock
 * item with the same name+category, else create one, and record an "in" move.
 */
export async function addBillRowsToStock(
  rows: BillStockRow[],
  category: string,
  date: string,
  note: string,
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
        createdAt: Date.now(),
      });
    }
  });
  return usable.length;
}
