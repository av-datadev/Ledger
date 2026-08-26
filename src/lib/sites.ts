// The contractor side's own books: sites and their money.
//
// Everything here is device-local (see ContractorSite in types.ts). A
// contractor is not part of any household, so none of this goes through the
// sync engine — which is also the only way a contractor would trust putting
// real numbers in.

import { db } from "../db";
import { fileToAttachment, makeThumb, type ProcessedImage } from "./attach";
import { siteBalance, type SiteBalance } from "./advance";
import { updateSharedEntry, unshareEntry } from "./siteLink";
import type { ContractorSite, SiteLedgerRow, SiteProof } from "../types";

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
      r.hasProof && site?.linkId ? `${site.linkId}/${r.sharedId}.jpg` : null,
    );
  }
  await db.transaction("rw", [db.sites, db.siteLedger, db.siteProofs], async () => {
    // Keyed by siteId, which is why the proof row carries it: clearing a site's
    // photos otherwise means reading every row first just to learn their ids.
    await db.siteProofs.where("siteId").equals(id).delete();
    await db.siteLedger.where("siteId").equals(id).delete();
    await db.sites.delete(id);
  });
}

/**
 * Store (or replace) the photo behind one row, thumbnail and all.
 *
 * One photo per row, so an existing one is cleared first — otherwise replacing
 * a mis-shot bill would silently leave both, and the reader picks whichever
 * comes back first.
 */
async function putProof(
  rowId: string,
  siteId: string,
  img: ProcessedImage,
): Promise<void> {
  const thumb = await makeThumb(img.blob);
  await db.transaction("rw", db.siteProofs, async () => {
    await db.siteProofs.where("rowId").equals(rowId).delete();
    await db.siteProofs.add({
      id: crypto.randomUUID(),
      rowId,
      siteId,
      blob: img.blob,
      thumb,
      mime: img.mime,
      name: img.name,
      w: img.w,
      h: img.h,
      createdAt: Date.now(),
    });
  });
}

/** The photo behind a row, or null. */
export async function getProof(rowId: string): Promise<SiteProof | null> {
  return (await db.siteProofs.where("rowId").equals(rowId).first()) ?? null;
}

/**
 * The thumbnail for a row's photo, made on demand if it doesn't exist yet.
 *
 * Photos migrated from before this table had no thumbnail — generating them all
 * inside the upgrade would have held a Dexie transaction open across an
 * unbounded amount of canvas work. So the first view of an old row pays for
 * one, and every view after that is free. A device that cannot generate one
 * falls back to the full photo, which is what it displayed before.
 */
export async function proofThumb(rowId: string): Promise<Blob | null> {
  const p = await getProof(rowId);
  if (!p) return null;
  if (p.thumb) return p.thumb;
  const thumb = await makeThumb(p.blob);
  if (thumb) await db.siteProofs.update(p.id, { thumb });
  return thumb ?? p.blob;
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
  const img = input.proofFile ? await fileToAttachment(input.proofFile) : null;
  const now = Date.now();
  const id = crypto.randomUUID();
  await db.siteLedger.add({
    id,
    siteId: input.siteId,
    date: input.date,
    kind: input.kind,
    description: input.description,
    amount: input.amount,
    hasProof: !!img,
    notes: input.notes,
    sharedId: null,
    createdAt: now,
    updatedAt: now,
  });
  if (img) await putProof(id, input.siteId, img);
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

  // The photo is written AFTER the shared copy is accepted, further down, so a
  // failed share leaves the row and its photo exactly as they were.
  let nextImg: ProcessedImage | null = null;
  if (input.proofFile === null) {
    patch.hasProof = false;
  } else if (input.proofFile) {
    nextImg = await fileToAttachment(input.proofFile);
    patch.hasProof = true;
  }

  // What the owner's copy should carry: the replacement if there is one, the
  // existing photo if this edit doesn't touch it, and nothing if it was removed.
  const proof =
    nextImg?.blob ??
    (input.proofFile === null ? null : ((await getProof(id))?.blob ?? null));

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
      existing.hasProof && linkId ? `${linkId}/${existing.sharedId}.jpg` : null,
    );
  }
  // The photo goes with the row. Left behind it is unreachable bytes — nothing
  // can display a proof whose row no longer exists — quietly filling the phone.
  await db.transaction("rw", [db.siteLedger, db.siteProofs], async () => {
    await db.siteProofs.where("rowId").equals(id).delete();
    await db.siteLedger.delete(id);
  });
}

/** The running position on one site — see siteBalance() for what it means. */
export function balanceOf(rows: SiteLedgerRow[]): SiteBalance {
  return siteBalance(
    rows.map((r) => ({ kind: r.kind, amount: r.amount, hasProof: r.hasProof })),
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
