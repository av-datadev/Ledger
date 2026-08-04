import { useEffect, useRef, useState } from "react";
import { db } from "../db";
import { PAYERS } from "../../shared/constants";
import { useCategories } from "../hooks/useCategories";
import { usePayers, useModes } from "../hooks/useFacets";
import { useNoteAiConsent } from "../hooks/useNoteAiConsent";
import { todayStr, inr } from "../lib/format";
import { fileToAttachment, type ProcessedImage } from "../lib/attach";
import { scanNoteWithGemini, matchMode, type ScannedNote } from "../lib/noteScan";
import type { ScannedBill } from "../lib/scanParse";
import type { Entry, Attachment } from "../types";

/**
 * Re-shape a note that turned out to be an itemised bill into the bill reader's
 * own shape, so the BOQ review screen can open on it unchanged. The payment the
 * slip records rides along as `paidAmount`, which is what makes that screen
 * offer "Bill only / Payment only / Both" rather than silently dropping the
 * money — the whole point of sending it over.
 */
function noteToBill(note: ScannedNote): ScannedBill {
  return {
    vendor: "",
    invoiceNo: "",
    date: note.date,
    category: note.category,
    invoiceTotal: note.billTotal,
    // A kaccha bill carries no tax; the review screen's slab is only a
    // calculator input and 0 keeps it from inventing 18% GST on a slip.
    gstPct: "0",
    otherCharges: note.otherCharges,
    otherChargesTaxed: false,
    isInformal: note.isInformal,
    paidAmount: note.amount,
    balanceDue: note.balanceDue,
    // The slip's own date is the bill date; a payment noted separately is rare
    // enough on this path that the review screen's field is left for the person.
    paymentDate: "",
    items: note.items,
  };
}

// A photo shown in the form: either already saved to the DB (edit mode) or
// freshly picked and still in memory. `url` is an object URL for display and is
// revoked on removal / unmount.
interface LocalPhoto {
  id: string;
  url: string;
  name: string;
  persisted: boolean;
  img?: ProcessedImage; // present for not-yet-saved photos
}

