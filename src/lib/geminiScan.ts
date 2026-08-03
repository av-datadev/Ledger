// Reads a bill photo via the `scan-bill` Supabase Edge Function (Gemini
// vision) when online. This is the primary photo-scanning path; ocr.ts
// (on-device Tesseract) stays as the offline fallback — see Boq.tsx.
import { supabase } from "./supabase";
import { guessCategory } from "./scanParse";
import type { ScannedBill } from "./scanParse";

const MAX_EDGE = 1600;
const TIMEOUT_MS = 40_000; // multi-page PDFs send several images in one call

/** Downscale + re-encode a bill photo for upload. Keeps color (unlike the
 * OCR path's grayscale prep) — Gemini reads a natural photo better than a
 * contrast-stretched one built for Tesseract. Shared with the handwritten-note
 * reader (noteScan.ts), which needs the same preparation. */
export async function fileToGeminiImage(
  file: File,
): Promise<{ base64: string; mimeType: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable on this device.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { base64: dataUrl.split(",")[1], mimeType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}

/**
 * The real reason a scan failed.
 *
 * supabase-js reports any non-2xx from an Edge Function as the same opaque
 * "Edge Function returned a non-2xx status code" and keeps the body on the
 * error as an unread Response — but the body is the only place the actual
 * cause appears ("quota exceeded", "not configured with a Gemini API key").
 * Without this every failure looks identical to the caller, so a bill that
 * silently fell back to on-device OCR is indistinguishable from one that
 * scanned fine.
 */
export async function edgeFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (typeof body?.error === "string") return body.error;
    } catch {
      const text = await context.clone().text().catch(() => "");
      if (text) return text.slice(0, 300);
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** True when the reader is unavailable because the Gemini quota is spent —
 * worth telling apart from a network failure, since waiting won't fix it
 * today and the on-device fallback can't read handwriting or Devanagari. */
export function isQuotaError(message: string): boolean {
  return /quota|rate.?limit|too_many_requests|\b429\b|RESOURCE_EXHAUSTED/i.test(message);
}

interface GeminiBillResponse {
  vendor: string;
  invoiceNo: string;
  date: string;
  invoiceTotal: number;
  gstPct: number;
  otherCharges: number;
  otherChargesTaxed: boolean;
  isInformal: boolean;
  paidAmount: number;
  balanceDue: number;
  paymentDate: string;
  items: { item: string; qty: number; unit: string; rate: number; amount: number }[];
  error?: string;
}

/** Scan a bill photo with Gemini vision via the Edge Function. Throws on any
 * failure (offline, quota, bad response) — callers should fall back to
 * on-device OCR rather than surface this error directly. */
export async function scanBillWithGemini(file: File): Promise<ScannedBill> {
  const image = await fileToGeminiImage(file);
  return scanImagesWithGemini([image]);
}

/** Send one or more already-prepared page images (base64 + mime, in reading
 * order) to the Gemini Edge Function and map its structured reply into a
 * ScannedBill. Shared by the photo path (one image, fileToGeminiImage) and
 * the PDF path (pdf.ts renders each page to a JPEG) — a multi-page call is
 * read as one continuous document, so a bill split across pages or a
 * multi-section BOQ still comes back as one merged item list. Throws on any
 * failure so callers can fall back. */
export async function scanImagesWithGemini(
  images: { base64: string; mimeType: string }[],
): Promise<ScannedBill> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data: GeminiBillResponse;
  try {
    const { data: result, error } = await supabase.functions.invoke<GeminiBillResponse>(
      "scan-bill",
      {
        body: {
          images: images.map((im) => ({ imageBase64: im.base64, mimeType: im.mimeType })),
        },
        signal: controller.signal,
      },
    );
    if (error) throw new Error(await edgeFunctionError(error));
    if (!result) throw new Error("Empty response from scan-bill.");
    data = result;
  } finally {
    clearTimeout(timer);
  }
  if (data.error) throw new Error(data.error);
  if (!Array.isArray(data.items)) throw new Error("Malformed response from scan-bill.");

  const itemText = [data.vendor, ...data.items.map((it) => it.item)].join(" ");
  return {
    vendor: data.vendor ?? "",
    invoiceNo: data.invoiceNo ?? "",
    date: data.date ?? "",
    category: guessCategory(itemText),
    invoiceTotal: data.invoiceTotal != null ? String(data.invoiceTotal) : "",
    gstPct: data.gstPct != null ? String(data.gstPct) : "18",
    otherCharges: data.otherCharges ? String(data.otherCharges) : "",
    otherChargesTaxed: data.otherChargesTaxed === true,
    isInformal: data.isInformal === true,
    // Zero means "the paper says nothing about a payment", which is different
    // from a payment of ₹0 — carried through as empty so the review screen can
    // tell the two apart and only offer a ledger entry when there's one to make.
    paidAmount: data.paidAmount ? String(data.paidAmount) : "",
    balanceDue: data.balanceDue ? String(data.balanceDue) : "",
    paymentDate: data.paymentDate ?? "",
    items: data.items.map((it) => ({
      item: it.item ?? "",
      qty: it.qty != null ? String(it.qty) : "",
      unit: it.unit ?? "",
      rate: it.rate != null ? String(it.rate) : "",
      amount: it.amount != null ? String(it.amount) : "",
    })),
  };
}
