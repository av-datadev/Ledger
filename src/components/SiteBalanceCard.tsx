import { inr } from "../lib/format";
import type { SiteBalance } from "../lib/advance";

/**
 * The contractor's side of the "where did the money go" question.
 *
 * Same shape as the owner's Paid-vs-billed card and deliberately so: both
 * parties end up looking at the same three numbers, which is what makes a
 * disagreement about an advance settleable instead of a shouting match.
 * "To account for" is the one that matters — money taken that nothing has
 * been shown against yet.
 */
export function SiteBalanceCard({ balance }: { balance: SiteBalance }) {
  const { received, spentWithProof, spentNoProof, toAccountFor } = balance;

  return (
    <div className="bg-surface border border-rule rounded-md p-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-soft">
            Received
          </div>
          <div className="money text-[15px] font-semibold mt-0.5">
            {inr(received)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-soft">
            Spent
          </div>
          <div className="money text-[15px] font-semibold mt-0.5">
            {inr(spentWithProof + spentNoProof)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-soft">
            To account for
          </div>
          <div
            className={`money text-[15px] font-semibold mt-0.5 ${
              toAccountFor > 0 ? "text-crimson" : "text-moss"
            }`}
          >
            {inr(Math.abs(toAccountFor))}
          </div>
        </div>
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-rule text-[11px] text-ink-soft space-y-0.5">
        <div className="flex justify-between">
          <span>Spent with a bill attached</span>
          <span className="money text-moss">{inr(spentWithProof)}</span>
        </div>
        <div className="flex justify-between">
          <span>Spent with nothing attached</span>
          <span className={`money ${spentNoProof > 0 ? "text-crimson" : ""}`}>
            {inr(spentNoProof)}
          </span>
        </div>
        {toAccountFor < 0 && (
          <div className="pt-1">
            You've spent {inr(-toAccountFor)} more than you've taken — that's
            money owed to you.
          </div>
        )}
      </div>
    </div>
  );
}
