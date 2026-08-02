import { useEffect, useState } from "react";
import { db } from "../db";
import { useCategories } from "../hooks/useCategories";
import { usePayers, useModes } from "../hooks/useFacets";
import { inr, todayStr, formatDate } from "../lib/format";
import { addBillRowsToStock } from "../lib/stock";
import {
  BASIS,
  MEASURE_BASES,
  deriveMeasure,
  amountFrom,
  parseDimension,
  blankDims,
} from "../lib/measure";
import { useBackClose } from "../hooks/useBackClose";
import type { MeasureBasis } from "../types";

export interface DraftItem {
  item: string;
  hsn: string;
  gstPct: string;
  basis: MeasureBasis;
  length: string;
  width: string;
  /** cft only: thickness in inches. */
  thickness: string;
  /** cft only: pieces of this size. */
  pieces: string;
  qty: string;
  unit: string;
  rate: string;
  discPct: string;
  amount: string;
  /** cft only: the size line as the dealer wrote it, shown for checking. */
  raw?: string;
}

export interface DraftBill {
  billId: string;
  vendor: string;
  invoiceNo: string;
  date: string;
  category: string;
  invoiceTotal: string;
  billGstPct: string; // GST slab for the whole bill (18 = 9% CGST + 9% SGST)
  otherCharges: string; // freight/packing — paid, but not goods
  /** Whether freight/other is part of the taxable value. Bills differ: one
   * prints "Freight (GST)" with its own HSN and rate (taxed), another prints a
   * bare "Freight" line below the tax summary (not taxed). */
  otherChargesTaxed: boolean;
  /**
   * A handwritten dealer's slip rather than a printed tax invoice. These carry
   * no invoice number and often no shop name, so requiring either would make
   * the bill unsaveable — which is precisely why they used to end up as a bare
   * amount in the ledger with the sizes lost.
   */
  informal: boolean;
  /**
   * The total quantity the dealer wrote on the slip (his own "38.987 cft"),
   * kept verbatim. The app never uses it to compute anything — it exists so the
   * measured total can be checked against it. Empty when nothing was written.
   */
  writtenQty: string;
  items: DraftItem[];
}

export const blankItem = (): DraftItem => ({
  item: "",
  hsn: "",
  gstPct: "",
  basis: "qty",
  length: "",
  width: "",
  thickness: "",
  pieces: "",
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
  billGstPct: "18",
  otherCharges: "",
  otherChargesTaxed: false,
  informal: false,
  writtenQty: "",
  items: [blankItem()],
});

const toNum = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

// Units the calculator sets automatically — cleared when a line reverts to a
// plain quantity so the user isn't left with a stale "sqft".
const AUTO_UNITS = new Set(MEASURE_BASES.filter((b) => b !== "qty").map((b) => BASIS[b].unit));

/**
 * Fill in a line's derived measure and amount from its raw inputs. Exported
 * because a scanned size list arrives as dimensions with no quantity — the
 * quantity only exists once this has run — so the scanner has to apply the
 * same arithmetic the form applies on every keystroke.
 */
