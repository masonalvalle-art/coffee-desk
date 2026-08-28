# The Coffee Desk — working notes

A static daily market brief for coffee traders, deployed to GitHub Pages and refreshed
twice each weekday by a scheduled Action. `README.md` explains the product; this file is
the operational context you need before changing anything.

## The one rule

**No figure appears on the page unless a named source returned it.** Nothing is estimated,
interpolated, carried forward, or filled in. When a source fails, the page renders an
explicit "unavailable" state and the per-run fetch log at the foot of the page records what
happened.

This is not decoration. It has shaped real decisions — Robusta was removed rather than
shipped with a half-built price history, and differentials show an empty state rather than
a plausible number. If you find yourself about to fill a gap, don't: show the gap.

Two corollaries worth knowing:

- **Same-source pairing.** A displayed change must be derived from the same series as the
  price beside it. Mixing feeds once produced a change with the wrong sign.
- **Provenance stays in the payload.** `quote.previousClose` and each weather region's
  `lat`/`lon` are published even though nothing renders them, because they are what let a
  reader check a displayed number. Don't "tidy" them away.

## Running it

```bash
node scripts/fetch-data.mjs      # the real pipeline; writes data/latest.json
perl scripts/serve.pl 8787       # local origin, so the page's JS actually runs
```

`scripts/serve.pl` is a **local development harness, never deployed** — GitHub Pages serves
the static files directly. It binds to 127.0.0.1 and adds two routes beyond static files:

- `GET /proxy?url=…` fetches a URL server-side, so the production fetch modules can be
  imported and run in a browser without tripping CORS.
- `POST /save?path=data/…` writes a body to disk, so a pipeline run driven from the browser
  can produce `data/latest.json` exactly as the Action would.

Those existed because this machine had no Node for most of the build. Node is installed now,
so prefer running the pipeline directly; the harness is still the fastest way to exercise a
single source module against live data.

## Layout

```
index.html                     the page; sections carry sec-* classes for CSS targeting
assets/style.css               the whole look: tokens, components, responsive last
assets/app.js                  renders data/latest.json; draws the SVG chart and icons
data/latest.json               generated each run — the page reads only this
data/manual/*.json             hand-maintained: differentials, certified stocks, PDG recap
scripts/fetch-data.mjs         orchestrator: fetches everything, writes latest.json
scripts/sources/*.mjs          one module per source
scripts/lib/indicators.mjs     RSI, MACD, ATR, pivots, Donchian
scripts/lib/contracts.mjs      contract-month enumeration and roll detection
scripts/serve.pl               local harness (above)
scripts/build-preview.pl       bundles everything into a single preview.html
.github/workflows/             scheduled fetch and Pages deploy
```

The pipeline uses **only Node built-ins**. No dependencies, no `npm install` in the
workflow, nothing to audit. Keep it that way if you can.

## What is blocked, and why

Don't spend time re-testing these; it has been done thoroughly.

- **Perfect Daily Grind** — the WAF rejects every non-browser client. 403 on the article,
  the RSS feed, the sitemap, and through a reader proxy, regardless of headers, because the
  block is on TLS/client fingerprint rather than address. A real browser gets through, which
  is how the recap in `data/manual/pdg-roundup.json` was captured. The pipeline still
  attempts the live fetch every run and prefers it the moment it works.
  **Weekly chore:** refresh that file each Friday from the newest post in
  <https://perfectdailygrind.com/category/weekly-round-up/>. The page states which copy it
  is showing and when it was captured.
- **ICE certified stocks** — published daily but behind bot protection; every "free API"
  found was a paid reseller.
- **Physical differentials** — circulated privately by brokers. No free feed exists.
- **Robusta price history** — no free provider publishes it, which is why Robusta was
  dropped entirely. Robusta *growing regions* remain on the weather table, because that data
  is complete.
- **Pinterest** — serves a JS shell with no pins in the HTML. Cannot be read server-side.

## Design decisions and their reasons

- **Colour is disciplined.** Green and red mean price direction and weather risk and nothing
  else. The aubergine accent (`--accent`) was chosen specifically to sit clear of that pair,
  so any new accent must do the same. Never introduce a decorative red or green.
