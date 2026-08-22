import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useCategories } from "../hooks/useCategories";
import { inr } from "../lib/format";
import { contractTotal } from "../lib/measure";
import { outstandingByCategory } from "../lib/billBalance";
import { tradeCosts, personByTrade, type TradeCost } from "../lib/trades";
import { PersonDetailsForm } from "./PersonDetailsForm";
import type { PersonDetails } from "../types";

// Custom categories sort after every built-in (mirrors CUSTOM_ORDER in db.ts).
const CUSTOM_ORDER = 1000;

/** One-line preview of the saved contact/contract details, if any. */
function detailSummary(d: PersonDetails): string {
  const bits: string[] = [];
  if (d.role) bits.push(d.role);
  if (d.phone) bits.push(d.phone);
  return bits.join(" · ");
}

/** Contract value vs how much has actually been paid to this person. */
function ContractBar({
  contract,
  paid,
  floors,
}: {
  contract: number;
  paid: number;
  floors: number;
}) {
  const balance = contract - paid;
  const over = balance < 0;
  const pct = contract > 0 ? (paid / contract) * 100 : 0;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-ink-soft">
          Contract{" "}
          <span className="money text-ink font-medium">{inr(contract)}</span>
          {floors > 0 && (
            <span className="text-ink-soft">
              {" "}
              · {floors} floor{floors === 1 ? "" : "s"}
            </span>
          )}
        </span>
        <span className={over ? "text-crimson font-medium" : "text-moss font-medium"}>
          {over ? `over by ${inr(-balance)}` : `${inr(balance)} left`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-crimson" : "bg-moss"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="text-[10px] text-ink-soft mt-1">
        Paid <span className="money">{inr(paid)}</span> · {Math.round(pct)}%
        settled
      </div>
    </div>
  );
}

/**
 * What a trade is costing, once the work and the man doing it are linked.
 *
 * The two figures are already in the ledger and already correct; the only new
 * thing here is that they are finally on the same line. The split matters more
 * than the total on its own — ₹3.6 lakh of plumbing reads very differently when
 * it is 87% pipes than when it is 87% labour.
 */
