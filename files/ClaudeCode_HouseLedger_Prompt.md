# Claude Code Build Prompt — House Construction Ledger PWA

Paste everything below into Claude Code as the initial instruction.

---

Build an installable, offline-first Progressive Web App called **House Ledger** for tracking construction expenses on a house-building project. This replaces an Excel workbook and a prior browser-only prototype. Target platform: Android Chrome, installed via "Add to Home Screen" (manifest-based PWA, not React Native). I want a home-screen icon that opens full-screen with no browser chrome, works with zero internet connection for all core features, and syncs AI features only when online.

## 1. Tech stack (use exactly this unless you have a strong reason not to — tell me if you deviate)

- **Frontend**: Vite + React + TypeScript + Tailwind CSS
- **Local storage**: Dexie.js (IndexedDB wrapper) — not localStorage, it's too small and fragile for this data volume long-term
- **Offline/installability**: `vite-plugin-pwa` (Workbox under the hood) — precache the app shell, manifest.json with icons (generate a simple icon: dark navy background, a stacked-coins or ledger-line glyph, no photographic assets)
- **Backend**: a minimal Node/Express server (or Vercel serverless functions if you deploy there) with exactly two routes:
  - `POST /api/parse-voice` — takes transcribed text, returns structured transaction JSON
  - `POST /api/extract-bill` — takes a base64 image or PDF, returns structured BOQ JSON
  Both routes call the Anthropic API server-side using an API key from an environment variable (`ANTHROPIC_API_KEY`), never sent to or stored in the client.
- **Deployment**: assume Vercel (frontend + serverless functions together) unless I say otherwise. Give me exact deploy steps at the end.

## 2. Data model

Two tables in Dexie, plus a settings table.

**entries** (the payment ledger):
```
id: string (uuid)
date: string (YYYY-MM-DD)
category: string — one of: Sharik, Nitin, Wood, Electrical, Govt Fee/Chalan, MDA/Mutation, Gift, Site Prep, Legal, Utility Bill, Misc
event: string (short description, e.g. "Payment to Sharik")
detail: string (optional sub-vendor/detail, e.g. "Kisan Treders")
amount: number
mode: string — one of: Cash, GPay (SBI - 8101), GPay (DCB 0003), GPay (Deutsche Bank), GPay (PNB), SBI 8101, Cheque, SBI FD MDA, Other
paidBy: string — one of: Rajesh Verma, Sanjeev Verma, Sachin Verma, Chitra Verma, Apoorv Verma
notes: string (optional)
createdAt: number (timestamp, for sort/audit)
```

**boqItems** (itemized bill line items, many-to-one with an invoice):
```
id: string (uuid)
date: string
category: string (same enum as above)
vendor: string
invoiceNo: string
invoiceTotal: number (printed grand total on the bill — same for every line item under one invoice)
item: string (description)
hsn: string | null
gstPct: number | null
qty: number | null
unit: string | null
rate: number | null
discPct: number | null
amount: number (pre-tax line amount as printed; SGST/CGST/Freight/Rounding are their own rows with item="SGST" etc. and null hsn/qty/unit/rate)
```

**settings**: single row — `lastBackupDate`, `apiEndpoint` (defaults to same-origin `/api`).

## 3. Seed data — import on first launch only

On first run (empty database), seed `entries` with the migrated data from the source Excel workbook (82 transactions, ₹65,07,837 total). I will attach `seed-entries.json` in the repo root — read it and load it via a one-time migration if the `entries` table is empty.

