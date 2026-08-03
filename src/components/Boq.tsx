import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, deleteBill } from "../db";
import { useCategories } from "../hooks/useCategories";
import { inr, num, todayStr, formatDate } from "../lib/format";
import { fileToOcrImage } from "../lib/scanImage";
import { recognizeText } from "../lib/ocr";
import { pdfToText, pdfPagesToImages } from "../lib/pdf";
import { parseScannedBill, type ScannedBill } from "../lib/scanParse";
import { scanBillWithGemini, scanImagesWithGemini } from "../lib/geminiScan";
import { scanSizesWithGemini } from "../lib/sizeScan";
import {
  BillReview,
  recalcItem,
  type DraftBill,
  emptyDraft,
  blankItem,
} from "./BillReview";
import { BillStockPanel } from "./BillStockPanel";
import type { BoqItem } from "../types";

export function Boq() {
  const items = useLiveQuery(() => db.boqItems.toArray(), []);
  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const categories = useCategories();
  const [draft, setDraft] = useState<DraftBill | null>(null);
  const [scanned, setScanned] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const sizesRef = useRef<HTMLInputElement>(null);

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
      // Only a fresh scan carries these; a saved bill doesn't, and editing
      // never re-opens the payment side anyway.
      paidAmount: "",
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

  const onScanFile = async (file: File) => {
    setError(null);
    try {
      const isPdf =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const isImage =
        file.type.startsWith("image/") ||
        /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i.test(file.name);
      // The picker is deliberately unfiltered (see the file inputs below) so
      // every OS offers both the camera/gallery and Files — so an unsupported
      // pick is possible and needs a clear message rather than a parse crash.
      if (!isPdf && !isImage) {
        setError(
          `"${file.name}" isn't a photo or a PDF. Pick a bill photo or a PDF, or enter the bill manually.`,
        );
        return;
      }
      let scan: ScannedBill;
      if (isPdf) {
        // Same as the photo path: Gemini reads the bill first (render every
        // page — up to MAX_GEMINI_PAGES — to images and send them together,
        // so a multi-annexure BOQ still comes back as one merged item list),
        // and the on-device text-extraction path (embedded text layer, or OCR
        // for scanned PDFs) stays as the offline fallback on any Gemini failure.
        try {
          setBusy("Reading the bill…");
          const images = await pdfPagesToImages(file, setBusy);
          scan = await scanImagesWithGemini(images);
        } catch (geminiErr) {
          console.warn("Gemini PDF scan failed, using on-device extraction:", geminiErr);
          const text = await pdfToText(file, setBusy);
          scan = parseScannedBill(text);
        }
      } else {
        // Gemini reads the photo directly (no OCR step) and handles skew,
        // low light, and mangled columns far better than Tesseract. It needs
        // the network, so fall back to on-device OCR on any failure —
        // offline, quota, or a bad response — rather than surface the error.
        try {
          setBusy("Reading the bill…");
          scan = await scanBillWithGemini(file);
        } catch (geminiErr) {
          console.warn("Gemini scan failed, using on-device OCR:", geminiErr);
          setBusy("Preparing the photo…");
          const image = await fileToOcrImage(file);
          setBusy("Reading the bill on this phone… 0%");
          const text = await recognizeText(image, (pct) =>
            setBusy(`Reading the bill on this phone… ${pct}%`),
          );
          scan = parseScannedBill(text);
        }
      }
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
      .map(([key, rows]) => ({ key, rows }))
      .sort((a, b) => (a.rows[0].date < b.rows[0].date ? 1 : -1));
  }, [items]);

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
        editing={editing}
        onChange={setDraft}
        onClose={() => {
          setDraft(null);
          setScanned(false);
          setEditing(false);
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
        <b>Take photo</b> opens the camera. <b>Photo / PDF</b> lets you pick an
        existing photo or a PDF bill. Both read on this phone when there's no
        signal — nothing has to be uploaded.{" "}
        <b>Size list</b> is for a dealer's handwritten slip that prices by size
        instead of quantity — a timber bill written{" "}
        <span className="money">8¼ × 9 × 8 — 3 pc</span>. It works out the cubic
        feet from the sizes and checks them against the dealer's own total.
        Reading handwriting needs a connection. Always check the rows against
        the paper before saving.
      </div>
      {/* Straight to the camera — `capture` makes the OS skip the picker. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onScanFile(f);
          e.target.value = "";
        }}
      />
      {/* Deliberately NO `accept`: a mixed image+PDF accept list makes some
          phone pickers hide one of the two (photos on iOS, PDFs elsewhere),
          which is exactly the "it takes a PDF but not a photo" problem. Left
          unfiltered every OS offers gallery, camera and Files together;
          onScanFile validates the pick and explains any unsupported file. */}
      <input
        ref={uploadRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onScanFile(f);
          e.target.value = "";
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
        <h3 className="eyebrow mb-2">
          Bills on record
        </h3>
        <div className="space-y-2">
          {groups.map(({ key, rows }) => {
            const head = rows[0];
            const open = expanded === key;
            return (
              <div key={key} className="card">
                <button
                  className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left"
                  onClick={() => setExpanded(open ? null : key)}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {head.vendor}
                    </div>
                    <div className="text-[11px] text-ink-soft">
                      Inv #{head.invoiceNo} · {formatDate(head.date)} ·{" "}
                      <span className="badge">{head.category}</span> ·{" "}
                      {rows.length} lines
                    </div>
                  </div>
                  <div className="money font-semibold shrink-0">
                    {inr(head.invoiceTotal)}
                  </div>
                </button>
                {open && (
                  <div className="border-t border-rule">
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
        </div>
      </section>
    </div>
  );
}
