// Two-way sync between the on-device Dexie DB and Supabase, scoped to the
// signed-in user's household. v1 syncs the ledger *entries* — the shared pain
// point (one person records a payment, everyone sees it). Categories referenced
// by pulled entries are auto-created locally so dashboards and filters stay
// coherent without syncing the categories table (whose ids differ per device).
//
// Outbound: Dexie hooks push every local create/update/delete to Supabase.
// Inbound: an initial reconcile plus a realtime subscription apply remote
// changes locally. An `applyingRemote` guard stops inbound writes from echoing
// straight back out. Conflicts resolve last-write-wins on the entry's updatedAt.
//
// Not yet synced (device-local for now): people/bank details, settings, photos,
// BOQ bills, stock.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { db } from "../db";
import type { Entry } from "../types";

export interface Household {
  id: string;
  name: string;
  invite_code: string | null;
}

type RemoteEntry = Entry & {
  household_id: string;
  updated_at: string;
  deleted: boolean;
};

const CUSTOM_ORDER = 1000;

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

// ---------- Mapping helpers ----------

/** Drop the sync-infra columns so the row matches the local Entry shape. */
function stripInfra(r: RemoteEntry): Entry {
  const { household_id, updated_at, deleted, ...rest } = r;
  void household_id;
  void updated_at;
  void deleted;
  return rest;
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
  if (toAdd.length) await runApplying(async () => void db.categories.bulkAdd(toAdd));
}

// ---------- Outbound (local → remote) via Dexie hooks ----------

function pushRow(obj: Entry): void {
  if (!householdId) return;
  void supabase
    .from("entries")
    .upsert({ ...obj, household_id: householdId, deleted: false })
    .then(({ error }) => {
      if (error) console.error("sync push failed", error);
    });
}

function pushDelete(obj: Entry): void {
  if (!householdId) return;
  void supabase
    .from("entries")
    .upsert({ ...obj, household_id: householdId, deleted: true })
    .then(({ error }) => {
      if (error) console.error("sync delete failed", error);
    });
}

function installHooks(): void {
  const creating = (_pk: string, obj: Entry) => {
    if (!applyingRemote) pushRow(obj);
  };
  const updating = (mods: Partial<Entry>, _pk: string, obj: Entry) => {
    if (!applyingRemote) pushRow({ ...obj, ...mods });
  };
  const deleting = (_pk: string, obj: Entry) => {
    if (!applyingRemote) pushDelete(obj);
  };
  db.entries.hook("creating", creating);
  db.entries.hook("updating", updating);
  db.entries.hook("deleting", deleting);
  hooks = [
    () => db.entries.hook("creating").unsubscribe(creating),
    () => db.entries.hook("updating").unsubscribe(updating),
    () => db.entries.hook("deleting").unsubscribe(deleting),
  ];
}

function removeHooks(): void {
  for (const off of hooks) off();
  hooks = [];
}

// ---------- Inbound (remote → local) ----------

async function reconcileEntries(): Promise<void> {
  const { data: remote, error } = await supabase
    .from("entries")
    .select("*")
    .eq("household_id", householdId);
  if (error) throw error;
  const rows = (remote ?? []) as RemoteEntry[];
  const local = await db.entries.toArray();
  const rById = new Map(rows.map((r) => [r.id, r]));
  const lById = new Map(local.map((l) => [l.id, l]));
  const ids = new Set<string>([...rById.keys(), ...lById.keys()]);
  const toPush: RemoteEntry[] = [];

  await runApplying(async () => {
    for (const id of ids) {
      const r = rById.get(id);
      const l = lById.get(id);
      if (r && !l) {
        if (!r.deleted) await db.entries.put(stripInfra(r));
      } else if (l && !r) {
        toPush.push({ ...l, household_id: householdId! } as RemoteEntry);
      } else if (l && r) {
        if (r.deleted) {
          if (clock(r) >= clock(l)) await db.entries.delete(id);
          else toPush.push({ ...l, household_id: householdId! } as RemoteEntry);
        } else if (clock(r) > clock(l)) {
          await db.entries.put(stripInfra(r));
        } else if (clock(l) > clock(r)) {
          toPush.push({ ...l, household_id: householdId! } as RemoteEntry);
        }
      }
    }
  });

  if (toPush.length) {
    const { error: upErr } = await supabase.from("entries").upsert(toPush);
    if (upErr) throw upErr;
  }
  await ensureCategories((await db.entries.toArray()).map((e) => e.category));
}

function subscribeRealtime(): void {
  channel = supabase
    .channel(`hh-${householdId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "entries",
        filter: `household_id=eq.${householdId}`,
      },
      (payload) => {
        const row = (payload.new ?? payload.old) as RemoteEntry | undefined;
        if (row) void applyRealtime(row);
      },
    )
    .subscribe();
}

async function applyRealtime(row: RemoteEntry): Promise<void> {
  if (!row.id) return;
  await runApplying(async () => {
    if (row.deleted) await db.entries.delete(row.id);
    else await db.entries.put(stripInfra(row));
  });
  if (!row.deleted) await ensureCategories([row.category]);
}

// ---------- Lifecycle ----------

export async function startSync(hid: string): Promise<void> {
  householdId = hid;
  installHooks();
  await reconcileEntries();
  subscribeRealtime();
}

export async function stopSync(): Promise<void> {
  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
  }
  removeHooks();
  householdId = null;
}
