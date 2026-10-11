# Brick Book — marketing site

The public landing page for the domain the Play Store listing points at.
Hand-written markup, a stylesheet per concern, a module per behaviour, and four
screenshots in `img/`. **No build step, no dependencies, no framework** — the
files are served exactly as they are written.

```
site/
  index.html          markup only
  css/   tokens base buttons nav hero sections voice work
         build chips sides pricing footer motion
  js/    main env nav reveal pinned-phone build voice-demo
  img/   dash voice boq ledger  (real captures — see below)
  shoot.mjs           regenerates img/
```

`css/tokens.css` is the one place a colour is defined; `css/motion.css` loads
last because it holds the reveal states and the `prefers-reduced-motion`
overrides and has to be able to win. The JavaScript is native ES modules, each
one guarding its own markup so a section can be deleted from the page without
anything else needing to know. `js/env.js` holds the three things more than one
module needs: whether motion is allowed, Indian number formatting, and
"which of these elements is nearest the middle of the screen".

**Three things the split cost, all worth knowing:**

- **ES modules must be served over HTTP**, not opened as a `file://` URL. The
  launch config and Vercel both serve, so this only bites if you double-click
  `index.html`.
- **The shared chrome is duplicated in all seven pages.** The nav and footer
  are copied into each file, because there is no build step to assemble them.
  Change one and you must change all seven. This is the first thing that will
  become annoying; when it does, the answer is a ~40-line Node assembler and a
  Vercel build command, not seven careful hands.
- **Assets are versioned by hand.** Every page links `css/x.css?v=N`. A file
  keeps its NAME when its contents change, and a local preview will happily
  serve you yesterday's stylesheet — which cost real debugging time while this
  was being built. Bump `?v=` when you edit anything in `css/` or `js/`.
  Vercel revalidates on its own, so this is a convenience for local work.

## The pages

| File | Job |
|---|---|
| `index.html` | The hook. One promise, one proof, and doors to the rest. |
| `owners.html` | The household ledger — money, materials, people. |
| `contractors.html` | Site books — received, spent, in hand. |
| `build.html` | The G+1 scroll: eight stages, drawn and counted. |
| `reads.html` | Bills, speech, UPI QRs, Hindi numerals, trade units. |
| `privacy-first.html` | Offline, no ads, no brokers, export whenever. |
| `pricing.html` | ₹0 to start, ₹999 once per project. |

Owners and contractors are separate pages on purpose: they are different
products for different people arriving with different questions, and they used
to share one cramped section.

**Every page carries exactly one `<h1>`** — its own title. The hero's headline
is the homepage's.

## Photography

`img/photo/*.webp` are **Pexels stock**, which permits commercial use with no
attribution required. Two rules were applied picking them and should stay
applied:

- **No recognisable faces.** The free tier carries no model release, so a
  photograph of an identifiable person on a commercial page is a risk nobody
  needs to take.
- **No third-party brand marks.** Several otherwise-good cement-bag shots were
  rejected for carrying other companies' logos.

They are ground, never subject: each sits behind a scrim at reduced opacity
with text over it, and each is sized for the band it fills rather than for
pixel-peeping — the audience is on mobile data.

**What is NOT in here, and why.** `Ref_img/` holds a photograph of a real
handwritten plumbing bill that is the single most on-brand image this project
owns — it is the paper register the app replaces, in one frame. It cannot ship:
it carries a real person's name, real line items and a real total. If you want
that image on the site, re-shoot it with invented names and amounts. The same
goes for every other photo in that folder.

## Why it is a separate deployment, not a page in the app

The PWA owns the root of its own origin — `start_url: "/"`, `scope: "/"` in the
manifest — and the Android TWA wraps that origin. Putting a landing page at `/`
would displace the app for everyone who has already installed it, and would need
the manifest scope, the TWA, and Supabase's Site URL / redirect settings all
changed together.

So this deploys as its **own Vercel project** on the marketing domain, and the
app keeps its own URL. Nothing here shares code, state, or a deploy with the app.

## Deploying

**Live at <https://brickbook-site.vercel.app>** since 2026-10-11 — Vercel
project `brickbook-site`, linked to this repo with **Root Directory** `site`,
framework **Other**, no build or install command. Pushes to `main` deploy it,
independently of the app's `ledger` project (the same push redeploys both).

No custom domain yet. When one is attached, do the `og:image` / canonical item
below in the same change.

## Still open now that it is live

- [ ] Point the `ledger-nu-ashen.vercel.app` CTA at the **Play Store listing**
      once the app is published (marked with a `TODO` in the HTML).
      The footer's privacy / terms / delete-account links must keep pointing at
      the app's own origin — those are the URLs the store listing declares, and
      the pages live with the app.
