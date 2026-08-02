# Brick Flow

Offline-first PWA for tracking construction expenses on the house project.
Replaces the Excel workbook and the browser-only prototype.

Pure client-side app — everything lives in IndexedDB (Dexie) on the device.
No server, no API key, no network calls of any kind. Works fully offline the
moment it's installed — **including the bill scanner**, which runs Tesseract
OCR entirely on the device (assets self-hosted under `public/tesseract/` and
precached by the service worker).

Screens: Dashboard · + Entry · Ledger · BOQ (with photo scanning) ·
Stock (inventory: received / given to labour / balance, with done-checkboxes)
· Data (backup, restore, CSV, reset).

## Stack

Vite + React + TypeScript (strict) + Tailwind CSS · Dexie.js ·
vite-plugin-pwa (Workbox) for the offline app shell · tesseract.js for
on-device bill OCR.

## Repo layout

```
seed-entries.json   82 migrated ledger rows (₹65,07,837) — replace & rebuild to re-seed
seed-boq.json       25 BOQ rows (Gopal Jee invoices #4275 + #2310)
shared/constants.ts category / mode / payer enums + scanner keyword→category map
src/                the PWA
public/tesseract/   self-hosted OCR worker, wasm core, English language data
scripts/            icon + user-guide generators
supabase/functions/ Edge Functions: scan-bill, scan-note, scan-sizes, send-push
supabase/migrations/ SQL for columns the sync engine pushes — apply before deploy
```

**Sync pushes whole rows** (`upsert({...obj})` in `src/lib/sync.ts`), so any new
field on a synced type needs its column added remotely *first* — PostgREST
rejects the upsert otherwise, and sync.ts only `console.error`s that, which
looks like a saved bill that silently never syncs. Apply anything new in
`supabase/migrations/` before shipping a build that writes the field.

Seed data is imported **only when the tables are empty** (first launch), from
the JSON files at the repo root — never hardcoded in components. "Reset to
seed data" in the Data tab restores it.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

That's the whole setup — no environment variables, no second process to run.

Other scripts: `npm run build` (typecheck + production bundle + service
worker), `npm run preview` (serve the built bundle), `npm run icons`
(regenerate PWA icons), `npm run typecheck`.

## Deploy

Any static host works (Vercel, Netlify, GitHub Pages, Cloudflare Pages) —
`npm run build` produces a plain static `dist/` folder. No server, no
environment variables, no serverless functions.

**Vercel:**

1. Push the repo to GitHub:
   ```bash
   git init && git add -A && git commit -m "Brick Flow"
   git remote add origin <your-repo-url> && git push -u origin main
   ```
2. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import the
   repo. Vercel auto-detects Vite; keep the defaults (build `npm run build`,
   output `dist`). Click **Deploy** — nothing else to configure.

Vercel serves over HTTPS, which the PWA install requires.

## Install on your Android phone

1. Open the deployed URL in **Chrome** on the phone.
2. Wait for the first full load (this precaches the app shell for offline use).
3. Tap the **⋮ menu → "Add to Home Screen"** (or the "Install app" prompt).
4. Confirm. A **Brick Flow** icon appears on the home screen; launching it
   opens full-screen with no browser chrome (standalone display mode).

## Offline behavior — manual test checklist

After installing and opening the app once, turn on **airplane mode** and
verify (everything should work — there's nothing in this app that needs a
connection):

- [ ] App launches from the home-screen icon (app shell is precached)
- [ ] Dashboard shows the total, category bars, and paid-by list
- [ ] **+ Entry**: add a manual entry → it appears in Ledger and Dashboard
- [ ] **Ledger**: search, filter, delete (with confirm), Backup CSV download
- [ ] **BOQ**: "Scan bill" reads a photo with on-device OCR (works offline —
      the OCR engine is precached); "Type manually" opens the same form; the
      lines-sum-vs-total check works; saving stores the bill
- [ ] **BOQ → Size list**: needs a connection, so this one is checked *before*
      airplane mode — a timber slip reads into one `cft` row per size, the
      measured total matches the dealer's written figure, and saving with a
      deliberately wrong dimension is blocked until acknowledged
- [ ] **BOQ → Stock**: saving a bill with "Add the material rows to Stock"
      ticked creates inventory items with received quantities
- [ ] **Stock**: add an item, log "+ Received" and "− Given out" quantities,
      balance updates; done-checkbox greys the item out
- [ ] **Data**: export full JSON backup; import/restore it; CSV exports work
      (entries, BOQ, and stock)

Round-trip test (acceptance): export backup → Data → *Reset to seed data*
(double confirm) → import the backup file → confirm counts → all entries and
BOQ items restored exactly.

## Notes

- **Backups are your safety net.** All data is on-device only; there is no
  cloud sync. Export the JSON backup regularly (the Data tab nags in red when
  the last backup is older than 7 days). Backups include stock/inventory.
- **The scanner is best-effort.** OCR on phone photos misreads numbers —
  every scan lands in a review screen, and the bill can't be saved unless the
  line items sum to the printed total (or you explicitly acknowledge a
  mismatch). Good light + flat bill + filling the frame improves results a
  lot.
- **Size lists are read separately** (BOQ → *Size list*, `scan-sizes`). Timber
  and stone dealers hand over a handwritten slip priced by size, not quantity
  — `Teak / 8¼ x 9 x 8 - III / 38.987 x 2451`. The printed-invoice reader
  can't take it (no invoice number, no quantity column, and the quantity is
  *derived* from the dimensions), and reading it as a plain note would throw
  the sizes away. Each size becomes one `cft` BOQ row and the app computes the
  volume itself — **length in feet × width in inches × thickness in inches ÷
  144 × pieces** — then reconciles its total against the dealer's own written
  figure, which is stored beside it as `writtenQty`. The reader transcribes;
  it never does the arithmetic, because two independent figures are the only
  thing that makes the check worth anything. Handwriting needs a connection —
  there's no Tesseract fallback for a superscript ¼ or a tally mark.
- **Scanned bills auto-categorize** (paint keywords → Paint, pipes → Plumbing,
  tiles → Tiles, etc.) via the keyword map in `shared/constants.ts` — edit
  that file to tune it.
- **Categories**: Sharik, Nitin, Wood, Electrical, Paint, Plumbing, Tiles,
  Marble, Aluminium, Govt Fee/Chalan, MDA/Mutation, Gift, Site Prep, Legal,
  Utility Bill, Misc — shared by the ledger, dashboard, BOQ and stock.
- The Android back button navigates tab → dashboard → exit, and closes the
  bill review screen instead of leaving the app.
- Replacing the seed: regenerate `seed-entries.json` / `seed-boq.json`,
  rebuild, redeploy — the JSON is bundled so first-run seeding also works
  offline.
