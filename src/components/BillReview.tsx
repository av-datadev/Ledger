import { useEffect, useState } from "react";
import { db } from "../db";
import { useCategories } from "../hooks/useCategories";
import { usePayers, useModes } from "../hooks/useFacets";
import { inr, todayStr } from "../lib/format";
import { addBillRowsToStock } from "../lib/stock";
import { BASIS, MEASURE_BASES, deriveMeasure, amountFrom } from "../lib/measure";
import { useBackClose } from "../hooks/useBackClose";
import type { MeasureBasis } from "../types";

export interface DraftItem {
  item: string;
  hsn: string;
  gstPct: string;
  basis: MeasureBasis;
  length: string;
  width: string;
  qty: string;
  unit: string;
  rate: string;
  discPct: string;
  amount: string;
}

export interface DraftBill {
  billId: string;
  vendor: string;
  invoiceNo: string;
  date: string;
  category: string;
  invoiceTotal: string;
  items: DraftItem[];
}

export const blankItem = (): DraftItem => ({
  item: "",
  hsn: "",
  gstPct: "",
  basis: "qty",
  length: "",
  width: "",
  qty: "",
  unit: "",
  rate: "",
  discPct: "",
  amount: "",
});

export const emptyDraft = (): DraftBill => ({
  billId: crypto.randomUUID(),
  vendor: "",
  invoiceNo: "",
  date: todayStr(),
  category: "Misc",
  invoiceTotal: "",
  items: [blankItem()],
});

const toNum = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

// Units the calculator sets automatically — cleared when a line reverts to a
// plain quantity so the user isn't left with a stale "sqft".
const AUTO_UNITS = new Set(MEASURE_BASES.filter((b) => b !== "qty").map((b) => BASIS[b].unit));

