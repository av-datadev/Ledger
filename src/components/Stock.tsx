import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useCategories } from "../hooks/useCategories";
import { num, todayStr, formatDate } from "../lib/format";
import { withBalances, type StockWithBalance } from "../lib/stock";

type MoveKind = "in" | "out";

function MoveForm({
  item,
  kind,
  onDone,
}: {
  item: StockWithBalance;
  kind: MoveKind;
  onDone: () => void;
}) {
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const save = async () => {
    const q = parseFloat(qty);
    if (!(q > 0)) {
      setErr("Enter a quantity greater than zero.");
      return;
    }
    await db.stockMoves.add({
      id: crypto.randomUUID(),
      stockId: item.id,
      date: todayStr(),
      kind,
      qty: q,
      note: note.trim(),
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

export function Stock() {
  const items = useLiveQuery(() => db.stockItems.toArray(), []);
  const moves = useLiveQuery(() => db.stockMoves.toArray(), []);
  const categories = useCategories();
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState<string>("Paint");
  const [newUnit, setNewUnit] = useState("");
  const [openMove, setOpenMove] = useState<{ id: string; kind: MoveKind } | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

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

  const addItem = async () => {
    if (!newName.trim()) return;
    await db.stockItems.add({
      id: crypto.randomUUID(),
      name: newName.trim(),
      category: newCat,
      unit: newUnit.trim(),
      done: false,
      createdAt: Date.now(),
    });
    setNewName("");
    setNewUnit("");
    setAdding(false);
  };

  const deleteItem = async (id: string) => {
    await db.transaction("rw", [db.stockItems, db.stockMoves], async () => {
      await db.stockMoves.where("stockId").equals(id).delete();
      await db.stockItems.delete(id);
    });
    setConfirmId(null);
  };

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">Stock / Inventory</h2>
        <button
          className="btn btn-primary !py-1.5"
          onClick={() => setAdding((a) => !a)}
        >
          + Add item
        </button>
      </div>

      {adding && (
        <div className="bg-white border border-rule rounded-md p-2.5 mb-3 space-y-1.5">
          <input
            className="input !py-2 !text-[14px]"
            placeholder="Material name — e.g. Apex Ultima White 20L"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className="flex gap-1.5">
            <select
              className="input !py-2 !text-[14px] flex-1"
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              className="input !py-2 !text-[14px] !w-24"
              placeholder="Unit (L, pcs…)"
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
            />
          </div>
          <button className="btn btn-green w-full !py-2" onClick={() => void addItem()}>
            Add to stock list
          </button>
        </div>
      )}

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
            className={`bg-white border border-rule rounded-md px-3 py-2.5 ${it.done ? "opacity-55" : ""}`}
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

            {openMove?.id === it.id ? (
              <MoveForm
                item={it}
                kind={openMove.kind}
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
                  .map((m) => (
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
                      </span>
                      <button
                        className="text-crimson text-sm px-1 shrink-0"
                        aria-label="Delete this movement"
                        onClick={() => void db.stockMoves.delete(m.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
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
            Add one above, or save a scanned bill with
            <br />
            “Add items to Stock” ticked.
          </div>
        )}
      </div>
    </div>
  );
}
