import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, deleteBill } from "../db";
import { useCategories } from "../hooks/useCategories";
import { inr, num, todayStr, formatDate } from "../lib/format";
import { fileToOcrImage } from "../lib/scanImage";
import { recognizeText } from "../lib/ocr";
import { pdfToText, pdfPagesToImages } from "../lib/pdf";
import { parseScannedBill, type ScannedBill } from "../lib/scanParse";
import {
  fileToGeminiImage,
  scanImagesWithGemini,
  edgeFunctionError,
  isQuotaError,
  isBusyError,
} from "../lib/geminiScan";
import { scanSizesWithGemini } from "../lib/sizeScan";
import { billBalance } from "../lib/billBalance";
import {
  BillReview,
  recalcItem,
  type DraftBill,
  emptyDraft,
  blankItem,
} from "./BillReview";
import { BillStockPanel } from "./BillStockPanel";
import { BillPaymentPanel } from "./BillPaymentPanel";
import type { BoqItem } from "../types";

/** How many photos of one bill are read in a single call. Matches the PDF
 * path's MAX_GEMINI_PAGES: a kaccha bill running past six notebook pages is
 * rarer than a picker that selects half an album by accident. */
const MAX_BILL_PAGES = 6;

const isPdfFile = (f: File) =>
  f.type === "application/pdf" || /\.pdf$/i.test(f.name);

const isImageFile = (f: File) =>
  f.type.startsWith("image/") ||
  /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i.test(f.name);

/**
 * What to tell someone whose bill was read by the weaker on-device reader.
 * Names the cause, because the two have different answers: a spent quota is
 * fixed by waiting or by raising the limit, a dead network by reconnecting.
 */
function describeFallback(reason: string): string {
  const shared =
    "Read on this phone instead, which only manages printed English bills — it cannot read Hindi or handwriting, and it will not pick up a payment written on the bill. Check every row, or scan again later.";
  if (isQuotaError(reason)) {
    return `The AI reader has hit its daily limit. ${shared}`;
  }
  // scan-bill already waited out a short rate limit before giving up, so this
  // one means Gemini stayed busy — worth separating from a dead network,
  // because here the phone is fine and a retry in a minute usually works.
  if (isBusyError(reason)) {
    return `The AI reader is busy. ${shared}`;
  }
  return `The AI reader could not be reached. ${shared}`;
}