export function recalcItem(it: DraftItem): DraftItem {
  const next = { ...it };
  if (next.basis === "qty") {
    if (AUTO_UNITS.has(next.unit)) next.unit = "";
    const amt = amountFrom(toNum(next.qty), toNum(next.rate));
    if (amt != null) next.amount = String(amt);
    return next;
  }
  const meta = BASIS[next.basis];
  next.unit = meta.unit;
  const measure = deriveMeasure(next.basis, {
    ...blankDims(),
    // cft is written by hand as "8¼", so its dimensions accept a fraction as
    // well as a decimal.
    length: meta.volume ? parseDimension(next.length) : toNum(next.length),
    width: meta.volume ? parseDimension(next.width) : toNum(next.width),
    thickness: parseDimension(next.thickness),
    pieces: toNum(next.pieces),
  });
  next.qty = measure != null ? String(measure) : "";
  const amt = amountFrom(measure, toNum(next.rate));
  if (amt != null) next.amount = String(amt);
  return next;
}

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
  const [ackQty, setAckQty] = useState(false);
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
    // Editing the amount by hand is the override — never recompute over it.
    items[i] = "amount" in patch ? it : recalcItem(it);
    set({ items });
  };

  const linesSum =
    Math.round(
      draft.items.reduce((s, it) => s + (toNum(it.amount) ?? 0), 0) * 100,
    ) / 100;
  // Goods → GST → total, rebuilt from the rows rather than trusting the reader
  // to have got the printed grand total right. Rounded to the rupee like the
  // bill's "Rounding Off" row.
  const gstPct = toNum(draft.billGstPct) ?? 0;
  const otherCharges = toNum(draft.otherCharges) ?? 0;
  // Whether freight is taxed varies by bill, so it follows the bill rather than
  // a fixed rule: charged as a service line ("Freight (GST)", its own HSN and
  // rate) it joins the taxable value; billed as a bare add-on it doesn't.
  const taxedBase =
    Math.round((linesSum + (draft.otherChargesTaxed ? otherCharges : 0)) * 100) /
    100;
  // Intrastate bills levy the slab as two equal halves — CGST + SGST — and
  // print them as separate rows, so show it the same way. Each half is rounded
  // to paise on its own, exactly as the bill computes them.
  const halfPct = gstPct / 2;
  const halfGst = Math.round(taxedBase * halfPct) / 100;
  const gstAmount = Math.round(halfGst * 2 * 100) / 100;
  const computedTotal = Math.round(linesSum + gstAmount + otherCharges);

  const total = toNum(draft.invoiceTotal) ?? 0;
  const diff = Math.round((linesSum - total) * 100) / 100;
  const matches = Math.abs(diff) < 0.005 && total > 0;
  // How far the printed/entered total is from the arithmetic. A rupee of slack
  // absorbs the bill's own rounding row.
  const computedAgrees =
    total > 0 && Math.abs(Math.round((computedTotal - total) * 100) / 100) <= 1;
  // Line items are goods only — GST, freight and rounding are deliberately not
  // itemised (see scanParse), so on a tax invoice the rows legitimately sit
  // BELOW the printed total and that gap is the tax. Only the opposite case
  // means something is actually wrong: rows adding up to more than the bill
  // total implies a duplicated or misread row, so that's what blocks saving.
  const overCounted = total > 0 && diff > 0.005;

  // ---- Measured quantity, for slips priced off a size list ----------------
  // A timber dealer writes one total ("38.987 cft") and prices off it, but the
  // sizes above it are the evidence. Recomputing them and showing both figures
  // side by side is the whole point of reading the slip as rows rather than as
  // a single amount: it catches his arithmetic and our misreading alike.
  const measuredRows = draft.items.filter((it) => BASIS[it.basis].volume);
  const measuredUnit = measuredRows.length ? BASIS[measuredRows[0].basis].unit : "";
  const measuredQty = measuredRows.length
    ? Math.round(
        measuredRows.reduce((s, it) => s + (toNum(it.qty) ?? 0), 0) * 1000,
      ) / 1000
    : null;
  const writtenQty = toNum(draft.writtenQty);
  // Dealers round their total to three decimals, so a hair of slack is normal;
  // 0.01 cft is about ₹25 of teak, which is small enough to still catch a
  // dropped piece or a misread dimension.
  const QTY_TOLERANCE = 0.01;
  const qtyDiff =
    measuredQty != null && writtenQty != null
      ? Math.round((measuredQty - writtenQty) * 1000) / 1000
      : null;
  const qtyDisagrees = qtyDiff != null && Math.abs(qtyDiff) > QTY_TOLERANCE;
  const totalPieces = measuredRows.reduce(
    (s, it) => s + (toNum(it.pieces) ?? (it.length ? 1 : 0)),
    0,
  );

  const save = async () => {
    const errs: string[] = [];
    if (!draft.vendor.trim() && !draft.informal)
      errs.push("Vendor is required.");
    // A handwritten slip has no invoice number to require — that absence is
    // what makes it informal, not a gap in the data entry.
    if (!draft.invoiceNo.trim() && !draft.informal)
      errs.push("Invoice number is required.");
    if (!(total > 0)) errs.push("Invoice total must be greater than zero.");
    const validItems = draft.items.filter(
      (it) => it.item.trim() && toNum(it.amount) !== null,
    );
    if (validItems.length === 0)
      errs.push("At least one line item with a description and amount is required.");
    if (overCounted && !ackMismatch)
      errs.push(
        "Line items add up to MORE than the invoice total — a row is probably duplicated or misread. Fix the rows or tick the acknowledgement.",
      );
    if (qtyDisagrees && !ackQty)
      errs.push(
        `The sizes measure ${measuredQty} ${measuredUnit}, but the bill says ${writtenQty}. Fix a size, or tick to save anyway.`,
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
      length: it.basis === "qty" ? null : parseDimension(it.length),
      width: BASIS[it.basis].area ? parseDimension(it.width) : null,
      // Thickness and pieces only mean anything on a volume basis; on every
      // other row they stay null so the columns read honestly in the CSV.
      thickness: BASIS[it.basis].volume ? parseDimension(it.thickness) : null,
      pieces: BASIS[it.basis].volume ? toNum(it.pieces) : null,
      writtenQty,
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

    // A slip with no invoice number and no shop name still needs a name to
    // appear under in the ledger and against stock receipts — build it from
    // whichever of the two the paper actually carried.
    const label =
      [draft.invoiceNo.trim() && `Bill #${draft.invoiceNo.trim()}`, draft.vendor.trim()]
        .filter(Boolean)
        .join(" ") || `${draft.category} bill — ${formatDate(date)}`;

    if (alsoLedger) {
      await db.entries.add({
        id: crypto.randomUUID(),
        date,
        category: draft.category,
        event: label,
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
        label,
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
          Read from a photo — the reader makes mistakes, especially with
          numbers. Check every row and the total against the paper before
          saving.
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">
              Vendor{draft.informal && " (optional)"}
            </label>
            <input
              className="input"
              placeholder={draft.informal ? "dealer's name, if known" : ""}
              value={draft.vendor}
              onChange={(e) => set({ vendor: e.target.value })}
            />
          </div>
          <div>
            <label className="field-label">
              Invoice #{draft.informal && " (optional)"}
            </label>
            <input
              className="input"
              placeholder={draft.informal ? "none on the slip" : ""}
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

        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={draft.informal}
            onChange={(e) => set({ informal: e.target.checked })}
          />
          <span>
            Handwritten slip (kaccha bill) — no invoice number or GST. Ticking
            this stops the app demanding a vendor and invoice number the paper
            never had.
          </span>
        </label>

        <div>
          <label className="field-label">
            {draft.informal
              ? "Total written on the slip (₹)"
              : "Invoice total (printed on bill, ₹)"}
          </label>
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

        {/* Measured vs written quantity — only meaningful once a row is priced
            off a size, so it stays out of the way on an ordinary bill. */}
        {measuredRows.length > 0 && (
          <div className="space-y-2">
            <div>
              <label className="field-label" htmlFor="b-wqty">
                Quantity written on the slip ({measuredUnit})
              </label>
              <input
                id="b-wqty"
                type="number"
                inputMode="decimal"
                className="input money"
                placeholder="e.g. 38.987"
                value={draft.writtenQty}
                onChange={(e) => set({ writtenQty: e.target.value })}
              />
            </div>
            <div
              className={`px-3 py-2 rounded-md border text-[13px] money space-y-0.5 ${
                qtyDisagrees
                  ? "border-crimson text-crimson bg-crimson/5"
                  : qtyDiff != null
                    ? "border-moss text-moss bg-moss/5"
                    : "border-rule text-ink-soft bg-surface"
              }`}
            >
              <div className="flex justify-between">
                <span>
                  Sizes measure ({measuredRows.length}{" "}
                  {measuredRows.length === 1 ? "size" : "sizes"}
                  {totalPieces > 0 && `, ${totalPieces} pc`})
                </span>
                <span className="font-semibold">
                  {measuredQty ?? "—"} {measuredUnit}
                </span>
              </div>
              {writtenQty != null && (
                <div className="flex justify-between">
                  <span>Written on the slip</span>
                  <span>
                    {writtenQty} {measuredUnit}
                  </span>
                </div>
              )}
              <div className="pt-1 border-t border-current/20 mt-1">
                {qtyDiff == null
                  ? "Enter the dealer's own total above to check it against the sizes."
                  : qtyDisagrees
                    ? `Off by ${Math.abs(qtyDiff)} ${measuredUnit} — check every size against the photo.`
                    : "✓ the sizes agree with the slip"}
              </div>
            </div>
            {qtyDisagrees && (
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={ackQty}
                  onChange={(e) => setAckQty(e.target.checked)}
                />
                <span>
                  I've checked the sizes against the paper — save anyway, keeping
                  both figures.
                </span>
              </label>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="b-gst">GST %</label>
            <select
              id="b-gst"
              className="input"
              value={draft.billGstPct}
              onChange={(e) => set({ billGstPct: e.target.value })}
            >
              {["0", "5", "12", "18", "28"].map((p) => (
                <option key={p} value={p}>{p}%</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="b-other">
              Freight / other (₹)
            </label>
            <input
              id="b-other"
              type="number"
              inputMode="decimal"
              className="input"
              placeholder="0"
              value={draft.otherCharges}
              onChange={(e) => set({ otherCharges: e.target.value })}
            />
          </div>
        </div>

        {otherCharges > 0 && (
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={draft.otherChargesTaxed}
              onChange={(e) => set({ otherChargesTaxed: e.target.checked })}
            />
            <span>
              GST is charged on the freight too — tick this if the bill shows
              freight with its own HSN and rate (e.g. <b>Freight (GST)</b>),
              rather than as a plain add-on below the tax.
            </span>
          </label>
        )}

        {/* Goods → GST → total, computed from the rows. */}
        <div className="px-3 py-2 rounded-md border border-rule bg-surface text-[13px] money space-y-0.5">
          <div className="flex justify-between">
            <span>Items ({draft.items.length})</span>
            <span>{inr(linesSum)}</span>
          </div>
          {draft.otherChargesTaxed && otherCharges > 0 && (
            <div className="flex justify-between text-ink-soft">
              <span>Taxable value (incl. freight)</span>
              <span>{inr(taxedBase)}</span>
            </div>
          )}
          <div className="flex justify-between text-ink-soft">
            <span>CGST @ {halfPct}%</span>
            <span>{inr(halfGst)}</span>
          </div>
          <div className="flex justify-between text-ink-soft">
            <span>SGST @ {halfPct}%</span>
            <span>{inr(halfGst)}</span>
          </div>
          {otherCharges > 0 && (
            <div className="flex justify-between text-ink-soft">
              <span>Freight / other</span>
              <span>{inr(otherCharges)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold border-t border-rule pt-1 mt-1">
            <span>Calculated total</span>
            <span>{inr(computedTotal)}</span>
          </div>
        </div>

        <div
          className={`px-3 py-2 rounded-md border text-[13px] money ${
            overCounted
              ? "border-crimson text-crimson bg-crimson/5"
              : computedAgrees || matches
                ? "border-moss text-moss bg-moss/5"
                : "border-rule text-ink-soft bg-surface"
          }`}
        >
          Invoice total on bill: {inr(total)}
          {overCounted && ` — items alone exceed it by ${inr(diff)}`}
          {!overCounted && computedAgrees && " ✓ matches the calculation"}
          {!overCounted && !computedAgrees && total > 0 &&
            ` — calculation says ${inr(computedTotal)}`}
          {!overCounted && total <= 0 && " — not read; use the calculated total"}
        </div>

        {!overCounted && !computedAgrees && computedTotal > 0 && (
          <button
            className="btn w-full !py-2"
            onClick={() => set({ invoiceTotal: String(computedTotal) })}
          >
            Use calculated total ({inr(computedTotal)})
          </button>
        )}

        {overCounted && (
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={ackMismatch}
              onChange={(e) => setAckMismatch(e.target.checked)}
            />
            <span>
              I understand the rows add up to more than the printed total — save
              anyway.
            </span>
          </label>
        )}

        {!editing && (
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0 accent-moss"
              checked={addToStock}
              onChange={(e) => setAddToStock(e.target.checked)}
            />
            {/* One span: as direct children of a flex label, the text nodes
                and <b> would each become separate flex items and break onto
                their own columns. */}
            <span>
              Add the material rows (with quantities) to <b>Stock</b> so you can
              track how much is given to labour and what's left.
            </span>
          </label>
        )}

        {!editing && (
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={alsoLedger}
              onChange={(e) => setAlsoLedger(e.target.checked)}
            />
            <span>
              Also create a ledger entry for this bill's total (leave unchecked
              if the payment is already in the ledger).
            </span>
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
  const meta = BASIS[it.basis];
  // cft carries a width too, but it needs its own four-input layout rather
  // than the two-sided area one.
  const area = meta.area && !meta.volume;
  const measureHint =
    it.basis !== "qty" && it.qty
      ? `${it.qty} ${meta.unit}${it.rate ? ` × ₹${it.rate}` : ""}`
      : "";

  return (
    <div className="card p-2 space-y-1.5">
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

      {/* What the dealer actually wrote for this row, straight from the photo —
          the only way to check a parsed size without re-reading the paper. */}
      {it.raw && (
        <div className="text-[11px] text-ink-soft money">
          on the slip: <span className="font-medium">{it.raw}</span>
        </div>
      )}

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
      ) : meta.volume ? (
        <>
          {/* Timber is quoted length-in-feet × width-in-inches × thickness-in-
              inches, so the units are spelled out on every box — mixing them up
              is a 12× error, and it is the mistake this layout exists to stop. */}
          <div className="grid grid-cols-4 gap-1.5">
            <input
              className="input !py-1.5 !text-[13px] money"
              placeholder="Len ft"
              inputMode="decimal"
              aria-label="Length in feet"
              value={it.length}
              onChange={(e) => onField({ length: e.target.value })}
            />
            <input
              className="input !py-1.5 !text-[13px] money"
              placeholder="Wide in"
              inputMode="decimal"
              aria-label="Width in inches"
              value={it.width}
              onChange={(e) => onField({ width: e.target.value })}
            />
            <input
              className="input !py-1.5 !text-[13px] money"
              placeholder="Thick in"
              inputMode="decimal"
              aria-label="Thickness in inches"
              value={it.thickness}
              onChange={(e) => onField({ thickness: e.target.value })}
            />
            <input
              className="input !py-1.5 !text-[13px] money"
              placeholder="Pcs"
              inputMode="decimal"
              aria-label="Pieces of this size"
              value={it.pieces}
              onChange={(e) => onField({ pieces: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              className="input !py-1.5 !text-[13px] money"
              placeholder={`Rate / ${meta.unit}`}
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
          <div className="text-[11px] text-ink-soft money">
            {it.qty
              ? `${it.length || "?"}ft × ${it.width || "?"}in × ${it.thickness || "?"}in` +
                `${toNum(it.pieces) && toNum(it.pieces)! > 1 ? ` × ${it.pieces} pc` : ""}` +
                ` ÷ 144 = ${it.qty} ${meta.unit}`
              : "Fill length, width and thickness to get the cubic feet."}
          </div>
        </>
      ) : (
        <>
          <div className={`grid ${area ? "grid-cols-3" : "grid-cols-2"} gap-1.5`}>
            <input
              className="input !py-1.5 !text-[13px] money"
              placeholder={area ? "Length" : `${meta.measureLabel} (${meta.unit})`}
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
              placeholder={`Rate / ${meta.unit}`}
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
