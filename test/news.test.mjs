// Feed parsing.
//
// Five publishers, each with their own idea of how an RSS item should look.
// The parser is deliberately small and regex-based — no dependency — so these
// pin the shapes it has to survive.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFeed } from '../scripts/sources/news.mjs';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example Wire</title>
  <item>
    <title>Frost hits Sul de Minas</title>
    <link>https://example.org/frost</link>
    <description>Temperatures fell below zero overnight.</description>
    <pubDate>Fri, 28 Aug 2026 09:00:00 GMT</pubDate>
  </item>
  <item>
    <title><![CDATA[Exports rise 12%]]></title>
    <link>https://example.org/exports</link>
    <description><![CDATA[<p>Shipments were <b>up</b> on the month.</p>]]></description>
    <pubDate>Thu, 27 Aug 2026 11:30:00 GMT</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Harvest delayed in Dak Lak</title>
    <link rel="alternate" href="https://example.org/daklak"/>
    <summary>Rain has held up drying.</summary>
    <published>2026-08-28T06:00:00Z</published>
  </entry>
</feed>`;

test('parses RSS items', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Frost hits Sul de Minas');
  assert.equal(items[0].link, 'https://example.org/frost');
  assert.equal(items[0].summary, 'Temperatures fell below zero overnight.');
  assert.ok(items[0].published);
});

test('parses Atom entries, taking the link from its href', () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Harvest delayed in Dak Lak');
  assert.equal(items[0].link, 'https://example.org/daklak');
});

test('unwraps CDATA and strips markup out of summaries', () => {
  const items = parseFeed(RSS);
  assert.equal(items[1].title, 'Exports rise 12%');
  assert.equal(items[1].summary, 'Shipments were up on the month.');
});

test('strips markup that only appears after entities are decoded', () => {
  // Some publishers escape their markup, so a single strip-then-decode pass
  // leaves a visible <p> in the output.
  const feed = `<rss><channel><item>
    <title>Escaped markup</title>
    <link>https://example.org/x</link>
    <description>&lt;p&gt;Body text.&lt;/p&gt;</description>
  </item></channel></rss>`;
  assert.equal(parseFeed(feed)[0].summary, 'Body text.');
});

test('drops an item with no link', () => {
  // A headline a reader cannot follow to its source is not publishable here.
  const feed = `<rss><channel><item><title>Orphan</title></item></channel></rss>`;
  assert.deepEqual(parseFeed(feed), []);
});

test('returns nothing for an empty or broken feed', () => {
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed('<html><body>not a feed</body></html>'), []);
});
