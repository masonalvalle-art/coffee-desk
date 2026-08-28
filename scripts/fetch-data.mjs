#!/usr/bin/env node
// Orchestrator. Fetches every source, records what succeeded and what didn't,
// and writes data/latest.json for the static front end.
//
// Guiding rule: a number only appears in the output if a source returned it.
// When a source fails we write the failure into `status` and the page renders
// an explicit "unavailable" state. Nothing is estimated, carried forward
// silently, or filled in.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchArabica, fetchRobusta } from './sources/futures.mjs';
import { fetchFx } from './sources/fx.mjs';
import { fetchWeather } from './sources/weather.mjs';
import { fetchNews } from './sources/news.mjs';
import { buildTechnicals } from './lib/indicators.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts) => resolve(ROOT, ...parts);

const status = [];

/** Run a source, capturing failure instead of aborting the whole build. */
async function attempt(name, fn) {
  const t0 = Date.now();
  try {
    const value = await fn();
    status.push({ source: name, ok: true, ms: Date.now() - t0 });
    return value;
  } catch (err) {
    console.error(`  ! ${name} failed: ${err.message}`);
    status.push({ source: name, ok: false, ms: Date.now() - t0, error: err.message });
    return null;
  }
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
}

/**
 * No free source publishes Robusta daily history, so we build our own by
 * appending each day's snapshot. Every bar is stamped with when we recorded it
 * so the series is auditable against the git history of this file.
 */
async function appendRobustaHistory(robusta) {
  const path = p('data/history/robusta.json');
  const store = await readJson(path, { series: {}, note: 'Accumulated from daily ICE Europe snapshots; each bar records when it was captured.' });

  if (robusta?.quote?.last != null) {
    const code = robusta.contract.code;
    const date = new Date().toISOString().slice(0, 10);
    store.series[code] ??= [];
    const series = store.series[code];
    const bar = {
      date,
      open: robusta.quote.open ?? null,
      high: robusta.quote.high ?? null,
      low: robusta.quote.low ?? null,
      close: robusta.quote.last,
      volume: robusta.quote.volume ?? null,
      recordedAt: new Date().toISOString(),
    };
    const existing = series.findIndex(b => b.date === date);
    if (existing >= 0) series[existing] = bar; // intraday re-run overwrites today
    else series.push(bar);
    series.sort((a, b) => a.date.localeCompare(b.date));
  }

  await writeFile(path, JSON.stringify(store, null, 2) + '\n');
  return store;
}

async function main() {
  console.log('Fetching coffee market data…');

  const [arabica, robusta, fx, weather, news] = await Promise.all([
    attempt('arabica-futures', fetchArabica),
    attempt('robusta-futures', fetchRobusta),
    attempt('fx', fetchFx),
    attempt('weather', fetchWeather),
    attempt('news', () => fetchNews({ limit: 5 })),
  ]);

  // Arabica technicals come from Yahoo's per-contract daily history.
  if (arabica?.bars?.length) {
    arabica.technicals = buildTechnicals(arabica.bars);
    arabica.technicals.basis = `${arabica.bars.length} daily bars for ${arabica.contract.code}`;
  }

  // Robusta technicals come from our own accumulated series.
  const rcStore = await appendRobustaHistory(robusta);
  if (robusta) {
    const series = rcStore.series[robusta.contract.code] ?? [];
    robusta.bars = series;
    robusta.technicals = buildTechnicals(series);
    robusta.technicals.basis =
      `${series.length} daily closes recorded since ${series[0]?.date ?? 'n/a'}`;
    robusta.technicals.limited = series.length < 35;
    robusta.historyNote =
      'No free provider publishes Robusta daily history, so this series is built from ' +
      'our own daily snapshots. Indicators activate as the record lengthens.';
  }

  // Manually-maintained blocks. These stay empty until populated -- the page
  // renders an explicit "awaiting a verified source" state rather than a guess.
  const differentials = await readJson(p('data/manual/differentials.json'), null);
  const certifiedStocks = await readJson(p('data/manual/certified-stocks.json'), null);

  const payload = {
    generatedAt: new Date().toISOString(),
    schema: 2,
    futures: { arabica, robusta },
    fx,
    weather,
    news,
    differentials,
    certifiedStocks,
    status,
  };

  await mkdir(p('data'), { recursive: true });
  await writeFile(p('data/latest.json'), JSON.stringify(payload, null, 2) + '\n');

  const ok = status.filter(s => s.ok).length;
  console.log(`\nWrote data/latest.json — ${ok}/${status.length} sources OK`);
  for (const s of status) {
    console.log(`  ${s.ok ? '✓' : '✗'} ${s.source} (${s.ms}ms)${s.error ? ' — ' + s.error : ''}`);
  }

  // Only a total wipeout is a build failure; partial data still ships.
  if (ok === 0) {
    console.error('\nAll sources failed — refusing to publish an empty dashboard.');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
