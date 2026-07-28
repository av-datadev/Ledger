// Reads a PDF bill. Digital PDFs (vendor quotations, GST invoices) carry an
// embedded text layer — extracted directly: exact, instant, no OCR. Scanned
// PDFs (photos saved as PDF) fall back to rendering each page and running the
// same on-device OCR used for photos. pdf.js is lazy-loaded so it costs
// nothing until the first PDF is opened; its worker is bundled and precached,
// so this works offline like everything else.

import { recognizeText } from "./ocr";
import type { PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api";

const MAX_PAGES = 8; // text-extraction cap — bills are short documents
const MAX_OCR_PAGES = 4; // OCR is slow, cap the fallback harder
const MAX_GEMINI_PAGES = 6; // covers multi-annexure BOQs (equipment + install + terms)
const RENDER_EDGE = 1800; // match scanImage's MAX_EDGE
const LINE_Y_TOLERANCE = 4; // PDF units — items closer than this share a line

type Pdfjs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<Pdfjs> | null = null;

function getPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= (async () => {
    // Some older Android WebViews lack Promise.withResolvers (pdf.js needs it).
    if (!("withResolvers" in Promise)) {
      (
        Promise as unknown as { withResolvers: () => unknown }
      ).withResolvers = function withResolvers<T>() {
        let resolve!: (v: T | PromiseLike<T>) => void;
        let reject!: (e: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise, resolve, reject };
      };
    }
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })().catch((err) => {
    pdfjsPromise = null; // allow retry on the next attempt
    throw err;
  });
  return pdfjsPromise;
}

/**
 * Rebuild reading-order lines from pdf.js text items. Two passes: cluster
 * items into lines by Y (top-down), then order each line by X. Done as
 * separate steps because a single "y then x" comparator isn't a consistent
 * ordering and Array.sort output becomes engine-dependent.
 */
function pageLines(items: TextItem[]): string {
  const positioned = items
    .filter((i) => i.str.trim() !== "")
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
  positioned.sort((a, b) => b.y - a.y); // top of page first
  const lines: { y: number; parts: { str: string; x: number }[] }[] = [];
  for (const it of positioned) {
    const current = lines[lines.length - 1];
    // Anchor each line at its first item's Y so tolerance can't chain-drift
    // across many closely spaced rows.
    if (current && Math.abs(it.y - current.y) <= LINE_Y_TOLERANCE) {
      current.parts.push(it);
    } else {
      lines.push({ y: it.y, parts: [it] });
    }
  }
  return lines
    .map((l) =>
      l.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(" "),
    )
    .join("\n");
}

/**
 * Render one PDF page to a canvas at roughly RENDER_EDGE on its long side.
 * Shared by the OCR fallback and the Gemini image path.
 */
async function renderPageToCanvas(page: PDFPageProxy): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, RENDER_EDGE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

/**
 * Render a PDF's pages to JPEGs for the Gemini vision path — the same way a
 * bill photo is prepared (see geminiScan.ts), one image per page in reading
 * order. A construction BOQ is often several pages (e.g. a "supply of
 * equipment" annexure followed by a separate "installation" annexure with its
 * own subtotal) — sending every page in one Gemini call lets it merge line
 * items across the whole document instead of only seeing page 1. Capped at
 * MAX_GEMINI_PAGES; the multi-page text-layer path (pdfToText) stays as the
 * offline/failure fallback. Returns bare base64 (no data-URL prefix) per page.
 */
export async function pdfPagesToImages(
  file: File,
  onProgress: (msg: string) => void,
): Promise<{ base64: string; mimeType: string }[]> {
  onProgress("Opening the PDF…");
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const doc = await task.promise;
    const pageCount = Math.min(doc.numPages, MAX_GEMINI_PAGES);
    const images: { base64: string; mimeType: string }[] = [];
    for (let p = 1; p <= pageCount; p++) {
      onProgress(`Preparing the bill… page ${p}/${pageCount}`);
      const page = await doc.getPage(p);
      const canvas = await renderPageToCanvas(page);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      images.push({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
    }
    return images;
  } finally {
    void task.destroy();
  }
}

/**
 * Extract the text of a PDF bill for the scan parser. Tries the embedded text
 * layer first; falls back to render + OCR when there is none (scanned PDFs).
 */
export async function pdfToText(
  file: File,
  onProgress: (msg: string) => void,
): Promise<string> {
  onProgress("Opening the PDF…");
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const chunks: string[] = [];
    for (let p = 1; p <= pages; p++) {
      onProgress(`Reading PDF text… page ${p}/${pages}`);
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      chunks.push(
        pageLines(tc.items.filter((i): i is TextItem => "str" in i)),
      );
    }
    const text = chunks.join("\n").trim();
    if (text.length >= 100) return text;

    // Little or no text layer — a scanned PDF. Render pages and OCR them.
    const ocrPages = Math.min(doc.numPages, MAX_OCR_PAGES);
    const ocrChunks: string[] = [];
    for (let p = 1; p <= ocrPages; p++) {
      const page = await doc.getPage(p);
      const canvas = await renderPageToCanvas(page);
      const pageText = await recognizeText(canvas.toDataURL("image/png"), (pct) =>
        onProgress(`Scanned PDF — reading page ${p}/${ocrPages}… ${pct}%`),
      );
      ocrChunks.push(pageText);
    }
    return ocrChunks.join("\n");
  } finally {
    void task.destroy();
  }
}
