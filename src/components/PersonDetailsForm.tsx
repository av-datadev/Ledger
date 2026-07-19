import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, renameCategory, deleteCategory } from "../db";
import { useBackClose } from "../hooks/useBackClose";
import { inr } from "../lib/format";
import {
  CONTRACT_BASES,
  basisLabel,
  basisUnit,
  amountFrom,
  type ContractBasis,
} from "../lib/measure";
import type { PersonDetails } from "../types";

const toNum = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

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
  const categories = useLiveQuery(() => db.categories.toArray(), []);
  // How many records reference this category — deleting it would orphan them.
  const usage = useLiveQuery(async () => {
    const [e, b, s] = await Promise.all([
      db.entries.where("category").equals(name).count(),
      db.boqItems.where("category").equals(name).count(),
      db.stockItems.where("category").equals(name).count(),
    ]);
    return e + b + s;
  }, [name]);

  const [form, setForm] = useState(() => ({
    name,
    role: existing?.role ?? "",
    phone: existing?.phone ?? "",
    idNumber: existing?.idNumber ?? "",
    contractBasis: (existing?.contractBasis ?? "lumpsum") as string,
    contractArea:
      existing?.contractArea != null ? String(existing.contractArea) : "",
    contractRate:
      existing?.contractRate != null ? String(existing.contractRate) : "",
    contractAmount:
      existing?.contractAmount != null ? String(existing.contractAmount) : "",
    contractDetails: existing?.contractDetails ?? "",
    bankName: existing?.bankName ?? "",
    accountHolder: existing?.accountHolder ?? "",
    accountNumber: existing?.accountNumber ?? "",
    ifsc: existing?.ifsc ?? "",
    upi: existing?.upi ?? "",
  }));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setError(null);
    const nextName = form.name.trim().replace(/\s+/g, " ");
    if (!nextName) {
      setError("Name can't be empty.");
      return;
    }
    if (nextName.length > 40) {
      setError("Keep the name under 40 characters.");
      return;
    }
    const clash = (categories ?? []).some(
      (c) =>
        c.name.toLowerCase() === nextName.toLowerCase() &&
        c.name.toLowerCase() !== name.toLowerCase(),
    );
    if (clash) {
      setError(`"${nextName}" already exists.`);
      return;
    }

    const basis = form.contractBasis as ContractBasis;
    let area: number | null = null;
    let rate: number | null = null;
    let amount: number | null = null;
    if (basis === "lumpsum") {
      const raw = form.contractAmount.trim();
      if (raw !== "") {
        amount = parseFloat(raw);
        if (!(amount >= 0)) {
          setError("Contract amount must be a number (or leave it blank).");
          return;
        }
      }
    } else {
      area = toNum(form.contractArea);
      rate = toNum(form.contractRate);
      if ((area != null && area < 0) || (rate != null && rate < 0)) {
        setError("Area and rate must be positive numbers.");
        return;
      }
      amount = amountFrom(area, rate);
    }

    // Rename the category everywhere first, so details attach to the new name.
    if (nextName !== name) await renameCategory(name, nextName);

    const now = Date.now();
    const fields = {
      role: form.role.trim(),
      phone: form.phone.trim(),
      idNumber: form.idNumber.trim(),
      contractBasis: basis,
      contractArea: area,
      contractRate: rate,
      contractAmount: amount,
      contractDetails: form.contractDetails.trim(),
      bankName: form.bankName.trim(),
      accountHolder: form.accountHolder.trim(),
      accountNumber: form.accountNumber.trim(),
      ifsc: form.ifsc.trim().toUpperCase(),
      upi: form.upi.trim(),
      updatedAt: now,
    };
    const isEmpty =
      !fields.role &&
      !fields.phone &&
      !fields.idNumber &&
      fields.contractAmount == null &&
      !fields.contractDetails &&
      !fields.bankName &&
      !fields.accountHolder &&
      !fields.accountNumber &&
      !fields.ifsc &&
      !fields.upi;

    // After a rename, renameCategory has already moved any existing details row
    // to the new name — look it up fresh.
    const current = await db.people.where("name").equals(nextName).first();
    if (current) {
      if (isEmpty) await db.people.delete(current.id);
      else await db.people.update(current.id, fields);
    } else if (!isEmpty) {
      await db.people.add({
        id: crypto.randomUUID(),
        name: nextName,
        ...fields,
        createdAt: now,
      });
    }
    requestClose();
  };

  const remove = async () => {
    if (usage && usage > 0) return; // guarded by the message below
    await deleteCategory(name);
    requestClose();
  };

  return (
    <div className="px-4 py-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold truncate">Edit</h2>
        <button
          className="btn !py-1.5 !px-3 !text-[13px]"
          onClick={requestClose}
        >
          Cancel
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="field-label" htmlFor="p-name">
            Name
          </label>
          <input
            id="p-name"
            className="input"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="p-role">
            Role / type
          </label>
          <input
            id="p-role"
            className="input"
            list="role-options"
            placeholder="Pick one or type your own"
            value={form.role}
            onChange={(e) => set("role", e.target.value)}
          />
          <datalist id="role-options">
            {ROLES.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
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
          <label className="field-label">Contract pricing</label>
          <div className="flex gap-1.5 flex-wrap mb-2">
            {CONTRACT_BASES.map((b) => (
              <button
                key={b}
                type="button"
                className={`text-[12px] rounded px-2.5 py-1 border ${
                  form.contractBasis === b
                    ? "bg-ink text-paper border-ink"
                    : "border-rule text-ink-soft"
                }`}
                onClick={() => set("contractBasis", b)}
              >
                {basisLabel(b)}
              </button>
            ))}
          </div>
          {form.contractBasis === "lumpsum" ? (
            <input
              id="p-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              className="input money"
              placeholder="agreed final price (₹)"
              value={form.contractAmount}
              onChange={(e) => set("contractAmount", e.target.value)}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label" htmlFor="p-area">
                    Area / length ({basisUnit(form.contractBasis as ContractBasis)})
                  </label>
                  <input
                    id="p-area"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    className="input money"
                    placeholder="e.g. 2000"
                    value={form.contractArea}
                    onChange={(e) => set("contractArea", e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="p-rate">
                    Rate / {basisUnit(form.contractBasis as ContractBasis)} (₹)
                  </label>
                  <input
                    id="p-rate"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    className="input money"
                    placeholder="e.g. 1200"
                    value={form.contractRate}
                    onChange={(e) => set("contractRate", e.target.value)}
                  />
                </div>
              </div>
              <div className="text-[13px] text-ink-soft money mt-1.5">
                Contract ={" "}
                <span className="font-semibold text-ink">
                  {inr(
                    amountFrom(toNum(form.contractArea), toNum(form.contractRate)) ??
                      0,
                  )}
                </span>
              </div>
            </>
          )}
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

        <div className="pt-1">
          <div className="text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-2">
            Bank details
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="p-bank">
                  Bank name
                </label>
                <input
                  id="p-bank"
                  className="input"
                  placeholder="e.g. SBI"
                  value={form.bankName}
                  onChange={(e) => set("bankName", e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="p-holder">
                  Account holder
                </label>
                <input
                  id="p-holder"
                  className="input"
                  placeholder="name on account"
                  value={form.accountHolder}
                  onChange={(e) => set("accountHolder", e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="p-acct">
                Account number
              </label>
              <input
                id="p-acct"
                inputMode="numeric"
                className="input"
                placeholder="account number"
                value={form.accountNumber}
                onChange={(e) => set("accountNumber", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="p-ifsc">
                  IFSC code
                </label>
                <input
                  id="p-ifsc"
                  className="input uppercase"
                  placeholder="e.g. SBIN0001234"
                  value={form.ifsc}
                  onChange={(e) => set("ifsc", e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="p-upi">
                  UPI ID
                </label>
                <input
                  id="p-upi"
                  className="input"
                  placeholder="name@upi"
                  value={form.upi}
                  onChange={(e) => set("upi", e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {error && <div className="text-[13px] text-crimson">{error}</div>}

        <button
          className="btn btn-primary w-full !py-3 !text-base"
          onClick={() => void save()}
        >
          Save
        </button>

        {/* Delete lives here now instead of an inline × on the list. */}
        <div className="pt-2 border-t border-rule mt-2">
          {usage && usage > 0 ? (
            <div className="text-[12px] text-ink-soft">
              In use by {usage} record{usage === 1 ? "" : "s"} — rename it or
              reassign those payments before it can be deleted.
            </div>
          ) : confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-crimson flex-1">
                Delete "{name}"?
              </span>
              <button
                className="text-[13px] text-white bg-crimson rounded px-3 py-1.5"
                onClick={() => void remove()}
              >
                Delete
              </button>
              <button
                className="text-[13px] border border-rule rounded px-3 py-1.5"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              className="text-[13px] text-crimson"
              onClick={() => setConfirmDelete(true)}
            >
              Delete this category
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Full-screen editor for a category/person: rename, contact & contract details,
 * bank details, and delete. Loads any existing details row (by name) once.
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
