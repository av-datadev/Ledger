// Two-way sync between the on-device Dexie DB and Supabase, scoped to the
// signed-in user's household. This is also the app's cloud backup: because
// every table lives in the cloud continuously, a lost or reset phone just signs
// in again and reconciles everything back — no manual JSON export required.
//
// Synced: entries, people, BOQ bills, stock items/moves, settings, and entry
// photos (image bytes in Supabase Storage, metadata in a table). Categories are
// still resolved by *name* locally (their ids differ per device) — they're
// reconstructed from the entries/BOQ that reference them.
//
// Outbound: Dexie hooks push every local create/update/delete to Supabase.
// Inbound: an initial reconcile per table plus a realtime subscription apply
// remote changes locally. An `applyingRemote` guard stops inbound writes from
// echoing straight back out. Conflicts resolve last-write-wins on `updatedAt`
// for tables that carry one (entries, people); the clockless tables (BOQ,
// stock) reconcile by gap-fill — pull rows you're missing, push rows the cloud
// is missing — with live edits carried by the Dexie hooks and realtime feed.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { db, getSettings } from "../db";
import type { Entry, Settings, Attachment } from "../types";

export interface Household {
  id: string;
  name: string;
  invite_code: string | null;
}

// Sync-infra columns present on every remote row.
type Infra = { household_id: string; updated_at?: string; deleted?: boolean };

const CUSTOM_ORDER = 1000;
const BUCKET = "attachments";

let householdId: string | null = null;
let applyingRemote = false;
let channel: RealtimeChannel | null = null;
// Keep hook references so they can be detached on sign-out.
let hooks: Array<() => void> = [];

export function currentHouseholdId(): string | null {
  return householdId;
}

// ---------- Household resolution / create / join ----------

export async function getMyHousehold(): Promise<Household | null> {
  const { data: mem, error } = await supabase
    .from("household_members")
    .select("household_id")
    .limit(1);
  if (error) throw error;
  if (!mem || mem.length === 0) return null;
  const { data: h, error: hErr } = await supabase
    .from("households")
    .select("id,name,invite_code")
    .eq("id", mem[0].household_id)
    .single();
  if (hErr) throw hErr;
  return h as Household;
}

export async function createHousehold(name: string): Promise<Household> {
  const { data, error } = await supabase.rpc("create_household", {
    p_name: name,
  });
  if (error) throw error;
  return data as Household;
}

export async function joinHousehold(code: string): Promise<Household> {
  const { data, error } = await supabase.rpc("join_household_by_code", {
    p_code: code,
  });
  if (error) throw error;
  return data as Household;
}

// ---------- Shared helpers ----------

/** Drop the sync-infra columns so the row matches the local shape. */
function stripInfra<T>(r: T & Infra): T {
  const { household_id, updated_at, deleted, ...rest } = r as T & Infra;
  void household_id;
  void updated_at;
  void deleted;
  return rest as unknown as T;
}

const clock = (e: { updatedAt?: number; createdAt?: number }): number =>
  e?.updatedAt ?? e?.createdAt ?? 0;

async function runApplying(fn: () => Promise<void>): Promise<void> {
  applyingRemote = true;
  try {
    await fn();
  } finally {
    applyingRemote = false;
  }
}

/** Make sure every category name in `names` exists locally (by name). */
async function ensureCategories(names: string[]): Promise<void> {
  const have = new Set(
    (await db.categories.toArray()).map((c) => c.name.toLowerCase()),
  );
  const now = Date.now();
  const toAdd = [...new Set(names)]
    .filter((n) => n && !have.has(n.toLowerCase()))
    .map((name) => ({
      id: crypto.randomUUID(),
      name,
      order: CUSTOM_ORDER,
      createdAt: now,
    }));
  if (toAdd.length)
    await runApplying(async () => void db.categories.bulkAdd(toAdd));
}

// ---------- Generic table sync (entries, people, BOQ, stock) ----------

