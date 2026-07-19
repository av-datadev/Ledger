import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useCategories } from "../hooks/useCategories";
import { inr } from "../lib/format";
import { PersonDetailsForm } from "./PersonDetailsForm";
import type { PersonDetails } from "../types";

// Custom categories sort after every built-in (mirrors CUSTOM_ORDER in db.ts).
const CUSTOM_ORDER = 1000;

/** One-line preview of the saved contact/contract details, if any. */
function detailSummary(d: PersonDetails): string {
  const bits: string[] = [];
  if (d.role) bits.push(d.role);
  if (d.phone) bits.push(d.phone);
  if (d.contractAmount != null) bits.push(inr(d.contractAmount));
  return bits.join(" · ");
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

  const stats = categories.map((cat) => ({
    cat,
    count: entries?.filter((e) => e.category === cat).length ?? 0,
    total:
      entries
        ?.filter((e) => e.category === cat)
        .reduce((s, e) => s + e.amount, 0) ?? 0,
  }));

  return (
    <div className="px-4 py-4 max-w-lg mx-auto">
      <h2 className="text-base font-semibold mb-1">People &amp; categories</h2>
      <p className="text-[13px] text-ink-soft mb-3">
        Add a new person or work type here — e.g. <b>Electrician</b> separate
        from Electrical items, <b>Painter</b> separate from Paint, or{" "}
        <b>Carpenter</b> separate from Wood. It becomes its own section
        everywhere: the Entry form, Ledger filters, BOQ, Stock and the
        Dashboard.
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

      <div className="bg-surface border border-rule rounded-md divide-y divide-rule mt-2">
        {stats.map(({ cat, count, total }) => {
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
                  {details && detailSummary(details) && (
                    <div className="text-[11px] text-ink-soft truncate mt-0.5">
                      📇 {detailSummary(details)}
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
