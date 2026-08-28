// Coffee futures.
//
//  Arabica  ICE Futures US      "Coffee C"  KC   cents/lb   37,500 lb lot
//  Robusta  ICE Futures Europe  Robusta     RC   USD/tonne  10 tonne lot
//
// Two independent feeds, both carrying ICE prices on a short delay:
//   * Yahoo Finance chart API -- per-contract daily OHLC history (Arabica).
//   * TradingView public symbol endpoint -- per-contract live snapshot (both).
// Arabica is fetched from BOTH so we can cross-check the two and publish the
// discrepancy. If they disagree materially we flag it rather than pick one.

import { getJson, mapLimit } from '../lib/http.mjs';
import { upcomingContracts, classify, ARABICA_MONTHS, ROBUSTA_MONTHS } from '../lib/contracts.mjs';

const TV = 'https://scanner.tradingview.com/symbol';
const TV_FIELDS = 'close,open,high,low,change,change_abs,volume,description,update_mode,currency_id';

async function tvQuote(exchange, symbol) {
  const url = `${TV}?symbol=${encodeURIComponent(`${exchange}:${symbol}`)}&fields=${TV_FIELDS}`;
  const j = await getJson(url);
  if (!j || j.code === 'symbol_not_exists' || j.close == null) return null;
  return {
    close: j.close,
    open: j.open ?? null,
    high: j.high ?? null,
    low: j.low ?? null,
    change: j.change ?? null,
    changeAbs: j.change_abs ?? null,
    volume: j.volume ?? null,
    description: j.description ?? null,
    currency: j.currency_id ?? null,
    updateMode: j.update_mode ?? null,
  };
}

/** Probe the listed contract months and keep the ones actually quoting. */
async function discover(exchange, prefix, monthMap, count = 7) {
  const candidates = upcomingContracts(monthMap, count);
  const quotes = await mapLimit(candidates, 3, async (c) => {
    const q = await tvQuote(exchange, `${prefix}${c.long}`);
    return q ? { ...c, ...q, tvSymbol: `${exchange}:${prefix}${c.long}` } : null;
  });
  const live = quotes.filter(q => q && !q.__error && q.close != null);
  return { live, ...classify(live) };
}

/** Yahoo daily OHLC for one explicit Arabica contract, e.g. KCZ26.NYB */
async function yahooHistory(symbol, range = '2y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
              `?range=${range}&interval=1d`;
  const j = await getJson(url);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(`No Yahoo chart result for ${symbol}`);
  const ts = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (close == null) continue; // skip non-trading gaps rather than fill them
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: q.open?.[i] ?? null,
      high: q.high?.[i] ?? null,
      low: q.low?.[i] ?? null,
      close,
      volume: q.volume?.[i] ?? null,
    });
  }
  return {
    bars,
    meta: {
      symbol: r.meta?.symbol ?? symbol,
      name: r.meta?.shortName ?? null,
      currency: r.meta?.currency ?? null,
      exchange: r.meta?.fullExchangeName ?? null,
      marketPrice: r.meta?.regularMarketPrice ?? null,
      previousClose: r.meta?.chartPreviousClose ?? null,
      marketTime: r.meta?.regularMarketTime
        ? new Date(r.meta.regularMarketTime * 1000).toISOString() : null,
    },
  };
}

