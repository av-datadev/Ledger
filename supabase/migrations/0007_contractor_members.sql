-- Crew members in the public contractor directory.
--
-- A member is a person, not a slot on a firm: a good electrician commonly works
-- with two or three builders, so the firm link is many-to-many through
-- contractor_firm_members. A firm_id column on the member would force a choice
-- the trade does not actually make, and retrofitting it later would mean
-- rewriting every roster.
--
-- With this table in place, `contractors.trades` and `contractors.team_size`
-- become DERIVED from the roster rather than typed by hand -- which is what
-- stops "team of 6" from drifting against three trade tags.

create table if not exists public.contractor_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade text not null,
  city text not null default 'Moradabad',
  phone text,
  -- A member's phone is a THIRD PARTY's personal data. The firm owner cannot
  -- consent on their behalf, and the entire point of listing a member is that
  -- strangers will ring them. No consent, no number -- enforced here rather
  -- than in the form, so the database cannot hold one either way.
  phone_consent boolean not null default false,
  years_experience integer,
  rate_card jsonb not null default '[]'::jsonb,
  photos text[] not null default '{}'::text[],
  availability text not null default 'available',
  listed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contractor_members_phone_needs_consent
    check (phone is null or phone_consent),
  constraint contractor_members_availability_check
    check (availability in ('available', 'partial', 'booked'))
);

create table if not exists public.contractor_firm_members (
  firm_id uuid not null references public.contractors(id) on delete cascade,
  member_id uuid not null references public.contractor_members(id) on delete cascade,
  is_lead boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (firm_id, member_id)
);

create index if not exists contractor_firm_members_member_idx
  on public.contractor_firm_members(member_id);
create index if not exists contractor_members_city_idx
  on public.contractor_members(city);
create index if not exists contractor_members_trade_idx
  on public.contractor_members(trade);

alter table public.contractor_members enable row level security;
alter table public.contractor_firm_members enable row level security;

-- Reads are public: the directory is the one public surface in this app.
create policy "members are publicly readable"
  on public.contractor_members for select using (listed);
create policy "firm links are publicly readable"
  on public.contractor_firm_members for select using (true);

-- Writes stay admin-only, the same gate the firm rows already use.
create policy "admin writes members" on public.contractor_members
  for all using (public.is_directory_admin())
  with check (public.is_directory_admin());
create policy "admin writes firm links" on public.contractor_firm_members
  for all using (public.is_directory_admin())
  with check (public.is_directory_admin());
