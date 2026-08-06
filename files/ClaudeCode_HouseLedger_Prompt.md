# Brick Book — build spec

Originally the prompt that created this app as "House Ledger". Kept current as
a specification of what it now is, so it can be rebuilt or handed to someone
new. Where the original brief was overtaken by reality, this says so — those
reversals are the most useful part of the document.

Last updated: 2026-08-03.

---

Build an installable, offline-first PWA called **Brick Book** for tracking the
money, materials and people involved in building a house. It replaces an Excel
workbook. Target: Android Chrome and iOS Safari, installed to the home screen,
full-screen with no browser chrome.

## 1. Stack

- **Frontend** — Vite + React + TypeScript (strict) + Tailwind v4
- **Local storage** — Dexie.js (IndexedDB). Not localStorage: too small and too
  fragile for years of a build.
- **Offline** — `vite-plugin-pwa` (Workbox), precached app shell
- **Backend** — Supabase: Postgres with row-level security, Auth (email OTP),
  Storage, and Edge Functions. No Express server.
- **AI** — Gemini vision, called *only* from Edge Functions so the key never
  reaches a device
- **Deployment** — Vercel for the client (auto-deploys from `main`), Supabase
  CLI for functions

> **Reversed from the original brief.** It specified an Express/Vercel
> serverless backend calling the Anthropic API, and "no cloud sync, on-device
> only". Both changed: several family members needed one shared ledger, which
> forced a real database with row-level security, and once Supabase was there
> the Edge Functions were the natural home for the AI calls. The instinct the
> original got right — *never put the API key in the client* — is unchanged and
> is why every model call still goes through a function.

## 2. Data model

Dexie tables: `entries`, `boqItems`, `stockItems`, `stockMoves`, `categories`,
`people`, `attachments`, `settings`, plus contractor-side `contractorSites` and
`siteLedgerRows`.

**entries** — the payment ledger:
```
id, date (YYYY-MM-DD), category, event, detail, amount,
mode, paidBy, notes, createdAt, updatedAt
```

**boqItems** — bill line items, many-to-one with an invoice via `billId`:
```
id, billId, date, category, vendor, invoiceNo, invoiceTotal,
item, hsn, gstPct,
basis ("qty" | "rft" | "sqft" | "sqm" | "wt" | "cft"),
length, width, thickness, pieces, writtenQty,
qty, unit, rate, discPct, amount
```
`basis` drives how `qty` is derived. For `cft` it's
`length ft × width in × thickness in ÷ 144 × pieces`. `writtenQty` holds the
dealer's own written total, purely so the app's figure can be checked against
it — it is never used in a calculation.

**Categories are editable rows, not an enum.** Built-ins seed on first run;
each is also a person/vendor with contact details, bank details and contract
pricing (including per-floor contract lines).

> **Reversed from the original brief.** It specified a fixed 11-value category
> enum with real names hardcoded. Real use broke that within a week — an
> "Electrician" as a payee is a different thing from "Electrical" as a material
> cost, and the list has to be editable per project.

**No seed data.** A fresh install starts blank; a signed-in one pulls the
household's data down. The original brief specified seeding 82 migrated rows
from `seed-entries.json` on first launch — that was right for the first user
and wrong for everyone after, so the seed files were removed from the bundle.

## 3. Two roles

A role gate on first launch, switchable from the header.

**Owner** — 8 tabs: Dash · Entry · Ledger · Recent · BOQ · Stock · People · Data.

**Contractor** — multiple sites, each with its own money log and a balance
splitting spend-with-a-bill from spend-with-nothing. Device-local and outside
household sync by design: a contractor has no household, and his other sites
must never be visible to a homeowner. That means a lost phone loses the books,
so the contractor side has its own JSON backup/restore.

**Site linking** joins them. The owner shares a site code (separate from the
family invite code, so revoking a contractor never disturbs family sync); the
contractor requests; the owner approves. This is deliberately **not** household
membership — that would hand him all entries, every other vendor, the budget,
bank details, and family transfers. It's a third, separately-scoped space:
one site, one household, one contractor. Both sides record their own rows,
`author_role` is enforced server-side, and neither can edit the other's, so a
mismatch is *flagged* rather than silently overwritten. Surfacing the
disagreement is the entire point of the feature.

## 4. Screens

1. **Dashboard** — sticky total in Indian digit grouping, budget bar, spend by
   category (tap to drill into the Ledger), paid-by breakdown, stock in hand,
   house address.

2. **Entry** — date, category, description, detail, amount, mode, paid-by,
   notes, plus photo attachments. Can read a handwritten slip, cheque or Hindi
   diary page into the form (opt-in per device — the photo leaves the phone).

3. **Ledger** — search; four filters: category, mode, payer, and **date range**
   (from, to, or either alone). Long notes fold behind a "note" chip. Inline
   edit and delete. CSV export. **Paid vs billed** sits at the top: paid,
   billed, and the gap no bill accounts for, with a per-payee breakdown that
   filters the list beneath it.

