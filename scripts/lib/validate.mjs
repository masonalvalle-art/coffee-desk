// The last gate before a figure reaches the page.
//
// The governing rule of this project is that nothing appears unless a source
// returned it. That rule is enforced upstream, source by source. This file
// enforces the quieter half of it: that what a source returned is actually a
// figure, and that the relationships between the figures hold.
//
// A source failing is ordinary and already handled — it comes back null, the
// status log records it, and the page renders an "unavailable" state. This is
// for the other case: a source answering with something impossible. A price of
// NaN, a session change that does not equal the difference between the two
// prices beside it, bars out of order, a month appearing twice. None of those
// should ever reach a reader, and none of them announce themselves the way an
// HTTP error does.
//
// On a violation the pipeline writes nothing and exits non-zero. The previous
// edition stays live, which is the right failure: yesterday's figures, clearly
// dated, beat today's wrong ones.
//
// Checks only run against data that is present. Absence is not a violation.

/** Floating-point slack for a derived figure checked against its inputs. */
const EPSILON = 0.01;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Walk the whole payload for values JSON cannot represent honestly.
 *
 * JSON.stringify turns NaN and Infinity into null, so a broken computation
 * would reach the page as a missing figure rather than a wrong one — which is
 * survivable, but it would be silent, and the cause would be invisible. Catch
 * it here where the path can be named.
 */
function findNonFinite(node, path, problems) {
  if (typeof node === 'number') {
    if (!Number.isFinite(node)) problems.push(`${path} is ${node}`);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => findNonFinite(v, `${path}[${i}]`, problems));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) findNonFinite(v, `${path}.${k}`, problems);
  }
}

function checkArabica(arabica, problems) {
  if (!arabica) return;
  const at = (s) => `futures.arabica.${s}`;

  const q = arabica.quote;
  if (q) {
    for (const k of ['last', 'previousClose', 'change', 'changePct']) {
      if (q[k] != null && !isNum(q[k])) problems.push(`${at('quote.' + k)} is not a number`);
    }
    if (isNum(q.last) && q.last <= 0) problems.push(`${at('quote.last')} is not positive`);

    // Same-source pairing, the corollary written into CLAUDE.md: a displayed
    // change must be the difference between the two prices beside it. Mixing
    // feeds here once produced a change with the wrong sign, and nothing about
    // the payload looked wrong at the time.
    if (isNum(q.last) && isNum(q.previousClose) && isNum(q.change)) {
      const derived = q.last - q.previousClose;
      if (Math.abs(derived - q.change) > EPSILON) {
        problems.push(
          `${at('quote.change')} is ${q.change} but last − previousClose is ${derived.toFixed(4)}`);
      }
    }
    if (isNum(q.change) && isNum(q.previousClose) && isNum(q.changePct) && q.previousClose !== 0) {
      const derived = (q.change / q.previousClose) * 100;
      if (Math.abs(derived - q.changePct) > 0.05) {
        problems.push(
          `${at('quote.changePct')} is ${q.changePct} but change/previousClose is ${derived.toFixed(4)}`);
      }
    }
    if (isNum(q.high) && isNum(q.low) && q.high < q.low) {
      problems.push(`${at('quote')} high ${q.high} is below low ${q.low}`);
    }
  }

  const bars = arabica.bars;
  if (Array.isArray(bars) && bars.length) {
    let previousDate = '';
    bars.forEach((b, i) => {
      const where = at(`bars[${i}]`);
      if (!b || !b.date) { problems.push(`${where} has no date`); return; }
      // Strictly ascending: a repeated session would be counted twice by every
      // indicator downstream, and a chart would draw a spur back on itself.
      if (b.date <= previousDate) {
        problems.push(`${where} date ${b.date} does not follow ${previousDate}`);
      }
      previousDate = b.date;
      if (!isNum(b.close)) { problems.push(`${where} close is not a number`); return; }
      if (b.close <= 0) problems.push(`${where} close ${b.close} is not positive`);
      // High below low is impossible and worth failing over. A close outside
      // that range is NOT: this is a futures contract, so Yahoo's close is the
      // exchange settlement price while high and low are traded extremes, and
      // settlement is struck from a closing period rather than the last print.
      // It can legitimately sit outside the range, and does on about 1.6% of
      // bars here — checking for it failed the very first run against real
      // data. An equities assumption, wrong for this instrument.
      if (isNum(b.high) && isNum(b.low) && b.high < b.low) {
        problems.push(`${where} high ${b.high} is below low ${b.low}`);
      }
    });
  }

  const t = arabica.technicals;
  if (t) {
    if (isNum(t.rsi14) && (t.rsi14 < 0 || t.rsi14 > 100)) {
      problems.push(`${at('technicals.rsi14')} is ${t.rsi14}, outside 0–100`);
    }
    if (isNum(t.atr14) && t.atr14 < 0) problems.push(`${at('technicals.atr14')} is negative`);
    const w = t.fiftyTwoWeek;
    if (w && isNum(w.high) && isNum(w.low) && w.high < w.low) {
      problems.push(`${at('technicals.fiftyTwoWeek')} high is below low`);
    }
  }
}

