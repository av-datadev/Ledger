-- The work each person is responsible for — the remote half of the local Dexie
-- v15 upgrade in src/db.ts.
--
-- Apply this BEFORE shipping a build that writes the field. sync.ts pushes the
-- whole row (`supabase.from(remote).upsert({...obj})`), so a column the table
-- doesn't have makes PostgREST reject the upsert with PGRST204 — and that
-- failure is only console.error'd, so a link looks saved on the phone and
-- silently never reaches the cloud.

alter table public.people
  -- ["Plumbing"] on Vijay Plumber; ["Contractor", "Site Prep"] on a contractor
  -- covering both. Category NAMES, matching how `people.name` already refers to
  -- a category — renameCategory() in src/db.ts sweeps this array too, so a
  -- renamed trade does not orphan its link.
  --
  -- This lives on the person and not on the category because `categories` is
  -- NOT a synced table: sync.ts re-derives it by name from entries, so a link
  -- kept there would exist on one phone and vanish on a restore. `people`
  -- syncs with a clock, so the pairing reaches every phone in the household.
  --
  -- jsonb, mirroring "contractLines" on this same table.
  --
  -- Default '[]' and NOT NULL: the client reads this with .includes() and a
  -- restoring device puts the remote row straight into Dexie, so a null
  -- arriving that way would throw rather than showing an unlinked person. An
  -- empty array is also the honest backfill — the pairing is the user's
  -- knowledge, and guessing it from name similarity ("Plumbing" ≈ "Vijay
  -- Plumber") would attribute one man's money to another.
  add column if not exists "trades" jsonb;

update public.people
   set "trades" = '[]'::jsonb
 where "trades" is null;

alter table public.people
  alter column "trades" set default '[]'::jsonb,
  alter column "trades" set not null;
