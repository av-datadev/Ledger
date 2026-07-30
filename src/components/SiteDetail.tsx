import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { inr, todayStr, formatDate } from "../lib/format";
import {
  addLedgerRow,
  deleteLedgerRow,
  deleteSite,
  updateSite,
  balanceOf,
  markRowShared,
  LEDGER_KINDS,
} from "../lib/sites";
import { addSharedEntry } from "../lib/siteLink";
import { SiteBalanceCard } from "./SiteBalanceCard";
import { SiteLinkPanel } from "./SiteLinkPanel";
import type { ContractorSite, SiteLedgerRow } from "../types";

const KIND_LABEL = Object.fromEntries(
  LEDGER_KINDS.map((k) => [k.value, k.label]),
) as Record<SiteLedgerRow["kind"], string>;

export function SiteDetail({
  site,
  onBack,
}: {
  site: ContractorSite;
  onBack: () => void;
}) {
  const rows = useLiveQuery(
    () => db.siteLedger.where("siteId").equals(site.id).toArray(),
    [site.id],
  );
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);

  const sorted = (rows ?? [])
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const balance = balanceOf(rows ?? []);

  return (
    <div className="px-4 py-4 max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button className="btn !py-1.5 !px-3 !text-[13px]" onClick={onBack}>
          ‹ Sites
        </button>
        <button
          className="btn !py-1.5 !px-3 !text-[13px]"
          onClick={() =>
            void updateSite(site.id, {
              status: site.status === "active" ? "done" : "active",
            })
          }
        >
          {site.status === "active" ? "Mark done" : "Reopen"}
        </button>
      </div>

      <div>
        <h2 className="text-base font-semibold">{site.name}</h2>
        <div className="text-[12px] text-ink-soft">
          {site.ownerName}
          {site.ownerPhone && (
            <>
              {" · "}
              <a href={`tel:${site.ownerPhone}`} className="underline">
                {site.ownerPhone}
              </a>
            </>
          )}
        </div>
        {site.address && (
          <div className="text-[12px] text-ink-soft">{site.address}</div>
        )}
        {site.contractAmount != null && (
          <div className="text-[12px] text-ink-soft mt-1">
            Contract: <span className="money">{inr(site.contractAmount)}</span>
          </div>
        )}
      </div>

      <SiteBalanceCard balance={balance} />

      <SiteLinkPanel site={site} />

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="eyebrow">
            Money log
          </h3>
          <button
            className="btn !py-1.5 !px-3 !text-[13px]"
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? "Cancel" : "+ Add"}
          </button>
        </div>

        {adding && (
          <AddRowForm
            siteId={site.id}
            onDone={() => setAdding(false)}
          />
        )}

        {sorted.length === 0 && !adding && (
          <div className="text-[13px] text-ink-soft">
            Nothing logged yet. Record what you take from the owner and what you
            spend, and attach the bill each time — that record is what settles an
            argument later.
          </div>
        )}

        <div className="space-y-1.5 mt-2">
          {sorted.map((r) => (
            <LedgerRowCard
              key={r.id}
              row={r}
              onView={setViewer}
              linkId={site.linkStatus === "approved" ? site.linkId : null}
            />
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-rule">
        {confirmDelete ? (
          <div className="space-y-2">
            <p className="text-[13px] text-crimson">
              Delete this site and all {sorted.length} logged rows? This can't be
              undone.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn !py-2 !text-[13px]"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </button>
              <button
                className="btn btn-primary !py-2 !text-[13px]"
                onClick={() => {
                  void deleteSite(site.id).then(onBack);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <button
            className="text-[12px] text-crimson underline"
            onClick={() => setConfirmDelete(true)}
          >
            Delete this site
          </button>
        )}
      </div>

      {viewer && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setViewer(null)}
        >
          <img src={viewer} alt="Bill" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  );
}

function LedgerRowCard({
  row,
  onView,
  linkId,
}: {
  row: SiteLedgerRow;
  onView: (url: string) => void;
  /** Set when this site is linked and approved — enables sharing a row up. */
  linkId: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareErr, setShareErr] = useState<string | null>(null);
  useEffect(() => {
    if (!row.proof) return;
    const u = URL.createObjectURL(row.proof);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [row.proof]);

  const isIn = row.kind === "received";

  /**
   * Push a row he's already logged — bill photo and all — up to the shared
   * ledger, rather than making him type it a second time. Sharing stays
   * per-row and opt-in: his margins and his other sites are nobody's business.
   */
  const share = async () => {
    if (!linkId) return;
    setSharing(true);
    setShareErr(null);
    try {
      const shared = await addSharedEntry({
        linkId,
        authorRole: "contractor",
        date: row.date,
        kind: isIn ? "payment" : "spend",
        description: row.description || KIND_LABEL[row.kind],
        amount: row.amount,
        notes: row.notes,
        proof: row.proof,
      });
      await markRowShared(row.id, shared.id);
    } catch (err) {
      setShareErr(err instanceof Error ? err.message : "Could not share that.");
    } finally {
      setSharing(false);
    }
  };
  return (
    <div className="card p-2.5 flex gap-2.5">
      {url ? (
        <button
          type="button"
          className="w-12 h-12 shrink-0 rounded overflow-hidden border border-rule"
          onClick={() => onView(url)}
          aria-label="View the attached bill"
        >
          <img src={url} alt="" className="w-full h-full object-cover" />
        </button>
      ) : isIn ? (
        // Money coming in has nothing to prove — the placeholder only makes
        // sense against a spend, which is what the form asks for a bill on.
        <div className="w-12 h-12 shrink-0 rounded border border-dashed border-rule grid place-items-center text-moss text-lg">
          ₹
        </div>
      ) : (
        <div
          className="w-12 h-12 shrink-0 rounded border border-dashed border-rule grid place-items-center text-[9px] text-crimson text-center leading-tight px-1"
          title="No bill attached to this spend"
        >
          No bill
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2">
          <span className="text-[13px] truncate">
            {row.description || KIND_LABEL[row.kind]}
          </span>
          <span
            className={`money text-[13px] shrink-0 ${isIn ? "text-moss" : ""}`}
          >
            {isIn ? "+" : "−"}
            {inr(row.amount)}
          </span>
        </div>
        <div className="text-[11px] text-ink-soft">
          {formatDate(row.date)} · {KIND_LABEL[row.kind]}
        </div>
        {row.notes && (
          <div className="text-[11px] text-ink-soft mt-0.5">{row.notes}</div>
        )}

        {linkId && (
          <div className="mt-1">
            {row.sharedId ? (
              <span className="text-[11px] text-moss">✓ owner can see this</span>
            ) : (
              <button
                type="button"
                className="text-[11px] underline text-ink-soft"
                disabled={sharing}
                onClick={() => void share()}
              >
                {sharing ? "Sharing…" : "Show this to the owner"}
              </button>
            )}
            {shareErr && (
              <div className="text-[11px] text-crimson mt-0.5">{shareErr}</div>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className="text-ink-soft text-lg leading-none shrink-0 self-start"
        aria-label="Delete this row"
        onClick={() => void deleteLedgerRow(row.id)}
      >
        ×
      </button>
    </div>
  );
}

function AddRowForm({
  siteId,
  onDone,
}: {
  siteId: string;
  onDone: () => void;
}) {
  const [date, setDate] = useState(todayStr());
  const [kind, setKind] = useState<SiteLedgerRow["kind"]>("received");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isSpend = kind !== "received";

  const save = async () => {
    const value = parseFloat(amount);
    if (!(value > 0)) {
      setError("Amount must be greater than zero.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await addLedgerRow({
        siteId,
        date,
        kind,
        description: description.trim(),
        amount: value,
        notes: notes.trim(),
        proofFile: proof,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-3 space-y-2.5 mb-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="field-label" htmlFor="s-date">Date</label>
          <input
            id="s-date"
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="s-kind">Type</label>
          <select
            id="s-kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as SiteLedgerRow["kind"])}
          >
            {LEDGER_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor="s-desc">Description</label>
        <input
          id="s-desc"
          className="input"
          placeholder={isSpend ? "e.g. Steel — 3 quintal" : "e.g. Advance from owner"}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div>
        <label className="field-label" htmlFor="s-amt">Amount (₹)</label>
        <input
          id="s-amt"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          className="input money !text-xl !font-bold !py-2.5"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      {isSpend && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="field-label !mb-0">Bill / slip photo</label>
            {proof && <span className="text-[11px] text-moss">attached</span>}
          </div>
          <button
            type="button"
            className="btn w-full !py-2 !text-[13px]"
            onClick={() => fileRef.current?.click()}
          >
            {proof ? `✓ ${proof.name}` : "📷 Attach the bill"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              setProof(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <p className="text-[11px] text-ink-soft mt-1">
            A spend with no bill attached shows up separately in the balance
            above — that's the number an owner will ask about.
          </p>
        </div>
      )}

      <div>
        <label className="field-label" htmlFor="s-notes">Notes (optional)</label>
        <input
          id="s-notes"
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && <div className="text-[12px] text-crimson">{error}</div>}

      <button
        className="btn btn-primary w-full !py-2.5"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
