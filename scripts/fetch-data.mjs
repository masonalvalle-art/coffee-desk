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
import { fetchOriginWire, buildWeeklyRecap, fetchDailyArticle } from './sources/news.mjs';
import {
  fetchIcoReport, mergeHistory, emptyHistory, latestReportMonth, publishable,
} from './sources/ico.mjs';
import { buildTechnicals } from './lib/indicators.mjs';
import { validatePayload } from './lib/validate.mjs';

// The publishing schedule, stated once and published in the payload, so the
// page can work out whether an edition is late without hardcoding the cron a
// second time. It still has to agree with .github/workflows/update-and-deploy.yml
// — there is a comment there pointing back here.
const SCHEDULE = {
  slotsUtc: ['06:00', '18:30'],
  weekdaysOnly: true,
  // GitHub delays scheduled runs under load, routinely by several minutes and
  // occasionally by more. The grace period is what stops the page crying wolf
  // over a queue rather than a fault.
  graceHours: 2,
  note: 'Two runs each weekday, 06:00 and 18:30 UTC. GitHub may delay scheduled runs.',
};

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

  // The ICO report is monthly and this runs twice a weekday, so the fetch is
  // told what we already hold and skips the 1.2MB download when it matches.
  const icoHistory = await readJson(p('data/ico-history.json'), emptyHistory());
  const known = latestReportMonth(icoHistory);

  const [arabica, fx, weather, originWire, roundup, dailyRead, icoReport] = await Promise.all([
    attempt('arabica-futures', fetchArabica),
    attempt('fx', fetchFx),
    attempt('weather', fetchWeather),
    attempt('origin-wire', fetchOriginWire),
    attempt('weekly-recap', buildWeeklyRecap),
    attempt('daily-read', fetchDailyArticle),
    attempt('ico-report', () => fetchIcoReport({ known })),
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

  // Fold a newly parsed report into the accumulated history, then publish the
  // whole series. Each report re-states the months before it, so a figure that
  // has been revised is recorded as a revision rather than quietly replaced.
  let history = icoHistory;
  if (icoReport && !icoReport.skipped) {
    history = mergeHistory(history, icoReport);
    await writeFile(p('data/ico-history.json'), JSON.stringify(history, null, 2) + '\n');
    console.log(`  · ICO ${icoReport.report.label}: merged, ` +
                `${Object.keys(history.months.indicators).length} months on record`);
    if (icoReport.certifiedStocks?.unreadableColumns) {
      console.log(`  · ICO certified stocks: ${icoReport.certifiedStocks.unreadableColumns} ` +
                  'month heading(s) unreadable, those columns dropped');
    }
  } else if (icoReport?.skipped) {
    console.log(`  · ICO ${icoReport.report.label}: already on record, not re-downloaded`);
  }
  const ico = publishable(history);

  // Hand-entered overrides. ICO now covers the base case for both, so these
  // stay empty unless someone deliberately enters a figure from a document
  // they hold. An empty file means "show what ICO published".
  const differentials = await readJson(p('data/manual/differentials.json'), null);
  const certifiedStocks = await readJson(p('data/manual/certified-stocks.json'), null);

  const payload = {
    generatedAt: new Date().toISOString(),
    schema: 5,
    schedule: SCHEDULE,
    futures: { arabica },
    fx,
    weather,
    news: { originWire, roundup, dailyRead },
    ico,
    differentials,
    certifiedStocks,
    status,
  };

  // The last gate. A source that failed is ordinary and already handled; this
  // catches a source that answered with something impossible. Nothing is
  // written on a violation, so the previous edition stays live — yesterday's
  // figures, clearly dated, beat today's wrong ones.
  const problems = validatePayload(payload);
  if (problems.length) {
    console.error(`\nRefusing to publish — ${problems.length} problem(s) with the data:`);
    for (const problem of problems) console.error(`  ! ${problem}`);
    console.error('\ndata/latest.json is unchanged. The site keeps serving the previous edition.');
    process.exit(1);
  }

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
