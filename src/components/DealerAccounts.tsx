import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { inr, formatDate, todayStr } from "../lib/format";
import { usePayers, useModes } from "../hooks/useFacets";
import {
  vendorAccounts,
  allocatePayment,
  recordVendorPayment,
  type VendorAccount,
} from "../lib/billBalance";

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
  const payers = usePayers();
  const modes = useModes();
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [mode, setMode] = useState("Cash");
  const [paidBy, setPaidBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPaidBy((p) => (p && payers.includes(p) ? p : (payers[0] ?? p)));
    setMode((m) => (modes.includes(m) ? m : (modes[0] ?? m)));
  }, [payers, modes]);

  /** How much of this payment goes on each bill, keyed by billId. */
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  /**
   * Whether the split has been touched by hand.
   *
   * Until it has, the suggestion follows the amount — type ₹50,000 and the
   * oldest-first split re-runs for ₹50,000. Once a bill has been ticked or
   * typed into, it stops, because silently re-splitting somebody's deliberate
   * allocation the moment they correct a typo in the amount is worse than a
   * stale suggestion.
   */
  const [allocTouched, setAllocTouched] = useState(false);

  const entered = parseFloat(amount);
  const paymentAmount = Number.isFinite(entered) && entered > 0 ? entered : 0;

  /** Oldest-first, as the opening suggestion — never as the final word. */
  const suggest = (amt: number) => {
    const next: Record<string, string> = {};
    for (const a of allocatePayment(account.bills, amt))
      next[a.billId] = String(a.amount);
    setAlloc(next);
  };

  const start = () => {
    setError(null);
    const due = account.outstanding > 0 ? account.outstanding : 0;
    setAmount(due > 0 ? String(due) : "");
    setDate(todayStr());
    suggest(due);
    setAllocTouched(false);
    setPaying(true);
  };

  /** Editing the amount re-splits it, until the split is edited by hand. */
  const onAmountChange = (v: string) => {
    setAmount(v);
    if (!allocTouched) {
      const n = parseFloat(v);
      suggest(Number.isFinite(n) && n > 0 ? n : 0);
    }
  };

  const setBillAlloc = (billId: string, v: string) => {
    setAllocTouched(true);
    setAlloc((a) => ({ ...a, [billId]: v }));
  };

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const dueOn = (b: { billed: number; paid: number }) =>
    round2(b.billed - b.paid);

  const placed = round2(
    account.bills.reduce((s, b) => s + (parseFloat(alloc[b.billId]) || 0), 0),
  );
  const unplaced = round2(paymentAmount - placed);

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter how much was paid.");
      return;
    }
    if (placed > round2(amt) + 0.001) {
      setError(
        `You have placed ${inr(placed)} of a ${inr(amt)} payment — take ${inr(round2(placed - amt))} off one of the bills.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordVendorPayment(
        account.key,
        { amount: amt, date, mode, paidBy },
        account.bills.map((b) => ({
          billId: b.billId,
          amount: parseFloat(alloc[b.billId]) || 0,
        })),
      );
      setPaying(false);
      setAlloc({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that.");
    } finally {
      setBusy(false);
    }
  };

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
          {/* Oldest first, because that is the order the money is applied in —
              seeing the list in settlement order is what makes the allocation
              below predictable rather than magic. */}
          <ul className="divide-y divide-rule/60">
            {account.bills.map((b) => {
              const due = Math.round((b.billed - b.paid) * 100) / 100;
              return (
                <li
                  key={b.billId}
                  className="py-1.5 flex items-baseline justify-between gap-2 text-[12px]"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-ink-soft">{formatDate(b.date)}</span>{" "}
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

          {!paying ? (
            <button className="btn !py-1 !px-3 !text-[12px]" onClick={start}>
              Record a payment to this dealer
            </button>
          ) : (
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label">Amount paid</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    autoFocus
                    value={amount}
                    onChange={(e) => onAmountChange(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">Date paid</label>
                  <input
                    className="input"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">Mode</label>
                  <select
                    className="input"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    {modes.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">Paid by</label>
                  <select
                    className="input"
                    value={paidBy}
                    onChange={(e) => setPaidBy(e.target.value)}
                  >
                    {payers.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Which bill this money settles is the payer's knowledge, not
                  the app's — a dealer and a customer routinely agree that a
                  particular bill is being cleared. Oldest-first is offered as
                  the opening position and nothing more. */}
              <div className="rounded-md border border-rule bg-paper px-3 py-2 space-y-2">
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-ink-soft">Put this payment against</span>
                  <button
                    className="text-[11px] underline shrink-0"
                    onClick={() => suggest(paymentAmount)}
                  >
                    oldest first
                  </button>
                </div>

                {account.bills.map((b) => {
                  const due = dueOn(b);
                  const val = alloc[b.billId] ?? "";
                  const isFull =
                    (parseFloat(val) || 0) > 0 &&
                    Math.abs((parseFloat(val) || 0) - due) < 0.005;
                  return (
                    <div key={b.billId} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 text-[12px]">
                        <span className="min-w-0 truncate">
                          <span className="text-ink-soft">
                            {formatDate(b.date)}
                          </span>{" "}
                          {b.label}
                        </span>
                        <span className="shrink-0 money text-ink-soft">
                          {due > 0 ? `${inr(due)} due` : "paid"}
                        </span>
                      </div>
                      {due > 0 && (
                        <div className="flex gap-1.5">
                          <button
                            className={`btn !py-1 !px-2.5 !text-[11px] ${isFull ? "btn-primary" : ""}`}
                            onClick={() =>
                              setBillAlloc(b.billId, isFull ? "" : String(due))
                            }
                          >
                            Full
                          </button>
                          <input
                            className="input !py-1 !text-[12px] money flex-1"
                            inputMode="decimal"
                            placeholder="part…"
                            value={val}
                            onChange={(e) => setBillAlloc(b.billId, e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="flex items-center justify-between gap-2 text-[12px] border-t border-rule pt-1.5">
                  <span className="text-ink-soft">
                    Placed <span className="money">{inr(placed)}</span> of{" "}
                    <span className="money">{inr(paymentAmount)}</span>
                  </span>
                  {unplaced > 0 ? (
                    <span className="money text-crimson shrink-0">
                      {inr(unplaced)} held as advance
                    </span>
                  ) : unplaced < 0 ? (
                    <span className="money text-crimson shrink-0">
                      {inr(-unplaced)} over the payment
                    </span>
                  ) : (
                    <span className="text-moss shrink-0">all placed</span>
                  )}
                </div>
              </div>

              <div className="text-[11px] text-ink-soft">
                Adds one ledger entry for the whole payment. Anything left
                unplaced stays as an advance with this dealer.
              </div>

              {error && <div className="text-[12px] text-crimson">{error}</div>}

              <div className="flex gap-2">
                <button
                  className="btn btn-primary !py-1 !px-3 !text-[12px]"
                  disabled={busy}
                  onClick={() => void submit()}
                >
                  {busy ? "Saving…" : "Record payment"}
                </button>
                <button
                  className="btn !py-1 !px-3 !text-[12px]"
                  disabled={busy}
                  onClick={() => setPaying(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
