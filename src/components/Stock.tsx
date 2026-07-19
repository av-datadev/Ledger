import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useCategories } from "../hooks/useCategories";
import { num, todayStr, formatDate } from "../lib/format";
import { withBalances, type StockWithBalance } from "../lib/stock";
import { BillStockPanel } from "./BillStockPanel";
import { AddStockPicker } from "./AddStockPicker";

type MoveKind = "in" | "out";

interface BillOpt {
  billId: string;
  label: string;
  category: string;
  date: string;
}

function MoveForm({
  item,
  kind,
  bills,
  onDone,
}: {
  item: StockWithBalance;
  kind: MoveKind;
  bills: BillOpt[];
  onDone: () => void;
}) {
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [billId, setBillId] = useState<string>("");
  const [err, setErr] = useState("");

  // Only offer bills in the same category — that's where this material belongs.
  const catBills = bills.filter((b) => b.category === item.category);

  const save = async () => {
    const q = parseFloat(qty);
    if (!(q > 0)) {
      setErr("Enter a quantity greater than zero.");
      return;
    }
    const bill = catBills.find((b) => b.billId === billId);
    await db.stockMoves.add({
      id: crypto.randomUUID(),
      stockId: item.id,
      date: todayStr(),
      kind,
      qty: q,
      note: note.trim() || (bill ? bill.label : ""),
      billId: kind === "in" && bill ? bill.billId : null,
      createdAt: Date.now(),
    });
    onDone();
  };

  return (
    <div className="mt-2 p-2 border border-rule rounded-md bg-paper space-y-1.5">
      <div className="text-[11px] uppercase tracking-[0.1em] text-ink-soft">
        {kind === "in" ? "Received into stock" : "Given out (to labour)"}
      </div>
      <div className="flex gap-1.5">
        <input
          className="input !py-1.5 !text-[14px] money !w-24"
          placeholder={`Qty${item.unit ? ` (${item.unit})` : ""}`}
          inputMode="decimal"
          autoFocus
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <input
          className="input !py-1.5 !text-[13px] flex-1"
          placeholder={kind === "in" ? "From (optional)" : "To whom (optional)"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {kind === "in" && catBills.length > 0 && (
        <select
          className="input !py-1.5 !text-[13px]"
          value={billId}
          onChange={(e) => setBillId(e.target.value)}
        >
          <option value="">Link to a BOQ bill (optional)…</option>
          {catBills.map((b) => (
            <option key={b.billId} value={b.billId}>
              {b.label}
            </option>
          ))}
        </select>
      )}
      {err && <div className="text-[12px] text-crimson">{err}</div>}
      <div className="flex gap-1.5">
        <button
          className={`btn ${kind === "in" ? "btn-green" : "btn-primary"} !py-1.5 !text-[13px] flex-1`}
          onClick={() => void save()}
        >
          Save
        </button>
        <button className="btn !py-1.5 !text-[13px]" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Inline editor for a stock item's name / category / unit. */
function ItemEditForm({
  item,
  categories,
  onDone,
}: {
  item: StockWithBalance;
  categories: string[];
  onDone: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category);
  const [unit, setUnit] = useState(item.unit);

  const save = async () => {
    if (!name.trim()) return;
    await db.stockItems.update(item.id, {
      name: name.trim(),
      category,
      unit: unit.trim(),
    });
    onDone();
  };

  return (
    <div className="mt-2 p-2 border border-rule rounded-md bg-paper space-y-1.5">
      <input
        className="input !py-1.5 !text-[14px]"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex gap-1.5">
        <select
          className="input !py-1.5 !text-[14px] flex-1"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {!categories.includes(category) && <option>{category}</option>}
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input
          className="input !py-1.5 !text-[14px] !w-24"
          placeholder="Unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
      </div>
      <div className="flex gap-1.5">
        <button
          className="btn btn-primary !py-1.5 !text-[13px] flex-1"
          onClick={() => void save()}
        >
          Save item
        </button>
        <button className="btn !py-1.5 !text-[13px]" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Stock() {
  const items = useLiveQuery(() => db.stockItems.toArray(), []);
  const moves = useLiveQuery(() => db.stockMoves.toArray(), []);
  const boqItems = useLiveQuery(() => db.boqItems.toArray(), []);
  const categories = useCategories();
  const [view, setView] = useState<"items" | "bill">("items");
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [openMove, setOpenMove] = useState<{ id: string; kind: MoveKind } | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editMoveId, setEditMoveId] = useState<string | null>(null);
  const [moveDraft, setMoveDraft] = useState({ qty: "", note: "" });
  // Selected bill in the "By bill" view.
  const [billSel, setBillSel] = useState<string>("");

  const bills = useMemo<BillOpt[]>(() => {
    if (!boqItems) return [];
    const map = new Map<string, BillOpt>();
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

  const rows = useMemo(() => {
    if (!items || !moves) return [];
    const all = withBalances(items, moves);
    return all
      .filter((it) => (filter ? it.category === filter : true))
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1; // done items sink
        if (a.category !== b.category) return a.category < b.category ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [items, moves, filter]);

  const usedCats = useMemo(
    () => categories.filter((c) => items?.some((it) => it.category === c)),
    [items, categories],
  );

  const deleteItem = async (id: string) => {
    await db.transaction("rw", [db.stockItems, db.stockMoves], async () => {
      await db.stockMoves.where("stockId").equals(id).delete();
      await db.stockItems.delete(id);
    });
    setConfirmId(null);
  };

  const saveMoveEdit = async () => {
    const q = parseFloat(moveDraft.qty);
    if (editMoveId && q > 0)
      await db.stockMoves.update(editMoveId, {
        qty: q,
        note: moveDraft.note.trim(),
      });
    setEditMoveId(null);
  };

  const selectedBill = bills.find((b) => b.billId === billSel);

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">Stock / Inventory</h2>
        {view === "items" && (
          <button
            className="btn btn-primary !py-1.5"
            onClick={() => setAdding(true)}
          >
            + Add item
          </button>
        )}
      </div>

      {/* Items ↔ By-bill view toggle */}
      <div className="flex gap-1.5 mb-3">
        {(["items", "bill"] as const).map((v) => (
          <button
            key={v}
            className={`badge !text-[12px] !py-1 !px-3 ${
              view === v ? "!bg-ink !text-paper !border-ink" : ""
            }`}
            onClick={() => setView(v)}
          >
            {v === "items" ? "All items" : "By BOQ bill"}
          </button>
        ))}
      </div>

      {view === "bill" ? (
        <div className="space-y-2 pb-4">
          <select
            className="input"
            value={billSel}
            onChange={(e) => setBillSel(e.target.value)}
          >
            <option value="">Select a BOQ bill…</option>
            {bills.map((b) => (
              <option key={b.billId} value={b.billId}>
                {formatDate(b.date)} · {b.label}
              </option>
            ))}
          </select>
          {selectedBill ? (
            <div className="bg-surface border border-rule rounded-md overflow-hidden">
              <div className="px-3 py-2 text-sm font-medium">
                {selectedBill.label}
                <span className="badge ml-2">{selectedBill.category}</span>
              </div>
              <BillStockPanel
                billId={selectedBill.billId}
                billLabel={selectedBill.label}
              />
            </div>
          ) : (
            <div className="text-sm text-ink-soft text-center py-8">
              Pick a bill to see what it put into stock, and add or edit those
              receipts here.
            </div>
          )}
        </div>
      ) : (
        <>
          {usedCats.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-2 mb-1 -mx-4 px-4">
              <button
                className={`badge !text-[11px] !py-1 !px-2.5 shrink-0 ${filter === "" ? "!bg-ink !text-paper !border-ink" : ""}`}
                onClick={() => setFilter("")}
              >
                All
              </button>
              {usedCats.map((c) => (
                <button
                  key={c}
                  className={`badge !text-[11px] !py-1 !px-2.5 shrink-0 ${filter === c ? "!bg-ink !text-paper !border-ink" : ""}`}
                  onClick={() => setFilter(filter === c ? "" : c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2 pb-4">
            {rows.map((it) => (
              <div
                key={it.id}
                className={`bg-surface border border-rule rounded-md px-3 py-2.5 ${it.done ? "opacity-55" : ""}`}
              >
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 w-4 h-4 accent-[#2F6D4F]"
                    checked={it.done}
                    title="Tick when this material is fully used / settled"
                    onChange={(e) =>
                      void db.stockItems.update(it.id, { done: e.target.checked })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium ${it.done ? "line-through" : ""}`}>
                      {it.name}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-ink-soft">
                      <span className="badge">{it.category}</span>
                      <span className="money">
                        in {num(it.inQty)} · out {num(it.outQty)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`money text-lg font-bold ${it.balance < 0 ? "text-crimson" : it.balance === 0 ? "text-ink-soft" : "text-moss"}`}
                    >
                      {num(it.balance)}
                      {it.unit && <span className="text-[11px] font-normal"> {it.unit}</span>}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-soft">
                      left with me
                    </div>
                  </div>
                </div>

                {editItemId === it.id ? (
                  <ItemEditForm
                    item={it}
                    categories={categories}
                    onDone={() => setEditItemId(null)}
                  />
                ) : openMove?.id === it.id ? (
                  <MoveForm
                    item={it}
                    kind={openMove.kind}
                    bills={bills}
                    onDone={() => setOpenMove(null)}
                  />
                ) : (
                  <div className="flex gap-1.5 mt-2">
                    <button
                      className="btn !py-1 !px-2.5 !text-[12px] !text-moss !border-moss/40"
                      onClick={() => setOpenMove({ id: it.id, kind: "in" })}
                    >
                      + Received
                    </button>
                    <button
                      className="btn !py-1 !px-2.5 !text-[12px] !text-crimson !border-crimson/40"
                      onClick={() => setOpenMove({ id: it.id, kind: "out" })}
                    >
                      − Given out
                    </button>
                    <button
                      className="btn !py-1 !px-2.5 !text-[12px]"
                      onClick={() => setEditItemId(it.id)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn !py-1 !px-2.5 !text-[12px] ml-auto"
                      onClick={() =>
                        setHistoryFor(historyFor === it.id ? null : it.id)
                      }
                    >
                      {historyFor === it.id ? "Hide" : "History"}
                    </button>
                  </div>
                )}

                {historyFor === it.id && moves && (
                  <div className="mt-2 border-t border-rule pt-1.5">
                    {moves
                      .filter((m) => m.stockId === it.id)
                      .sort((a, b) => b.createdAt - a.createdAt)
                      .map((m) =>
                        editMoveId === m.id ? (
                          <div
                            key={m.id}
                            className="flex items-center gap-1.5 py-0.5"
                          >
                            <input
                              className="input !py-1 !text-[12px] money !w-16"
                              inputMode="decimal"
                              value={moveDraft.qty}
                              onChange={(e) =>
                                setMoveDraft((d) => ({ ...d, qty: e.target.value }))
                              }
                            />
                            <input
                              className="input !py-1 !text-[12px] flex-1"
                              placeholder="Note"
                              value={moveDraft.note}
                              onChange={(e) =>
                                setMoveDraft((d) => ({ ...d, note: e.target.value }))
                              }
                            />
                            <button
                              className="text-[11px] text-moss px-1"
                              onClick={() => void saveMoveEdit()}
                            >
                              save
                            </button>
                            <button
                              className="text-[11px] text-ink-soft px-1"
                              onClick={() => setEditMoveId(null)}
                            >
                              cancel
                            </button>
                          </div>
                        ) : (
                          <div
                            key={m.id}
                            className="flex items-center gap-2 text-[12px] py-0.5"
                          >
                            <span className="money text-ink-soft w-16 shrink-0">
                              {formatDate(m.date)}
                            </span>
                            <span
                              className={`money font-semibold w-16 shrink-0 ${m.kind === "in" ? "text-moss" : "text-crimson"}`}
                            >
                              {m.kind === "in" ? "+" : "−"}
                              {num(m.qty)}
                            </span>
                            <span className="text-ink-soft truncate flex-1">
                              {m.note}
                              {m.billId && (
                                <span className="badge ml-1 !text-[9px]">bill</span>
                              )}
                            </span>
                            <button
                              className="text-[11px] text-ink-soft px-0.5 shrink-0"
                              onClick={() => {
                                setEditMoveId(m.id);
                                setMoveDraft({ qty: String(m.qty), note: m.note });
                              }}
                            >
                              edit
                            </button>
                            <button
                              className="text-crimson text-sm px-1 shrink-0"
                              aria-label="Delete this movement"
                              onClick={() => void db.stockMoves.delete(m.id)}
                            >
                              ×
                            </button>
                          </div>
                        ),
                      )}
                    <div className="flex justify-end mt-1">
                      {confirmId === it.id ? (
                        <div className="flex gap-1.5">
                          <button
                            className="text-[11px] text-white bg-crimson rounded px-2 py-0.5"
                            onClick={() => void deleteItem(it.id)}
                          >
                            Delete item + history
                          </button>
                          <button
                            className="text-[11px] border border-rule rounded px-2 py-0.5"
                            onClick={() => setConfirmId(null)}
                          >
                            Keep
                          </button>
                        </div>
                      ) : (
                        <button
                          className="text-[11px] text-crimson"
                          onClick={() => setConfirmId(it.id)}
                        >
                          delete this item
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {items && rows.length === 0 && (
              <div className="text-sm text-ink-soft text-center py-8">
                No materials tracked yet.
                <br />
                Tap <b>+ Add item</b> to pull materials from a BOQ bill, or save
                <br />a scanned bill with “Add items to Stock” ticked.
              </div>
            )}
          </div>
        </>
      )}

      {adding && <AddStockPicker onClose={() => setAdding(false)} />}
    </div>
  );
}
