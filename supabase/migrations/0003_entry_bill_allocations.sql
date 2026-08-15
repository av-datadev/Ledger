-- Links a ledger payment back to the BOQ bill(s) it was placed against — the
-- remote half of the local Dexie v13 upgrade in src/db.ts.
--
-- Apply this BEFORE shipping a build that writes the field. sync.ts pushes the
-- whole row (`supabase.from(remote).upsert({...obj})`), so a column the table
-- doesn't have makes PostgREST reject the upsert with PGRST204 — and that
-- failure is only console.error'd, so a payment looks saved on the phone and
-- silently never reaches the cloud.
--
-- Column name is quoted because the table mirrors the TypeScript field names
-- verbatim, which Postgres would otherwise fold to lower case.

alter table public.entries
  -- [{ "billId": "...", "amount": 30000 }, ...]
  --
  -- A LIST, not a single billId: one payment routinely settles several bills on
  -- a dealer's running account, and it is still one payment — recording it as
  -- three entries would overstate how many times money actually moved.
  --
  -- Nullable with no default, and null means "not a bill payment", which is
  -- most spending. An empty array would instead assert "a bill payment placed
  -- against no bills", which is a different and untrue statement about every
  -- entry already in the table.
  add column if not exists "billAllocations" jsonb;
