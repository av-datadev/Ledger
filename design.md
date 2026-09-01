# Brick Book — Design System

**Version 0.1 · 29 Aug 2026 · Scope: the app (owner ledger + contractor site books)**

This document is the design source of truth for Brick Book. It codifies what the app
already is, fills the gaps it has, and lists the five defects worth fixing before
anything new is drawn.

> **How to use this in Claude Design.** §1–§4 are the rails: colour, type, spacing,
> icons and motion are decided and measured — design *within* them. §5 (components)
> and §6 (screens) are specifications to draw against. §9 is a list of real,
> evidenced defects with recommended fixes — those are the first designs worth
> producing. §10 is open questions where a proposal is genuinely wanted.
>
> Every hex value, contrast ratio and size in here was read out of the shipping app
> or computed from it, not invented. Where a number is a *proposal* rather than
> current reality, it is marked **[NEW]**.

---

## 1. The product, in one page

Brick Book is an offline-first ledger for building a house in India. It holds every
rupee, every material and every person across a build that runs three or four years
and a thousand payments.

It has two modes, chosen on first open:

| Mode | Who | Their book |
|------|-----|-----------|
| **Owner** | The family paying for the house | One shared ledger: payments, bills (BOQ), stock, people, budget |
| **Contractor** | The person running the sites | A book per site: money received from the owner, money spent, what's in hand |

**One skin for both.** The two modes share every token and every component and differ
only in navigation and content. A contractor who shares a site with an owner should
see one product, not two.

### The constraints that actually drive the design

These are not preferences. They are the reasons the system looks the way it does, and
any proposal that breaks one of them is wrong however good it looks.

1. **Offline, always.** The app is a PWA wrapped in an Android TWA and must work with
   the phone in airplane mode. **No webfonts, no CDN assets, no icon package fetched
   at runtime.** Type is system faces. Icons are inline SVG paths in the bundle.
2. **A mid-range Android phone, held in one hand, outdoors.** Small screen, low DPI,
   bright sun, dusty fingers. This drives the contrast floors, the touch targets, and
   the near-total absence of animation.
3. **The person reading the numbers may be 65.** There is a text-size control
   (0.9 / 1.0 / 1.1 / 1.25 applied as document `zoom`). Every layout must survive
   1.25× without clipping or horizontal scroll.
4. **Money is the content.** Amounts are the thing people came for. They get the
   monospace face, tabular figures, Indian digit grouping (₹48,62,400 — lakhs, never
   millions), and they never wrap or truncate.
5. **Hindi is a first-class input.** Speech is Hindi/English/mixed, and bills arrive
   as Devanagari notebook pages. Any face or component must render Devanagari
   (जमा, शेष) without falling back to a boxy substitute.
6. **This is a book of a family's private spending.** It should feel like a ledger a
   person keeps, not a fintech dashboard that monetises them. No confetti, no
   gradient hero cards, no "streaks".

### Design principles

| Principle | So |
|-----------|-----|
| **The number is the interface** | Amounts get the strongest treatment on any row. Labels shrink before figures do. |
| **A book, not an app** | Paper ground, serif headings, hairline rules, one warm accent. Restraint reads as trustworthy where a bank-blue gradient reads as a product trying to sell something. |
| **Show the state, don't claim it** | Sync, offline, unsaved, "no bill against this payment" — the app says what is true right now rather than assuming success. |
| **One accent, spent carefully** | Terracotta marks the primary action and the figure that needs attention. If everything is terracotta, nothing is. |
| **Degrade, never disappear** | Reduced motion, no JavaScript for a fragment, largest text size, no network — each removes polish, never content. |
| **Same book on every phone** | Owner and contractor, father and son: one component set, one skin. |

---

## 2. Colour

### 2.1 Token table — the source of truth

These live in `src/index.css` inside Tailwind v4's `@theme` block and are consumed as
semantic utilities (`bg-surface`, `text-ink`, `border-rule`). **Components never carry
a raw hex.** Dark mode redefines only the flipping tokens under
`:root[data-theme="dark"]`, so no component needs a `dark:` variant.

| Token | Role | Light | Dark | Flips? |
|-------|------|-------|------|--------|
| `--color-ink` | Primary text | `#15232E` | `#EDEDED` | yes |
| `--color-ink-soft` | Secondary text, sub-labels | `#41525E` | `#A8A8A8` | yes |
| `--color-ink-faint` | Captions, eyebrows, meta | `#616F7A` | `#8F8F8F` | yes |
| `--color-paper` | Page ground | `#F5F3EC` | `#000000` | yes |
| `--color-paper-2` | Inset panel on a card | `#FBFAF4` | `#1A1A1A` | yes |
| `--color-surface` | Cards, inputs, buttons | `#FFFFFF` | `#121212` | yes |
| `--color-rule` | Hairline divider | `rgba(21,35,46,.10)` | `rgba(255,255,255,.12)` | yes |
| `--color-rule-strong` | Input & button outline | `rgba(21,35,46,.16)` | `rgba(255,255,255,.35)` | yes |
| `--color-header` | Top bar + tab bar | `#15232E` | `#000000` | **no — always dark** |
| `--color-onhead` | Text/icons on the header | `#F5F3EC` | `#F5F3EC` | no |
| `--color-crimson` | Brand accent, attention figures | `#B44C26` | `#D2703F` | yes |
| `--color-accent-fill` | **`.btn-primary` fill only** | `#B44C26` | `#C4602F` | yes |
| `--color-accent-fill-deep` | `.btn-primary` pressed | `#A2431F` | `#AD5429` | yes |
| `--color-accent-deep` | Badge text | `#A2431F` | `#E0895C` | yes |
| `--color-accent-soft` | Badge fill, progress track | `#F3E3D8` | `rgba(210,112,63,.18)` | yes |
| `--color-brass` | Secondary accent, used sparingly | `#A98544` | `#C4A165` | yes |
| `--color-moss` | Confirm / positive / received | `#3E6B52` | `#4E9E76` | yes |

