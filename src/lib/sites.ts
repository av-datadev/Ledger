// The contractor side's own books: sites and their money.
//
// Everything here is device-local (see ContractorSite in types.ts). A
// contractor is not part of any household, so none of this goes through the
// sync engine — which is also the only way a contractor would trust putting
// real numbers in.

import { db } from "../db";
import { fileToAttachment } from "./attach";
import { siteBalance, type SiteBalance } from "./advance";
import { updateSharedEntry, unshareEntry } from "./siteLink";
import type { ContractorSite, SiteLedgerRow } from "../types";

export type { SiteBalance };

export const LEDGER_KINDS: {
  value: SiteLedgerRow["kind"];
  label: string;
  isSpend: boolean;
}[] = [
  { value: "received", label: "Received from owner", isSpend: false },
  { value: "material", label: "Material bought", isSpend: true },
  { value: "labour", label: "Labour paid", isSpend: true },
  { value: "other", label: "Other spend", isSpend: true },
];

export async function createSite(input: {
  name: string;
  ownerName: string;
  ownerPhone: string;
  address: string;
  contractAmount: number | null;
  startDate: string;
  notes: string;
}): Promise<ContractorSite> {
  const now = Date.now();
  const site: ContractorSite = {
    id: crypto.randomUUID(),
    ...input,
    status: "active",
    linkId: null,
    linkStatus: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.sites.add(site);
  return site;
}

export async function updateSite(
  id: string,
  patch: Partial<Omit<ContractorSite, "id" | "createdAt">>,
): Promise<void> {
  await db.sites.update(id, { ...patch, updatedAt: Date.now() });
}

/** Remove a site and everything logged against it, in one transaction so a
 * failure can't leave orphaned ledger rows pointing at a missing site.
 *
 * Rows the owner was shown are withdrawn first, for the reason spelled out on
 * deleteLedgerRow — and before the transaction, because a network call inside a
 * Dexie transaction would hold it open across an unbounded wait. */
export async function deleteSite(id: string): Promise<void> {
  const rows = await db.siteLedger.where("siteId").equals(id).toArray();
  const site = await db.sites.get(id);
  for (const r of rows) {
    if (!r.sharedId) continue;
    await unshareEntry(
      r.sharedId,
      r.proof && site?.linkId ? `${site.linkId}/${r.sharedId}.jpg` : null,
    );
  }
  await db.transaction("rw", [db.sites, db.siteLedger], async () => {
    await db.siteLedger.where("siteId").equals(id).delete();
    await db.sites.delete(id);
  });
}

export async function addLedgerRow(input: {
  siteId: string;
  date: string;
  kind: SiteLedgerRow["kind"];
  description: string;
  amount: number;
  notes: string;
  proofFile?: File | null;
}): Promise<void> {
  // Compress the proof photo the same way ledger attachments are, so a site
  // with a year of bills doesn't balloon the on-device database.
  let proof: Blob | null = null;
  let proofName = "";
  if (input.proofFile) {
    const img = await fileToAttachment(input.proofFile);
    proof = img.blob;
    proofName = img.name;
  }
  const now = Date.now();
  await db.siteLedger.add({
    id: crypto.randomUUID(),
    siteId: input.siteId,
    date: input.date,
    kind: input.kind,
    description: input.description,
    amount: input.amount,
    proof,
    proofName,
    notes: input.notes,
    sharedId: null,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Correct a row already logged.
 *
 * Until this existed the only way to fix a wrong figure was to delete the row
 * and type it again, which threw away the bill photo attached to it — leaving
 * the app worse at the commonest event in bookkeeping than the paper diary it
 * replaces, where you simply score a number out and write the right one.
 *
 * `proofFile` says what should happen to the photo, and the three cases are
 * genuinely different: `undefined` keeps it (most edits are a typo in an
 * amount), a File replaces it, and `null` removes it.
 *
 * When the row has been shown to the owner, his copy is corrected FIRST and a
 * failure aborts the whole edit. The alternative — save locally, hope the
 * shared copy catches up — is exactly the silent divergence the shared ledger
 * exists to prevent, and it would surface months later as the contractor's
 * book and the owner's screen disagreeing with nobody able to say when they
 * parted. An unshared row is purely local and needs no network at all.
 */
export async function updateLedgerRow(
  id: string,
  input: {
    date: string;
    kind: SiteLedgerRow["kind"];
    description: string;
    amount: number;
    notes: string;
    proofFile?: File | null;
  },
  /** The approved link for this row's site, when there is one. */
  linkId?: string | null,
): Promise<void> {
  const existing = await db.siteLedger.get(id);
  if (!existing) throw new Error("That row is no longer here.");

  const patch: Partial<SiteLedgerRow> = {
    date: input.date,
    kind: input.kind,
    description: input.description,
    amount: input.amount,
    notes: input.notes,
    updatedAt: Date.now(),
  };

  if (input.proofFile === null) {
    patch.proof = null;
    patch.proofName = "";
  } else if (input.proofFile) {
    const img = await fileToAttachment(input.proofFile);
    patch.proof = img.blob;
    patch.proofName = img.name;
  }

  const proof = "proof" in patch ? patch.proof! : existing.proof;

  if (existing.sharedId && linkId) {
    await updateSharedEntry({
      id: existing.sharedId,
      linkId,
      date: input.date,
      kind: input.kind === "received" ? "payment" : "spend",
      description: input.description || LEDGER_KINDS.find((k) => k.value === input.kind)!.label,
      amount: input.amount,
      notes: input.notes,
      proof,
    });
  }

  await db.siteLedger.update(id, patch);
}

/** Record that a local row now has a twin in the shared ledger. */
export async function markRowShared(
  rowId: string,
  sharedId: string | null,
): Promise<void> {
  await db.siteLedger.update(rowId, { sharedId, updatedAt: Date.now() });
}

/** Remember the outcome of a link request against the local site. */
export async function setSiteLink(
  siteId: string,
  linkId: string | null,
  linkStatus: ContractorSite["linkStatus"],
): Promise<void> {
  await db.sites.update(siteId, { linkId, linkStatus, updatedAt: Date.now() });
}

/**
 * Delete a row, and withdraw the owner's copy of it if he has one.
 *
 * A row deleted here that stays visible on the owner's screen is the precise
 * failure the shared ledger was built to prevent: one side holding a figure the
 * other has no record of, discovered later as "you showed me this ₹80,000 and
 * now it's not in your book". So the retraction is not a follow-up — it fails
 * the delete. Better a row that won't go away without signal than two books
 * that disagree and nobody knowing when they started to.
 */
export async function deleteLedgerRow(
  id: string,
  /** The approved link for this row's site, when there is one. */
  linkId?: string | null,
): Promise<void> {
  const existing = await db.siteLedger.get(id);
  if (existing?.sharedId) {
    await unshareEntry(
      existing.sharedId,
      existing.proof && linkId ? `${linkId}/${existing.sharedId}.jpg` : null,
    );
  }
  await db.siteLedger.delete(id);
}

/** The running position on one site — see siteBalance() for what it means. */
export function balanceOf(rows: SiteLedgerRow[]): SiteBalance {
  return siteBalance(
    rows.map((r) => ({ kind: r.kind, amount: r.amount, hasProof: !!r.proof })),
  );
}

/** Per-site balances keyed by site id, for the list view. */
export function balancesBySite(
  rows: SiteLedgerRow[],
): Map<string, SiteBalance> {
  const grouped = new Map<string, SiteLedgerRow[]>();
  for (const r of rows) {
    const arr = grouped.get(r.siteId) ?? [];
    arr.push(r);
    grouped.set(r.siteId, arr);
  }
  const out = new Map<string, SiteBalance>();
  for (const [siteId, list] of grouped) out.set(siteId, balanceOf(list));
  return out;
}
