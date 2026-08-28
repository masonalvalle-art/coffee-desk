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
| The Board | Arabica **KCZ6** and Robusta **RCX6** — second traded month, resolved automatically | Yahoo Finance + TradingView (both ICE, delayed) |
| Price Action | Daily chart with 20/50-day means and swing-pivot support & resistance | derived from the price history below |
| Technical Picture | RSI(14), MACD(12,26,9), moving averages, ATR(14), Donchian(20), 52-week range | computed from real settlement prices |
| Currency | USD/GBP and USD/BRL, plus Brazil's official PTAX fixing | European Central Bank; Banco Central do Brasil |
| Physical Market | Differentials and certified stocks | **no verified free source — see below** |
| At Origin | 14 growing regions: observed and forecast temperature and rainfall, with frost/wet/dry flags | Open-Meteo |
| What to Read Today | Up to 5 stories relevant to someone buying physical coffee | publishers' own RSS feeds |

### Contract months resolve themselves

The dashboard never hardcodes a contract. It enumerates the listed delivery
months for each calendar (Arabica: Mar/May/Jul/Sep/Dec; Robusta:
Jan/Mar/May/Jul/Sep/Nov), probes the exchange feed for each, and keeps
whichever are actually quoting. Front month is the first, second month is the
one you see. When a contract expires it drops out and everything shifts along
on its own.

It also watches volume. When the front month thins out relative to the second —
as of writing, KCU26 was trading 39 lots against KCZ26's 4,886 — the page says
so, because that is the market telling you it has rolled.

### Arabica is cross-checked

Arabica is fetched from two independent feeds and the page publishes the gap
between them. If they ever disagree by more than 1% the page flags it rather
than silently picking one.

---

## What is deliberately missing

**Differentials.** Physical premiums and discounts are circulated privately by
brokers and exporters. There is no free, continuously updated feed. The section
renders an explicit "no verified source" state.

**Certified stocks.** ICE publishes these daily, but the report sits behind bot
protection, and every "free API" found in research was a paid reseller.

Both are wired for a planned upload feature: drop in ICO or trader-report PDFs
and the parsed figures populate `data/manual/differentials.json` and
`data/manual/certified-stocks.json`, which the page already reads and renders
as a table and a chart. The schema is in place; the parser is not built yet.

**Robusta price history.** No free provider publishes it. The pipeline records
one snapshot per run into `data/history/robusta.json`, so the series builds up
from here — each bar stamped with when it was captured and committed to git.
Robusta indicators stay `null` and the page says how many sessions it has until
there is enough history to mean anything. Arabica has full history from day one.

**News depth.** Only publishers' own syndication feeds are used. Aggregator
feeds such as Google News are excluded on purpose: their licences restrict them
to personal, non-commercial feed-reader use, which a public dashboard is not.
The honest consequence is that coffee is not a daily story for the general
press, and the specialist feeds skew towards café and retail news. Stories are
therefore scored *up* for physical-trade relevance and *down* for hospitality
and corporate-affairs noise, and the page runs fewer than five stories rather
than padding the list. On a quiet day you may see two.

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

Two runs each weekday:

- **06:00 UTC** — the morning brief.
- **18:30 UTC** — after both ICE US and ICE Europe have closed. This is the
  snapshot that goes into the Robusta history series.

Scheduled runs are UTC and GitHub may delay them under load. You can always
trigger a run by hand from the Actions tab.

### Why the data is committed to the repo

Each run commits `data/latest.json` and `data/history/robusta.json` back to the
repository. That gives every published number a permanent, timestamped, public
audit trail: you can check what the dashboard said on any past date, and where
it got it. It is also how the Robusta series accumulates.

---

## Layout

```
index.html                     the page
assets/style.css               newspaper styling, light and dark
assets/app.js                  renders data/latest.json; draws the SVG charts
data/latest.json               generated each run — the page reads only this
data/history/robusta.json      accumulated Robusta closes
data/manual/*.json             hand-maintained blocks (differentials, stocks)
scripts/fetch-data.mjs         orchestrator: fetches everything, writes latest.json
scripts/sources/*.mjs          one module per source
scripts/lib/indicators.mjs     RSI, MACD, ATR, pivots, Donchian
scripts/lib/contracts.mjs      contract-month enumeration and roll detection
.github/workflows/             the scheduled fetch and Pages deploy
```

The fetch pipeline uses **only Node built-ins**. There are no dependencies,
no `npm install` in the workflow, and no supply chain to audit.

### Local helper scripts

These exist only because the machine this was built on had no Node or Python.
They are not used in production and can be deleted.

- `scripts/serve.pl` — a minimal static server, so the page can be opened
  locally with its JavaScript running: `perl scripts/serve.pl 8787`
- `scripts/build-preview.pl` — bundles the site into a single self-contained
  `preview.html`
- `scripts/seed-preview.pl` — writes a first `data/latest.json` from live
  sources, so the page has something real to render before the first
  scheduled run

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

Weather flags are rule-based, with the thresholds printed on the page: frost at
or below 4°C in a Brazilian region, wet above 50 mm forecast over seven days,
dry at or below 5 mm observed over fourteen. They describe weather, not price.