The accent is named `crimson` for historical continuity across ~103 call sites; the
value is terracotta. **Do not rename it** without a full sweep — a half-renamed token
is worse than an oddly named one.

**Dark mode is AMOLED.** The ground is a true `#000000`, not a near-black: on the OLED
panels these phones ship with, a black pixel is an unlit pixel, so the ground is the
one colour choice in the app that costs battery to get wrong. The greys above it are
neutral. The palette this replaced was navy-tinted throughout (`#10161C`, `#18212B`,
`#A0AEB8`), which reads as a colour cast rather than a decision once the ground beside
it is true black.

Two consequences follow, and both are load-bearing:

- **Cards separate by lightness, and keep their border.** `#121212` on `#000000` is a
  1.12:1 step — real but slight. The hairline stays so the edge survives sunlight.
- **`rule-strong` doubles to 35%.** Input and button outlines are control boundaries
  and owe 3:1. On a true-black ground white at 18% measures 1.55:1. 35% is the first
  step that clears it, at 3.21:1 on surface. Row dividers (`rule`) stay faint at 12% —
  those are decorative, and the book feel depends on them not hardening into a grid.

**Light mode is unchanged by all of this**, including its navy header.

**`accent-fill` is split from `crimson` on purpose.** The two have different contrast
duties: `crimson` carries text and is measured against the page ground, while the fill
is measured against the white label sitting on it. They coincide in light mode and part
company in dark. See D2.

### 2.2 Measured contrast

Computed against both grounds. **AA floor: 4.5:1 for text under 18.66px, 3:1 for
non-text (icons, control boundaries, chart marks).**

Dark values are against the AMOLED palette. Every one of them is higher than the
navy palette it replaced — a true-black ground is the most forgiving ground there is.

| Foreground | on paper (light) | on surface (light) | on paper (dark) | on surface (dark) |
|------------|------------------|--------------------|-----------------|-------------------|
| ink | 14.42 ✅ | 16.01 ✅ | 17.94 ✅ | 16.00 ✅ |
| ink-soft | 7.29 ✅ | 8.10 ✅ | 8.83 ✅ | 7.88 ✅ |
| ink-faint | 4.66 ✅ | 5.17 ✅ | 6.49 ✅ | 5.79 ✅ |
| crimson | 4.73 ✅ | 5.25 ✅ | 6.13 ✅ | 5.47 ✅ |
| accent-deep | 5.63 ✅ | 6.25 ✅ | 7.90 ✅ | 7.05 ✅ |
| moss | 5.51 ✅ | 6.12 ✅ | 6.48 ✅ | 5.78 ✅ |
| danger | 5.89 ✅ | 6.54 ✅ | 12.30 ✅ | 10.97 ✅ |
| **brass** | **3.09 ❌** | **3.43 ❌** | 8.63 ✅ | 7.70 ✅ |

Also measured on `paper-2` (`#1A1A1A`), the inset panel: ink 14.87, ink-soft 7.32,
ink-faint 5.38, crimson 5.08, moss 5.37, brass 7.15, danger 10.19 — all ✅.

Composites, checked separately because they sit on blended grounds:

| Pair | Ratio | |
|------|-------|--|
| Badge: accent-deep on accent-soft (light) | 5.00 | ✅ |
| Badge: accent-deep on accent-soft over surface (dark) | 5.62 | ✅ |
| Tab bar active label: onhead on header (light) | 14.42 | ✅ |
| Tab bar active label: onhead on header (dark) | 18.91 | ✅ |
| Tab bar inactive label: onhead @55% on header (light) | 5.28 | ✅ |
| Tab bar inactive label: onhead @55% on header (dark) | 5.76 | ✅ |
| White on accent-fill (light) — primary button | 5.25 | ✅ |
| White on accent-fill (dark) — primary button | 4.15 | ✅ |
| White on accent-fill-deep (dark) — pressed | 5.15 | ✅ |
| Card: surface on paper (dark) | 1.12 | separation, not text |
| **rule-strong as an input's only boundary (light)** | **1.37** | ❌ vs 3:1 |
| rule-strong as an input's only boundary (dark) | 3.21 | ✅ |

**brass in light (D1) and rule-strong in light (D3) remain open.** D2 is closed, and
D3's dark half is closed by the 35% AMOLED value — see §9.

### 2.3 Usage rules

- **`ink-faint` is the floor.** Nothing that carries meaning goes lighter. There is no
  fourth grey.
- **Crimson means "act on this" or "look at this figure".** Primary buttons, the
  active tab indicator, an amount that has no bill against it. It is not decoration
  and it is not a section-heading colour.
- **Moss means money arriving or a state confirmed.** Received from owner, saved,
  synced, within budget.
- **Brass is currently unusable in light mode for text.** Until D1 is resolved, brass
  is for dark mode and for non-text fills only.
- **There is no danger token yet.** See D5 — destructive actions currently use
  `window.confirm()` and terracotta, which is also the brand accent. This is the
  biggest semantic gap in the palette.
- **Colour is never the only signal.** Every state that matters carries a word or a
  glyph as well: "No bill", "Offline", "Received".
- **Dark mode is hand-authored, not derived.** The accent is lifted and desaturated
  because terracotta at its light value dies against near-black; shadows drop to
  almost nothing because a dark surface separates by lightness, not by shade. Any new
  colour needs both values chosen by hand and both measured.

---

## 3. Typography

### 3.1 Families

All system faces. A webfont would break the offline promise, so this is not a style
choice to revisit.

```css
--font-sans:  system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
--font-serif: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
--font-mono:  ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
```