// Minimal structural view of a Dexie table — enough for the sync engine, and
// free of Dexie's strict key-name generics that resist a table-agnostic loop.
interface AnyTable {
  toArray(): Promise<any[]>;
  get(id: string): Promise<any>;
  put(item: any): Promise<any>;
  delete(id: string): Promise<any>;
  hook: (...args: any[]) => any;
}

interface Synced {
  name: string; // display / channel label
  remote: string; // Supabase table name
  local: AnyTable;
  // Last-write-wins clock; omit for clockless tables (gap-fill reconcile).
  clock?: (row: any) => number;
  // Runs after rows are applied locally (entries re-seed their categories).
  afterApply?: (rows: any[]) => Promise<void>;
}

function tableConfigs(): Synced[] {
  return [
    {
      name: "entries",
      remote: "entries",
      local: db.entries,
      clock,
      afterApply: async (rows: Entry[]) =>
        ensureCategories(rows.map((e) => e.category)),
    },
    { name: "people", remote: "people", local: db.people, clock },
    { name: "boqItems", remote: "boq_items", local: db.boqItems },
    { name: "stockItems", remote: "stock_items", local: db.stockItems },
    { name: "stockMoves", remote: "stock_moves", local: db.stockMoves },
  ];
}

function pushRow<T extends { id: string }>(remote: string, obj: T): void {
  if (!householdId) return;
  void supabase
    .from(remote)
    .upsert({ ...obj, household_id: householdId, deleted: false })
    .then(({ error }) => {
      if (error) console.error(`sync push ${remote} failed`, error);
    });
}

function pushDelete<T extends { id: string }>(remote: string, obj: T): void {
  if (!householdId) return;
  void supabase
    .from(remote)
    .upsert({ ...obj, household_id: householdId, deleted: true })
    .then(({ error }) => {
      if (error) console.error(`sync delete ${remote} failed`, error);
    });
}

function installTableHooks(cfg: Synced): Array<() => void> {
  const creating = (_pk: string, obj: { id: string }) => {
    if (!applyingRemote) pushRow(cfg.remote, obj);
  };
  const updating = (
    mods: Record<string, unknown>,
    _pk: string,
    obj: { id: string },
  ) => {
    if (!applyingRemote) pushRow(cfg.remote, { ...obj, ...mods });
  };
  const deleting = (_pk: string, obj: { id: string }) => {
    if (!applyingRemote) pushDelete(cfg.remote, obj);
  };
  cfg.local.hook("creating", creating);
  cfg.local.hook("updating", updating);
  cfg.local.hook("deleting", deleting);
  return [
    () => cfg.local.hook("creating").unsubscribe(creating),
    () => cfg.local.hook("updating").unsubscribe(updating),
    () => cfg.local.hook("deleting").unsubscribe(deleting),
  ];
}

async function reconcileTable(cfg: Synced): Promise<void> {
  const { data: remote, error } = await supabase
    .from(cfg.remote)
    .select("*")
    .eq("household_id", householdId);
  if (error) throw error;
  const rows = (remote ?? []) as ({ id: string } & Infra)[];
  const local: { id: string }[] = await cfg.local.toArray();
  const rById = new Map(rows.map((r) => [r.id, r]));
  const lById = new Map(local.map((l) => [l.id, l]));
  const ids = new Set<string>([...rById.keys(), ...lById.keys()]);
  const toPush: Array<Record<string, unknown>> = [];

  await runApplying(async () => {
    for (const id of ids) {
      const r = rById.get(id);
      const l = lById.get(id);
      if (r && !l) {
        // Cloud has a row we've never seen — pull it (this is the restore path).
        if (!r.deleted) await cfg.local.put(stripInfra(r));
      } else if (l && !r) {
        // Local-only — push it up so the cloud backup is complete.
        toPush.push({ ...l, household_id: householdId! });
      } else if (l && r) {
        if (cfg.clock) {
          // Last-write-wins on the row's own clock.
          const rc = cfg.clock(stripInfra(r));
          const lc = cfg.clock(l);
          if (r.deleted) {
            if (rc >= lc) await cfg.local.delete(id);
            else toPush.push({ ...l, household_id: householdId! });
          } else if (rc > lc) {
            await cfg.local.put(stripInfra(r));
          } else if (lc > rc) {
            toPush.push({ ...l, household_id: householdId! });
          }
        } else {
          // Clockless: respect a remote tombstone, otherwise leave the local
          // row alone (the Dexie hooks + realtime feed keep live edits in sync).
          if (r.deleted) await cfg.local.delete(id);
        }
      }
    }
  });

  if (toPush.length) {
    const { error: upErr } = await supabase.from(cfg.remote).upsert(toPush);
    if (upErr) throw upErr;
  }
  if (cfg.afterApply) await cfg.afterApply(await cfg.local.toArray());
}

