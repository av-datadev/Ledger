import { useEffect, useMemo, useState } from "react";
import { inr, formatDate, todayStr } from "../lib/format";
import { usePayers, useModes } from "../hooks/useFacets";
import { Icon } from "./Icon";
import {
  allocatePayment,
  spreadProRata,
  recordVendorSettlement,
  type VendorAccount,
} from "../lib/billBalance";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One tender line being filled in: a mode, and what moved by it. */
interface TenderDraft {
  id: string;
  mode: string;
  amount: string;
}

/**
 * Settle a dealer's bills — several at once, by more than one method.
 *
 * The case this is built for is the ordinary one that used to take two passes
 * through this form: two bills on the counter, a fifth of each paid in cash and
 * the rest transferred. Before, that meant recording one payment, re-opening
 * the form, and re-dividing the second half across the same two bills by hand,
 * with the twenty percent worked out on a calculator in between.
 *
 * Three things it does, in the order they are asked:
 *
 *  - WHICH BILLS. Everything with money owing is ticked on open, so the common
 *    case needs no taps here at all.
 *  - HOW IT WAS PAID. One tender line to start, holding the whole amount due.
 *    Adding a second fills it with the remainder, because "the rest by
 *    transfer" is how people say it.
 *  - WHERE IT LANDS. A single tender keeps the per-bill boxes it has always
 *    had. Two or more divide pro-rata and are shown read-only: asking for a
 *    figure per bill PER MODE is a grid, and a grid on a 375px phone is worse
 *    than the arithmetic it saves.
 */