- **Serif** — every `h1/h2/h3`, at weight 600, tracking −0.01em. It is the single
  strongest signal of the product's character and it costs nothing.
- **Sans** — all body, labels, controls. `"Noto Sans"` is in the stack specifically so
  Devanagari renders rather than boxing.
- **Mono** — every money figure, with `font-variant-numeric: tabular-nums` and
  tracking −0.02em, so columns of rupees align down a list.

**Eyebrows are explicitly sans.** They are `h2`/`h3` elements, so without the override
they would inherit the serif, and a serif at 11px with 0.15em tracking turns to mud on
a low-DPI Android screen.

### 3.2 Type scale **[NEW]**

The app currently has no named scale — it uses `text-[13px]` 182 times, `text-[12px]`
179 times, `text-[11px]` 140 times, plus ad-hoc 9, 10, 14, 15px and a scattering of
Tailwind's `text-sm/base/lg/xl`. The sizes below are the ones already in use, named,
with the two smallest tiers retired.

| Token | Size / line | Face | Weight | Use |
|-------|-------------|------|--------|-----|
| `display` | 28 / 1.10 | serif | 600 | The one big number on a screen (dashboard total, site balance) |
| `title` | 20 / 1.15 | serif | 600 | Screen title in the header |
| `section` | 17 / 1.20 | serif | 600 | Card and panel headings |
| `subtitle` | 15 / 1.35 | sans | 600 | Row headline in a dense list, sheet title |
| `body` | 13 / 1.45 | sans | 400 | Default reading size — list rows, paragraphs |
| `body-strong` | 13 / 1.45 | sans | 600 | The name on a row, a total's label |
| `meta` | 12 / 1.40 | sans | 400 | Sub-line under a row (`ink-soft`) |
| `caption` | 11 / 1.35 | sans | 400 | Helper text, timestamps (`ink-faint`) |
| `eyebrow` | 11 / 1.20 | sans | 600 | Section label, uppercase, 0.15em, `ink-faint` |
| `badge` | 10 / 1.10 | sans | 600 | Pill labels only, uppercase, 0.08em |
| `input` | **16** / 1.30 | sans | 400 | **Never smaller — under 16px iOS zooms the page on focus** |
| `money-*` | matches tier | mono | 600 | Any rupee figure, at the tier of its row |

**Rules**

- **11px is the floor for anything that carries meaning.** The current `text-[9px]`
  (7 uses) and `text-[10px]` (32 uses) drop below it; 10px survives *only* for
  uppercase badge pills, where the caps height and tracking carry it.
- **Body is 13px, not the 16px a generic guideline asks for.** That is a deliberate
  density decision for a data app on a small screen, and it is bought back by the
  text-size control (up to 1.25× = 16.25px) rather than by shrinking further. It is
  also why the 11px floor is not negotiable.
- **Every layout must be checked at scale 1.25.** The control zooms the document root,
  so lengths scale uniformly — the failure mode is clipping and wrapping, not
  illegibility.
- **Amounts never truncate.** If a row is tight, the label ellipses; the figure does
  not.
- **Sentence case everywhere** except eyebrows and badges. No Title Case Headings.

---

## 4. Space, shape, elevation, icons, motion

### 4.1 Spacing — 4px base

Density 7/10: standard, leaning dense. Matches what the app already does
(`gap-2` ×94, `px-3` ×90, `py-1.5` ×78).

| Token | px | Use |
|-------|----|-----|
| `space-1` | 4 | Icon-to-label, badge padding |
| `space-2` | 8 | Default gap inside a row |
| `space-3` | 12 | **Card padding, screen gutter** |
| `space-4` | 16 | Card padding (primary cards), gap between cards |
| `space-5` | 20 | — |
| `space-6` | 24 | Gap between sections |
| `space-8` | 32 | Screen top padding under the header |
| `space-12` | 48 | Rare: empty-state breathing room |

- **Screen gutter: 12px** at ≤360px, **16px** above. Never edge-to-edge text.
- **Row height: 44px minimum**, built from 10–12px vertical padding around a 13px
  body line plus a 12px meta line.
- **Bottom inset:** every scrollable screen ends with `tab bar height + safe-area +
  16px` of padding, so the last row is never trapped under the tab bar.
- **Safe areas:** the tab bar already applies `env(safe-area-inset-bottom)`; the
  header applies the top inset. Any new fixed bar must do the same.

### 4.2 Radius

| Token | px | Use |
|-------|----|-----|
| `radius-sm` | 6 | Badges on a dense row, thumbnails |
| `radius-md` | 10 | **Buttons, inputs, chips** |
| `radius-lg` | 14 | **Cards, sheets, panels** |
| `radius-full` | 999 | Pills, avatars, the sync dot |

`--radius-md` and `--radius-lg` are already overridden in `@theme`, which lifts every
existing `rounded-md`/`rounded-lg` at once. The app still uses bare `rounded` (4px)
in 36 places — **[NEW]** those should move to `radius-sm` or `radius-md`; 4px reads as
an unfinished corner beside a 14px card.

### 4.3 Elevation

Two shadows, no more. On dark they nearly vanish by design — a dark surface separates
by lightness, and the hairline border is what actually holds the edge.

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `shadow-card` | `0 1px 2px rgba(21,35,46,.04), 0 8px 24px -12px rgba(21,35,46,.18)` | `0 1px 2px rgba(0,0,0,.4)` | Every `.card` |
| `shadow-float` | `0 2px 4px rgba(21,35,46,.05), 0 30px 60px -25px rgba(21,35,46,.4)` | `0 8px 30px -12px rgba(0,0,0,.7)` | Sheets, popovers |
| *(accent lift)* | `0 8px 20px -10px crimson@70%` | same | **Primary button only** — the signature |

Every card also carries `1px solid var(--color-rule)`. Keep it: it is the only edge
that survives dark mode.

