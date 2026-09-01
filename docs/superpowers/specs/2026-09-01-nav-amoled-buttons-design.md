# Paged navigation, AMOLED dark mode, and button alignment

**Date:** 1 Sep 2026 · **Status:** approved · **Scope:** owner-mode app shell, dark palette, shared button rule

Three changes requested from annotated screenshots, plus one defect found while
measuring the third.

---

## 1. Bottom navigation — a paged bar

### Problem

The bar holds five slots: `Dash · Ledger · ⊕ Record · BOQ · More`. Four
destinations (Recent, Stock, People, Data) sit behind the `More` sheet, so
reaching Recent costs two taps and a modal. The request: every destination
visible or one swipe away, no sheet.

### Decision

Two pages of four slots, `Record` fixed in the centre of both.

```
Page 1   Dash    Ledger   ( ⊕ )   BOQ     Recent
Page 2   Stock   People   ( ⊕ )   Data    Help
                    ● ○
```

- Only the four side slots page. `Record` is the app's verb and never moves.
- Two dots below the bar: `crimson` active, `onhead/25` idle.
- Selecting a tab on a hidden page flips the bar to that page, so the active
  tab is never out of view.
- `MoreSheet` is deleted.

### Why paging rather than eight tabs

`design.md` §4 sets a 44px touch floor. At 375px:

| Layout | Default text | At 1.25× text |
|---|---|---|
| 8 equal tabs | 46.9px | **32.0px** ❌ |
| 4 slots + FAB (this) | **75.0px** ✅ | **75.0px** ✅ |

*Measured, not estimated.* The 1.25× figure was projected at 51.2px; the real value
is 75.0px, because the five columns divide the visual viewport rather than the zoomed
layout box. Either way it clears the floor.

This closes defect **D6** and answers open question **§10.1**, which had
recommended the `More` sheet. That recommendation is superseded: it optimised
for tab width at the cost of burying four destinations, and the paged bar gets
the same width without burying anything.

### Help becomes the eighth destination

`<Faq />` moves out of `SettingsScreen` and becomes its own tab, giving both
pages four slots. Data keeps backup, sign-in, AI consent and text size.

### Not affected

`ContractorHome` has no bottom bar. This is owner-mode navigation only.

---

## 2. Screen swipe

Swiping a screen moves through the eight **view** tabs in order:

`Dash → Ledger → BOQ → Recent → Stock → People → Data → Help`

Three rules keep the gesture from misfiring:

1. **`Record` is not in the sequence.** It is entered and left by the button.
   Swiping out of a half-typed entry would silently lose it.
2. **Horizontal scrollers win.** If the gesture starts inside an element with
   horizontal overflow, that element scrolls and the tab does not change.

   *Corrected during verification:* the BOQ coverage table was named here as the
   live case and is not one — it is three columns and fits. The actual horizontal
   scrollers are the material chip rows on Stock and Find-a-contractor, and the
   import preview table. The rule is unchanged; only the example was wrong.
3. **Intent threshold.** ~12px of horizontal travel *and* horizontal
   displacement clearly exceeding vertical before a swipe is claimed, so
   ordinary list scrolling never changes tab.

Clamps at the first and last tab rather than wrapping. Routes through the same
`navigate()` as a tap, so history and the Android back button are unchanged.
Under `prefers-reduced-motion` the transition is dropped, not the gesture —
`design.md` "degrade, never disappear".

---

## 3. AMOLED dark mode

Dark mode becomes pitch black. Light mode is untouched, including its navy
header. One `:root[data-theme="dark"]` block changes; no component carries a
raw hex, so no component is edited.

| Token | Before | After |
|---|---|---|
| `--color-paper` | `#10161C` | `#000000` |
| `--color-surface` | `#18212B` | `#121212` |
| `--color-paper-2` | `#141C24` | `#1A1A1A` |
| `--color-header` | `#0B1015` | `#000000` |
| `--color-ink` | `#E8E6E1` | `#EDEDED` |
| `--color-ink-soft` | `#A0AEB8` | `#A8A8A8` |
| `--color-ink-faint` | `#7D8B95` | `#8F8F8F` |
| `--color-rule` | white 10% | white 12% |
| `--color-rule-strong` | white 18% | white 35% |

Accent, brass, moss and danger keep their values.

### Measured contrast

| Foreground | on `#000000` | on `#121212` | on `#1A1A1A` |
|---|---|---|---|
| ink | 17.94 ✅ | 16.00 ✅ | 14.87 ✅ |
| ink-soft | 8.83 ✅ | 7.88 ✅ | 7.32 ✅ |
| ink-faint | 6.49 ✅ | 5.79 ✅ | 5.38 ✅ |
| crimson | 6.13 ✅ | 5.47 ✅ | 5.08 ✅ |
| moss | 6.48 ✅ | 5.78 ✅ | 5.37 ✅ |
| brass | 8.63 ✅ | 7.70 ✅ | 7.15 ✅ |
| danger | 12.30 ✅ | 10.97 ✅ | 10.19 ✅ |

