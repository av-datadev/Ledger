// The two calls that ask the server how somebody else's file is laid out.
//
// Only a ten-row sample ever crosses this boundary (structure mode), or a bare
// list of category names (categories mode) — never amounts, dates or vendors in
// bulk. The conversion itself happens on the device, in importParse.ts.

import { supabase } from "./supabase";
import { edgeFunctionError } from "./geminiScan";
import type { ImportMapping, CategorySuggestion } from "./importParse";

const EMPTY_MAPPING: ImportMapping = {
  sheetName: "",
  headerRowIndex: -1,
  firstDataRowIndex: 0,
  dateCol: -1,
  amountCol: -1,
  categoryCol: -1,
  detailCol: -1,
  eventCol: -1,
  modeCol: -1,
  paidByCol: -1,
  notesCol: -1,
  dateOrder: "unknown",
  negativeMeansExpense: false,
  skipRowPatterns: [],
  confidence: 0,
  warnings: [],
  questions: [],
};

/** Ask the server to work out the layout from a sample. */
export async function analyseStructure(
  sample: { name: string; rows: unknown[][] }[],
): Promise<ImportMapping> {
  const { data, error } = await supabase.functions.invoke("analyse-import", {
    body: { mode: "structure", sheets: sample },
  });
  if (error) throw new Error(await edgeFunctionError(error));
  const raw = (data ?? {}) as Partial<ImportMapping> & { error?: string };
  if (raw.error) throw new Error(raw.error);
  return {
    ...EMPTY_MAPPING,
    ...raw,
    skipRowPatterns: Array.isArray(raw.skipRowPatterns) ? raw.skipRowPatterns : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    questions: Array.isArray(raw.questions) ? raw.questions : [],
  };
}

/** Ask the server which of their category names map onto ours. Sends only the
 * names — no amounts, no dates, no vendors. */
export async function suggestCategories(
  names: string[],
  existing: string[],
): Promise<CategorySuggestion[]> {
  if (names.length === 0) return [];
  const { data, error } = await supabase.functions.invoke("analyse-import", {
    body: { mode: "categories", names, existing },
  });
  if (error) throw new Error(await edgeFunctionError(error));
  const list = (data as { mappings?: CategorySuggestion[] })?.mappings;
  return Array.isArray(list) ? list : [];
}
