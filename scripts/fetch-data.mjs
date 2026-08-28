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

import { fetchArabica } from './sources/futures.mjs';
import { fetchFx } from './sources/fx.mjs';
import { fetchWeather } from './sources/weather.mjs';
import { fetchOriginWire, fetchRoundup, fetchDailyArticle } from './sources/news.mjs';
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

async function main() {
  console.log('Fetching coffee market data…');

  const [arabica, fx, weather, originWire, roundupFetched, dailyRead] = await Promise.all([
    attempt('arabica-futures', fetchArabica),
    attempt('fx', fetchFx),
    attempt('weather', fetchWeather),
    attempt('origin-wire', () => fetchOriginWire({ limit: 24 })),
    attempt('pdg-roundup', fetchRoundup),
    attempt('daily-read', fetchDailyArticle),
  ]);

  // Technicals come from Yahoo's per-contract daily history. Indicators are
  // computed on the FULL series (the 200-day mean needs it), then the bars are
  // trimmed before publishing, because this file is committed twice a day and
  // shipping two years of bars was pure weight.
  //
  // The longest chart window is 260 sessions, and the chart's own 50-day mean
  // needs 49 bars of run-up before that window starts — so publish 260 + a
  // 60-bar shoulder. Without it the moving averages begin partway into the
  // 1Y view while spanning the whole of every shorter one.
  const PUBLISHED_BARS = 320;
  if (arabica?.bars?.length) {
    const full = arabica.bars;
    arabica.technicals = buildTechnicals(full);
    arabica.technicals.basis = `${full.length} daily bars for ${arabica.contract.code}`;
    arabica.bars = full.slice(-PUBLISHED_BARS);
    arabica.barsPublished = arabica.bars.length;
    arabica.barsAnalysed = full.length;
  }

  // Manually-maintained blocks. These stay empty until populated -- the page
  // renders an explicit "awaiting a verified source" state rather than a guess.
  const differentials = await readJson(p('data/manual/differentials.json'), null);
  const certifiedStocks = await readJson(p('data/manual/certified-stocks.json'), null);

  // Perfect Daily Grind blocks non-browser clients, so the live fetch is
  // expected to fail from CI. Fall back to the manually captured copy, and
  // label which one the page is showing so the reader is never misled about
  // how fresh it is.
  let roundup = roundupFetched;
  if (!roundup) {
    const manual = await readJson(p('data/manual/pdg-roundup.json'), null);
    if (manual && manual.items?.length) {
      roundup = { ...manual, source: 'manual' };
      console.log('  · PDG round-up: live fetch blocked, using the manually captured copy');
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    schema: 3,
    futures: { arabica },
    fx,
    weather,
    news: { originWire, roundup, dailyRead },
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
