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
data/ico-history.json          accumulated ICO series; committed, and must stay so
data/manual/*.json             optional hand-entered overrides; normally empty
scripts/fetch-data.mjs         orchestrator: fetches everything, writes latest.json
scripts/sources/*.mjs          one module per source (futures, fx, weather, news, ico)
scripts/lib/pdf.mjs            positioned-text PDF extractor, node:zlib only
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

- **Perfect Daily Grind** — the WAF rejects every non-browser client, on TLS/client
  fingerprint rather than address. Tested three ways: **PowerShell/.NET gets 200; curl and
  Node's `fetch` both get 403.** A GitHub runner has curl and Node, so it will never get
  through, and the fact that a request from this machine can succeed proves nothing. PDG was
  therefore dropped entirely rather than kept as a fallback — a permanently failing entry in
  the fetch log buys nothing. The weekly recap is now assembled from feeds that do work
  (see below). There is no weekly chore any more.
- **ICE certified stocks** — ICE's own daily report is behind bot protection and every "free
  API" found was a paid reseller. **A monthly figure is now published, from ICO Table 5.**
- **Physical differentials, per mark** — circulated privately by brokers; no free feed. ICO's
  *group* differentials are published and now on the page, but they are spreads between
  quality groups, not the FOB premium for a named mark. Do not present one as the other.
- **Certification data** — no free source publishes Fairtrade/Organic/Rainforest
  differentials at all. The schema carries the field; nothing fills it.
- **Robusta price history** — no free provider publishes it, which is why Robusta was
  dropped entirely. Robusta *growing regions* remain on the weather table, because that data
  is complete. Note ICO *does* publish a monthly Robustas group indicator, which is on the
  page — a monthly average, not the daily series a chart would need.
- **Pinterest** — serves a JS shell with no pins in the HTML. Cannot be read server-side.

## The ICO report

`scripts/sources/ico.mjs` fetches and parses the monthly ICO Coffee Market Report, which is
free, public, and the only source found for anything in the Physical Market section.

- **Discovery, not URL guessing.** The index at <https://ico.org/coffee-market-report/> is
  scraped for the newest `cmr-MMYY-e.pdf`. The pattern is predictable but the coffee-year
  folder rolls each October, so guessing works for eleven months and then quietly stops.
- Two tables are read: **Table 1** indicator prices by group, and **Table 5** certified
  stocks on New York and London. Table 2 (the spreads between group indicators) was parsed
  for a while and removed as not worth its room on the page; each report restates thirteen
  months, so re-adding the parse and running once would recover over a year in one download.
- **`scripts/lib/pdf.mjs` is a positioned-text extractor**, not a text dump. Table cells only
  mean anything in their column; a flat dump runs them together as `Aug-25297.05366.72`.
  It is built on `node:zlib` alone — no dependency was added.
- **Unmappable glyphs are never guessed.** Two or three of Table 5's month headings are drawn
  in a subset font with no `/ToUnicode` map, so their bytes are glyph ids. Those columns are
  dropped and the count is logged. Taking the month sequence from Table 1, or counting along
  from a readable neighbour, is inference — don't.
- **`data/ico-history.json` is the accumulator and must stay committed.** Each report
  restates the previous year, so history builds up and a restated figure that differs is
  recorded in `revisions` rather than silently overwritten. Every CI run starts from a fresh
  checkout, so the workflow commits this file alongside `latest.json`.
- The report is monthly and the pipeline runs twice a weekday, so the fetch is told what is
  already on record and skips the 1.2MB download when it matches.
- **The page still reads only `data/latest.json`.** The history is embedded into the payload
  at build time, which is what keeps `build-preview.pl` correct — it inlines exactly one data
  file.

## The weekly recap

Assembled in `scripts/sources/news.mjs` from Daily Coffee News, Fresh Cup, the SCA, World
Coffee Portal and Sprudge — each a publisher's own feed, no aggregators, same licensing
reason as the origin wire. Items are windowed to seven days, deduplicated, and ranked with
the `TRADE_SIGNAL`/`TRADE_NOISE` scoring that already picked the Featured Article. The low-relevance
tail is capped: without it, half the digest is café openings.

## The brief, and why there isn't one

A rule-composed prose summary was built and then removed as not earning its place: it
restated figures the reader could already see a few centimetres away. If the idea comes back,
the argument that still holds is that it must be **rules, not a language model** — every
sentence reproducible from the committed `latest.json`, because a generated paragraph is the
easiest imaginable way to break the one rule. See `scripts/lib/brief.mjs` at commit
`53063d4` rather than starting again from nothing.

## Design decisions and their reasons

- **Colour is disciplined.** Green and red mean price direction and weather risk and nothing
  else. The aubergine accent (`--accent`) was chosen specifically to sit clear of that pair,
  so any new accent must do the same. Never introduce a decorative red or green.
  The one exception is the four `--grp-*` chart tokens, which exist solely to tell the ICO
  origin-group lines apart when they are plotted together and a legend alone cannot do it.
  They are still clear of green and red, and `--accent` is deliberately not among them — it
  means structural furniture. Two things about them are non-obvious: the blue and the ochre
  are near neighbours of `--wet` and `--dry`, which is accepted because those appear only as
  flag text on the weather table and never as a line; and Colombian Milds and Other Milds are
  separated on depth and saturation as well as hue, because excluding green and red leaves
  their two hues adjacent, and the series themselves trade within a few cents, so at equal
  darkness the lines were genuinely hard to tell apart.
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
run the harness (one that has keeps its CORS errors); all ten sections render; no media
rule reports `not all`; no horizontal scroll at 375px; dark mode resolves to the warmed
`#14120E` ground.

A trap the recap section already sprang once: `.badge` is `white-space: nowrap`, and the
publisher badges are built with no whitespace between them, so inline layout offers no break
opportunity and the row runs off the page. `.roundup-source` is a wrapping flex row for
exactly that reason.

To republish the shareable preview:

```bash
perl scripts/build-preview.pl > preview.html
```

`preview.html` is gitignored and inlines `style.css`, `app.js` and `data/latest.json` into
one file — so if you ever split the stylesheet again, teach that script about it or the
preview will silently ship the wrong look.
