// The ICO Coffee Market Report.
//
// The International Coffee Organization publishes a monthly report as a PDF.
// It is free, public, and carries two tables this dashboard has been missing
// a source for:
//
//   Table 1  indicator prices — ICO Composite and the four origin groups,
//            plus the New York and London futures averages, 12 months at a time
//   Table 5  certified stocks on the New York and London futures markets
//
// Both fill panels that until now rendered "no verified source".
//
// Table 2 (the spreads between group indicators) was parsed here for a while
// and taken out again as not worth the room it took on the page. If it is ever
// wanted back, note that each report restates the previous thirteen months, so
// re-adding the parse and running once recovers over a year in one download.
//
// WHAT THIS IS NOT. ICO's groups are origin/quality classifications, not
// individual origins — a group indicator is not the FOB price a broker quotes
// against the C contract for a named mark. There is nothing here about
// certification (Fairtrade, Organic, Rainforest); no free feed publishes it.
// The page must not imply otherwise.
//
// Each report repeats the previous eleven or twelve months, which is a gift
// twice over: one download backfills a year of history, and every later report
// re-states months we already hold, so a revision can be spotted rather than
// silently overwritten.

import { getText, getBuffer } from '../lib/http.mjs';
import { contentStreams, textItems, rows, cells, rowText } from '../lib/pdf.mjs';

const INDEX_URL = 'https://ico.org/coffee-market-report/';

// The reports live under a coffee-year folder that rolls every October, so the
// index is scraped rather than the URL guessed. Guessing works for eleven
// months of the year and then quietly stops.
const REPORT_LINK = /href="(https?:\/\/[^"]*\/cmr-(\d{2})(\d{2})-e\.pdf)"/gi;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];

/* ------------------------------------------------------------------ *
 * Table shapes
 * ------------------------------------------------------------------ */

// Headings are matched by their text, not their position, so a reordered
// column is caught rather than silently mislabelled. An unrecognised heading
// is a hard failure: it means the report changed shape and a human should look.
const INDICATOR_SERIES = new Map([
  ['ico composite',      { key: 'composite',         label: 'ICO Composite' }],
  ['colombian milds',    { key: 'colombianMilds',    label: 'Colombian Milds' }],
  ['other milds',        { key: 'otherMilds',        label: 'Other Milds' }],
  ['brazilian naturals', { key: 'brazilianNaturals', label: 'Brazilian Naturals' }],
  ['robustas',           { key: 'robustas',          label: 'Robustas' }],
  ['new york',           { key: 'newYork',           label: 'New York (Arabica futures)' }],
  ['london',             { key: 'london',            label: 'London (Robusta futures)' }],
]);

const STOCK_ROWS = new Map([
  ['new york', { key: 'newYork', label: 'New York' }],
  ['london',   { key: 'london',  label: 'London' }],
]);

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const normalise = (s) => s.toLowerCase().replace(/[*–—−-]/g, ' ').replace(/\s+/g, ' ').trim();

/** "Aug-25" -> { key: '2025-08', label: 'August 2025' }. */
function parseMonth(text) {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1].toLowerCase());
  if (idx < 0) return null;
  const year = 2000 + Number(m[2]);
  return {
    key: `${year}-${String(idx + 1).padStart(2, '0')}`,
    label: `${MONTH_LABELS[idx]} ${year}`,
  };
}