### 4.4 Icons

**System:** inline SVG paths compiled into the bundle — no icon package, because a
runtime fetch breaks offline and a full library breaks the bundle budget. Draw new
icons in a 24×24 viewBox to match the existing set.

| Token | px | Use |
|-------|----|-----|
| `icon-sm` | 16 | Inside a badge or a dense row |
| `icon-md` | 20 | **Default** — buttons, tab bar, row affordances |
| `icon-lg` | 24 | Header actions, empty states |

**Rules**

- One family, one visual weight. Existing icons are solid `fill-current` paths at
  24×24; new icons match that, not a 2px outline set.
- Semantics by use, not by glyph: decorative beside visible text → `aria-hidden="true"`;
  meaningful and standalone → a text alternative; inside a control → the *control*
  gets the accessible name and announces `aria-pressed` / `aria-current` / `aria-expanded`.
- Meaningful icons need **3:1** against their background. Decorative ones may be
  lighter but must not be the only carrier of information.
- **Emoji are not icons.** They are font-dependent, unthemeable, and render
  differently on every Android skin. The app currently ships 10 of them — see D4 and
  the replacement table there.
- A glyph has to survive `icon-sm`. `hardhat` is drawn with a raised centre crown
  because a plain dome on a brim reads as a bell at 16px — check new icons at the
  size they are actually used, not at 96px.

### 4.5 Motion — deliberately almost none

Motion budget 2/10. There is no animation library and there should not be one; the
whole vocabulary is CSS transitions.

