// The contractor directory is a PUBLIC, cloud-only feature — unlike the rest of
// the app (private household ledger data synced offline via Dexie), directory
// listings are fetched live from Supabase with no local cache. RLS keeps writes
// admin-only (see the `is_directory_admin` migration); reads are public.

import { supabase } from "./supabase";
import { fileToAttachment } from "./attach";

const BUCKET = "contractor-photos";

// UI-only convenience to hide the admin form from everyone else — NOT the
// security boundary. The real enforcement is server-side RLS via
// is_directory_admin() (see the Supabase migration), which checks this same
// email against the signed-in session's JWT.
export const DIRECTORY_ADMIN_EMAIL = "apoorvverma0396@gmail.com";

export interface RateLine {
  item: string;
  unit: string;
  rate: number;
  materialIncluded: boolean;
}

export interface Reference {
  name: string;
  phone: string;
}

export type ContractorType = "general" | "specialist";
export type Availability = "available" | "partial" | "booked";

/**
 * One person in the directory — a painter, a carpenter — held independently of
 * any firm.
 *
 * The link to a firm is many-to-many (see `contractor_firm_members`): a good
 * electrician commonly works with two or three builders, and a `firmId` column
 * here would force a choice the trade does not actually make.
 */
export interface Member {
  id: string;
  name: string;
  trade: string;
  city: string;
  /**
   * Null whenever the person has not agreed to be listed with a number. The
   * database refuses to store one without consent — the firm's owner cannot
   * give it on their behalf — so a null here means "ring the firm instead",
   * not "we forgot to ask".
   */
  phone: string | null;
  phoneConsent: boolean;
  yearsExperience: number | null;
  rateCard: RateLine[];
  photos: string[];
  availability: Availability;
  listed: boolean;
  createdAt: string;
}

/** A member as seen through one firm's roster. */
export interface FirmMember extends Member {
  isLead: boolean;
}

export interface Contractor {
  id: string;
  name: string;
  phone: string;
  city: string;
  area: string | null;
  yearsExperience: number | null;
  teamSize: number | null;
  contractorType: ContractorType;
  /**
   * The trades this firm can actually supply.
   *
   * DERIVED from the roster whenever the firm has one — a firm holding a
   * painter does painting. Falls back to the hand-typed column only for
   * listings onboarded before members existed, which is the one case where
   * the two can still disagree.
   */
  trades: string[];
  /** The roster, most senior first. Empty for a firm not yet broken out. */
  members: FirmMember[];
  rateCard: RateLine[];
  photos: string[]; // storage paths in the contractor-photos bucket
  availability: Availability;
  freeFrom: string | null;
  vouchedBy: string | null;
  references: Reference[];
  advancePct: number | null;
  paymentTerms: string | null;
  listed: boolean;
  createdAt: string;
}

// snake_case (DB) <-> camelCase (app) mapping — kept local to this file so
// nothing else needs to know the wire shape.
function fromRow(r: Record<string, unknown>): Contractor {
  return {
    id: r.id as string,
    name: r.name as string,
    phone: r.phone as string,
    city: r.city as string,
    area: (r.area as string) ?? null,
    yearsExperience: (r.years_experience as number) ?? null,
    teamSize: (r.team_size as number) ?? null,
    contractorType: r.contractor_type as ContractorType,
    trades: (r.trades as string[]) ?? [],
    members: [],
    rateCard: (r.rate_card as RateLine[]) ?? [],
    photos: (r.photos as string[]) ?? [],
    availability: r.availability as Availability,
    freeFrom: (r.free_from as string) ?? null,
    vouchedBy: (r.vouched_by as string) ?? null,
    references: (r.references_json as Reference[]) ?? [],
    advancePct: (r.advance_pct as number) ?? null,
    paymentTerms: (r.payment_terms as string) ?? null,
    listed: r.listed as boolean,
    createdAt: r.created_at as string,
  };
}

