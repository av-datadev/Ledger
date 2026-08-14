# Brick Book

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

Most of the app works in airplane mode. These don't:

| Feature | Why |
| --- | --- |
| Bill / note / size-list scanning | Gemini vision, via Supabase Edge Functions |
| Working out an outside spreadsheet's layout | Gemini, via `analyse-import` — skippable, see below |
| Household sync + sign-in | Supabase |
| Push notifications | Web Push via the `send-push` function |
| Deleting an account | the `delete-account` function |

Printed English bills fall back to on-device Tesseract OCR when Gemini can't
be reached. **Handwriting and Hindi have no fallback** — Tesseract ships
English-only training data and cannot read Devanagari at all. When the good
reader is unavailable the review screen says so, loudly, rather than
presenting Tesseract's guess as if it were a scan.

The Edge Functions wait out a busy or rate-limited Gemini rather than failing
the scan — up to 3 attempts inside a ~100s budget, honouring the `retryDelay`
Google asks for. A per-*minute* limit clears in seconds and is worth waiting
out; a per-*day* quota is told apart by its `quotaId` and reported straight
away, since retrying it only spins.

> **Gemini free tier is 20 requests/day.** Spend it and the review screen says
> the daily limit is gone rather than passing off the weaker reader's guess as
> a scan; a bill that fell back offers **Try the AI reader again**. If more
> than one person is scanning, enable billing on the API key.

## Stack

React 19 · Vite · TypeScript (strict) · Tailwind v4 · Dexie/IndexedDB ·
vite-plugin-pwa (Workbox) · tesseract.js (on-device OCR) · pdfjs · jsQR ·
write-excel-file / read-excel-file (lazy-loaded) · Supabase (Postgres + RLS +
Edge Functions + Storage + Auth).

## Repo layout

```
shared/constants.ts    category enum + scanner keyword→category map
src/                   the PWA
src/lib/               sync, scanning, import, backup, stock, measures, push
public/tesseract/      self-hosted OCR worker, wasm cores, English data
public/*.html          privacy, terms and delete-account — static, no JS
scripts/               icon generator, tesseract vendoring, user-guide build
supabase/functions/    scan-bill, scan-note, scan-sizes, analyse-import,
                       send-push, delete-account
supabase/migrations/   SQL for columns the sync engine pushes
android-twa/           Play Store packaging only — no Android source
design/                HTML mockups the current skin came from
files/                 the build spec (ClaudeCode_HouseLedger_Prompt.md)
Ref_img/               real bills used as scanner test fixtures
```

Three things that will bite you:

**Sync pushes whole rows** (`upsert({...obj})` in `src/lib/sync.ts`), so any
new field on a synced type needs its column added remotely *first*. PostgREST
rejects the upsert otherwise and sync.ts only `console.error`s it, which looks
exactly like a bill that saved fine and silently never synced. Apply anything
in `supabase/migrations/` before shipping a build that writes the field.

**OCR needs all three Tesseract core variants** vendored, including
relaxed-SIMD. Miss one and every scan fails on the devices that pick it.
`npm run vendor:tesseract` runs as part of `npm run build` and enforces this.

**The realtime channel is not a reliable wake-up.** Sync reconciles once at
startup and then leans on a Supabase realtime subscription, which a sleeping
phone or a network change kills with no error and no retry — the object still
looks live. `resyncNow()` re-runs the reconcile *and replaces the channel*
rather than trusting it; anything that needs fresh data should call that, not
assume the subscription is still delivering.

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

There is also an Android build for the Play Store — a Trusted Web Activity
wrapping this same site, so there is no second codebase. See
[android-twa/README.md](android-twa/README.md), and read its note on the
signing key before touching anything there.

## Feature notes

- **Bills** — photo or PDF, read by Gemini into editable line items. Line
  items are goods only; GST, freight and rounding are computed, not itemised.
  Rows summing to *more* than the printed total blocks saving, since that means
  a duplicated or misread row.
- **A bill spread over several photos** — a kaccha bill is a notebook page, and
  a running account routinely covers two or three. Photos accumulate in a tray
  (one shot at a time from the camera, or several at once from the gallery) and
  are read **together, in one call** — `scan-bill` merges a sequence of page
  images into a single item list, the same mechanism the multi-page PDF path
  uses. Read one page at a time they become unrelated bills, each holding a
  fragment of the items and only one carrying the जमा/शेष line. Capped at 6
  pages, matching the PDF path. **Try the AI reader again** re-sends every page.
