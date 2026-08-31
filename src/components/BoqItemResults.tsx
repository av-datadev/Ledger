import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { inr, num, formatDate } from "../lib/format";
import { matchesQuery } from "../lib/search";
import { findOrCreateStockItem, isMaterialRow } from "../lib/stock";
import type { BoqItem } from "../types";
import { Icon } from "./Icon";

/**
 * Searching the BOQ by what you bought, not by which paper it was on.
 *
 * The first version of this search returned BILLS: type "tape" and you got the
 * bills containing tape, then had to open one and find the row yourself. That
 * answers "which document mentions this", when the question being asked is
 * "where is my tape, and can I take it into stock".
 *
 * So the line items come back directly, each carrying the bill it belongs to,
 * and each with the add-to-stock control on the row. Adding does NOT touch the
 * bill — the line stays exactly where it is, and the stock receipt is
 * hard-linked back to it by billId, so the two-way BOQ↔Stock views still tie up
 * and removing that bill's stock later still finds this receipt.
 */
export function BoqItemResults({ query }: { query: string }) {
  const boqItems = useLiveQuery(() => db.boqItems.toArray(), []);
  const stockItems = useLiveQuery(() => db.stockItems.toArray(), []);
  // Scalars only — no blobs — so reading every move to answer "is this already
  // stocked?" costs nothing.
  const moves = useLiveQuery(() => db.stockMoves.toArray(), []);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [justAdded, setJustAdded] = useState<Record<string, number>>({});

  /**
   * How much of one bill line is already in stock FROM THAT BILL.
   *
   * Matched on bill + item name, the same rule the per-bill panel uses. Name
   * matching is crude, but the alternative — a hard link from bill line to
   * stock item — does not exist in the data, and inventing one here would
   * disagree with the panel that has been writing these receipts all along.
   */
  const receivedFor = useMemo(() => {
    const nameById = new Map((stockItems ?? []).map((s) => [s.id, s.name.toLowerCase()]));
    return (line: BoqItem) =>
      (moves ?? [])
        .filter(
          (m) =>
            m.kind === "in" &&
            m.billId === line.billId &&
            nameById.get(m.stockId) === line.item.trim().toLowerCase(),
        )
        .reduce((s, m) => s + m.qty, 0);
  }, [moves, stockItems]);

  const rows = useMemo(() => {
    if (!boqItems) return [];
    return boqItems
      // Tax, freight and rounding lines are not things you can put on a shelf.
      .filter((l) => isMaterialRow(l.item))
      .filter((l) => matchesQuery(query, l.item))
      // Newest purchase first: when the same material was bought three times,
      // the most recent rate is the one being asked about.
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [boqItems, query]);

  if (!boqItems) return null;

  const add = async (line: BoqItem) => {
    const remaining = (line.qty ?? 0) - receivedFor(line);
    const raw = qtyDraft[line.id];
    const q = parseFloat(raw ?? String(remaining > 0 ? remaining : (line.qty ?? 0)));
    if (!(q > 0)) return;
    const stockId = await findOrCreateStockItem(
      line.item,
      line.category,
      line.unit ?? "",
    );
    await db.stockMoves.add({
      id: crypto.randomUUID(),
      stockId,
      // The bill's date, not today's: this records when the material was
      // bought, which is what the bill says.
      date: line.date,
      kind: "in",
      qty: q,
      person: "",
      note: `Bill #${line.invoiceNo} ${line.vendor}`.trim(),
      billId: line.billId,
      createdAt: Date.now(),
    });
    setJustAdded((s) => ({ ...s, [line.id]: q }));
    setQtyDraft((d) => {
      const next = { ...d };
      delete next[line.id];
      return next;
    });
  };

  if (rows.length === 0) {
    return (
      <div className="text-[12px] text-ink-soft px-1 py-2">
        No bill line matches “{query.trim()}”.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-soft px-1">
        Items · {rows.length} line{rows.length === 1 ? "" : "s"}
      </div>
      <div className="card overflow-hidden divide-y divide-rule">
        {rows.map((line) => {
          const bought = line.qty ?? 0;
          const already = receivedFor(line);
          const remaining = Math.round((bought - already) * 1000) / 1000;
          const done = bought > 0 && remaining <= 0;
          const added = justAdded[line.id];

          return (
            <div key={line.id} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium min-w-0 truncate">
                  {line.item}
                </span>
                <span className="money text-[12px] shrink-0">
                  {num(bought)}
                  {line.unit && <span className="text-ink-soft"> {line.unit}</span>}
                </span>
              </div>

              <div className="text-[11px] text-ink-soft truncate mt-0.5">
                {line.vendor || "Unnamed dealer"}
                {line.invoiceNo && <> · #{line.invoiceNo}</>} ·{" "}
                {formatDate(line.date)}
                <span className="badge ml-1.5 !text-[10px]">{line.category}</span>
              </div>

              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[11px] text-ink-soft flex-1 min-w-0 truncate">
                  {line.rate != null && line.rate > 0 && (
                    <>
                      <span className="money">{inr(line.rate)}</span>
                      {line.unit ? `/${line.unit}` : ""}
                    </>
                  )}
                </span>

                {added != null ? (
                  <span className="text-[12px] text-moss shrink-0">
                    <Icon name="check" size={12} className="inline align-[-1px] mr-1" />added <span className="money">{num(added)}</span> to stock
                  </span>
                ) : done ? (
                  // Not a disabled button: there is nothing left of this line to
                  // take, and offering a control that would do nothing invites
                  // pressing it and wondering why nothing happened.
                  <span className="text-[12px] text-ink-soft shrink-0">
                    <Icon name="check" size={12} className="inline align-[-1px] mr-1" />already in stock
                  </span>
                ) : (
                  <>
                    {already > 0 && (
                      <span className="text-[11px] text-ink-soft shrink-0">
                        <span className="money">{num(already)}</span> in ·
                      </span>
                    )}
                    <input
                      className="input !py-1 !px-2 !text-[13px] money !w-16 shrink-0"
                      inputMode="decimal"
                      aria-label={`Quantity of ${line.item} to add to stock`}
                      // Prefilled with what is NOT yet stocked, so the common
                      // case is one tap and the number is on screen first.
                      value={qtyDraft[line.id] ?? String(remaining > 0 ? remaining : bought)}
                      onChange={(e) =>
                        setQtyDraft((d) => ({ ...d, [line.id]: e.target.value }))
                      }
                    />
                    <button
                      className="btn !py-1 !px-2.5 !text-[12px] !text-moss !border-moss/40 shrink-0"
                      onClick={() => void add(line)}
                    >
                      + Stock
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