- **Manila stock, Cinzel display.** Editorial-magazine character: air rather than rules, one
  accent on structural furniture. References were the Sunday Times and FT, Vogue and Time,
  and Bauhaus for non-text elements — which is why the section rule is an asymmetric
  thick/thin bar and fields are unrounded, but no geometric typeface was added.
- **Citations are one line.** Source and scope beside each block; the reasoning lives in
  Sources & Method at the foot. Don't grow a paragraph under every table again.
- **The chart** defaults to 3 months with 1M/3M/6M/1Y, remembered in `localStorage`.
  Moving averages are computed on the **full** series then sliced, so they span every
  window; support/resistance is drawn only where it falls inside the visible range. The
  pipeline publishes 320 bars — 260 for the longest window plus a 60-bar shoulder so the
  1Y view's 50-day mean is complete.

## Traps that already cost time

- **Bash heredocs here mangle content.** They collapse `\\` to `\` and choke on unbalanced
  apostrophes. Use the Write tool for CSS/JS, or a script file. A regex written as
  `` `[\s\S]` `` inside a template literal silently became `[sS]` this way.
- **`perl -i` on a UTF-8 file corrupts it** unless you set the encoding layers. Without
  them the existing bytes are read as latin1 and written back as UTF-8, so `Espírito`
  becomes `EspÃ­rito` across the whole file. Use the Edit tool for prose, or
  `binmode(STDOUT, ':encoding(UTF-8)')` in a script. `git checkout -- <file>` undoes it.
- **CSS specificity.** `table.sheet th` (0,1,2) beats `th.num` (0,1,1) — every numeric
  header was left-aligned while its values were right-aligned. Qualify selectors.
- **The responsive block must stay last** in `style.css`. Media queries add no specificity,
  so any component rule declared after it wins.
- **After editing CSS, check for dead media queries.** Two were silently broken at once
  (a doubled `@media@media`, and a stray bare `@media`). They show in the CSSOM as
  `not all`:
  ```js
  [...document.styleSheets].flatMap(s => [...s.cssRules])
    .filter(r => r.type === CSSRule.MEDIA_RULE)
    .map(r => r.conditionText).filter(c => c === 'not all')   // must be empty
  ```
- **Grid items default to `min-width: auto`**, so a wide table refuses to shrink and pushes
  the whole page sideways. Check `scrollWidth === clientWidth` at 375px after layout work.
- **A hidden browser tab freezes transitions and `requestAnimationFrame`.** Two "bugs" were
  chased that were only this. Use a forced reflow (`void document.body.offsetHeight`) in
  checks, and never rely on a CSS transition finishing for correctness — the slider decides
  which slide shows by `visibility`, not opacity, for exactly this reason.
- **An animated element wider than ~16,384px silently fails to paint.** This killed the
  original scrolling ticker and is why the wire is a slider.
- **A `window.fetch` patch is lost on navigation.** Re-apply it before each harness run.

## Deploying

The repo is **public** — free GitHub Pages requires it.

> **Never commit broker differentials or trader reports.** They are proprietary, and a
> public repo makes them world-readable and permanent in git history. `data/manual/`
> currently holds only public information. The planned PDF-upload feature must keep private
> figures out of the repo, or the site must move to a private repo on a paid plan.

1. Create an empty public repository and push.
2. **Settings → Pages → Source: GitHub Actions.**
3. **Actions → Update data and deploy → Run workflow** for the first edition.

Two runs each weekday: 06:00 UTC, and 18:30 UTC after ICE US closes. Each run commits
`data/latest.json`, which gives every published number a timestamped public audit trail.

## Verifying a change

```bash
node scripts/fetch-data.mjs && perl scripts/serve.pl 8787
```

Then in the browser at `http://127.0.0.1:8787`: no console errors on a tab that has **not**
run the harness (one that has keeps its CORS errors); all ten sections render; no media rule
reports `not all`; no horizontal scroll at 375px; dark mode resolves to the warmed `#14120E`
ground.

To republish the shareable preview:

```bash
perl scripts/build-preview.pl > preview.html
```

`preview.html` is gitignored and inlines `style.css`, `app.js` and `data/latest.json` into
one file — so if you ever split the stylesheet again, teach that script about it or the
preview will silently ship the wrong look.
