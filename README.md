# Brick Flow

A PWA for tracking the money, materials and people involved in building a
house. Formerly "House Ledger". Built for one real project in Moradabad, UP,
and shaped by what actually goes wrong there — vendors who hand over a
handwritten slip instead of an invoice, and a contractor whose figures don't
match yours.

**Live:** https://ledger-nu-ashen.vercel.app

Data lives on-device in IndexedDB (Dexie) and works offline. Sign in and it
also syncs across a household via Supabase, so several people share one live
ledger. There is no seed data — a fresh install starts blank.

## Two apps in one

A role gate on first launch picks a side, switchable any time from the header.

**Owner** (building a house) — 8 tabs: Dash · Entry · Ledger · Recent · BOQ ·
Stock · People · Data.

**Contractor** (building it for someone) — multiple sites, each with its own
money log and a balance that splits spend-with-a-bill from spend-with-nothing.
Site books are device-local and deliberately outside household sync: a
contractor has no household, and his other sites must not be visible to any
homeowner. They have their own backup/restore because of that.

The two meet through a **site link**: the owner shares a site code, the
contractor asks to link, the owner approves. That opens a third,
separately-scoped space — one site, visible to exactly one household and one
contractor. It is *not* household membership; a linked contractor reads none
of the private ledger. Both sides record their own rows and neither can edit
the other's, so "owner says ₹70,000, contractor logged ₹50,000" surfaces as a
flagged disagreement instead of one side quietly restating the other.

## What needs the network

Most of the app works in airplane mode. Three things don't:

| Feature | Why |
| --- | --- |
| Bill / note / size-list scanning | Gemini vision, via Supabase Edge Functions |
| Household sync + sign-in | Supabase |
| Push notifications | Web Push via the `send-push` function |

Printed English bills fall back to on-device Tesseract OCR when Gemini can't
be reached. **Handwriting and Hindi have no fallback** — Tesseract ships
English-only training data and cannot read Devanagari at all. When the good
reader is unavailable the review screen says so, loudly, rather than
presenting Tesseract's guess as if it were a scan.

> **Gemini free tier is 20 requests/day.** Hit it and every scan silently
> falls back to the weaker reader. If more than one person is scanning, enable
> billing on the API key.

## Stack

React 19 · Vite · TypeScript (strict) · Tailwind v4 · Dexie/IndexedDB ·
vite-plugin-pwa (Workbox) · tesseract.js (on-device OCR) · pdfjs · jsQR ·
write-excel-file / read-excel-file (lazy-loaded) · Supabase (Postgres + RLS +
Edge Functions + Storage + Auth).

## Repo layout

```
shared/constants.ts    category enum + scanner keyword→category map
src/                   the PWA
src/lib/               sync, scanning, backup, stock, measures, push
public/tesseract/      self-hosted OCR worker, wasm cores, English data
scripts/               icon generator, tesseract vendoring, user-guide build
supabase/functions/    scan-bill, scan-note, scan-sizes, send-push
supabase/migrations/   SQL for columns the sync engine pushes
design/                HTML mockups the current skin came from
files/                 the build spec (ClaudeCode_HouseLedger_Prompt.md)
Ref_img/               real bills used as scanner test fixtures
```

Two things that will bite you:

**Sync pushes whole rows** (`upsert({...obj})` in `src/lib/sync.ts`), so any
new field on a synced type needs its column added remotely *first*. PostgREST
rejects the upsert otherwise and sync.ts only `console.error`s it, which looks
exactly like a bill that saved fine and silently never synced. Apply anything
in `supabase/migrations/` before shipping a build that writes the field.

**OCR needs all three Tesseract core variants** vendored, including
relaxed-SIMD. Miss one and every scan fails on the devices that pick it.
`npm run vendor:tesseract` runs as part of `npm run build` and enforces this.

## Local development

```bash
npm install
npm run dev
```

No environment variables. The Supabase URL and publishable key are in
`src/lib/supabase.ts` by design — they're meant to ship in client code, and
access is protected by login plus row-level security, not by hiding them.