function checkIco(ico, problems) {
  if (!ico) return;
  for (const name of ['indicators', 'certifiedStocks']) {
    const block = ico[name];
    if (!block || !Array.isArray(block.points)) continue;
    let previous = '';
    block.points.forEach((point, i) => {
      const where = `ico.${name}.points[${i}]`;
      if (!point.month) { problems.push(`${where} has no month`); return; }
      // Months are the x axis of a chart; a duplicate or an out-of-order entry
      // would plot a figure under the wrong label.
      if (point.month <= previous) {
        problems.push(`${where} month ${point.month} does not follow ${previous}`);
      }
      previous = point.month;
      for (const [key, value] of Object.entries(point.values ?? {})) {
        if (!isNum(value)) problems.push(`${where}.values.${key} is not a number`);
        else if (value < 0) problems.push(`${where}.values.${key} is negative`);
      }
    });
  }
}

function checkFx(fx, problems) {
  if (!fx || !fx.pairs) return;
  for (const [name, pair] of Object.entries(fx.pairs)) {
    if (pair.rate != null && (!isNum(pair.rate) || pair.rate <= 0)) {
      problems.push(`fx.pairs.${name}.rate is not a positive number`);
    }
  }
}

function checkWeather(weather, problems) {
  if (!weather || !Array.isArray(weather.regions)) return;
  weather.regions.forEach((r, i) => {
    // Provenance stays in the payload: lat/lon render nowhere, but they are
    // what let a reader check a figure against the source. CLAUDE.md says not
    // to tidy them away, so this fails if someone does.
    if (!isNum(r.lat) || !isNum(r.lon)) {
      problems.push(`weather.regions[${i}] (${r.name ?? '?'}) has no usable lat/lon`);
    }
  });
}

function checkNews(news, problems) {
  if (!news) return;
  for (const [name, block] of Object.entries(news)) {
    const items = block && (block.items ?? (block.article ? [block.article] : null));
    if (!Array.isArray(items)) continue;
    items.forEach((item, i) => {
      // A headline a reader cannot follow to its source is exactly the kind of
      // unverifiable claim this page refuses to make.
      if (!item.url) problems.push(`news.${name} item ${i} has no link to its source`);
    });
  }
}

/**
 * Check a payload before it is published.
 * Returns a list of problems; empty means it is safe to write.
 */
export function validatePayload(payload) {
  const problems = [];

  if (!payload.generatedAt || !Number.isFinite(Date.parse(payload.generatedAt))) {
    problems.push('generatedAt is missing or unparseable');
  }

  findNonFinite(payload, 'payload', problems);
  checkArabica(payload.futures?.arabica, problems);
  checkIco(payload.ico, problems);
  checkFx(payload.fx, problems);
  checkWeather(payload.weather, problems);
  checkNews(payload.news, problems);

  return problems;
}