export function DealerPaymentForm({
  account,
  onDone,
  onCancel,
}: {
  account: VendorAccount;
  onDone: () => void;
  onCancel: () => void;
}) {
  const payers = usePayers();
  const modes = useModes();

  const dueOf = (b: { billed: number; paid: number }) =>
    round2(b.billed - b.paid);

  /** Everything owing, or — on a fully settled account — everything. */
  const [picked, setPicked] = useState<string[]>(() => {
    const owing = account.bills.filter((b) => dueOf(b) > 0);
    return (owing.length > 0 ? owing : account.bills).map((b) => b.billId);
  });

  const [tenders, setTenders] = useState<TenderDraft[]>([
    { id: crypto.randomUUID(), mode: "Cash", amount: "" },
  ]);
  /**
   * Whether the tender amounts have been touched by hand.
   *
   * Until they have, the single line follows what is ticked — tick a third bill
   * and the amount grows to match. Once typed into, it stops: silently
   * restating somebody's deliberate figure because they changed their mind
   * about a bill is worse than a stale one they can see.
   */
  const [tendersTouched, setTendersTouched] = useState(false);

  const [date, setDate] = useState(todayStr());
  const [paidBy, setPaidBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Single tender only: how much of it goes on each bill, keyed by billId. */
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [allocTouched, setAllocTouched] = useState(false);

  // `usePayers`/`useModes` hand back a fresh array on every render, so this
  // effect runs on every render too. Every updater here therefore has to
  // return the SAME value when nothing needs changing — a `.map()` always
  // builds a new array, which React sees as a change, which renders, which
  // runs this effect again. That is an infinite loop, and it is quiet: the
  // screen looks right while the phone burns.
  useEffect(() => {
    setPaidBy((p) => (p && payers.includes(p) ? p : (payers[0] ?? p)));
    setTenders((ts) => {
      const first = ts[0];
      if (!first || modes.length === 0 || modes.includes(first.mode)) return ts;
      return [{ ...first, mode: modes[0] }, ...ts.slice(1)];
    });
  }, [payers, modes]);

  const chosen = useMemo(
    () => account.bills.filter((b) => picked.includes(b.billId)),
    [account.bills, picked],
  );
  /** What the ticked bills still owe between them. */
  const dueTotal = useMemo(
    () => round2(chosen.reduce((s, b) => s + Math.max(0, dueOf(b)), 0)),
    [chosen],
  );

  const amountOf = (t: TenderDraft) => {
    const n = parseFloat(t.amount);
    return Number.isFinite(n) && n > 0 ? round2(n) : 0;
  };
  const tendered = round2(tenders.reduce((s, t) => s + amountOf(t), 0));
  const split = tenders.length > 1;

  /** Oldest-first, as the opening suggestion — never as the final word. */
  const suggest = (amt: number, bills = chosen) => {
    const next: Record<string, string> = {};
    for (const a of allocatePayment(bills, amt)) next[a.billId] = String(a.amount);
    setAlloc(next);
  };

  // Opening position: the whole amount owing on the ticked bills, divided
  // oldest-first. Re-run while nothing has been typed over by hand.
  useEffect(() => {
    if (tendersTouched) return;
    setTenders((ts) => {
      if (ts.length !== 1) return ts;
      const next = dueTotal > 0 ? String(dueTotal) : "";
      return ts[0].amount === next ? ts : [{ ...ts[0], amount: next }];
    });
    if (!allocTouched) suggest(dueTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueTotal, tendersTouched]);

  const togglePicked = (billId: string) =>
    setPicked((p) =>
      p.includes(billId) ? p.filter((x) => x !== billId) : [...p, billId],
    );

  const setTender = (id: string, patch: Partial<TenderDraft>) => {
    if (patch.amount !== undefined) setTendersTouched(true);
    setTenders((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    // A single tender still re-divides as its amount changes, exactly as the
    // form has always done — until the division itself is edited.
    if (patch.amount !== undefined && tenders.length === 1 && !allocTouched) {
      const n = parseFloat(patch.amount);
      suggest(Number.isFinite(n) && n > 0 ? n : 0);
    }
  };

  /** "…and the rest by transfer" — the new line opens holding the remainder. */
  const addTender = () => {
    setTendersTouched(true);
    const rest = round2(dueTotal - tendered);
    const used = tenders.map((t) => t.mode);
    setTenders((ts) => [
      ...ts,
      {
        id: crypto.randomUUID(),
        mode: modes.find((m) => !used.includes(m)) ?? modes[0] ?? "Online",
        amount: rest > 0 ? String(rest) : "",
      },
    ]);
  };

  const removeTender = (id: string) =>
    setTenders((ts) => (ts.length === 1 ? ts : ts.filter((t) => t.id !== id)));

  const setBillAlloc = (billId: string, v: string) => {
    setAllocTouched(true);
    setAlloc((a) => ({ ...a, [billId]: v }));
  };

  /**
   * What each tender puts on each bill — the single source for both the
   * read-back below and what is written.
   *
   * One tender uses the per-bill boxes. Several divide pro-rata to what each
   * bill owes, so a tender that happens to be a fifth of the total lands a
   * fifth on every bill, which is what actually happened at the counter.
   */
  const placement = useMemo(
    () =>
      tenders.map((t) => ({
        tender: t,
        amount: amountOf(t),
        allocations: split
          ? spreadProRata(chosen, amountOf(t)).map((a) => ({
              billId: a.billId,
              amount: a.amount,
            }))
          : chosen.map((b) => ({
              billId: b.billId,
              amount: round2(parseFloat(alloc[b.billId]) || 0),
            })),
      })),
    [tenders, chosen, alloc, split],
  );

  const placed = round2(
    placement.reduce(
      (s, p) => s + p.allocations.reduce((x, a) => x + a.amount, 0),
      0,
    ),
  );
  const unplaced = round2(tendered - placed);

  /** Per bill: what each mode puts on it, for the read-back. */
  const perBill = chosen.map((b) => ({
    bill: b,
    due: dueOf(b),
    parts: placement
      .map((p) => ({
        mode: p.tender.mode,
        amount: p.allocations.find((a) => a.billId === b.billId)?.amount ?? 0,
      }))
      .filter((x) => x.amount > 0),
  }));

  const submit = async () => {
    if (chosen.length === 0) {
      setError("Tick at least one bill for this payment to go against.");
      return;
    }
    if (tendered <= 0) {
      setError("Enter how much was paid.");
      return;
    }
    if (!date) {
      setError("Pick the date the money moved.");
      return;
    }
    if (unplaced < -0.001) {
      setError(
        `You have placed ${inr(placed)} of a ${inr(tendered)} payment — take ${inr(round2(-unplaced))} off one of the bills.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordVendorSettlement(
        account.key,
        { date, paidBy },
        placement.map((p) => ({
          mode: p.tender.mode,
          amount: p.amount,
          allocations: p.allocations,
        })),
      );
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 pt-1">
      {/* WHICH BILLS. The account's own list is hidden while this is open, so
          the same bills are never on screen twice on a phone. */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="field-label !mb-0">Settle which bills</span>
          <button
            className="text-[11px] underline shrink-0"
            onClick={() =>
              setPicked(
                picked.length === account.bills.length
                  ? []
                  : account.bills.map((b) => b.billId),
              )
            }
          >
            {picked.length === account.bills.length ? "none" : "all"}
          </button>
        </div>
        <ul className="divide-y divide-rule/60">
          {account.bills.map((b) => {
            const on = picked.includes(b.billId);
            const due = dueOf(b);
            return (
              <li key={b.billId}>
                <button
                  className="w-full min-h-11 flex items-center gap-2.5 text-left py-1.5"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => togglePicked(b.billId)}
                >
                  <span
                    className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center ${
                      on
                        ? "bg-accent-fill border-accent-fill text-white"
                        : "border-rule-strong text-transparent"
                    }`}
                    aria-hidden="true"
                  >
                    <Icon name="check" size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-[12px] truncate">
                    <span className="text-ink-faint">{formatDate(b.date)}</span>{" "}
                    {b.label}
                  </span>
                  <span className="shrink-0 money text-[12px]">
                    {due > 0 ? (
                      <span className="text-crimson">{inr(due)} due</span>
                    ) : (
                      <span className="text-moss">paid</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="text-[11px] text-ink-faint pt-1">
          {chosen.length} of {account.bills.length} bill
          {account.bills.length === 1 ? "" : "s"} ·{" "}
          <span className="money">{inr(dueTotal)}</span> due between them
        </div>
      </div>

      {/* HOW IT WAS PAID. Cash out of a drawer and a transfer are two
          movements of money, so each gets its own line here and its own row in
          the ledger. */}
      <div>
        <span className="field-label">How it was paid</span>
        <div className="space-y-1.5">
          {tenders.map((t) => (
            // Wraps rather than crushes: at the XL text scale the page is
            // zoomed to an effective 300px, and a mode name, an amount and a
            // remove button do not fit on one line. The amount is what the
            // row is FOR, so it is the part that gets a whole line when the
            // three of them stop fitting — clipping "1,60,000" to "16" is the
            // one failure this row cannot have.
            <div key={t.id} className="flex flex-wrap items-center gap-1.5">
              <select
                className="input !w-auto min-w-0 max-w-[55%] !text-[14px]"
                value={t.mode}
                aria-label="Payment mode"
                onChange={(e) => setTender(t.id, { mode: e.target.value })}
              >
                {[...new Set([...modes, t.mode])].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                className="input money flex-1 basis-32 min-w-0 order-last"
                inputMode="decimal"
                placeholder="amount"
                aria-label={`Amount paid by ${t.mode}`}
                value={t.amount}
                onChange={(e) => setTender(t.id, { amount: e.target.value })}
              />
              {split && (
                <button
                  className="shrink-0 w-11 flex items-center justify-center text-ink-faint"
                  aria-label={`Remove the ${t.mode} line`}
                  onClick={() => removeTender(t.id)}
                >
                  <Icon name="x" size={20} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 mt-1.5">
          <button
            className="text-[12px] underline whitespace-nowrap shrink-0"
            onClick={addTender}
          >
            + another mode
          </button>
          <span className="text-[11px] text-ink-faint">
            tendered <span className="money">{inr(tendered)}</span>
            {dueTotal > 0 && (
              <>
                {" "}
                of <span className="money">{inr(dueTotal)}</span>
              </>
            )}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
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

      {/* WHERE IT LANDS. Editable on a single tender, as it has always been;
          derived and shown read-only once the payment is split, because the
          alternative is a bill-by-mode grid on a 375px screen. */}
      <div className="rounded-md border border-rule bg-paper px-3 py-2 space-y-2">
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <span className="text-ink-soft">
            {split ? "Goes onto" : "Put this payment against"}
          </span>
          {!split && (
            <button
              className="text-[11px] underline shrink-0"
              onClick={() => suggest(tendered)}
            >
              oldest first
            </button>
          )}
        </div>

        {chosen.length === 0 && (
          <div className="text-[12px] text-ink-soft">
            No bills ticked, so this would be money handed over and not placed
            against anything.
          </div>
        )}

        {perBill.map(({ bill, due, parts }) => {
          const val = alloc[bill.billId] ?? "";
          const isFull =
            (parseFloat(val) || 0) > 0 &&
            Math.abs((parseFloat(val) || 0) - due) < 0.005;
          const onThis = round2(parts.reduce((s, p) => s + p.amount, 0));
          return (
            <div key={bill.billId} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate">
                  <span className="text-ink-faint">{formatDate(bill.date)}</span>{" "}
                  {bill.label}
                </span>
                <span className="shrink-0 money text-ink-soft">
                  {due > 0 ? `${inr(due)} due` : "paid"}
                </span>
              </div>
              {split ? (
                <div className="text-[11px] text-ink-soft">
                  {parts.length > 0 ? (
                    <>
                      {parts.map((p, i) => (
                        <span key={p.mode}>
                          {i > 0 && " + "}
                          {p.mode} <span className="money">{inr(p.amount)}</span>
                        </span>
                      ))}
                      {parts.length > 1 && (
                        <>
                          {" = "}
                          <span className="money">{inr(onThis)}</span>
                        </>
                      )}
                      {due > 0 && Math.abs(onThis - due) < 0.005 && (
                        <span className="text-moss"> · settles it</span>
                      )}
                    </>
                  ) : (
                    "nothing"
                  )}
                </div>
              ) : (
                due > 0 && (
                  <div className="flex gap-1.5">
                    <button
                      className={`btn !py-1 !px-2.5 !text-[11px] ${isFull ? "btn-primary" : ""}`}
                      onClick={() =>
                        setBillAlloc(bill.billId, isFull ? "" : String(due))
                      }
                    >
                      Full
                    </button>
                    <input
                      className="input !py-1 !text-[12px] money flex-1"
                      inputMode="decimal"
                      placeholder="part…"
                      aria-label={`Amount against ${bill.label}`}
                      value={val}
                      onChange={(e) => setBillAlloc(bill.billId, e.target.value)}
                    />
                  </div>
                )
              )}
            </div>
          );
        })}

        <div className="flex items-center justify-between gap-2 text-[12px] border-t border-rule pt-1.5">
          <span className="text-ink-soft">
            Placed <span className="money">{inr(placed)}</span> of{" "}
            <span className="money">{inr(tendered)}</span>
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
        {split
          ? `Adds ${tenders.length} ledger entries — one per mode, because that is how many times money moved. Each stays editable on its own.`
          : "Adds one ledger entry for the whole payment."}{" "}
        Anything left unplaced stays as an advance with this dealer.
      </div>

      {error && <div className="text-[12px] text-crimson">{error}</div>}

      <div className="flex gap-2">
        <button
          className="btn btn-primary !py-1.5 !px-3 !text-[13px]"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : "Record payment"}
        </button>
        <button
          className="btn !py-1.5 !px-3 !text-[13px]"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
