// The daily brief.
//
// A short piece of prose composed from the figures already in the payload. It
// is written by rules, not by a language model, and that is a deliberate
// choice rather than a limitation:
//
//   * Every sentence is reproducible from the committed data/latest.json. The
//     brief is auditable in exactly the way every number on this page is.
//   * A rule cannot invent a figure. The governing rule of this project is
//     that nothing appears unless a source returned it, and a generated
//     paragraph is the easiest imaginable way to break it.
//   * No API key, no dependency, no per-run cost, and no drift in what the
//     page says from one day to the next.
//
// The cost is that it will never notice something genuinely novel. It says
// what the numbers say, in the order a reader wants them.
//
// Each rule guards its own inputs and returns null when any figure it would
// name is missing. A missing input drops the sentence; it never softens it
// into vagueness, and it never reaches for a substitute number.

// The order sentences are read in, whatever order they were selected in.
const CATEGORY_ORDER = ['price', 'technical', 'physical', 'currency', 'origin'];

const MAX_SENTENCES = 7;

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function fmt(v, dp = 2) {
  return v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** A percentage, always signed where the sign carries meaning. */
function pct(v, dp = 1) {
  return `${v > 0 ? '+' : ''}${v.toFixed(dp)}%`;
}

const rose = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'unchanged');

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

/**
 * Each rule returns { category, salience, text } or null.
 * Salience ranks what is worth saying today; the editorial order above decides
 * what order the survivors are read in.
 */
