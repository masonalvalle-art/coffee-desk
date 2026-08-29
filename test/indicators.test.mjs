// Indicator maths.
//
// Node's own test runner, so this adds no dependency and nothing to audit —
// the same rule the pipeline follows. Run with `node --test test/`.
//
// The README says the RSI was checked against Wilder's worked example in
// New Concepts in Technical Trading Systems. That was a one-off check by hand
// and nothing has protected it since. These tests cannot reproduce the book,
// but they pin the properties the formula must have, and one golden value, so
// a future change cannot quietly move the number.

import test from 'node:test';
import assert from 'node:assert/strict';

import { sma, rsi, macd, atr, pivots, donchian } from '../scripts/lib/indicators.mjs';

const closes = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

test('sma averages the last N values', () => {
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3);
  assert.equal(sma([10, 20, 30], 2), 25);
});

test('sma returns null when there is not enough history', () => {
  assert.equal(sma([1, 2], 5), null);
});

test('rsi is 100 for an unbroken advance', () => {
  // No down days at all: average loss is zero, and the formula tends to 100.
  assert.equal(rsi(closes(40, i => 100 + i), 14), 100);
});

test('rsi is 0 for an unbroken decline', () => {
  assert.equal(rsi(closes(40, i => 200 - i), 14), 0);
});

test('rsi stays inside 0-100 on a noisy series', () => {
  // Deterministic pseudo-noise: a test that fails only sometimes is worse
  // than no test.
  const series = closes(120, i => 150 + Math.sin(i * 1.7) * 12 + Math.sin(i * 0.31) * 5);
  const value = rsi(series, 14);
  assert.ok(value >= 0 && value <= 100, `rsi ${value} outside 0-100`);
});

test('rsi holds its value on a fixed series', () => {
  // A golden value. Not authority on correctness — the properties above and
  // the original hand-check against Wilder are that — but it fails loudly if
  // the smoothing is ever changed by accident.
  const series = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
    45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00,
    46.03, 46.41, 46.22, 45.64,
  ];
  const value = rsi(series, 14);
  assert.ok(Math.abs(value - 57.915) < 0.001, `rsi drifted to ${value}, expected 57.915`);
});

test('rsi returns null without enough bars', () => {
  assert.equal(rsi([1, 2, 3], 14), null);
});

test('macd histogram is line minus signal', () => {
  const series = closes(120, i => 100 + Math.sin(i / 6) * 10 + i * 0.2);
  const m = macd(series);
  assert.ok(m, 'macd returned null on a long enough series');
  assert.ok(Math.abs((m.line - m.signal) - m.histogram) < 1e-9);
});

test('atr is never negative', () => {
  const bars = closes(60, i => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    high: 105 + Math.sin(i) * 3,
    low: 95 + Math.sin(i) * 3,
    close: 100 + Math.sin(i) * 3,
  }));
  const value = atr(bars, 14);
  assert.ok(value >= 0, `atr ${value} is negative`);
});

test('donchian brackets the series it is given', () => {
  const bars = closes(40, i => ({ date: `d${i}`, high: 100 + i, low: 50 + i, close: 75 + i }));
  const d = donchian(bars, 20);
  assert.ok(d.high >= d.low);
  // The last 20 bars are indices 20..39, so the high is 100+39 and the low 50+20.
  assert.equal(d.high, 139);
  assert.equal(d.low, 70);
});

test('pivots finds a swing high and does not invent levels', () => {
  // One clean peak, rising then falling, so there are no ties for the window
  // to be ambiguous about. A flat series makes every bar a pivot by the
  // <= comparison, which is correct but useless as a fixture.
  const bars = closes(31, i => {
    const high = 100 + (15 - Math.abs(i - 15));
    return { date: `d${i}`, high, low: high - 10, close: high - 5 };
  });
  const p = pivots(bars, 5, 3);
  assert.equal(p.resistance.length, 1, 'expected exactly one swing high');
  assert.equal(p.resistance[0].price, 115);
  assert.equal(p.resistance[0].date, 'd15');
  // Every level must carry the date it was set, or a reader cannot check it.
  for (const level of [...p.resistance, ...p.support]) {
    assert.ok(level.date, 'a level was returned with no date');
    assert.ok(Number.isFinite(level.price), 'a level was returned with no price');
  }
});

test('pivots returns only levels the price has not already passed', () => {
  // Levels are drawn as support below and resistance above. A "resistance"
  // under the current price would be drawn on the wrong side of the chart.
  const bars = closes(31, i => {
    const high = 100 + (15 - Math.abs(i - 15));
    return { date: `d${i}`, high, low: high - 10, close: high - 5 };
  });
  const last = bars[bars.length - 1].close;
  const p = pivots(bars, 5, 3);
  for (const r of p.resistance) assert.ok(r.price > last, `resistance ${r.price} is below ${last}`);
  for (const s of p.support) assert.ok(s.price < last, `support ${s.price} is above ${last}`);
});