async function applyRealtimeRow(
  cfg: Synced,
  row: { id: string } & Infra,
): Promise<void> {
  if (!row.id) return;
  await runApplying(async () => {
    if (row.deleted) await cfg.local.delete(row.id);
    else await cfg.local.put(stripInfra(row));
  });
  if (cfg.afterApply && !row.deleted) await cfg.afterApply([stripInfra(row)]);
}

// ---------- Settings (a per-household singleton) ----------

// Local settings is a single row keyed id="app"; remote is one row keyed by
// household_id. Map between the two shapes on the way in/out.

function pushSettings(s: Settings): void {
  if (!householdId) return;
  const { id, ...rest } = s;
  void id;
  void supabase
    .from("settings")
    .upsert({ ...rest, household_id: householdId })
    .then(({ error }) => {
      if (error) console.error("sync settings push failed", error);
    });
}

function settingsFromRemote(row: Record<string, unknown>): Settings {
  const { household_id, updated_at, ...rest } = row as Infra &
    Record<string, unknown>;
  void household_id;
  void updated_at;
  return { id: "app", ...(rest as Omit<Settings, "id">) };
}

async function reconcileSettings(): Promise<void> {
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    // Cloud has settings (restore path) — pull them onto this device.
    await runApplying(async () => {
      await db.settings.put(settingsFromRemote(data));
    });
  } else {
    // First device for this household — seed the cloud from local settings.
    pushSettings(await getSettings());
  }
}

function installSettingsHooks(): Array<() => void> {
  const creating = (_pk: string, obj: Settings) => {
    if (!applyingRemote) pushSettings(obj);
  };
  const updating = (mods: Partial<Settings>, _pk: string, obj: Settings) => {
    if (!applyingRemote) pushSettings({ ...obj, ...mods });
  };
  db.settings.hook("creating", creating);
  db.settings.hook("updating", updating);
  return [
    () => db.settings.hook("creating").unsubscribe(creating),
    () => db.settings.hook("updating").unsubscribe(updating),
  ];
}

// ---------- Attachments (photo bytes in Storage, metadata in a table) ----------

function attachPath(id: string): string {
  return `${householdId}/${id}`;
}

/** Upload a photo's bytes to Storage, then upsert its metadata row. */
async function pushAttachment(a: Attachment): Promise<void> {
  if (!householdId) return;
  const up = await supabase.storage
    .from(BUCKET)
    .upload(attachPath(a.id), a.blob, { upsert: true, contentType: a.mime });
  if (up.error) {
    console.error("attachment upload failed", up.error);
    return;
  }
  const { blob, ...meta } = a;
  void blob;
  const { error } = await supabase
    .from("attachments")
    .upsert({ ...meta, household_id: householdId, deleted: false });
  if (error) console.error("attachment meta push failed", error);
}

/** Tombstone a photo's metadata and delete its bytes from Storage. */
async function removeAttachment(a: Attachment): Promise<void> {
  if (!householdId) return;
  const { blob, ...meta } = a;
  void blob;
  const { error } = await supabase
    .from("attachments")
    .upsert({ ...meta, household_id: householdId, deleted: true });
  if (error) console.error("attachment meta delete failed", error);
  await supabase.storage.from(BUCKET).remove([attachPath(a.id)]);
}