const RULES = [

  // ---- price ------------------------------------------------------
  function lead(d) {
    const a = d.futures?.arabica;
    const q = a?.quote;
    if (!q || !isNum(q.last) || !isNum(q.change) || !isNum(q.changePct)) return null;
    if (!a.contract?.label) return null;

    const move = q.change === 0
      ? 'unchanged on the session'
      : `${rose(q.change)} ${fmt(Math.abs(q.change))} cents (${pct(q.changePct)}) on the session`;

    return {
      category: 'price',
      salience: 100,                                  // the lead always runs
      text: `Arabica for ${a.contract.label} last traded at ${fmt(q.last)} US cents a pound, ${move}.`,
    };
  },

  function sessionRange(d) {
    const q = d.futures?.arabica?.quote;
    if (!q || !isNum(q.high) || !isNum(q.low) || !isNum(q.volume)) return null;
    return {
      category: 'price',
      salience: 20,
      text: `The session ranged ${fmt(q.low)} to ${fmt(q.high)} on ${q.volume.toLocaleString('en-GB')} lots.`,
    };
  },

  function rolled(d) {
    const a = d.futures?.arabica;
    if (!a?.rolled || !a.frontMonth || !a.contract) return null;
    if (!isNum(a.frontMonth.volume) || !isNum(a.quote?.volume)) return null;
    return {
      category: 'price',
      salience: 70,
      text: `Volume has rolled to the second month: ${a.frontMonth.code} traded ` +
            `${a.frontMonth.volume.toLocaleString('en-GB')} lots against ${a.contract.code}'s ` +
            `${a.quote.volume.toLocaleString('en-GB')}, which is why the board shows ${a.contract.label}.`,
    };
  },

  function feedsDisagree(d) {
    const c = d.futures?.arabica?.crossCheck;
    if (!c || c.agree !== false || !isNum(c.diffPct)) return null;
    return {
      category: 'price',
      salience: 95,                                   // a discrepancy outranks almost everything
      text: `The two price feeds disagree by ${Math.abs(c.diffPct).toFixed(2)}%, so the quote above is flagged rather than reconciled.`,
    };
  },

  function curveShape(d) {
    const a = d.futures?.arabica;
    const curve = a?.curve;
    if (!Array.isArray(curve) || !a?.contract?.code) return null;

    // Measure from the board contract outward. The front month can be all but
    // untraded once volume has rolled, and a stale print there would describe
    // a curve shape the market is not actually showing.
    const from = curve.findIndex(c => c.code === a.contract.code);
    if (from < 0) return null;
    const near = curve[from];
    const far = curve[from + 1];
    if (!near || !far || !isNum(near.close) || !isNum(far.close)) return null;

    const gap = near.close - far.close;
    if (Math.abs(gap) < 0.01) return null;
    const shape = gap > 0 ? 'backwardation' : 'contango';

    return {
      category: 'price',
      salience: 40,
      text: `The curve is in ${shape}: ${near.label} at ${fmt(near.close)} against ${far.label} at ` +
            `${fmt(far.close)}, ${fmt(Math.abs(gap))} cents ${gap > 0 ? 'lower' : 'higher'} further out.`,
    };
  },

  // ---- technical --------------------------------------------------
  function movingAverages(d) {
    const a = d.futures?.arabica;
    const t = a?.technicals;
    const last = a?.quote?.last;
    if (!t || !isNum(last) || !isNum(t.sma20) || !isNum(t.sma50) || !isNum(t.sma200)) return null;

    const side = (mean) => (last >= mean ? 'above' : 'below');
    const all = [t.sma20, t.sma50, t.sma200];
    const aligned = all.every(m => last >= m) || all.every(m => last < m);

    const text = aligned
      ? `It is ${side(t.sma20)} all three means — 20-day ${fmt(t.sma20)}, 50-day ${fmt(t.sma50)}, ` +
        `200-day ${fmt(t.sma200)}.`
      : `It sits ${side(t.sma20)} the 20-day mean (${fmt(t.sma20)}) and ${side(t.sma200)} the ` +
        `200-day (${fmt(t.sma200)}).`;

    return { category: 'technical', salience: aligned ? 45 : 35, text };
  },

  function momentum(d) {
    const t = d.futures?.arabica?.technicals;
    if (!t || !isNum(t.rsi14)) return null;

    const rsi = t.rsi14;
    const reading = rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : 'neutral';
    let text = `RSI(14) is ${rsi.toFixed(1)}, ${reading}`;

    if (isNum(t.macd?.histogram)) {
      text += `, and the MACD histogram is ${t.macd.histogram >= 0 ? 'positive' : 'negative'} ` +
              `at ${t.macd.histogram.toFixed(2)}`;
    }

    return {
      category: 'technical',
      // An extreme reading is worth saying; a middling one is filler.
      salience: reading === 'neutral' ? 25 : 65,
      text: text + '.',
    };
  },

  function yearRange(d) {
    const a = d.futures?.arabica;
    const r = a?.technicals?.fiftyTwoWeek;
    const last = a?.quote?.last;
    if (!r || !isNum(last) || !isNum(r.high) || !isNum(r.low) || r.high <= r.low) return null;

    const offHigh = ((r.high - last) / r.high) * 100;
    const aboveLow = ((last - r.low) / r.low) * 100;

    return {
      category: 'technical',
      salience: offHigh < 5 || aboveLow < 5 ? 60 : 30,
      text: `That is ${offHigh.toFixed(1)}% off the 52-week high of ${fmt(r.high)} and ` +
            `${aboveLow.toFixed(1)}% above the low of ${fmt(r.low)}.`,
    };
  },

  function levels(d) {
    const t = d.futures?.arabica?.technicals;
    const sup = t?.levels?.support?.[0];
    const res = t?.levels?.resistance?.[0];
    if (!isNum(sup?.price) || !isNum(res?.price)) return null;
    return {
      category: 'technical',
      salience: 22,
      text: `The nearest swing levels are support at ${fmt(sup.price)} and resistance at ${fmt(res.price)}.`,
    };
  },

  // ---- physical ---------------------------------------------------
  function icoIndicator(d) {
    const points = d.ico?.indicators?.points;
    if (!Array.isArray(points) || points.length < 2) return null;
    const latest = points[points.length - 1];
    const prior = points[points.length - 2];
    if (!isNum(latest?.values?.composite) || !isNum(prior?.values?.composite)) return null;

    const change = ((latest.values.composite - prior.values.composite) / prior.values.composite) * 100;
    return {
      category: 'physical',
      salience: 50,
      text: `ICO's composite indicator averaged ${fmt(latest.values.composite)} US cents in ` +
            `${latest.label}, ${pct(change)} on the month.`,
    };
  },

  function icoDifferential(d) {
    const block = d.ico?.differentials;
    const points = block?.points;
    if (!Array.isArray(points) || points.length < 2 || !Array.isArray(block.series)) return null;

    const latest = points[points.length - 1];
    const prior = points[points.length - 2];

    // Report the pair that moved most this month — the one a buyer switching
    // between origins would actually feel.
    let biggest = null;
    for (const s of block.series) {
      const now = latest.values?.[s.key];
      const was = prior.values?.[s.key];
      if (!isNum(now) || !isNum(was)) continue;
      const move = Math.abs(now - was);
      if (!biggest || move > biggest.move) biggest = { series: s, now, was, move };
    }
    if (!biggest || biggest.move < 0.01) return null;

    const widened = Math.abs(biggest.now) > Math.abs(biggest.was);
    return {
      category: 'physical',
      salience: 55,
      text: `Among ICO's group differentials, ${biggest.series.label} moved most, ` +
            `${widened ? 'widening' : 'narrowing'} to ${fmt(biggest.now)} cents in ${latest.label} ` +
            `from ${fmt(biggest.was)}.`,
    };
  },

  function certifiedStocks(d) {
    const points = d.ico?.certifiedStocks?.points;
    if (!Array.isArray(points) || !points.length) return null;
    const latest = points[points.length - 1];
    const ny = latest?.values?.newYork;
    const ldn = latest?.values?.london;
    if (!isNum(ny) || !isNum(ldn)) return null;
    return {
      category: 'physical',
      salience: 38,
      text: `Certified stocks stood at ${ny.toFixed(2)} million bags in New York and ` +
            `${ldn.toFixed(2)} million in London in ${latest.label}.`,
    };
  },

  // ---- currency ---------------------------------------------------
  function currency(d) {
    const gbp = d.fx?.pairs?.GBPUSD;
    const brl = d.fx?.pairs?.USDBRL;
    if (!isNum(gbp?.rate) || !isNum(brl?.rate)) return null;

    let text = `Sterling is ${gbp.rate.toFixed(4)} against the dollar`;
    if (isNum(gbp.changePct)) text += ` (${pct(gbp.changePct, 2)} on the day)`;
    text += `, and the dollar buys ${brl.rate.toFixed(4)} reais`;
    if (isNum(brl.changePct)) text += ` (${pct(brl.changePct, 2)})`;

    // A sharp move in either leg matters to a UK buyer of a dollar contract
    // priced off a Brazilian crop; a quiet day does not.
    const biggest = Math.max(Math.abs(gbp.changePct ?? 0), Math.abs(brl.changePct ?? 0));
    return { category: 'currency', salience: biggest >= 0.5 ? 48 : 18, text: text + '.' };
  },

  // ---- origin -----------------------------------------------------
  function weatherFlags(d) {
    const regions = d.weather?.regions;
    if (!Array.isArray(regions) || !regions.length) return null;

    const flagged = regions.filter(r => Array.isArray(r.alerts) && r.alerts.length);
    if (!flagged.length) {
      return {
        category: 'origin',
        salience: 15,
        text: `None of the ${regions.length} origin regions carries a weather flag.`,
      };
    }

    const frost = flagged.filter(r => r.alerts.some(a => a.type === 'frost'));
    const names = flagged.map(r => r.name);
    const list = names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;

    let text = `${flagged.length} of ${regions.length} origin regions carry a weather flag: ${list}.`;
    if (frost.length) {
      text = `Frost risk is flagged in ${frost.map(r => r.name).join(' and ')}; ` +
             `${flagged.length} of ${regions.length} origin regions carry a flag in all.`;
    }

    return { category: 'origin', salience: frost.length ? 90 : 32, text };
  },
];

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

