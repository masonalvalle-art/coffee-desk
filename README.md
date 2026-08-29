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
| The Brief | A short read of the day, composed by rule from the figures on this page — no language model, nothing introduced | derived from everything below |
| Currency | GBP/USD (cable, ~1.36) and USD/BRL, cross-checked against Brazil's official PTAX fixing | European Central Bank; Banco Central do Brasil |
| Physical Market | Indicator prices for each origin group, the differentials between them, and certified stocks on New York and London — each a chart with a year or more of history | International Coffee Organization |
| At Origin | 12 growing regions grouped by country, with a condition icon and words, observed temperature and rainfall, a forecast low for frost, and wet/dry flags | Open-Meteo |
| Origin Wire | Slider of general headlines with the publisher's own summary, from Brazil, Vietnam, Indonesia, Colombia, South & Central America and East Africa | BBC, Guardian, FT, Al Jazeera, VnExpress International |
| The Week in Coffee | The week's trade headlines, ranked by relevance to the physical market and grouped by theme | Daily Coffee News, Fresh Cup, SCA, World Coffee Portal, Sprudge |
| Today's Read | One article worth a buyer's time | Daily Coffee News |

### Arabica only

Robusta was removed **as a traded contract**. No free provider publishes a daily
Robusta price series, so its chart and indicators could never be built from a
complete history, and a half-populated contract is worse than an absent one.
Robusta-growing regions (Espírito Santo, Dak Lak, Lam Dong, Lampung) are still
on the weather table, because that data *is* complete and the two markets move
together.

ICO's **monthly** Robustas group indicator and the London futures average do
appear, under Physical Market. A monthly average is not the daily settlement
series a chart and its indicators need, which is why it sits there rather than
alongside Arabica on the board.

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

GBP/USD is quoted the way the market quotes it (cable, around 1.36), and USD/BRL
likewise. Each pair is requested from the ECB in its own convention rather than
fetched in one base and inverted here, so the rate on the page is the rate the
source published.

USD/BRL is cross-checked against Banco Central do Brasil's official PTAX fixing.
That comparison is reported in Sources & Method, with the current gap, rather
than as a second near-identical row in the table.

### The look

Editorial magazine on manila stock: air rather than rules, one aubergine accent
on the structural furniture, and Cinzel — an inscriptional Roman set as
capitals — on the nameplate. Green and red are reserved for price direction and
weather risk, so the accent was chosen to sit well clear of them.

### Weather conditions

Each region carries an icon *and* the condition in words. The classification is
rule-based and printed on the page: over the last three observed days, 30 mm of
rain in total, 20 mm in any one day, or a heavy-rain weather code is **very
wet**; 5 mm is **wet**; 60% mean cloud cover is **cloudy**; anything else is
**clear/dry**.

The window is three days rather than one on purpose. A single-day snapshot
classified almost every origin as wet, because the WMO weather code counts
light drizzle the same as real rain.

The columns are headed **"Max °C obs"**, **"Min °C fc"** and **"Rain 14d"**, so
it is clear which look back and which looks forward: the first and last are
observed, while the middle one is the lowest temperature in the seven-day
forecast — the frost warning for Brazil.

Forecast 7-day rainfall is still calculated — it is what raises the **wet**
flag, and the millimetre figure appears in the flagged note — but it no longer
has a column of its own, because two rainfall numbers side by side competed for
attention.

### The news desk

The origin wire is a **slider**: one story at a time, with the publisher's own
summary, advancing every ten seconds. It pauses on hover and on focus, stops
for good once you use the arrows or dots, and does not advance at all while
the tab is in the background. Which slide is showing is decided by visibility
rather than by an opacity transition, so the state is always correct even if
the animation is throttled or never runs.

The weekly recap is a **static list** grouped into "Top stories of the week",
"Trade & production" and "Roasting & retail", in that order. It is a weekly
digest of one-line headlines, so motion would add nothing.

---

## The physical market, and what it is not

