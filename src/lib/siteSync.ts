// Cloud backup for the contractor's own books — his sites, his money log, and
// the bill photos behind it.
//
// Why this is separate from sync.ts rather than a scope parameter on it:
// sync.ts is household-scoped from top to bottom (a module-level householdId, a
// household_id column on every row, membership-based RLS), and it is carrying
// a family's real ledger in production. The contractor books need a strictly
// narrower rule — one user, no membership, no sharing — so the two engines
// answer different questions about who may read a row. Threading a second
// scoping mode through the working one would put the household ledger at risk
// to save a hundred lines here.
//
// What this does NOT change: what an owner can see. That still lives entirely
// in `shared_entries`, per approved link, per row the contractor chooses to
// show. Nothing backed up here is reachable through that path — a linked
// homeowner cannot see this site, let alone the contractor's other sites.
//
// Outbound: Dexie hooks push every local create/update/delete. Inbound: a
// two-way reconcile on sign-in, which is also the restore path — a new phone
// signs in with an empty database and pulls the books back. There is no
// realtime subscription: unlike a household, these books have one author, so
// the cost of a live channel buys nothing that reconcile-on-open doesn't.

import { supabase } from "./supabase";
import { db } from "../db";
import type { ContractorSite, SiteLedgerRow } from "../types";

const SITES = "contractor_sites";
const LEDGER = "contractor_site_ledger";
const BUCKET = "site-proofs";

/** Sync-infra columns, present remotely and stripped on the way back down. */
interface Infra {
  user_id: string;
  updated_at?: string;
  deleted?: boolean;
}

/** A ledger row as it travels: the photo's bytes go to Storage, not the row. */
type RemoteLedger = Omit<SiteLedgerRow, "proof"> & Infra & { has_proof: boolean };
type RemoteSite = ContractorSite & Infra;

let userId: string | null = null;
let applyingRemote = false;
let hooks: Array<() => void> = [];
let lastSyncAt: number | null = null;

export interface SiteSyncState {
  /** True once sign-in has started backing these books up. */
  on: boolean;
  /** When the last full reconcile finished, or null if none has yet. */
  lastSyncAt: number | null;
  syncing: boolean;
}

export function siteSyncState(): SiteSyncState {
  return { on: !!userId, lastSyncAt, syncing: resyncing !== null };
}

// ---------- helpers ----------

const clock = (r: { updatedAt?: number; createdAt?: number }): number =>
  r?.updatedAt ?? r?.createdAt ?? 0;

function proofPath(rowId: string): string {
  return `${userId}/${rowId}`;
}

async function runApplying(fn: () => Promise<void>): Promise<void> {
  applyingRemote = true;
  try {
    await fn();
  } finally {
    applyingRemote = false;
  }
}

function siteFromRemote(r: RemoteSite): ContractorSite {
  const { user_id, updated_at, deleted, ...rest } = r;
  void user_id;
  void updated_at;
  void deleted;
  return rest as ContractorSite;
}

function ledgerFromRemote(r: RemoteLedger, proof: Blob | null): SiteLedgerRow {
  const { user_id, updated_at, deleted, has_proof, ...rest } = r;
  void user_id;
  void updated_at;
  void deleted;
  void has_proof;
  return { ...(rest as Omit<SiteLedgerRow, "proof">), proof };
}

/** Strip the Blob before a row goes near PostgREST — it is not a column. */
function ledgerToRemote(row: SiteLedgerRow, deleted = false) {
  const { proof, ...rest } = row;
  return {
    ...rest,
    user_id: userId!,
    has_proof: !!proof,
    deleted,
  };
}

// ---------- outbound ----------

function pushSite(site: ContractorSite, deleted = false): void {
  if (!userId) return;
  void supabase
    .from(SITES)
    .upsert({ ...site, user_id: userId, deleted })
    .then(({ error }) => {
      if (error) console.error("site sync push failed", error);
    });
}

/**
 * Upload the photo, then the row.
 *
 * In that order on purpose: a row that claims `has_proof` while its bytes never
 * reached the bucket is a record that says a bill exists and cannot produce it,
 * which is worse than no backup at all. `withProof` is false for a plain field
 * edit, so changing a description doesn't re-upload the image every time.
 */