4. **Recent** — the 50 most recently added or edited entries.

5. **BOQ** — four ways in: Take photo · Photo/PDF · Size list · Type manually.
   Everything lands in a review screen before saving. Rows summing to *more*
   than the printed total blocks the save; below it is fine, because that gap
   is the tax. Two-way BOQ↔Stock linking. Coverage table vs the ledger.

6. **Stock** — received vs given out to labour, balance, hard-linked to the
   source bill.

7. **People** — every category as an editable person: contact, contract
   pricing (lump sum, area×rate, or per-floor lines), bank details scannable
   from a UPI QR, per-person totals.

8. **Data** — JSON and Excel backup/restore, CSV exports, notification toggle,
   text size, site code and linked contractors, a folded FAQ, app version with
   a force-update link, danger zone.

## 5. Scanning

Three Edge Functions, deliberately separate because the outputs differ:

| Function | Input | Output |
| --- | --- | --- |
| `scan-bill` | printed invoice **or** handwritten kaccha bill | line items + totals + payment |
| `scan-note` | a slip that is *only* a payment | one ledger entry |
| `scan-sizes` | a dealer's size list | one `cft` row per size |

`scan-bill` also reads what a kaccha bill records and a printed invoice never
does — जमा (paid) and शेष (balance) — so one sheet of paper can become a bill,
a payment, or both, and the person chooses which.

Rules the prompts encode, each from a real misread:

- Indian digit grouping is lakh-based: `1,00,000` is 100000
- Handwriting is day-first: `21/7/26` is 21 July
- Item names come back in **English** — untranslated Devanagari filed every
  plumbing bill under Misc, because the category matcher is keyword-based
- Vendor is left **empty** rather than guessed; the reader used to answer
  "Hardware Store" for a paper naming no seller, and the review screen then
  demanded that fiction before it would save
- Vendors tick delivered rows, and the tick fuses with the digit it touches —
  a tick plus `1` is indistinguishable from a `4`, so a written 10 read as 40.
  The quantity column is read as a *column* for this reason.

On-device Tesseract stays as the offline fallback for printed English bills.
**It has no ability to read Devanagari or handwriting**, so when it stands in,
the review screen says so and names the cause. Falling back silently produced a
confidently wrong bill that looked exactly like a right one.

> **Gemini's free tier allows 20 requests/day.** Exhaust it and every scan
> degrades to the fallback. Enable billing if more than one person scans.

## 6. Offline behaviour

Precache the shell. Dexie works offline by nature: dashboard, ledger, manual
entry, manual BOQ, stock, backup/restore and CSV must all work in airplane
mode. Only sync, scanning and push need a connection, and each must fail
visibly rather than blankly.

## 7. Visual design

A ledger/accounting aesthetic, not consumer fintech. Warm paper ground
(`#F5F3EC`), ink navy (`#15232E`), one terracotta accent (`#C0562F`), muted
moss for positives, serif headings against system sans, monospace for every
money figure, small-caps letter-spaced badges, soft card shadows, 10px radii.
Mobile-first, single column, fixed bottom tab bar.

**Every colour is a token in `src/index.css`.** No component hardcodes one,
which is what let the whole app be reskinned as a token swap in a single file.
Dark mode is hand-authored — nothing dark falls out of a light-only mockup for
free. Keep ≥44px tap targets, respect `prefers-reduced-motion`, and self-host
any font: this app must not fetch from a CDN at runtime.

## 8. Non-functional

- TypeScript strict; no console errors in normal use
- Android back button: tab → dashboard → exit, and closes a review screen
  rather than leaving the app
- Passes PWA installability (manifest, service worker, HTTPS, 192/512 icons)
- **Never commit a secret.** `GEMINI_API_KEY`, `VAPID_PRIVATE_KEY` and the
  service-role key exist only as Edge Function secrets. The Supabase URL and
  publishable key are *meant* to ship — RLS is the protection, not obscurity.
- Any new field on a synced type needs its remote column added **first**, or
  the upsert is rejected and only `console.error`s — indistinguishable from a
  save that worked.

## 9. Acceptance

- [ ] Installs to the home screen and launches standalone
- [ ] Airplane mode: manual entry, dashboard, manual bill, backup/restore, CSV
- [ ] A photographed GST invoice extracts line items summing to the printed
      total, or flags the mismatch
- [ ] A handwritten Hindi bill extracts its items **and** its payment, and
      offers Bill / Payment / Both
- [ ] A timber size list computes cubic feet matching the dealer's own figure
- [ ] Backup → clear → restore, for **both** JSON and Excel
- [ ] Two devices signed into one household see each other's entries
- [ ] A linked contractor reads zero rows of the private ledger
- [ ] No entry saves with a zero amount or empty description
