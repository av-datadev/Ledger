// The contractor side's own books: sites and their money.
//
// Everything here is device-local (see ContractorSite in types.ts). A
// contractor is not part of any household, so none of this goes through the
// sync engine — which is also the only way a contractor would trust putting
// real numbers in.

import { db } from "../db";
import { fileToAttachment } from "./attach";
import { siteBalance, type SiteBalance } from "./advance";
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
 * failure can't leave orphaned ledger rows pointing at a missing site. */
export async function deleteSite(id: string): Promise<void> {
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
    createdAt: now,
    updatedAt: now,
  });
}

export async function deleteLedgerRow(id: string): Promise<void> {
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