Secrets that must **never** reach the client (`GEMINI_API_KEY`,
`VAPID_PRIVATE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) live only as Supabase Edge
Function secrets.

Other scripts: `npm run build` · `npm run preview` · `npm run typecheck` ·
`npm run icons`.

## Deploy

Pushing to `main` triggers a Vercel production deploy. Edge Functions deploy
separately (`supabase functions deploy <name>`) and are **not** part of the
Vercel build.

The service worker precaches aggressively, so an installed app keeps serving
the old bundle until reopened. The Data tab shows the build timestamp as **App
version** with a **check for update** link that unregisters the worker, clears
caches and hard-reloads.

## Install on a phone

Open the URL in Chrome (Android) or Safari (iOS), let it fully load once, then
**Add to Home Screen**. It launches standalone with no browser chrome.

iOS only exposes push to an app added to the home screen, so notifications
cannot be enabled from a browser tab there — the toggle says so instead of
failing silently.

## Feature notes

- **Bills** — photo or PDF, read by Gemini into editable line items. Line
  items are goods only; GST, freight and rounding are computed, not itemised.
  Rows summing to *more* than the printed total blocks saving, since that means
  a duplicated or misread row.
- **Handwritten kaccha bills** carry something printed invoices don't: what was
  actually paid and what's still owed. After scanning, choose **Bill only**,
  **Payment only**, or **Both**. The ledger entry takes the *paid* figure, not
  the invoice total, dated the day the money moved.
- **Size lists** (BOQ → *Size list*) — timber and stone dealers price by size,
  not quantity: `Teak / 8¼ × 9 × 8 — 3 pc`. Each size becomes one `cft` row and
  the app computes the volume itself — **length ft × width in × thickness in ÷
  144 × pieces** — then checks its total against the dealer's own written
  figure, stored beside it as `writtenQty`. The reader transcribes and never
  does the arithmetic: two independent figures are the only thing that makes
  the check worth anything.
- **Handwritten notes** (Entry) — a kaccha slip, cheque or Hindi diary page
  fills the entry form and keeps the photo as proof. Opt-in per device, since
  the photo leaves the phone.
- **Paid vs billed** (Ledger) — money handed over that no bill accounts for
  yet. A gap isn't proof of anything; labour never has a bill. It's worth a
  question when the payment was for material.
- **Backups** — JSON is the complete one and the only format carrying entry
  photos. Excel (.xlsx) opens anywhere and can be corrected by hand and
  uploaded back, but holds no photos, so restoring one deliberately leaves the
  photos already on the device untouched.
- **Categories** are editable rows, not an enum. Built-ins seed on first run:
  Contractor, Architect, Wood, Electrical, Paint, Plumbing, Tiles, Marble,
  Aluminium, Govt Fee/Chalan, MDA/Mutation, Gift, Site Prep, Legal, Utility
  Bill, Misc.
- The Android back button goes tab → dashboard → exit, and closes an open
  review screen rather than leaving the app.

## Manual test checklist

Offline (airplane mode, after one full load):

- [ ] Launches from the home-screen icon
- [ ] Dashboard totals, category bars, paid-by list
- [ ] Entry: add manually → appears in Ledger, Recent and Dashboard
- [ ] Ledger: search, the four filters (category / mode / payer / **date
      range**), note expand-on-tap, edit, delete, CSV
- [ ] BOQ: "Type manually" saves; a printed English bill still scans via
      on-device OCR; the lines-vs-total check holds
- [ ] Stock: received / given out, balance, done-checkbox
- [ ] Data: JSON and Excel backups download; both restore

Online only:

- [ ] BOQ scan of a photo/PDF via Gemini
- [ ] BOQ → Size list on a timber slip; measured total matches the written one
- [ ] A handwritten kaccha bill offers Bill / Payment / Both
- [ ] Sign in, sync across two devices
- [ ] Site link: share code, approve, both sides post to the shared ledger
- [ ] Push arrives on a real phone

Round trip: export a backup → clear all data → import it → counts match.
Worth doing for **both** formats; the Excel path is verified to preserve
nulls-as-nulls, a `gstPct` of 0, and nested contract lines.
