import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useCategories } from "../hooks/useCategories";
import { num, todayStr, formatDate, addDays } from "../lib/format";
import {
  withBalances,
  billStockImpact,
  removeBillFromStock,
  deleteStockItems,
  knownRecipients,
  handoutsBetween,
  byPerson,
  type StockWithBalance,
} from "../lib/stock";
import type { StockItem, StockMove } from "../types";
import { BillStockPanel } from "./BillStockPanel";
import { AddStockPicker } from "./AddStockPicker";

type MoveKind = "in" | "out";

interface BillOpt {
  billId: string;
  label: string;
  category: string;
  date: string;
}

/**
 * The names offered when recording who material went to (or came from):
 * everyone already handed something, plus the people/categories on the People
 * tab. Typing a fresh name is still allowed — this is a shortcut to consistent
 * spelling, not a gate. Without it "Plumber", "plumber" and "Plumber ji" become
 * three men in every total.
 */
function PartyInput({
  kind,
  value,
  known,
  onChange,
}: {
  kind: MoveKind;
  value: string;
  known: string[];
  onChange: (v: string) => void;
}) {
  const listId = `party-${kind}`;
  return (
    <>
      <input
        className="input !py-1.5 !text-[13px] flex-1"
        list={listId}
        placeholder={kind === "in" ? "From whom" : "Given to"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {known.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}

function MoveForm({
  item,
  kind,
  bills,
  parties,
  onDone,
}: {
  item: StockWithBalance;
  kind: MoveKind;
  bills: BillOpt[];
  parties: string[];
  onDone: () => void;
}) {
  const [qty, setQty] = useState("");
  // Defaults to today because most handouts are recorded as they happen — but
  // it is a field, not a stamp. Sitting down of an evening to write up three
  // days of material given to the plumber is the ordinary case, and until now
  // every one of those rows was dated the day it was typed.
  const [date, setDate] = useState(todayStr());
  const [person, setPerson] = useState("");
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
    if (!date) {
      setErr("Pick the date this happened.");
      return;
    }
    const bill = catBills.find((b) => b.billId === billId);
    await db.stockMoves.add({
      id: crypto.randomUUID(),
      stockId: item.id,
      date,
      kind,
      qty: q,
      person: person.trim(),
      note: note.trim() || (bill && !person.trim() ? bill.label : ""),
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
        <PartyInput
          kind={kind}
          value={person}
          known={parties}
          onChange={setPerson}
        />
      </div>
      <div className="flex gap-1.5">
        <input
          type="date"
          className="input !py-1.5 !text-[13px] !w-36"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          className="input !py-1.5 !text-[13px] flex-1"
          placeholder="Note (optional)"
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

/**
 * What went out, on the days you ask about.
 *
 * Two modes off one control. The day stepper answers "what did I hand over on
 * Tuesday" — the question you get asked when a man says he was given nothing;
 * the range answers "what has this plumber had off me all week", which is the
 * question at settling-up time. Both group by person first, because that is who
 * the argument is with.
 */
function DateView({
  items,
  moves,
}: {
  items: StockItem[];
  moves: StockMove[];
}) {
  const [mode, setMode] = useState<"day" | "range">("day");
  const [day, setDay] = useState(todayStr());
  const [from, setFrom] = useState(addDays(todayStr(), -6));
  const [to, setTo] = useState(todayStr());
  const [editMoveId, setEditMoveId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ qty: "", date: "", person: "" });

  const [lo, hi] = mode === "day" ? [day, day] : [from, to];
  const rows = useMemo(
    () => handoutsBetween(items, moves, lo, hi),
    [items, moves, lo, hi],
  );
  const groups = useMemo(() => byPerson(rows), [rows]);
  const materials = new Set(rows.map((r) => r.stockId)).size;

  /**
   * The days either side that actually have something on them.
   *
   * The arrows step one calendar day, which is what "the day before" means. But
   * a site does not hand out material every day, and a person tapping ◀ four
   * times through empty Sundays to reach the last real entry has been made to
   * do the searching. So the empty days are still reachable one tap at a time,
   * and the next day with anything on it is offered by name.
   */
  const outDates = useMemo(
    () => [...new Set(moves.filter((m) => m.kind === "out").map((m) => m.date))].sort(),
    [moves],
  );
  const prevBusy = [...outDates].reverse().find((d) => d < day);
  const nextBusy = outDates.find((d) => d > day);

  const saveEdit = async () => {
    const q = parseFloat(draft.qty);
    if (editMoveId && q > 0 && draft.date)
      await db.stockMoves.update(editMoveId, {
        qty: q,
        date: draft.date,
        person: draft.person.trim(),
      });
    setEditMoveId(null);
  };

  return (
    <div className="space-y-2 pb-4">
      <div className="flex gap-1.5">
        {(
          [
            ["day", "One day"],
            ["range", "Date range"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            className={`badge !text-[11px] !py-1 !px-2.5 ${
              mode === m ? "!bg-ink !text-paper !border-ink" : ""
            }`}
            onClick={() => setMode(m)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "day" ? (
        <div className="card px-2 py-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <button
              className="btn !py-1 !px-3 !text-[15px]"
              aria-label="Previous day"
              onClick={() => setDay((d) => addDays(d, -1))}
            >
              ◀
            </button>
            <div className="flex-1 text-center">
              <div className="text-sm font-semibold">{formatDate(day)}</div>
              {day === todayStr() && (
                <div className="text-[10px] uppercase tracking-wider text-ink-soft">
                  today
                </div>
              )}
            </div>
            <button
              className="btn !py-1 !px-3 !text-[15px]"
              aria-label="Next day"
              onClick={() => setDay((d) => addDays(d, 1))}
            >
              ▶
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              className="input !py-1 !text-[12px] flex-1"
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
            />
            {day !== todayStr() && (
              <button
                className="btn !py-1 !px-2.5 !text-[11px]"
                onClick={() => setDay(todayStr())}
              >
                Today
              </button>
            )}
          </div>
          {rows.length === 0 && (prevBusy || nextBusy) && (
            <div className="flex gap-1.5 justify-center">
              {prevBusy && (
                <button
                  className="text-[11px] underline text-ink-soft"
                  onClick={() => setDay(prevBusy)}
                >
                  ← {formatDate(prevBusy)}
                </button>
              )}
              {nextBusy && (
                <button
                  className="text-[11px] underline text-ink-soft"
                  onClick={() => setDay(nextBusy)}
                >
                  {formatDate(nextBusy)} →
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="card px-2 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              className="input !py-1 !text-[12px] flex-1"
              value={from}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
            />
            <span className="text-[11px] text-ink-soft">to</span>
            <input
              type="date"
              className="input !py-1 !text-[12px] flex-1"
              value={to}
              onChange={(e) => e.target.value && setTo(e.target.value)}
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {(
              [
                ["Last 7 days", () => [addDays(todayStr(), -6), todayStr()]],
                ["Last 30 days", () => [addDays(todayStr(), -29), todayStr()]],
                [
                  "This month",
                  () => [todayStr().slice(0, 8) + "01", todayStr()],
                ],
              ] as const
            ).map(([label, span]) => (
              <button
                key={label}
                className="badge !text-[11px] !py-1 !px-2.5"
                onClick={() => {
                  const [a, b] = span();
                  setFrom(a);
                  setTo(b);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {from > to && (
            <div className="text-[11px] text-crimson">
              The start date is after the end date, so nothing can fall inside
              it.
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-sm text-ink-soft text-center py-8">
          Nothing was given out{" "}
          {mode === "day" ? `on ${formatDate(day)}` : "in these dates"}.
        </div>
      ) : (
        <>
          <div className="text-[11px] text-ink-soft px-1">
            {/* No grand total quantity: these rows can be pieces, bags and
                litres at once, and one number across them would mean nothing. */}
            <b>{materials}</b> material{materials === 1 ? "" : "s"} out to{" "}
            <b>{groups.length}</b> {groups.length === 1 ? "person" : "people"}
            {mode === "range" && ` · ${formatDate(from)} – ${formatDate(to)}`}
          </div>
          {groups.map((g) => (
            <div key={g.person} className="card overflow-hidden">
              <div className="px-3 py-1.5 flex justify-between items-baseline border-b border-rule">
                <span className="text-sm font-semibold">{g.person}</span>
                <span className="text-[11px] text-ink-soft">
                  {g.items} item{g.items === 1 ? "" : "s"}
                </span>
              </div>
              <div className="divide-y divide-rule">
                {g.rows.map((r) =>
                  editMoveId === r.moveId ? (
                    <div key={r.moveId} className="px-3 py-2 space-y-1">
                      <div className="text-[12px] font-medium">{r.name}</div>
                      <div className="flex gap-1.5">
                        <input
                          className="input !py-1 !text-[12px] money !w-16"
                          inputMode="decimal"
                          value={draft.qty}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, qty: e.target.value }))
                          }
                        />
                        <input
                          type="date"
                          className="input !py-1 !text-[12px] flex-1"
                          value={draft.date}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, date: e.target.value }))
                          }
                        />
                      </div>
                      <div className="flex gap-1.5 items-center">
                        <input
                          className="input !py-1 !text-[12px] flex-1"
                          list="party-edit"
                          placeholder="Given to"
                          value={draft.person}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, person: e.target.value }))
                          }
                        />
                        <button
                          className="text-[11px] text-moss px-1"
                          onClick={() => void saveEdit()}
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
                    </div>
                  ) : (
                    <div
                      key={r.moveId}
                      className="px-3 py-1.5 flex items-center gap-2 text-[13px]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{r.name}</div>
                        <div className="text-[10px] text-ink-soft flex items-center gap-1.5">
                          <span className="badge">{r.category}</span>
                          {/* The date is shown per row in range mode, where
                              rows from different days sit together. */}
                          {mode === "range" && (
                            <span className="money">{formatDate(r.date)}</span>
                          )}
                          {r.note && <span className="truncate">{r.note}</span>}
                        </div>
                      </div>
                      <span className="money font-semibold text-crimson shrink-0">
                        {num(r.qty)}
                        {r.unit && (
                          <span className="text-[10px] font-normal"> {r.unit}</span>
                        )}
                      </span>
                      <button
                        className="text-[11px] text-ink-soft px-0.5 shrink-0"
                        onClick={() => {
                          setEditMoveId(r.moveId);
                          setDraft({
                            qty: String(r.qty),
                            date: r.date,
                            person: r.person,
                          });
                        }}
                      >
                        edit
                      </button>
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function Stock() {
  const items = useLiveQuery(() => db.stockItems.toArray(), []);
  const moves = useLiveQuery(() => db.stockMoves.toArray(), []);
  const boqItems = useLiveQuery(() => db.boqItems.toArray(), []);
  const people = useLiveQuery(() => db.people.toArray(), []);
  const categories = useCategories();
  const [view, setView] = useState<"items" | "bill" | "date">("items");
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [openMove, setOpenMove] = useState<{ id: string; kind: MoveKind } | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editMoveId, setEditMoveId] = useState<string | null>(null);
  const [moveDraft, setMoveDraft] = useState({
    qty: "",
    date: "",
    person: "",
    note: "",
  });
  // Selected bill in the "By bill" view.
  const [billSel, setBillSel] = useState<string>("");
  /** Bill whose "remove everything this put into stock" is awaiting confirmation. */
  const [confirmClearBill, setConfirmClearBill] = useState<string | null>(null);
  /**
   * Selection mode for the All-items list.
   *
   * A mode rather than a second checkbox per row: every row already carries a
   * tick meaning "fully used / settled", and two checkboxes side by side is an
   * invitation to press the wrong one — here, one that deletes.
   */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

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

  /**
   * Names to offer when recording who something went to. People already handed
   * material come first (that is who you are most likely handing to again),
   * then the People/category list, so a plumber who has never been given
   * anything is still one tap away the first time.
   */
  const parties = useMemo(() => {
    const seen = knownRecipients(moves ?? []);
    const rest = [...categories, ...(people ?? []).map((p) => p.name)].filter(
      (n) => n && !seen.some((s) => s.toLowerCase() === n.toLowerCase()),
    );
    return [...seen, ...new Set(rest)];
  }, [moves, categories, people]);

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

  // Selection survives a change of category filter, so a person can gather up
  // plumbing and then electrical before acting. That means some of what is
  // selected may be off screen, which the confirmation has to own up to.
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const selectedVisible = visibleIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisible === visibleIds.length;
  const hiddenSelected = selected.size - selectedVisible;

  /** Movements about to be destroyed along with the selected items. */
  const selectedMoveCount = useMemo(
    () => (moves ?? []).filter((m) => selected.has(m.stockId)).length,
    [moves, selected],
  );

  const toggleSelected = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const leaveSelectMode = () => {
    setSelecting(false);
    setSelected(new Set());
    setConfirmBulk(false);
  };

  const bulkSetDone = async (done: boolean) => {
    await db.transaction("rw", db.stockItems, async () => {
      for (const id of selected) await db.stockItems.update(id, { done });
    });
    leaveSelectMode();
  };

  const bulkDelete = async () => {
    await deleteStockItems([...selected]);
    leaveSelectMode();
  };

  const deleteItem = async (id: string) => {
    await db.transaction("rw", [db.stockItems, db.stockMoves], async () => {
      await db.stockMoves.where("stockId").equals(id).delete();
      await db.stockItems.delete(id);
    });
    setConfirmId(null);
  };

  const saveMoveEdit = async () => {
    const q = parseFloat(moveDraft.qty);
    // The date is editable here too, not just on the way in: a handout written
    // up late is exactly the row whose date needs correcting afterwards.
    if (editMoveId && q > 0 && moveDraft.date)
      await db.stockMoves.update(editMoveId, {
        qty: q,
        date: moveDraft.date,
        person: moveDraft.person.trim(),
        note: moveDraft.note.trim(),
      });
    setEditMoveId(null);
  };

  const startMoveEdit = (m: StockMove) => {
    setEditMoveId(m.id);
    setMoveDraft({
      qty: String(m.qty),
      date: m.date,
      // Both defended: a row synced from a device on an older build can reach
      // here without them, and a null in a controlled input is a React warning
      // and an uneditable field.
      person: m.person ?? "",
      note: m.note ?? "",
    });
  };

  const selectedBill = bills.find((b) => b.billId === billSel);

  // What clearing the selected bill would cost, so the confirmation can say it
  // in real numbers rather than asking whether the person is sure.
  const billImpact = useMemo(
    () => (selectedBill ? billStockImpact(selectedBill.billId, moves ?? []) : null),
    [selectedBill, moves],
  );

  const clearBillStock = async (billId: string) => {
    await removeBillFromStock(billId);
    setConfirmClearBill(null);
  };

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">Stock / Inventory</h2>
        {view === "items" &&
          (selecting ? (
            <button className="btn !py-1.5" onClick={leaveSelectMode}>
              Cancel
            </button>
          ) : (
            <div className="flex gap-1.5">
              {rows.length > 0 && (
                <button
                  className="btn !py-1.5"
                  onClick={() => setSelecting(true)}
                >
                  Select
                </button>
              )}
              <button
                className="btn btn-primary !py-1.5"
                onClick={() => setAdding(true)}
              >
                + Add item
              </button>
            </div>
          ))}
      </div>

      {/* All-items ↔ By-date ↔ By-bill view toggle */}
      <div className="flex gap-1.5 mb-3">
        {(
          [
            ["items", "All items"],
            ["date", "By date"],
            ["bill", "By BOQ bill"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            className={`badge !text-[12px] !py-1 !px-3 ${
              view === v ? "!bg-ink !text-paper !border-ink" : ""
            }`}
            onClick={() => setView(v)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* One list, shared by every inline row editor on this screen. */}
      <datalist id="party-edit">
        {parties.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {view === "date" ? (
        <DateView items={items ?? []} moves={moves ?? []} />
      ) : view === "bill" ? (
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
            <div className="card overflow-hidden">
              <div className="px-3 py-2 text-sm font-medium">
                {selectedBill.label}
                <span className="badge ml-2">{selectedBill.category}</span>
              </div>
              <BillStockPanel
                billId={selectedBill.billId}
                billLabel={selectedBill.label}
              />
              {/* Undo the whole bill at once. Line by line is the right tool
                  for one wrong row; a bill scanned with every quantity wrong
                  needs as many confirmations as it has rows. */}
              {billImpact && billImpact.receipts > 0 && (
                <div className="px-3 py-2 border-t border-rule">
                  {confirmClearBill === selectedBill.billId ? (
                    <div className="space-y-2">
                      <div className="text-[12px] text-ink-soft">
                        Removes{" "}
                        <b>
                          {billImpact.receipts} receipt
                          {billImpact.receipts === 1 ? "" : "s"}
                        </b>{" "}
                        (<span className="money">{num(billImpact.qty)}</span> in
                        total) across {billImpact.itemsTouched} item
                        {billImpact.itemsTouched === 1 ? "" : "s"}.
                        {billImpact.itemsRemoved > 0 && (
                          <>
                            {" "}
                            {billImpact.itemsRemoved}{" "}
                            {billImpact.itemsRemoved === 1
                              ? "of those exists"
                              : "of those exist"}{" "}
                            only because of this bill and will disappear
                            {billImpact.itemsTouched -
                              billImpact.itemsRemoved >
                            0 ? (
                              <>
                                ;{" "}
                                {billImpact.itemsTouched -
                                  billImpact.itemsRemoved}{" "}
                                {billImpact.itemsTouched -
                                  billImpact.itemsRemoved ===
                                1
                                  ? "keeps its"
                                  : "keep their"}{" "}
                                other history.
                              </>
                            ) : (
                              "."
                            )}
                          </>
                        )}{" "}
                        The bill itself is not touched.
                      </div>
                      {billImpact.givenOut > 0 && (
                        <div className="text-[12px] text-crimson">
                          {/* No unit: these items can be counted in pieces,
                              bags and kg at once, so a bare total is the only
                              honest thing to put here. */}
                          <b>
                            Some of this has already been given out —{" "}
                            <span className="money">
                              {num(billImpact.givenOut)}
                            </span>{" "}
                            across these items.
                          </b>{" "}
                          Those handouts really happened, so they are kept —
                          which means removing the receipts behind them will
                          leave those items showing a negative balance.
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          className="text-[12px] text-white bg-crimson rounded px-3 py-1"
                          onClick={() =>
                            void clearBillStock(selectedBill.billId)
                          }
                        >
                          Remove all {billImpact.receipts} from stock
                        </button>
                        <button
                          className="text-[12px] border border-rule rounded px-3 py-1"
                          onClick={() => setConfirmClearBill(null)}
                        >
                          Keep
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="text-[12px] text-crimson"
                      onClick={() => setConfirmClearBill(selectedBill.billId)}
                    >
                      remove everything this bill put into stock
                    </button>
                  )}
                </div>
              )}
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

          {selecting && (
            <div className="card px-3 py-2.5 mb-2 space-y-2 sticky top-0 z-10">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">
                  {selected.size === 0
                    ? "Tap items to select them"
                    : `${selected.size} selected`}
                  {hiddenSelected > 0 && (
                    <span className="text-[11px] font-normal text-ink-soft">
                      {" "}
                      ({hiddenSelected} not shown here)
                    </span>
                  )}
                </span>
                <button
                  className="text-[12px] underline shrink-0"
                  onClick={() =>
                    setSelected((s) => {
                      const next = new Set(s);
                      // Acts on what is on screen, so the category filter above
                      // is how you select a subset: filter to Plumbing, select
                      // all, act. Never reaches rows the filter is hiding.
                      if (allVisibleSelected)
                        visibleIds.forEach((id) => next.delete(id));
                      else visibleIds.forEach((id) => next.add(id));
                      return next;
                    })
                  }
                >
                  {allVisibleSelected ? "Clear these" : `Select all ${visibleIds.length}`}
                </button>
              </div>

              {selected.size > 0 &&
                (confirmBulk ? (
                  <div className="space-y-2">
                    <div className="text-[12px] text-crimson">
                      Deletes <b>{selected.size}</b> item
                      {selected.size === 1 ? "" : "s"}
                      {selectedMoveCount > 0 && (
                        <>
                          {" "}
                          and the <b>{selectedMoveCount}</b> movement
                          {selectedMoveCount === 1 ? "" : "s"} recorded against
                          {selected.size === 1 ? " it" : " them"} — every
                          received and given-out row, not just the balance
                        </>
                      )}
                      .{" "}
                      {hiddenSelected > 0 && (
                        <>
                          <b>{hiddenSelected}</b> of them{" "}
                          {hiddenSelected === 1 ? "is" : "are"} hidden by the
                          filter above.{" "}
                        </>
                      )}
                      The bills these came from are not touched.
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="text-[12px] text-white bg-crimson rounded px-3 py-1"
                        onClick={() => void bulkDelete()}
                      >
                        Delete {selected.size}
                      </button>
                      <button
                        className="text-[12px] border border-rule rounded px-3 py-1"
                        onClick={() => setConfirmBulk(false)}
                      >
                        Keep
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      className="btn !py-1 !px-2.5 !text-[12px]"
                      onClick={() => void bulkSetDone(true)}
                    >
                      Mark done
                    </button>
                    <button
                      className="btn !py-1 !px-2.5 !text-[12px]"
                      onClick={() => void bulkSetDone(false)}
                    >
                      Mark not done
                    </button>
                    <button
                      className="btn !py-1 !px-2.5 !text-[12px] !text-crimson !border-crimson"
                      onClick={() => setConfirmBulk(true)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
            </div>
          )}

          <div className="space-y-2 pb-4">
            {rows.map((it) => (
              <div
                key={it.id}
                className={`card px-3 py-2.5 ${it.done && !selecting ? "opacity-55" : ""} ${
                  selecting && selected.has(it.id)
                    ? "outline outline-2 outline-crimson"
                    : ""
                }`}
                // In select mode the whole card is the target — a 16px
                // checkbox is a poor thing to aim at twenty times over.
                onClick={selecting ? () => toggleSelected(it.id) : undefined}
              >
                <div className="flex items-start gap-2.5">
                  {/* One checkbox, two meanings, never both at once: normally
                      "fully used / settled", and in select mode the selection
                      itself. Showing both would put a delete-me tick next to an
                      archive-me tick, on every row. */}
                  <input
                    type="checkbox"
                    className={`mt-1 w-4 h-4 ${selecting ? "accent-crimson" : "accent-moss"}`}
                    checked={selecting ? selected.has(it.id) : it.done}
                    title={
                      selecting
                        ? "Select this item"
                        : "Tick when this material is fully used / settled"
                    }
                    onChange={(e) => {
                      if (selecting) toggleSelected(it.id);
                      else void db.stockItems.update(it.id, { done: e.target.checked });
                    }}
                    onClick={(e) => e.stopPropagation()}
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

                {/* The per-row actions are hidden while selecting. Leaving them
                    under a card that now responds to a tap means aiming at
                    "Edit" and hitting the row, or the reverse. */}
                {selecting ? null : editItemId === it.id ? (
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
                    parties={parties}
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
                      // By the date it happened, not the order it was typed.
                      // Now that a movement can be back-dated, those two come
                      // apart — an evening's catch-up entered newest-first
                      // would otherwise read 19th, 18th, 21st down the page.
                      // createdAt breaks ties so a day's rows keep their order.
                      .sort(
                        (a, b) =>
                          (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
                          b.createdAt - a.createdAt,
                      )
                      .map((m) =>
                        editMoveId === m.id ? (
                          <div key={m.id} className="py-1 space-y-1">
                            <div className="flex items-center gap-1.5">
                              <input
                                className="input !py-1 !text-[12px] money !w-16"
                                inputMode="decimal"
                                value={moveDraft.qty}
                                onChange={(e) =>
                                  setMoveDraft((d) => ({ ...d, qty: e.target.value }))
                                }
                              />
                              <input
                                type="date"
                                className="input !py-1 !text-[12px] flex-1"
                                value={moveDraft.date}
                                onChange={(e) =>
                                  setMoveDraft((d) => ({ ...d, date: e.target.value }))
                                }
                              />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <input
                                className="input !py-1 !text-[12px] flex-1"
                                list="party-edit"
                                placeholder={
                                  m.kind === "in" ? "From whom" : "Given to"
                                }
                                value={moveDraft.person}
                                onChange={(e) =>
                                  setMoveDraft((d) => ({
                                    ...d,
                                    person: e.target.value,
                                  }))
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
                            <span className="truncate flex-1">
                              {m.person && (
                                <span
                                  className={
                                    m.kind === "out" ? "font-medium" : "text-ink-soft"
                                  }
                                >
                                  {m.person}
                                </span>
                              )}
                              {m.person && m.note && (
                                <span className="text-ink-soft"> · </span>
                              )}
                              <span className="text-ink-soft">{m.note}</span>
                              {m.billId && (
                                <span className="badge ml-1 !text-[9px]">bill</span>
                              )}
                            </span>
                            <button
                              className="text-[11px] text-ink-soft px-0.5 shrink-0"
                              onClick={() => startMoveEdit(m)}
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
