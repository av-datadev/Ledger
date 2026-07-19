import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { num, formatDate } from "../lib/format";
import { findOrCreateStockItem, isMaterialRow } from "../lib/stock";
import type { BoqItem } from "../types";

/**
 * Add stock by picking a BOQ bill and ticking its line items — no typing.
 * Materials come straight from the bill (name, qty, unit) and are hard-linked
 * back to it. Tax/freight/rounding rows are excluded; items already received
 * from the bill are tagged and start unticked so they aren't double-counted.
 */
export function AddStockPicker({ onClose }: { onClose: () => void }) {
  const boqItems = useLiveQuery(() => db.boqItems.toArray(), []);
  const stockItems = useLiveQuery(() => db.stockItems.toArray(), []);
  const stockMoves = useLiveQuery(() => db.stockMoves.toArray(), []);
  const [billId, setBillId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const bills = useMemo(() => {
    if (!boqItems) return [];
    const map = new Map<
      string,
      { billId: string; label: string; category: string; date: string }
    >();
    for (const b of boqItems) {
      if (!map.has(b.billId))
        map.set(b.billId, {
          billId: b.billId,
          label: `Bill #${b.invoiceNo} ${b.vendor}`.trim(),
          category: b.category,
          date: b.date,
        });
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [boqItems]);

  const bill = bills.find((b) => b.billId === billId);

  // Material lines of the chosen bill (tax/freight/rounding rows dropped).
  const lines = useMemo<BoqItem[]>(
    () =>
      (boqItems ?? []).filter(
        (b) => b.billId === billId && isMaterialRow(b.item),
      ),
    [boqItems, billId],
  );

  const nameOf = (stockId: string) =>
    stockItems?.find((s) => s.id === stockId)?.name ?? "";

  // A line is "already added" if a receipt from this bill matches its name.
  const isAdded = (line: BoqItem) =>
    (stockMoves ?? []).some(
      (m) =>
        m.billId === billId &&
        nameOf(m.stockId).toLowerCase() === line.item.trim().toLowerCase(),
    );

  const chooseBill = (id: string) => {
    setBillId(id);
    const fresh = (boqItems ?? []).filter(
      (b) => b.billId === id && isMaterialRow(b.item),
    );
    // Default-select everything not already in stock.
    const preset = new Set(
      fresh
        .filter(
          (line) =>
            !(stockMoves ?? []).some(
              (m) =>
                m.billId === id &&
                nameOf(m.stockId).toLowerCase() ===
                  line.item.trim().toLowerCase(),
            ),
        )
        .map((l) => l.id),
    );
    setSelected(preset);
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = lines.length > 0 && selected.size === lines.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(lines.map((l) => l.id)));

  const add = async () => {
    if (!bill || selected.size === 0) return;
    setSaving(true);
    const chosen = lines.filter((l) => selected.has(l.id));
    await db.transaction("rw", [db.stockItems, db.stockMoves], async () => {
      for (const line of chosen) {
        const stockId = await findOrCreateStockItem(
          line.item,
          line.category,
          line.unit ?? "",
        );
        const q = line.qty ?? 0;
        if (q > 0)
          await db.stockMoves.add({
            id: crypto.randomUUID(),
            stockId,
            date: line.date,
            kind: "in",
            qty: q,
            note: bill.label,
            billId: bill.billId,
            createdAt: Date.now(),
          });
      }
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 bg-paper overflow-y-auto">
      <div className="px-4 py-4 max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Add stock from a bill</h2>
          <button className="btn !py-1.5 !px-3 !text-[13px]" onClick={onClose}>
            Cancel
          </button>
        </div>

        {bills.length === 0 ? (
          <div className="text-sm text-ink-soft text-center py-10">
            No BOQ bills yet. Add a bill in the <b>BOQ</b> tab first — then its
            materials can be pulled straight into stock here.
          </div>
        ) : (
          <>
            <label className="field-label">Which bill?</label>
            <select
              className="input mb-3"
              value={billId}
              onChange={(e) => chooseBill(e.target.value)}
            >
              <option value="">Select a BOQ bill…</option>
              {bills.map((b) => (
                <option key={b.billId} value={b.billId}>
                  {formatDate(b.date)} · {b.label}
                </option>
              ))}
            </select>

            {bill && lines.length === 0 && (
              <div className="text-sm text-ink-soft text-center py-8">
                This bill has no material lines to stock.
              </div>
            )}

            {bill && lines.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] uppercase tracking-[0.12em] text-ink-soft">
                    {bill.category} · {selected.size} of {lines.length} selected
                  </span>
                  <button
                    className="text-[12px] text-moss"
                    onClick={toggleAll}
                  >
                    {allSelected ? "Clear all" : "Select all"}
                  </button>
                </div>

                <div className="bg-surface border border-rule rounded-md divide-y divide-rule mb-3">
                  {lines.map((line) => {
                    const added = isAdded(line);
                    return (
                      <label
                        key={line.id}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-[#2F6D4F]"
                          checked={selected.has(line.id)}
                          onChange={() => toggle(line.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="text-sm font-medium block truncate">
                            {line.item}
                          </span>
                          <span className="text-[11px] text-ink-soft money">
                            {line.qty != null ? num(line.qty) : "?"}{" "}
                            {line.unit ?? ""}
                            {added && (
                              <span className="badge ml-1.5 !text-[9px]">
                                already added
                              </span>
                            )}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                <button
                  className="btn btn-primary w-full !py-3 !text-base"
                  disabled={selected.size === 0 || saving}
                  onClick={() => void add()}
                >
                  {saving
                    ? "Adding…"
                    : `Add ${selected.size} item${selected.size === 1 ? "" : "s"} to stock`}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
