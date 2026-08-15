# Brick Book — build spec

Originally the prompt that created this app as "House Ledger". Kept current as
a specification of what it now is, so it can be rebuilt or handed to someone
new. Where the original brief was overtaken by reality, this says so — those
reversals are the most useful part of the document.

Last updated: 2026-08-14.

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
  CLI for functions. Android ships as a Trusted Web Activity wrapping that same
  site (`android-twa/`), so there is no second codebase and a content change
  needs no store submission.

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
mode, paidBy, notes, createdAt, updatedAt,
billAllocations
```
`billAllocations` is `{billId, amount}[]` or null — which BOQ bills this
payment was placed against. null on an ordinary entry, which is most spending.
See §6: it is what makes a payment a record that can be corrected rather than a
number that was added to a total.

**boqItems** — bill line items, many-to-one with an invoice via `billId`:
```
id, billId, date, category, vendor, invoiceNo, invoiceTotal,
item, hsn, gstPct,
basis ("qty" | "rft" | "sqft" | "sqm" | "wt" | "cft"),
length, width, thickness, pieces, writtenQty,
qty, unit, rate, discPct, amount,
amountPaid, clubbed
```
`basis` drives how `qty` is derived. For `cft` it's
`length ft × width in × thickness in ÷ 144 × pieces`. `writtenQty` holds the
dealer's own written total, purely so the app's figure can be checked against
it — it is never used in a calculation.

A bill has **no table of its own** — it is the rows sharing a `billId`. So its
bill-level facts (`invoiceTotal`, `writtenQty`, `amountPaid`, `clubbed`) are
repeated on every row and read off the first one. Never sum them, or the bill
is multiplied by its own line count.

`amountPaid` and `clubbed` are **nullable, and null by default**. See §6.

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
   Photos accumulate in a tray and are read as one bill (§5). Everything lands
   in a review screen before saving. Rows summing to *more* than the printed
   total blocks the save; below it is fine, because that gap is the tax. Two-way
   BOQ↔Stock linking. Coverage table vs the ledger. Bills list what is still
   owed on them, behind a **Still to pay** filter (§6).

6. **Stock** — received vs given out to labour, balance, hard-linked to the
   source bill. Two ways to clear more than one row at a time, and they answer
   different questions: a whole bill taken back out in one action, and a
   selection mode for particular rows (both §6).

7. **People** — every category as an editable person: contact, contract
   pricing (lump sum, area×rate, or per-floor lines), bank details scannable
   from a UPI QR, per-person totals.

8. **Data** — JSON and Excel backup/restore, importing somebody else's
   spreadsheet (§7), CSV exports, notification toggle, text size, site code and
   linked contractors, a folded FAQ, app version with a force-update link,
   links to the privacy/terms/deletion pages, danger zone including account
   deletion.

The Dashboard also carries a **Refresh** control, on a device that has a
household. It re-pulls the shared ledger and shows when the last pull happened,
so "is this up to date?" is answered on screen rather than by pressing it.

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

**One bill can be several photos.** A kaccha bill is a notebook page and a
running account routinely covers two or three. Photos accumulate in a tray —
one shot at a time from the camera, several at once from the gallery — and go
to the reader **together, in one call**: `scan-bill` takes an array of page
images and merges them into a single item list, which is how the multi-page PDF
path already works. Two reasons it must be one call and not one per page:

- Read separately they become unrelated bills, each holding a fragment of the
  items, and only one of them carrying the जमा/शेष line that says what was paid.
- The free tier is 20 requests a day. Three pages costing three requests is the
  difference between scanning a day's bills and running out by mid-morning.

Cap at 6 pages, matching the PDF path. A retry after a failed read must re-send
**every** page, not just the first. On the OCR fallback each page is recognised
on its own and the text joined, the same way a PDF's pages are.

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

## 6. A bill kept as one line, and a bill part paid

Two things a handwritten vendor bill needs that a printed invoice does not.

### Clubbing

A review-screen toggle keeps a bill as **one line** rather than as its items.
Clubbing still **saves every row** — they are the evidence, and they still open
on tap. What it changes is downstream: twenty rows of a handwritten fittings
bill would otherwise become twenty stock items to hand out and tick off one by
one, each named by whatever the reader made of a Devanagari line. A clubbed
bill goes into Stock as the single thing it is.

Off by default, because clubbing is a judgement about one particular paper and
turning it on for someone hides an itemisation they may have wanted. Never
offered on a size list, whose whole point is the measured-vs-written check —
there is nothing to check once the rows are collapsed away. Re-opening a
clubbed bill to edit it must keep it clubbed, or saving quietly itemises a bill
somebody deliberately kept whole.

### Part payment

Paying a vendor part of a bill is the normal case on a running account, so the
paid figure is asked for **on the bill**, not only when a ledger entry is being
created — the bill may be recorded now and the payment already be in the ledger.
`invoiceTotal - amountPaid` is what the vendor is still owed, surfaced three
ways: live on the review screen as the figure is typed, per bill in the BOQ
list behind a **Still to pay** filter, and per vendor on People.

### The dealer's running account

A **dealer is not a category**. "Plumbing" is what the money was for; the dealer
is who it is owed to, and one category routinely has several. Money is handed
over against the account rather than against an invoice — three bills and one
payment of ₹50,000 is the ordinary case, not an awkward one — so bills group per
vendor and the account answers "what do we still owe the plumbing shop?".

Grouping is case- and space-insensitive, because one shop is typed three ways
across three bills. Bills naming no seller (which the reader is right not to
invent) group per category rather than collapsing every unnamed bill in the app
into a single fictional dealer.

**The person places the payment, not the app.** Each bill offers *Full* or a
part amount, against a running "placed X of Y". Oldest-first is computed and
offered as the opening suggestion, and follows the amount while it is typed —
but stops the moment a bill is touched by hand, because silently re-splitting a
deliberate allocation when someone fixes a typo is worse than a stale
suggestion. Which bill a payment settles is the payer's knowledge: a dealer and
a customer routinely agree that a particular bill is being cleared, and guessing
that wrong makes every bill's balance a fiction even when the dealer total comes
out right.

**One payment writes one ledger entry**, not one per bill it touches. Three
entries for a single ₹50,000 would overstate how many times money moved, and the
ledger is what the dashboard totals and paid-vs-billed are computed from.

Money may be placed short of the payment; the remainder is an **advance** with
that dealer, which is ordinary when paying ahead of the paperwork. It is
*derived* — the ledger's payments to that dealer, less what the bills record as
placed — because there is no dealer table to bank a balance on. Anything relying
on it should know that editing those ledger entries moves it.

### Payments are records, not a running total

`amountPaid` alone cannot be corrected. A bill knowing only that ₹30,000 has
been paid means "the ₹30,000 payment" is not a thing that exists to edit — just
a number that was added to, and a ledger row that happens to match it. So a
payment carries `Entry.billAllocations`: `{billId, amount}[]`, a **list**
because one payment routinely settles several bills of a dealer's account and is
still one payment.

A bill lists its payments individually, each editable and removable. Editing
rewrites the ledger entry and the bill in one transaction — they are two halves
of one fact. An entry that settled several bills has only its share of *this*
bill changed, and is deleted outright only when this was the sole bill it paid.
A linked entry is **not** editable from the Ledger, which would change the
ledger and leave the bill still claiming the old figure; it says so and points
at the bill.

**Money recorded before the link existed is not lost and not guessed at.** It
shows as one editable *recorded earlier* figure — the part of `amountPaid` that
no entry stands behind — described as *not linked*, since a matching entry may
well exist and inventing the link would be a fabrication.

For the case where the same cash sits in both places, a bill can **link an
existing ledger entry**. This is *re-attribution*, not payment: the entry fits
inside what the bill already counted as unlinked, so the total does not move.
Candidates are ranked (exact amount, then category, then date proximity) and
**never applied automatically** — a wrong guess ties money to the wrong bill
silently, which is found months later if ever. Only already-unlinked entries are
offered, so one payment cannot reach two bills, and the single case that raises
the total (an entry larger than the unlinked figure) is stated before it is
applied.

Deleting a bill keeps its payments in the ledger and clears their links. The
money genuinely left; deleting the paperwork does not undo that.

**A bill already saved must be payable.** The Bill / Payment / Both choice only
exists at the moment of saving, so choosing *Bill only* by mistake would
otherwise be final — the bill on record, the money against it invisible to the
ledger. An existing bill therefore offers **Record a payment**, which writes
both halves in one transaction: a ledger entry dated the day the money moved,
and `amountPaid` across every row of the bill. It **adds** rather than replaces,
which is what makes instalments work — two payments on a running account become
two ledger entries and one bill that has had the sum of them. Editing a bill
must carry `amountPaid` through untouched: an edit rewrites every row, so a
blank field there silently erases the bill's payment and its balance.

**`amountPaid` is null, not 0, when nothing has been recorded.** A bill nobody
has answered the question for is not a bill confirmed unpaid. A default of 0 —
in the type, in the Dexie upgrade, in the backup normalisers, or as a column
default in Postgres — announces every bill already on record, and every bill
restored from an older backup, as fully outstanding. Outstanding is likewise
null rather than the full total when there is no paid figure to work from, so
only bills that have actually been answered reach a list of money owed.

### Taking a bill back out of Stock

Line by line is right for one wrong row; a bill saved with every quantity wrong
costs as many confirmations as it has rows, which is how a mis-scanned bill
ends up left in inventory instead. One action removes the lot, and is
deliberately narrow about what it destroys:

- **Not the bill.** The BOQ rows record what was purchased; this unwinds only
  what was taken into inventory from them.
- **Not anything given out to labour.** Those handouts record things that
  actually happened. Keeping them means removing the receipts behind them can
  leave an item at a negative balance — so the impact is computed *before*
  anything is written and the confirmation states it in real numbers (how many
  receipts, how much in total, how many items vanish versus keep their own
  history, how much has already gone out) rather than asking "are you sure?".
- **An item only when nothing else ever touched it.** One holding a manual
  receipt, or a receipt from another bill, keeps its history and loses only
  this bill's contribution.

### Selecting several stock rows

The other half of the same problem, and a different question: *those particular
rows*, rather than *undo that bill*. A **selection mode** on the all-items list,
deliberately not a second checkbox — every row already carries a tick meaning
"fully used / settled", and a delete-me tick beside an archive-me tick, on every
row, is an invitation to press the wrong one. While selecting, that same
checkbox changes meaning and colour, the card becomes the tap target, and the
per-row actions hide so a tap cannot be a near-miss on *Edit*.

**Select-all acts on what the filter is showing** — filter to a category,
select all, act. That is what makes it useful on a bill that put twenty rows
into inventory at once. Selection deliberately survives a change of filter, so
more than one category can be gathered before acting; the consequence is that
some of what is selected may be off screen, so both the bar and the delete
confirmation say how many. Bulk delete runs as one transaction: one that fails
halfway leaves a selection nobody can reason about, because there is no way to
tell which half went.

## 7. Importing somebody else's spreadsheet

Distinct from the .xlsx *restore*, which reads a workbook this app wrote, with
a known meta sheet and fixed columns. This reads a file with no agreed shape at
all — years of spending someone arrives with — and **adds** to the ledger
rather than replacing it, since an import happens on top of whatever is already
there.

**Only a sample crosses the network.** `analyse-import` receives the sheet
names, the headings and ten rows, and returns a *mapping* — which column index
is the date, which the amount, how dates are ordered. Every row is then
converted on the device. A file of five thousand payments costs one small call
and the person's financial history never leaves their phone. A second, smaller
call sends category **names** alone — no figures, no vendors — to suggest which
of theirs merge into ours.

The model's answer is a suggestion, not an instruction:

- **Date order is re-derived from the whole column first.** A day of 25 settles
  day-first outright, and a confident wrong guess moves every payment in the
  file to a different month.
- **Categories keep the person's own name** unless the match is confident. A
  wrong merge is silent and hard to notice later, so the review screen offers
  the suggestion, the alternatives, and the questions the reader could not
  resolve.
- **Nothing is written until the rows have been seen.** The preview shows the
  total being imported precisely so it can be checked against the total written
  at the bottom of their own sheet — two independent numbers, the same check
  the size-list reader uses.
- The commit is **one transaction**: half an imported ledger is worse than
  none, because the person cannot tell which half.

**The AI step must be skippable.** A checkbox maps the columns by hand instead
and makes zero network calls, which is what the privacy policy promises, so it
has to actually exist.

Parsing lives in `importParse.ts`, deliberately free of any network import so
it can be exercised directly: day-first vs month-first, Excel serials, lakh
grouping, bracketed negatives, and impossible dates like 31 February.

## 8. Sync and freshness

Two-way reconcile at startup, then a Supabase realtime channel. **The channel
is not trustworthy on its own** — a sleeping phone or a network change kills it
with no error and no retry, and the dead subscription still looks like a live
object. An entry added on one phone therefore sat unseen on another until the
app was fully restarted.

`resyncNow()` re-runs the same idempotent reconcile and **replaces** the
channel rather than trusting it. Concurrent calls collapse onto the first, or
two passes race to push the same local-only rows. It runs on the Dashboard's
Refresh button, on returning to the app if the last pull is over 30s old, and
on regaining signal. Nobody should have to know about a button for their own
ledger to be right. A background failure stays silent — the phone is usually
just offline and the local ledger is still correct — while a pressed button
reports.

## 9. Account deletion, and saying what is held

Required before any store listing exists: Play's User Data policy demands
deletion from *inside* the app **and** a web page where it can be requested
without installing anything, and the Data safety form will not submit without a
privacy policy URL.

- `delete-account` resolves the caller from their own token and only then lets
  the admin client act, on rows belonging to that resolved id. A client cannot
  delete its own auth user, and the service-role key must never reach a device.
- **The login goes last.** Everything before it is retryable while the account
  still exists; an auth user deleted out from under its data leaves rows nobody
  can reach.
- **Leaving must not destroy the books of the people still in the household.**
  Membership always goes; the ledger goes only when the last member leaves.
- Privacy, terms and the deletion request page are **static HTML**, not app
  routes — a reviewer, and anyone who has not installed the app, has to read
  them with no JavaScript and no sign-in. The privacy policy says plainly that
  with the AI reader on, the photograph is sent to Google's Gemini API, and
  that the setting is per-device, so one person enabling it never enables it
  for the rest of the household.

## 10. Offline behaviour

Precache the shell. Dexie works offline by nature: dashboard, ledger, manual
entry, manual BOQ, stock, backup/restore, CSV and a hand-mapped import must all
work in airplane mode. Only sync, scanning, import layout analysis and push
need a connection, and each must fail visibly rather than blankly.

## 11. Visual design

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

## 12. Non-functional

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

## 13. Acceptance

- [ ] Installs to the home screen and launches standalone
- [ ] Airplane mode: manual entry, dashboard, manual bill, backup/restore, CSV,
      and an import with the columns picked by hand
- [ ] A photographed GST invoice extracts line items summing to the printed
      total, or flags the mismatch
- [ ] A handwritten Hindi bill extracts its items **and** its payment, and
      offers Bill / Payment / Both
- [ ] A bill photographed across three pages reads as **one** bill, in **one**
      call, with the rows from every page merged
- [ ] A clubbed bill still stores all its rows, and puts a single line into
      Stock rather than one per row
- [ ] A part-paid bill shows its balance on the review screen, in the BOQ list
      and against its vendor; a bill with nothing recorded shows none of them
- [ ] A bill saved as **Bill only** can be paid afterwards, twice over, and
      ends settled with two ledger entries — and editing it does not wipe what
      it records as paid
- [ ] Three bills from one dealer form one account; a single payment placed
      across them by hand (one Full, one part) writes **one** ledger entry and
      leaves each bill's balance right
- [ ] Placing less than the payment leaves the rest as an advance with that
      dealer
- [ ] A payment on a bill can be edited and removed, and the ledger entry moves
      with it; the same entry cannot be edited from the Ledger
- [ ] A bill's pre-existing paid figure can be linked to the ledger entry that
      was that money, **without** the bill's total changing
- [ ] Removing a bill from Stock leaves the bill, the handouts, and any item
      with its own history intact
- [ ] A timber size list computes cubic feet matching the dealer's own figure
- [ ] Backup → clear → restore, for **both** JSON and Excel
- [ ] An outside spreadsheet imports on top of existing entries, summing to the
      total written at the bottom of the source file
- [ ] Two devices signed into one household see each other's entries, and an
      entry added on one appears on the other without restarting the app
- [ ] A linked contractor reads zero rows of the private ledger
- [ ] Deleting an account removes its login and its own rows, and leaves the
      remaining household members' books intact
- [ ] No entry saves with a zero amount or empty description
