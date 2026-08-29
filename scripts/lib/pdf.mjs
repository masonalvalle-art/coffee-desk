// A very small PDF text extractor, built on node:zlib and nothing else.
//
// It does one job: recover the text of a PDF *with the position of every
// fragment*, so a caller can rebuild a table by coordinate. That is the whole
// point — the numbers we want out of the ICO Coffee Market Report only mean
// anything in their column, and a flat text dump runs them together
// ("Aug-25297.05366.72") into something no parser should be asked to guess at.
//
// What it deliberately does NOT do:
//
//   * Read the cross-reference table. Streams are found by scanning the raw
//     bytes for `stream`/`endstream`. That sidesteps xref tables, xref streams
//     and /ObjStm entirely, and still finds every content stream, because
//     content streams are never packed into object streams.
//   * Map embedded subset fonts. Where a PDF uses a Type0/Identity font with
//     no /ToUnicode CMap the bytes are glyph ids, not characters, and there is
//     no honest way to turn them into text. Those runs come back flagged
//     `unmappable` so the caller can drop them. They are NEVER guessed at:
//     inventing a character here is exactly how a wrong figure reaches the
//     page.
//
// Positions are in unscaled text space. No /CTM tracking: a `cm` translate
// shifts a whole stream uniformly, which leaves row grouping and column order
// — the only things anyone here relies on — unchanged.

import zlib from 'node:zlib';

/* ------------------------------------------------------------------ *
 * Content streams
 * ------------------------------------------------------------------ */

/**
 * Every FlateDecode stream in the file that looks like page content.
 * Returned in file order, which for a linearised PDF is close enough to page
 * order for a caller to locate a table by its caption.
 */
