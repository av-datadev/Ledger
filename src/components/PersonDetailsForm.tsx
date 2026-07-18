import { useEffect, useState } from "react";
import { db } from "../db";
import { useBackClose } from "../hooks/useBackClose";
import type { PersonDetails } from "../types";

const ROLES = [
  "Contractor",
  "Labour",
  "Mason",
  "Electrician",
  "Plumber",
  "Painter",
  "Carpenter",
  "Supplier",
  "Other",
];

function Fields({
  name,
  existing,
  requestClose,
}: {
  name: string;
  existing: PersonDetails | null;
  requestClose: () => void;
}) {
  const [form, setForm] = useState(() => ({
    role: existing?.role ?? "",
    phone: existing?.phone ?? "",
    idNumber: existing?.idNumber ?? "",
    contractAmount:
      existing?.contractAmount != null ? String(existing.contractAmount) : "",
    contractDetails: existing?.contractDetails ?? "",
  }));
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const raw = form.contractAmount.trim();
    let amount: number | null = null;
    if (raw !== "") {
      amount = parseFloat(raw);
      if (!(amount >= 0)) {
        setError("Contract amount must be a number (or leave it blank).");
        return;
      }
    }
    const now = Date.now();
    const fields = {
      role: form.role.trim(),
      phone: form.phone.trim(),
      idNumber: form.idNumber.trim(),
      contractAmount: amount,
      contractDetails: form.contractDetails.trim(),
      updatedAt: now,
    };
    // Nothing filled in — don't leave an empty record around (keeps the
    // "+ Details" vs "Details" button honest).
    const isEmpty =
      !fields.role &&
      !fields.phone &&
      !fields.idNumber &&
      fields.contractAmount == null &&
      !fields.contractDetails;
    if (existing) {
      if (isEmpty) await db.people.delete(existing.id);
      else await db.people.update(existing.id, fields);
    } else if (!isEmpty) {
      await db.people.add({
        id: crypto.randomUUID(),
        name,
        ...fields,
        createdAt: now,
      });
    }
    requestClose();
  };

  return (
    <div className="px-4 py-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold truncate">
          {name} — details
        </h2>
        <button
          className="btn !py-1.5 !px-3 !text-[13px]"
          onClick={requestClose}
        >
          Cancel
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="field-label" htmlFor="p-role">
            Role / type
          </label>
          <select
            id="p-role"
            className="input"
            value={form.role}
            onChange={(e) => set("role", e.target.value)}
          >
            <option value="">— select —</option>
            {/* Keep a saved custom role visible even if it's not in the list. */}
            {form.role && !ROLES.includes(form.role) && (
              <option value={form.role}>{form.role}</option>
            )}
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="p-phone">
              Phone number
            </label>
            <input
              id="p-phone"
              type="tel"
              inputMode="tel"
              className="input"
              placeholder="e.g. 98xxxxxxxx"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="p-id">
              ID number
            </label>
            <input
              id="p-id"
              className="input"
              placeholder="Aadhaar / PAN"
              value={form.idNumber}
              onChange={(e) => set("idNumber", e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="p-amount">
            Contract amount (₹)
          </label>
          <input
            id="p-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            className="input money"
            placeholder="agreed final price"
            value={form.contractAmount}
            onChange={(e) => set("contractAmount", e.target.value)}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="p-details">
            Contract details (optional)
          </label>
          <textarea
            id="p-details"
            className="input min-h-24"
            placeholder="Scope of work, terms, advance paid, deadlines, anything else…"
            value={form.contractDetails}
            onChange={(e) => set("contractDetails", e.target.value)}
          />
        </div>

        {error && <div className="text-[13px] text-crimson">{error}</div>}

        <button
          className="btn btn-primary w-full !py-3 !text-base"
          onClick={() => void save()}
        >
          Save details
        </button>
      </div>
    </div>
  );
}

/**
 * Full-screen overlay to view/edit contact & contract details for a person.
 * Loads any existing row (by name) once, then renders the form.
 */
export function PersonDetailsForm({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const requestClose = useBackClose(true, onClose);
  // undefined = still loading; null = no saved details yet; row = found.
  const [existing, setExisting] = useState<PersonDetails | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let alive = true;
    db.people
      .where("name")
      .equals(name)
      .first()
      .then((r) => {
        if (alive) setExisting(r ?? null);
      });
    return () => {
      alive = false;
    };
  }, [name]);

  return (
    <div className="fixed inset-0 z-40 bg-paper overflow-y-auto">
      {existing === undefined ? (
        <div className="px-4 py-6 text-sm text-ink-soft">Loading…</div>
      ) : (
        <Fields name={name} existing={existing} requestClose={requestClose} />
      )}
    </div>
  );
}
