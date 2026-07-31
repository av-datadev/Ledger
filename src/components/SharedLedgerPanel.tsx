import { useCallback, useEffect, useRef, useState } from "react";
import { inr, todayStr, formatDate } from "../lib/format";
import { fileToAttachment } from "../lib/attach";
import { notifyCounterparty } from "../lib/push";
import {
  listSharedEntries,
  addSharedEntry,
  unshareEntry,
  sharedProofUrl,
  reconcile,
  type SharedEntry,
  type AuthorRole,
} from "../lib/siteLink";

/**
 * The one view both sides look at.
 *
 * Rendered identically for the homeowner and the contractor — same rows, same
 * totals, same disagreement banner. That symmetry is the point: a dispute about
 * an advance is settleable when both parties are reading the same screen, and
 * neither can edit the other's figure (RLS blocks it), so the record of the
 * disagreement survives.
 */
export function SharedLedgerPanel({
  linkId,
  role,
  counterpartyName,
}: {
  linkId: string;
  /** Which side is looking. Decides what this user is allowed to add. */
  role: AuthorRole;
  counterpartyName: string;
}) {
  const [rows, setRows] = useState<SharedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listSharedEntries(linkId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the shared ledger.");
    }
  }, [linkId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = reconcile(rows ?? []);
  const mine = role === "owner" ? "owner" : "contractor";

  return (
    <div className="space-y-2.5">
      {error && <div className="text-[12px] text-crimson">{error}</div>}

      <div className="card p-3">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-soft">
              {role === "owner" ? "You paid" : "Owner says paid"}
            </div>
            <div className="money text-[15px] font-semibold mt-0.5">
              {inr(totals.ownerSaysPaid)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-soft">
              {role === "contractor" ? "You received" : "He says received"}
            </div>
            <div className="money text-[15px] font-semibold mt-0.5">
              {inr(totals.contractorSaysReceived)}
            </div>
          </div>
        </div>

        {totals.disagrees && (
          <div className="mt-2.5 pt-2.5 border-t border-rule text-[12px] text-crimson">
            <b>These don't match.</b> A difference of{" "}
            <span className="money">{inr(Math.abs(totals.gap))}</span> —
            {totals.gap > 0
              ? " more has been recorded as paid than as received."
              : " more has been recorded as received than as paid."}{" "}
            Worth settling now rather than at the end.
          </div>
        )}

        {totals.contractorSpend > 0 && (
          <div className="mt-2.5 pt-2.5 border-t border-rule flex justify-between text-[11px] text-ink-soft">
            <span>Spent on the site (contractor's record)</span>
            <span className="money">{inr(totals.contractorSpend)}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="eyebrow">Shared with {counterpartyName || "the other side"}</h3>
        <button
          className="btn !py-1.5 !px-3 !text-[13px]"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>

      {adding && (
        <AddSharedForm
          linkId={linkId}
          role={role}
          onDone={() => {
            setAdding(false);
            void load();
          }}
        />
      )}

      {rows?.length === 0 && !adding && (
        <p className="text-[13px] text-ink-soft">
          Nothing shared yet. Add what you've{" "}
          {role === "owner" ? "paid" : "received or spent"} and the other side
          sees it immediately.
        </p>
      )}

      <div className="space-y-1.5">
        {rows?.map((r) => (
          <SharedRow
            key={r.id}
            row={r}
            mine={mine}
            counterpartyName={counterpartyName}
            onChanged={load}
            onViewProof={setViewer}
          />
        ))}
      </div>

      {viewer && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setViewer(null)}
        >
          <img
            src={viewer}
            alt="Shared bill"
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}

      <p className="text-[11px] text-ink-soft">
        Each side can only add or remove its own rows — neither can change the
        other's figure.
      </p>
    </div>
  );
}

function SharedRow({
  row,
  mine,
  counterpartyName,
  onChanged,
  onViewProof,
}: {
  row: SharedEntry;
  mine: AuthorRole;
  counterpartyName: string;
  onChanged: () => void;
  onViewProof: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  // The bucket is private, so a thumbnail needs a signed URL fetched per row.
  useEffect(() => {
    if (!row.proofPath) return;
    let alive = true;
    void sharedProofUrl(row.proofPath).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [row.proofPath]);

  const isMine = row.authorRole === mine;

  return (
    <div className="card p-2.5 flex gap-2.5">
      {row.proofPath ? (
        <button
          type="button"
          className="w-11 h-11 shrink-0 rounded overflow-hidden border border-rule bg-paper-2"
          onClick={() => url && onViewProof(url)}
          aria-label="View the shared bill"
        >
          {url ? (
            <img src={url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[9px] text-ink-soft">…</span>
          )}
        </button>
      ) : (
        <div
          className="w-11 h-11 shrink-0 rounded border border-dashed border-rule grid place-items-center text-[9px] text-ink-soft text-center leading-tight px-1"
          title="No bill attached to this row"
        >
          No bill
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2">
          <span className="text-[13px] truncate">
            {row.description || (row.kind === "payment" ? "Payment" : "Spend")}
          </span>
          <span
            className={`money text-[13px] shrink-0 ${
              row.kind === "payment" ? "text-moss" : ""
            }`}
          >
            {inr(row.amount)}
          </span>
        </div>
        <div className="flex justify-between items-center gap-2 mt-0.5">
          <span className="text-[11px] text-ink-soft">
            {formatDate(row.date)} · {isMine ? "you" : counterpartyName || row.authorRole}{" "}
            · {row.kind === "payment" ? "money moved" : "spent on site"}
          </span>
          {isMine && (
            <button
              className="text-[11px] text-crimson underline shrink-0"
              onClick={() => void unshareEntry(row.id, row.proofPath).then(onChanged)}
            >
              remove
            </button>
          )}
        </div>
        {row.notes && (
          <div className="text-[11px] text-ink-soft mt-0.5">{row.notes}</div>
        )}
      </div>
    </div>
  );
}

function AddSharedForm({
  linkId,
  role,
  onDone,
}: {
  linkId: string;
  role: AuthorRole;
  onDone: () => void;
}) {
  const [date, setDate] = useState(todayStr());
  // The owner only ever declares money going out. The contractor declares
  // money coming in, or money he laid out on the site.
  const [kind, setKind] = useState<"payment" | "spend">("payment");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    const value = parseFloat(amount);
    if (!(value > 0)) {
      setError("Amount must be greater than zero.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // Compress before upload, the same as every other photo in the app — a
      // straight camera JPEG is several MB and this is going over a site's
      // mobile data.
      const img = proof ? await fileToAttachment(proof) : null;
      await addSharedEntry({
        linkId,
        authorRole: role,
        date,
        kind: role === "owner" ? "payment" : kind,
        description: description.trim(),
        amount: value,
        notes: notes.trim(),
        proof: img?.blob ?? null,
      });
      notifyCounterparty(
        linkId,
        "entry_shared",
        `${inr(value)} — ${description.trim() || (role === "owner" ? "payment" : "spend")}`,
      );
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not share that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="field-label" htmlFor="sh-date">Date</label>
          <input
            id="sh-date"
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {role === "contractor" && (
          <div>
            <label className="field-label" htmlFor="sh-kind">Type</label>
            <select
              id="sh-kind"
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as "payment" | "spend")}
            >
              <option value="payment">Received from owner</option>
              <option value="spend">Spent on the site</option>
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="field-label" htmlFor="sh-desc">Description</label>
        <input
          id="sh-desc"
          className="input"
          placeholder={role === "owner" ? "e.g. Advance for steel" : "e.g. Steel 2 quintal"}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div>
        <label className="field-label" htmlFor="sh-amt">Amount (₹)</label>
        <input
          id="sh-amt"
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

      <div>
        <label className="field-label" htmlFor="sh-notes">Notes (optional)</label>
        <input
          id="sh-notes"
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

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
          {role === "contractor"
            ? "The owner sees this photo. It's the fastest way to settle a question about what was bought."
            : "A cheque photo or receipt, so there's no doubt what this payment was."}
        </p>
      </div>

      {error && <div className="text-[12px] text-crimson">{error}</div>}

      <button
        className="btn btn-primary w-full !py-2.5"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? "Sharing…" : "Share with the other side"}
      </button>
    </div>
  );
}
