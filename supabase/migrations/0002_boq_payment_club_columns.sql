-- Part-payment and clubbing columns on BOQ rows — the remote half of the local
-- Dexie v12 upgrade in src/db.ts.
--
-- Apply this BEFORE shipping a build that writes either field. sync.ts pushes
-- the whole row (`supabase.from(remote).upsert({...obj})`), so a column the
-- table doesn't have makes PostgREST reject the upsert with PGRST204 — and
-- that failure is only console.error'd, so the bill looks saved on the phone
-- and silently never reaches the cloud.
--
-- Column names are quoted because the table mirrors the TypeScript field names
-- verbatim (invoiceNo, billId, gstPct…), which Postgres would otherwise fold to
-- lower case.

alter table public.boq_items
  -- How much of this bill has actually been handed over, repeated on every row
  -- of the bill like "invoiceTotal". Outstanding is invoiceTotal - amountPaid.
  --
  -- Deliberately nullable with no default: NULL means "nothing is recorded
  -- about payment on this bill", which is a different statement from a payment
  -- of 0. Defaulting to 0 would backdate a claim onto every bill already in the
  -- table — that the whole of it is still owed.
  add column if not exists "amountPaid" numeric,
  -- True when the bill is kept as one line rather than as its items. The rows
  -- are still stored either way; this only decides how the bill reads and
  -- whether Stock receives one combined receipt or one per row.
  add column if not exists "clubbed"    boolean;