/** Download a photo's bytes and store the full row locally. */
async function pullAttachment(
  meta: Omit<Attachment, "blob"> & Infra,
): Promise<void> {
  const dl = await supabase.storage.from(BUCKET).download(attachPath(meta.id));
  if (dl.error || !dl.data) {
    console.error("attachment download failed", dl.error);
    return;
  }
  const row = { ...stripInfra(meta), blob: dl.data } as Attachment;
  await runApplying(async () => {
    await db.attachments.put(row);
  });
}

async function reconcileAttachments(): Promise<void> {
  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("household_id", householdId);
  if (error) throw error;
  const remote = (data ?? []) as (Omit<Attachment, "blob"> & Infra)[];
  const local = await db.attachments.toArray();
  const lById = new Map(local.map((l) => [l.id, l]));
  const rById = new Map(remote.map((r) => [r.id, r]));

  for (const r of remote) {
    if (r.deleted) {
      if (lById.has(r.id))
        await runApplying(async () => db.attachments.delete(r.id));
    } else if (!lById.has(r.id)) {
      await pullAttachment(r); // download bytes we don't have yet
    }
  }
  for (const l of local) {
    if (!rById.has(l.id)) await pushAttachment(l); // upload local-only photos
  }
}

function installAttachmentHooks(): Array<() => void> {
  const creating = (_pk: string, obj: Attachment) => {
    if (!applyingRemote) void pushAttachment(obj);
  };
  const deleting = (_pk: string, obj: Attachment) => {
    if (!applyingRemote) void removeAttachment(obj);
  };
  db.attachments.hook("creating", creating);
  db.attachments.hook("deleting", deleting);
  return [
    () => db.attachments.hook("creating").unsubscribe(creating),
    () => db.attachments.hook("deleting").unsubscribe(deleting),
  ];
}

async function applyRealtimeAttachment(
  row: Omit<Attachment, "blob"> & Infra,
): Promise<void> {
  if (!row.id) return;
  if (row.deleted) {
    await runApplying(async () => db.attachments.delete(row.id));
    return;
  }
  if (await db.attachments.get(row.id)) return; // already have the bytes
  await pullAttachment(row);
}

// ---------- Realtime ----------

function subscribeRealtime(): void {
  const byRemote = new Map(tableConfigs().map((c) => [c.remote, c]));
  let ch = supabase.channel(`hh-${householdId}`);

  for (const cfg of byRemote.values()) {
    ch = ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: cfg.remote,
        filter: `household_id=eq.${householdId}`,
      },
      (payload) => {
        const row = (payload.new ?? payload.old) as
          | ({ id: string } & Infra)
          | undefined;
        if (row) void applyRealtimeRow(cfg, row);
      },
    );
  }

  ch = ch.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "settings",
      filter: `household_id=eq.${householdId}`,
    },
    (payload) => {
      const row = payload.new as Record<string, unknown> | undefined;
      if (row && Object.keys(row).length)
        void runApplying(async () => {
          await db.settings.put(settingsFromRemote(row));
        });
    },
  );

  ch = ch.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "attachments",
      filter: `household_id=eq.${householdId}`,
    },
    (payload) => {
      const row = (payload.new ?? payload.old) as
        | (Omit<Attachment, "blob"> & Infra)
        | undefined;
      if (row) void applyRealtimeAttachment(row);
    },
  );

  channel = ch.subscribe();
}

// ---------- Lifecycle ----------

export async function startSync(hid: string): Promise<void> {
  householdId = hid;
  for (const cfg of tableConfigs()) hooks.push(...installTableHooks(cfg));
  hooks.push(...installSettingsHooks());
  hooks.push(...installAttachmentHooks());

  // Entries first so their categories exist before anything references them.
  for (const cfg of tableConfigs()) await reconcileTable(cfg);
  await reconcileSettings();
  await reconcileAttachments();

  subscribeRealtime();
}

export async function stopSync(): Promise<void> {
  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
  }
  for (const off of hooks) off();
  hooks = [];
  householdId = null;
}
