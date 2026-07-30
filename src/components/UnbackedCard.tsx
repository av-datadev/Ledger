import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { inr } from "../lib/format";
import { materialCoverage, type CoverageRow } from "../lib/advance";

/**
 * Money paid out that no bill accounts for yet, per payee.
 *
 * The ledger has always known both halves of this — payments on one tab, bills
 * on another — but never put them side by side, so an advance taken for
 * material nobody delivered looked exactly like an advance that was honoured.
 * This is the number that makes the two comparable at a glance.
 *
 * Shown as information, not an accusation: a labour-only payment has no bill
 * behind it and never will, which is why nothing here is styled as an error
 * until the person marks a payee as one they expect bills from.
 */
export function UnbackedCard({
  onOpenCategory,
}: {
  onOpenCategory?: (category: string) => void;
}) {
  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const boqItems = useLiveQuery(() => db.boqItems.toArray(), []);
  const [open, setOpen] = useState(false);

  const summary = useMemo(
    () => materialCoverage(entries ?? [], boqItems ?? []),
    [entries, boqItems],
  );

  // Nothing paid yet — the card would just be three zeroes.
  if (!entries?.length) return null;

  const withGap = summary.rows.filter((r) => r.gap > 0);

  return (
    <section className="px-4 pt-5">
      <h2 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-1">
        Paid vs billed
      </h2>
      <div className="text-[11px] text-ink-soft mb-3">
        Money handed over that no bill accounts for yet.
      </div>

      <div className="bg-surface border border-rule rounded-md p-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-soft">
              Paid
            </div>
            <div className="money text-[15px] font-semibold mt-0.5">
              {inr(summary.totalPaid)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-soft">
              Billed
            </div>
            <div className="money text-[15px] font-semibold mt-0.5">
              {inr(summary.totalBilled)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-soft">
              No bill
            </div>
            <div
              className={`money text-[15px] font-semibold mt-0.5 ${
                summary.totalUnbacked > 0 ? "text-crimson" : "text-moss"
              }`}
            >
              {inr(summary.totalUnbacked)}
            </div>
          </div>
        </div>

        {withGap.length > 0 && (
          <>
            <button
              type="button"
              className="w-full text-left text-[12px] text-ink-soft mt-3 pt-2.5 border-t border-rule flex items-center justify-between"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              <span>
                {withGap.length} {withGap.length === 1 ? "payee" : "payees"} with
                no bill on record
              </span>
              <span className={`transition-transform ${open ? "rotate-90" : ""}`}>
                ›
              </span>
            </button>

            {open && (
              <div className="mt-2 space-y-1.5">
                {withGap.map((r) => (
                  <GapRow key={r.category} row={r} onOpen={onOpenCategory} />
                ))}
                <p className="text-[11px] text-ink-soft pt-1.5">
                  A gap isn't proof of anything — labour and wages never have a
                  bill. It's worth a question when the payment was for material.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function GapRow({
  row,
  onOpen,
}: {
  row: CoverageRow;
  onOpen?: (category: string) => void;
}) {
  const content = (
    <>
      <div className="min-w-0">
        <div className="truncate">{row.category}</div>
        <div className="text-[11px] text-ink-soft">
          paid <span className="money">{inr(row.paid)}</span> · billed{" "}
          <span className="money">{inr(row.billed)}</span>
        </div>
      </div>
      <div className="money text-crimson shrink-0 ml-2">{inr(row.gap)}</div>
    </>
  );

  if (!onOpen) {
    return (
      <div className="flex items-start justify-between text-[13px]">{content}</div>
    );
  }
  return (
    <button
      type="button"
      className="w-full flex items-start justify-between text-[13px] text-left"
      onClick={() => onOpen(row.category)}
    >
      {content}
    </button>
  );
}
