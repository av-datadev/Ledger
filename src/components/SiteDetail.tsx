import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { inr, todayStr, formatDate } from "../lib/format";
import {
  addLedgerRow,
  updateLedgerRow,
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);

  // Only an approved link can carry a correction or a retraction to the owner.
  const linkId = site.linkStatus === "approved" ? site.linkId : null;

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
          <RowForm
            siteId={site.id}
            linkId={linkId}
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
          {sorted.map((r) =>
            editingId === r.id ? (
              <RowForm
                key={r.id}
                siteId={site.id}
                linkId={linkId}
                row={r}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <LedgerRowCard
                key={r.id}
                row={r}
                onView={setViewer}
                onEdit={() => setEditingId(r.id)}
                linkId={linkId}
              />
            ),
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-rule">
        {confirmDelete ? (
          <div className="space-y-2">
            <p className="text-[13px] text-crimson">
              Delete this site and all {sorted.length} logged rows? This can't be
              undone.
            </p>
            {deleteErr && (
              <p className="text-[12px] text-crimson">{deleteErr}</p>
            )}
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
                  void deleteSite(site.id)
                    .then(onBack)
                    .catch(() =>
                      setDeleteErr(
                        "Couldn't withdraw the rows the owner can see, so nothing was deleted. Try again when you have signal.",
                      ),
                    );
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
  onEdit,
  linkId,
}: {
  row: SiteLedgerRow;
  onView: (url: string) => void;
  onEdit: () => void;
  /** Set when this site is linked and approved — enables sharing a row up. */
  linkId: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareErr, setShareErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
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
  const remove = async () => {
    setRemoving(true);
    setRemoveErr(null);
    try {
      await deleteLedgerRow(row.id, linkId);
    } catch {
      // The only way this fails is the owner's copy not being reachable, and
      // that is exactly when deleting anyway would be wrong.
      setRemoveErr(
        "Couldn't withdraw the owner's copy just now — nothing was deleted. Try again when you have signal.",
      );
      setRemoving(false);
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

        {confirming ? (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] text-crimson min-w-0">
              Delete this {inr(row.amount)} row
              {row.sharedId
                ? "? The owner stops seeing it too."
                : row.proof
                  ? " and its bill photo?"
                  : "?"}
            </span>
            <div className="flex gap-1.5 shrink-0">
              <button
                className="text-[11px] text-white bg-crimson rounded px-2 py-0.5 disabled:opacity-60"
                disabled={removing}
                onClick={() => void remove()}
              >
                {removing ? "…" : "Delete"}
              </button>
              <button
                className="text-[11px] border border-rule rounded px-2 py-0.5"
                onClick={() => {
                  setConfirming(false);
                  setRemoveErr(null);
                }}
              >
                Keep
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1.5 flex gap-3">
            <button
              type="button"
              className="text-[11px] underline text-ink-soft"
              onClick={onEdit}
            >
              edit
            </button>
            <button
              type="button"
              className="text-[11px] underline text-ink-soft"
              onClick={() => setConfirming(true)}
            >
              remove
            </button>
          </div>
        )}

        {removeErr && (
          <div className="text-[11px] text-crimson mt-0.5">{removeErr}</div>
        )}
      </div>
    </div>
  );
}

/**
 * One form for both logging a row and correcting one.
 *
 * The same form on purpose: an edit that offered fewer fields than the original
 * would quietly make some mistakes uncorrectable, which is how the app got here
 * — a wrong amount could only be fixed by deleting the row and losing the bill
 * photo with it.
 */
function RowForm({
  siteId,
  linkId,
  row,
  onDone,
}: {
  siteId: string;
  linkId: string | null;
  /** Present = correcting this row; absent = logging a new one. */
  row?: SiteLedgerRow;
  onDone: () => void;
}) {
  const [date, setDate] = useState(row?.date ?? todayStr());
  const [kind, setKind] = useState<SiteLedgerRow["kind"]>(row?.kind ?? "received");
  const [description, setDescription] = useState(row?.description ?? "");
  const [amount, setAmount] = useState(row ? String(row.amount) : "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [proof, setProof] = useState<File | null>(null);
  // Only meaningful while editing: whether the photo already on the row stays.
  const [keepProof, setKeepProof] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isSpend = kind !== "received";
  const hadProof = !!row?.proof;

  const save = async () => {
    const value = parseFloat(amount);
    if (!(value > 0)) {
      setError("Amount must be greater than zero.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (row) {
        await updateLedgerRow(
          row.id,
          {
            date,
            kind,
            description: description.trim(),
            amount: value,
            notes: notes.trim(),
            // undefined keeps the existing photo, null drops it.
            proofFile: proof ?? (hadProof && !keepProof ? null : undefined),
          },
          linkId,
        );
      } else {
        await addLedgerRow({
          siteId,
          date,
          kind,
          description: description.trim(),
          amount: value,
          notes: notes.trim(),
          proofFile: proof,
        });
      }
      onDone();
    } catch (err) {
      setError(
        err instanceof Error && row?.sharedId
          ? "Couldn't update the copy the owner sees, so nothing was changed. Try again when you have signal."
          : err instanceof Error
            ? err.message
            : "Could not save that.",
      );
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
            {(proof || (hadProof && keepProof)) && (
              <span className="text-[11px] text-moss">attached</span>
            )}
          </div>
          <button
            type="button"
            className="btn w-full !py-2 !text-[13px]"
            onClick={() => fileRef.current?.click()}
          >
            {proof
              ? `✓ ${proof.name}`
              : hadProof && keepProof
                ? "📷 Replace the bill photo"
                : "📷 Attach the bill"}
          </button>
          {hadProof && !proof && (
            // Removing the photo has to be possible and has to be deliberate:
            // a spend with no bill behind it is a different claim, and it moves
            // the balance above into the column an owner asks about.
            <button
              type="button"
              className="text-[11px] underline text-ink-soft mt-1"
              onClick={() => setKeepProof((v) => !v)}
            >
              {keepProof ? "Remove the photo from this row" : "Keep the photo after all"}
            </button>
          )}
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

      {row?.sharedId && (
        <p className="text-[11px] text-ink-soft">
          The owner has been shown this row — saving corrects his copy too.
        </p>
      )}

      <div className={row ? "grid grid-cols-2 gap-2" : ""}>
        {row && (
          <button
            className="btn !py-2.5"
            disabled={saving}
            onClick={onDone}
          >
            Cancel
          </button>
        )}
        <button
          className="btn btn-primary w-full !py-2.5"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : row ? "Save changes" : "Save"}
        </button>
      </div>
    </div>
  );
}