- **Handwritten kaccha bills** carry something printed invoices don't: what was
  actually paid and what's still owed. After scanning, choose **Bill only**,
  **Payment only**, or **Both**. The ledger entry takes the *paid* figure, not
  the invoice total, dated the day the money moved.
- **Keeping a bill as one line** — a review-screen toggle. Every scanned row is
  still saved and still opens on tap; what changes is downstream. Twenty rows
  of a handwritten fittings bill would otherwise become twenty stock items to
  hand out and tick off one by one, each named by whatever the reader made of a
  Devanagari line — so a clubbed bill goes into Stock as the single thing it
  is. Off by default (clubbing is a judgement about one particular paper), and
  never offered on a size list, whose measured-vs-written check has nothing to
  check without its rows.
- **Paying a bill that already exists** (BOQ → tap a bill → **Record a
  payment**) — the review screen's Bill / Payment / Both choice only happens at
  the moment of saving, so picking *Bill only* by mistake used to be final: the
  bill sat there with money against it the ledger never knew about. Recording a
  payment now writes both halves in one transaction — a ledger entry dated the
  day the money moved, and `amountPaid` on every row of the bill. It **adds**
  to what was already paid rather than replacing it, which is what makes
  instalments work: ₹50,000 today and ₹30,000 next month leaves the bill having
  had ₹80,000, as two ledger entries. The form pre-fills whatever is still due.
- **Part payment** — the normal case on a running account, so the paid figure
  is asked for on the bill itself rather than only when a ledger entry is being
  created. `amountPaid` is stored on the bill, and what's still owed shows on
  the review screen as you type it, on each bill in the BOQ list behind a
  **Still to pay** filter, and per vendor on People. `amountPaid` is **null,
  not 0**, when nothing has been recorded: a bill nobody has answered the
  question for is not a bill confirmed unpaid, and a default of 0 would
  announce every bill already on record as fully outstanding.
- **Size lists** (BOQ → *Size list*) — timber and stone dealers price by size,
  not quantity: `Teak / 8¼ × 9 × 8 — 3 pc`. Each size becomes one `cft` row and
  the app computes the volume itself — **length ft × width in × thickness in ÷
  144 × pieces** — then checks its total against the dealer's own written
  figure, stored beside it as `writtenQty`. The reader transcribes and never
  does the arithmetic: two independent figures are the only thing that makes
  the check worth anything.
- **Handwritten notes** (Entry) — a kaccha slip, cheque or Hindi diary page
  fills the entry form and keeps the photo as proof. Opt-in per device, since
  the photo leaves the phone. A vendor's running account is a bill *and* a
  payment on one sheet, so the reader also reports the goods rows it found:
  rather than collapsing the table into one ledger line, the form says **this
  paper is a bill, not just a payment** and offers to send it to the BOQ, where
  the same Bill / Payment / Both choice decides where it lands. Which tab the
  paper was scanned from no longer decides what survives of it.
- **Paid vs billed** (Ledger) — money handed over that no bill accounts for
  yet. A gap isn't proof of anything; labour never has a bill. It's worth a
  question when the payment was for material.
- **Taking a whole bill back out of Stock** (Stock → *By BOQ bill*) — line by
  line is right for one wrong row; a bill saved with every quantity wrong needs
  as many confirmations as it has rows. `removeBillFromStock` is deliberately
  narrow about what it destroys: the bill itself is untouched (deleting a bill
  lives on the BOQ tab), material already **given out to labour is kept** —
  those handouts happened — and a stock item is deleted only when nothing else
  ever touched it. Keeping the handouts means the item can be left at a
  negative balance, so `billStockImpact` works the damage out first and the
  confirmation states it in real numbers rather than asking if you're sure.
- **Selecting several stock items** (Stock → *All items* → **Select**) — for
  "these particular rows", where the whole-bill removal above is for "undo that
  entire bill". A *mode*, not a second checkbox: every row already carries a
  tick meaning **fully used / settled**, and a delete-me tick beside an
  archive-me tick on twenty rows is an invitation to press the wrong one. While
  selecting, that same checkbox changes meaning (and colour), the card itself
  becomes the tap target, and the per-row buttons hide so a tap can't be a
  near-miss on *Edit*. **Select all follows the category filter** — filter to
  Plumbing, select all, act — which is the point of it. Selection survives a
  filter change so several categories can be gathered, so the bar and the
  delete confirmation both say how many of the selected rows are **not
  currently on screen**. Bulk actions: delete (one transaction — a bulk delete
  that fails halfway leaves a selection nobody can reason about), mark done,
  mark not done.
