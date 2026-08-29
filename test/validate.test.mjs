// The publish gate.
//
// These tests exist because the gate's job is to fire on data nobody expected,
// which is exactly the code least likely to be exercised in normal running. If
// it silently stopped catching things, the first sign would be a wrong figure
// on the live page.

import test from 'node:test';
import assert from 'node:assert/strict';

import { validatePayload } from '../scripts/lib/validate.mjs';

/** A minimal payload that should pass cleanly. */
function goodPayload() {
  return {
    generatedAt: '2026-08-29T06:00:00.000Z',
    futures: {
      arabica: {
        quote: { last: 312.60, previousClose: 309.65, change: 2.95, changePct: 0.953,
                 high: 316.85, low: 308.70 },
        bars: [
          { date: '2026-08-26', open: 305, high: 310, low: 304, close: 308 },
          { date: '2026-08-27', open: 308, high: 312, low: 307, close: 309.65 },
          { date: '2026-08-28', open: 310, high: 316.85, low: 308.70, close: 312.60 },
        ],
        technicals: { rsi14: 48.5, atr14: 13.6, fiftyTwoWeek: { high: 348.55, low: 209.2 } },
      },
    },
    fx: { pairs: { GBPUSD: { rate: 1.3583 }, USDBRL: { rate: 5.1641 } } },
    weather: { regions: [{ name: 'Sul de Minas', lat: -21.55, lon: -45.43 }] },
    news: { dailyRead: { article: { url: 'https://example.org/a' } } },
    ico: {
      indicators: { points: [
        { month: '2026-06', values: { composite: 248.90 } },
        { month: '2026-07', values: { composite: 287.26 } },
      ] },
      certifiedStocks: { points: [{ month: '2026-07', values: { newYork: 0.29 } }] },
    },
  };
}

/** Run the gate and return the single problem it found, asserting there is one. */
function onlyProblem(payload) {
  const problems = validatePayload(payload);
  assert.equal(problems.length, 1, `expected one problem, got ${problems.length}: ${problems}`);
  return problems[0];
}

test('a sound payload passes', () => {
  assert.deepEqual(validatePayload(goodPayload()), []);
});

test('catches a change that does not match the prices beside it', () => {
  // The same-source pairing rule. Mixing two feeds once produced a change with
  // the wrong sign, and nothing about the payload looked wrong at the time.
  //
  // Flipping the sign trips the percentage check too, since that is derived
  // from the change — two problems is the right answer, not one.
  const p = goodPayload();
  p.futures.arabica.quote.change = -2.95;
  const problems = validatePayload(p);
  assert.ok(problems.some(x => /quote\.change is/.test(x)), `not caught: ${problems}`);
});

test('catches a percentage that does not match its own change', () => {
  const p = goodPayload();
  p.futures.arabica.quote.changePct = 12;
  assert.match(onlyProblem(p), /changePct/);
});

test('catches NaN anywhere in the payload, and names where', () => {
  const p = goodPayload();
  p.futures.arabica.technicals.atr14 = NaN;
  const problem = onlyProblem(p);
  assert.match(problem, /NaN/);
  assert.match(problem, /technicals\.atr14/);
});

test('catches Infinity', () => {
  const p = goodPayload();
  p.fx.pairs.GBPUSD.rate = Infinity;
  assert.match(validatePayload(p).join(' '), /Infinity/);
});

test('catches bars that go backwards', () => {
  const p = goodPayload();
  p.futures.arabica.bars[2].date = '2026-08-01';
  assert.match(onlyProblem(p), /does not follow/);
});

test('catches a repeated session', () => {
  const p = goodPayload();
  p.futures.arabica.bars[2].date = p.futures.arabica.bars[1].date;
  assert.match(onlyProblem(p), /does not follow/);
});

test('catches a high below its own low', () => {
  const p = goodPayload();
  p.futures.arabica.bars[1].high = 1;
  assert.match(onlyProblem(p), /high 1 is below low/);
});

test('accepts a close outside the traded range', () => {
  // Not an error for a futures contract: the close is the exchange settlement,
  // struck from a closing period rather than the last print, and it can fall
  // outside the day's traded high and low. About 1.6% of real bars do.
  const p = goodPayload();
  p.futures.arabica.bars[1].close = p.futures.arabica.bars[1].high + 5;
  assert.deepEqual(validatePayload(p), []);
});

test('catches an RSI outside 0-100', () => {
  const p = goodPayload();
  p.futures.arabica.technicals.rsi14 = 140;
  assert.match(onlyProblem(p), /outside 0–100/);
});

test('catches ICO months out of order or repeated', () => {
  const p = goodPayload();
  p.ico.indicators.points[1].month = '2026-05';
  assert.match(onlyProblem(p), /does not follow/);
});

test('catches a weather region stripped of its coordinates', () => {
  // Provenance stays in the payload: lat/lon render nowhere, but they are what
  // let a reader check a figure against the source. CLAUDE.md says not to tidy
  // them away; this is what notices if someone does.
  const p = goodPayload();
  delete p.weather.regions[0].lat;
  assert.match(onlyProblem(p), /lat\/lon/);
});

test('catches a headline with no link to its source', () => {
  const p = goodPayload();
  p.news.roundup = { items: [{ headline: 'Something happened', url: null }] };
  assert.match(onlyProblem(p), /no link to its source/);
});

test('catches a missing or unparseable timestamp', () => {
  const p = goodPayload();
  p.generatedAt = 'not a date';
  assert.match(onlyProblem(p), /generatedAt/);
});

test('a failed source is not a violation', () => {
  // Sources fail all the time; that is handled upstream and shown on the page.
  // The gate is for impossible values, not absent ones.
  const p = goodPayload();
  p.futures.arabica = null;
  p.fx = null;
  p.weather = null;
  p.ico = null;
  assert.deepEqual(validatePayload(p), []);
});
