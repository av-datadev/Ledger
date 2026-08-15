-- The contractor side's own books, in the cloud.
--
-- Until now a contractor's sites and money log lived only in his phone's
-- IndexedDB, behind a JSON export he had to remember to take. That is the one
-- place in the app where a phone reset destroys a year of records with no way
-- back — and unlike the household ledger, these are the books of several
-- families' houses at once.
--
-- Scoping is deliberately NOT household_id. A contractor has no household, and
-- the whole premise of the contractor side is that his other sites are visible
-- to nobody: not to a homeowner he is linked with, not to anyone else. So the
-- key here is user_id, which is a strictly narrower rule than the household
-- tables use — one row, one owner, no membership indirection.
--
-- What an owner can see of a contractor's work is unchanged and lives
-- elsewhere: `shared_entries`, per approved site link, per row he chooses to
-- show. Nothing here is readable through that path.
--
-- Column names mirror the TypeScript field names verbatim (hence the quoting —
-- Postgres would fold them to lower case), because sync pushes whole rows.

-- ---------- sites ----------

create table if not exists public.contractor_sites (
  id            text primary key,
  user_id       uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,
  "name"        text not null default '',
  "ownerName"   text not null default '',
  "ownerPhone"  text not null default '',
  address       text not null default '',
  -- Nullable: a site can be running without an agreed lump sum.
  "contractAmount" numeric,
  "startDate"   text not null default '',
  status        text not null default 'active',
  notes         text not null default '',
  -- The site_links row joining this site to an owner's household, when one has
  -- been approved. Mirrored here only so the local row round-trips intact.
  "linkId"      text,
  "linkStatus"  text,
  "createdAt"   bigint not null default 0,
  "updatedAt"   bigint not null default 0,
  -- Sync infra, stripped on the way back to the device.
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false
);

create index if not exists contractor_sites_user_idx
  on public.contractor_sites (user_id);

alter table public.contractor_sites enable row level security;

drop policy if exists cs_own on public.contractor_sites;
create policy cs_own on public.contractor_sites
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- money log ----------

create table if not exists public.contractor_site_ledger (
  id            text primary key,
  user_id       uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,
  "siteId"      text not null,
  date          text not null default '',
  kind          text not null default 'other',
  description   text not null default '',
  amount        numeric not null default 0,
  -- The proof photo's BYTES live in the `site-proofs` bucket below, at
  -- <user_id>/<row id>; only its name travels in the row. has_proof is what
  -- tells a restoring device there is an image to fetch — deriving it from
  -- proofName would make an empty filename mean "no bill", which is a
  -- different claim than the app ever makes.
  "proofName"   text not null default '',
  has_proof     boolean not null default false,
  notes         text not null default '',
  -- The shared_entries twin, when this row has been shown to the owner.
  "sharedId"    text,
  "createdAt"   bigint not null default 0,
  "updatedAt"   bigint not null default 0,
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false
);

create index if not exists contractor_site_ledger_user_idx
  on public.contractor_site_ledger (user_id);
create index if not exists contractor_site_ledger_site_idx
  on public.contractor_site_ledger (user_id, "siteId");

alter table public.contractor_site_ledger enable row level security;

drop policy if exists csl_own on public.contractor_site_ledger;
create policy csl_own on public.contractor_site_ledger
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- proof photos ----------

-- Private. A bill photo is the thing that turns a claim into a record, so it
-- has to survive the phone alongside the row it backs.
insert into storage.buckets (id, name, public)
values ('site-proofs', 'site-proofs', false)
on conflict (id) do nothing;

drop policy if exists site_proofs_own on storage.objects;
create policy site_proofs_own on storage.objects
  for all
  -- Path is <user_id>/<row id>. Matched as a prefix rather than casting the
  -- first segment to uuid: a cast throws on any object whose name isn't shaped
  -- that way, and a policy that can error is a policy that can deny wrongly.
  using (
    bucket_id = 'site-proofs'
    and name like auth.uid()::text || '/%'
  )
  with check (
    bucket_id = 'site-proofs'
    and name like auth.uid()::text || '/%'
  );