- [ ] Confirm the pricing block still matches what is actually charged. It says
      ₹0 solo and ₹999 once per project; if that changes, this page is a place
      people will hold you to.
- [ ] Add an `og:image` (1200×630) and a `<link rel="canonical">` once the real
      domain is settled — both need the final URL, so they are deliberately not
      guessed here.

## The screenshots

`img/*.webp` are **real captures of the real app**, not mockups — the hero used
to be a phone drawn in CSS, which had to be kept in sync with an app it didn't
come from and always looked illustrated.

They are regenerated by `shoot.mjs`, which drives headless Chrome over the
DevTools Protocol with **no npm dependencies** (Node 22+ has a global
`WebSocket`). It seeds the app with invented data first, so nothing real can
reach an image even by accident.

```bash
npm run dev                     # in the repo root, first
node site/shoot.mjs /tmp/shots  # all four, or pass dash|voice|boq|ledger
```

Then downscale to the width the page actually uses and convert:

```bash
node -e "const s=require('sharp');for(const n of ['dash','voice','boq','ledger'])s('/tmp/shots/'+n+'.png').resize({width:760}).webp({quality:80}).toFile('site/img/'+n+'.webp')"
```

**Re-shoot whenever the app's UI changes.** A landing page showing a version of
the app nobody can install is worse than one showing no screenshots at all.

All four are in use: `boq`, `dash` and `ledger` are the three screens in
"Watch it work", `dash` is also the hero, and `voice` sits beside the live demo
as proof that the thing the demo replays is really in the app.

One caveat worth knowing: the `voice` shot needs the "Heard" panel on screen,
which only exists after a real recording. `shoot.mjs` loads the app with
`?shot=voice`, and **that query parameter is not handled in the app** — the
capture was taken with a temporary local patch to `EntryForm.tsx` that seeded
the panel with genuine `scan-voice` output. Re-apply that patch by hand if the
voice shot needs redoing, and revert it before committing.

## Notes on the page itself

- Every figure and name on it is **invented**. Payer 1, Contractor, Plumber,
  Dealer 1, Gopal. No real person, contractor or family total appears
  anywhere, and none should be added — this page is public and indexed. Keep
  invented names off the family's own surname too: `shoot.mjs` still seeds a
  "Verma Traders", so rename it there before the screenshots are next re-shot. The
  app's own blank-state defaults are already generic ("Owner 1", "UPI 1"), so
  the screenshots needed no doctoring.
- The figures in the copy (182 payments, ₹48,62,400) **match the hero
  screenshot exactly**. If you re-seed with different data, change the copy too
  — a page whose text disagrees with its own screenshot reads as fake.
- **The voice demo is the one thing on the page you can operate.** It replays
  two real phrases: the transcript types in, the fields fill top to bottom, the
  row saves. The second take is the point of the feature — "saadhe teen hazaar"
  becomes ₹3,500 with no keyboard involved. Nothing is recorded and no
  microphone is touched; the card says so, because a mic button that isn't a mic
  button would otherwise be a small lie. It plays itself once on scroll, and the
  three links pointing at `#say` (nav, hero, final CTA) replay it.
