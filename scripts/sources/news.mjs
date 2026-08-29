// The news desk, in three parts:
//
//   1. Origin wire   — general headlines from the growing regions, taken from
//                      top-tier general press. Not coffee-specific: what a
//                      buyer wants here is whether the country is on fire,
//                      striking, flooding or changing government.
//   2. Weekly recap  — the week's coffee trade headlines, assembled here from
//                      the trade press and ranked by relevance to a buyer.
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

  return {
    fetchedAt: new Date().toISOString(),
    lookbackHours,
    // ts and regionKey are working fields for sorting and interleaving; the
    // page reads neither, so they do not go into the committed file.
    headlines: interleaved.map(({ ts, regionKey, ...rest }) => rest),
    totalTagged: tagged.length,
    feedsQueried: WIRE_FEEDS.length,
    // Kept even though nothing renders it: this is the only record of which
    // feed failed on a run where the wire comes back thin. Empty on a good day.
    errors,
    note: 'General headlines from the growing regions, taken from outlets of record and ' +
          'tagged to a region by the countries and cities they name.',
  };
}

/* ------------------------------------------------------------------ *
 * 2. The week in coffee
 * ------------------------------------------------------------------ */

// This used to read Perfect Daily Grind's Friday round-up, which meant a
// person updating a JSON file by hand every week: PDG's WAF blocks automated
// clients on TLS fingerprint, so it answers a browser and refuses everything
// a CI runner can offer. See CLAUDE.md for what was tested.
//
// The recap is now assembled here from the coffee trade press that does
// publish a usable feed. Each publisher's own feed, no aggregators — the same
// rule the origin wire follows, and for the same licensing reason.
export const WEEKLY_FEEDS = [
  { name: 'Daily Coffee News',              url: 'https://dailycoffeenews.com/feed/' },
  { name: 'Fresh Cup',                      url: 'https://freshcup.com/feed/' },
  { name: 'Specialty Coffee Association',   url: 'https://sca.coffee/sca-news?format=rss' },
  { name: 'World Coffee Portal',            url: 'https://worldcoffeeportal.com/rss' },
  { name: 'Sprudge',                        url: 'https://sprudge.com/feed' },
];

// The sections the page groups under. "Top stories" is the highest-scoring
// handful; the rest split on whether the story is about the physical trade or
// the counter, which is the distinction a buyer actually cares about.
const RECAP_TOP = 'Top stories of the week';
const RECAP_TRADE = 'Trade & production';
const RECAP_OTHER = 'Roasting & retail';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri, 28 Aug" — the form the recap has always shown. */
function shortDate(ts) {
  const d = new Date(ts);
  return `${DAY_NAMES[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

/**
 * Assemble the week's coffee headlines from the trade press.
 *
 * Seven days, deduplicated across publishers, ranked with the same trade
 * relevance scoring that picks Today's Read — a buyer's week is defined by
 * harvests, shipments and prices, not by café openings.
 *
 * A failing feed is recorded and skipped, not fatal: four publishers still
 * make a recap. Only a total wipeout throws.
 */
export async function buildWeeklyRecap({
  lookbackHours = 168, limit = 20, topStories = 6, otherLimit = 5,
} = {}) {
  const results = await mapLimit(WEEKLY_FEEDS, 3, async (feed) => {
    const xml = await getText(feed.url, { timeout: 20000, retries: 1 });
    return parseFeed(xml).map(item => ({ ...item, feed }));
  });

  const errors = [];
  const items = [];
  results.forEach((r, i) => {
    if (!r || r.__error) {
      errors.push({ feed: WEEKLY_FEEDS[i].name, error: r?.__error ?? 'unknown' });
      return;
    }
    items.push(...r);
  });

  if (!items.length) throw new Error('no weekly feed returned any items');

  const cutoff = Date.now() - lookbackHours * 3600 * 1000;
  const seen = new Set();
  const scored = [];

  for (const it of items) {
    const ts = it.published ? Date.parse(it.published) : NaN;
    // An item with no date cannot be placed inside the week, and a recap that
    // silently carries undated stories is how a month-old headline ends up
    // presented as this week's news.
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    const key = normalise(it.title);
    if (seen.has(key)) continue;
    seen.add(key);

    const hay = `${it.title} ${it.summary}`;
    let score = 0;
    for (const [re, w] of TRADE_SIGNAL) if (re.test(hay)) score += w;
    for (const [re, w] of TRADE_NOISE) if (re.test(hay)) score += w;

    scored.push({
      headline: it.title,
      summary: it.summary || null,
      url: it.link,
      publisher: it.feed.name,
      published: it.published,
      date: shortDate(ts),
      ts,
      score,
    });
  }

  if (!scored.length) throw new Error('no trade headlines inside the weekly window');

  // Rank on relevance, break ties on recency, then keep the digest short.
  scored.sort((a, b) => b.score - a.score || b.ts - a.ts);

  // The trade press publishes a great deal about café openings and cup design,
  // which scores at or below zero here. Some of it is worth a glance, so the
  // section stays — but it is capped, or a recap for a trading desk fills up
  // with counter news while the harvest stories scroll off the bottom.
  const kept = [];
  let others = 0;
  for (const item of scored) {
    if (kept.length >= limit) break;
    const section = kept.length < topStories ? RECAP_TOP
                  : item.score > 0 ? RECAP_TRADE
                  : RECAP_OTHER;
    if (section === RECAP_OTHER && ++others > otherLimit) continue;
    item.section = section;
    kept.push(item);
  }

  // Within a section, read newest first — the ranking chose what appears, the
  // date decides the order it is read in.
  kept.sort((a, b) => b.ts - a.ts);

  const publishers = [...new Set(kept.map(i => i.publisher))].sort();

  return {
    source: 'assembled',
    fetchedAt: new Date().toISOString(),
    windowDays: Math.round(lookbackHours / 24),
    publishers,
    // The score ranks the list but is not published: it is an editorial
    // device, not a figure anyone should read off the page.
    items: kept.map(({ score, ts, ...rest }) => rest),
    errors,
    note: 'Assembled from the coffee trade press over the past seven days, ranked by ' +
          'relevance to the physical trade. Headlines and links are each publisher’s own.',
  };
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
  // The score selects the article but is not published, so it is tracked here
  // rather than on the returned object.
  let bestScore = -Infinity;

  for (const it of items) {
    const ts = it.published ? Date.parse(it.published) : NaN;
    if (Number.isFinite(ts) && ts < cutoff) continue;
    const hay = `${it.title} ${it.summary}`;
    let score = 0;
    for (const [re, w] of TRADE_SIGNAL) if (re.test(hay)) score += w;
    for (const [re, w] of TRADE_NOISE) if (re.test(hay)) score += w;
    const ageHours = Number.isFinite(ts) ? (Date.now() - ts) / 3600000 : lookbackHours;
    score += Math.max(0, 4 - ageHours / 24);
    if (score > bestScore) {
      bestScore = score;
      best = {
        title: it.title,
        summary: it.summary || null,
        url: it.link,
        publisher: 'Daily Coffee News',
        published: it.published ?? null,
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
