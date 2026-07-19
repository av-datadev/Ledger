import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { num } from "../lib/format";
import { findOrCreateStockItem, isMaterialRow } from "../lib/stock";
import type { BoqItem } from "../types";

/**
 * The bill's line items with a tick-box on each material row. Ticking a line
 * asks how much to add and pushes exactly that quantity into stock, hard-linked
 * to this bill (billId). Tax/freight/rounding rows are shown for completeness
 * but can't be stocked. Powers both the expanded BOQ bill and the Stock tab's
 * "By bill" view.
 */
export function BillStockPanel({
  billId,
  billLabel,
}: {
  billId: string;
  billLabel: string;
}) {
  const lines = useLiveQuery(
    () => db.boqItems.where("billId").equals(billId).toArray(),
    [billId],
  );
  const items = useLiveQuery(() => db.stockItems.toArray(), []);
  const moves = useLiveQuery(
    () => db.stockMoves.where("billId").equals(billId).toArray(),
    [billId],
  );
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});

  const nameOf = (stockId: string) =>
    items?.find((s) => s.id === stockId)?.name ?? "";

  // How much of this line has already been received into stock from this bill.
  const receivedFor = (line: BoqItem) =>
    (moves ?? [])
      .filter(
        (m) =>
          m.kind === "in" &&
          nameOf(m.stockId).toLowerCase() === line.item.trim().toLowerCase(),
      )
      .reduce((s, m) => s + m.qty, 0);

  const toggle = (line: BoqItem) => {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(line.id)) {
        next.delete(line.id);
      } else {
        next.add(line.id);
        // Default to what's not yet stocked (else the full bill quantity).
        const remaining = (line.qty ?? 0) - receivedFor(line);
        const def = remaining > 0 ? remaining : (line.qty ?? "");
        setQtyDraft((d) => ({ ...d, [line.id]: def === "" ? "" : String(def) }));
      }
      return next;
    });
  };

  const add = async (line: BoqItem) => {
    const q = parseFloat(qtyDraft[line.id] ?? "");
    if (!(q > 0)) return;
    const stockId = await findOrCreateStockItem(
      line.item,
      line.category,
      line.unit ?? "",
    );
    await db.stockMoves.add({
      id: crypto.randomUUID(),
      stockId,
      date: line.date,
      kind: "in",
      qty: q,
      note: billLabel,
      billId,
      createdAt: Date.now(),
    });
    setChecked((s) => {
      const next = new Set(s);
      next.delete(line.id);
      return next;
    });
  };

  const setQty = (id: string, v: string) =>
    setQtyDraft((d) => ({ ...d, [id]: v }));

  return (
    <div className="px-3 py-2 border-t border-rule bg-paper/40">
      <div className="text-[10px] uppercase tracking-[0.12em] text-ink-soft mb-1.5">
        Tick an item to add it to stock
      </div>

      <div className="divide-y divide-rule/60">
        {(lines ?? []).map((line) => {
          const material = isMaterialRow(line.item);
          const received = receivedFor(line);
          const isChecked = checked.has(line.id);
          return (
            <div key={line.id} className="py-1.5">
              <div className="flex items-start gap-2">
                {material ? (
                  <input
                    type="checkbox"
                    className="mt-0.5 w-4 h-4 accent-[#2F6D4F] shrink-0"
                    checked={isChecked}
                    onChange={() => toggle(line)}
                  />
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`text-[13px] truncate ${material ? "" : "text-ink-soft"}`}
                    >
                      {line.item}
                    </span>
                    <span className="money text-[12px] shrink-0">
                      {num(line.amount)}
                    </span>
                  </div>
                  <div className="text-[11px] text-ink-soft money">
                    {line.qty != null &&
                      `${num(line.qty)} ${line.unit ?? ""}${line.rate != null ? ` × ${num(line.rate)}` : ""}`}
                    {received > 0 && (
                      <span className="text-moss">
                        {line.qty != null ? " · " : ""}in stock {num(received)}
                      </span>
                    )}
                  </div>

                  {isChecked && (
                    <div className="flex gap-1.5 mt-1.5">
                      <input
                        className="input !py-1.5 !text-[13px] money !w-28"
                        placeholder={`How much?${line.unit ? ` (${line.unit})` : ""}`}
                        inputMode="decimal"
                        autoFocus
                        value={qtyDraft[line.id] ?? ""}
                        onChange={(e) => setQty(line.id, e.target.value)}
                      />
                      <button
                        className="btn btn-green !py-1.5 !text-[12px] flex-1"
                        onClick={() => void add(line)}
                      >
                        Add to stock
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
