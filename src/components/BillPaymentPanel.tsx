import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { inr, todayStr, formatDate } from "../lib/format";
import { usePayers, useModes } from "../hooks/useFacets";
import {
  billBalance,
  billPayments,
  unlinkedPaid,
  recordBillPayment,
  updateBillPayment,
  deleteBillPayment,
  setUnlinkedPaid,
  linkableEntries,
  paidAfterLinking,
  linkEntryToBill,
} from "../lib/billBalance";
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
  const billId = rows[0].billId;

  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const payments = useMemo(
    () => billPayments(billId, entries ?? []),
    [billId, entries],
  );
  /** Paid before payments were records, or typed straight onto the bill. */
  const opening = useMemo(
    () => unlinkedPaid(rows, entries ?? []),
    [rows, entries],
  );

  /** entryId of the payment being corrected. */
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    amount: "",
    date: "",
    mode: "",
    paidBy: "",
  });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** Whether the unlinked opening figure is being corrected. */
  const [editingOpening, setEditingOpening] = useState(false);
  const [openingDraft, setOpeningDraft] = useState("");
  /** Whether the "which ledger entry was this?" picker is open. */
  const [linking, setLinking] = useState(false);
  const [showAllCandidates, setShowAllCandidates] = useState(false);

  const candidates = useMemo(
    () => linkableEntries(rows, entries ?? []),
    [rows, entries],
  );

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

      {/* Each payment as its own line, because that is what it is. A single
          running total cannot be corrected — there is no "the ₹30,000 payment"
          to edit, only a number that was added to. */}
      {(payments.length > 0 || opening > 0) && (
        <ul className="mt-2 divide-y divide-rule/60">
          {opening > 0 && (
            <li className="py-1.5">
              {editingOpening ? (
                <div className="flex gap-1.5 items-center">
                  <input
                    className="input !py-1 !text-[12px] money !w-28"
                    inputMode="decimal"
                    autoFocus
                    value={openingDraft}
                    onChange={(e) => setOpeningDraft(e.target.value)}
                  />
                  <button
                    className="btn btn-primary !py-1 !px-2.5 !text-[11px]"
                    onClick={() => {
                      const n = parseFloat(openingDraft);
                      void setUnlinkedPaid(billId, Number.isFinite(n) ? n : 0);
                      setEditingOpening(false);
                    }}
                  >
                    Save
                  </button>
                  <button
                    className="btn !py-1 !px-2.5 !text-[11px]"
                    onClick={() => setEditingOpening(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="min-w-0">
                    <span className="money">{inr(opening)}</span>{" "}
                    <span className="text-ink-soft">recorded earlier</span>
                    {/* "Not linked" rather than "no entry": there may well be a
                        matching entry in the ledger from before, but the link
                        was never stored and cannot honestly be invented. */}
                    <span className="block text-[10px] text-ink-soft">
                      not linked to a ledger entry
                    </span>
                  </span>
                  <button
                    className="text-[11px] underline shrink-0"
                    onClick={() => {
                      setOpeningDraft(String(opening));
                      setEditingOpening(true);
                    }}
                  >
                    edit
                  </button>
                </div>
              )}
            </li>
          )}

          {payments.map((p) => (
            <li key={p.entryId} className="py-1.5">
              {editing === p.entryId ? (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      className="input !py-1 !text-[12px] money"
                      inputMode="decimal"
                      autoFocus
                      value={editDraft.amount}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, amount: e.target.value })
                      }
                    />
                    <input
                      className="input !py-1 !text-[12px]"
                      type="date"
                      value={editDraft.date}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, date: e.target.value })
                      }
                    />
                    <select
                      className="input !py-1 !text-[12px]"
                      value={editDraft.mode}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, mode: e.target.value })
                      }
                    >
                      {modes.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                    <select
                      className="input !py-1 !text-[12px]"
                      value={editDraft.paidBy}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, paidBy: e.target.value })
                      }
                    >
                      {payers.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </div>
                  {p.sharedWithOtherBills && (
                    <div className="text-[11px] text-ink-soft">
                      This payment also settled other bills. Only its share of
                      this one changes.
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <button
                      className="btn btn-primary !py-1 !px-2.5 !text-[11px]"
                      onClick={() => {
                        const n = parseFloat(editDraft.amount);
                        if (!Number.isFinite(n) || n <= 0) return;
                        void updateBillPayment(p.entryId, billId, {
                          amount: n,
                          date: editDraft.date,
                          mode: editDraft.mode,
                          paidBy: editDraft.paidBy,
                        });
                        setEditing(null);
                      }}
                    >
                      Save
                    </button>
                    <button
                      className="btn !py-1 !px-2.5 !text-[11px]"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : confirmDelete === p.entryId ? (
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-crimson min-w-0">
                    Remove this {inr(p.amount)} payment
                    {p.sharedWithOtherBills
                      ? " from this bill?"
                      : " and its ledger entry?"}
                  </span>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      className="text-[11px] text-white bg-crimson rounded px-2 py-0.5"
                      onClick={() => {
                        void deleteBillPayment(p.entryId, billId);
                        setConfirmDelete(null);
                      }}
                    >
                      Remove
                    </button>
                    <button
                      className="text-[11px] border border-rule rounded px-2 py-0.5"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Keep
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="min-w-0">
                    <span className="money">{inr(p.amount)}</span>{" "}
                    <span className="text-ink-soft">
                      {formatDate(p.date)} · {p.mode}
                      {p.paidBy ? ` · ${p.paidBy}` : ""}
                    </span>
                    {p.sharedWithOtherBills && (
                      <span className="block text-[10px] text-ink-soft">
                        part of a {inr(p.entryAmount)} payment covering several
                        bills
                      </span>
                    )}
                  </span>
                  <span className="flex gap-2 shrink-0">
                    <button
                      className="text-[11px] underline"
                      onClick={() => {
                        setEditDraft({
                          amount: String(p.amount),
                          date: p.date,
                          mode: p.mode,
                          paidBy: p.paidBy,
                        });
                        setEditing(p.entryId);
                      }}
                    >
                      edit
                    </button>
                    <button
                      className="text-[11px] text-crimson"
                      onClick={() => setConfirmDelete(p.entryId)}
                    >
                      remove
                    </button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* The way back from money recorded in both places without either knowing
          about the other — a bill carrying a paid figure, and a ledger entry
          for the same cash. Linking names them as one payment rather than
          making anyone delete and retype either. */}
      {linking && (
        <div className="mt-2 rounded-md border border-rule bg-paper px-3 py-2 space-y-2">
          <div className="text-[12px] text-ink-soft">
            Which ledger entry was this payment? Linking it does not pay the
            bill again — it names money the bill already counts.
          </div>
          {candidates.length === 0 ? (
            <div className="text-[12px] text-ink-soft">
              No unlinked ledger entries to choose from.
            </div>
          ) : (
            <ul className="divide-y divide-rule/60">
              {(showAllCandidates ? candidates : candidates.slice(0, 5)).map(
                (c) => {
                  const after = paidAfterLinking(rows, entries ?? [], c.entry.amount);
                  return (
                    <li
                      key={c.entry.id}
                      className="py-1.5 flex items-baseline justify-between gap-2 text-[12px]"
                    >
                      <span className="min-w-0">
                        <span className="money">{inr(c.entry.amount)}</span>{" "}
                        <span className="text-ink-soft">
                          {formatDate(c.entry.date)} · {c.entry.category}
                        </span>
                        <span className="block text-[10px] text-ink-soft truncate">
                          {c.entry.event || "—"}
                          {/* Say what linking would do to the bill's figure, so
                              the one case that changes it is never a surprise. */}
                          {after !== (paid ?? 0) && (
                            <span className="text-crimson">
                              {" "}
                              · would set this bill's paid to {inr(after)}
                            </span>
                          )}
                        </span>
                      </span>
                      <button
                        className="btn !py-1 !px-2.5 !text-[11px] shrink-0"
                        onClick={() => {
                          void linkEntryToBill(c.entry.id, billId);
                          setLinking(false);
                        }}
                      >
                        link
                      </button>
                    </li>
                  );
                },
              )}
            </ul>
          )}
          <div className="flex gap-2">
            {candidates.length > 5 && !showAllCandidates && (
              <button
                className="text-[11px] underline"
                onClick={() => setShowAllCandidates(true)}
              >
                show all {candidates.length}
              </button>
            )}
            <button
              className="text-[11px] underline ml-auto"
              onClick={() => setLinking(false)}
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {!open ? (
        <div className="flex flex-wrap gap-1.5 mt-2">
          <button className="btn !py-1 !px-3 !text-[12px]" onClick={start}>
            {paid == null ? "Record a payment" : "Record another payment"}
          </button>
          {!linking && candidates.length > 0 && (
            <button
              className="btn !py-1 !px-3 !text-[12px]"
              onClick={() => {
                setShowAllCandidates(false);
                setLinking(true);
              }}
            >
              Link a ledger entry
            </button>
          )}
        </div>
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
