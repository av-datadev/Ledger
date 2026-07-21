import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, renameCategory, deleteCategory } from "../db";
import { useBackClose } from "../hooks/useBackClose";
import { inr } from "../lib/format";
import { decodeQrFromFile } from "../lib/qr";
import { fileToOcrImage } from "../lib/scanImage";
import { recognizeText } from "../lib/ocr";
import { parseUpiQr, parseBankText, type ScannedBank } from "../lib/bankScan";
import {
  CONTRACT_BASES,
  basisLabel,
  basisUnit,
  amountFrom,
  sumLines,
  type ContractBasis,
} from "../lib/measure";
import type { ContractLine, PersonDetails } from "../types";

const toNum = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

// A floor-wise line while it's being edited — every field is a raw string.
type LineForm = {
  id: string;
  label: string;
  basis: string;
  area: string;
  rate: string;
  amount: string;
};

// Resolve the ₹ value of an in-progress line: lumpsum reads `amount`, a measure
// basis derives area × rate. null when the needed inputs aren't filled yet.
const lineFormAmount = (l: LineForm): number | null =>
  l.basis === "lumpsum"
    ? toNum(l.amount)
    : amountFrom(toNum(l.area), toNum(l.rate));

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
  // How much has actually been paid to this person (entries in their category).
  const paid = useLiveQuery(async () => {
    const es = await db.entries.where("category").equals(name).toArray();
    return es.reduce((s, e) => s + e.amount, 0);
  }, [name]);
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
  // Single agreed total vs a floor-wise breakdown. Start in whichever mode the
  // saved contract used.
  const [contractMode, setContractMode] = useState<"single" | "lines">(
    existing?.contractLines?.length ? "lines" : "single",
  );
  const [lines, setLines] = useState<LineForm[]>(() =>
    (existing?.contractLines ?? []).map((l) => ({
      id: l.id,
      label: l.label,
      basis: l.basis,
      area: l.area != null ? String(l.area) : "",
      rate: l.rate != null ? String(l.rate) : "",
      amount: l.amount != null ? String(l.amount) : "",
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scanBusy, setScanBusy] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const scanCameraRef = useRef<HTMLInputElement>(null);
  const scanUploadRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const setLine = (id: string, patch: Partial<LineForm>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id: string) =>
    setLines((ls) => ls.filter((l) => l.id !== id));
  const addLine = () =>
    setLines((ls) => [
      ...ls,
      {
        id: crypto.randomUUID(),
        label: "",
        // Inherit the previous line's basis (floors usually share one), else
        // default to sqft — the common case for floor-area contracts.
        basis: ls.length ? ls[ls.length - 1].basis : "sqft",
        area: "",
        rate: "",
        amount: "",
      },
    ]);

  // Fold a scanned result into the bank fields, filling only what was found so a
  // partial scan never wipes anything already typed. Returns the labels filled.
  const applyBank = (b: ScannedBank): string[] => {
    const map: [keyof ScannedBank, keyof typeof form, string][] = [
      ["bankName", "bankName", "Bank name"],
      ["accountHolder", "accountHolder", "Account holder"],
      ["accountNumber", "accountNumber", "Account number"],
      ["ifsc", "ifsc", "IFSC"],
      ["upi", "upi", "UPI"],
    ];
    const filled: string[] = [];
    setForm((f) => {
      const next = { ...f };
      for (const [src, dst, label] of map) {
        const v = b[src].trim();
        if (v) {
          next[dst] = dst === "ifsc" ? v.toUpperCase() : v;
          filled.push(label);
        }
      }
      return next;
    });
    return filled;
  };

  const onScanBank = async (file: File) => {
    setError(null);
    setScanNote(null);
    try {
      // A UPI QR carries the payee's UPI id (and often their name) directly —
      // try that first; it's instant and needs no OCR.
      setScanBusy("Looking for a QR code…");
      const qr = await decodeQrFromFile(file);
      const fromQr = qr ? parseUpiQr(qr) : null;
      if (fromQr) {
        const filled = applyBank(fromQr);
        setScanNote(`Filled from QR: ${filled.join(", ")}. Please verify.`);
        return;
      }

      // Otherwise treat it as a photo of a cheque / passbook / details slip and
      // read it on-device, same as bill scanning.
      setScanBusy("Reading the details on this phone… 0%");
      const image = await fileToOcrImage(file);
      const text = await recognizeText(image, (pct) =>
        setScanBusy(`Reading the details on this phone… ${pct}%`),
      );
      const filled = applyBank(parseBankText(text));
      setScanNote(
        filled.length
          ? `Filled: ${filled.join(", ")}. Check each against the original.`
          : "Couldn't read any bank details — try a clearer photo, or type them in.",
      );
    } catch (err) {
      console.error("Bank scan failed:", err);
      setError(
        (err instanceof Error ? err.message : "Could not read that image.") +
          " You can still enter the details manually.",
      );
    } finally {
      setScanBusy(null);
    }
  };

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

    let basis = form.contractBasis as ContractBasis;
    let area: number | null = null;
    let rate: number | null = null;
    let amount: number | null = null;
    let contractLines: ContractLine[] = [];

    if (contractMode === "lines") {
      // Floor-wise: each filled line becomes a ContractLine; the total is their
      // sum, mirrored into contractAmount so every existing consumer (the People
      // bar, backups) keeps reading a single number.
      const rows: ContractLine[] = [];
      for (const l of lines) {
        const lb = l.basis as ContractBasis;
        const la = toNum(l.area);
        const lr = toNum(l.rate);
        const lAmt = lineFormAmount(l);
        // Skip a line that's entirely blank — an empty trailing row is fine.
        const blank =
          !l.label.trim() && la == null && lr == null && toNum(l.amount) == null;
        if (blank) continue;
        if (
          (la != null && la < 0) ||
          (lr != null && lr < 0) ||
          (lAmt != null && lAmt < 0)
        ) {
          setError("Floor amounts, areas and rates must be positive numbers.");
          return;
        }
        rows.push({
          id: l.id,
          label: l.label.trim(),
          basis: lb,
          area: lb === "lumpsum" ? null : la,
          rate: lb === "lumpsum" ? null : lr,
          amount: lb === "lumpsum" ? toNum(l.amount) : lAmt,
        });
      }
      contractLines = rows;
      amount = sumLines(rows);
    } else if (basis === "lumpsum") {
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
    // In floor-wise mode the single-field trio is unused; keep it neutral.
    if (contractMode === "lines") {
      basis = "lumpsum";
      area = null;
      rate = null;
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
      contractLines,
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
      fields.contractLines.length === 0 &&
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

  // Live floor-wise total, and the contract value for whichever mode is active.
  const linesTotal = lines.reduce((s, l) => s + (lineFormAmount(l) ?? 0), 0);
  const contractVal =
    contractMode === "lines"
      ? linesTotal > 0
        ? linesTotal
        : null
      : form.contractBasis === "lumpsum"
        ? toNum(form.contractAmount)
        : amountFrom(toNum(form.contractArea), toNum(form.contractRate));

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
          {/* Single agreed total, or a floor-wise breakdown that sums to one. */}
          <div className="flex gap-1.5 mb-2">
            {(["single", "lines"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`text-[12px] rounded px-3 py-1 border ${
                  contractMode === m
                    ? "bg-ink text-paper border-ink"
                    : "border-rule text-ink-soft"
                }`}
                onClick={() => {
                  setContractMode(m);
                  // Opening an empty floor-wise contract? Seed the first line.
                  if (m === "lines" && lines.length === 0) addLine();
                }}
              >
                {m === "single" ? "Single total" : "Floor-wise"}
              </button>
            ))}
          </div>

          {contractMode === "single" ? (
            <>
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
                        Area / length (
                        {basisUnit(form.contractBasis as ContractBasis)})
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
                        amountFrom(
                          toNum(form.contractArea),
                          toNum(form.contractRate),
                        ) ?? 0,
                      )}
                    </span>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div
                  key={l.id}
                  className="rounded-md border border-rule bg-surface p-2.5"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      className="input flex-1 !py-1.5 !text-[13px]"
                      placeholder={`Floor / section ${i + 1} — e.g. Ground floor`}
                      value={l.label}
                      onChange={(e) => setLine(l.id, { label: e.target.value })}
                    />
                    <button
                      type="button"
                      className="text-ink-soft text-xl leading-none px-1.5 shrink-0"
                      aria-label="Remove this line"
                      onClick={() => removeLine(l.id)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex gap-1 flex-wrap mb-2">
                    {CONTRACT_BASES.map((b) => (
                      <button
                        key={b}
                        type="button"
                        className={`text-[11px] rounded px-2 py-0.5 border ${
                          l.basis === b
                            ? "bg-ink text-paper border-ink"
                            : "border-rule text-ink-soft"
                        }`}
                        onClick={() => setLine(l.id, { basis: b })}
                      >
                        {basisLabel(b)}
                      </button>
                    ))}
                  </div>
                  {l.basis === "lumpsum" ? (
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      className="input money !py-1.5 !text-[13px]"
                      placeholder="amount for this floor (₹)"
                      value={l.amount}
                      onChange={(e) => setLine(l.id, { amount: e.target.value })}
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        className="input money !py-1.5 !text-[13px]"
                        placeholder={`area (${basisUnit(l.basis as ContractBasis)})`}
                        value={l.area}
                        onChange={(e) => setLine(l.id, { area: e.target.value })}
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        className="input money !py-1.5 !text-[13px]"
                        placeholder={`rate / ${basisUnit(l.basis as ContractBasis)} (₹)`}
                        value={l.rate}
                        onChange={(e) => setLine(l.id, { rate: e.target.value })}
                      />
                    </div>
                  )}
                  <div className="text-[12px] text-ink-soft money mt-1.5 text-right">
                    ={" "}
                    <span className="font-semibold text-ink">
                      {inr(lineFormAmount(l) ?? 0)}
                    </span>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn w-full !py-2 !text-[13px]"
                onClick={addLine}
              >
                + Add floor / section
              </button>
              <div className="flex items-center justify-between text-[13px] pt-0.5">
                <span className="text-ink-soft">Contract total</span>
                <span className="money font-semibold">{inr(linesTotal)}</span>
              </div>
            </div>
          )}
        </div>

        {(() => {
          if (!contractVal || contractVal <= 0 || paid == null) return null;
          const balance = contractVal - paid;
          const over = balance < 0;
          const pct = Math.min(100, (paid / contractVal) * 100);
          return (
            <div className="rounded-md border border-rule bg-surface p-3">
              <div className="flex items-center justify-between text-[12px] mb-2">
                <span className="text-ink-soft">Paid so far</span>
                <span className="money font-semibold">
                  {inr(paid)}{" "}
                  <span className="text-ink-soft font-normal">
                    of {inr(contractVal)}
                  </span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-ink/10 overflow-hidden">
                <div
                  className={`h-full rounded-full ${over ? "bg-crimson" : "bg-moss"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div
                className={`text-[12px] mt-2 font-medium ${over ? "text-crimson" : "text-moss"}`}
              >
                {over
                  ? `Over contract by ${inr(-balance)}`
                  : `${inr(balance)} left to pay`}{" "}
                · {Math.round((paid / contractVal) * 100)}% settled
              </div>
            </div>
          );
        })()}

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

          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              type="button"
              className="btn !py-2 !text-[13px]"
              disabled={!!scanBusy}
              onClick={() => scanCameraRef.current?.click()}
            >
              📷 Scan QR / photo
            </button>
            <button
              type="button"
              className="btn !py-2 !text-[13px]"
              disabled={!!scanBusy}
              onClick={() => scanUploadRef.current?.click()}
            >
              Upload image
            </button>
          </div>
          <div className="text-[11px] text-ink-soft mb-2">
            Point at a UPI QR, or photograph a cheque / passbook — the fields
            below fill in automatically. Reading happens on this phone; always
            check the result before saving.
          </div>
          <input
            ref={scanCameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onScanBank(f);
              e.target.value = "";
            }}
          />
          <input
            ref={scanUploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onScanBank(f);
              e.target.value = "";
            }}
          />
          {scanBusy && (
            <div className="text-[13px] px-3 py-2 rounded-md border border-rule bg-surface text-ink-soft mb-2">
              {scanBusy}
            </div>
          )}
          {scanNote && (
            <div className="text-[13px] px-3 py-2 rounded-md border border-moss bg-moss/5 text-moss mb-2">
              {scanNote}
            </div>
          )}

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
