// "What is the plumbing actually costing me?"
//
// The ledger has always held both halves of that answer, in separate places and
// under separate names: the pipes and fittings under the work's own category
// ("Plumbing"), the money handed to the man under his ("Vijay Plumber"). Kept
// apart on purpose — they are genuinely different kinds of spending, and mixing
// them would destroy the distinction — but nothing ever added them back up, so
// the trade's real cost was two numbers on two rows that no screen put together.
//
// Once a person is linked to the work they do, that join is free and works
// retroactively over every payment already recorded.

import type { Entry, PersonDetails } from "../types";

/** One trade's material spend, within a person's total. */
export interface TradeShare {
  trade: string;
  material: number;
}

export interface TradeCost {
  /** The person doing the work — "Vijay Plumber". */
  person: string;
  /** The work categories they hold — ["Plumbing"]. */
  trades: string[];
  /**
   * Paid to the person under their own name: labour, advances, whatever has
   * gone to the man himself.
   */
  labour: number;
  /** Spent on material, recorded under the trade categories. */
  material: number;
  /** labour + material — what this trade has cost all in. */
  total: number;
  /**
   * Material as a percentage of the total, or null when nothing has been spent
   * yet. Null rather than 0: "0% material" states that the spending so far was
   * all labour, which is a different claim from "there has been no spending".
   */
  materialPct: number | null;
  /** Per-trade material, for a person holding more than one. */
  byTrade: TradeShare[];
}

/**
 * Join each linked person to the work they do, most expensive first.
 *
 * A person with no trades linked is skipped entirely — there is nothing to
 * join, and a row reading "total = what I paid him" would dress an ordinary
 * category total up as an insight.
 */
export function tradeCosts(
  people: PersonDetails[],
  entries: Entry[],
): TradeCost[] {
  const paidTo = new Map<string, number>();
  for (const e of entries) {
    paidTo.set(e.category, (paidTo.get(e.category) ?? 0) + e.amount);
  }

  return people
    .filter((p) => (p.trades ?? []).length > 0)
    .map((p) => {
      const trades = p.trades ?? [];
      const labour = paidTo.get(p.name) ?? 0;
      const byTrade = trades.map((trade) => ({
        trade,
        material: paidTo.get(trade) ?? 0,
      }));
      const material = byTrade.reduce((s, t) => s + t.material, 0);
      const total = labour + material;
      return {
        person: p.name,
        trades,
        labour,
        material,
        total,
        materialPct: total > 0 ? Math.round((material / total) * 100) : null,
        byTrade: byTrade.sort((a, b) => b.material - a.material),
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Who handles each trade, keyed by trade name.
 *
 * Lets a trade row say "done by Vijay Plumber" without every caller walking the
 * people list itself.
 */
export function personByTrade(people: PersonDetails[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of people) {
    for (const t of p.trades ?? []) map.set(t, p.name);
  }
  return map;
}
