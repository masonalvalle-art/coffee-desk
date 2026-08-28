// Technical indicators. Every value here is DERIVED from real settlement /
// last-trade prices fetched from the exchange feeds -- nothing is estimated,
// smoothed by hand, or filled in. If there aren't enough observations to
// compute an indicator honestly, we return null and the UI says so.

export function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  // Seed with a simple average of the first `period` observations.
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [prev];
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Wilder's RSI (the standard 14-period smoothing, not a simple average). */
export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** MACD (12, 26, 9). Returns the line, its signal, and the histogram. */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  // Align: emaFast starts (slow-fast) observations earlier than emaSlow.
  const offset = emaFast.length - emaSlow.length;
  const macdLine = emaSlow.map((v, i) => emaFast[i + offset] - v);
  const signalSeries = emaSeries(macdLine, signal);
  if (!signalSeries.length) return null;
  const line = macdLine[macdLine.length - 1];
  const sig = signalSeries[signalSeries.length - 1];
  return { line, signal: sig, histogram: line - sig };
}

/** Average True Range -- a plain volatility read, in price units. */
export function atr(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    if (h == null || l == null || pc == null) continue;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return null;
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

/**
 * Support and resistance from actual swing pivots -- a bar whose high is the
 * highest (or low the lowest) within `lookback` bars either side. These are
 * real traded levels, not drawn lines.
 */
export function pivots(bars, lookback = 5, maxLevels = 3) {
  const highs = [], lows = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const w = bars.slice(i - lookback, i + lookback + 1);
    if (bars[i].high != null && w.every(b => b.high == null || b.high <= bars[i].high)) {
      highs.push({ price: bars[i].high, date: bars[i].date });
    }
    if (bars[i].low != null && w.every(b => b.low == null || b.low >= bars[i].low)) {
      lows.push({ price: bars[i].low, date: bars[i].date });
    }
  }
  const last = bars[bars.length - 1]?.close;
  if (last == null) return { support: [], resistance: [] };
  // Nearest untested levels above and below the current price.
  const resistance = highs.filter(h => h.price > last)
    .sort((a, b) => a.price - b.price).slice(0, maxLevels);
  const support = lows.filter(l => l.price < last)
    .sort((a, b) => b.price - a.price).slice(0, maxLevels);
  return { support, resistance };
}

/** Donchian channel: the plain N-day high/low range. */
export function donchian(bars, period = 20) {
  if (bars.length < period) return null;
  const slice = bars.slice(-period);
  const hs = slice.map(b => b.high).filter(v => v != null);
  const ls = slice.map(b => b.low).filter(v => v != null);
  if (!hs.length || !ls.length) return null;
  return { high: Math.max(...hs), low: Math.min(...ls), period };
}

/**
 * Build the full technical block for a contract, or explain why it can't be
 * built. `minBars` guards against computing an indicator off too little data.
 */
export function buildTechnicals(bars) {
  const closes = bars.map(b => b.close).filter(v => v != null);
  const n = closes.length;
  const need = (p) => n >= p;

  return {
    observations: n,
    sma20: need(20) ? sma(closes, 20) : null,
    sma50: need(50) ? sma(closes, 50) : null,
    sma200: need(200) ? sma(closes, 200) : null,
    rsi14: need(15) ? rsi(closes, 14) : null,
    macd: need(35) ? macd(closes) : null,
    atr14: bars.length >= 15 ? atr(bars, 14) : null,
    donchian20: need(20) ? donchian(bars, 20) : null,
    levels: n >= 30 ? pivots(bars) : { support: [], resistance: [] },
    fiftyTwoWeek: n >= 30 ? {
      high: Math.max(...bars.map(b => b.high ?? b.close).filter(v => v != null)),
      low: Math.min(...bars.map(b => b.low ?? b.close).filter(v => v != null)),
    } : null,
    method: 'Wilder RSI(14); MACD(12,26,9) on EMA; ATR(14); pivots = 5-bar swing highs/lows; Donchian(20).',
  };
}
