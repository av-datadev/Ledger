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
 * contrast-stretched one built for Tesseract. */
async function fileToGeminiImage(
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

interface GeminiBillResponse {
  vendor: string;
  invoiceNo: string;
  date: string;
  invoiceTotal: number;
  gstPct: number;
  otherCharges: number;
  otherChargesTaxed: boolean;
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
    if (error) throw error;
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
    items: data.items.map((it) => ({
      item: it.item ?? "",
      qty: it.qty != null ? String(it.qty) : "",
      unit: it.unit ?? "",
      rate: it.rate != null ? String(it.rate) : "",
      amount: it.amount != null ? String(it.amount) : "",
    })),
  };
}
