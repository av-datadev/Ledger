import { useEffect, useState } from "react";
import { inr, todayStr } from "../lib/format";
import { usePayers, useModes } from "../hooks/useFacets";
import { billBalance, recordBillPayment } from "../lib/billBalance";
import type { BoqItem } from "../types";

/**
 * Pay a bill that is already on record.
 *
 * The review screen offers Bill only / Payment only / Both, but only at the
 * moment of saving. Choosing "Bill only" by mistake used to be final — the bill
 * existed and the money against it never reached the ledger. Paying a running
 * account in instalments had the same problem from the other direction: the
 * second payment had nowhere to go.
 *
 * Shown inside an expanded bill on the BOQ tab, next to the rows it settles.
 */
export function BillPaymentPanel({ rows }: { rows: BoqItem[] }) {
  const payers = usePayers();
  const modes = useModes();
  const { billed, paid, outstanding } = billBalance(rows);

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [mode, setMode] = useState("Cash");
  const [paidBy, setPaidBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the payer/mode to the person's own first real option, derived from
  // what they actually use, rather than a generic placeholder.
  useEffect(() => {
    setPaidBy((p) => (p && payers.includes(p) ? p : (payers[0] ?? p)));
    setMode((m) => (modes.includes(m) ? m : (modes[0] ?? m)));
  }, [payers, modes]);

  // Opening the form pre-fills what is still due, because the common case is
  // settling the rest and the figure is already on screen. On a bill that has
  // recorded nothing, everything is due — which is exactly the bill saved as
  // "Bill only" by mistake, where the whole total is what needs paying.
  const start = () => {
    setError(null);
    const due = Math.round((billed - (paid ?? 0)) * 100) / 100;
    setAmount(due > 0 ? String(due) : "");
    setDate(todayStr());
    setOpen(true);
  };

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter how much was paid.");
      return;
    }
    if (!date) {
      setError("Pick the date the money moved.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordBillPayment(rows[0].billId, {
        amount: amt,
        date,
        mode,
        paidBy,
      });
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not record that payment.",
      );
    } finally {
      setBusy(false);
    }
  };

  const entered = parseFloat(amount);
  // What the bill would stand at if this payment were recorded — shown while
  // typing, so an instalment can be checked against the paper before it is
  // committed rather than after.
  const afterwards =
    Number.isFinite(entered) && entered > 0 && billed > 0
      ? Math.round((billed - (paid ?? 0) - entered) * 100) / 100
      : null;

  return (
    <div className="px-3 py-2 border-t border-rule">
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="text-ink-soft">
          Billed <span className="money">{inr(billed)}</span>
          {paid != null && (
            <>
              {" "}
              · paid <span className="money">{inr(paid)}</span>
            </>
          )}
        </span>
        {outstanding == null ? (
          <span className="text-ink-soft">no payment recorded</span>
        ) : outstanding > 0 ? (
          <span className="money font-semibold text-crimson">
            {inr(outstanding)} still due
          </span>
        ) : outstanding === 0 ? (
          <span className="font-semibold text-moss">settled</span>
        ) : (
          <span className="money font-semibold text-crimson">
            {inr(-outstanding)} overpaid
          </span>
        )}
      </div>

      {!open ? (
        <button className="btn !py-1 !px-3 !text-[12px] mt-2" onClick={start}>
          {paid == null ? "Record a payment" : "Record another payment"}
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">Amount paid now</label>
              <input
                className="input"
                inputMode="decimal"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
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

          {afterwards != null && (
            <div
              className={`text-[12px] ${afterwards < 0 ? "text-crimson" : "text-ink-soft"}`}
            >
              {afterwards > 0 ? (
                <>
                  Leaves <span className="money">{inr(afterwards)}</span> still
                  due on this bill.
                </>
              ) : afterwards === 0 ? (
                <>This settles the bill.</>
              ) : (
                <>
                  That is <span className="money">{inr(-afterwards)}</span> more
                  than the bill — check the figure against the paper.
                </>
              )}
            </div>
          )}

          <div className="text-[11px] text-ink-soft">
            Adds a ledger entry dated the day the money moved, and counts
            towards what this bill has been paid.
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
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