function memberFromRow(r: Record<string, unknown>): Member {
  return {
    id: r.id as string,
    name: r.name as string,
    trade: r.trade as string,
    city: r.city as string,
    phone: (r.phone as string) ?? null,
    phoneConsent: Boolean(r.phone_consent),
    yearsExperience: (r.years_experience as number) ?? null,
    rateCard: (r.rate_card as RateLine[]) ?? [],
    photos: (r.photos as string[]) ?? [],
    availability: r.availability as Availability,
    listed: Boolean(r.listed),
    createdAt: r.created_at as string,
  };
}

/** Leads first, then the longest-serving — the order a roster is read in. */
function bySeniority(a: FirmMember, b: FirmMember): number {
  if (a.isLead !== b.isLead) return a.isLead ? -1 : 1;
  return (b.yearsExperience ?? 0) - (a.yearsExperience ?? 0);
}

/**
 * Public: list contractors for a city (default Moradabad), newest first, each
 * with its roster attached.
 *
 * Three queries rather than one nested select: the join table is many-to-many,
 * and PostgREST's embedding would return each member once per firm they work
 * for, which is exactly the duplication the many-to-many was chosen to allow.
 */
export async function listContractors(city = "Moradabad"): Promise<Contractor[]> {
  const { data, error } = await supabase
    .from("contractors")
    .select("*")
    .eq("city", city)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const firms = (data ?? []).map(fromRow);
  if (firms.length === 0) return firms;

  const { data: links, error: linkErr } = await supabase
    .from("contractor_firm_members")
    .select("firm_id, member_id, is_lead")
    .in("firm_id", firms.map((f) => f.id));
  if (linkErr) throw linkErr;

  const memberIds = [...new Set((links ?? []).map((l) => l.member_id as string))];
  if (memberIds.length === 0) return firms;

  const { data: rows, error: memErr } = await supabase
    .from("contractor_members")
    .select("*")
    .in("id", memberIds);
  if (memErr) throw memErr;

  const byId = new Map((rows ?? []).map((r) => [r.id as string, memberFromRow(r)]));
  const roster = new Map<string, FirmMember[]>();
  for (const l of links ?? []) {
    const m = byId.get(l.member_id as string);
    // An unlisted member is filtered out by RLS, so the link can outlive the
    // row it points at. Skip rather than render a hole in the roster.
    if (!m) continue;
    const list = roster.get(l.firm_id as string) ?? [];
    list.push({ ...m, isLead: Boolean(l.is_lead) });
    roster.set(l.firm_id as string, list);
  }

  return firms.map((f) => {
    const members = (roster.get(f.id) ?? []).sort(bySeniority);
    if (members.length === 0) return f;
    return {
      ...f,
      members,
      // Derived — see the note on Contractor.trades.
      trades: [...new Set(members.map((m) => m.trade))],
      teamSize: members.length,
    };
  });
}

/**
 * Public: every firm a given member works with.
 *
 * The reason the link is many-to-many, and the reason a member's own screen can
 * say so honestly instead of pretending they belong to one builder.
 */
export async function listMemberFirms(memberId: string): Promise<Contractor[]> {
  const { data: links, error } = await supabase
    .from("contractor_firm_members")
    .select("firm_id")
    .eq("member_id", memberId);
  if (error) throw error;

  const ids = (links ?? []).map((l) => l.firm_id as string);
  if (ids.length === 0) return [];

  const { data, error: firmErr } = await supabase
    .from("contractors")
    .select("*")
    .in("id", ids);
  if (firmErr) throw firmErr;
  return (data ?? []).map(fromRow);
}

