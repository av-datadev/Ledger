// What a bill was for, what has been handed over against it, and what the
// vendor is therefore still owed.
//
// A bill has no table of its own — it is the rows sharing a `billId` — so its
// bill-level facts (`invoiceTotal`, `amountPaid`) are repeated on every row and
// read off the first one rather than summed. Summing them would multiply the
// bill by its own line count.

import { db } from "../db";
import { inr, formatDate } from "./format";
import type { BoqItem } from "../types";

export interface BillBalance {
  billed: number;
  /** null when the bill records nothing about payment. */
  paid: number | null;
  /**
   * What is still owed, or null when there is nothing to work it out from.
   *
   * Null rather than the full total when no payment has been recorded: a bill
   * nobody has answered the question for is not the same as a bill confirmed
   * unpaid, and only the second belongs on a list of money owed. Getting this
   * wrong would announce every bill ever scanned as an outstanding debt.
   */
  outstanding: number | null;
}

export function billBalance(rows: BoqItem[]): BillBalance {
  const head = rows[0];
  const billed = head.invoiceTotal;
  const paid = head.amountPaid ?? null;
  return {
    billed,
    paid,
    outstanding:
      paid == null || billed <= 0
        ? null
        : Math.round((billed - paid) * 100) / 100,
  };
}

/**
 * Outstanding money per category, across every bill on record.
 *
 * Categories are the unit the People tab works in (each category is also the
 * person or vendor it is paid to), so a vendor's outstanding is the sum of what
 * is unpaid on their bills. Overpaid bills are not netted off against underpaid
 * ones — a negative is a mistake to look at, not credit to spend elsewhere.
 */
export function outstandingByCategory(rows: BoqItem[]): Map<string, number> {
  const bills = new Map<string, BoqItem[]>();
  for (const r of rows) {
    const arr = bills.get(r.billId) ?? [];
    arr.push(r);
    bills.set(r.billId, arr);
  }
  const out = new Map<string, number>();
  for (const billRows of bills.values()) {
    const { outstanding } = billBalance(billRows);
    if (outstanding == null || outstanding <= 0) continue;
    const cat = billRows[0].category;
    out.set(cat, Math.round(((out.get(cat) ?? 0) + outstanding) * 100) / 100);
  }
  return out;
}

/**
 * The name a bill appears under in the ledger and against stock receipts.
 * A handwritten slip has neither an invoice number nor, often, a shop name, so
 * this falls back rather than producing a blank row. Mirrors the label the
 * review screen writes when a bill is first saved, so a payment recorded later
 * lands under the same name as one recorded at save time.
 */
export function billLabel(rows: BoqItem[]): string {
  const head = rows[0];
  return (
    [head.invoiceNo.trim() && `Bill #${head.invoiceNo.trim()}`, head.vendor.trim()]
      .filter(Boolean)
      .join(" ") || `${head.category} bill — ${formatDate(head.date)}`
  );
}

/**
 * Pay a bill that already exists, in full or in part.
 *
 * The review screen can create a ledger entry at the moment a bill is saved,
 * but only then, and only if the person picked "Payment only" or "Both". Pick
 * "Bill only" by mistake — or pay a running account in instalments, which is
 * the normal way these are settled — and there was no way back: the bill sat in
 * the BOQ with money against it that the ledger never knew about.
 *
 * Two writes that have to happen together, so they share a transaction:
 *
 * - a ledger entry, because that is what the ledger, the dashboard totals and
 *   paid-vs-billed are all computed from; and
 * - `amountPaid` on **every row of the bill**, since a bill has no table of its
 *   own and its bill-level facts live repeated across its rows.
 *
 * It ADDS to what was already paid rather than replacing it. That is what makes
 * instalments work: pay ₹50,000 today and ₹30,000 next month and the bill has
 * had ₹80,000, with two ledger entries dated when the money actually moved.
 * A bill that recorded nothing (null) counts as zero paid at this point —
 * recording a payment is precisely the act of answering that question.
 */
export async function recordBillPayment(
  billId: string,
  payment: { amount: number; date: string; mode: string; paidBy: string },
): Promise<void> {
  await db.transaction("rw", [db.boqItems, db.entries], async () => {
    const rows = await db.boqItems.where("billId").equals(billId).toArray();
    if (rows.length === 0) throw new Error("That bill no longer exists.");

    const { billed, paid } = billBalance(rows);
    const nowPaid = Math.round(((paid ?? 0) + payment.amount) * 100) / 100;
    const remaining = Math.round((billed - nowPaid) * 100) / 100;
    const label = billLabel(rows);

    await db.entries.add({
      id: crypto.randomUUID(),
      // The day the money moved, which on a running account is routinely not
      // the day the bill was written.
      date: payment.date,
      category: rows[0].category,
      event: label,
      detail: rows[0].vendor.trim(),
      amount: payment.amount,
      mode: payment.mode,
      paidBy: payment.paidBy,
      // A ledger line that doesn't match the bill it came from has to explain
      // itself months later, when nobody remembers the instalment.
      notes: [
        "Payment against BOQ bill",
        billed > 0 && payment.amount !== billed
          ? `Part payment — bill total ${inr(billed)}`
          : null,
        remaining > 0 ? `Balance due ${inr(remaining)}` : null,
        remaining === 0 ? "Bill settled" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await db.boqItems
      .where("billId")
      .equals(billId)
      .modify({ amountPaid: nowPaid });
  });
}