Every value is higher than the navy dark mode it replaces.

### Two consequences

- **Chrome needs a visible edge.** Header and tab bar are the same `#000000`
  as the page, and their `black/30`–`black/40` borders are invisible on it.
  They become a white hairline.
- **`rule-strong` goes to 35%.** Input and button outlines are control
  boundaries, and `design.md` §2.2 sets a 3:1 floor for those. On pure black,
  white at 18% measures 1.55:1; 35% is the first step that reaches 3.00:1.
  Row dividers stay a soft 12% — they are decorative, and the book-like feel
  depends on them staying faint.

`theme-color` in `index.html` and `useTheme.ts` follows to `#000000` so the
Android status bar matches.

---

## 4. Shared button rule — icon alignment

`.btn` declares no layout, so an icon and its label are separate inline pieces
and the icon drops onto its own line. Visible on the BOQ screen ("Take photo",
"Size list") and on the Record screen's "Take photo".

Fix on the shared rule, once:

```css
display: inline-flex;
align-items: center;
justify-content: center;
gap: 8px;
```

All 122 `.btn` call sites are checked for anything that relied on the old
inline behaviour.

---

## 5. Defect found while measuring: the dark primary button

`index.css` carries:

```css
:root[data-theme="dark"] .btn-primary { color: var(--color-ink); }
```

`design.md` **D2** justifies it as *"white on the dark-mode accent (#d2703f)
measures 3.43:1. Ink measures 5.31:1."*

**5.31 is crimson-on-paper, not ink-on-the-crimson-fill.** Measured properly:

| Label on `#D2703F` fill | Ratio |
|---|---|
| white | 3.43 |
| `#E8E6E1` (today's ink) | **2.75** |
| `#EDEDED` (AMOLED ink) | 2.93 |

The rule makes the label *less* readable than the white it replaced, on every
primary button in dark mode. Neutralising `ink` would have made it worse.

**Fix:** delete the override and darken the dark-mode fill.

| Fill | white label |
|---|---|
| `#D2703F` (today) | 3.43 |
| **`#C4602F`** | **4.15** |
| `#B44C26` | 5.25 |

`#C4602F` with a white label is taken. `#B44C26` would reach the full 4.5 but
reads muddy against pure black. This applies to `--color-accent-fill`, a new
token used only by `.btn-primary`; `--color-crimson` keeps `#D2703F` for its
103 text and accent call sites, where it measures 6.13:1 on black.

---

## 6. Header mode-switch buttons

`design.md` requires one skin across both modes. Today the owner header has a
bordered pill ("Contractor view") and the contractor header a bare underlined
link ("I'm building a home"). Both become the same pill, each with an inline
`Icon`: a hard hat for the contractor side, the existing `house` for the owner
side.

---

## 7. Files

| File | Change |
|---|---|
| `src/index.css` | AMOLED tokens, `.btn` flex, `accent-fill`, `rule-strong` |
| `src/components/TabBar.tsx` | paged bar, dots, `MoreSheet` deleted |
| `src/hooks/useTabSwipe.ts` | **new** — gesture with the three rules above |
| `src/App.tsx` | `help` tab, swipe container, header icon |
| `src/components/ContractorHome.tsx` | header pill + icon |
| `src/components/SettingsScreen.tsx` | `<Faq />` removed |
| `src/components/Icon.tsx` | `hardhat` path |
| `index.html`, `src/hooks/useTheme.ts` | `theme-color` → `#000000` |
| `design.md` | §2 tokens + contrast, §5.7 tab bar, D2/D6 closed, §10.1 answered |

## 8. Defects found during verification

Two, both introduced by this work and both fixed before commit:

- **The Record circle squashed to 55×45 at the 1.25× text size.** Moving the centre
  action to `absolute inset-y-0` height-constrained its column, and a flex item
  shrinks along the main axis by default. Fixed with `shrink-0`; re-measured 55×55.
- **The Help tab had no gutters.** `<Faq />` is a bare `<section>` that had been
  inheriting `px-4 py-4 max-w-lg` from the Data screen's container. As a tab of its
  own it needed its own wrapper.

A third finding was a measurement artifact, recorded so it is not re-investigated:
`getComputedStyle().transform` reads the pre-transition value while the browser pane
is hidden, because a hidden tab throttles CSS transitions. Screenshots force a paint
and are the reliable oracle there.

## 9. Verification

No test framework in this repo. Verification is `npm run typecheck`, a
production `npm run build`, and the dev server driven in a 375px viewport:
dark mode at text scale 1.0 and 1.25, both bar pages, the swipe gesture, the
BOQ table exemption, and the BOQ and Record buttons.
