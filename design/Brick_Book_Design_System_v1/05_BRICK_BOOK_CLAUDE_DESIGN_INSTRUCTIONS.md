# BRICK BOOK — CLAUDE DESIGN INSTRUCTIONS v1.0

## ROLE
You are designing a production-grade interface for Brick Book.
You are NOT free to invent a generic visual style.

Treat the Brick Book Design Constitution, tokens, components, patterns and reference specifications as binding constraints.

## BEFORE DESIGNING
Read:
1. 01_BRICK_BOOK_DESIGN_CONSTITUTION.md
2. 02_BRICK_BOOK_TOKENS.css
3. 03_BRICK_BOOK_COMPONENTS.md
4. 04_BRICK_BOOK_PATTERNS.md
5. 06_BRICK_BOOK_REFERENCE_SCREEN_SPECS.md
6. 07_BRICK_BOOK_QUALITY_GATE.md

Inspect the existing Brick Book implementation before modifying it.

## ABSOLUTE RULES
1. Do not invent new colors.
2. Do not invent arbitrary typography sizes.
3. Do not add gradients unless explicitly requested.
4. Do not use glassmorphism.
5. Do not create a card around every piece of information.
6. Do not introduce generic SaaS dashboard patterns.
7. Do not introduce generic purple/blue AI styling.
8. Do not replace Brick Book's construction-specific identity with generic fintech styling.
9. Do not permanently show edit/delete controls when contextual actions suffice.
10. Do not shrink body text to fit more data.
11. Do not add decorative charts without a decision they support.
12. Do not redesign navigation independently.
13. Do not change the information model merely to make a screen prettier.
14. Reuse existing components before creating new ones.
15. New components need a defined purpose and variants.
16. Preserve offline-first behavior.
17. Never imply AI extraction is guaranteed correct.
18. Important financial actions must communicate their resulting state.

## DESIGN ORDER
Information hierarchy → User task → Content grouping → Components → Typography → Surfaces → Color → Interaction → Motion → Polish.

## VISUAL DNA
AMOLED black/deep blue-black, warm off-white text, restrained construction orange, quiet green positive states, neutral cool-gray metadata, editorial serif display moments where useful, precise sans-serif data typography, strong numerical hierarchy, deliberate whitespace and restrained borders.

## OBJECT MODEL
Payment ≠ Bill ≠ BOQ Item ≠ Stock Item ≠ Person ≠ Category.
Relationships:
Payment ↔ Person/Vendor
Payment ↔ Bill
Bill ↔ BOQ
BOQ ↔ Stock
Person/Vendor ↔ Contract

## AI
AI is a workflow, not decoration:
Capture → Extract → Review → Correct → Confirm → Save.

## OFFLINE
Use:
Saved on this device
Syncing…
Synced 2 min ago
3 changes waiting to sync
Never lead with technical architecture.

## ANTI-GENERIC TEST
Before presenting:
"Could I remove the Brick Book logo and show this screen to a user of another generic SaaS/fintech app?"
If yes, redesign it.

## IMPLEMENTATION
React 19 + TypeScript strict + Vite + Tailwind v4.
Use semantic CSS variables.
Avoid raw hex in components.
Reuse components.
Preserve PWA/offline behavior.
Do not introduce unnecessary dependencies.

## FINAL REVIEW
Run the quality gate before declaring a screen complete.