async function pushLedgerRow(row: SiteLedgerRow, withProof: boolean): Promise<void> {
  if (!userId) return;
  if (withProof && row.proof) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(proofPath(row.id), row.proof, {
        upsert: true,
        contentType: row.proof.type || "image/jpeg",
      });
    if (error) {
      console.error("site proof upload failed", error);
      return;
    }
  }
  const { error } = await supabase.from(LEDGER).upsert(ledgerToRemote(row));
  if (error) console.error("site ledger push failed", error);
}

/** Tombstone the row and drop its photo — a deleted row keeps no image alive. */
async function pushLedgerDelete(row: SiteLedgerRow): Promise<void> {
  if (!userId) return;
  const { error } = await supabase.from(LEDGER).upsert(ledgerToRemote(row, true));
  if (error) console.error("site ledger delete push failed", error);
  if (row.proof) await supabase.storage.from(BUCKET).remove([proofPath(row.id)]);
}

// ---------- inbound ----------

async function downloadProof(rowId: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(proofPath(rowId));
  if (error || !data) {
    console.error("site proof download failed", error);
    return null;
  }
  return data;
}

async function reconcileSites(): Promise<void> {
  const { data, error } = await supabase
    .from(SITES)
    .select("*")
    .eq("user_id", userId);
  if (error) throw error;
  const remote = (data ?? []) as RemoteSite[];
  const local = await db.sites.toArray();
  const rById = new Map(remote.map((r) => [r.id, r]));
  const lById = new Map(local.map((l) => [l.id, l]));
  const toPush: RemoteSite[] = [];

  await runApplying(async () => {
    for (const id of new Set([...rById.keys(), ...lById.keys()])) {
      const r = rById.get(id);
      const l = lById.get(id);
      if (r && !l) {
        if (!r.deleted) await db.sites.put(siteFromRemote(r)); // restore path
      } else if (l && !r) {
        toPush.push({ ...l, user_id: userId! });
      } else if (l && r) {
        const rc = clock(r);
        const lc = clock(l);
        if (r.deleted) {
          if (rc >= lc) await db.sites.delete(id);
          else toPush.push({ ...l, user_id: userId! });
        } else if (rc > lc) await db.sites.put(siteFromRemote(r));
        else if (lc > rc) toPush.push({ ...l, user_id: userId! });
      }
    }
  });

  if (toPush.length) {
    const { error: upErr } = await supabase.from(SITES).upsert(toPush);
    if (upErr) throw upErr;
  }
}

async function reconcileLedger(): Promise<void> {
  const { data, error } = await supabase
    .from(LEDGER)
    .select("*")
    .eq("user_id", userId);
  if (error) throw error;
  const remote = (data ?? []) as RemoteLedger[];
  const local = await db.siteLedger.toArray();
  const rById = new Map(remote.map((r) => [r.id, r]));
  const lById = new Map(local.map((l) => [l.id, l]));
  const toPush: SiteLedgerRow[] = [];

  // Photos are fetched outside the applying-guard block: a download is slow and
  // holding the guard across it would let an unrelated local write slip through
  // unpushed.
  const pulls: RemoteLedger[] = [];

  for (const id of new Set([...rById.keys(), ...lById.keys()])) {
    const r = rById.get(id);
    const l = lById.get(id);
    if (r && !l) {
      if (!r.deleted) pulls.push(r);
    } else if (l && !r) {
      toPush.push(l);
    } else if (l && r) {
      const rc = clock(r);
      const lc = clock(l);
      if (r.deleted) {
        if (rc >= lc) await runApplying(async () => void db.siteLedger.delete(id));
        else toPush.push(l);
      } else if (rc > lc) pulls.push(r);
      else if (lc > rc) toPush.push(l);
    }
  }

  for (const r of pulls) {
    // Keep the bytes we already hold rather than re-downloading them; only a
    // row we've never seen, or one whose photo we're missing, costs a fetch.
    const existing = await db.siteLedger.get(r.id);
    const proof =
      r.has_proof && !existing?.proof ? await downloadProof(r.id) : (existing?.proof ?? null);
    await runApplying(async () => {
      await db.siteLedger.put(ledgerFromRemote(r, proof));
    });
  }

  for (const l of toPush) await pushLedgerRow(l, true);
}

// ---------- hooks ----------

