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

Never hardcode design colours inside components. Use the semantic tokens.

They live in one place — the `@theme` block in `src/index.css`, with the dark
values redefined under `:root[data-theme="dark"]`. Tailwind turns each
`--color-x` into `bg-x` / `text-x` / `border-x`.

Prefer:

```css
/* ground and text */
bg-paper        /* page */
bg-surface      /* cards, inputs, buttons */
bg-paper-2      /* inset panel on a card */
text-ink        /* primary */
text-ink-soft   /* secondary */
text-ink-faint  /* captions, eyebrows, meta */
border-rule     /* hairline divider */
border-rule-strong  /* input and button outline */

/* chrome — dark in BOTH themes */
bg-header
text-onhead

/* accent and state */
text-crimson       /* brand accent, attention figures */
bg-accent-fill      /* .btn-primary fill ONLY */
bg-accent-fill-deep /* .btn-primary pressed */
text-accent-deep   /* badge text */
bg-accent-soft     /* badge fill, progress track */
text-moss          /* confirm, positive, received */
text-danger        /* destructive */
text-brass         /* secondary accent, sparingly */
```

Avoid:

```css
/* raw hex or rgb() inside a component */
style={{ color: "#15232e" }}
className="bg-[#18212b]"

/* Tailwind's default palette — it is not this product's palette */
bg-white  bg-black  text-slate-900  bg-gray-100  border-zinc-200  text-blue-600

/* dark: variants — dark mode is a token swap, so a dark: class
   means a value got hardcoded. There are currently ZERO in the app. */
dark:bg-slate-900  dark:text-white

/* the accent as a button fill */
bg-crimson        /* use bg-accent-fill — see below */
```

**`crimson` and `accent-fill` are not interchangeable.** `crimson` carries text
and is measured against the page ground. `accent-fill` sits *under* white text
and is measured against that. They are the same value in light mode and differ
in dark. Using `crimson` as a button fill puts the label at 3.43:1 and fails
AA — this is defect D2 in `design.md`, and it has already been introduced once.

**Dark mode is AMOLED.** The ground is a true `#000000` — on OLED a black pixel
is an unlit pixel. Do not soften it to a near-black, and keep the greys above it
neutral rather than tinted.

## Verification

There is **no test framework** in this repo. Do not go looking for one, and do
not claim a change is verified because it compiles.

```bash
npm run dev        # Vite dev server on :5173
npm run typecheck  # tsc, no emit
npm run build      # typecheck + production build
```

Before calling any UI change done, check it in the browser at:

- **375px wide** — the phone this is built for.
- **Both themes.** Light-mode ratios do not carry over; verify dark separately.
- **Text scale 1.25** (Data → text size). Every layout must survive it without
  clipping or horizontal scroll.

If a colour changed, **recompute the contrast ratio** rather than judging it by
eye, and update the measured tables in `design.md` §2.2. Every number in there
was computed, not estimated, and that is the only reason it is worth anything.

## Gotchas

- **`.btn` and friends are unlayered CSS**, so they outrank Tailwind utilities.
  A call site that needs different layout has to force it (`!flex`, not `flex`).
- **Icons live in `src/components/Icon.tsx`** as inline 24×24 solid
  `fill-current` paths. Add to `PATHS` and to the `IconName` union. Check a new
  glyph at 16px, not at 96px — shapes that read fine large turn to mush small.
- **Money** is always `.money` (mono, tabular figures) and formatted with `inr()`
  from `src/lib/format.ts`. Indian grouping — ₹48,62,400, lakhs, never millions.
- **Touch targets are ≥44×44 CSS px**, at every text scale.

## Privacy

**This repository is public, and it is a real family's spending.**

- Never commit real amounts, real vendor or contractor names, or real addresses
  — not in code, fixtures, comments, screenshots, or store assets.
- Placeholder names stay generic: "Owner 1", "Payer 1", "Contractor", "Plumber".
- `Ref_img/` is gitignored because it holds real screenshots. Keep it that way.
- The app ships with **no seed data**; a fresh install is deliberately blank.

## Deploying

`main` is the production branch: pushing to it deploys to
<https://ledger-nu-ashen.vercel.app> via Vercel.

That origin is also what the Android TWA wraps, so a change pushed here reaches
every installed phone. Treat it accordingly.