interface EntryFormProps {
  /** When set, the form edits this existing entry instead of creating one. */
  initial?: Entry;
  /** Preselect a category for a new entry (from the People tab). */
  presetCategory?: string | null;
  /** Called after a successful save in edit mode. */
  onDone?: () => void;
  /** Shows a Cancel button (edit mode). */
  onCancel?: () => void;
  /** The scanned paper turned out to be an itemised bill and the person chose
   * to file it as one. Hands the read bill to the BOQ tab rather than losing
   * its rows to a single ledger line. */
  onBillDetected?: (bill: ScannedBill) => void;
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
  onBillDetected,
}: EntryFormProps) {
  const categories = useCategories();
  const payers = usePayers();
  const modes = useModes();
  const [form, setForm] = useState(() => formFrom(initial, presetCategory));

  // For a NEW entry, the mode/payer defaults come from the generic constants,
  // but a signed-in user's real options are data-derived. Once those load,
  // snap a still-default new entry onto the first real option so the picker
  // never shows a generic value that isn't in the user's own list.
  useEffect(() => {
    if (initial) return; // editing an existing entry — keep its saved values
    setForm((f) => {
      const paidBy = payers.includes(f.paidBy) ? f.paidBy : (payers[0] ?? f.paidBy);
      const mode = modes.includes(f.mode) ? f.mode : (modes[0] ?? f.mode);
      return paidBy === f.paidBy && mode === f.mode ? f : { ...f, paidBy, mode };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payers, modes, initial]);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const editing = !!initial;

  // Stable id for this entry so freshly-picked photos can be linked at save.
  // Regenerated after each new-entry save so the next one gets a fresh key.
  const [entryId, setEntryId] = useState(() => initial?.id ?? crypto.randomUUID());
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  // --- handwritten-note reader (opt-in, sends the photo off-device) ---
  const noteAi = useNoteAiConsent();
  const noteRef = useRef<HTMLInputElement>(null);
  const [askConsent, setAskConsent] = useState(false);
  const [reading, setReading] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [read, setRead] = useState<ScannedNote | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  // Keep the latest photo list in a ref so the unmount cleanup can revoke every
  // object URL without re-running on each change.
  const photosRef = useRef<LocalPhoto[]>([]);
  photosRef.current = photos;
  useEffect(
    () => () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.url);
    },
    [],
  );

  // In edit mode, load any photos already saved for this entry (once).
  useEffect(() => {
    if (!initial) return;
    let alive = true;
    const urls: string[] = [];
    void db.attachments
      .where("entryId")
      .equals(initial.id)
      .sortBy("createdAt")
      .then((rows) => {
        if (!alive) {
          return;
        }
        setPhotos(
          rows.map((a) => {
            const url = URL.createObjectURL(a.blob);
            urls.push(url);
            return { id: a.id, url, name: a.name, persisted: true };
          }),
        );
      });
    return () => {
      alive = false;
    };
  }, [initial]);

  const set = (k: keyof ReturnType<typeof formFrom>, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Takes File[] as well as a FileList: the note reader hands over a snapshot
  // it took before awaiting, because the picker's onChange clears the input
  // (and with it the live FileList) while that await is still in flight.
  const addFiles = async (files: FileList | File[]) => {
    setPhotoError(null);
    setProcessing(true);
    try {
      const added: LocalPhoto[] = [];
      for (const file of Array.from(files)) {
        const img = await fileToAttachment(file);
        added.push({
          id: crypto.randomUUID(),
          url: URL.createObjectURL(img.blob),
          name: img.name,
          persisted: false,
          img,
        });
      }
      setPhotos((p) => [...p, ...added]);
    } catch (err) {
      setPhotoError(
        err instanceof Error ? err.message : "Could not add that photo.",
      );
    } finally {
      setProcessing(false);
    }
  };

  /**
   * Read a photographed handwritten note into the form. The photo is attached
   * to the entry as well as read — for a kaccha slip there is no invoice
   * behind the payment, so that photo is the only record of it.
   *
   * Only fields the reader actually found are written, so a re-read never
   * blanks something already typed. The amount is deliberately left for the
   * person to confirm against the banner (see below) rather than trusted.
   */
  const readNote = async (files: FileList) => {
    setNoteError(null);
    setRead(null);
    setShowOriginal(false);
    setReading(true);
    try {
      const picked = Array.from(files);
      const scan = await scanNoteWithGemini(picked);
      setRead(scan);

      setForm((f) => {
        const mode = matchMode(scan.mode, modes);
        // A kaccha slip has no tax invoice behind it — record that in the notes
        // so it's visible later which payments lack formal paperwork.
        const informalNote = scan.isInformal ? "No GST bill (handwritten slip)" : "";
        const notes = [scan.notes, informalNote].filter(Boolean).join(" · ");
        return {
          ...f,
          date: scan.date || f.date,
          category: scan.category || f.category,
          event: scan.description || f.event,
          detail: scan.detail || f.detail,
          amount: scan.amount || f.amount,
          mode: mode ?? f.mode,
          notes: notes || f.notes,
        };
      });

      // Keep the paper itself with the entry — `picked`, not `files`: the
      // input has been cleared by now (see addFiles).
      await addFiles(picked);
    } catch (err) {
      console.error("Note read failed:", err);
      setNoteError(
        (err instanceof Error ? err.message : "Could not read that note.") +
          " Fill the entry in by hand instead.",
      );
    } finally {
      setReading(false);
    }
  };

  const removePhoto = (id: string) => {
    setPhotos((list) => {
      const target = list.find((p) => p.id === id);
      if (target) {
        URL.revokeObjectURL(target.url);
        if (target.persisted) setRemovedIds((r) => [...r, id]);
      }
      return list.filter((p) => p.id !== id);
    });
  };

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
      updatedAt: Date.now(),
    };

    // New photos (still in memory) become rows; removed ones are deleted. The
    // entry write and photo writes share one transaction so they never diverge.
    const newRows: Attachment[] = photos
      .filter((p) => !p.persisted && p.img)
      .map((p) => ({
        id: p.id,
        entryId,
        blob: p.img!.blob,
        mime: p.img!.mime,
        name: p.img!.name,
        w: p.img!.w,
        h: p.img!.h,
        createdAt: Date.now(),
      }));

    if (editing) {
      await db.transaction("rw", [db.entries, db.attachments], async () => {
        await db.entries.update(initial.id, fields);
        if (removedIds.length) await db.attachments.bulkDelete(removedIds);
        if (newRows.length) await db.attachments.bulkAdd(newRows);
      });
      onDone?.();
      return;
    }

    await db.transaction("rw", [db.entries, db.attachments], async () => {
      await db.entries.add({ id: entryId, ...fields, createdAt: Date.now() });
      if (newRows.length) await db.attachments.bulkAdd(newRows);
    });
    // Reset for the next entry: clear fields and release the saved photos'
    // preview URLs (the blobs are now safe in the DB).
    for (const p of photos) URL.revokeObjectURL(p.url);
    setPhotos([]);
    setRemovedIds([]);
    setEntryId(crypto.randomUUID());
    setForm(formFrom(undefined, presetCategory));
    setRead(null);
    setNoteError(null);
    setShowOriginal(false);
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

      {!editing && (
        <div className="mb-4">
          <button
            type="button"
            className="btn w-full !py-2.5 !text-[13px]"
            disabled={reading}
            onClick={() =>
              noteAi.granted ? noteRef.current?.click() : setAskConsent(true)
            }
          >
            {reading ? "Reading the note…" : "✍️ Read a handwritten note"}
          </button>
          <p className="text-[11px] text-ink-soft mt-1.5">
            For a vendor's kaccha slip, a cheque, or a Hindi diary page — fills
            the form below and keeps the photo as proof. Always check the amount.
          </p>
          <input
            ref={noteRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void readNote(e.target.files);
              e.target.value = "";
            }}
          />
          {noteError && (
            <div className="text-[12px] text-crimson mt-2">{noteError}</div>
          )}
          {read && (
            <div className="mt-2 rounded-md border border-rule bg-surface p-2.5 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {read.confidence === "low"
                    ? "⚠️ Hard to read — check every field"
                    : read.confidence === "medium"
                      ? "Read — check the amount"
                      : "✓ Read clearly — check the amount"}
                </span>
                {read.isInformal && <span className="badge">No GST bill</span>}
              </div>
              {/* A kaccha slip is often a BILL and a payment on one sheet. Read
                  only as a payment, its whole goods table is thrown away and
                  the BOQ never learns what was bought — so ask, rather than
                  assume this is just money. */}
              {read.isItemisedBill && onBillDetected && (
                <div className="mt-2 rounded-md border border-crimson bg-crimson/10 p-2.5">
                  <div className="font-medium text-crimson">
                    This paper is a bill, not just a payment
                  </div>
                  <div className="mt-1 text-ink-soft">
                    It lists <b>{read.items.length} material rows</b>
                    {read.billTotal && (
                      <> totalling <b>{inr(Number(read.billTotal))}</b></>
                    )}
                    {read.amount && (
                      <>
                        , with <b>{inr(Number(read.amount))}</b> paid against it
                      </>
                    )}
                    . Sending it to the BOQ keeps the rows and still lets you log
                    the payment; keeping it here records only the money.
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-primary !py-1.5 !px-3 !text-[13px]"
                      onClick={() => onBillDetected(noteToBill(read))}
                    >
                      Send it to the BOQ
                    </button>
                    <button
                      type="button"
                      className="btn !py-1.5 !px-3 !text-[13px]"
                      onClick={() => setRead({ ...read, isItemisedBill: false })}
                    >
                      No, just a payment
                    </button>
                  </div>
                </div>
              )}
              {read.amountInWords && (
                <div className="mt-1.5 text-ink-soft">
                  Written in words:{" "}
                  <span className="text-ink font-medium">{read.amountInWords}</span>
                </div>
              )}
              {read.originalText && (
                <>
                  <button
                    type="button"
                    className="mt-1.5 underline text-ink-soft"
                    onClick={() => setShowOriginal((v) => !v)}
                  >
                    {showOriginal ? "Hide" : "Show"} what was written
                  </button>
                  {showOriginal && (
                    <pre className="mt-1.5 whitespace-pre-wrap font-sans text-ink-soft">
                      {read.originalText}
                    </pre>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

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
            placeholder="e.g. Payment to contractor"
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
              {modes.map((m) => (
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
              {payers.map((p) => (
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

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="field-label !mb-0">Photos (optional)</label>
            {photos.length > 0 && (
              <span className="text-[11px] text-ink-soft">
                {photos.length} attached
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn !py-2 !text-[13px]"
              disabled={processing}
              onClick={() => cameraRef.current?.click()}
            >
              📷 Take photo
            </button>
            <button
              type="button"
              className="btn !py-2 !text-[13px]"
              disabled={processing}
              onClick={() => uploadRef.current?.click()}
            >
              Attach image
            </button>
          </div>
          <p className="text-[11px] text-ink-soft mt-1.5">
            Snap the cheque or a diary page and keep it with this entry as proof.
            Stored on this phone — nothing is uploaded. You still fill the amount.
          </p>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={uploadRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {processing && (
            <div className="text-[12px] text-ink-soft mt-2">Adding photo…</div>
          )}
          {photoError && (
            <div className="text-[12px] text-crimson mt-2">{photoError}</div>
          )}
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-2">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className="relative aspect-square rounded-md overflow-hidden border border-rule bg-surface"
                >
                  <button
                    type="button"
                    className="w-full h-full"
                    onClick={() => setViewer(p.url)}
                    aria-label={`View ${p.name}`}
                  >
                    <img
                      src={p.url}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-sm leading-none flex items-center justify-center"
                    aria-label="Remove photo"
                    onClick={() => removePhoto(p.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
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

      {askConsent && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface rounded-lg border border-rule p-4 max-w-sm w-full">
            <h3 className="text-[15px] font-semibold mb-2">
              Send the photo to be read?
            </h3>
            <p className="text-[13px] text-ink-soft leading-relaxed">
              Handwriting can't be read on the phone itself, so the photo is
              sent to an AI reader over the internet, and what it reads comes
              back into the form. Nothing else in this app leaves your phone
              except the ledger sync you've already set up.
            </p>
            <p className="text-[13px] text-ink-soft leading-relaxed mt-2">
              This choice is for this phone only. You can turn it off later in
              Settings.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                type="button"
                className="btn !py-2 !text-[13px]"
                onClick={() => setAskConsent(false)}
              >
                Not now
              </button>
              <button
                type="button"
                className="btn btn-primary !py-2 !text-[13px]"
                onClick={() => {
                  noteAi.grant();
                  setAskConsent(false);
                  // Let the dialog unmount before opening the file picker —
                  // iOS Safari ignores a picker opened from a closing overlay.
                  setTimeout(() => noteRef.current?.click(), 0);
                }}
              >
                Allow &amp; pick photo
              </button>
            </div>
          </div>
        </div>
      )}

      {viewer && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setViewer(null)}
        >
          <img
            src={viewer}
            alt="Attached photo"
            className="max-w-full max-h-full object-contain"
          />
          <button
            className="absolute top-4 right-4 text-white text-3xl leading-none"
            aria-label="Close"
            onClick={() => setViewer(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
