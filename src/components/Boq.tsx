import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useCategories } from "../hooks/useCategories";
import { inr, num, todayStr, formatDate } from "../lib/format";
import { fileToOcrImage } from "../lib/scanImage";
import { recognizeText } from "../lib/ocr";
import { pdfToText } from "../lib/pdf";
import { parseScannedBill } from "../lib/scanParse";
import { BillReview, type DraftBill, emptyDraft, blankItem } from "./BillReview";

export function Boq() {
  const items = useLiveQuery(() => db.boqItems.toArray(), []);
  const entries = useLiveQuery(() => db.entries.toArray(), []);
  const categories = useCategories();
  const [draft, setDraft] = useState<DraftBill | null>(null);
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const onScanFile = async (file: File) => {
    setError(null);
    try {
      const isPdf =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      let text: string;
      if (isPdf) {
        text = await pdfToText(file, setBusy);
      } else {
        setBusy("Preparing the photo…");
        const image = await fileToOcrImage(file);
        setBusy("Reading the bill on this phone… 0%");
        text = await recognizeText(image, (pct) =>
          setBusy(`Reading the bill on this phone… ${pct}%`),
        );
      }
      const scan = parseScannedBill(text);
      setScanned(true);
      setDraft({
        vendor: scan.vendor,
        invoiceNo: scan.invoiceNo,
        date: scan.date || todayStr(),
        category: scan.category || "Misc",
        invoiceTotal: scan.invoiceTotal,
        items: scan.items.length
          ? scan.items.map((it) => ({
              item: it.item,
              hsn: "",
              gstPct: "",
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

  const groups = useMemo(() => {
    if (!items) return [];
    const map = new Map<string, typeof items>();
    for (const it of items) {
      const key = `${it.vendor}|${it.invoiceNo}`;
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return [...map.entries()]
      .map(([key, rows]) => ({ key, rows }))
      .sort((a, b) => (a.rows[0].date < b.rows[0].date ? 1 : -1));
  }, [items]);

  const recon = useMemo(() => {
    if (!items || !entries) return [];
    return categories.map((cat) => {
      // BOQ coverage per category: count each invoice's printed total once.
      const invoices = new Map<string, number>();
      for (const it of items) {
        if (it.category === cat)
          invoices.set(`${it.vendor}|${it.invoiceNo}`, it.invoiceTotal);
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
        onChange={setDraft}
        onClose={() => {
          setDraft(null);
          setScanned(false);
        }}
      />
    );
  }

  return (
    <div className="px-4 py-4">
      <h2 className="text-base font-semibold mb-3">Bills (BOQ)</h2>

      <div className="grid grid-cols-3 gap-2 mb-2">
        <button
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() => cameraRef.current?.click()}
        >
          📷 Scan bill
        </button>
        <button
          className="btn"
          disabled={!!busy}
          onClick={() => uploadRef.current?.click()}
        >
          Upload file
        </button>
        <button
          className="btn"
          disabled={!!busy}
          onClick={() => {
            setError(null);
            setScanned(false);
            setDraft(emptyDraft());
          }}
        >
          Type manually
        </button>
      </div>
      <div className="text-[11px] text-ink-soft mb-2">
        Photos and PDF bills both work. Scanning happens on this phone — free,
        offline, nothing uploaded. Always check the rows against the bill
        before saving.
      </div>
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
      <input
        ref={uploadRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onScanFile(f);
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
        <h3 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-2">
          Coverage: BOQ vs ledger
        </h3>
        <div className="bg-surface border border-rule rounded-md overflow-hidden">
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
        <h3 className="text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-2">
          Bills on record
        </h3>
        <div className="space-y-2">
          {groups.map(({ key, rows }) => {
            const head = rows[0];
            const open = expanded === key;
            return (
              <div key={key} className="bg-surface border border-rule rounded-md">
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
                    <table className="w-full text-[11px]">
                      <tbody className="divide-y divide-rule/60">
                        {rows.map((r) => (
                          <tr key={r.id}>
                            <td className="px-2 py-1">{r.item}</td>
                            <td className="px-2 py-1 text-right text-ink-soft whitespace-nowrap">
                              {r.qty !== null &&
                                `${num(r.qty)} ${r.unit ?? ""} × ${r.rate !== null ? num(r.rate) : "?"}`}
                            </td>
                            <td className="px-2 py-1 text-right money whitespace-nowrap">
                              {num(r.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="px-3 py-2 border-t border-rule flex justify-end">
                      {confirmKey === key ? (
                        <div className="flex gap-2">
                          <button
                            className="text-[12px] text-white bg-crimson rounded px-3 py-1"
                            onClick={() => {
                              void db.boqItems.bulkDelete(rows.map((r) => r.id));
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