export function contentStreams(buf) {
  const raw = buf.toString('latin1');
  const out = [];
  const marker = /\bstream\r?\n/g;
  let m;

  while ((m = marker.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;

    let text;
    try {
      text = zlib.inflateSync(buf.subarray(start, end)).toString('latin1');
    } catch {
      continue;   // an image, a font file, or a filter we do not implement
    }

    // A content stream sets a font and shows text. Everything else — images,
    // ICC profiles, metadata — is of no interest and would only slow the
    // caller's search for a caption.
    if (/\bTf\b/.test(text) && /\b(Tj|TJ)\b/.test(text)) out.push(text);
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Lexer
 * ------------------------------------------------------------------ */

const WHITESPACE = new Set([' ', '\t', '\r', '\n', '\f', '\0']);
const DELIMITER = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

// The escapes a PDF literal string may carry. Octal (\ddd) is handled
// separately because it takes an argument.
const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };

/**
 * Read a literal string starting at the opening parenthesis. Parentheses
 * nest, and an escaped one does not count towards the nesting — getting this
 * wrong truncates every string containing a bracket.
 */
function readLiteral(s, i) {
  let depth = 1;
  let out = '';
  i++;                                     // step over '('

  while (i < s.length && depth > 0) {
    const c = s[i];

    if (c === '\\') {
      const next = s[i + 1];
      if (next >= '0' && next <= '7') {
        let oct = '';
        let j = i + 1;
        while (j < s.length && oct.length < 3 && s[j] >= '0' && s[j] <= '7') oct += s[j++];
        out += String.fromCharCode(parseInt(oct, 8));
        i = j;
      } else if (next === '\n' || next === '\r') {
        // A backslash before a newline is a line continuation, not content.
        i += 2;
        if (next === '\r' && s[i] === '\n') i++;
      } else {
        out += ESCAPES[next] ?? next;
        i += 2;
      }
      continue;
    }

    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) { i++; break; }

    out += c;
    i++;
  }

  return { value: out, next: i };
}

/**
 * Tokenise a content stream into operands and operators. Content streams are
 * postfix, so the caller collects operands until it meets an operator.
 */
function* tokenise(s) {
  let i = 0;

  while (i < s.length) {
    const c = s[i];

    if (WHITESPACE.has(c)) { i++; continue; }

    if (c === '%') {                                   // comment to end of line
      while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
      continue;
    }

    if (c === '(') {
      const { value, next } = readLiteral(s, i);
      yield { type: 'string', value };
      i = next;
      continue;
    }

    if (c === '<' && s[i + 1] !== '<') {               // hex string
      const end = s.indexOf('>', i);
      if (end < 0) break;
      yield { type: 'hex', value: s.slice(i + 1, end) };
      i = end + 1;
      continue;
    }

    if (c === '<' && s[i + 1] === '<') { yield { type: 'dictOpen' }; i += 2; continue; }
    if (c === '>' && s[i + 1] === '>') { yield { type: 'dictClose' }; i += 2; continue; }
    if (c === '[') { yield { type: 'arrayOpen' }; i++; continue; }
    if (c === ']') { yield { type: 'arrayClose' }; i++; continue; }

    if (c === '/') {                                   // name
      let j = i + 1;
      while (j < s.length && !WHITESPACE.has(s[j]) && !DELIMITER.has(s[j])) j++;
      yield { type: 'name', value: s.slice(i + 1, j) };
      i = j;
      continue;
    }

    if (c === '{' || c === '}') { i++; continue; }     // PostScript function body

    // A number, or an operator.
    let j = i;
    while (j < s.length && !WHITESPACE.has(s[j]) && !DELIMITER.has(s[j])) j++;
    const word = s.slice(i, j);
    i = j === i ? i + 1 : j;                           // never stall

    if (/^[-+.\d]/.test(word) && !Number.isNaN(Number(word))) {
      yield { type: 'number', value: Number(word) };
    } else if (word) {
      yield { type: 'op', value: word };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Text extraction
 * ------------------------------------------------------------------ */

// Kerning inside a TJ array is expressed in thousandths of an em, negative for
// a gap. Anything past this is a deliberate space between words rather than
// letter fitting — without it, "New York" arrives as "NewYork".
const KERN_SPACE = -120;

// A unique marker for the start of a TJ array on the operand stack.
const ARRAY_START = Symbol('[');

// What stands in for a run of glyph ids we cannot map. It is never published;
// it exists so an unmappable cell is visibly wrong in a dump rather than
// silently empty.
const UNMAPPABLE = '�';

/**
 * Pull positioned text out of one content stream.
 *
 * Returns `[{ x, y, text, unmappable }]` in the order the PDF drew it, where
 * `x`/`y` are the text-space origin of the fragment and `unmappable` marks a
 * run whose bytes are glyph ids we cannot honestly turn into characters.
 */
export function textItems(stream) {
  const items = [];

  // The text matrix and the text line matrix. Only translation and scale are
  // tracked; these documents do not rotate table text, and a rotated caption
  // would simply group into its own row and be ignored.
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = tm.slice();
  let leading = 0;

  let operands = [];
  const num = (i) => {
    const v = operands[i];
    return typeof v === 'number' ? v : 0;
  };

  function setLineMatrix(a, b, c, d, e, f) {
    tlm = [a, b, c, d, e, f];
    tm = tlm.slice();
  }

  function offsetLine(tx, ty) {
    setLineMatrix(tlm[0], tlm[1], tlm[2], tlm[3],
                  tlm[4] + tx * tlm[0], tlm[5] + ty * tlm[3]);
  }

  function push(text, unmappable) {
    if (!text) return;
    items.push({
      x: Math.round(tm[4] * 10) / 10,
      y: Math.round(tm[5] * 10) / 10,
      text,
      unmappable: !!unmappable,
    });
  }

  /** A TJ array: strings interleaved with kerning numbers. */
  function showArray(parts) {
    let text = '';
    let unmappable = false;

    for (const part of parts) {
      if (typeof part === 'number') {
        if (part <= KERN_SPACE && text && !text.endsWith(' ')) text += ' ';
      } else if (part && part.hex) {
        unmappable = true;
      } else if (typeof part === 'string') {
        text += part;
      }
    }

    // A run that is part real text and part glyph ids would be a half-truth.
    // Report it as unmappable and let the caller decide.
    //
    // A run that is ONLY glyph ids still has to be emitted, as the marker. It
    // occupies a column, and dropping it silently would slide every heading
    // one place along — which is how a figure ends up under the wrong month.
    push(text || (unmappable ? UNMAPPABLE : ''), unmappable);
  }

  for (const tok of tokenise(stream)) {
    if (tok.type === 'number') { operands.push(tok.value); continue; }
    if (tok.type === 'string') { operands.push(tok.value); continue; }
    if (tok.type === 'hex') { operands.push({ hex: tok.value }); continue; }
    if (tok.type === 'name') { operands.push({ name: tok.value }); continue; }
    if (tok.type === 'arrayOpen') { operands.push(ARRAY_START); continue; }

    if (tok.type === 'arrayClose') {
      const at = operands.lastIndexOf(ARRAY_START);
      const parts = at < 0 ? operands.slice() : operands.slice(at + 1);
      operands = at < 0 ? [] : operands.slice(0, at);
      operands.push({ array: parts });
      continue;
    }

    if (tok.type !== 'op') { operands = []; continue; }   // dict markers etc.

    switch (tok.value) {
      case 'BT':
        setLineMatrix(1, 0, 0, 1, 0, 0);
        break;

      case 'TL':
        leading = num(0);
        break;

      case 'Td':
        offsetLine(num(0), num(1));
        break;

      case 'TD':
        leading = -num(1);
        offsetLine(num(0), num(1));
        break;

      case 'Tm':
        setLineMatrix(num(0), num(1), num(2), num(3), num(4), num(5));
        break;

      case 'T*':
        offsetLine(0, -leading);
        break;

      case 'Tj':
      case "'":
      case '"': {
        // ' and " move to the next line before showing their string.
        if (tok.value !== 'Tj') offsetLine(0, -leading);
        const v = operands[operands.length - 1];
        if (v && v.hex !== undefined) push(UNMAPPABLE, true);
        else if (typeof v === 'string') push(v, false);
        break;
      }

      case 'TJ': {
        const v = operands[operands.length - 1];
        if (v && v.array) showArray(v.array);
        break;
      }

      default:
        break;
    }

    operands = [];
  }

  return items;
}

/* ------------------------------------------------------------------ *
 * Rows and columns
 * ------------------------------------------------------------------ */

/**
 * Group fragments into rows by their y position.
 *
 * `tolerance` absorbs the sub-point drift between cells that a human reads as
 * one line. Two points suits the ICO reports; a tighter value splits a row
 * whose figures were typeset a hair apart.
 *
 * Rows come back top of page first, cells left to right.
 */
export function rows(items, tolerance = 2) {
  const buckets = [];

  for (const item of items) {
    if (!item.text.trim()) continue;
    const hit = buckets.find(b => Math.abs(b.y - item.y) <= tolerance);
    if (hit) hit.cells.push(item);
    else buckets.push({ y: item.y, cells: [item] });
  }

  for (const b of buckets) b.cells.sort((a, c) => a.x - c.x);
  buckets.sort((a, b) => b.y - a.y);
  return buckets;
}

/** The readable text of a row, joined — handy for finding a caption. */
export function rowText(row) {
  return row.cells.map(c => c.text).join('').replace(/\s+/g, ' ').trim();
}

/**
 * Merge fragments that belong to the same cell.
 *
 * A justified table cell is often drawn as several fragments a point or two
 * apart ("Colombian" is one item, " Milds" the next). Anything closer than
 * `gap` is the same cell; anything further is the next column.
 */
export function cells(row, gap = 6) {
  const out = [];

  for (const item of row.cells) {
    const prev = out[out.length - 1];
    if (prev && item.x - prev.end <= gap) {
      prev.text += item.text;
      prev.end = item.x + item.text.length * 4;   // rough advance; only ordering depends on it
      prev.unmappable = prev.unmappable || item.unmappable;
      continue;
    }
    out.push({
      x: item.x,
      end: item.x + item.text.length * 4,
      text: item.text,
      unmappable: item.unmappable,
    });
  }

  return out
    .map(c => ({ x: c.x, text: c.text.replace(/\s+/g, ' ').trim(), unmappable: c.unmappable }))
    .filter(c => c.text);
}