/** The public URL for a stored contractor photo path. */
export function contractorPhotoUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Admin-only: create a contractor listing (RLS enforces the admin check). */
export async function createContractor(input: {
  name: string;
  phone: string;
  city: string;
  area: string;
  yearsExperience: number | null;
  teamSize: number | null;
  contractorType: ContractorType;
  trades: string[];
  rateCard: RateLine[];
  photoPaths: string[];
  availability: Availability;
  freeFrom: string | null;
  vouchedBy: string;
  references: Reference[];
  advancePct: number | null;
  paymentTerms: string;
}): Promise<Contractor> {
  const { data, error } = await supabase
    .from("contractors")
    .insert({
      name: input.name,
      phone: input.phone,
      city: input.city,
      area: input.area || null,
      years_experience: input.yearsExperience,
      team_size: input.teamSize,
      contractor_type: input.contractorType,
      trades: input.trades,
      rate_card: input.rateCard,
      photos: input.photoPaths,
      availability: input.availability,
      free_from: input.freeFrom,
      vouched_by: input.vouchedBy || null,
      references_json: input.references,
      advance_pct: input.advancePct,
      payment_terms: input.paymentTerms || null,
    })
    .select()
    .single();
  if (error) throw error;
  return fromRow(data);
}

/** Admin-only: upload a contractor photo (compressed like ledger photos). */
export async function uploadContractorPhoto(
  contractorId: string,
  file: File,
): Promise<string> {
  const img = await fileToAttachment(file);
  const path = `${contractorId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, img.blob, { contentType: img.mime });
  if (error) throw error;
  return path;
}

/** Admin-only: attach uploaded photo paths to a contractor row. */
export async function updateContractorPhotos(
  id: string,
  photoPaths: string[],
): Promise<void> {
  const { error } = await supabase
    .from("contractors")
    .update({ photos: photoPaths })
    .eq("id", id);
  if (error) throw error;
}

/** Public: capture a "I'm a contractor, list me" interest lead. */
export async function submitContractorLead(input: {
  name: string;
  phone: string;
  city: string;
  trade: string;
  notes: string;
}): Promise<void> {
  const { error } = await supabase.from("contractor_leads").insert({
    name: input.name,
    phone: input.phone,
    city: input.city,
    trade: input.trade || null,
    notes: input.notes || null,
  });
  if (error) throw error;
}

/** Admin-only: create a person in the directory (RLS enforces the check). */
export async function createMember(input: {
  name: string;
  trade: string;
  city: string;
  phone: string;
  phoneConsent: boolean;
  yearsExperience: number | null;
  rateCard: RateLine[];
}): Promise<Member> {
  const { data, error } = await supabase
    .from("contractor_members")
    .insert({
      name: input.name,
      trade: input.trade,
      city: input.city,
      // Consent gates the number, and the database enforces it too: sending a
      // phone without consent violates contractor_members_phone_needs_consent.
      phone: input.phoneConsent ? input.phone || null : null,
      phone_consent: input.phoneConsent,
      years_experience: input.yearsExperience,
      rate_card: input.rateCard,
    })
    .select()
    .single();
  if (error) throw error;
  return memberFromRow(data);
}

/** Admin-only: list everyone in the directory, for linking to a firm. */
export async function listAllMembers(city = "Moradabad"): Promise<Member[]> {
  const { data, error } = await supabase
    .from("contractor_members")
    .select("*")
    .eq("city", city)
    .order("name");
  if (error) throw error;
  return (data ?? []).map(memberFromRow);
}

/**
 * Admin-only: put an existing person on a firm's roster.
 *
 * Upsert rather than insert so re-adding someone already on the roster changes
 * their lead flag instead of failing on the primary key.
 */
export async function linkMemberToFirm(
  firmId: string,
  memberId: string,
  isLead = false,
): Promise<void> {
  const { error } = await supabase
    .from("contractor_firm_members")
    .upsert(
      { firm_id: firmId, member_id: memberId, is_lead: isLead },
      { onConflict: "firm_id,member_id" },
    );
  if (error) throw error;
}

/**
 * Admin-only: take someone off a firm's roster.
 *
 * Removes the link only. The person stays in the directory because they may
 * work with another builder — which is the whole point of the join table.
 */
export async function unlinkMemberFromFirm(
  firmId: string,
  memberId: string,
): Promise<void> {
  const { error } = await supabase
    .from("contractor_firm_members")
    .delete()
    .eq("firm_id", firmId)
    .eq("member_id", memberId);
  if (error) throw error;
}
