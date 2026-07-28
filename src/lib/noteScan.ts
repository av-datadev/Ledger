// Reads a HANDWRITTEN payment note into a draft ledger entry via the
// `scan-note` Supabase Edge Function (Gemini vision).
//
// This is the informal counterpart to geminiScan.ts: that reads a printed GST
// tax invoice into BOQ line items, this reads the papers that never come as a
// proper invoice — a vendor's kaccha slip, a cheque, a Hindi diary page — into
// the fields of a single ledger entry.
//
// Unlike bill scanning there is NO on-device fallback. Tesseract cannot read
// cursive handwriting or Devanagari (the app ships only the English traineddata),
// so when this fails the honest answer is "type it in", not a garbage draft.
//
// Sending the photo off-device is why this path is opt-in per device — see
// useNoteAiConsent.
import { supabase } from "./supabase";
import { fileToGeminiImage } from "./geminiScan";
import { guessCategory } from "./scanParse";
import type { Category } from "../../shared/constants";

const TIMEOUT_MS = 40_000;

/** A handwritten note read into the shape of the entry form. */
export interface ScannedNote {
  date: string; // YYYY-MM-DD, or "" when the paper carries no date
  description: string;
  detail: string;
  amount: string;
  /** The amount as written in words, when the paper spells it out. Shown next
   * to the figure so a misread digit is obvious. */
  amountInWords: string;
  /** Generic hint — "Cash" / "Cheque" / "UPI" / "Bank transfer" / "". Mapped
   * onto the user's own payment-mode list by matchMode(). */
  mode: string;
  notes: string;
  /** Verbatim transcription, original script kept. Shown for checking. */
  originalText: string;
  /** True for a handwritten / non-GST paper. */
  isInformal: boolean;
  confidence: "high" | "medium" | "low";
  category: Category | "";
}

interface GeminiNoteResponse {
  date: string;
  description: string;
  detail: string;
  amount: number;
  amountInWords: string;
  mode: string;
  notes: string;
  originalText: string;
  isInformal: boolean;
  confidence: string;
  error?: string;
}

/**
 * Map the reader's generic mode hint onto whichever payment mode the user
 * actually has. Their list holds real-world strings like "GPay (SBI - 8101)"
 * or "Cheque", so an exact match is the exception — match on a keyword
 * instead, and fall back to leaving the form's current mode alone.
 */
export function matchMode(hint: string, available: string[]): string | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  const find = (...needles: string[]) =>
    available.find((m) => {
      const lower = m.toLowerCase();
      return needles.some((n) => lower.includes(n));
    }) ?? null;

  if (h.includes("cheque") || h.includes("check")) return find("cheque", "check");
  if (h.includes("cash")) return find("cash");
  // A UPI or bank-transfer hint lands on whichever digital mode exists; these
  // are spelled a dozen ways ("GPay (PNB)", "SBI 8101", "Bank transfer").
  if (h.includes("upi") || h.includes("gpay") || h.includes("phonepe") || h.includes("paytm"))
    return find("upi", "gpay", "phonepe", "paytm");
  if (h.includes("bank") || h.includes("transfer") || h.includes("neft") || h.includes("imps"))
    return find("bank", "transfer", "neft", "imps");
  return null;
}

/**
 * Read one handwritten note (one or more photos of the same paper) into a
 * draft entry. Throws on any failure — offline, quota, unreadable — and the
 * caller surfaces that directly, since there is no fallback reader.
 */
export async function scanNoteWithGemini(files: File[]): Promise<ScannedNote> {
  const images = await Promise.all(files.map((f) => fileToGeminiImage(f)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data: GeminiNoteResponse;
  try {
    const { data: result, error } = await supabase.functions.invoke<GeminiNoteResponse>(
      "scan-note",
      {
        body: {
          images: images.map((im) => ({ imageBase64: im.base64, mimeType: im.mimeType })),
        },
        signal: controller.signal,
      },
    );
    if (error) throw error;
    if (!result) throw new Error("Empty response from scan-note.");
    data = result;
  } finally {
    clearTimeout(timer);
  }
  if (data.error) throw new Error(data.error);

  const confidence =
    data.confidence === "high" || data.confidence === "low" ? data.confidence : "medium";

  // Categorize off the same keyword map the bill scanner uses, reading both the
  // English description and the raw text so a Hindi-only slip still matches.
  const categoryText = [data.description, data.detail, data.originalText]
    .filter(Boolean)
    .join(" ");

  return {
    date: data.date ?? "",
    description: data.description ?? "",
    detail: data.detail ?? "",
    amount: data.amount ? String(data.amount) : "",
    amountInWords: data.amountInWords ?? "",
    mode: data.mode ?? "",
    notes: data.notes ?? "",
    originalText: data.originalText ?? "",
    isInformal: data.isInformal === true,
    confidence,
    category: guessCategory(categoryText),
  };
}
