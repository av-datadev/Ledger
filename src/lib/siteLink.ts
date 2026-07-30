// The bridge between a homeowner's household and a contractor's site.
//
// This is a THIRD scope, deliberately not household membership: a member sees
// the whole private ledger, and a linked contractor must see only the money
// between him and this one site. The server enforces that (see the
// `contractor_site_links` migration — RLS on shared_entries, plus
// security-definer RPCs so a contractor never needs read access to
// `households` and can't enumerate site codes). Nothing here is trusted to
// enforce it; this file is only the client's side of the conversation.

import { supabase } from "./supabase";

export type LinkStatus = "pending" | "approved" | "revoked";
export type AuthorRole = "owner" | "contractor";

export interface SiteLink {
  id: string;
  householdId: string;
  contractorUserId: string;
  contractorName: string;
  contractorPhone: string;
  siteLabel: string;
  status: LinkStatus;
  requestedAt: string;
  decidedAt: string | null;
}

export interface SharedEntry {
  id: string;
  linkId: string;
  authorRole: AuthorRole;
  date: string;
  /** "payment" = money the owner says went out; "spend" = what the contractor
   * says he laid out on the site. */
  kind: "payment" | "spend";
  description: string;
  amount: number;
  notes: string;
  /** Storage path of the bill/slip photo backing this row, if one was shared. */
  proofPath: string | null;
  createdAt: string;
}

const PROOF_BUCKET = "shared-proofs";

function linkFromRow(r: Record<string, unknown>): SiteLink {
  return {
    id: r.id as string,
    householdId: r.household_id as string,
    contractorUserId: r.contractor_user_id as string,
    contractorName: (r.contractor_name as string) ?? "",
    contractorPhone: (r.contractor_phone as string) ?? "",
    siteLabel: (r.site_label as string) ?? "",
    status: r.status as LinkStatus,
    requestedAt: r.requested_at as string,
    decidedAt: (r.decided_at as string) ?? null,
  };
}

function entryFromRow(r: Record<string, unknown>): SharedEntry {
  return {
    id: r.id as string,
    linkId: r.link_id as string,
    authorRole: r.author_role as AuthorRole,
    date: r.date as string,
    kind: r.kind as "payment" | "spend",
    description: (r.description as string) ?? "",
    amount: Number(r.amount) || 0,
    notes: (r.notes as string) ?? "",
    proofPath: (r.proof_path as string) ?? null,
    createdAt: r.created_at as string,
  };
}

// ---------- owner side ----------

/** The code a contractor types to ask to join this house. */
export async function mySiteCode(): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_site_code");
  if (error) throw error;
  return (data as string) ?? null;
}

/** Every contractor who has asked for, or been given, access to this house. */
export async function listLinks(): Promise<SiteLink[]> {
  const { data, error } = await supabase
    .from("site_links")
    .select("*")
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(linkFromRow);
}

export async function decideLink(
  linkId: string,
  approve: boolean,
): Promise<SiteLink> {
  const { data, error } = await supabase.rpc("decide_site_link", {
    p_link_id: linkId,
    p_approve: approve,
  });
  if (error) throw error;
  return linkFromRow(data as Record<string, unknown>);
}

// ---------- contractor side ----------

/**
 * Ask to join a site by its code. Always lands as `pending` — a correct code
 * on its own grants nothing, so a code shared into a WhatsApp group is not a
 * way in. The owner decides.
 */
export async function requestLink(input: {
  code: string;
  name: string;
  phone: string;
  label: string;
}): Promise<SiteLink> {
  const { data, error } = await supabase.rpc("request_site_link", {
    p_code: input.code.trim().toUpperCase(),
    p_name: input.name,
    p_phone: input.phone,
    p_label: input.label,
  });
  if (error) throw error;
  return linkFromRow(data as Record<string, unknown>);
}

/** Re-read one link's current status (has the owner approved yet?). */
export async function getLink(linkId: string): Promise<SiteLink | null> {
  const { data, error } = await supabase
    .from("site_links")
    .select("*")
    .eq("id", linkId)
    .maybeSingle();
  if (error) throw error;
  return data ? linkFromRow(data as Record<string, unknown>) : null;
}

// ---------- the shared ledger (both sides) ----------

