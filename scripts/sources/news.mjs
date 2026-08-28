// News, taken straight from publishers' own syndication feeds.
//
// We deliberately do NOT use news aggregator feeds. Google News' RSS licence,
// for instance, restricts it to personal, non-commercial feed-reader use,
// which a public dashboard is not. Publisher feeds are published *for*
// syndication, carry the outlet's own summary text, and link straight to the
// article.
//
// The cost of that choice, stated plainly: coffee is not a daily story for the
// general press, and the specialist feeds we can legally read skew towards
// café and retail news rather than the physical trade. So we score hard for
// market relevance, score *against* hospitality noise, and publish fewer than
// five stories when fewer than five are worth a buyer's time.

import { getText, mapLimit } from '../lib/http.mjs';

export const FEEDS = [
  // Tier 1 — general press of record.
  { name: 'Financial Times', section: 'Commodities', tier: 1, url: 'https://www.ft.com/commodities?format=rss' },
  { name: 'Financial Times', section: 'World',        tier: 1, url: 'https://www.ft.com/world?format=rss' },
  { name: 'BBC News',        section: 'Business',     tier: 1, url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { name: 'BBC News',        section: 'Latin America', tier: 1, url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml' },
  { name: 'CNBC',            section: 'Commodities',  tier: 1, url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
  // Tier 2 — origin and specialist trade press.
  { name: 'VnExpress International', section: 'Business', tier: 2, url: 'https://e.vnexpress.net/rss/business.rss' },
  { name: 'World Coffee Portal',     section: 'News',     tier: 2, url: 'https://www.worldcoffeeportal.com/rss/' },
  { name: 'Daily Coffee News',       section: 'News',     tier: 2, url: 'https://dailycoffeenews.com/feed/' },
];

// The story has to be about coffee at all.
const COFFEE = /\b(coffee|arabica|robusta)\b/i;

// ...and about the trade in it. Note the explicit plurals: a trailing \b after
// "cooperative" silently fails to match "Cooperatives", which cost us a
// genuinely relevant green-buying story while testing.
const MARKET = [
  [/\b(futures?|exchange|hedg(e|es|ed|ing))\b/i, 6],
  [/\b(differentials?|certified stocks?|warehouses?|inventor(y|ies))\b/i, 6],
  [/\b(harvests?|crops?|yields?|flowering|plantings?|cherr(y|ies))\b/i, 5],
  [/\b(exports?|imports?|shipments?|supply|deficits?|surplus(es)?|shortages?)\b/i, 5],
  [/\b(drought|frost|rainfall|el ni[nñ]o|la ni[nñ]a|weather|climate)\b/i, 5],
  [/\b(prices?|priced|rally|slump|surge|plunge|record high)\b/i, 4],
  [/\b(tariffs?|dut(y|ies)|EUDR|deforestation)\b/i, 4],
  [/\b(farmers?|growers?|producers?|plantations?|smallholders?|cooperatives?)\b/i, 3],
  [/\b(brazil|vietnam|colombia|indonesia|ethiopia|honduras|uganda|peru)\b/i, 3],
  [/\b(green coffee|auctions?|microlots?|origins?)\b/i, 3],
];

// Hospitality and corporate-affairs noise. A buyer does not need to know who
// a drive-thru chain hired as marketing director.
const NOISE = [
  [/\b(franchises?|outlets?|chains?|drive.?thru)\b/i, -7],
  [/\b(baristas?|latte|menus?|RTD|ready.to.drink|matcha|baker(y|ies)|eatery)\b/i, -6],
  [/\b(appoints?|hire[sd]?|CMO|chief \w+ officer|leadership|promoted)\b/i, -6],
  [/\b(raises? \$|funding|equity|investors?|investment round|ambassadors?)\b/i, -5],
  [/\b(expansions?|expands?|debuts?|relaunch)\b/i, -4],
  [/\b(caf[eé]s?|coffee ?shops?|coffeehouses?|roaster(y|ies)|tasting)\b/i, -4],
];

// Below this a story is not worth a buyer's attention, and we would rather
// print a short list than a padded one.
const MIN_SCORE = 8;

export async function fetchNews({ limit = 5, lookbackHours = 96 } = {}) {
  const results = await mapLimit(FEEDS, 4, async (feed) => {
    const xml = await getText(feed.url, { timeout: 20000, retries: 1 });
    return parseFeed(xml).map(item => ({ ...item, feed }));
  });

  const errors = [];
  const items = [];
  results.forEach((r, i) => {
    if (!r || r.__error) {
      errors.push({ feed: FEEDS[i].name + ' / ' + FEEDS[i].section, error: r?.__error ?? 'unknown' });
      return;
    }
    items.push(...r);
  });

  const now = Date.now();
  const cutoff = now - lookbackHours * 3600 * 1000;
  const seen = new Set();
  const scored = [];

  for (const it of items) {
    const hay = `${it.title} ${it.summary}`;
    if (!COFFEE.test(hay)) continue;

    const ts = it.published ? Date.parse(it.published) : NaN;
    if (Number.isFinite(ts) && ts < cutoff) continue;

    const key = normalise(it.title);
    if (seen.has(key)) continue;
    seen.add(key);

    let market = 0, noise = 0;
    for (const [re, w] of MARKET) if (re.test(hay)) market += w;
    for (const [re, w] of NOISE) if (re.test(hay)) noise += w;
    // Coffee in the headline is a stronger signal than coffee in passing.
    if (COFFEE.test(it.title)) market += 2;

    const ageHours = Number.isFinite(ts) ? (now - ts) / 3600000 : lookbackHours;
    const recency = Math.max(0, 5 - ageHours / 20);
    const tierWeight = it.feed.tier === 1 ? 8 : 0;

    scored.push({
      title: it.title,
      summary: it.summary || null,
      url: it.link,
      publisher: it.feed.name,
      section: it.feed.section,
      tier: it.feed.tier,
      published: it.published ?? null,
      score: +(tierWeight + market + noise + recency).toFixed(2),
      marketScore: market,
      noiseScore: noise,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const eligible = scored.filter(s => s.score >= MIN_SCORE);

  return {
    fetchedAt: new Date().toISOString(),
    lookbackHours,
    minScore: MIN_SCORE,
    articles: eligible.slice(0, limit),
    totalCoffeeStories: scored.length,
    totalEligible: eligible.length,
    feedsQueried: FEEDS.length,
    errors,
    note: 'Publisher feeds only. Ranked by outlet, physical-trade relevance and recency, ' +
          'and scored down for café and corporate-affairs stories. Summaries are the ' +
          'publishers own feed text, not generated.',
  };
}

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
  return decodeEntities(
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')  // unwrap CDATA
     .replace(/<[^>]+>/g, ' ')                       // strip markup
  ).replace(/\s+/g, ' ').trim();
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
