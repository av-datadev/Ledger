# Brick Book — marketing site

The public landing page for the domain the Play Store listing points at. One
self-contained `index.html`: no build step, no dependencies, no framework.

## Why it is a separate deployment, not a page in the app

The PWA owns the root of its own origin — `start_url: "/"`, `scope: "/"` in the
manifest — and the Android TWA wraps that origin. Putting a landing page at `/`
would displace the app for everyone who has already installed it, and would need
the manifest scope, the TWA, and Supabase's Site URL / redirect settings all
changed together.

So this deploys as its **own Vercel project** on the marketing domain, and the
app keeps its own URL. Nothing here shares code, state, or a deploy with the app.

## Deploying

New Vercel project → import this repo → set **Root Directory** to `site` →
Framework preset **Other**, no build command, output directory `.`. Then attach
the domain. Pushes to `main` deploy it, independently of the app's project.

## Before it goes live

- [ ] Point the two `ledger-nu-ashen.vercel.app` CTAs at the **Play Store
      listing** once the app is published (marked with a `TODO` in the HTML).
      The footer's privacy / terms / delete-account links must keep pointing at
      the app's own origin — those are the URLs the store listing declares, and
      the pages live with the app.
- [ ] Confirm the pricing block still matches what is actually charged. It says
      ₹0 solo and ₹999 once per project; if that changes, this page is a place
      people will hold you to.
- [ ] Add an `og:image` (1200×630) and a `<link rel="canonical">` once the real
      domain is settled — both need the final URL, so they are deliberately not
      guessed here.

## Notes on the page itself

- Every figure and name on it is **invented**. Payer 1, Contractor, Plumber,
  Architect, Verma Traders. No real person, contractor or family total appears
  anywhere, and none should be added — this page is public and indexed.
- Design tokens are the app's own (`--ink`, `--paper`, `--accent`, the serif
  headings), so the site and the app read as one product. If the app's skin
  changes, change these to match.
- Scroll reveals are applied by JavaScript and gated on a `.js` class set before
  first paint, so with JavaScript off the page renders fully visible rather than
  blank. Two timers act as a safety net if the IntersectionObserver misses
  something — content that never reveals is worse than an animation that never
  plays. `prefers-reduced-motion` disables all of it.
