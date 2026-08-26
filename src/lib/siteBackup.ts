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
import { replaceCloudWithLocal } from "./siteSync";
import type { ContractorSite, SiteLedgerRow, SiteProof } from "../types";

// Written into the file, so the Brick Book rename can't just replace it: every
// sites backup already on a contractor's phone says "brick-flow-contractor".
// New files carry the new tag; both are accepted on import. A contractor's site
// books are device-local and this file is their only copy, so refusing to read
// an older one would lose exactly the data the feature exists to protect.
const APP_TAG = "brick-book-contractor";
const LEGACY_APP_TAG = "brick-flow-contractor";
const PROOF_MIME = "image/jpeg";

// The proof photo is a Blob, which JSON can't hold — carry it as base64.
//
// The FILE format is deliberately unchanged now that photos live in their own
// table: `proofData` stays on the row on the wire, because backup files already
// exist in people's Drive and a reader that no longer understands them turns a
// safety net into a pile of unreadable JSON. The split happens on the way in
// and out, not in the format.
type SerializedRow = Omit<SiteLedgerRow, "hasProof"> & {
  proofData: string | null;
};

interface SiteBackupFile {
  app: typeof APP_TAG | typeof LEGACY_APP_TAG;
  version: 1;
  exportedAt: string;
  sites: ContractorSite[];
  ledger: SerializedRow[];
}

export interface ParsedSiteBackup {
  exportedAt: string;
  sites: ContractorSite[];
  ledger: SiteLedgerRow[];
  /** Photos, split back out of the rows they arrived attached to. */
  proofs: SiteProof[];
}

/** Write every site and its money log out as one JSON file, photos included. */
export async function exportSiteBackup(): Promise<{ sites: number; rows: number }> {
  const [sites, rows, proofs] = await Promise.all([
    db.sites.toArray(),
    db.siteLedger.toArray(),
    db.siteProofs.toArray(),
  ]);
  const byRow = new Map(proofs.map((p) => [p.rowId, p]));

  const ledger: SerializedRow[] = await Promise.all(
    rows.map(async ({ hasProof, ...rest }) => {
      const p = hasProof ? byRow.get(rest.id) : undefined;
      return {
        ...rest,
        // Only the full photo travels. A thumbnail is a derived convenience
        // that any device can rebuild in milliseconds; carrying it would grow
        // every backup file for nothing.
        proofData: p ? await blobToBase64(p.blob) : null,
      };
    }),
  );

  const payload: SiteBackupFile = {
    app: APP_TAG,
    version: 1,
    exportedAt: new Date().toISOString(),
    sites,
    ledger,
  };

  downloadFile(
    `brick-book-sites-${timestampSlug()}.json`,
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
  if (
    (data.app !== APP_TAG && data.app !== LEGACY_APP_TAG) ||
    !Array.isArray(data.sites) ||
    !Array.isArray(data.ledger)
  ) {
    throw new Error("That file doesn't look like a Brick Book sites backup.");
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
  // Carries proofData one step further than the final shape so the photos can
  // be split off below without walking the source array twice.
  const ledger: (SiteLedgerRow & { proofData: string | null })[] = data.ledger
    .filter(
      (r): r is SerializedRow =>
        !!r && typeof r.id === "string" && siteIds.has(r.siteId),
    )
    .map(({ proofData, ...rest }) => ({
      ...rest,
      amount: Number(rest.amount) || 0,
      sharedId: rest.sharedId ?? null,
      hasProof: !!proofData,
      proofData,
    }));

  const proofs: SiteProof[] = ledger.flatMap((r) =>
    r.proofData
      ? [
          {
            id: crypto.randomUUID(),
            rowId: r.id,
            siteId: r.siteId,
            blob: base64ToBlob(r.proofData, PROOF_MIME),
            thumb: null, // rebuilt on first view
            mime: PROOF_MIME,
            name: "",
            w: 0,
            h: 0,
            createdAt: Date.now(),
          },
        ]
      : [],
  );

  return {
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
    sites,
    ledger: ledger.map(({ proofData, ...row }) => {
      void proofData;
      return row;
    }),
    proofs,
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
  await db.transaction(
    "rw",
    [db.sites, db.siteLedger, db.siteProofs],
    async () => {
      await db.siteProofs.clear();
      await db.siteLedger.clear();
      await db.sites.clear();
      await db.sites.bulkAdd(backup.sites);
      await db.siteLedger.bulkAdd(backup.ledger);
      await db.siteProofs.bulkAdd(backup.proofs);
    },
  );
  // Carry the replacement through to the cloud copy, if there is one. Dexie's
  // bulk operations bypass the row hooks sync relies on, so the cloud would
  // otherwise still hold the replaced books — and reconcile, seeing rows the
  // device lacks, would pull them straight back.
  await replaceCloudWithLocal();
}