function TradeCostCard({ cost }: { cost: TradeCost }) {
  const { labour, total, materialPct } = cost;
  return (
    <div className="mt-2 border-t border-rule pt-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-soft mb-1">
        {cost.trades.join(" + ")} · joined total
      </div>

      <div className="space-y-0.5 text-[12px]">
        {cost.byTrade.map((t) => (
          <div key={t.trade} className="flex justify-between">
            <span className="text-ink-soft">Material · {t.trade}</span>
            <span className="money">{inr(t.material)}</span>
          </div>
        ))}
        <div className="flex justify-between">
          <span className="text-ink-soft">Paid to {cost.person}</span>
          <span className="money">{inr(labour)}</span>
        </div>
        <div className="flex justify-between border-t border-rule pt-0.5 mt-0.5 font-semibold">
          <span>Trade total</span>
          <span className="money">{inr(total)}</span>
        </div>
      </div>

      {materialPct != null && (
        <>
          {/* One bar, two parts — the split is a proportion, and a proportion
              is read faster as a length than as a pair of percentages. */}
          <div className="flex h-1.5 rounded-full overflow-hidden mt-1.5 bg-ink/10">
            <div className="bg-ink-soft" style={{ width: `${materialPct}%` }} />
            <div className="bg-moss" style={{ width: `${100 - materialPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-ink-soft mt-0.5">
            <span>{materialPct}% material</span>
            <span>{100 - materialPct}% labour</span>
          </div>
        </>
      )}
    </div>
  );
}

export function People({
  onOpenLedger,
  onNewPayment,
}: {
  onOpenLedger: (category: string) => void;
  onNewPayment: (category: string) => void;
}) {
  const categories = useCategories();
  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const people = useLiveQuery(() => db.people.toArray(), []);
  const boqItems = useLiveQuery(() => db.boqItems.toArray(), []);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  // Name whose editor overlay is open.
  const [openDetails, setOpenDetails] = useState<string | null>(null);

  const detailsFor = (cat: string): PersonDetails | undefined =>
    people?.find((p) => p.name === cat);

  const add = async () => {
    const trimmed = name.trim().replace(/\s+/g, " ");
    setMsg(null);
    if (!trimmed) {
      setMsg({ kind: "err", text: "Enter a name first." });
      return;
    }
    if (trimmed.length > 40) {
      setMsg({ kind: "err", text: "Keep the name under 40 characters." });
      return;
    }
    if (categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setMsg({ kind: "err", text: `"${trimmed}" already exists.` });
      return;
    }
    await db.categories.add({
      id: crypto.randomUUID(),
      name: trimmed,
      order: CUSTOM_ORDER,
      createdAt: Date.now(),
    });
    setName("");
    setMsg({
      kind: "ok",
      text: `"${trimmed}" added — it now appears in every category dropdown (Entry, Ledger, BOQ, Stock).`,
    });
    // Prompt for contact/contract/bank details straight away for a new person.
    setOpenDetails(trimmed);
  };

  // What is still owed on this person's bills — money the app knows about
  // because a bill was recorded as part paid, which is exactly the figure a
  // vendor turns up asking for.
  const owed = useMemo(
    () => outstandingByCategory(boqItems ?? []),
    [boqItems],
  );

  // Linked trades, and the reverse lookup so a work row can name its person.
  const costs = useMemo(
    () => tradeCosts(people ?? [], entries ?? []),
    [people, entries],
  );
  const costFor = useMemo(
    () => new Map(costs.map((c) => [c.person, c])),
    [costs],
  );
  const doneBy = useMemo(() => personByTrade(people ?? []), [people]);

  const stats = categories.map((cat) => ({
    cat,
    count: entries?.filter((e) => e.category === cat).length ?? 0,
    total:
      entries
        ?.filter((e) => e.category === cat)
        .reduce((s, e) => s + e.amount, 0) ?? 0,
    outstanding: owed.get(cat) ?? 0,
  }));

  return (
    <div className="px-4 py-4 max-w-lg mx-auto">
      <h2 className="text-base font-semibold mb-1">People &amp; categories</h2>
      <p className="text-[13px] text-ink-soft mb-3">
        A person or work type — <b>Electrician</b> apart from Electrical items,
        <b> Painter</b> apart from Paint. Each becomes its own section
        everywhere.
      </p>

      <div className="flex gap-1.5 mb-2">
        <input
          className="input flex-1"
          placeholder="e.g. Electrician, Painter, Carpenter…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
        />
        <button className="btn btn-primary shrink-0" onClick={() => void add()}>
          + Add
        </button>
      </div>

      {msg && (
        <div
          className={`text-[13px] px-3 py-2 rounded-md border mb-3 ${
            msg.kind === "ok"
              ? "border-moss text-moss bg-moss/5"
              : "border-crimson text-crimson bg-crimson/5"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="card overflow-hidden divide-y divide-rule mt-2">
        {stats.map(({ cat, count, total, outstanding }) => {
          const details = detailsFor(cat);
          return (
            <div key={cat} className="px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  className="min-w-0 flex-1 text-left active:bg-ink/5 rounded"
                  onClick={() => onOpenLedger(cat)}
                  title="Show all payments in this category"
                >
                  <div className="text-sm font-medium truncate">{cat}</div>
                  <div className="text-[11px] text-ink-soft">
                    {count > 0 ? (
                      <>
                        {count} payment{count === 1 ? "" : "s"} ·{" "}
                        <span className="money">{inr(total)}</span>
                      </>
                    ) : (
                      "no payments yet"
                    )}
                  </div>
                  {outstanding > 0 && (
                    <div className="text-[11px] text-crimson mt-0.5">
                      <span className="money">{inr(outstanding)}</span> still due
                      on their bills
                    </div>
                  )}
                  {details && detailSummary(details) && (
                    <div className="text-[11px] text-ink-soft truncate mt-0.5">
                      📇 {detailSummary(details)}
                    </div>
                  )}
                  {/* The whole point of the link, said plainly on the row the
                      user is looking at. */}
                  {doneBy.get(cat) && (
                    <div className="text-[11px] text-ink-soft truncate mt-0.5">
                      🔗 done by <b>{doneBy.get(cat)}</b>
                    </div>
                  )}
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    className="btn !py-1 !px-2.5 !text-[12px]"
                    onClick={() => setOpenDetails(cat)}
                    title="Edit name, details and bank info"
                  >
                    Edit
                  </button>
                  <button
                    className="btn !py-1 !px-2.5 !text-[12px]"
                    onClick={() => onNewPayment(cat)}
                  >
                    + Payment
                  </button>
                </div>
              </div>
              {(() => {
                if (!details) return null;
                const contract = contractTotal(details);
                if (contract == null || contract <= 0) return null;
                return (
                  <ContractBar
                    contract={contract}
                    paid={total}
                    floors={details.contractLines?.length ?? 0}
                  />
                );
              })()}
              {costFor.has(cat) && <TradeCostCard cost={costFor.get(cat)!} />}
            </div>
          );
        })}
      </div>

      <div className="text-[11px] text-ink-soft mt-3 pb-4">
        Tap a name to see its full payment list, or <b>Edit</b> to rename it and
        record a person's phone, ID, contract and bank details. Deleting is in
        the editor — a category can be removed only once nothing uses it.
      </div>

      {openDetails && (
        <PersonDetailsForm
          name={openDetails}
          onClose={() => setOpenDetails(null)}
        />
      )}
    </div>
  );
}
