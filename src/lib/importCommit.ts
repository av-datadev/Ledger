// Duplicate detection for an imported batch, and the write that saves it.
//
// Importing is the one action in this app that can double a person's books in
// a single tap. Someone migrating a history will import twice — once to see
// what happens, once for real — and a phone note pasted today overlaps the
// spreadsheet imported last week. So every row is checked against what is
// already in the ledger AND against the rest of its own batch, and anything
// that looks like a repeat arrives already unticked.
//
// The check is deliberately conservative in one direction: it would rather
// flag a genuine second payment (which the person unticks in one tap) than
// silently let a repeat through (which they may not notice for months).
import { db } from "../db";
import type { Entry, CustomCategory } from "../types";
import type { DraftEntry } from "./importParse";

// Custom categories sort after every built-in (mirrors CUSTOM_ORDER in db.ts).
const CUSTOM_ORDER = 1000;

/** Words that carry no signal when comparing two descriptions. */
const STOPWORDS = new Set([
  "for", "the", "to", "of", "and", "a", "an", "paid", "payment", "rs", "inr",
  "cash", "bill", "amount", "advance", "given", "ka", "ke", "ki", "se", "me",
]);

/** Description reduced to its meaningful words, lowercased. */
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * How much of the SHORTER description the two share (containment), not how
 * much they share overall.
 *
 * The difference decides real cases. An old sheet says "cement"; the ledger
 * says "Cement 50 bags / Kisan Traders". Measured symmetrically those overlap
 * only a quarter and the repeat goes unflagged — but one is plainly the terse
 * version of the other, and on the same day for the same rupee amount it is the
 * same payment. Containment scores that 1.0 and catches it, while two genuinely
 * different spends that happen to collide on date and amount ("Paint 20L" vs
 * "Mason wages") still share nothing and are left alone.
 */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}

/** Amounts equal to the paise, tolerating float noise from parsing. */
const sameMoney = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/**
 * Does this draft look like a record the ledger already holds?
 *
 * Same date and same amount is the spine of the test — two payments of exactly
 * ₹4,500 on exactly the same day are far more often one payment entered twice
 * than two real ones. Descriptions then break the tie: clearly different text
 * ("cement" vs "mason wages") means they really are two payments and the row is
 * left alone.
 */
function matches(draft: DraftEntry, existing: { date: string; amount: number; event: string; detail: string }): boolean {
  const amount = parseFloat(draft.amount);
  if (!Number.isFinite(amount)) return false;
  if (draft.date !== existing.date) return false;
  if (!sameMoney(amount, existing.amount)) return false;

  const a = tokens(`${draft.event} ${draft.detail}`);
  const b = tokens(`${existing.event} ${existing.detail}`);
  // Either side blank: date+amount alone is enough to be worth flagging.
  if (a.size === 0 || b.size === 0) return true;
  // Half the shorter description in common. Low on purpose — an unflagged
  // repeat is a number the person may never reconcile, while a wrongly flagged
  // row costs them one tap on a screen they are already reading line by line.
  return similarity(a, b) >= 0.5;
}

export interface DuplicateReport {
  drafts: DraftEntry[];
  /** How many rows were flagged and pre-unticked. */
  flagged: number;
}

/**
 * Flag every draft that repeats an existing entry or an earlier row of the same
 * batch, and untick it. Returns new draft objects — the caller's array is left
 * alone so this can be re-run when rows are edited.
 */
export function markDuplicates(
  drafts: DraftEntry[],
  existing: Entry[],
): DuplicateReport {
  // Bucket the ledger by date: the vast majority of comparisons are against a
  // different day, and an import of 800 rows against a ledger of thousands
  // shouldn't be quadratic.
  const byDate = new Map<string, Entry[]>();
  for (const e of existing) {
    const arr = byDate.get(e.date);
    if (arr) arr.push(e);
    else byDate.set(e.date, [e]);
  }

  // Rows already accepted from this same batch, so a note that lists the same
  // payment twice is caught as well.
  const withinBatch = new Map<string, DraftEntry[]>();
  let flagged = 0;

  const out = drafts.map((d) => {
    let duplicateOf: string | null = null;

    if (d.date && d.amount) {
      const sameDay = byDate.get(d.date) ?? [];
      const hit = sameDay.find((e) => matches(d, e));
      if (hit) duplicateOf = hit.id;

      if (!duplicateOf) {
        const batchSameDay = withinBatch.get(d.date) ?? [];
        const twin = batchSameDay.find((other) =>
          matches(d, {
            date: other.date,
            amount: parseFloat(other.amount),
            event: other.event,
            detail: other.detail,
          }),
        );
        if (twin) duplicateOf = "batch";
      }

      const arr = withinBatch.get(d.date);
      if (arr) arr.push(d);
      else withinBatch.set(d.date, [d]);
    }

    if (!duplicateOf) return d;
    flagged++;
    return { ...d, duplicateOf, include: false };
  });

  return { drafts: out, flagged };
}

/** A draft that is ticked, complete, and therefore saveable. */
export function saveableDrafts(drafts: DraftEntry[]): DraftEntry[] {
  return drafts.filter(
    (d) =>
      d.include &&
      d.date !== "" &&
      Number.isFinite(parseFloat(d.amount)) &&
      (d.event.trim() !== "" || d.detail.trim() !== ""),
  );
}

/**
 * Write the ticked rows into the ledger as one transaction, so a failure
 * halfway through leaves nothing behind rather than half an import the person
 * then has to find and undo. Returns how many were added.
 */
export async function commitImport(
  drafts: DraftEntry[],
  source: string,
): Promise<number> {
  const rows = saveableDrafts(drafts);
  if (rows.length === 0) return 0;

  const now = Date.now();
  const entries: Entry[] = rows.map((d) => ({
    id: crypto.randomUUID(),
    date: d.date,
    category: d.category || "Misc",
    event: d.event.trim() || d.detail.trim(),
    detail: d.detail.trim(),
    amount: parseFloat(d.amount),
    mode: d.mode.trim(),
    paidBy: d.paidBy.trim(),
    // Stamping the source is what makes an import undoable later: these rows
    // are otherwise indistinguishable from hand-typed ones, and someone who
    // imports the wrong file needs to be able to find them again.
    notes: [d.notes.trim(), `Imported from ${source}`].filter(Boolean).join(" · "),
    createdAt: now,
    updatedAt: now,
  }));

  // An old sheet names heads this ledger has never seen ("Labour", "Tempo").
  // Creating those as real category rows keeps the imported entries visible in
  // every filter and picker — without it they'd carry a category the app's own
  // lists don't contain, and quietly vanish from the category breakdown.
  const have = new Set(
    (await db.categories.toArray()).map((c) => c.name.toLowerCase()),
  );
  const newCategories: CustomCategory[] = [
    ...new Set(entries.map((e) => e.category)),
  ]
    .filter((name) => name && !have.has(name.toLowerCase()))
    .map((name) => ({
      id: crypto.randomUUID(),
      name,
      order: CUSTOM_ORDER,
      createdAt: now,
    }));

  await db.transaction("rw", [db.entries, db.categories], async () => {
    if (newCategories.length) await db.categories.bulkAdd(newCategories);
    await db.entries.bulkAdd(entries);
  });
  return entries.length;
}
