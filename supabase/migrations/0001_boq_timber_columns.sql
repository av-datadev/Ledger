-- Timber (cft) columns on BOQ rows — the remote half of the local Dexie v11
-- upgrade in src/db.ts.
--
-- This has to be applied before a household with sync enabled saves a size-list
-- bill. sync.ts pushes the whole row (`supabase.from(remote).upsert({...obj})`),
-- so a column the table doesn't have makes PostgREST reject the upsert with
-- PGRST204 — and that failure is only console.error'd, so the bill would look
-- saved on the phone and never reach the cloud.
--
-- Column names are quoted because the table mirrors the TypeScript field names
-- verbatim (invoiceNo, billId, gstPct…), which Postgres would otherwise fold to
-- lower case.

alter table public.boq_items
  -- Thickness in inches. A cft row is length (ft) × width (in) × thickness (in)
  -- ÷ 144 × pieces; the first two already had columns, these two did not.
  add column if not exists "thickness"  numeric,
  -- How many pieces of this exact size the row stands for.
  add column if not exists "pieces"     numeric,
  -- The dealer's own total quantity as written on the slip, kept beside the
  -- measured `qty` rather than replacing it — the two are computed
  -- independently, which is the only reason comparing them means anything.
  add column if not exists "writtenQty" numeric;