/**
 * Compose the brief.
 *
 * Returns null when there is too little to say — the page then renders its
 * ordinary "unavailable" state rather than a paragraph of hedging.
 */
export function buildBrief(payload) {
  const facts = [];
  for (const rule of RULES) {
    let fact = null;
    try {
      fact = rule(payload);
    } catch {
      // A rule that throws on an unexpected shape drops its sentence. One
      // malformed corner of the payload should not cost the whole brief.
      fact = null;
    }
    if (fact && fact.text) facts.push({ ...fact, rule: rule.name });
  }

  if (facts.length < 2) return null;

  facts.sort((a, b) => b.salience - a.salience);

  // Breadth first, then depth. Ranking on salience alone let the three
  // physical sentences crowd out the origin one on a day when two Vietnamese
  // regions were flagged for rain — which is exactly the sort of thing a
  // buyer opens this page for. So each category contributes its strongest
  // observation before any category gets a second.
  const strongestPerCategory = new Map();
  for (const fact of facts) {
    if (!strongestPerCategory.has(fact.category)) strongestPerCategory.set(fact.category, fact);
  }
  const breadth = [...strongestPerCategory.values()];
  const depth = facts.filter(f => !breadth.includes(f));

  const kept = breadth.concat(depth)
    .slice(0, MAX_SENTENCES)
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

  return {
    generatedAt: new Date().toISOString(),
    // Named so a reader can see which rules fired, and so a change in the
    // brief can be traced to a rule rather than to a mood.
    sentences: kept.map(f => ({ category: f.category, rule: f.rule, text: f.text })),
    method: 'Composed by rule from the figures on this page. No language model is involved, ' +
            'and no figure is introduced that is not published above.',
  };
}
