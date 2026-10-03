import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { inr, formatDate } from "../lib/format";
import { DealerPaymentForm } from "./DealerPaymentForm";
import { vendorAccounts, type VendorAccount } from "../lib/billBalance";

/**
 * What is owed to each dealer, across all of their bills.
 *
 * A dealer is not a category: "Plumbing" is what the money was for, the dealer
 * is who it is owed to. Money is handed over against the account rather than
 * against an invoice — three bills and one payment of ₹50,000 is the ordinary
 * case, not an awkward one — and the question people actually ask is "what do
 * we still owe the plumbing shop?".
 */
export function DealerAccounts() {
  const items = useLiveQuery(() => db.boqItems.toArray(), []);
  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const accounts = useMemo(
    () => vendorAccounts(items ?? [], entries ?? []),
    [items, entries],
  );
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (!items) return null;
  if (accounts.length === 0) {
    return (
      <div className="text-sm text-ink-soft text-center py-6">
        No bills recorded yet, so there is nothing owed to anyone.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {accounts.map((acc) => (
        <AccountCard
          key={acc.key}
          account={acc}
          open={openKey === acc.key}
          onToggle={() => setOpenKey(openKey === acc.key ? null : acc.key)}
        />
      ))}
    </div>
  );
}

function AccountCard({
  account,
  open,
  onToggle,
}: {
  account: VendorAccount;
  open: boolean;
  onToggle: () => void;
}) {
  const [paying, setPaying] = useState(false);

  return (
    <div className="card">
      <button
        className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left"
        onClick={onToggle}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{account.name}</div>
          <div className="text-[11px] text-ink-soft">
            {account.bills.length} bill{account.bills.length === 1 ? "" : "s"} ·
            billed <span className="money">{inr(account.billed)}</span> · paid{" "}
            <span className="money">{inr(account.paid)}</span>
          </div>
          {account.advance > 0 && (
            <div className="text-[11px] text-moss mt-0.5">
              <span className="money">{inr(account.advance)}</span> paid in
              advance, not yet against a bill
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div
            className={`money font-semibold ${
              account.outstanding > 0
                ? "text-crimson"
                : account.outstanding < 0
                  ? "text-crimson"
                  : "text-moss"
            }`}
          >
            {account.outstanding > 0
              ? inr(account.outstanding)
              : account.outstanding < 0
                ? inr(-account.outstanding)
                : "settled"}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-soft">
            {account.outstanding > 0
              ? "still to pay"
              : account.outstanding < 0
                ? "paid over"
                : "all square"}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-rule px-3 py-2 space-y-2">
          {/* Hidden while the form is open: the form has its own copy of this
              list with the bills tickable, and the same six bills twice on a
              375px screen is scrolling, not information. */}
          {!paying && (
            <>
              {/* Oldest first, because that is the order a running account
                  settles in. */}
              <ul className="divide-y divide-rule/60">
                {account.bills.map((b) => {
                  const due = Math.round((b.billed - b.paid) * 100) / 100;
                  return (
                    <li
                      key={b.billId}
                      className="py-1.5 flex items-baseline justify-between gap-2 text-[12px]"
                    >
                      <span className="min-w-0 truncate">
                        <span className="text-ink-soft">
                          {formatDate(b.date)}
                        </span>{" "}
                        {b.label}
                      </span>
                      <span className="shrink-0 money">
                        {inr(b.billed)}
                        {due <= 0 ? (
                          <span className="text-moss"> · paid</span>
                        ) : b.paid > 0 ? (
                          <span className="text-crimson"> · {inr(due)} due</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <button
                className="btn !py-1 !px-3 !text-[12px]"
                onClick={() => setPaying(true)}
              >
                Record a payment to this dealer
              </button>
            </>
          )}

          {paying && (
            <DealerPaymentForm
              account={account}
              onDone={() => setPaying(false)}
              onCancel={() => setPaying(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
