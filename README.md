# The Coffee Desk

A daily market brief for coffee buyers, published as a static webpage that
anyone can open on desktop or mobile.

The governing rule of this project: **no figure appears on the page unless a
named source returned it.** Nothing is estimated, interpolated, carried
forward, or filled in. When a source fails, the page says so in place of the
number, and the per-run fetch log at the bottom of the page records what
happened.

---

## What it shows

| Section | Contents | Source |
|---|---|---|
| The Board | Arabica **KCZ6** — second traded month, resolved automatically — plus the full forward curve and the spread of every other month against it | Yahoo Finance + TradingView (both ICE, delayed) |
| Price Action | Daily chart over 1M / 3M / 6M / 1Y, with 20/50-day means, swing-pivot support & resistance, round-number gridlines and a hover readout of exact OHLC | derived from the price history below |
| Momentum & trend | RSI(14), MACD(12,26,9), moving averages, ATR(14), Donchian(20), 52-week range | computed from real settlement prices |
| Support & resistance | Swing levels with the distance from the current price and the date each was set | computed from real settlement prices |
| Currency | GBP/USD (cable, ~1.36) and USD/BRL, plus Brazil's official PTAX fixing | European Central Bank; Banco Central do Brasil |
| Physical Market | Differentials and certified stocks | **no verified free source — see below** |
| At Origin | 12 growing regions grouped by country, with a condition icon and words, observed rainfall and temperature, and frost/wet/dry flags | Open-Meteo |
| Origin Wire | Slider of general headlines with the publisher's own summary, from Brazil, Vietnam, Indonesia, Colombia, South & Central America and East Africa | BBC, Guardian, FT, Al Jazeera, VnExpress International |
| The Week in Coffee | The headlines from Perfect Daily Grind's Friday round-up, grouped by section | Perfect Daily Grind |
| Today's Read | One article worth a buyer's time | Daily Coffee News |

### Arabica only

Robusta was removed. No free provider publishes Robusta price history, so its
chart and indicators could never be built from a complete series, and a
half-populated contract is worse than an absent one. Robusta-growing regions
(Espírito Santo, Dak Lak, Lam Dong, Lampung) are still on the weather table,
because that data *is* complete and the two markets move together.

### Contract months resolve themselves

The dashboard never hardcodes a contract. It enumerates the listed Coffee C
delivery months (Mar/May/Jul/Sep/Dec), probes the exchange feed for each, and
keeps whichever are actually quoting. Front month is the first, second month is
the one on the board. When a contract expires it drops out and everything
shifts along on its own.

It also watches volume. When the front month thins out relative to the second —
as of writing, KCU26 was trading 39 lots against KCZ26's 4,886 — the page says
so, because that is the market telling you it has rolled.

### The price is cross-checked

Arabica is fetched from two independent feeds and the page publishes the gap
between them. If they ever disagree by more than 1% the page flags it rather
than silently picking one. The session change is always derived from the same
series as the price beside it, never mixed between feeds.

### Reading the chart

The chart opens on **3 months** and offers 1M / 3M / 6M / 1Y; the choice is
remembered in the browser. All the bars are already loaded, so switching is
instant and fetches nothing.

Gridlines land on round numbers rather than interpolated ones, months are
marked along the date axis, and the closing price is pinned against the right
edge to two decimal places. **Hover, tap, or focus the chart and use the arrow
keys** to read the exact open, high, low, close and day's change for any
session.

Two details that matter for the short windows: the moving averages are
computed over the whole published series and then sliced, so both span the
full chart at every timeframe rather than starting partway in; and a support
or resistance level is only drawn when it falls inside the visible range,
since levels are found over years of history and an off-chart one would
otherwise flatten the price line. To make the 1Y view's 50-day mean complete,
the pipeline publishes a 60-bar shoulder beyond the longest window.

### Currency conventions

GBP/USD is quoted the way the market quotes it (cable, around 1.36), and
USD/BRL likewise. Each pair is requested from the ECB in its own convention
rather than fetched in one base and inverted here, so the rate on the page is
the rate the source published.

### Weather conditions

Each region carries an icon *and* the condition in words. The classification is
rule-based and printed on the page: over the last three observed days, 30 mm of
rain in total, 20 mm in any one day, or a heavy-rain weather code is **very
wet**; 5 mm is **wet**; 60% mean cloud cover is **cloudy**; anything else is
**clear/dry**.

The window is three days rather than one on purpose. A single-day snapshot
classified almost every origin as wet, because the WMO weather code counts
light drizzle the same as real rain.

The table shows observed rainfall over 14 days. Forecast 7-day rainfall is
still calculated — it is what raises the **wet** flag, and the millimetre
figure appears in the flagged note — but it no longer has a column of its own,
because two rainfall numbers side by side competed for attention.

### The news desk

The origin wire is a **slider**: one story at a time, with the publisher's own
summary, advancing every ten seconds. It pauses on hover and on focus, stops
for good once you use the arrows or dots, and does not advance at all while
the tab is in the background. Which slide is showing is decided by visibility
rather than by an opacity transition, so the state is always correct even if
the animation is throttled or never runs.

The weekly recap is a **static list** grouped by the recap's own sections, with
"Top stories of the week" and "Trade & production" first. It is a weekly digest
of one-line headlines with no summaries to show, so motion would add nothing.

---

## What is deliberately missing

**Differentials.** Physical premiums and discounts are circulated privately by
brokers and exporters. There is no free, continuously updated feed. The section
renders an explicit "no verified source" state.

