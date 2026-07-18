import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, updateSettings } from "../db";
import { inr } from "../lib/format";

/**
 * Total-budget tracker for the dashboard: shows how much of the set budget
 * has been consumed by `spent`, with an inline editor to set/change it.
 */
export function BudgetCard({ spent }: { spent: number }) {
  const settings = useLiveQuery(() => db.settings.get("app"), []);
  const budget = settings?.budget ?? null;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const openEditor = () => {
    setValue(budget != null ? String(budget) : "");
    setEditing(true);
  };

  const save = async () => {
    const raw = value.trim();
    const next = raw === "" ? null : parseFloat(raw);
    if (next != null && !(next > 0)) return; // ignore junk; keep editor open
    await updateSettings({ budget: next });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="px-4 pt-4">
        <div className="bg-surface border border-rule rounded-md p-3">
          <label className="field-label" htmlFor="budget-input">
            Total budget (₹)
          </label>
          <input
            id="budget-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            className="input money"
            placeholder="e.g. 10000000"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
          <div className="flex gap-1.5 mt-2">
            <button
              className="btn btn-primary flex-1 !py-2 !text-[13px]"
              onClick={() => void save()}
            >
              Save
            </button>
            <button
              className="btn flex-1 !py-2 !text-[13px]"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
          <div className="text-[11px] text-ink-soft mt-2">
            Leave blank and save to clear the budget.
          </div>
        </div>
      </div>
    );
  }

  if (budget == null) {
    return (
      <div className="px-4 pt-4">
        <button
          className="w-full bg-surface border border-dashed border-rule rounded-md px-3 py-2.5 text-[13px] text-ink-soft text-left active:bg-ink/5"
          onClick={openEditor}
        >
          + Set a total budget to track how much is consumed
        </button>
      </div>
    );
  }

  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  const over = spent > budget;
  const remaining = budget - spent;

  return (
    <div className="px-4 pt-4">
      <button
        className="w-full bg-surface border border-rule rounded-md p-3 text-left active:bg-ink/5"
        onClick={openEditor}
      >
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[11px] uppercase tracking-[0.15em] text-ink-soft">
            Budget
          </span>
          <span
            className={`money text-lg font-bold ${over ? "text-crimson" : ""}`}
          >
            {Math.round(pct)}%
          </span>
        </div>
        <div className="h-2.5 bg-rule rounded-sm overflow-hidden">
          <div
            className={`h-2.5 rounded-sm ${over ? "bg-crimson" : "bg-moss"}`}
            style={{ width: `${Math.min(100, Math.round(pct))}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[11px] text-ink-soft">
          <span>
            <span className="money">{inr(spent)}</span> of{" "}
            <span className="money">{inr(budget)}</span>
          </span>
          <span className={over ? "text-crimson" : "text-moss"}>
            {over ? (
              <>
                <span className="money">{inr(-remaining)}</span> over
              </>
            ) : (
              <>
                <span className="money">{inr(remaining)}</span> left
              </>
            )}
          </span>
        </div>
      </button>
    </div>
  );
}
