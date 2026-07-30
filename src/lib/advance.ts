// "Where has the money gone without paperwork behind it?"
//
// The ledger already knows two things separately: what was PAID (entries) and
// what was BILLED (BOQ invoice totals). Nothing joined them into the one number
// that matters — money handed over that no bill accounts for yet. That gap is
// how a material advance quietly turns into an overpayment: a contractor asks
// for a tonne of steel up front, delivers two quintal, and unless someone is
// holding both figures side by side there is nothing to notice.
//
// Deliberately computed from data the app already has — no new field to
// remember to tick. Every payment and every bill already carries a category, so
// the join is free and works retroactively over entries recorded months ago.

import type { Entry, BoqItem } from "../types";

export interface CoverageRow {
  category: string;
  /** Total handed over for this category (ledger entries). */
  paid: number;
  /** Total the bills account for (each bill's printed total, counted once). */
  billed: number;
  /** paid − billed. Positive = money with no bill behind it. */
  gap: number;
}

export interface CoverageSummary {
  rows: CoverageRow[];
  totalPaid: number;
  totalBilled: number;
  /** Sum of the positive gaps only — money out with no paperwork. Negative
   * gaps (bills recorded but not yet paid) are a different thing and must not
   * cancel this out, or a big unpaid bill would mask a real overpayment. */
  totalUnbacked: number;
}

/**
 * Join payments against bills, per category, worst gap first.
 *
 * `onlyCategories` limits the result to categories where bills are actually
 * expected — a labour-only contractor legitimately has payments and no
 * material bills, and flagging those would bury the real signal in noise.
 * Pass nothing to cover every category that has activity.
 */
export function materialCoverage(
  entries: Entry[],
  boqItems: BoqItem[],
  onlyCategories?: string[] | null,
): CoverageSummary {
  const allow = onlyCategories?.length ? new Set(onlyCategories) : null;

  const paidBy = new Map<string, number>();
  for (const e of entries) {
    if (allow && !allow.has(e.category)) continue;
    paidBy.set(e.category, (paidBy.get(e.category) ?? 0) + e.amount);
  }

  // A bill has one printed total spread across many rows — count each bill
  // once, keyed by its stable billId, or the total multiplies by its line count.
  const seenBills = new Map<string, { category: string; total: number }>();
  for (const it of boqItems) {
    if (allow && !allow.has(it.category)) continue;
    if (!seenBills.has(it.billId)) {
      seenBills.set(it.billId, { category: it.category, total: it.invoiceTotal });
    }
  }
  const billedBy = new Map<string, number>();
  for (const b of seenBills.values()) {
    billedBy.set(b.category, (billedBy.get(b.category) ?? 0) + b.total);
  }

  const categories = new Set([...paidBy.keys(), ...billedBy.keys()]);
  const rows: CoverageRow[] = [...categories]
    .map((category) => {
      const paid = paidBy.get(category) ?? 0;
      const billed = billedBy.get(category) ?? 0;
      return { category, paid, billed, gap: paid - billed };
    })
    .filter((r) => r.paid > 0 || r.billed > 0)
    .sort((a, b) => b.gap - a.gap);

  return {
    rows,
    totalPaid: rows.reduce((s, r) => s + r.paid, 0),
    totalBilled: rows.reduce((s, r) => s + r.billed, 0),
    totalUnbacked: rows.reduce((s, r) => s + Math.max(0, r.gap), 0),
  };
}

// ---------------------------------------------------------------------------
// Contractor side — the same question asked from the other end of the deal.
// ---------------------------------------------------------------------------

export interface SiteBalance {
  /** Money taken from the site owner. */
  received: number;
  /** Spent with a bill/photo attached to prove it. */
  spentWithProof: number;
  /** Spent, but nothing attached to show for it. */
  spentNoProof: number;
  spentTotal: number;
  /** received − spentTotal. Positive = advance still in hand to account for. */
  toAccountFor: number;
}

/**
 * A contractor's running position on one site. The mirror image of the owner's
 * coverage number: the owner asks "what did I pay that has no bill?", the
 * contractor answers "here is what I took and here is what I spent it on".
 *
 * Worth having on this side too — an honest contractor gets accused of exactly
 * the thing this proves he didn't do, and a receipts trail is his defence.
 */
export function siteBalance(
  ledger: { kind: string; amount: number; hasProof: boolean }[],
): SiteBalance {
  let received = 0;
  let spentWithProof = 0;
  let spentNoProof = 0;
  for (const row of ledger) {
    if (row.kind === "received") {
      received += row.amount;
    } else if (row.hasProof) {
      spentWithProof += row.amount;
    } else {
      spentNoProof += row.amount;
    }
  }
  const spentTotal = spentWithProof + spentNoProof;
  return {
    received,
    spentWithProof,
    spentNoProof,
    spentTotal,
    toAccountFor: received - spentTotal,
  };
}
