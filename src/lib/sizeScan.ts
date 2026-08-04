// Reads a handwritten MEASUREMENT SLIP — a timber/marble dealer's kaccha bill,
// written as a list of sizes rather than a table of quantities — via the
// `scan-sizes` Supabase Edge Function (Gemini vision).
//
// The reader transcribes dimensions only; every multiplication happens here, on
// device, with cftFrom(). That split is deliberate: the dealer's own total is
// kept as `writtenQty` and reconciled against the app's arithmetic in the review
// screen, which is only a real check if the two were computed independently.
//
// Like noteScan.ts there is NO on-device fallback — Tesseract cannot read
// handwritten tally marks or a superscript ¼ — so a failure here says "type it
// in" rather than producing a plausible-looking wrong bill.
import { supabase } from "./supabase";
import { fileToGeminiImage } from "./geminiScan";
import { guessCategory } from "./scanParse";
import type { Category } from "../../shared/constants";

// Matches geminiScan.ts / noteScan.ts: scan-sizes now waits out a busy or
// rate-limited Gemini (its own budget caps that at ~100s), and 40s was already
// aborting good reads over mobile data. There is no fallback reader here, so an
// abort means retyping every three-way measurement by hand.
const TIMEOUT_MS = 120_000;

/** One size line: a timber section and how many pieces of it were bought. */
export interface ScannedSizeLine {
  length: string; // feet
  width: string; // inches
  thickness: string; // inches
  pieces: string;
  raw: string; // the line as written, for checking against the photo
}

/** A whole measurement slip, in the string shapes the review form expects. */
export interface ScannedSizes {
  material: string;
  vendor: string;
  date: string; // YYYY-MM-DD or ""
  category: Category | "";
  lines: ScannedSizeLine[];
  /** The dealer's own totals, kept verbatim so the app can disagree with them. */
  writtenPieces: string;
  writtenQty: string;
  qtyUnit: string;
  rate: string;
  writtenLineAmount: string;
  otherCharges: string;
  otherChargesLabel: string;
  writtenTotal: string;
  originalText: string;
  confidence: "high" | "medium" | "low";
}

interface GeminiSizesResponse {
  material: string;
  vendor: string;
  date: string;
  lines: {
    length: number;
    width: number;
    thickness: number;
    pieces: number;
    raw: string;
  }[];
  totalPieces: number;
  totalQty: number;
  qtyUnit: string;
  rate: number;
  lineAmount: number;
  otherCharges: number;
  otherChargesLabel: string;
  grandTotal: number;
  originalText: string;
  confidence: string;
  error?: string;
}

/** A number the reader may have left at 0 to mean "not written on the paper". */
const optional = (n: number | undefined | null): string =>
  n != null && n !== 0 ? String(n) : "";

/**
 * Read one measurement slip (one or more photos of the same paper) into a draft
 * bill. Throws on any failure — offline, quota, unreadable — which the caller
 * surfaces directly, since there is no fallback reader for handwriting.
 */
export async function scanSizesWithGemini(files: File[]): Promise<ScannedSizes> {
  const images = await Promise.all(files.map((f) => fileToGeminiImage(f)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data: GeminiSizesResponse;
  try {
    const { data: result, error } = await supabase.functions.invoke<GeminiSizesResponse>(
      "scan-sizes",
      {
        body: {
          images: images.map((im) => ({ imageBase64: im.base64, mimeType: im.mimeType })),
        },
        signal: controller.signal,
      },
    );
    if (error) throw error;
    if (!result) throw new Error("Empty response from scan-sizes.");
    data = result;
  } finally {
    clearTimeout(timer);
  }
  if (data.error) throw new Error(data.error);
  if (!Array.isArray(data.lines) || data.lines.length === 0) {
    throw new Error(
      "No size lines were found on that photo. If it's a printed bill with quantity and rate columns, use “Take photo” instead.",
    );
  }

  const confidence =
    data.confidence === "high" || data.confidence === "low" ? data.confidence : "medium";

  return {
    material: data.material ?? "",
    vendor: data.vendor ?? "",
    date: data.date ?? "",
    // A timber slip's only clue to the category is its heading ("Teak") and
    // whatever else is scribbled on it — the same keyword map the other two
    // readers use turns that into Wood / Marble / Tiles.
    category: guessCategory([data.material, data.originalText].filter(Boolean).join(" ")),
    lines: data.lines.map((l) => ({
      length: optional(l.length),
      width: optional(l.width),
      thickness: optional(l.thickness),
      // A missing count means the one piece the size describes.
      pieces: l.pieces != null && l.pieces > 0 ? String(l.pieces) : "1",
      raw: l.raw ?? "",
    })),
    writtenPieces: optional(data.totalPieces),
    writtenQty: optional(data.totalQty),
    qtyUnit: data.qtyUnit || "cft",
    rate: optional(data.rate),
    writtenLineAmount: optional(data.lineAmount),
    otherCharges: optional(data.otherCharges),
    otherChargesLabel: data.otherChargesLabel ?? "",
    writtenTotal: optional(data.grandTotal),
    originalText: data.originalText ?? "",
    confidence,
  };
}