export function BillReview({
  draft,
  scanned = false,
  editing = false,
  onChange,
  onClose,
}: {
  draft: DraftBill;
  scanned?: boolean;
  /** Editing an existing bill: replace its rows and skip the create-only helpers. */
  editing?: boolean;
  onChange: (d: DraftBill) => void;
  onClose: () => void;
}) {
  const categories = useCategories();
  const payers = usePayers();
  const modes = useModes();
  const [ackMismatch, setAckMismatch] = useState(false);
  const [alsoLedger, setAlsoLedger] = useState(false);
  const [addToStock, setAddToStock] = useState(!editing);
  const [ledgerMode, setLedgerMode] = useState<string>("Cash");
  const [ledgerPayer, setLedgerPayer] = useState<string>("");
  const [errors, setErrors] = useState<string[]>([]);

  // Default the optional ledger entry's payer/mode to the user's own first real
  // option (data-derived) rather than a generic placeholder.
  useEffect(() => {
    setLedgerPayer((p) => (p && payers.includes(p) ? p : (payers[0] ?? p)));
    setLedgerMode((m) => (modes.includes(m) ? m : (modes[0] ?? m)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payers, modes]);

  const requestClose = useBackClose(true, onClose);

  const set = (patch: Partial<DraftBill>) => onChange({ ...draft, ...patch });

  // Merge a patch into a line, then recompute the derived measure (into qty for
  // area/length bases) and the amount — unless the amount itself was edited.
  const setItem = (i: number, patch: Partial<DraftItem>) => {
    const items = draft.items.slice();
    const it: DraftItem = { ...items[i], ...patch };
    if (!("amount" in patch)) {
      if (it.basis === "qty") {
        if (AUTO_UNITS.has(it.unit)) it.unit = "";
        const amt = amountFrom(toNum(it.qty), toNum(it.rate));
        if (amt != null) it.amount = String(amt);
      } else {
        it.unit = BASIS[it.basis].unit;
        const measure = deriveMeasure(
          it.basis,
          toNum(it.length),
          toNum(it.width),
          null,
        );
        it.qty = measure != null ? String(measure) : "";
        const amt = amountFrom(measure, toNum(it.rate));
        if (amt != null) it.amount = String(amt);
      }
    }
    items[i] = it;
    set({ items });
  };

  const linesSum =
    Math.round(
      draft.items.reduce((s, it) => s + (toNum(it.amount) ?? 0), 0) * 100,
    ) / 100;
  const total = toNum(draft.invoiceTotal) ?? 0;
  const diff = Math.round((linesSum - total) * 100) / 100;
  const matches = Math.abs(diff) < 0.005 && total > 0;

  const save = async () => {
    const errs: string[] = [];
    if (!draft.vendor.trim()) errs.push("Vendor is required.");
    if (!draft.invoiceNo.trim()) errs.push("Invoice number is required.");
    if (!(total > 0)) errs.push("Invoice total must be greater than zero.");
    const validItems = draft.items.filter(
      (it) => it.item.trim() && toNum(it.amount) !== null,
    );
    if (validItems.length === 0)
      errs.push("At least one line item with a description and amount is required.");
    if (!matches && !ackMismatch)
      errs.push(
        "Line items don't add up to the invoice total. Fix the rows or tick the mismatch acknowledgement.",
      );
    setErrors(errs);
    if (errs.length) return;

    const date = draft.date || todayStr();
    const rows = validItems.map((it) => ({
      id: crypto.randomUUID(),
      billId: draft.billId,
      date,
      category: draft.category,
      vendor: draft.vendor.trim(),
      invoiceNo: draft.invoiceNo.trim(),
      invoiceTotal: total,
      item: it.item.trim(),
      hsn: it.hsn.trim() || null,
      gstPct: toNum(it.gstPct),
      basis: it.basis,
      length: it.basis === "qty" ? null : toNum(it.length),
      width: BASIS[it.basis].area ? toNum(it.width) : null,
      qty: toNum(it.qty),
      unit: it.unit.trim() || null,
      rate: toNum(it.rate),
      discPct: toNum(it.discPct),
      amount: toNum(it.amount) ?? 0,
    }));

    // Editing replaces the bill's rows in place, keeping billId (and therefore
    // any linked stock receipts) intact.
    await db.transaction("rw", db.boqItems, async () => {
      if (editing)
        await db.boqItems.where("billId").equals(draft.billId).delete();
      await db.boqItems.bulkAdd(rows);
    });

    if (alsoLedger) {
      await db.entries.add({
        id: crypto.randomUUID(),
        date,
        category: draft.category,
        event: `Bill #${draft.invoiceNo.trim()} — ${draft.vendor.trim()}`,
        detail: draft.vendor.trim(),
        amount: total,
        mode: ledgerMode,
        paidBy: ledgerPayer,
        notes: "Created from BOQ bill",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    if (addToStock) {
      await addBillRowsToStock(
        validItems.map((it) => ({
          name: it.item.trim(),
          qty: toNum(it.qty) ?? 0,
          unit: it.unit.trim(),
        })),
        draft.category,
        date,
        `Bill #${draft.invoiceNo.trim()} ${draft.vendor.trim()}`.trim(),
        draft.billId,
      );
    }
    requestClose();
  };

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">
          {editing ? "Edit bill" : "Review bill"}
        </h2>
        <button
          className="btn !py-1.5 !px-3 !text-[13px]"
          onClick={requestClose}
        >
          Cancel
        </button>
      </div>

      {scanned && (
        <div className="text-[13px] px-3 py-2 rounded-md border border-crimson bg-crimson/5 text-crimson mb-3">
          Scanned on this phone — the reader makes mistakes. Check every row
          and the total against the paper bill before saving.
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Vendor</label>
            <input
              className="input"
              value={draft.vendor}
              onChange={(e) => set({ vendor: e.target.value })}
            />
          </div>
          <div>
            <label className="field-label">Invoice #</label>
            <input
              className="input"
              value={draft.invoiceNo}
              onChange={(e) => set({ invoiceNo: e.target.value })}
            />
          </div>
          <div>
            <label className="field-label">Date</label>
            <input
              type="date"
              className="input"
              value={draft.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </div>
          <div>
            <label className="field-label">Category</label>
            <select
              className="input"
              value={draft.category}
              onChange={(e) => set({ category: e.target.value })}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="field-label">Invoice total (printed on bill, ₹)</label>
          <input
            type="number"
            inputMode="decimal"
            className="input money !font-semibold"
            value={draft.invoiceTotal}
            onChange={(e) => set({ invoiceTotal: e.target.value })}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="field-label !mb-0">Line items</label>
            <button
              className="text-[12px] text-ink-soft border border-rule rounded px-2 py-0.5"
              onClick={() => set({ items: [...draft.items, blankItem()] })}
            >
              + add row
            </button>
          </div>
          <div className="space-y-2">
            {draft.items.map((it, i) => (
              <LineItem
                key={i}
                it={it}
                onField={(patch) => setItem(i, patch)}
                onRemove={() =>
                  set({ items: draft.items.filter((_, j) => j !== i) })
                }
              />
            ))}
          </div>
        </div>

        <div
          className={`px-3 py-2 rounded-md border text-[13px] money ${
            matches
              ? "border-moss text-moss bg-moss/5"
              : "border-crimson text-crimson bg-crimson/5"
          }`}
        >
          Lines sum: {inr(linesSum)} · Invoice total: {inr(total)}{" "}
          {matches ? "✓ match" : `— off by ${inr(Math.abs(diff))}`}
        </div>

        {!matches && (
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ackMismatch}
              onChange={(e) => setAckMismatch(e.target.checked)}
            />
            I understand the line items don't add up to the printed total —
            save anyway.
          </label>
        )}

        {!editing && (
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#2F6D4F]"
              checked={addToStock}
              onChange={(e) => setAddToStock(e.target.checked)}
            />
            Add the material rows (with quantities) to <b>Stock</b> so you can
            track how much is given to labour and what's left.
          </label>
        )}

        {!editing && (
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={alsoLedger}
              onChange={(e) => setAlsoLedger(e.target.checked)}
            />
            Also create a ledger entry for this bill's total (leave unchecked if
            the payment is already in the ledger).
          </label>
        )}

        {editing && (
          <div className="text-[12px] text-ink-soft">
            Editing replaces this bill's rows. Stock already received from it,
            and any ledger entry, stay as they are.
          </div>
        )}

        {alsoLedger && (
          <div className="grid grid-cols-2 gap-3 pl-6">
            <div>
              <label className="field-label">Payment mode</label>
              <select
                className="input"
                value={ledgerMode}
                onChange={(e) => setLedgerMode(e.target.value)}
              >
                {modes.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Paid by</label>
              <select
                className="input"
                value={ledgerPayer}
                onChange={(e) => setLedgerPayer(e.target.value)}
              >
                {payers.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <ul className="text-[13px] text-crimson list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        <button
          className="btn btn-primary w-full !py-3 !text-base"
          onClick={() => void save()}
        >
          {editing ? "Save changes" : "Save bill"}
        </button>
      </div>
    </div>
  );
}

/** One editable bill line, with the measure-basis calculator. */
function LineItem({
  it,
  onField,
  onRemove,
}: {
  it: DraftItem;
  onField: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
}) {
  const area = BASIS[it.basis].area;
  const measureHint =
    it.basis !== "qty" && it.qty
      ? `${it.qty} ${BASIS[it.basis].unit}${it.rate ? ` × ₹${it.rate}` : ""}`
      : "";

  return (
    <div className="bg-surface border border-rule rounded-md p-2 space-y-1.5">
      <div className="flex gap-1.5">
        <input
          className="input !py-1.5 !text-[13px] flex-1"
          placeholder="Description (or SGST / CGST / Freight / Rounding)"
          value={it.item}
          onChange={(e) => onField({ item: e.target.value })}
        />
        <button
          className="text-crimson text-lg px-1.5 leading-none"
          aria-label="Remove row"
          onClick={onRemove}
        >
          ×
        </button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {MEASURE_BASES.map((b) => (
          <button
            key={b}
            type="button"
            className={`text-[11px] rounded px-2 py-1 border ${
              it.basis === b
                ? "bg-ink text-paper border-ink"
                : "border-rule text-ink-soft"
            }`}
            onClick={() => onField({ basis: b })}
          >
            {BASIS[b].label}
          </button>
        ))}
      </div>

      {it.basis === "qty" ? (
        <div className="grid grid-cols-4 gap-1.5">
          <input
            className="input !py-1.5 !text-[13px] money"
            placeholder="Qty"
            inputMode="decimal"
            value={it.qty}
            onChange={(e) => onField({ qty: e.target.value })}
          />
          <input
            className="input !py-1.5 !text-[13px]"
            placeholder="Unit"
            value={it.unit}
            onChange={(e) => onField({ unit: e.target.value })}
          />
          <input
            className="input !py-1.5 !text-[13px] money"
            placeholder="Rate"
            inputMode="decimal"
            value={it.rate}
            onChange={(e) => onField({ rate: e.target.value })}
          />
          <input
            className="input !py-1.5 !text-[13px] money !font-semibold"
            placeholder="Amount"
            inputMode="decimal"
            value={it.amount}
            onChange={(e) => onField({ amount: e.target.value })}
          />
        </div>
      ) : (
        <>
          <div className={`grid ${area ? "grid-cols-3" : "grid-cols-2"} gap-1.5`}>
            <input
              className="input !py-1.5 !text-[13px] money"
              placeholder={area ? "Length" : `Length (${BASIS[it.basis].unit})`}
              inputMode="decimal"
              value={it.length}
              onChange={(e) => onField({ length: e.target.value })}
            />
            {area && (
              <input
                className="input !py-1.5 !text-[13px] money"
                placeholder="Width"
                inputMode="decimal"
                value={it.width}
                onChange={(e) => onField({ width: e.target.value })}
              />
            )}
            <input
              className="input !py-1.5 !text-[13px] money"
              placeholder={`Rate / ${BASIS[it.basis].unit}`}
              inputMode="decimal"
              value={it.rate}
              onChange={(e) => onField({ rate: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            {measureHint && (
              <span className="text-[11px] text-ink-soft money">
                = {measureHint}
              </span>
            )}
            <input
              className="input !py-1.5 !text-[13px] money !font-semibold ml-auto !w-32"
              placeholder="Amount"
              inputMode="decimal"
              value={it.amount}
              onChange={(e) => onField({ amount: e.target.value })}
            />
          </div>
        </>
      )}
    </div>
  );
}