export function Boq({
  preset = null,
  onPresetUsed,
}: {
  /** A bill already read on the Entry tab, handed over because the slip turned
   * out to be an itemised bill rather than a plain payment. Opens straight on
   * the review screen — including its "save this as" chooser — so the paper is
   * read once and filed once. */
  preset?: ScannedBill | null;
  onPresetUsed?: () => void;
} = {}) {
  const items = useLiveQuery(() => db.boqItems.toArray(), []);
  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const categories = useCategories();
  const [draft, setDraft] = useState<DraftBill | null>(null);
  const [scanned, setScanned] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when the good reader failed and the on-device one stood in. */
  const [degraded, setDegraded] = useState<string | null>(null);
  /** The photo(s)/PDF behind the draft on screen, kept so a scan that fell back
   * to the on-device reader can be retried from the review screen. Re-picking
   * the file is otherwise the only way back, and on a phone that means finding
   * it in the gallery again. Every page is kept, or a retry would silently
   * re-read only the first one. */
  const [lastScan, setLastScan] = useState<File[] | null>(null);
  /** Photos picked so far for a bill that hasn't been read yet — see addPages.
   * Held rather than read on pick, because the next page of the same bill is a
   * tap away and both should go to the reader together. */
  const [pages, setPages] = useState<File[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  /** Narrow the bill list to the ones a vendor is still owed money on. */
  const [dueOnly, setDueOnly] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const sizesRef = useRef<HTMLInputElement>(null);

  // Consume a bill handed over from the Entry tab exactly once — clearing it
  // upstream stops a later visit to this tab from re-opening a bill the person
  // already saved or cancelled.
  useEffect(() => {
    if (!preset) return;
    openScan(preset);
    onPresetUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const editBill = (rows: BoqItem[]) => {
    const head = rows[0];
    setError(null);
    setScanned(false);
    setEditing(true);
    setDraft({
      billId: head.billId,
      vendor: head.vendor,
      invoiceNo: head.invoiceNo,
      date: head.date,
      category: head.category,
      invoiceTotal: String(head.invoiceTotal),
      // Saved rows keep their own per-item GST; the bill-level slab is only a
      // calculator input, so re-derive it from the first row that has one.
      billGstPct: String(rows.find((r) => r.gstPct != null)?.gstPct ?? 18),
      otherCharges: "",
      otherChargesTaxed: false,
      // A saved bill with no invoice number came off a handwritten slip —
      // re-open it under the same relaxed rules it was saved under, or editing
      // it would demand a number the paper never had.
      informal: !head.invoiceNo,
      writtenQty: head.writtenQty != null ? String(head.writtenQty) : "",
      // Re-open a clubbed bill still clubbed, or saving an edit would quietly
      // itemise a bill the person deliberately kept as one line.
      clubbed: head.clubbed === true,
      // Seeded from what the bill already records, NOT left blank: editing
      // rewrites every row, so a blank here would rewrite `amountPaid` to null
      // and silently erase the bill's payment and its outstanding balance.
      paidAmount: head.amountPaid != null ? String(head.amountPaid) : "",
      balanceDue: "",
      paymentDate: "",
      items: rows.map((r) => ({
        item: r.item,
        hsn: r.hsn ?? "",
        gstPct: r.gstPct != null ? String(r.gstPct) : "",
        basis: r.basis,
        length: r.length != null ? String(r.length) : "",
        width: r.width != null ? String(r.width) : "",
        thickness: r.thickness != null ? String(r.thickness) : "",
        pieces: r.pieces != null ? String(r.pieces) : "",
        qty: r.qty != null ? String(r.qty) : "",
        unit: r.unit ?? "",
        rate: r.rate != null ? String(r.rate) : "",
        discPct: r.discPct != null ? String(r.discPct) : "",
        amount: String(r.amount),
      })),
    });
  };

  /**
   * Take photos of one bill and hold them until the person says they have the
   * whole thing. A vendor's kaccha bill is a notebook page, and a running
   * account routinely covers two or three of them — read one at a time they
   * become three unrelated bills, each with a fragment of the items and only
   * one carrying the जमा/शेष line that says what was actually paid.
   *
   * They are read in ONE call rather than one call per page: scan-bill already
   * merges a sequence of page images into a single item list (that is how the
   * multi-page PDF path works), and on a free tier of 20 requests a day, three
   * pages costing three requests is the difference between scanning a day's
   * bills and running out by mid-morning.
   */
  const addPages = (picked: File[]) => {
    setError(null);
    const images = picked.filter(isImageFile);
    const skipped = picked.length - images.length;
    setPages((prev) => {
      const room = MAX_BILL_PAGES - prev.length;
      if (room <= 0) {
        setError(
          `That's already ${MAX_BILL_PAGES} pages, which is as many as can be read as one bill. Save these, then scan the rest as a second bill.`,
        );
        return prev;
      }
      if (skipped > 0 || images.length > room) {
        setError(
          [
            skipped > 0
              ? `${skipped === 1 ? "One file wasn't" : `${skipped} files weren't`} a photo and ${skipped === 1 ? "was" : "were"} left out.`
              : null,
            images.length > room
              ? `Only the first ${room} of these fit — a bill can be at most ${MAX_BILL_PAGES} pages.`
              : null,
          ]
            .filter(Boolean)
            .join(" "),
        );
      }
      return [...prev, ...images.slice(0, room)];
    });
  };

  /**
   * Read whatever was picked — a PDF, or one or more photos of the same bill.
   *
   * One function rather than two so the review screen's "try the AI reader
   * again" retries exactly what was scanned, pages and all, instead of only
   * ever re-reading the first page.
   */
  const scanFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    setDegraded(null);
    setLastScan(files);
    try {
      const pdf = files.find(isPdfFile);
      const images = files.filter(isImageFile);
      // The picker is deliberately unfiltered (see the file inputs below) so
      // every OS offers both the camera/gallery and Files — so an unsupported
      // pick is possible and needs a clear message rather than a parse crash.
      if (!pdf && images.length === 0) {
        setError(
          `"${files[0].name}" isn't a photo or a PDF. Pick a bill photo or a PDF, or enter the bill manually.`,
        );
        return;
      }
      // A PDF is already a multi-page document; combining one with loose photos
      // has no sensible reading order, so the PDF wins and says so.
      if (pdf && images.length > 0) {
        setError(
          `Read "${pdf.name}" on its own — a PDF is already a whole bill, so the photos picked alongside it were left out.`,
        );
      }
      let scan: ScannedBill;
      if (pdf) {
        // Same as the photo path: Gemini reads the bill first (render every
        // page — up to MAX_GEMINI_PAGES — to images and send them together,
        // so a multi-annexure BOQ still comes back as one merged item list),
        // and the on-device text-extraction path (embedded text layer, or OCR
        // for scanned PDFs) stays as the offline fallback on any Gemini failure.
        try {
          setBusy("Reading the bill…");
          const rendered = await pdfPagesToImages(pdf, setBusy);
          scan = await scanImagesWithGemini(rendered);
        } catch (geminiErr) {
          console.warn("Gemini PDF scan failed, using on-device extraction:", geminiErr);
          setDegraded(describeFallback(await edgeFunctionError(geminiErr)));
          const text = await pdfToText(pdf, setBusy);
          scan = parseScannedBill(text);
        }
      } else {
        // Gemini reads the photos directly (no OCR step) and handles skew,
        // low light, and mangled columns far better than Tesseract. It needs
        // the network, so fall back to on-device OCR on any failure —
        // offline, quota, or a bad response.
        const pageLabel = images.length > 1 ? ` (${images.length} pages)` : "";
        try {
          setBusy(`Reading the bill${pageLabel}…`);
          const prepared = [];
          for (const f of images) prepared.push(await fileToGeminiImage(f));
          scan = await scanImagesWithGemini(prepared);
        } catch (geminiErr) {
          console.warn("Gemini scan failed, using on-device OCR:", geminiErr);
          // The fallback is a genuinely weaker reader — English-only, and
          // blind to the payment an informal bill records — so falling back
          // silently produces a wrong bill that looks like a right one. Say so.
          setDegraded(describeFallback(await edgeFunctionError(geminiErr)));
          // Each page is recognised on its own and the text joined, the same
          // way pdfToText concatenates a PDF's pages — parseScannedBill reads
          // the result as one document. It is still the weaker reader on every
          // page, and on a handwritten or Hindi bill it will read nothing
          // useful at all; the banner above the draft says so.
          const texts: string[] = [];
          for (const [i, f] of images.entries()) {
            const of = images.length > 1 ? ` (page ${i + 1} of ${images.length})` : "";
            setBusy(`Preparing the photo${of}…`);
            const image = await fileToOcrImage(f);
            setBusy(`Reading the bill on this phone${of}… 0%`);
            texts.push(
              await recognizeText(image, (pct) =>
                setBusy(`Reading the bill on this phone${of}… ${pct}%`),
              ),
            );
          }
          scan = parseScannedBill(texts.join("\n"));
        }
      }
      setPages([]);
      openScan(scan);
    } catch (err) {
      console.error("Scan failed:", err);
      setError(
        (err instanceof Error ? err.message : "Could not read that file.") +
          " You can still enter the bill manually.",
      );
    } finally {
      setBusy(null);
    }
  };

  /** Open the review screen on an already-read bill. Shared by this tab's own
   * scanners and by a bill handed over from the Entry tab, where a kaccha slip
   * turned out to be an itemised bill rather than a plain payment. */
  const openScan = (scan: ScannedBill) => {
    setScanned(true);
    setEditing(false);
    setDraft({
      billId: crypto.randomUUID(),
      vendor: scan.vendor,
      invoiceNo: scan.invoiceNo,
      date: scan.date || todayStr(),
      category: scan.category || "Misc",
      invoiceTotal: scan.invoiceTotal,
      billGstPct: scan.gstPct || "18",
      otherCharges: scan.otherCharges,
      otherChargesTaxed: scan.otherChargesTaxed,
      // A handwritten bill reads as informal here too, so it saves without
      // the vendor and invoice number it was never going to have.
      informal: scan.isInformal,
      writtenQty: "",
      // Off by default even on a handwritten bill: clubbing is a judgement
      // about this particular paper, and turning it on for someone would hide
      // an itemisation they may well have wanted. The toggle is on the review
      // screen, next to the rows it applies to.
      clubbed: false,
      paidAmount: scan.paidAmount,
      balanceDue: scan.balanceDue,
      paymentDate: scan.paymentDate,
      items: scan.items.length
        ? scan.items.map((it) => ({
            item: it.item,
            hsn: "",
            gstPct: "",
            basis: "qty" as const,
            length: "",
            width: "",
            thickness: "",
            pieces: "",
            qty: it.qty,
            unit: it.unit,
            rate: it.rate,
            discPct: "",
            amount: it.amount,
          }))
        : [blankItem()],
    });
  };

  /**
   * Read a handwritten size list — a timber or marble dealer's kaccha slip —
   * into a bill of `cft` rows, one per size. Kept separate from onScanFile
   * because the two papers share nothing: there is no invoice number to find,
   * no GST to apportion, and the quantity has to be computed from dimensions
   * rather than read off a column. The dealer's own total comes across as
   * `writtenQty` so the review screen can check the sizes against it.
   */
  const onScanSizes = async (file: File) => {
    setError(null);
    try {
      setBusy("Reading the sizes…");
      const scan = await scanSizesWithGemini([file]);
      const material = scan.material.trim();
      setScanned(true);
      setEditing(false);
      setDraft({
        billId: crypto.randomUUID(),
        vendor: scan.vendor,
        invoiceNo: "",
        date: scan.date || todayStr(),
        category: scan.category || "Wood",
        // A kaccha slip's bottom line already includes any labour/cartage, so
        // it is the total payable — freight is captured separately below and
        // must not be added on top of it a second time.
        invoiceTotal: scan.writtenTotal || scan.writtenLineAmount,
        // Handwritten slips carry no tax; a 0% slab keeps the calculated total
        // equal to goods + extras rather than inventing 18% on top.
        billGstPct: "0",
        otherCharges: scan.otherCharges,
        otherChargesTaxed: false,
        informal: true,
        writtenQty: scan.writtenQty,
        // Never clubbed: a size list exists to be read as its sizes — the
        // measured-vs-written check is the entire reason for the feature, and
        // it has nothing to check if the rows are collapsed away.
        clubbed: false,
        // A size list prices the goods; it isn't a running account, so
        // scan-sizes doesn't look for a payment and none is offered.
        paidAmount: "",
        balanceDue: "",
        paymentDate: "",
        // recalcItem turns each size into its cubic feet and its amount — a
        // scanned slip has neither until the app computes them.
        items: scan.lines.map((l) => recalcItem({
          // Name each row by its size so Stock and the CSV stay readable —
          // "Teak 8.25 × 9 × 8" is the only useful name a size line has.
          item: [material, `${l.length} × ${l.width} × ${l.thickness}`]
            .filter(Boolean)
            .join(" "),
          hsn: "",
          gstPct: "",
          basis: "cft" as const,
          length: l.length,
          width: l.width,
          thickness: l.thickness,
          pieces: l.pieces,
          qty: "",
          unit: "cft",
          rate: scan.rate,
          discPct: "",
          amount: "",
          raw: l.raw,
        })),
      });
    } catch (err) {
      console.error("Size scan failed:", err);
      setError(
        (err instanceof Error ? err.message : "Could not read that photo.") +
          " Handwriting can only be read online — you can also enter the sizes manually.",
      );
    } finally {
      setBusy(null);
    }
  };

  const groups = useMemo(() => {
    if (!items) return [];
    const map = new Map<string, BoqItem[]>();
    for (const it of items) {
      const arr = map.get(it.billId) ?? [];
      arr.push(it);
      map.set(it.billId, arr);
    }
    return [...map.entries()]
      .map(([key, rows]) => ({ key, rows, ...billBalance(rows) }))
      .sort((a, b) => (a.rows[0].date < b.rows[0].date ? 1 : -1));
  }, [items]);

  // Bills the vendor is still owed money on. Kept as a filter rather than a
  // separate screen: it is the same list of bills, asked a narrower question.
  const shownGroups = useMemo(
    () => (dueOnly ? groups.filter((g) => g.outstanding != null && g.outstanding > 0) : groups),
    [groups, dueOnly],
  );
  const dueCount = useMemo(
    () => groups.filter((g) => g.outstanding != null && g.outstanding > 0).length,
    [groups],
  );

  const recon = useMemo(() => {
    if (!items || !entries) return [];
    return categories.map((cat) => {
      // BOQ coverage per category: count each bill's printed total once.
      const invoices = new Map<string, number>();
      for (const it of items) {
        if (it.category === cat) invoices.set(it.billId, it.invoiceTotal);
      }
      const boqTotal = [...invoices.values()].reduce((s, v) => s + v, 0);
      const ledgerTotal = entries
        .filter((e) => e.category === cat)
        .reduce((s, e) => s + e.amount, 0);
      return { cat, boqTotal, ledgerTotal };
    });
  }, [items, entries, categories]);

  if (draft) {
    return (
      <BillReview
        draft={draft}
        scanned={scanned}
        degraded={degraded}
        busy={busy}
        onRetryScan={lastScan ? () => void scanFiles(lastScan) : undefined}
        editing={editing}
        onChange={setDraft}
        onClose={() => {
          setDraft(null);
          setScanned(false);
          setEditing(false);
          setDegraded(null);
          setLastScan(null);
        }}
      />
    );
  }

  return (
    <div className="px-4 py-4">
      <h2 className="text-base font-semibold mb-3">Bills (BOQ)</h2>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <button
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() => cameraRef.current?.click()}
        >
          📷 Take photo
        </button>
        <button
          className="btn"
          disabled={!!busy}
          onClick={() => uploadRef.current?.click()}
        >
          Photo / PDF
        </button>
        <button
          className="btn"
          disabled={!!busy}
          onClick={() => sizesRef.current?.click()}
        >
          📐 Size list
        </button>
        <button
          className="btn"
          disabled={!!busy}
          onClick={() => {
            setError(null);
            setScanned(false);
            setEditing(false);
            setDraft(emptyDraft());
          }}
        >
          Type manually
        </button>
      </div>
      <div className="text-[11px] text-ink-soft mb-2">
        <b>Size list</b> is for a dealer's slip priced by size (8¼ × 9 × 8 — 3
        pc). Always check the rows against the paper.
      </div>
      {/* Straight to the camera — `capture` makes the OS skip the picker. One
          shot per tap is all the camera returns, so pages accumulate in the
          tray instead of being read on the spot. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) addPages([f]);
          e.target.value = "";
        }}
      />
      {/* Deliberately NO `accept`: a mixed image+PDF accept list makes some
          phone pickers hide one of the two (photos on iOS, PDFs elsewhere),
          which is exactly the "it takes a PDF but not a photo" problem. Left
          unfiltered every OS offers gallery, camera and Files together;
          scanFiles validates the pick and explains any unsupported file. */}
      <input
        ref={uploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (picked.length === 0) return;
          // A PDF is a whole bill on its own and goes straight to the reader;
          // photos join the tray, since the next page of the same notebook
          // bill is usually one tap away.
          if (picked.some(isPdfFile)) void scanFiles(picked);
          else addPages(picked);
        }}
      />
      {/* A size list is always a photo of a scrap of paper, never a PDF, so
          unlike the picker above this one can safely filter to images — which
          also lets the OS offer the camera directly. */}
      <input
        ref={sizesRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onScanSizes(f);
          e.target.value = "";
        }}
      />

      {/* The pages picked so far, held until the whole bill is on screen. A
          kaccha bill that runs over two notebook pages has to be read as one
          document: split into two scans, the items land on one bill and the
          जमा/शेष line on the other. */}
      {pages.length > 0 && !busy && (
        <div className="card px-3 py-3 mb-3 space-y-2">
          <div className="text-[13px] font-medium">
            {pages.length === 1
              ? "1 page of this bill"
              : `${pages.length} pages of this bill`}
          </div>
          <ul className="space-y-1">
            {pages.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-2 text-[12px] text-ink-soft"
              >
                <span className="truncate">
                  Page {i + 1} · <span className="truncate">{f.name}</span>
                </span>
                <button
                  className="text-crimson shrink-0"
                  onClick={() => setPages((p) => p.filter((_, j) => j !== i))}
                  aria-label={`Remove page ${i + 1}`}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-0.5">
            <button
              className="btn btn-primary flex-1"
              onClick={() => void scanFiles(pages)}
            >
              Read {pages.length === 1 ? "this page" : `these ${pages.length} pages`}
            </button>
            <button className="btn" onClick={() => setPages([])}>
              Clear
            </button>
          </div>
          <div className="text-[11px] text-ink-soft">
            Tap <b>Take photo</b> or <b>Photo / PDF</b> again to add another
            page. All of them are read together as one bill — one scan, not one
            per page.
          </div>
        </div>
      )}

      {busy && (
        <div className="text-[13px] px-3 py-2 rounded-md border border-rule bg-surface text-ink-soft mb-3">
          {busy}
        </div>
      )}
      {error && (
        <div className="text-[13px] px-3 py-2 rounded-md border border-crimson bg-crimson/5 text-crimson mb-3">
          {error}
        </div>
      )}

      <section className="mt-2">
        <h3 className="eyebrow mb-2">
          Coverage: BOQ vs ledger
        </h3>
        <div className="card overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-rule text-left text-ink-soft">
                <th className="px-2 py-1.5 font-medium">Category</th>
                <th className="px-2 py-1.5 font-medium text-right">
                  BOQ bills
                </th>
                <th className="px-2 py-1.5 font-medium text-right">Ledger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {recon.map(({ cat, boqTotal, ledgerTotal }) => (
                <tr key={cat}>
                  <td className="px-2 py-1.5">{cat}</td>
                  <td className="px-2 py-1.5 text-right money">
                    {boqTotal ? num(boqTotal) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right money">
                    {ledgerTotal ? num(ledgerTotal) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 pb-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="eyebrow">Bills on record</h3>
          {/* Only offered once a bill actually has money outstanding — a filter
              that can only ever empty the list is noise on a tab that most
              people open to add a bill, not to chase one. */}
          {dueCount > 0 && (
            <button
              className={`text-[11px] rounded-full border px-2.5 py-1 ${
                dueOnly
                  ? "border-crimson text-crimson bg-crimson/5"
                  : "border-rule text-ink-soft"
              }`}
              aria-pressed={dueOnly}
              onClick={() => setDueOnly((v) => !v)}
            >
              Still to pay ({dueCount})
            </button>
          )}
        </div>
        <div className="space-y-2">
          {shownGroups.map(({ key, rows, paid, outstanding }) => {
            const head = rows[0];
            const open = expanded === key;
            const clubbed = head.clubbed === true;
            return (
              <div key={key} className="card">
                <button
                  className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left"
                  onClick={() => setExpanded(open ? null : key)}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {/* A handwritten bill often names no seller at all — the
                          reader leaves it empty rather than inventing one, so
                          the row needs a fallback or it renders blank. */}
                      {head.vendor || `${head.category} bill`}
                    </div>
                    <div className="text-[11px] text-ink-soft">
                      {/* Kaccha bills have no invoice number; printing "Inv # ·"
                          in front of nothing is how that used to read. */}
                      {head.invoiceNo ? `Inv #${head.invoiceNo} · ` : ""}
                      {formatDate(head.date)} ·{" "}
                      <span className="badge">{head.category}</span> ·{" "}
                      {clubbed
                        ? `one line · ${rows.length} rows kept`
                        : `${rows.length} ${rows.length === 1 ? "line" : "lines"}`}
                    </div>
                    {outstanding != null && outstanding > 0 && (
                      <div className="text-[11px] text-crimson mt-0.5">
                        Paid <span className="money">{inr(paid ?? 0)}</span> ·{" "}
                        <b>
                          <span className="money">{inr(outstanding)}</span> still
                          due
                        </b>
                      </div>
                    )}
                    {outstanding === 0 && (
                      <div className="text-[11px] text-moss mt-0.5">
                        Paid in full
                      </div>
                    )}
                  </div>
                  <div className="money font-semibold shrink-0">
                    {inr(head.invoiceTotal)}
                  </div>
                </button>
                {open && (
                  <div className="border-t border-rule">
                    {/* Above the stock panel: what is still owed on a bill is
                        the question people open it to answer. */}
                    <BillPaymentPanel rows={rows} />
                    <BillStockPanel
                      billId={key}
                      billLabel={`Bill #${head.invoiceNo} ${head.vendor}`.trim()}
                    />

                    <div className="px-3 py-2 border-t border-rule flex items-center justify-between gap-2">
                      <button
                        className="text-[12px] btn !py-1 !px-3"
                        onClick={() => editBill(rows)}
                      >
                        Edit bill
                      </button>
                      {confirmKey === key ? (
                        <div className="flex gap-2">
                          <button
                            className="text-[12px] text-white bg-crimson rounded px-3 py-1"
                            onClick={() => {
                              void deleteBill(key);
                              setConfirmKey(null);
                              setExpanded(null);
                            }}
                          >
                            Delete bill ({rows.length} lines)
                          </button>
                          <button
                            className="text-[12px] border border-rule rounded px-3 py-1"
                            onClick={() => setConfirmKey(null)}
                          >
                            Keep
                          </button>
                        </div>
                      ) : (
                        <button
                          className="text-[12px] text-crimson"
                          onClick={() => setConfirmKey(key)}
                        >
                          delete this bill
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {items && groups.length === 0 && (
            <div className="text-sm text-ink-soft text-center py-6">
              No bills recorded yet.
            </div>
          )}
          {items && groups.length > 0 && shownGroups.length === 0 && (
            <div className="text-sm text-ink-soft text-center py-6">
              Nothing outstanding — every bill with a payment recorded against
              it is paid up.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
