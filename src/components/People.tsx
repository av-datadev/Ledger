import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { CATEGORIES } from "../../shared/constants";
import { useCategories } from "../hooks/useCategories";
import { inr } from "../lib/format";

const BUILTIN = new Set<string>(CATEGORIES);

export function People({
  onOpenLedger,
  onNewPayment,
}: {
  onOpenLedger: (category: string) => void;
  onNewPayment: (category: string) => void;
}) {
  const categories = useCategories();
  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const boqItems = useLiveQuery(() => db.boqItems.toArray(), []);
  const stockItems = useLiveQuery(() => db.stockItems.toArray(), []);
  const custom = useLiveQuery(() => db.categories.toArray(), []);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const add = async () => {
    const trimmed = name.trim().replace(/\s+/g, " ");
    setMsg(null);
    if (!trimmed) {
      setMsg({ kind: "err", text: "Enter a name first." });
      return;
    }
    if (trimmed.length > 30) {
      setMsg({ kind: "err", text: "Keep the name under 30 characters." });
      return;
    }
    if (categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setMsg({ kind: "err", text: `"${trimmed}" already exists.` });
      return;
    }
    await db.categories.add({
      id: crypto.randomUUID(),
      name: trimmed,
      createdAt: Date.now(),
    });
    setName("");
    setMsg({
      kind: "ok",
      text: `"${trimmed}" added — it now appears in every category dropdown (Entry, Ledger, BOQ, Stock).`,
    });
  };

  const usageCount = (cat: string): number =>
    (entries?.filter((e) => e.category === cat).length ?? 0) +
    (boqItems?.filter((b) => b.category === cat).length ?? 0) +
    (stockItems?.filter((s) => s.category === cat).length ?? 0);

  const removeCustom = async (cat: string) => {
    const row = custom?.find((c) => c.name === cat);
    if (row) await db.categories.delete(row.id);
    setConfirmDelete(null);
  };

  const stats = categories.map((cat) => ({
    cat,
    isCustom: !BUILTIN.has(cat as never),
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

      <div className="bg-white border border-rule rounded-md divide-y divide-rule mt-2">
        {stats.map(({ cat, isCustom, count, total }) => (
          <div key={cat} className="px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <button
                className="min-w-0 flex-1 text-left active:bg-ink/5 rounded"
                onClick={() => onOpenLedger(cat)}
                title="Show all payments in this category"
              >
                <div className="text-sm font-medium truncate">
                  {cat}
                  {isCustom && (
                    <span className="badge ml-1.5 !text-[9px]">added by you</span>
                  )}
                </div>
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
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  className="btn !py-1 !px-2.5 !text-[12px]"
                  onClick={() => onNewPayment(cat)}
                >
                  + Payment
                </button>
                {isCustom &&
                  (confirmDelete === cat ? (
                    <span className="flex gap-1">
                      {usageCount(cat) === 0 ? (
                        <button
                          className="text-[11px] text-white bg-crimson rounded px-2 py-1"
                          onClick={() => void removeCustom(cat)}
                        >
                          Remove
                        </button>
                      ) : (
                        <span className="text-[10px] text-crimson max-w-24">
                          In use by {usageCount(cat)} record
                          {usageCount(cat) === 1 ? "" : "s"} — can't remove
                        </span>
                      )}
                      <button
                        className="text-[11px] border border-rule rounded px-2 py-1"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      className="text-crimson text-base px-1"
                      aria-label={`Remove ${cat}`}
                      onClick={() => setConfirmDelete(cat)}
                    >
                      ×
                    </button>
                  ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="text-[11px] text-ink-soft mt-3 pb-4">
        Tap a name to see its full payment list. Built-in categories can't be
        removed; ones you added can be removed only while nothing uses them.
      </div>
    </div>
  );
}