- **"The build" raises a G+1 house as the number climbs.** The one section that
  stops showing a screen and shows a whole project: a pinned line drawing gains
  a stage at a time through eight stages — plot, footings, ground-floor frame,
  first-floor frame, brickwork, services, finishes, paint — while a running
  total counts up and a rail fills beside the steps. Three screenshots can say
  what the app looks like; none of them can say what three years and 182
  payments feel like, which is the thing being sold.

  **It is the only dark band on the page, deliberately.** The app's own chrome
  is dark in *both* themes and every phone screenshot here is dark, so this is
  the product's existing ground rather than a stylistic detour — and a drawing
  reads as a drawing on a drafting table. Contrast was computed against the
  `#0E1922` ground, not judged by eye:

  | | ratio | used for |
  |---|---|---|
  | off-white `#F5F3EC` | 15.9:1 | body copy, figures |
  | muted 62% white | 6.5:1 | captions |
  | `--accent-lit` `#D9703F` | 5.4:1 | eyebrow, stage numbers, any small text |
  | `--accent` `#C0562F` | 3.9:1 | **lines and rules only** — clears the 3:1 bar for graphics, never carries text here |

  Using `--accent` for text on this band is the same mistake as using the app's
  `crimson` as a button fill. They are separate tokens for the same reason.

  **Its figures are the hero screenshot's own, re-cut by stage rather than by
  category**, and they have to stay that way:

  | Stage | From the dashboard's categories | Stage | Running |
  |---|---|---|---|
  | 1 Land, drawings, approvals | Architect + Govt Fee + Site Prep | 6,15,000 | 6,15,000 |
  | 2 Foundation & plinth | Contractor, part | 4,60,000 | 10,75,000 |
  | 3 Ground floor frame | Contractor, part | 5,40,000 | 16,15,000 |
  | 4 First floor frame | Contractor, part | 5,40,000 | 21,55,000 |
  | 5 Brickwork, both floors | Contractor, rest | 3,00,000 | 24,55,000 |
  | 6 Plumbing & wiring | Plumbing + Electrical | 7,80,500 | 32,35,500 |
  | 7 Flooring, wood & marble | Marble + Wood + Tiles | 14,45,000 | 46,80,500 |
  | 8 Paint, and the keys | Paint | 1,81,900 | **48,62,400** |

  Stages 2–5 split the Contractor's ₹18,40,000; the eight total ₹48,62,400
  against the ₹60,00,000 budget — the same two numbers the hero screenshot
  shows, plus the ₹11,37,600 left and the "182 payments" the copy quotes. The
  figures live on each step's `data-total`, so the copy beside a step and the
  number under the drawing cannot drift apart. Re-seed the app and this whole
  table moves with it.

  Mechanics worth not relearning:

  - Every drawn line carries `pathLength="1"`, so one CSS rule completes any of
    them without measuring real path lengths.
  - Masonry **rises** (`scaleY` from the bottom) as a solid body with the brick
    coursing fading in over it. Scaling a brick-patterned rect squashes the
    courses.
  - The openings are a real `<mask>`, pinned to user space — its default region
    tracks the masked element's bounding box, which moves while walls are
    mid-rise.
  - **No `overflow:hidden` on the section.** An ancestor with a clip becomes the
    containing block for `position:sticky` and the pinned drawing silently stops
    pinning. `.house-track` carries bottom padding for the same reason: without
    it the pin runs out of container exactly as the last stage centres, and the
    finished house slides under the nav with its parapet and tank cut off.
  - The counter has a 900ms safety net. `requestAnimationFrame` does not fire in
    a background tab, and a figure that disagrees with the stage beside it is
    the one failure this section cannot have.

  On a phone the drawing still pins, at 21vh with the readout collapsed to one
  line: it cannot be repeated per step the way the three screenshots are,
  because the whole point is watching ONE house rise. With JavaScript off, or
  under `prefers-reduced-motion`, the finished house, the full rail and the
  final figure are what render — the same bargain the voice demo makes.


- **"Watch it work" pins one phone and changes its screen.** Which step is
  current is decided by re-measuring and taking the one nearest the middle of
  the viewport, *not* by trusting the IntersectionObserver entry — on a fast
  scroll three steps cross the band in one batch and the last one processed
  wins, which is not the one you are looking at. Below 941px the pinned frame is
  dropped and each step carries its own screenshot; the same four files, so
  nothing extra is downloaded. The dimming of inactive steps is gated on a
  `.live` class that only JavaScript adds, so a broken or skipped script leaves
  every step fully legible instead of at 42% opacity.
- **What the app understands is shown as input → output** — "dedh lakh" →
  ₹1,50,000, "tee 1" → Brass Tee 1″, a UPI QR → account and IFSC. This replaced
  a nine-card feature grid of short paragraphs. Nine thin ideas nobody reads are
  worth less than eight pairs anyone can scan.
- **Buttons carry a real depth press** rather than a colour change: a solid bar
  sits under the primary button as its side, and pressing travels down by
  exactly that height. The secondary is a pearl surface, not a hollow outline —
  an outline button next to a solid one reads as disabled.
- The hero device has **one scroll-linked moment written in native CSS**
  (`animation-timeline: view()`), not a library. It is wrapped in `@supports`
  and disabled under `prefers-reduced-motion` and below 941px, so anything that
  can't run it simply gets the finished, flat state. No main-thread work, and
  nothing to download.
- Design tokens are the app's own (`--ink`, `--paper`, `--accent`, the serif
  headings), so the site and the app read as one product. If the app's skin
  changes, change these to match.
- Scroll reveals are applied by JavaScript and gated on a `.js` class set before
  first paint, so with JavaScript off the page renders fully visible rather than
  blank. Two timers act as a safety net if the IntersectionObserver misses
  something — content that never reveals is worse than an animation that never
  plays. `prefers-reduced-motion` disables all of it, and the voice demo then
  renders its finished state instead of animating.
- The demo card's markup **is** the finished entry — filled fields, saved line.
  JavaScript empties it before replaying. With no JavaScript at all you see a
  completed entry rather than an empty card.

## Previewing it locally

`.claude/launch.json` has a `brick-book-site` configuration that serves this
directory on port 4321 with `python3 -m http.server`. There is nothing to build.
