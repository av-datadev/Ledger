import { useEffect, useRef, useState } from "react";
import { db } from "../db";
import { PAYERS } from "../../shared/constants";
import { useCategories } from "../hooks/useCategories";
import { usePayers, useModes } from "../hooks/useFacets";
import { todayStr } from "../lib/format";
import { fileToAttachment, type ProcessedImage } from "../lib/attach";
import type { Entry, Attachment } from "../types";

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

  const addFiles = async (files: FileList) => {
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