Also seed `boqItems` with the 25 line items across the two Gopal Jee Electricals invoices (#4275, ₹6,090 and #2310, ₹22,981) — read from `seed-boq.json` in the repo root, same first-run-only migration logic.

Do not hardcode the seed data inline in a component. Load it from the JSON files so I can regenerate/replace them later without touching app code.

## 4. Screens / navigation

Bottom tab bar, 5 tabs, persists across the whole app:

1. **Dashboard** — running total in a sticky header (large, bold, formatted `₹XX,XX,XXX` Indian digit grouping). Below: horizontal bar chart of spend by category (11 categories), and a simple list of totals by "Paid By" person. All numbers computed live from Dexie, not cached.

2. **+ Entry** — the transaction form: Date (date picker, defaults today), Category (select, the 11-item enum), Description (text), Sub-vendor/detail (text, optional), Amount (numeric input, big and bold), Payment mode (select), Paid by (select), Notes (text, optional). A microphone button next to the header:
   - Tap to start Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`) listening, `lang = 'en-IN'`.
   - On result, if online: POST the transcript to `/api/parse-voice`, receive structured JSON, populate the form fields for the user to review (never auto-save).
   - If offline or the API call fails: run a local regex/keyword fallback parser (detect category keywords, "lakh"/"hazar"/"thousand" multipliers, payer first names, "gpay"/"cash"/"cheque" for mode) and populate what it can, with a visible "offline parse — please check the amount" warning.
   - Validate before save: amount > 0, description non-empty.

3. **Ledger** — searchable, filterable (by category) list of all entries, newest first, each row showing description, date, category badge, mode, paid by, amount, and a delete button with a confirm step. A "Backup CSV" button that generates and downloads/shares a CSV of all visible (filtered) entries.

4. **BOQ** — bill tracking:
   - Two add-bill paths: **Camera** (`<input type="file" accept="image/*" capture="environment">`) and **Upload file** (`<input type="file" accept="image/*,application/pdf">`).
   - On file selected, if online: convert to base64, POST to `/api/extract-bill`, receive `{ vendor, invoiceNo, date, category, invoiceTotal, items: [...] }`.
   - Show a review screen: editable vendor/invoice/date/category fields, an editable list of line items (description, qty, unit, rate, amount all editable inline), and a running "lines sum vs invoice total" check — block save unless they match (or the user acknowledges a mismatch explicitly).
   - If offline: skip AI extraction, go straight to a blank manual bill-entry form with the same structure and same reconciliation check.
   - A checkbox, unchecked by default: "Also create a ledger entry for this bill's total" — only creates an `entries` row if checked, to avoid double-counting bills that are already logged as a ledger payment.
   - Below: a **reconciliation table** — for each of the 11 categories, show BOQ-itemized total vs. ledger total for that category, so the user can see coverage.
   - Below that: list of bills on record, grouped by invoice, expandable to show line items, each group deletable.

5. **Data / Settings**:
   - **Export backup**: dumps entire Dexie database (`entries` + `boqItems`) to a single timestamped `.json` file, downloaded to the device. This is the primary safety net — say so explicitly in the UI copy.
   - **Import/restore**: file picker for a `.json` backup, confirms before overwriting current data, shows entry/BOQ counts before confirming.
   - **CSV export** for both tables independently.
   - Show "last backup: [date]" prominently, in red/warning color if more than 7 days old or never.
   - **Reset to seed data** button (double confirm) for recovering from mistakes during testing.

## 5. Offline behavior — be explicit about this, don't hand-wave it

- Precache the entire app shell (JS/CSS/HTML/icons) so the app opens fully offline after first successful load.
- Dexie/IndexedDB works fully offline by nature — Dashboard, Ledger, manual BOQ entry, backup/restore, CSV export must all work with airplane mode on. Write a manual test checklist into the README for me to verify this.
- Only these two things require internet: voice→AI parsing, bill photo→AI extraction. Both must fail gracefully (network error caught, fallback UI shown, never a blank screen or unhandled promise rejection) and never block the rest of the app.
- Show a persistent small "offline" indicator in the header when `navigator.onLine` is false, so the user knows why AI buttons are disabled/degraded.

## 6. Visual design

Not a generic Material Design template. Direction: dense, ledger/accounting aesthetic — think a physical accounts register, not a consumer fintech app. Dark ink-navy header (`#182B3A`), warm off-white background (`#F2F3EF`), a muted crimson accent (`#A63A2B`) for primary actions and warnings, a muted green (`#2F6D4F`) for confirmations/positive states, monospace font for all money figures, a humanist sans (system font is fine) for everything else. Category badges in small caps, letter-spaced. No rounded-pill buttons everywhere — rectangular with small corner radius (6-8px), thin 1px borders, no heavy shadows. Mobile-first, single column, bottom tab bar fixed.

## 7. Non-functional requirements

- TypeScript strict mode on.
- No console errors or warnings in normal use.
- Handle the Android back button sanely (don't exit the app from a sub-screen).
- Lighthouse PWA score should pass installability checks (manifest, service worker, HTTPS, icons at 192/512).
- README must include: local dev instructions, environment variables needed (`ANTHROPIC_API_KEY`), Vercel deploy steps, and exact steps for me to install this on my Android phone once deployed (open URL in Chrome → menu → "Add to Home Screen" / "Install app").
- Do not commit `.env` or the API key anywhere.

## 8. What "done" looks like — acceptance checklist

- [ ] Fresh install on Android Chrome, "Add to Home Screen" produces a full-screen app icon
- [ ] Airplane mode: can add a manual entry, view dashboard, add a manual BOQ bill, export/import backup — all work
- [ ] Online: voice mic correctly parses at least "paid Sharik fifty thousand cash" into category=Sharik, amount=50000, mode=Cash
- [ ] Online: uploading a clear photo of a GST tax invoice extracts line items whose sum matches the printed total, or clearly flags a mismatch
- [ ] Backup JSON export → wipe app data → import same file → all entries and BOQ items restored exactly
- [ ] No entry can be saved with a zero/blank amount or empty description

---

I disagree with skipping the backend proxy to save build time — the risk is a leaked API key racking up charges the moment someone opens dev tools on your phone. If you want to cut scope instead, cut the voice feature first, not the key security.
