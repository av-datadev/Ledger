# BRICK BOOK — COMPONENT SPECIFICATION v1.0

Components represent meaningful product concepts, not arbitrary boxes.

Every component needs anatomy, variants, states, accessibility rules, responsive behavior and content rules.

## Buttons
Primary: single most important action in a region.
Secondary: important but non-primary.
Tertiary: low-emphasis text action.
Destructive: irreversible/destructive action.
Icon: only where meaning is clear.

Minimum touch target: 44px.

## Money Display
Anatomy: label + value + context + optional state.
Use tabular numbers.
Variants: display, card, compact, inline, positive, negative, neutral.

## Budget Meter
Show utilization percentage, bar, spent/total and remaining.
States: healthy, attention, near limit, over budget.
The bar is never the only representation.

## Status Chip
Use for semantic states such as PAID IN FULL, DUE, OFFLINE or a short category.
Do not chip every metadata value.
Never rely on color alone.

## Transaction Row
Primary: description + amount.
Secondary: date + category/person + mode.
Tertiary: attachment/notes.
Low-frequency actions belong in a contextual menu.

## Bill Card
Primary: dealer/title + total.
Secondary: date + category + line count.
States: paid in full, partial, due, unmatched.

## BOQ Item
Item → Quantity → Unit → Rate → Amount.
Extended relationship: Received → Used → Remaining.

## Stock Item
Primary: remaining quantity.
Secondary: received + issued + category.
Actions: Received, Given out, History.

## Person / Vendor
Show entity type, name, paid amount, outstanding and contract where applicable.
Types: person, vendor, labour, contractor, category.

## Search / Filters
One strong search field.
Filters become compact chips or a filter sheet: Category · Person · Mode · Date.
Support clear-all and active count.

## Empty / Loading / Error
Empty states explain what the area is, why it is empty and what to do next.
Loading should use geometry-matching skeletons.
Critical errors require actionable feedback, not just a toast.

## Offline / Sync
States:
Saved on this device
Syncing…
Synced 2 min ago
3 changes waiting to sync
Sync needs attention

## AI Capture
Canonical flow:
Capture → Extract → Review → Correct → Confirm → Save.
Always make extracted financial information editable and reviewable.

## Navigation
Owner and Contractor share the same visual language but may have different dashboard hierarchy, metrics and primary actions.
