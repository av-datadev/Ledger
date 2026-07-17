import { useState } from "react";
import { db } from "../db";
import { MODES, PAYERS } from "../../shared/constants";
import { useCategories } from "../hooks/useCategories";
import { todayStr } from "../lib/format";
import type { Entry } from "../types";

interface EntryFormProps {
  /** When set, the form edits this existing entry instead of creating one. */
  initial?: Entry;
  /** Preselect a category for a new entry (from the People tab). */
  presetCategory?: string | null;
  /** Called after a successful save in edit mode. */
  onDone?: () => void;
  /** Shows a Cancel button (edit mode). */
  onCancel?: () => void;
}

const formFrom = (initial?: Entry, presetCategory?: string | null) => ({
  date: initial?.date ?? todayStr(),
  category: initial?.category ?? presetCategory ?? "Misc",
  event: initial?.event ?? "",
  detail: initial?.detail ?? "",
  amount: initial ? String(initial.amount) : "",
  mode: initial?.mode ?? "Cash",
  paidBy: initial?.paidBy ?? (PAYERS[0] as string),
  notes: initial?.notes ?? "",
});

export function EntryForm({
  initial,
  presetCategory,
  onDone,
  onCancel,
}: EntryFormProps) {
  const categories = useCategories();
  const [form, setForm] = useState(() => formFrom(initial, presetCategory));
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const editing = !!initial;

  const set = (k: keyof ReturnType<typeof formFrom>, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const errs: string[] = [];
    const amount = parseFloat(form.amount);
    if (!form.event.trim()) errs.push("Description is required.");
    if (!(amount > 0)) errs.push("Amount must be greater than zero.");
    if (!form.date) errs.push("Date is required.");
    setErrors(errs);
    if (errs.length) return;

    const fields = {
      date: form.date,
      category: form.category,
      event: form.event.trim(),
      detail: form.detail.trim(),
      amount,
      mode: form.mode,
      paidBy: form.paidBy,
      notes: form.notes.trim(),
    };

    if (editing) {
      await db.entries.update(initial.id, fields);
      onDone?.();
      return;
    }

    await db.entries.add({
      id: crypto.randomUUID(),
      ...fields,
      createdAt: Date.now(),
    });
    setForm(formFrom(undefined, presetCategory));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="px-4 py-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">
          {editing ? "Edit entry" : "New entry"}
        </h2>
        {onCancel && (
          <button className="btn !py-1.5 !px-3 !text-[13px]" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="f-date">Date</label>
            <input
              id="f-date"
              type="date"
              className="input"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="f-cat">Category</label>
            <select
              id="f-cat"
              className="input"
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {/* Keep an entry's category visible even if it was deleted. */}
              {!categories.includes(form.category) && (
                <option>{form.category}</option>
              )}
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="f-event">Description</label>
          <input
            id="f-event"
            className="input"
            placeholder="e.g. Payment to Sharik"
            value={form.event}
            onChange={(e) => set("event", e.target.value)}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="f-detail">
            Sub-vendor / detail (optional)
          </label>
          <input
            id="f-detail"
            className="input"
            placeholder="e.g. Kisan Treders"
            value={form.detail}
            onChange={(e) => set("detail", e.target.value)}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="f-amount">Amount (₹)</label>
          <input
            id="f-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            className="input money !text-2xl !font-bold !py-3"
            placeholder="0"
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="f-mode">Payment mode</label>
            <select
              id="f-mode"
              className="input"
              value={form.mode}
              onChange={(e) => set("mode", e.target.value)}
            >
              {MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="f-payer">Paid by</label>
            <select
              id="f-payer"
              className="input"
              value={form.paidBy}
              onChange={(e) => set("paidBy", e.target.value)}
            >
              {PAYERS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="f-notes">Notes (optional)</label>
          <input
            id="f-notes"
            className="input"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>

        {errors.length > 0 && (
          <ul className="text-[13px] text-crimson list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        <button
          className="btn btn-primary w-full !py-3 !text-base"
          onClick={() => void save()}
        >
          {editing ? "Save changes" : "Save entry"}
        </button>

        {saved && (
          <div className="text-center text-moss text-sm font-medium">
            ✓ Entry saved
          </div>
        )}
      </div>
    </div>
  );
}