The [ICO Coffee Market Report](https://ico.org/coffee-market-report/) is published
monthly as a PDF. It is free, public, and the only source found that publishes
any of this. The pipeline fetches the newest report, parses three of its tables,
and accumulates them into a history:

- **Indicator prices** for the ICO Composite and each origin group — Colombian
  Milds, Other Milds, Brazilian Naturals, Robustas — plus the New York and
  London futures averages.
- **Group differentials**: the spread between one group indicator and another,
  and the New York–London arbitrage.
- **Certified stocks** on the New York and London futures markets.

Each report restates the preceding year, so one download brings twelve months of
history with it, and every later report re-states months already held. Where a
restated figure differs, ICO has revised it: the change is recorded as a
revision rather than quietly replacing the old number.

**What this is not.** ICO reports origin and quality *groups*, not individual
origins or marks. These are not the FOB differentials a broker quotes against
the C contract for a named lot, and the page says so beside the tables. There is
also **no certification breakdown** — no Fairtrade, Organic or Rainforest series
appears here, because no free source publishes one. The schema carries the
field; nothing fills it.

Two or three months are usually missing from the certified-stocks series. ICO
draws some of that table's column headings in an embedded font with no character
map, so the figure is legible but the month it belongs to is not. Those columns
are dropped and the chart says how many. Counting along from a readable
neighbour would have filled them in, and would have been a guess.

`data/manual/differentials.json` and `data/manual/certified-stocks.json` survive
as optional hand-entered overrides for figures held in a document the pipeline
cannot reach. They are normally empty, and the private-data warning above still
applies to them.

### Reading a PDF with no dependencies

`scripts/lib/pdf.mjs` extracts text *with its position on the page*, because a
table cell only means anything in its column — a flat text dump turns a row into
`Aug-25297.05366.72`. It decompresses the content streams with `node:zlib`,
walks the text-positioning operators to get an x and y for every fragment, and
groups fragments into rows and columns by coordinate. It is about 300 lines and
adds no dependency, so the no-`npm install` property of this project survives.

Where a PDF uses an embedded subset font with no character map, the bytes are
glyph ids rather than characters. Those runs are flagged unmappable and dropped.
They are never guessed at.

---

## The weekly recap assembles itself

Perfect Daily Grind used to supply this section, and it needed refreshing by
hand every Friday. Their WAF rejects non-browser clients on TLS fingerprint:
tested three ways, PowerShell/.NET gets 200 while **curl and Node both get 403**.
A GitHub Actions runner has curl and Node, so it was never going to work there.

The recap is now built from the coffee trade press that does publish a usable
feed — Daily Coffee News, Fresh Cup, the Specialty Coffee Association, World
Coffee Portal and Sprudge. Stories from the past seven days are deduplicated
across publishers and ranked by their relevance to the physical trade, using the
same scoring that picks Today's Read: harvests, shipments, weather and prices
score; café openings and executive appointments do not. The top handful lead,
the rest are grouped, and the low-relevance tail is capped so a digest for a
trading desk does not fill up with counter news.

Every headline carries its publisher and links to that publisher's own page.
There is no weekly chore any more.

---

## The brief is written by rules, not by a model

The one piece of running prose on the page is composed from the figures already
in the payload by about a dozen rules — the session move, where the price sits
against its means and its 52-week range, the curve's shape, the ICO differential
that moved most, certified stocks, currency, and any origin carrying a weather
flag. Each rule scores how much its observation is worth saying today; the
strongest few run, in a fixed editorial order.

This is deliberate rather than a limitation. Every sentence is reproducible from
the committed `data/latest.json`, so the brief is auditable in exactly the way
every number on this page is; there is no API key, no dependency and no per-run
cost; and, most of all, **a rule cannot invent a figure.** A generated paragraph
would be the easiest imaginable way to break the governing rule of this project.

Each rule guards its own inputs and produces nothing when a figure it would name
is missing — a missing input drops the sentence rather than softening it into
vagueness. If too few survive, the section says so instead.

The cost is that it will never notice something genuinely novel. It says what
the numbers say, in the order a reader wants them.

---

## Deploying it

Everything runs on GitHub's infrastructure. There is nothing to install and no
API keys to manage — every source used is free and unauthenticated.

> **The repository is public.** Free GitHub Pages requires it. Everything
> committed today comes from public sources, but the planned differentials and
> trader-report uploads are proprietary: committing those here would make them
> world-readable and permanent in git history. Keep private figures out, or
> move to a private repo on a paid plan first.

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

`data/ico-history.json` is committed alongside it, and has to be: it accumulates
one report at a time, and every CI run starts from a fresh checkout. Without it
in the repository the record would reset each run to whatever the newest report
happened to restate.

---

## Layout

```
index.html                     the page
assets/style.css               newspaper styling, light and dark
assets/app.js                  renders data/latest.json; draws the SVG charts and icons
data/latest.json               generated each run — the page reads only this
data/ico-history.json          accumulated ICO series, one month added per report
data/manual/*.json             optional hand-entered overrides; normally empty
scripts/fetch-data.mjs         orchestrator: fetches everything, writes latest.json
scripts/sources/futures.mjs    Arabica contract discovery, quote, history, cross-check
scripts/sources/fx.mjs         ECB reference rates and the Brazilian PTAX fixing
scripts/sources/weather.mjs    origin regions, condition classification, risk flags
scripts/sources/news.mjs       origin wire, the assembled weekly recap, daily read
scripts/sources/ico.mjs        ICO report discovery and table parsing
scripts/lib/pdf.mjs            positioned-text PDF extractor, node:zlib only
scripts/lib/brief.mjs          the daily brief, composed by rule
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
