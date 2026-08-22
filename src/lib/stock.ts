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
        // The bill's vendor is on the bill; a receipt taken straight off it
        // names no separate supplier.
        person: "",
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

// ---------------------------------------------------------------------------
// Handouts: what went out, when, and to whom
// ---------------------------------------------------------------------------

/**
 * A movement's recipient, defended against absence.
 *
 * `person` is non-optional on the type, but a row does not always come from
 * this build: sync puts a remote row straight into Dexie, so a movement written
 * by a device on an older version — or one predating the column's backfill —
 * arrives with the field missing. Reading it with a bare `.trim()` would throw
 * inside the rollups rather than showing an unnamed handout, which is what an
 * un-attributed movement honestly is.
 */
function personOf(m: StockMove): string {
  return (m.person ?? "").trim();
}

/** Someone who has received material before — offered in the "to whom" picker. */
export function knownRecipients(moves: StockMove[]): string[] {
  const counts = new Map<string, number>();
  for (const m of moves) {
    const name = personOf(m);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  // Most-given-to first: the man you hand things to daily should not be the
  // eleventh name in the list.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/** One material handed out on one day, resolved against its stock item. */
export interface HandoutRow {
  moveId: string;
  stockId: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  person: string;
  note: string;
  date: string;
}

/** Everything given out between two dates (inclusive), newest day first. */
export function handoutsBetween(
  items: StockItem[],
  moves: StockMove[],
  from: string,
  to: string,
): HandoutRow[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  return moves
    .filter((m) => m.kind === "out" && m.date >= from && m.date <= to)
    .flatMap((m) => {
      const it = byId.get(m.stockId);
      // A movement whose item has been deleted is a dangling row. It is skipped
      // rather than shown as "(unknown)": nobody can act on a quantity of a
      // material that no longer has a name.
      if (!it) return [];
      return [
        {
          moveId: m.id,
          stockId: m.stockId,
          name: it.name,
          category: it.category,
          unit: it.unit,
          qty: m.qty,
          person: personOf(m),
          note: m.note ?? "",
          date: m.date,
        },
      ];
    })
    .sort(
      (a, b) =>
        (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
        a.category.localeCompare(b.category) ||
        a.name.localeCompare(b.name),
    );
}

/** A recipient and everything they were given over the window in question. */
export interface PersonTotal {
  person: string;
  /** Distinct materials, not movements — two bags on two days is one material. */
  items: number;
  rows: HandoutRow[];
}

/**
 * Group handouts by who received them.
 *
 * Deliberately no grand total quantity: these rows can be pieces, bags, kilos
 * and litres at once, and adding 40 pcs to 3 bags produces a number that means
 * nothing. The count of materials is the only figure that survives mixing units.
 */
export function byPerson(rows: HandoutRow[]): PersonTotal[] {
  const map = new Map<string, HandoutRow[]>();
  for (const r of rows) {
    const key = r.person || "Not recorded";
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  return [...map.entries()]
    .map(([person, list]) => ({
      person,
      items: new Set(list.map((r) => r.stockId)).size,
      rows: list,
    }))
    .sort((a, b) => b.rows.length - a.rows.length || a.person.localeCompare(b.person));
}

/** One material's standing: bought, handed out, still here. */
export interface IssuedItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  /** Everything ever received into stock. */
  purchased: number;
  /** Everything ever given out. */
  given: number;
  /** purchased − given. Negative means more went out than was ever booked in. */
  left: number;
  /** Who it went to, most-given first. */
  recipients: string[];
  /** The most recent day any of it was given out. */
  lastGiven: string | null;
}

/** A category's materials that have actually been given out, plus its totals. */
export interface IssuedCategory {
  category: string;
  items: IssuedItem[];
  /** How many distinct materials of this category have gone out. */
  itemCount: number;
  /** Everyone who has received anything in this category. */
  recipients: string[];
  lastGiven: string | null;
}

/**
 * Materials that have actually left the store, grouped by category.
 *
 * The point of the filter: a bill saved with "add to stock" ticked puts twenty
 * rows into inventory at once, and most of them just sit there. A list of
 * everything ever bought answers "what did I buy"; this answers the question
 * actually being asked at the end of a day, which is what went out and to whom.
 * An item is here the moment ONE piece of it has been given — including one
 * that has since been marked done, because a settled material is still part of
 * the record of what was handed over.
 *
 * `from`/`to` bound which handouts count as "given". The purchased and left
 * figures are always lifetime: what is left with you today is not a function of
 * the week you happen to be looking at.
 */
export function issuedByCategory(
  items: StockItem[],
  moves: StockMove[],
  from?: string,
  to?: string,
): IssuedCategory[] {
  const inWindow = (m: StockMove) =>
    (from === undefined || m.date >= from) && (to === undefined || m.date <= to);

  const byItem = new Map<string, StockMove[]>();
  for (const m of moves) {
    const list = byItem.get(m.stockId);
    if (list) list.push(m);
    else byItem.set(m.stockId, [m]);
  }

  const issued: IssuedItem[] = [];
  for (const it of items) {
    const mine = byItem.get(it.id) ?? [];
    const outs = mine.filter((m) => m.kind === "out" && inWindow(m));
    if (outs.length === 0) continue;

    const purchased = mine
      .filter((m) => m.kind === "in")
      .reduce((s, m) => s + m.qty, 0);
    // Lifetime, not windowed: "left with me" is a fact about the shelf today,
    // and a figure that changed when you paged back a day would be a lie.
    const givenEver = mine
      .filter((m) => m.kind === "out")
      .reduce((s, m) => s + m.qty, 0);

    const counts = new Map<string, number>();
    for (const m of outs) {
      const name = personOf(m) || "Not recorded";
      counts.set(name, (counts.get(name) ?? 0) + m.qty);
    }

    issued.push({
      id: it.id,
      name: it.name,
      category: it.category,
      unit: it.unit,
      purchased: round3(purchased),
      given: round3(outs.reduce((s, m) => s + m.qty, 0)),
      left: round3(purchased - givenEver),
      recipients: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([n]) => n),
      lastGiven: outs.reduce<string | null>(
        (latest, m) => (latest === null || m.date > latest ? m.date : latest),
        null,
      ),
    });
  }

  const cats = new Map<string, IssuedItem[]>();
  for (const it of issued) {
    const list = cats.get(it.category);
    if (list) list.push(it);
    else cats.set(it.category, [it]);
  }

  return [...cats.entries()]
    .map(([category, list]) => ({
      category,
      items: list.sort((a, b) => b.given - a.given || a.name.localeCompare(b.name)),
      itemCount: list.length,
      recipients: [...new Set(list.flatMap((i) => i.recipients))],
      lastGiven: list.reduce<string | null>(
        (latest, i) =>
          i.lastGiven && (latest === null || i.lastGiven > latest)
            ? i.lastGiven
            : latest,
        null,
      ),
    }))
    // Busiest category first — the one with most materials moving is the one
    // being asked about.
    .sort((a, b) => b.itemCount - a.itemCount || a.category.localeCompare(b.category));
}

/** Quantities are counts of physical things; three decimals is already generous. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