| Token | ms | Easing | Use |
|-------|----|--------|-----|
| `dur-press` | 80 | linear | Press feedback — must be felt, not watched |
| `dur-fast` | 150 | `ease` | Colour and border transitions (already the app's default) |
| `dur-base` | 220 | `cubic-bezier(.2,.7,.2,1)` | Panel expand, row insert, badge appear |
| `dur-exit` | 160 | `cubic-bezier(.4,0,1,1)` | Anything leaving — **exits are faster than entrances** |

- Animate `transform` and `opacity` only. Never `width`, `height`, `top` — they
  relayout, and this runs on a cheap phone.
- Press states change colour, opacity or elevation. **They never change layout
  bounds** — a button that grows on press nudges the row beside it.
- `prefers-reduced-motion: reduce` is already handled globally in `index.css` and
  collapses every duration to 0.01ms. Anything new inherits that for free; do not
  add motion that only works when it animates.

---

## 5. Components

Each spec: anatomy → sizes → states → accessibility. States are **default / hover
(pointer only) / pressed / focus-visible / disabled / loading / error** — draw the
ones marked.

### 5.1 Button

| Variant | Fill | Text | Border | Elevation |
|---------|------|------|--------|-----------|
| **Primary** | `accent-fill` | `#FFF` **both themes** (D2) | `accent-fill` | accent lift |
| **Secondary** | `surface` | `ink` | `rule-strong` | none |
| **Confirm** | `moss` | `#FFF` | `moss` | none |
| **Destructive** **[NEW]** | `surface` | `danger` | `danger` | none |
| **Ghost** | none | `crimson` | none | none |
| **Icon** | none / `surface` | `ink` | optional | none |

- **Layout: `inline-flex`, centred, 8px gap.** A button is a row of an optional icon
  and a label, and it must declare that. Without it the two are separate inline boxes
  and the icon breaks to its own line as soon as the label wraps (D9). Because the
  rule is unlayered it outranks utility classes, so a call site that needs a
  different box has to say so with `!` (`!flex` to force a button onto its own line).
- Size: 9px vertical / 15px horizontal padding, 13px/600 label, `radius-md`,
  **min height 44px** including the hit area. Full-width primary at the bottom of a
  form uses 12px vertical and `input` (16px) text.
- **The primary fill is `accent-fill`, not `crimson`.** The label sits *on* it, so it
  is measured against white rather than against the page. See §2.1 and D2.
- **Pressed:** primary → `accent-fill-deep`, which is darker than the resting fill in
  **both** themes; secondary → `ink` at 6% over surface plus an `ink` border. Within
  80–150ms.
- **Focus-visible:** 3px ring in `crimson` at 18% (`color-mix`) plus the border going
  solid crimson. Never remove the ring.
- **Disabled:** opacity 0.5, no shadow, `disabled` attribute set — not just a colour
  change, or it stays tappable to a screen reader.
- **Loading:** label replaced by a spinner **at the same width** so the row does not
  reflow; the button stays disabled and announces via `aria-busy`.
- Icon-only buttons **must** carry `aria-label`.

### 5.2 Input, select, textarea

- 16px text (see §3.2), 9/11px padding, `radius-md` (currently 8px — align to 10),
  `surface` fill, `rule-strong` border, `color-scheme: light dark` so native pickers
  follow the theme.
- **Focus:** border → `crimson`, plus a 3px `crimson`@18% ring.
- **Label is always visible** above the field (`field-label`: 10px uppercase, 0.12em,
  `ink-faint` — **[NEW]** raise to 11px per the type floor). Placeholder is never the
  label.
- **Error:** border → `danger`, message directly below the field in `danger` at
  `caption`, wired with `aria-describedby`, and `aria-invalid="true"`. Not a red
  border alone, and not a toast.
- **Amount field:** `inputmode="decimal"`, mono face, ₹ prefix rendered as a
  non-editable adornment, right-aligned. Never `type="number"` — it eats leading
  zeros and shows spinners.
- **See D3:** inside a white card, a white input with a 1.37:1 border has no
  perceivable boundary. Fix before drawing more forms.

### 5.3 Card

`surface` fill, `1px solid rule`, `radius-lg`, `shadow-card`, 12–16px padding. An
inset panel inside a card uses `paper-2` and `radius-md`. Cards do not nest more than
two deep.

### 5.4 Money row (the app's most-used component)

```
┌──────────────────────────────────────────────┐
│ Cement — 40 bags                    ₹17,200  │   body-strong · money-body
│ Verma Traders · UPI · Payer 1     [PLUMBING] │   meta (ink-soft) · badge
└──────────────────────────────────────────────┘
```

- Two lines, 10–12px vertical padding, hairline `rule` between rows (not around each).
- Headline `body-strong` (ellipses when tight); sub-line `meta` in `ink-soft`, parts
  joined by ` · `; amount `money` at `body`, weight 600, `white-space: nowrap`,
  right-aligned, **never truncated**.
- Optional trailing badge, optional leading photo thumbnail (32×32, `radius-sm`).
- Whole row is one tap target (≥44px) opening the detail; any secondary action inside
  it needs 8px of separation from the row's own hit area.

### 5.5 Badge / pill

10px uppercase 600, 0.08em tracking, `accent-deep` on `accent-soft`, `radius-full`,
2/8px padding, `white-space: nowrap`. Measured 5.00:1 light and 4.87:1 dark — both
pass. Semantic variants: neutral (`ink-faint` on `rule`), positive (`moss` on moss@12%),
attention (`crimson` on `accent-soft`).

### 5.6 Status pill — offline / sync **[NEW as a named component]**

A dot plus a word, `radius-full`, `caption` text: `Offline` (`ink-faint`), `Syncing…`
(`brass`), `Synced` (`moss`), `Sync failed` (`danger`). Announce changes with a single
`role="status"` `aria-atomic` region saying something meaningful ("3 entries waiting to
sync"), never a bare number, and never one live region per badge.

### 5.7 Tab bar — paged

Fixed, `header` fill (dark in both themes), `env(safe-area-inset-bottom)` applied.
Its top edge is a hairline: `black/40` in light, `white/12` in dark, because on the
AMOLED ground the bar is the same colour as the page and a black border on black is
not a border. Each tab: a 2px `crimson` indicator bar above a 20px icon above a
9.5px label; active `onhead`, inactive `onhead/55` (5.28:1 light, 5.76:1 dark).

**Eight destinations, four at a time.** The bar is two pages of four tab slots, with
the Record action fixed in the centre of both:

```
Page 1   Dash    Ledger   ( ⊕ )   BOQ     Recent
Page 2   Stock   People   ( ⊕ )   Data    Help
                    ● ○
```

- **Record never pages.** It is the app's verb, reached in a hurry with one hand, and
  a control that moves under the thumb is one you have to look at first.
- **Two dots** below the bar mark the page: `crimson` active, `onhead/25` idle. They
  are an indicator, not a control — a 6px dot is not a 44px target.
- **Both the bar and the screen swipe.** Swiping the bar pages it without changing
  screen, which is the only way to *tap* a page-2 tab without walking through the
  tabs between. Swiping a screen moves to the next destination and brings the bar's
  page with it. See §7 for the gesture's rules.
- **Selecting a tab brings its page.** A drill-down, the back button or a swipe all
  flip the bar, so the active tab is never on the page you cannot see. The page is
  derived during render, not in an effect — an effect paints one frame with the new
  tab highlighted on the old page.
- **Both pages stay in the DOM.** Every destination is in the accessibility tree and
  keyboard-reachable; focusing a tab on the off-screen page brings that page into
  view rather than focusing something invisible.

**Measured widths at 375px** — this is the whole reason the bar pages rather than
holding eight tabs at once:

| Layout | Default text | At 1.25× text |
|--------|--------------|----------------|
| 8 equal tabs | 46.9px ❌ | 32.0px ❌ |
| 4 slots + centre action | **75.0px** ✅ | **75.0px** ✅ |

This closes **D6** and answers **§10.1**.

### 5.8 App header

`header` fill, `onhead` text, `title` (serif 20). Left: back or brand. Right: at most
two 24px icon actions, each ≥44px of hit area, each labelled. Sticky, with the top
safe-area inset applied and matching padding on the scroll container beneath it.

### 5.9 Sheet / modal

Bottom sheet, `surface`, `radius-lg` on the top corners only, `shadow-float`, a 36×4
`rule-strong` grab handle, 16px padding, and a scrim measured against the real
background (not a reused opacity). Focus moves into the sheet on open, is trapped
while it is open, and returns to the trigger on close. Escape and the Android back
gesture both close it — the app already pushes a history entry for this.

### 5.10 Confirm dialog **[NEW — replaces `window.confirm()`]**

Five destructive paths currently use the browser's own dialog, which ignores the theme
and, inside the Android TWA, renders as a Chrome sheet with the origin printed on it.
Spec: sheet layout, `section` title stating the consequence ("Delete this payment?"),
`body` line naming exactly what is lost, secondary "Cancel" on the left, destructive
button on the right, focus starting on **Cancel**.

### 5.11 Empty state

Icon at `icon-lg` in `ink-faint`, a `subtitle` line stating what is not here yet, a
`caption` line saying what to do, and the primary action as a button. Never a blank
panel. Every list needs one: no entries, no bills, no stock, no people, no search
results (which is a distinct copy case — offer to clear the filters).

### 5.12 Skeleton / loading

Reserve the real height before content arrives — a card that pops in and pushes the
list is worse than a slow one. Use content-shaped blocks in `rule`, no shimmer sweep
(it animates on a cheap phone for nothing). Badges and counts get a stable-width slot
so their arrival doesn't shift the row.

### 5.13 Budget bar

Track `accent-soft`, fill `moss` under 100% and `crimson` at or over it, 8px tall,
`radius-full`. **The percentage is always printed as text beside it** — colour alone
never carries the state.

### 5.14 Search + facet chips

16px input with a leading search icon and a trailing clear button (≥44px). Facets are
chips: `radius-md`, `body` text, selected = `accent-soft` fill with `accent-deep` text
and `aria-pressed="true"`. Chips never wrap mid-label; the row scrolls horizontally
with the scroll contained to the strip.

### 5.15 Voice capture

The mic control is the app's one moment of character. Circular, 56px, `crimson` fill,
white glyph. Listening state: a `crimson` ring pulsing on `transform`/`opacity` only,
paused entirely under reduced motion (where the state is carried by a "Listening…"
label instead). Below it: the **Heard** line — what the app understood, shown *before*
anything is saved, in `body` on `paper-2` — then the filled fields. The Heard line is
the honesty mechanism; it is not optional.

### 5.16 Photo proof thumbnail

Square, `radius-sm`, `object-fit: cover`, `1px solid rule`, with a fixed
`aspect-ratio` so the row never reflows as images decode. Tap opens a full-bleed
viewer with pinch-zoom. Alt text describes the document ("Bill from Verma Traders,
14 Aug"), never "image".

---

## 6. Screens

### 6.1 Dashboard — *specified*

The screen that answers "where are we?" in four seconds.

```
┌─ header ─────────────────────────────┐
│ BRICK BOOK          [mode] [theme]   │
├──────────────────────────────────────┤
│ TOTAL SPENT · 182 TRANSACTIONS       │  eyebrow
│ ₹48,62,400                           │  display, mono
│ ══════════════════════════ crimson   │  2px accent rule
│ ┌──────────────────────────────────┐ │
│ │ BUDGET                      81%  │ │  inset panel (paper-2)
│ │ ████████████████░░░░░░░░         │ │  budget bar
│ │ ₹48,62,400 of ₹60,00,000         │ │  meta
│ │              ₹11,37,600 left     │ │  meta, moss
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ HOUSE ADDRESS                    │ │
│ │ Plot 12, Green Valley Phase 2    │ │
│ └──────────────────────────────────┘ │
│ SPEND BY CATEGORY                    │  eyebrow
│ Tap a row to see all its payments    │  caption
│ Contractor  46          ₹10,40,000   │  horizontal bars
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                │
│ Marble       9           ₹6,15,000   │
│ ▬▬▬▬▬▬▬▬▬▬▬▬                        │
└──────────────────────────────────────┘
```

- **Chart type is settled: horizontal bars.** Categories ranked by value, one bar per
  row with the label, the count and the amount as text. Treemaps and sunbursts were
  considered and rejected — both are high accessibility risk and unreadable at phone
  width. Bars need no legend, no tooltip and no colour coding, so nothing depends on
  hue.
- Each bar row is a tap target into a filtered ledger.
- Empty state: budget card with a "Set your budget" action; category list replaced by
  "No payments yet — record the first one."

### 6.2 Entry — *specified*

Three ways in, because a person on a site with dusty hands will not fill in a form.

1. **Read a handwritten note** (camera → OCR → review)
2. **Speak it instead** (mic → Heard line → filled fields)
3. **Type it** (the form itself)

Field order, all with visible labels: Date · Category · Description · Sub-vendor
(optional) · **Amount (₹)** · Payment mode · Paid by · Notes (optional) · Photos
(optional). Submit is a full-width primary button, 12px vertical, 16px label.

- The two capture affordances sit **above** the form, are equally weighted, and each
  states its consent position inline: what leaves the device, once, and that it can be
  switched off.
- Validate on blur, not on submit only. Errors inline, below the field, wired with
  `aria-describedby`. If more than one field fails, also render a focusable error
  summary at the top of the form, linking to each invalid field, and move focus to it
  after a failed submit — inline errors stay.
- After save: an inline `role="status"` confirmation naming what was saved and its
  amount, then the form resets to the same category (the next entry is usually a
  sibling of the last).

### 6.3 Ledger — *specified*

Filter strip: search + Category / Mode / Paid-by / Dates facets, then a
**Paid vs billed** panel — Paid, Billed, and the gap with no bill against it, the gap
in `crimson` — then the list of money rows grouped by date, then an export action.

- The count and total of the current filter is always printed above the list
  ("182 shown · ₹48,62,400"), and updates as one atomic status message.
- Row → detail sheet. Editing a row that has been shared with a contractor warns that
  the change rewrites their copy too, before saving.

### 6.4 Bills / BOQ — *specified*

Four ways to add: Take photo · Photo / PDF · Size list · Type manually — a 2×2 grid of
equal-weight buttons, the first in primary.

- Search across every bill line, matching on substrings so "tee 1" finds
  `Brass Tee 1"` and never the 1½".
- Two views behind a segmented control: **Bills on record** (line items) and
  **By dealer** (a running account per dealer with what each is still owed).
- Each line shows: item, dealer, date, badge, rate/qty, amount, and a **+ Stock**
  action taking that line straight into stock.
- The size-list mode explains its own arithmetic ("8¼ × 9 × 8 — 3 pc") and always
  shows the computed cubic feet next to what the dealer wrote, so the two can be
  compared.

### 6.5 The rest — *sketched*

| Screen | Job | Notes for design |
|--------|-----|------------------|
| **Recent** | What changed lately | A reverse-chronological feed of money rows with an edited/added marker. |
| **Stock** | In, out, remaining | Three numbers per material; "taken out to whom" is the part people forget. The largest file in the app (1,417 lines) — most likely to need decomposition. |
| **People** | Trade, contract price, paid against it | Person card: name, trades, contract value, paid, balance. Trades and people are separate category types and are linked on the person, not synced. |
| **Data / Settings** | Backup, export, import, AI consent, theme, text size | Eyebrow-separated groups. The two AI toggles (bill reading, speech) are separate, each stating what leaves the device. Text-size control is a 4-stop segmented control showing live effect. |
| **Contractor home** | Sites list | One card per site: name, received, spent, in hand. Same money-row grammar. |
| **Site detail** | One site's book | Running balance, then rows; the with-a-bill / without-a-bill split is the point of the screen. |
| **Role gate** | Owner or contractor | Two large equally-weighted cards on first open. Reversible later in Settings — say so on the gate. |
| **Auth** | Optional sign-in | The app works signed out; the screen must say that before it asks for anything. |

---

## 7. Patterns

- **Money.** Always mono + tabular. Indian grouping (`₹48,62,400`). Negative or
  "owed" figures get a word, not just a minus sign. Zero is `₹0`, never blank.
- **Dates.** `14 Aug 26` in rows, `Today` / `Yesterday` for the last two days, full
  date in detail views. Never `08/14/26` — ambiguous for this audience.
- **Names.** Blank-state defaults are generic ("Owner 1", "UPI 1", "Payer 1") and must
  stay that way in any mock, screenshot or store asset.
- **Offline.** Never block on the network. Writes land locally and show as saved;
  sync state is reported separately by the status pill. A failed sync is a
  recoverable state with a retry, never a lost entry.
- **Destructive actions.** Named consequence, Cancel focused, no colour-only warning.
- **Progressive disclosure.** Optional fields (sub-vendor, notes, photos) sit below
  the required ones and never expand the form's first screenful.
- **Back.** Predictable: sub-screens and sheets push history and are closed by the
  Android back gesture. Already implemented — keep it working.
- **Horizontal swipe** moves between the eight view tabs, in the order the bar lays
  them out. Three rules keep it from becoming a gesture people fight:
  1. **Record is not in the sequence.** It is a form, not a view. Swiping out of a
     half-typed entry would silently discard it, so it is entered and left by its
     button.
  2. **Anything that scrolls sideways wins.** A gesture starting inside a horizontal
     scroller — the material chip rows on Stock and Find-a-contractor — belongs to
     that element. Walk up from the touch target and check before claiming.
  3. **It has to look like a swipe.** 12px of horizontal travel *and* clearly more
     horizontal than vertical, or a slightly diagonal flick down a long ledger
     changes tab. Touch only: hijacking a trackpad's horizontal wheel would break
     desktop text selection.

  It clamps at both ends rather than wrapping — a wrap from Help back to Dash reads
  as a mis-tap. It routes through the same navigation a tap does, so history and the
  back button are unaffected, and it never calls `preventDefault`, so scrolling stays
  on the compositor.
- **One product, two modes.** The owner and contractor headers carry the same
  mode-switch control: the same pill, the same size, an `icon-sm` naming the side it
  leads to (hard hat → contractor, house → owner). They were a bordered pill on one
  side and a bare underlined link on the other, which is exactly the split §1 says
  must not exist.

---

## 8. Accessibility contract

Non-negotiable, and every one of these has a measurement or a test behind it.

- **Text contrast ≥ 4.5:1** in both themes. Non-text (icons, control boundaries,
  chart marks, focus rings) **≥ 3:1**. See §2.2 for what currently passes.
- **Touch targets ≥ 44×44 CSS px** with ≥8px between adjacent targets. Expand the hit
  area when the glyph is smaller.
- **Every input has a visible label**, and an accessible name that matches it.
- **Focus is always visible** and follows visual order. Sticky headers and the tab bar
  must never obscure the focused element.
- **Colour is never the only indicator** — of state, of category, of a warning.
- **Reduced motion** and **text scale 1.25** both work without layout breakage. Test
  both before calling any screen done.
- **Errors:** inline per field, plus a focusable linked summary when more than one
  fails.
- **Live regions:** one meaningful atomic status per event. Not one per badge.
- **Dark mode is verified independently.** Light-mode ratios do not carry over.

---

## 9. Known defects — design these first

Each was measured or counted in the current code, not guessed.

| # | Defect | Evidence | Recommended fix |
|---|--------|----------|-----------------|
| **D1** | **`--color-brass` fails AA in light mode** | 3.09:1 on paper, 3.43:1 on surface. Passes in dark (7.48). | Darken the light value to `#856427` (**4.91:1** on paper, 5.46:1 on surface — measured) or restrict brass to fills and dark mode. It is described as "used sparingly", so the blast radius is small — fix it now. |
| ~~**D2**~~ **CLOSED** | **Primary button text failed in dark mode — and the first fix made it worse** | `.btn-primary` was `#FFF` on `--color-crimson` → `#D2703F` in dark → **3.43:1**. The fix set the label to `--color-ink`, justified here as "ink measures 5.31:1". **That 5.31 was crimson-on-paper, a different pair.** Ink on the crimson *fill* measures **2.75:1** — worse than the white it replaced, on every primary button in the app. | Fixed in the fill, not the label. White stays; `--color-accent-fill` splits from `--color-crimson` so the fill can be dark enough to carry it (`#C4602F`, **4.15:1**) while crimson stays lifted for its 103 text call sites (6.13:1 on black). `--color-accent-fill-deep` (`#AD5429`, 5.15:1) does the same for `:active`, which had reached for `accent-deep` — *lighter* than the resting fill in dark, putting white at 2.66:1. |
| **D3** *(dark half closed)* | **Inputs have no perceivable boundary in light mode** | `.input` border is `--color-rule-strong` → **1.37:1** light, against a `surface` fill identical to the card it sits on. Dark was 1.78:1 and is now **3.21:1**: the AMOLED ground forced `rule-strong` to 35%, which clears the 3:1 floor. | Either raise the input border to a 3:1 token, or fill inputs with `paper-2` so the field is identifiable by its own surface. Recommend the fill — it also makes forms scan faster. |
| **D4** | **10 emoji used as icons** | 📷×6, 🔗×2, 📎×2, ⚠×2, 📐, 📇, 🏠, 🎤 (plus ✓ ✕ as glyph text) across 10 components. | Replace with inline SVGs at `icon-md`: camera, link, paperclip, warning-triangle, ruler, address-card, house, microphone, check, x. Emoji render differently on every Android skin and cannot be themed or scaled with tokens. |
| **D5** | **No danger token; destructive actions use `window.confirm()`** | 5 call sites; 0 red tokens; `text-crimson` used 103× for both brand and attention. | Add `--color-danger` — light `#B3261E` (5.89:1 on paper, 6.54:1 white-on-fill), dark `#F2B8B5` (9.52:1 on surface) — chosen to be clearly *not* terracotta, and build the confirm sheet in §5.10. |
| ~~**D6**~~ **CLOSED** | **8 items in the bottom tab bar** | `Dash · Entry · Ledger · Recent · BOQ · Stock · People · Data` at ~46px each — the guideline ceiling is 5. | Resolved by the paged bar in §5.7: four slots plus the centre action, two pages, swipe or tap. 75px per tab at every text size, and nothing hidden behind a sheet. |
| **D7** | **No type scale; sizes below the floor** | `text-[13px]`×182, `[12px]`×179, `[11px]`×140, `[10px]`×32, `[9px]`×7, plus `text-sm/base/lg`. | Adopt §3.2, retire 9px entirely, and keep 10px for uppercase badges only. |
| **D8** | **Mixed radii** | bare `rounded` (4px) ×36 beside `rounded-md` ×28 and one `rounded-lg`. | Map every 4px corner to `radius-sm` (6) or `radius-md` (10). |
| ~~**D9**~~ **CLOSED** | **`.btn` declared no layout, so icons broke to their own line** | The shared rule set padding and colour but no `display`. An icon and its label were two inline boxes, and the icon dropped below the text whenever the label was long enough to wrap — visible on BOQ's "Take photo" and "Size list", and on Record's "Take photo". | `display: inline-flex` with `align-items/justify-content: center` and an 8px gap, on the shared rule. One call site (`BillReview`) had used `block` to force its own line and now needs `!flex`, since `.btn` is unlayered and outranks the utility. |

---

## 10. Open questions — a proposal is genuinely wanted

### 10.1 The eight-tab bar — ANSWERED

Eight destinations at phone width give ~46px per tab, a 9.5px label, and no room to
grow. The three ways out considered here were: five tabs plus a "More" sheet; four
tabs plus a centre action, still with a "More" sheet; or two tiers, with the
reference screens moved to a header menu.

The recommendation was the centre action plus a **More sheet**, and it shipped. It
was wrong in one specific way: it bought tab width by putting four daily-use screens
two taps and a modal away. Recent is not a settings screen.

**Answered: a paged bar** — four tab slots plus the fixed centre action, two pages,
swipe the bar or the screen. Full spec in §5.7. It buys the same 75px per tab that
the sheet did, and hides nothing.

Help was promoted out of the Data screen to become the eighth destination, which is
what makes the two pages symmetric. It is also a better home for the FAQ than the
bottom of a settings screen.

### 10.2 Does the dashboard need a second visual?

Right now it is one big number, a budget bar, and ranked bars. That is honest and
fast. A spend-over-time line would answer "are we accelerating?", which is a real
question on a three-year build — but it costs a chart library and a lot of vertical
space. Worth a proposal, not a foregone conclusion.

### 10.3 Density of the money row

Two lines at 44px is dense but readable at scale 1.0. At 1.25 it is comfortable; at
0.9 it is tight. Is there a case for a user-chosen compact/comfortable row, or is the
text-size control enough? Prefer the latter unless the design shows otherwise.

### 10.4 First-run

There is no onboarding beyond the role gate. The blank state is deliberate — nothing
is seeded — so the first screen a new user sees is an empty dashboard. A three-card
"record your first payment" path could be drawn, but it must not become a tour.

---

## 11. Appendix

### 11.1 Where the tokens live

`src/index.css` — Tailwind v4 `@theme` block (light) plus a `:root[data-theme="dark"]`
override block, followed by the component classes `.card`, `.badge`, `.eyebrow`,
`.field-label`, `.input`, `.btn`, `.btn-primary`, `.btn-green`, `.money`, and a global
`prefers-reduced-motion` rule.

**Rules for changing them:** semantic tokens only, declared in `@theme` so Tailwind
generates the utilities (`bg-surface`, not `bg-[var(--color-surface)]`). No component
carries a hex. Any new colour needs a hand-chosen dark value and both ratios measured.

Theme and text scale are applied by an inline script in `index.html` **before first
paint**, so the app never flashes the wrong mode or resizes on launch. Any new
pre-paint preference must go in the same place.

### 11.2 Platform

React 19 · TypeScript · Vite · Tailwind CSS v4 · Dexie (IndexedDB) · Supabase (sync
only) · vite-plugin-pwa · Android TWA wrapper. No UI framework, no icon package, no
animation library, no chart library — and each of those absences is load-bearing for
the offline promise and the bundle size.

### 11.3 Pre-delivery checklist

Run before any screen is called done:

- [ ] Both themes checked independently — dark is not inferred from light
- [ ] Text ≥ 4.5:1; icons, borders and focus rings ≥ 3:1
- [ ] Tested at 375px wide **and** at text scale 1.25
- [ ] Tested with reduced motion on
- [ ] Every touch target ≥ 44×44, ≥ 8px apart
- [ ] Nothing hidden behind the tab bar, the header, or a safe area
- [ ] No emoji used as an icon; one icon family, consistent sizes
- [ ] Every input has a visible label; every icon button has an accessible name
- [ ] Colour is not the only indicator of any state
- [ ] Pressed states change colour/opacity/elevation, never layout bounds
- [ ] Empty, loading and error states drawn — not just the happy path
- [ ] Amounts are mono, tabular, grouped in lakhs, and never truncated
