// Backup and restore for the contractor side's own books.
//
// Site books are device-local by design (a contractor has no household, and his
// figures must not be visible to any homeowner — see ContractorSite in
// types.ts). That design has one consequence which has to be answered: nothing
// else is keeping a copy. For a feature whose whole point is having a record
// when someone disputes the money, a lost phone losing the record is worse than
// not having kept it. This file is that answer.
//
// Kept separate from lib/backup.ts rather than bolted onto it: the two cover
// different tables, and the builder's Data tab isn't reachable from the
// contractor side at all. Each format rejects the other's file by name so an
// accidental cross-import fails with a readable message instead of wiping the
// wrong half of the database.

import { db } from "../db";
import { downloadFile, timestampSlug } from "./csv";
import { blobToBase64, base64ToBlob } from "./attach";
import type { ContractorSite, SiteLedgerRow } from "../types";

const APP_TAG = "brick-flow-contractor";
const PROOF_MIME = "image/jpeg";

// The proof photo is a Blob, which JSON can't hold — carry it as base64.
type SerializedRow = Omit<SiteLedgerRow, "proof"> & { proofData: string | null };

interface SiteBackupFile {
  app: typeof APP_TAG;
  version: 1;
  exportedAt: string;
  sites: ContractorSite[];
  ledger: SerializedRow[];
}

export interface ParsedSiteBackup {
  exportedAt: string;
  sites: ContractorSite[];
  ledger: SiteLedgerRow[];
}

/** Write every site and its money log out as one JSON file, photos included. */
export async function exportSiteBackup(): Promise<{ sites: number; rows: number }> {
  const [sites, rows] = await Promise.all([
    db.sites.toArray(),
    db.siteLedger.toArray(),
  ]);

  const ledger: SerializedRow[] = await Promise.all(
    rows.map(async ({ proof, ...rest }) => ({
      ...rest,
      proofData: proof ? await blobToBase64(proof) : null,
    })),
  );

  const payload: SiteBackupFile = {
    app: APP_TAG,
    version: 1,
    exportedAt: new Date().toISOString(),
    sites,
    ledger,
  };

  downloadFile(
    `brick-flow-sites-${timestampSlug()}.json`,
    JSON.stringify(payload, null, 1),
    "application/json",
  );

  return { sites: sites.length, rows: rows.length };
}

/** Parse and sanity-check a site backup file. Throws with a readable message. */
export async function readSiteBackupFile(file: File): Promise<ParsedSiteBackup> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  // `app` widened to string: untrusted input, and it has to be comparable
  // against the builder format's tag as well as this one's literal.
  const data = raw as Omit<Partial<SiteBackupFile>, "app"> & { app?: string };

  // Named check first so the most likely mistake — picking the ledger backup —
  // says what actually went wrong rather than "missing sites array".
  if (data.app === "house-ledger") {
    throw new Error(
      "That's a ledger backup from the home-builder side, not a sites backup. Restore it from the Data tab there instead.",
    );
  }
  if (data.app !== APP_TAG || !Array.isArray(data.sites) || !Array.isArray(data.ledger)) {
    throw new Error("That file doesn't look like a Brick Flow sites backup.");
  }

  // Backups written before site linking existed have no linkId/linkStatus.
  // Default them rather than letting `undefined` reach Dexie, and keep a real
  // link on restore — it lives on the server against this contractor's
  // account, so a new phone should pick his approved sites back up.
  const sites = data.sites
    .filter(
      (s): s is ContractorSite =>
        !!s && typeof s.id === "string" && typeof s.name === "string",
    )
    .map((s) => ({
      ...s,
      linkId: s.linkId ?? null,
      linkStatus: s.linkStatus ?? null,
    }));
  // Drop rows pointing at a site the file doesn't contain — they'd be
  // unreachable in the UI and would silently distort no balance at all.
  const siteIds = new Set(sites.map((s) => s.id));
  const ledger: SiteLedgerRow[] = data.ledger
    .filter(
      (r): r is SerializedRow =>
        !!r && typeof r.id === "string" && siteIds.has(r.siteId),
    )
    .map(({ proofData, ...rest }) => ({
      ...rest,
      amount: Number(rest.amount) || 0,
      sharedId: rest.sharedId ?? null,
      proof: proofData ? base64ToBlob(proofData, PROOF_MIME) : null,
    }));

  return {
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
    sites,
    ledger,
  };
}

/**
 * Replace the site books with the backup's contents, in one transaction.
 *
 * Replace rather than merge: ids are stable, so merging the same file twice
 * would either collide or silently double a site's figures, and a balance that
 * quietly doubles is worse than one that's plainly missing. The caller confirms
 * with the counts first.
 */
export async function applySiteBackup(backup: ParsedSiteBackup): Promise<void> {
  await db.transaction("rw", [db.sites, db.siteLedger], async () => {
    await db.siteLedger.clear();
    await db.sites.clear();
    await db.sites.bulkAdd(backup.sites);
    await db.siteLedger.bulkAdd(backup.ledger);
  });
}
