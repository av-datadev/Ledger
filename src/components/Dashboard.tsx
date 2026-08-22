import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useCategories } from "../hooks/useCategories";
import { usePayers } from "../hooks/useFacets";
import { inr } from "../lib/format";
import { BudgetCard } from "./BudgetCard";
import { GivenOutCard } from "./GivenOutCard";
import { AddressCard } from "./AddressCard";
import { SyncButton } from "./SyncButton";

export function Dashboard({
  onOpenCategory,
  onOpenPayer,
  onOpenStock,
  synced = false,
}: {
  onOpenCategory: (category: string) => void;
  onOpenPayer: (payer: string) => void;
  /** Jump to the Stock tab — the card here is a summary, not the workspace. */
  onOpenStock: () => void;
  /** True once a shared household is active — gates the refresh control, which
   * has nothing to do on a device that isn't syncing. */
  synced?: boolean;
}) {
  // Computed live from Dexie on every change — never cached.
  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const categories = useCategories();
  const payers = usePayers();

  if (!entries) return null;

  const total = entries.reduce((s, e) => s + e.amount, 0);

  const byCategory = categories
    .map((cat) => ({
      cat,
      count: entries.filter((e) => e.category === cat).length,
      total: entries
        .filter((e) => e.category === cat)
        .reduce((s, e) => s + e.amount, 0),
    }))
    // Highest spend first (empty categories fall to the bottom in list order).
    .sort((a, b) => b.total - a.total);
  const maxCat = Math.max(1, ...byCategory.map((c) => c.total));

  const byPayer = payers
    .map((p) => ({
      payer: p,
      total: entries
        .filter((e) => e.paidBy === p)
        .reduce((s, e) => s + e.amount, 0),
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <div>
      <div className="sticky top-12 z-20 bg-header text-onhead px-4 pb-4 pt-1 border-b-2 border-crimson">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-onhead/55">
              Total spent · {entries.length} transactions
            </div>
            <div className="money text-4xl font-bold mt-1">{inr(total)}</div>
          </div>
          {synced && <SyncButton />}
        </div>
      </div>

      <BudgetCard spent={total} />

      {/* Paid vs billed lives on the Ledger now — its gaps are questions about
          individual payments, which is where those payments are. */}
      <AddressCard />

      <section className="px-4 pt-5">
        <h2 className="eyebrow mb-1">
          Spend by category
        </h2>
        <div className="text-[11px] text-ink-soft mb-3">
          Tap a row to see all its payments.
        </div>
        <div className="space-y-1">
          {byCategory.map(({ cat, count, total: t }) => (
            <button
              key={cat}
              className="block w-full text-left py-1 px-1 -mx-1 rounded active:bg-ink/5"
              onClick={() => onOpenCategory(cat)}
            >
              <div className="flex justify-between items-baseline text-[13px]">
                <span>
                  {cat}
                  {count > 0 && (
                    <span className="text-ink-soft text-[11px]"> · {count}</span>
                  )}
                </span>
                <span className="money text-[13px]">{inr(t)}</span>
              </div>
              <div className="h-2 bg-rule rounded-sm mt-0.5">
                <div
                  className="h-2 bg-ink-soft rounded-sm"
                  style={{ width: `${Math.round((t / maxCat) * 100)}%` }}
                />
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="px-4 pt-6">
        <h2 className="eyebrow mb-2">
          Paid by <span className="normal-case tracking-normal">(tap for details)</span>
        </h2>
        <div className="card overflow-hidden divide-y divide-rule">
          {byPayer.map(({ payer, total: t }) => (
            <button
              key={payer}
              className="w-full flex justify-between items-center px-3 py-2 text-sm text-left active:bg-ink/5"
              onClick={() => onOpenPayer(payer)}
            >
              <span>{payer}</span>
              <span className="money font-medium">{inr(t)}</span>
            </button>
          ))}
        </div>
      </section>

      <GivenOutCard onOpen={onOpenStock} />
    </div>
  );
}
