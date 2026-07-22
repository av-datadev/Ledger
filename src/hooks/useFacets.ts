import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { PAYERS, MODES } from "../../shared/constants";

/**
 * Distinct values of an entry field (payer / mode) across the whole ledger,
 * most-used first. These lists are DATA-DERIVED — exactly like categories — so
 * a signed-in user sees their own real payers and payment modes (which live in
 * their synced entries), never the generic blank-state defaults. The generic
 * constants are used only as a fallback when there is no data yet (a fresh,
 * signed-out device), so the pickers are never empty.
 */
function useEntryFacet(
  field: "paidBy" | "mode",
  fallback: readonly string[],
): string[] {
  const rows = useLiveQuery(() => db.entries.toArray(), []);
  if (rows === undefined) return [...fallback]; // still loading — avoid empty
  const counts = new Map<string, number>();
  for (const e of rows) {
    const v = (e[field] ?? "").toString().trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size === 0) return [...fallback]; // no data — blank-state defaults
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/** Real payers from the data (most-used first); generic Owner 1–5 when blank. */
export function usePayers(): string[] {
  return useEntryFacet("paidBy", PAYERS);
}

/** Real payment modes from the data (most-used first); generic modes when blank. */
export function useModes(): string[] {
  return useEntryFacet("mode", MODES);
}