/** A table cell as a number, or null when it is not one. */
function parseNumber(text) {
  if (!text) return null;
  const cleaned = text.replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * Stitch a multi-line column heading back together.
 *
 * "Colombian Milds / Brazilian Naturals" is drawn as four fragments on four
 * lines. They belong to one column because they share an x band; they read in
 * the order they were drawn down the page. Grouping across rows by x and then
 * sorting by descending y recovers the heading; grouping by x alone would
 * interleave two neighbouring headings and produce a pair that does not exist.
 */
function headings(headerRows, { labelColumnEndsAt = 100, bandWidth = 45 } = {}) {
  const fragments = [];
  for (const row of headerRows) {
    for (const cell of cells(row)) {
      if (cell.x < labelColumnEndsAt) continue;   // the row-label column
      fragments.push({ ...cell, y: row.y });
    }
  }

  fragments.sort((a, b) => a.x - b.x);

  const bands = [];
  for (const f of fragments) {
    const band = bands[bands.length - 1];
    if (band && f.x - band.x <= bandWidth) band.parts.push(f);
    else bands.push({ x: f.x, parts: [f] });
  }

  return bands.map(band => ({
    x: band.x,
    text: band.parts.sort((a, b) => b.y - a.y).map(p => p.text).join(' '),
  }));
}

/** The rows of one table: everything from its caption to the next caption. */
function tableAt(allRows, captionPattern) {
  const at = allRows.findIndex(r => captionPattern.test(rowText(r)));
  if (at < 0) return null;
  const rest = allRows.slice(at + 1);
  const end = rest.findIndex(r => /^Table \d+:/.test(rowText(r)));
  return end < 0 ? rest : rest.slice(0, end);
}

/** Find a table across every content stream in the document. */
function findTable(streams, captionPattern, tolerance = 4) {
  for (const stream of streams) {
    const found = tableAt(rows(textItems(stream), tolerance), captionPattern);
    if (found) return found;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Table 1 — months down the side, series across the top
 * ------------------------------------------------------------------ */

function parseMonthlyTable(tableRows, lookup, what) {
  // Data rows are the run of consecutive rows that start with a month. The run
  // matters: Table 1 continues past the prices into a "Volatility (%)" block
  // whose rows ALSO start with a month, and reading those as prices would put
  // a volatility percentage on the page as a price.
  const firstData = tableRows.findIndex(r => parseMonth(cells(r)[0]?.text ?? ''));
  if (firstData < 0) throw new Error(`${what}: no month-labelled rows found`);

  const headerRows = tableRows.slice(0, firstData);
  const columns = headings(headerRows);
  if (!columns.length) throw new Error(`${what}: no column headings found`);

  const series = columns.map(col => {
    const hit = lookup.get(normalise(col.text));
    if (!hit) throw new Error(`${what}: unrecognised column heading "${col.text}"`);
    return hit;
  });

  const months = [];
  for (const row of tableRows.slice(firstData)) {
    const cs = cells(row);
    const month = parseMonth(cs[0]?.text ?? '');
    if (!month) break;                                  // end of the price block

    const values = cs.slice(1);
    if (values.length !== series.length) {
      throw new Error(`${what}: ${month.key} has ${values.length} values for ${series.length} columns`);
    }

    const record = { month: month.key, label: month.label, values: {} };
    values.forEach((cell, i) => {
      const n = parseNumber(cell.text);
      // Anything that is not a plain number here — a percentage, a footnote
      // mark — means the table is not shaped the way this parser assumes.
      // Fail the whole report rather than publish the cells that did parse.
      if (n === null) throw new Error(`${what}: ${month.key} ${series[i].key} is not a number ("${cell.text}")`);
      record.values[series[i].key] = n;
    });
    months.push(record);
  }

  if (!months.length) throw new Error(`${what}: no data rows parsed`);
  return { series, months };
}

/* ------------------------------------------------------------------ *
 * Table 5 — months across the top, markets down the side
 * ------------------------------------------------------------------ */

function parseCertifiedStocks(tableRows) {
  const what = 'certified stocks';
  const headerRow = tableRows[0];
  if (!headerRow) throw new Error(`${what}: no header row`);

  // Two or three of the month headings are drawn in a subset font with no
  // /ToUnicode map, so their bytes are glyph ids rather than characters. Those
  // columns are dropped and reported. The obvious "fix" — taking the month
  // sequence from Table 1, or counting along from a readable neighbour — is
  // inference, and this project does not infer. A missing month is shown as
  // missing.
  const columns = [];
  const unreadable = [];
  for (const cell of cells(headerRow)) {
    const month = cell.unmappable ? null : parseMonth(cell.text);
    if (month) columns.push({ x: cell.x, month });
    else unreadable.push(cell.x);
  }
  if (!columns.length) throw new Error(`${what}: no readable month headings`);

  const byMonth = new Map();
  const seriesSeen = [];

  for (const row of tableRows.slice(1)) {
    const cs = cells(row);
    const hit = STOCK_ROWS.get(normalise(cs[0]?.text ?? ''));
    if (!hit) continue;
    seriesSeen.push(hit);

    for (const cell of cs.slice(1)) {
      const value = parseNumber(cell.text);
      if (value === null) continue;

      // Headings are centred over right-aligned figures, so a heading sits a
      // few points to the left of its column. Nearest wins, within a window
      // narrower than the column pitch.
      let best = null;
      let bestGap = Infinity;
      for (const col of columns) {
        const gap = Math.abs(col.x - cell.x);
        if (gap < bestGap) { bestGap = gap; best = col; }
      }
      if (!best || bestGap > 20) continue;               // an unreadable column

      const entry = byMonth.get(best.month.key) ?? { month: best.month.key, label: best.month.label, values: {} };
      entry.values[hit.key] = value;
      byMonth.set(best.month.key, entry);
    }
  }

  if (!seriesSeen.length) throw new Error(`${what}: neither New York nor London row found`);

  return {
    series: seriesSeen,
    months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    unreadableColumns: unreadable.length,
  };
}

/* ------------------------------------------------------------------ *
 * Fetch
 * ------------------------------------------------------------------ */

/** The newest report linked from the ICO index page. */
export async function discoverLatestReport() {
  const html = await getText(INDEX_URL, { timeout: 25000, retries: 1 });

  const found = [];
  for (const m of html.matchAll(REPORT_LINK)) {
    const month = Number(m[2]);
    const year = 2000 + Number(m[3]);
    if (month < 1 || month > 12) continue;
    found.push({
      // The index links over plain http; both work, and https is the one to use.
      url: m[1].replace(/^http:/, 'https:'),
      month: `${year}-${String(month).padStart(2, '0')}`,
      label: `${MONTH_LABELS[month - 1]} ${year}`,
    });
  }

  if (!found.length) throw new Error('no coffee market report links found on the ICO index');
  found.sort((a, b) => b.month.localeCompare(a.month));
  return found[0];
}

/**
 * Fetch and parse the newest report.
 *
 * `known` is the report month already stored. The pipeline runs twice a
 * weekday against a document published once a month, so re-downloading a 1.2MB
 * PDF every run would be rude to ICO and pointless for us.
 */
export async function fetchIcoReport({ known = null } = {}) {
  const report = await discoverLatestReport();

  if (known && known === report.month) {
    return { report, skipped: true };
  }

  const buf = await getBuffer(report.url, { timeout: 60000, retries: 1 });
  return parseReport(buf, report);
}

/**
 * Parse a report that has already been downloaded.
 *
 * Kept separate from the fetch so the parser can be exercised against a file
 * on disk — including a deliberately truncated one, which is the case that
 * matters: a half-read table must fail outright rather than publish the rows
 * it managed to reach.
 */
export function parseReport(buf, report) {
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error(`${report?.url ?? 'input'} is not a PDF`);
  }

  const streams = contentStreams(buf);
  if (!streams.length) throw new Error('no readable content streams in the report');

  const indicatorRows = findTable(streams, /^Table 1:\s*ICO daily indicator prices/i);
  if (!indicatorRows) throw new Error('Table 1 (indicator prices) not found');

  const stockRows = findTable(streams, /^Table 5:\s*Certified stocks/i);
  if (!stockRows) throw new Error('Table 5 (certified stocks) not found');

  const indicators = parseMonthlyTable(indicatorRows, INDICATOR_SERIES, 'indicator prices');
  const certifiedStocks = parseCertifiedStocks(stockRows);

  return {
    report,
    skipped: false,
    fetchedAt: new Date().toISOString(),
    indicators: { unit: 'US cents/lb', ...indicators },
    certifiedStocks: { unit: 'million 60-kg bags', ...certifiedStocks },
  };
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export function emptyHistory() {
  return {
    updatedAt: null,
    reports: [],
    series: { indicators: [], certifiedStocks: [] },
    months: { indicators: {}, certifiedStocks: {} },
    revisions: [],
  };
}

/**
 * Fold a report into the accumulated history.
 *
 * Every report re-states the months before it. Where a re-stated figure
 * differs from the one we hold, ICO has revised it: the new value is taken and
 * the change recorded, so the audit trail shows the revision rather than the
 * number appearing to have always been that.
 */
const HISTORY_TABLES = ['indicators', 'certifiedStocks'];

export function mergeHistory(history, parsed) {
  const out = history ?? emptyHistory();
  for (const table of HISTORY_TABLES) {
    out.months[table] ??= {};
    out.series[table] ??= [];
  }
  out.revisions ??= [];
  out.reports ??= [];

  for (const table of HISTORY_TABLES) {
    const block = parsed[table];
    if (!block) continue;

    // Keep the series list current, in the order the report gives them.
    out.series[table] = block.series.map(s => ({ key: s.key, label: s.label }));

    for (const record of block.months) {
      const held = out.months[table][record.month];
      if (!held) {
        out.months[table][record.month] = { label: record.label, values: { ...record.values } };
        continue;
      }

      for (const [key, value] of Object.entries(record.values)) {
        const was = held.values[key];
        if (was !== undefined && was !== value) {
          out.revisions.push({
            table, month: record.month, series: key,
            was, now: value, seenIn: parsed.report.month,
          });
        }
        held.values[key] = value;
      }
    }
  }

  if (!out.reports.some(r => r.month === parsed.report.month)) {
    out.reports.push({
      month: parsed.report.month,
      label: parsed.report.label,
      url: parsed.report.url,
      fetchedAt: parsed.fetchedAt,
    });
    out.reports.sort((a, b) => a.month.localeCompare(b.month));
  }

  out.updatedAt = new Date().toISOString();
  return out;
}

/** The latest report on record, so a run can decide whether to download. */
export function latestReportMonth(history) {
  const reports = history?.reports ?? [];
  return reports.length ? reports[reports.length - 1].month : null;
}

/**
 * Reshape the history for the page: series lists plus month-ordered points.
 * The page reads only data/latest.json, so this goes in the payload rather
 * than being fetched separately.
 */
export function publishable(history) {
  if (!history || !history.reports?.length) return null;

  const table = (name) => {
    const months = Object.keys(history.months[name] ?? {}).sort();
    return {
      series: history.series[name] ?? [],
      points: months.map(month => ({
        month,
        label: history.months[name][month].label,
        values: history.months[name][month].values,
      })),
    };
  };

  const newest = history.reports[history.reports.length - 1];
  return {
    source: 'International Coffee Organization',
    sourceUrl: INDEX_URL,
    report: newest,
    unit: 'US cents/lb',
    stocksUnit: 'million 60-kg bags',
    indicators: table('indicators'),
    certifiedStocks: table('certifiedStocks'),
    revisions: history.revisions?.slice(-20) ?? [],
    note: 'ICO publishes origin and quality groups, not individual origins or marks. A group ' +
          'indicator is not the FOB price quoted against the C contract for a named lot, and ' +
          'no certification breakdown is published.',
  };
}
