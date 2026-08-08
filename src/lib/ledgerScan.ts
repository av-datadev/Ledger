// Reads a free-form expense history into many draft entries via the
// `scan-ledger` Supabase Edge Function (Gemini).
//
// The fallback path of the importer. importParse.ts handles anything with
// recognisable columns entirely on-device; this is what runs when the source is
// a phone note, a WhatsApp thread, or a sheet too irregular to map. Nothing
// reaches here without the person having been asked first — see
// useAiConsent + the bulk-import prompt in ImportEntries.
import { supabase } from "./supabase";
import { edgeFunctionError } from "./geminiScan";
import type { DraftEntry } from "./importParse";
import { parseImportDate } from "./importParse";

// Comfortably under the Edge Function's own 60k cap, with room for the prompt.
const CHUNK_CHARS = 24_000;
const TIMEOUT_MS = 60_000;

export interface ScannedLedger {
  drafts: DraftEntry[];
  confidence: "high" | "medium" | "low";
  /** Something the reader wants checked — assumed years, suspected totals. */
  warning: string;
}

interface GeminiEntry {
  date: string;
  event: string;
  detail: string;
  amount: number;
  mode: string;
  paidBy: string;
  category: string;
  notes: string;
  raw: string;
}

interface GeminiLedgerResponse {
  entries: GeminiEntry[];
  confidence: string;
  warning: string;
  error?: string;
}

/**
 * Split a long history on line boundaries. A hand-kept list runs to thousands
 * of lines, and one call carrying all of it is both slow and likelier to be
 * truncated mid-array. Splitting on newlines (never mid-line) keeps every
 * record intact; the only thing lost across a boundary is a date heading, and
 * the chunk overlap below covers that.
 */
export function chunkText(text: string, limit = CHUNK_CHARS): string[] {
  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    // +1 for the newline we'll rejoin with.
    if (size + line.length + 1 > limit && current.length) {
      chunks.push(current.join("\n"));
      // Carry the last few lines forward: a "15 March" heading sitting at the
      // end of one chunk is what dates the first rows of the next.
      current = current.slice(-3);
      size = current.reduce((s, l) => s + l.length + 1, 0);
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks.filter((c) => c.trim());
}

/** Drop rows repeated across a chunk boundary by the deliberate overlap. */
function dedupeOverlap(drafts: DraftEntry[]): DraftEntry[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const key = `${d.date}|${d.amount}|${d.raw.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toDraft(e: GeminiEntry): DraftEntry {
  // The reader is asked for ISO, but re-parsing costs nothing and catches a
  // reply that slipped back into DD/MM.
  const date = parseImportDate(e.date ?? "");
  const amount = Number.isFinite(e.amount) && e.amount !== 0 ? e.amount : null;
  const issues: string[] = [];
  if (amount == null) issues.push("no amount");
  if (!date) issues.push("no date");

  return {
    include: issues.length === 0,
    date,
    category: e.category ?? "",
    event: e.event ?? "",
    detail: e.detail ?? "",
    amount: amount == null ? "" : String(amount),
    mode: e.mode ?? "",
    paidBy: e.paidBy ?? "",
    notes: e.notes ?? "",
    raw: e.raw ?? "",
    duplicateOf: null,
    issues,
  };
}

/**
 * Read one block of text into draft entries, in as many calls as its length
 * needs. `onProgress` reports chunk-by-chunk so a long history doesn't sit on a
 * silent spinner. Throws on any failure — there is no on-device fallback for
 * free-form text, so the honest answer is "map the columns instead".
 */
export async function scanLedgerText(
  text: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ScannedLedger> {
  const chunks = chunkText(text);
  const drafts: DraftEntry[] = [];
  const warnings: string[] = [];
  let worst: "high" | "medium" | "low" = "high";

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i, chunks.length);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let data: GeminiLedgerResponse;
    try {
      const { data: result, error } = await supabase.functions.invoke<GeminiLedgerResponse>(
        "scan-ledger",
        { body: { text: chunks[i] }, signal: controller.signal },
      );
      if (error) throw new Error(await edgeFunctionError(error));
      if (!result) throw new Error("Empty response from scan-ledger.");
      data = result;
    } finally {
      clearTimeout(timer);
    }
    if (data.error) throw new Error(data.error);
    if (!Array.isArray(data.entries)) {
      throw new Error("Malformed response from scan-ledger.");
    }

    drafts.push(...data.entries.map(toDraft));
    if (data.warning) warnings.push(data.warning);
    if (data.confidence === "low") worst = "low";
    else if (data.confidence === "medium" && worst === "high") worst = "medium";
  }
  onProgress?.(chunks.length, chunks.length);

  if (drafts.length === 0) {
    throw new Error(
      "No expenses were found in that text. Check it lists payments with amounts, or map the columns by hand instead.",
    );
  }

  return {
    drafts: dedupeOverlap(drafts),
    confidence: worst,
    // Several chunks each flagging the same thing shouldn't say it four times.
    warning: [...new Set(warnings)].join(" "),
  };
}