**Certified stocks.** ICE publishes these daily, but the report sits behind bot
protection, and every "free API" found in research was a paid reseller.

Both are wired for a planned upload feature: drop in ICO or trader-report PDFs
and the parsed figures populate `data/manual/differentials.json` and
`data/manual/certified-stocks.json`, which the page already reads and renders.
The schema is in place; the parser is not built yet.

---

## The weekly round-up needs a hand

Perfect Daily Grind's WAF rejects non-browser clients. Every path returns 403 —
the article, the RSS feed, the sitemap, even through a reader proxy — regardless
of headers, because the block is on TLS/client fingerprint rather than address.
A GitHub Actions runner will almost certainly be refused too.

So the round-up list reads from `data/manual/pdg-roundup.json`, captured by
hand from the published article. **The pipeline still attempts the live fetch on
every run and will prefer it the moment it succeeds** — nothing needs changing
if PDG ever relaxes the block. The page always states which of the two it is
showing, and when the stored copy was captured.

To refresh it each Friday: open the newest post in
[the round-up archive](https://perfectdailygrind.com/category/weekly-round-up/),
and update `data/manual/pdg-roundup.json` with the article URL, its title,
today's `capturedAt`, and one entry per headline:

```json
{ "section": "Top stories of the week", "date": "Fri, 28 Aug", "headline": "…", "url": "https://original-source…" }
```

Headlines and links are the publisher's own; the list shows every headline in
the recap, each linking to its original source.

---

## Deploying it

Everything runs on GitHub's infrastructure. There is nothing to install and no
API keys to manage — every source used is free and unauthenticated.

1. Create an empty repository on GitHub.
2. Push this directory to it:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
```

```bash
git push -u origin main
```

3. In the repository, open **Settings → Pages** and set **Source** to
   **GitHub Actions**.
4. Open the **Actions** tab, choose *Update data and deploy*, and click
   **Run workflow** to publish the first edition immediately.

The site is then live at `https://YOUR-USERNAME.github.io/YOUR-REPO/` and
refreshes itself.

### Schedule

Two runs each weekday: **06:00 UTC** for the morning brief, and **18:30 UTC**
after ICE US has closed so the evening edition carries the day's settlement.
Scheduled runs are UTC and GitHub may delay them under load; you can always
trigger a run by hand from the Actions tab.

### Why the data is committed to the repo

Each run commits `data/latest.json` back to the repository. That gives every
published number a permanent, timestamped, public audit trail: you can check
what the dashboard said on any past date, and where it got it.

---

## Layout

```
index.html                     the page
assets/style.css               newspaper styling, light and dark
assets/app.js                  renders data/latest.json; draws the SVG charts and icons
data/latest.json               generated each run — the page reads only this
data/manual/*.json             hand-maintained blocks (differentials, stocks, PDG recap)
scripts/fetch-data.mjs         orchestrator: fetches everything, writes latest.json
scripts/sources/futures.mjs    Arabica contract discovery, quote, history, cross-check
scripts/sources/fx.mjs         ECB reference rates and the Brazilian PTAX fixing
scripts/sources/weather.mjs    origin regions, condition classification, risk flags
scripts/sources/news.mjs       origin wire, PDG round-up parser, daily read
scripts/lib/indicators.mjs     RSI, MACD, ATR, pivots, Donchian
scripts/lib/contracts.mjs      contract-month enumeration and roll detection
.github/workflows/             the scheduled fetch and Pages deploy
```

The fetch pipeline uses **only Node built-ins**. There are no dependencies,
no `npm install` in the workflow, and no supply chain to audit.

### Running it locally

`scripts/serve.pl` exists only because the machine this was built on has no
Node or Python, and the page needs a real HTTP origin for its JavaScript to
run. It is a **local development harness, never deployed**, and binds to
127.0.0.1 only:

```bash
perl scripts/serve.pl 8787
```

Besides static files it offers `/proxy?url=…`, which fetches a URL server-side
so the production modules can be exercised in a browser without tripping CORS,
and `POST /save?path=data/…`, which writes a pipeline result to disk. Both are
development conveniences — do not run this where anything else can reach the
port. With Node installed, `node scripts/fetch-data.mjs` does the same job
properly.

---

## Where the reasoning lives

Each section carries a one-line citation — source, scope, and a link to
**Sources & Method** at the foot of the page, which holds the full reasoning:
indicator formulas, how support and resistance are found, the weather
thresholds and condition rule, and how the origin wire is tagged and windowed.
Keeping it in one place stops every table growing a paragraph underneath it.

---

## Accuracy and limits

Exchange prices are **delayed**, not live settlements, and are shown for
information only. This dashboard is not trading, investment or hedging advice,
and it is not a substitute for your broker's confirmations or the exchange's
own settlement data.

The technical indicators are standard published formulas — Wilder's RSI, MACD
on exponential means, Wilder's ATR, swing-pivot levels — computed from the real
price series and nothing else. The RSI implementation is checked against
Wilder's own worked example from *New Concepts in Technical Trading Systems*.

The origin wire runs a three-week window because these regions are not covered
daily by the international press: on testing, the Guardian's newest Brazil story
was seven days old and its newest Vietnam story thirty-nine. Every headline
carries its own age so nothing old is mistaken for news.

Weather flags are rule-based, with the thresholds printed on the page: frost at
or below 4°C in a Brazilian region, wet above 50 mm forecast over seven days,
dry at or below 5 mm observed over fourteen. They describe weather, not price.
