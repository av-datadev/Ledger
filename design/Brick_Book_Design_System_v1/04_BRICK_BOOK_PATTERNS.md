# BRICK BOOK — UX PATTERNS v1.0

## Payment Entry
Primary objective: record a real payment with minimal friction.
Preferred flow: Amount → Paid to → Purpose → Date → Done.
Secondary: Mode · Paid by · Notes · Receipt.
Capture alternatives: Scan · Speak · Write.
All capture methods resolve to the same structured draft.

## Ledger
Spend → Unbilled attention → Search → Filter chips → Transactions.
Avoid four large filter controls above every list.

## Activity
Answer: "What changed in my project?"
Events: payment, bill, BOQ, stock, import, sync.
Use chronological grouping.

## BOQ
Overview: Billed · Paid · Due · Ledger spend · Variance.
Category: category → bills → lines.
Bill: dealer → source document → lines → payments → stock links.
Line: item → quantity → unit → rate → amount → stock relation.

## Stock
Remaining = Received − Given out.
Negative/suspicious quantity must have an obvious state.

## People
Detail should answer:
Who is this? How much paid? What remains? What contract exists? Which bills belong to them? What happened recently?

## Contractor
Site → Money received → Money spent → In-hand → Commitments → Recent activity.
Multiple sites feel like a portfolio, not separate apps.

## Data / Backup
Device status → Backup status → Sync status → Export → Import/restore → Advanced.
Trust language should be human.

## Import
Upload → Detect columns → Map → Preview → Resolve conflicts → Import → Summary.
Never overwrite silently.

## Scan Bill
Capture → Processing → Extracted bill → Review lines → Confirm → Save.
Keep the source document attached.

## Responsive
320–375px: one column, one primary action, readable financial values.
390–430px: richer two-column forms where useful.
Tablet/desktop: more data density, tables, persistent filters and keyboard productivity.
Never simply stretch mobile cards.

## Errors
Define offline, validation, server, partial extraction, conflict, duplicate, permission and cancellation states.
