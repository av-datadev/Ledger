import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { num, formatDate } from "../lib/format";
import { issuedByCategory } from "../lib/stock";

/**
 * Material that has actually left the store, at a glance.
 *
 * This replaces the old "stock in hand" list, which showed everything ever
 * booked in. One plumbing bill saved with "add items to stock" ticked puts
 * twenty rows into inventory at once and most of them just sit there, so that
 * list answered "what did I buy" — a question the BOQ already answers better —
 * while burying the handful of materials actually moving.
 *
 * What is asked at the end of a day is narrower: what went out, to whom, and
 * what is left. So an item appears here the moment one piece of it has been
 * given to somebody, and never before.
 */
export function GivenOutCard({ onOpen }: { onOpen?: () => void }) {
  const items = useLiveQuery(() => db.stockItems.toArray(), []);
  const moves = useLiveQuery(() => db.stockMoves.toArray(), []);
  const [openCat, setOpenCat] = useState<string | null>(null);

  const cats = useMemo(
    () => issuedByCategory(items ?? [], moves ?? []),
    [items, moves],
  );

  // Nothing has been given out yet. Silence beats a card of zeroes — until the
  // first handout there is genuinely nothing to report.
  if (cats.length === 0) return null;

  const materials = cats.reduce((s, c) => s + c.itemCount, 0);
  const everyone = new Set(cats.flatMap((c) => c.recipients));
  const lastGiven = cats.reduce<string | null>(
    (latest, c) =>
      c.lastGiven && (latest === null || c.lastGiven > latest)
        ? c.lastGiven
        : latest,
    null,
  );

  return (
    <section className="px-4 pt-6 pb-6">
      <h2 className="eyebrow mb-1">Given out · what's left</h2>
      <div className="text-[11px] text-ink-soft mb-2">
        {/* Deliberately no total quantity across materials: these are counted
            in pieces, bags, kilos and litres at once, so one number spanning
            them would be arithmetic without a meaning. */}
        <b>{materials}</b> material{materials === 1 ? "" : "s"} handed to{" "}
        <b>{everyone.size}</b> {everyone.size === 1 ? "person" : "people"}
        {lastGiven && <> · last on {formatDate(lastGiven)}</>}
      </div>

      <div className="card overflow-hidden divide-y divide-rule">
        {cats.map((c) => {
          const open = openCat === c.category;
          return (
            <div key={c.category}>
              <button
                className="w-full flex justify-between items-center px-3 py-2 text-left active:bg-ink/5"
                onClick={() => setOpenCat(open ? null : c.category)}
                aria-expanded={open}
              >
                <span className="min-w-0">
                  <span className="text-sm font-medium">{c.category}</span>
                  <span className="block text-[10px] text-ink-soft truncate">
                    {c.recipients.join(", ")}
                    {c.lastGiven && <> · last {formatDate(c.lastGiven)}</>}
                  </span>
                </span>
                <span className="shrink-0 flex items-center gap-2">
                  <span className="money text-sm font-semibold">
                    {c.itemCount}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-ink-soft">
                    item{c.itemCount === 1 ? "" : "s"} out
                  </span>
                  <span className="text-ink-soft text-[11px]">
                    {open ? "▾" : "▸"}
                  </span>
                </span>
              </button>

              {open && (
                <div className="px-3 pb-2">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 text-[10px] uppercase tracking-wider text-ink-soft py-1 border-b border-rule">
                    <span>Item</span>
                    <span className="text-right">Bought</span>
                    <span className="text-right">Given</span>
                    <span className="text-right">Left</span>
                  </div>
                  {c.items.map((it) => (
                    <div
                      key={it.id}
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 items-baseline text-[12px] py-1 border-b border-rule/50 last:border-0"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{it.name}</span>
                        <span className="block text-[10px] text-ink-soft truncate">
                          {it.recipients.join(", ")}
                          {it.lastGiven && <> · {formatDate(it.lastGiven)}</>}
                        </span>
                      </span>
                      <span className="money text-right tabular-nums">
                        {num(it.purchased)}
                      </span>
                      <span className="money text-right tabular-nums text-crimson">
                        {num(it.given)}
                      </span>
                      {/* Negative means more has gone out than was ever booked
                          in — a real state (a receipt not yet entered, or a
                          quantity mistyped), and one worth showing rather than
                          clamping to zero. */}
                      <span
                        className={`money text-right tabular-nums font-semibold ${
                          it.left < 0
                            ? "text-crimson"
                            : it.left === 0
                              ? "text-ink-soft"
                              : "text-moss"
                        }`}
                      >
                        {num(it.left)}
                        {it.unit && (
                          <span className="text-[9px] font-normal"> {it.unit}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {onOpen && (
        <button className="text-[11px] text-ink-soft mt-1 underline" onClick={onOpen}>
          See it day by day in the Stock tab
        </button>
      )}
    </section>
  );
}
