// The news desk, in three parts:
//
//   1. Origin wire   — general headlines from the growing regions, taken from
//                      top-tier general press. Not coffee-specific: what a
//                      buyer wants here is whether the country is on fire,
//                      striking, flooding or changing government.
//   2. Weekly recap  — the headlines out of Perfect Daily Grind's Friday
//                      coffee news round-up.
//   3. Today's read  — a single Daily Coffee News article.
//
// Aggregator feeds (Google News and similar) are deliberately not used: their
// licences restrict them to personal, non-commercial feed-reader use, which a
// public dashboard is not. Everything here is a publisher's own feed.

import { getText, mapLimit } from '../lib/http.mjs';

/* ------------------------------------------------------------------ *
 * 1. Origin wire
 * ------------------------------------------------------------------ */

// Broad feeds from outlets of record. Individual country feeds (the Guardian
// publishes them) are included where they carry enough traffic to be useful,
// but the per-country feeds go stale — Guardian Vietnam can run a month
// between stories — so the broad regional feeds do most of the work and items
// are tagged to a region by what they actually mention.
export const WIRE_FEEDS = [
  { name: 'BBC News',        section: 'Latin America', url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml' },
  { name: 'BBC News',        section: 'Africa',        url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml' },
  { name: 'BBC News',        section: 'Asia',          url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml' },
  { name: 'The Guardian',    section: 'Americas',      url: 'https://www.theguardian.com/world/americas/rss' },
  { name: 'The Guardian',    section: 'Africa',        url: 'https://www.theguardian.com/world/africa/rss' },
  { name: 'The Guardian',    section: 'Brazil',        url: 'https://www.theguardian.com/world/brazil/rss' },
  { name: 'The Guardian',    section: 'Colombia',      url: 'https://www.theguardian.com/world/colombia/rss' },
  { name: 'The Guardian',    section: 'Indonesia',     url: 'https://www.theguardian.com/world/indonesia/rss' },
  { name: 'The Guardian',    section: 'Vietnam',       url: 'https://www.theguardian.com/world/vietnam/rss' },
  { name: 'The Guardian',    section: 'Ethiopia',      url: 'https://www.theguardian.com/world/ethiopia/rss' },
  { name: 'Financial Times', section: 'World',         url: 'https://www.ft.com/world?format=rss' },
  { name: 'Al Jazeera',      section: 'All',           url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  // Vietnam is invisible in the international press for weeks at a time — the
  // Guardian's Vietnam feed can run over a month between stories, and neither
  // BBC Asia nor Al Jazeera matched a single Vietnamese item on testing. This
  // is the country's largest English-language daily, and without it the
  // largest robusta origin simply never appears on the wire.
  { name: 'VnExpress International', section: 'News',     url: 'https://e.vnexpress.net/rss/news.rss' },
  { name: 'VnExpress International', section: 'Business', url: 'https://e.vnexpress.net/rss/business.rss' },
];

// A story is placed in the first region whose terms it matches. Order matters:
// the specific origins are tested before the catch-all Latin America group so
// a Brazil story is filed under Brazil, not "South & Central America".
export const WIRE_REGIONS = [
  { key: 'brazil',    label: 'Brazil',
    match: /\b(brazil|brazilian|bras[ií]lia|s[aã]o paulo|rio de janeiro|minas gerais|lula|bolsonaro)\b/i },
  { key: 'vietnam',   label: 'Vietnam',
    match: /\b(vietnam|vietnamese|hanoi|ho chi minh|da nang|mekong|dak lak)\b/i },
  { key: 'indonesia', label: 'Indonesia',
    match: /\b(indonesia|indonesian|jakarta|sumatra|sulawesi|java|bali|prabowo)\b/i },
  { key: 'colombia',  label: 'Colombia',
    match: /\b(colombia|colombian|bogot[aá]|medell[ií]n|cali|huila|petro)\b/i },
  { key: 'latam',     label: 'South & Central America',
    match: /\b(peru|peruvian|chile|chilean|argentin\w*|bolivia\w*|ecuador\w*|venezuela\w*|uruguay\w*|paraguay\w*|guatemala\w*|honduras|honduran|nicaragua\w*|costa rica\w*|panama\w*|el salvador|salvadoran|mexic\w*|latin america\w*)\b/i },
  { key: 'eastafrica', label: 'East Africa',
    match: /\b(ethiopia\w*|kenya\w*|uganda\w*|tanzania\w*|rwanda\w*|burundi\w*|somalia\w*|somaliland|south sudan|eritrea\w*|djibouti|addis ababa|nairobi|kampala)\b/i },
];

// Three weeks, not one. The growing regions are not covered daily by the
// international press: on testing, the Guardian's newest Brazil story was
// seven days old and its newest Vietnam story thirty-nine. A one-week window
// silently emptied the two most important origins off the wire. Every item
// carries its date so the reader can see what is fresh and what is not.
export async function fetchOriginWire({ limit = 14, lookbackHours = 504 } = {}) {
  const results = await mapLimit(WIRE_FEEDS, 4, async (feed) => {
    const xml = await getText(feed.url, { timeout: 20000, retries: 1 });
    return parseFeed(xml).map(item => ({ ...item, feed }));
  });

  const errors = [];
  const items = [];
  results.forEach((r, i) => {
    if (!r || r.__error) {
      errors.push({ feed: `${WIRE_FEEDS[i].name} / ${WIRE_FEEDS[i].section}`, error: r?.__error ?? 'unknown' });
      return;
    }
    items.push(...r);
  });

  const cutoff = Date.now() - lookbackHours * 3600 * 1000;
  const seen = new Set();
  const tagged = [];

  for (const it of items) {
    const hay = `${it.title} ${it.summary}`;
    const region = WIRE_REGIONS.find(r => r.match.test(hay));
    if (!region) continue;

    const ts = it.published ? Date.parse(it.published) : NaN;
    if (Number.isFinite(ts) && ts < cutoff) continue;

    const key = normalise(it.title);
    if (seen.has(key)) continue;
    seen.add(key);

    tagged.push({
      title: it.title,
      // The publisher's own standfirst. Carried through so the wire can show a
      // headline with its summary rather than a headline alone; it was already
      // being parsed for the region match above and then thrown away.
      summary: it.summary || null,
      url: it.link,
      publisher: it.feed.name,
      region: region.label,
      regionKey: region.key,
      published: it.published ?? null,
      ts: Number.isFinite(ts) ? ts : 0,
    });
  }

  // Newest first, then interleave regions so the slider does not run six
  // Brazil stories in a row when Brazil has had a busy week.
  tagged.sort((a, b) => b.ts - a.ts);
  const byRegion = new Map();
  for (const t of tagged) {
    if (!byRegion.has(t.regionKey)) byRegion.set(t.regionKey, []);
    byRegion.get(t.regionKey).push(t);
  }
  const interleaved = [];
  let added = true;
  while (added && interleaved.length < limit) {
    added = false;
    for (const r of WIRE_REGIONS) {
      const bucket = byRegion.get(r.key);
      if (bucket && bucket.length) {
        interleaved.push(bucket.shift());
        added = true;
        if (interleaved.length >= limit) break;
      }
    }
  }

  const counts = {};
  for (const r of WIRE_REGIONS) counts[r.label] = (byRegion.get(r.key)?.length ?? 0);
  for (const t of interleaved) counts[t.region] = (counts[t.region] ?? 0) + 1;

  return {
    fetchedAt: new Date().toISOString(),
    lookbackHours,
    headlines: interleaved.map(({ ts, ...rest }) => rest),
    totalTagged: tagged.length,
    feedsQueried: WIRE_FEEDS.length,
    byRegion: counts,
    errors,
    note: 'General headlines from the growing regions, taken from outlets of record and ' +
          'tagged to a region by the countries and cities they name.',
  };
}

/* ------------------------------------------------------------------ *
 * 2. Perfect Daily Grind weekly recap
 * ------------------------------------------------------------------ */

const PDG_ARCHIVE = 'https://perfectdailygrind.com/category/weekly-round-up/';

/**
 * PDG publishes a Friday round-up whose body is a list of dated one-line
 * headlines, each linking to the original source.
 *
 * Their WAF rejects non-browser clients outright (a 403 on every path,
 * including the RSS feed and the sitemap, regardless of headers), so this may
 * well fail from a CI runner. It is attempted anyway — the block is on client
 * fingerprint rather than address, so a different HTTP stack may get through —
 * and when it fails the caller falls back to data/manual/pdg-roundup.json.
 */
export async function fetchRoundup() {
  const archive = await getText(PDG_ARCHIVE, {
    timeout: 25000,
    retries: 1,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  // Newest recap link on the archive page.
  const links = [...archive.matchAll(/href="(https:\/\/perfectdailygrind\.com\/\d{4}\/\d{2}\/coffee-news-recap-[^"]+)"/g)]
    .map(m => m[1]);
  if (!links.length) throw new Error('no recap link found on the PDG archive page');

  const articleUrl = links[0];
  const html = await getText(articleUrl, { timeout: 25000, retries: 1 });
  const items = parseRoundup(html);
  if (!items.length) throw new Error('recap fetched but no headlines parsed');

  const titleMatch = html.match(/<title>(.*?)<\/title>/is);
  return {
    source: 'fetched',
    articleUrl,
    title: titleMatch ? decodeEntities(titleMatch[1]).replace(/\s*-\s*Perfect Daily Grind\s*$/i, '').trim() : null,
    fetchedAt: new Date().toISOString(),
    items,
  };
}

/**
 * Pull the dated headline lines out of a recap article.
 * Each is a <strong> reading "Mon, 24 Aug – Headline", usually wrapped in or
 * beside the link to the original story. Exported so the same parser can be
 * used on a manually captured copy.
 */
export function parseRoundup(html) {
  const items = [];
  const seen = new Set();

  // Work through the article in blocks so a preceding <h3> gives the section.
  let section = null;
  const tokens = html.split(/(<h3[\s>][\s\S]*?<\/h3>)/i);
  for (const token of tokens) {
    const h3 = token.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (h3) {
      section = clean(h3[1]);
      continue;
    }

    // Scope each headline to its own list item or paragraph. A character
    // window around the <strong> is not good enough: it reaches into the
    // neighbouring entry and picks up the previous story's link.
    const blocks = token.match(/<li[\s>][\s\S]*?<\/li>|<p[\s>][\s\S]*?<\/p>/gi) ?? [];
    for (const block of blocks) {
      const s = block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
      if (!s) continue;
      const text = clean(s[1]);
      const m = text.match(/^([A-Z][a-z]{2},\s*\d{1,2}\s+[A-Z][a-z]{2})\s*[–—-]\s*(.+)$/);
      if (!m) continue;
      const headline = m[2].trim();
      if (seen.has(headline)) continue;
      seen.add(headline);

      const hrefs = [...block.matchAll(/href="(https?:\/\/[^"]+)"/g)]
        .map(x => x[1])
        .filter(h => !/perfectdailygrind\.com/.test(h));
      items.push({
        section: section || null,
        date: m[1],
        headline,
        url: hrefs.length ? hrefs[0] : null,
      });
    }
  }
  return items;
}

/* ------------------------------------------------------------------ *
 * 3. Today's read — one Daily Coffee News article
 * ------------------------------------------------------------------ */

const DCN_FEED = 'https://dailycoffeenews.com/feed/';

// What makes a story worth a buyer's single click: the physical trade, not
// the café counter.
const TRADE_SIGNAL = [
  [/\b(futures?|prices?|market|exchange)\b/i, 5],
  [/\b(harvests?|crops?|yields?|production|planting)\b/i, 5],
  [/\b(exports?|imports?|shipments?|supply|stocks?|inventor(y|ies))\b/i, 5],
  [/\b(drought|frost|rainfall|weather|climate|el ni[nñ]o|la ni[nñ]a)\b/i, 4],
  [/\b(tariffs?|dut(y|ies)|EUDR|deforestation|regulation)\b/i, 4],
  [/\b(farmers?|growers?|producers?|cooperatives?|smallholders?)\b/i, 3],
  [/\b(brazil|vietnam|colombia|indonesia|ethiopia|honduras|uganda|peru)\b/i, 3],
  [/\b(green coffee|auctions?|microlots?|origins?)\b/i, 3],
];
const TRADE_NOISE = [
  [/\b(franchises?|outlets?|chains?|drive.?thru)\b/i, -6],
  [/\b(baristas?|latte|menus?|matcha|baker(y|ies)|eatery)\b/i, -5],
  [/\b(appoints?|hire[sd]?|CMO|chief \w+ officer|promoted)\b/i, -5],
  [/\b(raises? \$|funding|equity|investors?)\b/i, -4],
];

export async function fetchDailyArticle({ lookbackHours = 168 } = {}) {
  const xml = await getText(DCN_FEED, { timeout: 20000, retries: 1 });
  const items = parseFeed(xml);
  if (!items.length) throw new Error('Daily Coffee News feed returned no items');

  const cutoff = Date.now() - lookbackHours * 3600 * 1000;
  let best = null;

  for (const it of items) {
    const ts = it.published ? Date.parse(it.published) : NaN;
    if (Number.isFinite(ts) && ts < cutoff) continue;
    const hay = `${it.title} ${it.summary}`;
    let score = 0;
    for (const [re, w] of TRADE_SIGNAL) if (re.test(hay)) score += w;
    for (const [re, w] of TRADE_NOISE) if (re.test(hay)) score += w;
    const ageHours = Number.isFinite(ts) ? (Date.now() - ts) / 3600000 : lookbackHours;
    score += Math.max(0, 4 - ageHours / 24);
    if (!best || score > best.score) {
      best = {
        title: it.title,
        summary: it.summary || null,
        url: it.link,
        publisher: 'Daily Coffee News',
        published: it.published ?? null,
        score: +score.toFixed(2),
      };
    }
  }

  if (!best) throw new Error('no Daily Coffee News article inside the lookback window');
  return { fetchedAt: new Date().toISOString(), article: best, considered: items.length };
}

/* ------------------------------------------------------------------ *
 * Shared feed parsing
 * ------------------------------------------------------------------ */

/** Minimal RSS 2.0 + Atom parser. No dependencies by design. */
export function parseFeed(xml) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/g) ?? [];
  for (const b of blocks) {
    const title = clean(tag(b, 'title'));
    if (!title) continue;
    let link = tag(b, 'link');
    if (!link) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      link = m ? m[1] : null;
    }
    const summary = clean(tag(b, 'description') ?? tag(b, 'summary') ?? tag(b, 'content'));
    const published = tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated');
    out.push({
      title,
      link: link ? link.trim() : null,
      summary: summary ? truncate(summary, 260) : '',
      published: published ? published.trim() : null,
    });
  }
  return out.filter(x => x.link);
}

function tag(block, name) {
  // dotAll ('s') rather than a [\s\S] class: the class needs backslash
  // escaping inside a template literal, which is easy to get subtly wrong.
  const re = new RegExp('<' + name + '[^>]*>(.*?)</' + name + '>', 'is');
  const m = block.match(re);
  return m ? m[1] : null;
}

function clean(s) {
  if (!s) return '';
  // Strip, decode, strip again. Some feeds (the Guardian among them) escape
  // their markup, so a single strip-then-decode pass turns &lt;p&gt; into a
  // visible <p> in the output. The second pass removes whatever the decode
  // revealed.
  const stripped = s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')   // unwrap CDATA
    .replace(/<[^>]+>/g, ' ');                       // strip markup
  return decodeEntities(stripped)
    .replace(/<[^>]+>/g, ' ')                        // markup revealed by decoding
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, k) => named[k] ?? _)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function truncate(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…';
}

const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
