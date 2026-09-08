// Hiring someone out of the public directory and into the private ledger.
//
// This is the one place the two halves of the app touch, and the traffic is
// deliberately one-way: a name and a trade come IN from Supabase and become
// local Dexie rows. Nothing about the household — what was paid, to whom, how
// much is left — ever goes back out, and adding someone here does not tell
// them anything. The directory does not learn that it was read.

import { db } from "../db";
import type { PersonDetails } from "../types";

// Custom categories sort after every built-in (mirrors db.ts).
const CUSTOM_ORDER = 1000;

/** The directory fields that survive the crossing. */
export interface EngageCandidate {
  name: string;
  trade: string;
  phone: string | null;
}

export interface EngageResult {
  /** Names newly added as categories/people. */
  added: string[];
  /** Names already present, left untouched. */
  skipped: string[];
  /**
   * People added WITHOUT a trade link because someone else already holds that
   * trade. The person is still added; only the link is withheld.
   */
  tradeTaken: { name: string; trade: string; heldBy: string }[];
}

/**
 * Add directory people to this household's People list.
 *
 * A "person" in this app is a category with details attached, so each one costs
 * a `categories` row plus a `people` row — the same pair the People screen
 * creates by hand.
 *
 * The trade link is where this gets careful. `PersonDetails.trades` is
 * deliberately one-way: a person may hold several trades, but a trade may not
 * have two people, because the ledger cannot say which of two painters a
 * payment for "Painting" went to. So when the trade is already spoken for, the
 * person is still added — they are real and you will pay them — but the link is
 * withheld and reported back, rather than silently stealing the trade from
 * whoever holds it.
 */
export async function engageTeam(
  candidates: EngageCandidate[],
): Promise<EngageResult> {
  const result: EngageResult = { added: [], skipped: [], tradeTaken: [] };
  if (candidates.length === 0) return result;

  const [categories, people] = await Promise.all([
    db.categories.toArray(),
    db.people.toArray(),
  ]);

  const haveCategory = new Set(categories.map((c) => c.name.toLowerCase()));
  // trade (lowercased) -> the person already holding it
  const tradeHolder = new Map<string, string>();
  for (const p of people) {
    for (const t of p.trades ?? []) tradeHolder.set(t.toLowerCase(), p.name);
  }

  for (const cand of candidates) {
    const name = cand.name.trim();
    const trade = cand.trade.trim();
    if (!name) continue;

    if (haveCategory.has(name.toLowerCase())) {
      result.skipped.push(name);
      continue;
    }

    const now = Date.now();
    await db.categories.add({
      id: crypto.randomUUID(),
      name,
      order: CUSTOM_ORDER,
      createdAt: now,
    });

    const heldBy = trade ? tradeHolder.get(trade.toLowerCase()) : undefined;
    const linkTrade = Boolean(trade) && !heldBy;
    if (heldBy) result.tradeTaken.push({ name, trade, heldBy });

    const details: PersonDetails = {
      id: crypto.randomUUID(),
      name,
      role: trade,
      phone: cand.phone ?? "",
      idNumber: "",
      contractBasis: "lumpsum",
      contractArea: null,
      contractRate: null,
      contractAmount: null,
      contractLines: [],
      contractDetails: "",
      trades: linkTrade ? [trade] : [],
      bankName: "",
      accountHolder: "",
      accountNumber: "",
      ifsc: "",
      upi: "",
      createdAt: now,
      updatedAt: now,
    };
    await db.people.add(details);

    // Claim the trade for the rest of this batch too, so adding two painters
    // at once links the first and reports the second — the same rule applied
    // within the batch as across it.
    if (linkTrade) tradeHolder.set(trade.toLowerCase(), name);
    haveCategory.add(name.toLowerCase());
    result.added.push(name);
  }

  return result;
}
