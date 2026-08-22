-- Who a stock movement went to (or came from) — the remote half of the local
-- Dexie v14 upgrade in src/db.ts.
--
-- Apply this BEFORE shipping a build that writes the field. sync.ts pushes the
-- whole row (`supabase.from(remote).upsert({...obj})`), so a column the table
-- doesn't have makes PostgREST reject the upsert with PGRST204 — and that
-- failure is only console.error'd, so a handout looks saved on the phone and
-- silently never reaches the cloud.
--
-- Column name is quoted because the table mirrors the TypeScript field names
-- verbatim (stockId, billId…), which Postgres would otherwise fold to lower
-- case.

-- "Plumber", "Gopal Jee" — the name the material was handed to, or received
-- from. Its own column rather than a phrase inside `note` because this is the
-- thing that gets grouped: totalling what went to one man over a week is only
-- possible if his name is stored as a name.
alter table public.stock_moves
  add column if not exists "person" text;

-- Backfill, mirroring the Dexie v14 upgrade exactly so a device that restores
-- from the cloud computes the same thing a device that upgraded in place did.
--
-- Without this the two disagree: an upgrading phone moves the note into
-- `person` locally, but stock_moves is CLOCKLESS in sync.ts — when a row exists
-- both sides, reconcile leaves the local copy alone and never pushes it. So the
-- cloud would keep the old shape indefinitely, and a phone restoring from it
-- would show every past handout as "Not recorded".
--
-- Guarded on `person is null`, which is true only of rows untouched since the
-- column was added. A device that has already upgraded and pushed a row set
-- this field itself, and that write wins over this one.

-- On a manual movement the note IS the party: that box was labelled "From" /
-- "To whom" and wrote to `note` for want of anywhere better. The value is moved
-- rather than copied, so the name does not end up printed twice on the row.
update public.stock_moves
   set "person" = note,
       note     = ''
 where "person" is null
   and "billId" is null;

-- A receipt linked to a bill is the exception: its note is the bill's own label
-- ("Bill #2310 Gopal Jee"), which is a document, not a person. Those keep their
-- note and start with no name against them.
update public.stock_moves
   set "person" = ''
 where "person" is null;

-- NOT NULL DEFAULT '', matching `note` on this same table.
--
-- Not merely tidiness: the client reads this field with `.trim()`, and a device
-- restoring from the cloud puts the remote row straight into Dexie. A null
-- arriving that way would throw inside the date and dashboard rollups rather
-- than showing an unnamed handout. The default also keeps older clients — which
-- don't send the field at all — inserting rows this build can read.
--
-- Empty string means nobody was named, which is a real and allowed state: a
-- handout you can date but not attribute is still worth recording.
alter table public.stock_moves
  alter column "person" set default '',
  alter column "person" set not null;
