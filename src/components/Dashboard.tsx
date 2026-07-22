import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useCategories } from "../hooks/useCategories";
import { usePayers } from "../hooks/useFacets";
import { inr, num } from "../lib/format";
import { withBalances } from "../lib/stock";
import { BudgetCard } from "./BudgetCard";
import { AddressCard } from "./AddressCard";

export function Dashboard({
  onOpenCategory,
  onOpenPayer,
}: {
  onOpenCategory: (category: string) => void;
  onOpenPayer: (payer: string) => void;
}) {
  // Computed live from Dexie on every change — never cached.
  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const stockItems = useLiveQuery(() => db.stockItems.toArray(), []);
  const stockMoves = useLiveQuery(() => db.stockMoves.toArray(), []);
  const categories = useCategories();
  const payers = usePayers();

  if (!entries) return null;

  const stock =
    stockItems && stockMoves ? withBalances(stockItems, stockMoves) : [];
  const openStock = stock.filter((s) => !s.done);

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
        <div className="text-[10px] uppercase tracking-[0.2em] text-[#8fa1b0]">
          Total spent · {entries.length} transactions
        </div>
        <div className="money text-4xl font-bold mt-1">{inr(total)}</div>
      </div>

      <BudgetCard spent={total} />

      <AddressCard />

      <section className="px-4 pt-5">
        <h2 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-1">
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
        <h2 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-2">
          Paid by <span className="normal-case tracking-normal">(tap for details)</span>
        </h2>
        <div className="bg-surface border border-rule rounded-md divide-y divide-rule">
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

      {openStock.length > 0 && (
        <section className="px-4 pt-6 pb-6">
          <h2 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-2">
            Stock in hand ({openStock.length} materials)
          </h2>
          <div className="bg-surface border border-rule rounded-md divide-y divide-rule">
            {openStock
              .filter((s) => s.balance !== 0)
              .sort((a, b) => a.category.localeCompare(b.category))
              .slice(0, 8)
              .map((s) => (
                <div
                  key={s.id}
                  className="flex justify-between items-center px-3 py-1.5 text-[13px]"
                >
                  <span className="truncate mr-2">
                    <span className="badge mr-1.5">{s.category}</span>
                    {s.name}
                  </span>
                  <span
                    className={`money font-medium shrink-0 ${s.balance < 0 ? "text-crimson" : "text-moss"}`}
                  >
                    {num(s.balance)} {s.unit}
                  </span>
                </div>
              ))}
          </div>
          <div className="text-[11px] text-ink-soft mt-1">
            Full list and give-out tracking in the Stock tab.
          </div>
        </section>
      )}
      {openStock.length === 0 && <div className="pb-6" />}
    </div>
  );
}
