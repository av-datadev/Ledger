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

export interface Contractor {
  id: string;
  name: string;
  phone: string;
  city: string;
  area: string | null;
  yearsExperience: number | null;
  teamSize: number | null;
  contractorType: ContractorType;
  trades: string[];
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

/** Public: list contractors for a city (default Moradabad), newest first. */
export async function listContractors(city = "Moradabad"): Promise<Contractor[]> {
  const { data, error } = await supabase
    .from("contractors")
    .select("*")
    .eq("city", city)
    .order("created_at", { ascending: false });
  if (error) throw error;
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