export async function fetchArabica() {
  const disc = await discover('ICEUS', 'KC', ARABICA_MONTHS);
  if (!disc.second) throw new Error('Could not resolve an Arabica second month');

  const target = disc.second;                      // the second traded month
  const yahooSymbol = `KC${target.short}.NYB`;     // e.g. KCZ26.NYB
  const hist = await yahooHistory(yahooSymbol);

  // Cross-check the two independent feeds against each other.
  const tvClose = target.close;
  const yfClose = hist.meta.marketPrice ?? hist.bars.at(-1)?.close ?? null;

  // The session change must be derived from the SAME source as the price it
  // sits beside. TradingView computes its change against its own previous
  // close, so pairing it with a Yahoo last price produced a change with the
  // wrong sign. Both figures now come from the Yahoo bar series.
  const lastBar = hist.bars.at(-1) ?? null;
  const prevBar = hist.bars.length >= 2 ? hist.bars.at(-2) : null;
  const change = (yfClose != null && prevBar) ? +(yfClose - prevBar.close).toFixed(4) : null;
  const changePct = (change != null && prevBar && prevBar.close)
    ? +((change / prevBar.close) * 100).toFixed(3) : null;
  const crossCheck = (tvClose != null && yfClose != null) ? {
    tradingView: tvClose,
    yahoo: yfClose,
    diff: +(tvClose - yfClose).toFixed(4),
    diffPct: +(((tvClose - yfClose) / yfClose) * 100).toFixed(3),
    agree: Math.abs((tvClose - yfClose) / yfClose) < 0.01, // within 1%
  } : null;

  return {
    market: 'Arabica',
    contractName: 'Coffee C',
    exchange: 'ICE Futures U.S.',
    unit: 'US cents / lb',
    lotSize: '37,500 lb',
    contract: {
      code: `KC${target.short}`,
      label: target.label,
      yahooSymbol,
      tvSymbol: target.tvSymbol,
    },
    frontMonth: disc.front ? { code: `KC${disc.front.short}`, label: disc.front.label, close: disc.front.close, volume: disc.front.volume } : null,
    rolled: disc.rolled,
    mostActive: disc.mostActive ? `KC${disc.mostActive.short}` : null,
    curve: disc.live.map(c => ({ code: `KC${c.short}`, label: c.label, close: c.close, volume: c.volume })),
    quote: {
      last: yfClose,
      // Same-source OHLC: the latest Yahoo bar, not the TradingView snapshot.
      open: lastBar?.open ?? null,
      high: lastBar?.high ?? null,
      low: lastBar?.low ?? null,
      previousClose: prevBar?.close ?? null,
      change,
      changePct,
      volume: lastBar?.volume ?? target.volume,
      asOf: hist.meta.marketTime,
    },
    bars: hist.bars,
    crossCheck,
    sources: [
      { name: 'Yahoo Finance (ICE delayed)', url: `https://finance.yahoo.com/quote/${yahooSymbol}`, role: 'price history + last' },
      { name: 'TradingView (ICE delayed)', url: `https://www.tradingview.com/symbols/ICEUS-${'KC' + target.long}/`, role: 'live snapshot + contract curve' },
    ],
  };
}

export async function fetchRobusta() {
  const disc = await discover('ICEEUR', 'RC', ROBUSTA_MONTHS);
  if (!disc.second) throw new Error('Could not resolve a Robusta second month');
  const target = disc.second;

  return {
    market: 'Robusta',
    contractName: 'Robusta Coffee',
    exchange: 'ICE Futures Europe',
    unit: 'USD / tonne',
    lotSize: '10 tonnes',
    contract: {
      code: `RC${target.short}`,
      label: target.label,
      tvSymbol: target.tvSymbol,
    },
    frontMonth: disc.front ? { code: `RC${disc.front.short}`, label: disc.front.label, close: disc.front.close, volume: disc.front.volume } : null,
    rolled: disc.rolled,
    mostActive: disc.mostActive ? `RC${disc.mostActive.short}` : null,
    curve: disc.live.map(c => ({ code: `RC${c.short}`, label: c.label, close: c.close, volume: c.volume })),
    quote: {
      last: target.close,
      open: target.open,
      high: target.high,
      low: target.low,
      previousClose: null,
      change: target.changeAbs,
      changePct: target.change,
      volume: target.volume,
      asOf: new Date().toISOString(),
    },
    // No free source publishes Robusta daily history, so we accumulate our own
    // from these snapshots (see data/history/robusta.json). Populated by index.mjs.
    bars: [],
    sources: [
      { name: 'TradingView (ICE Europe delayed)', url: `https://www.tradingview.com/symbols/ICEEUR-${'RC' + target.long}/`, role: 'live snapshot + contract curve' },
    ],
  };
}