function installHooks(): void {
  const siteCreating = (_pk: string, obj: ContractorSite) => {
    if (!applyingRemote) pushSite(obj);
  };
  const siteUpdating = (
    mods: Partial<ContractorSite>,
    _pk: string,
    obj: ContractorSite,
  ) => {
    if (!applyingRemote) pushSite({ ...obj, ...mods });
  };
  const siteDeleting = (_pk: string, obj: ContractorSite) => {
    if (!applyingRemote) pushSite(obj, true);
  };

  const rowCreating = (_pk: string, obj: SiteLedgerRow) => {
    if (!applyingRemote) void pushLedgerRow(obj, true);
  };
  const rowUpdating = (
    mods: Partial<SiteLedgerRow>,
    _pk: string,
    obj: SiteLedgerRow,
  ) => {
    if (!applyingRemote)
      void pushLedgerRow({ ...obj, ...mods }, "proof" in mods);
  };
  const rowDeleting = (_pk: string, obj: SiteLedgerRow) => {
    if (!applyingRemote) void pushLedgerDelete(obj);
  };

  db.sites.hook("creating", siteCreating);
  db.sites.hook("updating", siteUpdating);
  db.sites.hook("deleting", siteDeleting);
  db.siteLedger.hook("creating", rowCreating);
  db.siteLedger.hook("updating", rowUpdating);
  db.siteLedger.hook("deleting", rowDeleting);

  hooks = [
    () => db.sites.hook("creating").unsubscribe(siteCreating),
    () => db.sites.hook("updating").unsubscribe(siteUpdating),
    () => db.sites.hook("deleting").unsubscribe(siteDeleting),
    () => db.siteLedger.hook("creating").unsubscribe(rowCreating),
    () => db.siteLedger.hook("updating").unsubscribe(rowUpdating),
    () => db.siteLedger.hook("deleting").unsubscribe(rowDeleting),
  ];
}

// ---------- lifecycle ----------

export async function startSiteSync(uid: string): Promise<void> {
  if (userId === uid) return; // already running for this account
  if (userId) await stopSiteSync();
  userId = uid;
  installHooks();
  await reconcileSites();
  await reconcileLedger();
  lastSyncAt = Date.now();
}

/**
 * Make the cloud match this device exactly, discarding what it held.
 *
 * For the file-restore path only. Restoring a backup *replaces* the books, but
 * reconcile is two-way and treats a row the cloud has and the device doesn't as
 * something to pull down — so without this, restoring an older file would work
 * for a few seconds and then quietly refill with everything it was meant to
 * replace. The user has already confirmed the replacement with real counts;
 * this carries that decision through to the copy that outlives the phone.
 */
export async function replaceCloudWithLocal(): Promise<void> {
  if (!userId) return;

  const [sites, rows] = await Promise.all([
    db.sites.toArray(),
    db.siteLedger.toArray(),
  ]);
  const keepSites = new Set(sites.map((s) => s.id));
  const keepRows = new Set(rows.map((r) => r.id));

  const [remoteSites, remoteRows] = await Promise.all([
    supabase.from(SITES).select("id").eq("user_id", userId),
    supabase.from(LEDGER).select("id").eq("user_id", userId),
  ]);

  // Tombstone by update, not upsert: an upsert would need every column and
  // would blank the row's contents on the way to marking it deleted.
  for (const r of (remoteSites.data ?? []) as { id: string }[]) {
    if (!keepSites.has(r.id))
      await supabase.from(SITES).update({ deleted: true }).eq("id", r.id);
  }
  const goneRows = ((remoteRows.data ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !keepRows.has(id));
  for (const id of goneRows) {
    await supabase.from(LEDGER).update({ deleted: true }).eq("id", id);
  }
  if (goneRows.length)
    await supabase.storage.from(BUCKET).remove(goneRows.map(proofPath));

  for (const s of sites) pushSite(s);
  for (const r of rows) await pushLedgerRow(r, true);
  lastSyncAt = Date.now();
}

let resyncing: Promise<void> | null = null;

/** Run the same two-way reconcile again, now. Safe to call at any time;
 * concurrent calls collapse onto the first so two passes can't race to push
 * the same local-only rows. */
export async function resyncSites(): Promise<void> {
  if (!userId) return;
  if (resyncing) return resyncing;
  resyncing = (async () => {
    try {
      await reconcileSites();
      await reconcileLedger();
      lastSyncAt = Date.now();
    } finally {
      resyncing = null;
    }
  })();
  return resyncing;
}

export async function stopSiteSync(): Promise<void> {
  for (const off of hooks) off();
  hooks = [];
  userId = null;
  lastSyncAt = null;
}
