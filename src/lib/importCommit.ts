// Writes reviewed draft entries into the ledger.
//
// Kept apart from the parsing so that nothing can write to the database as a
// side effect of working out what a file says. This function is reached only
// from the review screen's confirm button, after a person has seen the rows.

import { db } from "../db";
import type { DraftEntry } from "./importParse";
import type { CustomCategory } from "../types";

const CUSTOM_ORDER = 1000; // mirrors db.ts — custom categories sort after built-ins

export interface CommitResult {
  entries: number;
  newCategories: string[];
}

/**
 * Add every draft as a ledger entry, creating any category that doesn't exist.
 *
 * Adds rather than replaces: an import is something a person does ON TOP of
 * whatever is already in the app, unlike a backup restore, which is a
 * wholesale swap. Someone importing their old sheet after a week of using the
 * app must not lose that week.
 *
 * The whole thing is one transaction, so a failure part-way leaves nothing
 * behind — half an imported ledger is worse than none, because the person
 * cannot tell which half.
 */
export async function commitImport(
  drafts: DraftEntry[],
): Promise<CommitResult> {
  const now = Date.now();

  const wanted = Array.from(
    new Set(
      drafts
        .map((d) => d.category.trim())
        .filter((c) => c.length > 0),
    ),
  );

  const created: string[] = [];

  await db.transaction("rw", [db.entries, db.categories], async () => {
    const existing = await db.categories.toArray();
    const known = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    const maxOrder = existing.reduce(
      (m, c) => Math.max(m, c.order ?? CUSTOM_ORDER),
      CUSTOM_ORDER,
    );

    const toAdd: CustomCategory[] = [];
    wanted.forEach((name) => {
      if (known.has(name.toLowerCase())) return;
      known.add(name.toLowerCase());
      created.push(name);
      toAdd.push({
        id: crypto.randomUUID(),
        name,
        order: maxOrder + toAdd.length + 1,
        createdAt: now,
      });
    });
    if (toAdd.length) await db.categories.bulkAdd(toAdd);

    await db.entries.bulkAdd(
      drafts.map((d, i) => ({
        id: crypto.randomUUID(),
        date: d.date,
        category: d.category.trim(),
        event: d.event,
        detail: d.detail,
        amount: d.amount,
        mode: d.mode,
        paidBy: d.paidBy,
        notes: d.notes,
        // Spread createdAt by index so an imported batch keeps its file order in
        // the Recent tab instead of arriving as one indistinguishable blob.
        createdAt: now + i,
        updatedAt: now + i,
        // Somebody else's spreadsheet has no notion of this app's bills.
        billAllocations: null,
      })),
    );
  });

  return { entries: drafts.length, newCategories: created };
}
