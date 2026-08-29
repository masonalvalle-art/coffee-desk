// The PDF text extractor.
//
// Fixtures are built here rather than checked in: a real ICO report is 1.2MB,
// and a hand-built one states exactly which PDF feature is under test. The
// deflate is done with node:zlib, the same built-in the extractor uses to
// undo it.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { contentStreams, textItems, rows, cells, rowText } from '../scripts/lib/pdf.mjs';

/** Wrap a content stream in just enough PDF to be found by a byte scan. */
function pdf(content) {
  const deflated = zlib.deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([
    Buffer.from('%PDF-1.6\n1 0 obj\n<</Length ' + deflated.length + '/Filter/FlateDecode>>\nstream\n', 'latin1'),
    deflated,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ]);
}

const TWO_CELLS = `BT
/F1 10 Tf
1 0 0 1 72 700 Tm
(Hello) Tj
1 0 0 1 200 700 Tm
(World) Tj
ET`;

test('finds a flate-compressed content stream', () => {
  assert.equal(contentStreams(pdf(TWO_CELLS)).length, 1);
});

test('ignores a stream that shows no text', () => {
  // An image or a font program has no business being handed to a text parser.
  const deflated = zlib.deflateSync(Buffer.from('nothing to see here', 'latin1'));
  const buf = Buffer.concat([
    Buffer.from('%PDF-1.6\nstream\n', 'latin1'), deflated,
    Buffer.from('\nendstream\n', 'latin1'),
  ]);
  assert.equal(contentStreams(buf).length, 0);
});

test('recovers text with its position', () => {
  const items = textItems(contentStreams(pdf(TWO_CELLS))[0]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => i.text), ['Hello', 'World']);
  assert.equal(items[0].x, 72);
  assert.equal(items[0].y, 700);
  assert.equal(items[1].x, 200);
});

test('groups fragments on the same line into one row', () => {
  const items = textItems(contentStreams(pdf(TWO_CELLS))[0]);
  const r = rows(items);
  assert.equal(r.length, 1);
  assert.equal(r[0].cells.length, 2);
  assert.equal(rowText(r[0]), 'HelloWorld');
});

test('keeps columns apart but joins fragments of one word', () => {
  // "Colom" + "bian" at touching x is one cell; the figure far to the right is
  // another. Getting this wrong is what turns a table row into Aug-25297.05.
  const items = textItems(contentStreams(pdf(`BT
/F1 10 Tf
1 0 0 1 72 700 Tm
(Colom) Tj
1 0 0 1 92 700 Tm
(bian) Tj
1 0 0 1 300 700 Tm
(383.39) Tj
ET`))[0]);
  const c = cells(rows(items)[0]);
  assert.equal(c.length, 2);
  assert.equal(c[0].text, 'Colombian');
  assert.equal(c[1].text, '383.39');
});

test('turns a wide kerning gap into a space', () => {
  // Without this "New York" arrives as "NewYork".
  const items = textItems(contentStreams(pdf(`BT
/F1 10 Tf
1 0 0 1 72 700 Tm
[(New) -200 (York)] TJ
ET`))[0]);
  assert.equal(items[0].text, 'New York');
});

test('does not insert a space for ordinary letter fitting', () => {
  const items = textItems(contentStreams(pdf(`BT
/F1 10 Tf
1 0 0 1 72 700 Tm
[(Ro) -20 (bustas)] TJ
ET`))[0]);
  assert.equal(items[0].text, 'Robustas');
});

test('flags glyph ids as unmappable rather than guessing at them', () => {
  // The heart of it. A subset font with no /ToUnicode gives bytes that are
  // glyph indices, not characters. Two of ICO's certified-stock month headings
  // are drawn this way, and inventing characters for them would put a figure
  // under the wrong month.
  const items = textItems(contentStreams(pdf(`BT
/F1 10 Tf
1 0 0 1 72 700 Tm
<00410042> Tj
ET`))[0]);
  assert.equal(items.length, 1);
  assert.equal(items[0].unmappable, true);
  assert.notEqual(items[0].text, 'AB');
});

test('decodes octal escapes and escaped parentheses', () => {
  const items = textItems(contentStreams(pdf(`BT
/F1 10 Tf
1 0 0 1 72 700 Tm
(caf\\351 \\(Brazil\\)) Tj
ET`))[0]);
  assert.equal(items[0].text, 'café (Brazil)');
});

test('follows Td and T* down the page', () => {
  const items = textItems(contentStreams(pdf(`BT
/F1 10 Tf
12 TL
1 0 0 1 72 700 Tm
(first) Tj
0 -20 Td
(second) Tj
T*
(third) Tj
ET`))[0]);
  assert.deepEqual(items.map(i => i.text), ['first', 'second', 'third']);
  assert.equal(items[0].y, 700);
  assert.equal(items[1].y, 680);
  assert.equal(items[2].y, 668);   // one leading below the previous line
});

test('rows come back top of page first', () => {
  const items = textItems(contentStreams(pdf(`BT
/F1 10 Tf
1 0 0 1 72 600 Tm
(lower) Tj
1 0 0 1 72 700 Tm
(upper) Tj
ET`))[0]);
  assert.deepEqual(rows(items).map(rowText), ['upper', 'lower']);
});