- **Backups** — JSON is the complete one and the only format carrying entry
  photos. Excel (.xlsx) opens anywhere and can be corrected by hand and
  uploaded back, but holds no photos, so restoring one deliberately leaves the
  photos already on the device untouched.
- **Importing someone else's sheet** (Data → *Bring in an old spreadsheet*) —
  distinct from the Excel restore above, which reads a workbook this app
  wrote. This takes an .xlsx, .csv or pasted note with no agreed shape at all,
  and **adds** to the ledger rather than replacing it. Only a sample leaves
  the phone: `analyse-import` sees the sheet names, the headings and ten rows
  and returns a *mapping*; every row is then converted on-device, so a file of
  five thousand payments costs one small call. A second call sends category
  **names** alone to suggest merges. Both are suggestions — date order is
  re-derived from the whole column first, since a confident wrong guess moves
  every payment to a different month, and a category keeps the person's own
  name unless the match is confident. The preview shows the total being
  imported so it can be checked against the total at the bottom of their own
  sheet. A checkbox skips the AI step entirely and maps the columns by hand;
  that path makes zero network calls and works offline.
- **Freshness** — the Dashboard's **Refresh** button re-pulls the shared
  ledger and says when the last pull happened, and only appears on a device
  that actually has a household. Coming back to the app re-pulls too, if the
  last one is over 30s old, which is the half that matters: an entry added on
  one phone used to sit unseen on another until the app was fully restarted.
  A background failure stays silent (the phone is usually just offline and the
  local ledger is still right); a pressed button reports.
- **Account deletion** — from Settings, or from `/delete-account.html` without
  installing anything. `delete-account` resolves the caller from their own
  token before the admin client touches a row, and removes the login **last**,
  so every earlier step stays retryable. Leaving a household always drops the
  membership but only destroys the ledger when the last member leaves — one
  person deleting must leave the others whole. Privacy and terms are static
  HTML at `/privacy.html` and `/terms.html`, readable with no JS and no
  sign-in, because that's how a store reviewer reads them.
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
- [ ] Stock → By BOQ bill → **remove everything this bill put into stock**: a
      bill-only item disappears, one with its own history survives, a handout
      is kept, and the BOQ rows are untouched
- [ ] Stock → All items → **Select**: filtering to one category then "select
      all" takes only that category; selection survives switching the filter
      and the confirmation says how many are off screen; delete removes the
      items *and* their movements
- [ ] A bill saved with **Keep this bill as one line** ticked reads as "one
      line · N rows kept" and puts a single line into Stock
- [ ] A part-paid bill shows its balance on the BOQ list and against the vendor
      on People; one with nothing recorded shows no balance at all
- [ ] Data: JSON and Excel backups download; both restore
- [ ] Data → Bring in an old spreadsheet, with **"I'll pick the columns
      myself"** ticked: imports with no network call at all

Online only:

- [ ] BOQ scan of a photo/PDF via Gemini
- [ ] Several photos of one bill: the tray holds them, they read as **one**
      bill in **one** call, and the rows from every page arrive together
- [ ] BOQ → Size list on a timber slip; measured total matches the written one
- [ ] A handwritten kaccha bill offers Bill / Payment / Both
- [ ] An itemised kaccha slip scanned from **Entry** offers to send it to the
      BOQ, and lands on the review screen with its rows intact
- [ ] Import an outside .xlsx: the mapping is right, and the imported total
      matches the total written at the bottom of the source sheet
- [ ] Sign in, sync across two devices
- [ ] Dashboard **Refresh** pulls an entry added on the other phone, and
      backgrounding and returning does the same with no interaction
- [ ] Site link: share code, approve, both sides post to the shared ledger
- [ ] Push arrives on a real phone

Round trip: export a backup → clear all data → import it → counts match.
Worth doing for **both** formats; the Excel path is verified to preserve
nulls-as-nulls, a `gstPct` of 0, and nested contract lines.
