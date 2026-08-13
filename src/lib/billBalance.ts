// What a bill was for, what has been handed over against it, and what the
// vendor is therefore still owed.
//
// A bill has no table of its own — it is the rows sharing a `billId` — so its
// bill-level facts (`invoiceTotal`, `amountPaid`) are repeated on every row and
// read off the first one rather than summed. Summing them would multiply the
// bill by its own line count.

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