export async function listSharedEntries(linkId: string): Promise<SharedEntry[]> {
  const { data, error } = await supabase
    .from("shared_entries")
    .select("*")
    .eq("link_id", linkId)
    .eq("deleted", false)
    .order("date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(entryFromRow);
}

/**
 * Put a row into the shared ledger. `id` is client-generated so the
 * contractor's local row can hold a stable pointer to its shared twin.
 *
 * A row is always written under its author's own role; RLS rejects any attempt
 * to write as the other party, so the two sides' figures can sit side by side
 * without either being able to quietly restate the other.
 */
export async function addSharedEntry(input: {
  id?: string;
  linkId: string;
  authorRole: AuthorRole;
  date: string;
  kind: "payment" | "spend";
  description: string;
  amount: number;
  notes?: string;
  /** The bill/slip photo behind this row. Uploaded before the row is written,
   * so a row never claims a proof that failed to reach storage. */
  proof?: Blob | null;
}): Promise<SharedEntry> {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) throw new Error("Sign in to share this with the other side.");

  const id = input.id ?? crypto.randomUUID();

  let proofPath: string | null = null;
  if (input.proof) {
    // Path is <link_id>/<entry_id>.jpg — the storage policies re-derive access
    // from that first segment, so a photo is reachable by exactly the two
    // parties on that link and nobody else.
    const path = `${input.linkId}/${id}.jpg`;
    const { error: upErr } = await supabase.storage
      .from(PROOF_BUCKET)
      .upload(path, input.proof, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw upErr;
    proofPath = path;
  }

  const row = {
    id,
    link_id: input.linkId,
    author_role: input.authorRole,
    author_user_id: uid,
    date: input.date,
    kind: input.kind,
    description: input.description,
    amount: input.amount,
    notes: input.notes ?? "",
    proof_path: proofPath,
  };
  const { data, error } = await supabase
    .from("shared_entries")
    .insert(row)
    .select()
    .single();
  if (error) {
    // Don't leave an orphan photo in the bucket if the row itself is rejected.
    if (proofPath) {
      await supabase.storage.from(PROOF_BUCKET).remove([proofPath]).catch(() => {});
    }
    throw error;
  }
  return entryFromRow(data as Record<string, unknown>);
}

/**
 * A short-lived URL for a shared bill photo. The bucket is private, so there is
 * no public link — every view is signed for the person asking, and the storage
 * policy checks the link again on the way through.
 */
export async function sharedProofUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Withdraw a row you shared. Soft-deleted so the other side's view settles
 * rather than a row vanishing mid-conversation; the photo goes for real,
 * since an unreachable row shouldn't keep an image alive in the bucket. */
export async function unshareEntry(id: string, proofPath?: string | null): Promise<void> {
  const { error } = await supabase
    .from("shared_entries")
    .update({ deleted: true })
    .eq("id", id);
  if (error) throw error;
  if (proofPath) {
    await supabase.storage.from(PROOF_BUCKET).remove([proofPath]).catch(() => {});
  }
}

// ---------- reconciliation ----------

export interface SharedTotals {
  ownerSaysPaid: number;
  contractorSaysReceived: number;
  contractorSpend: number;
  /** ownerSaysPaid − contractorSaysReceived. Non-zero means the two sides
   * disagree about how much money changed hands. */
  gap: number;
  disagrees: boolean;
}

/**
 * The whole point of keeping both sides' rows: compare what the owner says
 * they handed over against what the contractor says he got. A gap here is the
 * cheapest possible early warning — it is the shape of the steel dispute, and
 * it shows up the day the two records diverge rather than months later.
 */
export function reconcile(entries: SharedEntry[]): SharedTotals {
  let ownerSaysPaid = 0;
  let contractorSaysReceived = 0;
  let contractorSpend = 0;
  for (const e of entries) {
    if (e.authorRole === "owner" && e.kind === "payment") ownerSaysPaid += e.amount;
    else if (e.authorRole === "contractor" && e.kind === "payment")
      contractorSaysReceived += e.amount;
    else if (e.authorRole === "contractor" && e.kind === "spend")
      contractorSpend += e.amount;
  }
  const gap = Math.round((ownerSaysPaid - contractorSaysReceived) * 100) / 100;
  return {
    ownerSaysPaid,
    contractorSaysReceived,
    contractorSpend,
    gap,
    // Only call it a disagreement once both sides have actually said something;
    // "owner logged, contractor hasn't yet" is a lag, not a dispute.
    disagrees:
      gap !== 0 && ownerSaysPaid > 0 && contractorSaysReceived > 0,
  };
}
