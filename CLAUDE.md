# Brick Book — Claude Project Instructions

## Project

Brick Book is an offline-first household construction ledger for India.

It supports two modes:

- Owner — household ledger covering payments, bills/BOQ, stock, people and budget.
- Contractor — site books covering money received, money spent and money in hand.

The product uses one shared visual language across both modes.

## Source of Truth

### Design

`design.md` is the design source of truth for Brick Book.

Before changing or creating UI:

1. Read the relevant section of `design.md`.
2. Follow its tokens, component specifications, screen specifications and accessibility requirements.
3. Do not invent a competing visual system.
4. If a requirement is genuinely unresolved, use the open questions in `design.md` as the decision point.

The detailed design system covers:

- colour
- typography
- spacing
- radius
- elevation
- icons
- motion
- components
- screens
- interaction patterns
- accessibility
- known defects

### Skills

Use the global user-level skills when relevant:

- `.claude/skills/ui-ux-pro-max/`
- `.claude/skills/ui-styling/`
- `.claude/skills/design-system/`
- `.claude/skills/design/`
- `.claude/skills/brand/`
- `.claude/skills/banner-design/`
- `.claude/skills/slides/`

These skills are shared across projects and should not be copied into this repository unless a skill is specifically project-only.

## Design Principles

Brick Book should feel like a trustworthy construction ledger, not a fintech dashboard.

Core principles:

- The number is the interface.
- A book, not an app.
- Show the state, don't claim it.
- One accent, spent carefully.
- Degrade, never disappear.
- Same book on every phone.

Avoid:

- unnecessary gradients
- decorative fintech-style dashboards
- confetti
- streaks
- excessive animation
- visual noise
- unnecessary cards
- colour-only state communication

## Offline-First Constraints

Offline operation is a hard requirement.

Never introduce UI dependencies that require network access at runtime.

Do not add:

- webfonts
- CDN-only assets
- runtime-fetched icon libraries
- runtime-fetched UI assets
- unnecessary animation libraries
- unnecessary chart libraries

Typography must use system font stacks.

Icons must be bundled inline SVGs.

## Design Tokens

Never hardcode design colours inside components.

Use the semantic design tokens defined by the project.

Prefer:

```css
bg-surface
text-ink
border-rule
