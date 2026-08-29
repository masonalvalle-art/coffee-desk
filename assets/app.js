/* ============================================================
   The Coffee Desk — renderer.
   Reads data/latest.json (written by the scheduled fetch) and
   sets the page. It renders only what the data actually
   contains: a missing or failed source produces a stated
   "unavailable" block, never a placeholder number.
   ============================================================ */

(function () {
  'use strict';

  // ---------- small helpers ----------

  var $ = function (sel) { return document.querySelector(sel); };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function num(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toLocaleString('en-GB', {
      minimumFractionDigits: dp == null ? 2 : dp,
      maximumFractionDigits: dp == null ? 2 : dp
    });
  }

  function signed(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + num(v, dp);
  }

  function dirClass(v) {
    if (v == null || !isFinite(v) || v === 0) return 'flat';
    return v > 0 ? 'up' : 'down';
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function relTime(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var mins = Math.round((Date.now() - t) / 60000);
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    return Math.round(hrs / 24) + ' d ago';
  }

  /** Shorten a headline or summary, on a word boundary where possible. */
  function clip(s, n) {
    if (!s) return '';
    if (s.length <= n) return s;
    var cut = s.slice(0, n);
    var sp = cut.lastIndexOf(' ');
    return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…';
  }

  /**
   * A compact citation line: source and scope only, separated by middots, with
   * a pointer to the full method at the foot of the page. The reasoning behind
   * each number lives in Sources & Method rather than under every table.
   */
  function cite(parts, opts) {
    opts = opts || {};
    var kids = [];
    parts.filter(Boolean).forEach(function (p, i) {
      if (i) kids.push(el('span', { class: 'dot', text: '·' }));
      kids.push(typeof p === 'string' ? el('span', { text: p }) : p);
    });
    if (opts.method !== false) {
      kids.push(el('span', { class: 'dot', text: '·' }));
      kids.push(el('a', { href: '#sources', text: 'method' }));
    }
    return el('p', { class: 'cite' }, kids);
  }

  function notice(head, lines) {
    return el('div', { class: 'notice' }, [
      el('div', { class: 'notice-head', text: head })
    ].concat(lines.map(function (t) { return el('p', { text: t }); })));
  }

  // ---------- charts ----------

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    return n;
  }

  /**
   * Choose a gridline step that lands on round numbers — 1, 2, 2.5, 5 or 10
   * times a power of ten. Without this the axis is drawn at interpolated
   * values and the labels read 287.43 rather than 290.
   */
  function niceStep(range, targetTicks) {
    if (!(range > 0)) return 1;
    var raw = range / Math.max(1, targetTicks);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  /** Index of the first bar of each month in the window, for the date axis. */
  function monthBoundaries(bars) {
    var out = [];
    var seen = null;
    bars.forEach(function (b, i) {
      var key = (b.date || '').slice(0, 7);
      if (key && key !== seen) { seen = key; out.push(i); }
    });
    return out;
  }

  function monthLabel(iso, showYear) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var mon = d.toLocaleDateString('en-GB', { month: 'short' });
    return showYear ? mon + ' ' + String(d.getFullYear()).slice(2) : mon;
  }

  /**
   * A deliberately plain line chart: hairline axes, no gradients. Draws the
   * close series, moving averages, support/resistance rules from real swing
   * pivots, round-number gridlines, month markers, the last price pinned to
   * the right edge, and a crosshair that reports the exact bar under the
   * pointer through opts.onHover.
   */
  function lineChart(opts) {
    var bars = opts.bars || [];
    var W = 900, H = 300;
    var m = { top: 16, right: 76, bottom: 30, left: 10 };

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': opts.ariaLabel || 'Price chart'
    });

    if (bars.length < 2) {
      svg.appendChild(svgEl('line', {
        x1: m.left, y1: H / 2, x2: W - m.right, y2: H / 2,
        stroke: 'currentColor', 'stroke-width': 1, 'stroke-dasharray': '2 4', opacity: .35
      }));
      var t = svgEl('text', {
        x: W / 2, y: H / 2 - 10, 'text-anchor': 'middle',
        'font-size': 12, fill: 'currentColor', opacity: .6,
        'font-family': 'IBM Plex Mono, monospace'
      });
      t.textContent = bars.length === 1 ? 'One session recorded so far' : 'No price history yet';
      svg.appendChild(t);
      return svg;
    }

    var dp = opts.dp == null ? 0 : opts.dp;
    var closes = bars.map(function (b) { return b.close; });
    var extraSeries = (opts.series || []).filter(function (s) { return s.values && s.values.length; });

    // The y-domain is built from price and moving averages ONLY. Levels are
    // found over the whole analysed history, so a level set six months ago
    // would otherwise squash a three-month window into a band.
    var all = closes.slice();
    extraSeries.forEach(function (s) {
      s.values.forEach(function (v) { if (v != null) all.push(v); });
    });

    var lo = Math.min.apply(null, all);
    var hi = Math.max.apply(null, all);
    var pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;

    // Snap the domain outward to whole multiples of a round step.
    var step = niceStep(hi - lo, 6);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;

    var plotW = W - m.left - m.right;
    var plotH = H - m.top - m.bottom;
    var x = function (i) { return m.left + (i / (bars.length - 1)) * plotW; };
    var y = function (v) { return m.top + (1 - (v - lo) / (hi - lo)) * plotH; };

    // Horizontal gridlines on round values, labelled at the right edge.
    for (var val = lo; val <= hi + step * 0.001; val += step) {
      var yy = y(val);
      svg.appendChild(svgEl('line', {
        x1: m.left, y1: yy, x2: W - m.right, y2: yy,
        stroke: 'currentColor', 'stroke-width': 0.5, opacity: 0.14
      }));
      var lbl = svgEl('text', {
        x: W - m.right + 7, y: yy + 3.5, 'font-size': 10.5,
        fill: 'currentColor', opacity: .6,
        'font-family': 'IBM Plex Mono, monospace'
      });
      lbl.textContent = num(val, dp);
      svg.appendChild(lbl);
    }

    // Month markers: a faint rule and a label at each month boundary.
    var months = monthBoundaries(bars);
    var crossesYear = bars.length > 1 &&
      (bars[0].date || '').slice(0, 4) !== (bars[bars.length - 1].date || '').slice(0, 4);
    var minGap = plotW / 14; // drop labels that would collide
    var lastLabelX = -Infinity;
    months.forEach(function (i) {
      if (i === 0) return;
      var xx = x(i);
      svg.appendChild(svgEl('line', {
        x1: xx, y1: m.top, x2: xx, y2: H - m.bottom,
        stroke: 'currentColor', 'stroke-width': 0.5, opacity: 0.1
      }));
      if (xx - lastLabelX < minGap) return;
      lastLabelX = xx;
      var mt = svgEl('text', {
        x: xx, y: H - 10, 'font-size': 10, 'text-anchor': 'middle',
        fill: 'currentColor', opacity: .6,
        'font-family': 'IBM Plex Mono, monospace'
      });
      mt.textContent = monthLabel(bars[i].date, crossesYear);
      svg.appendChild(mt);
    });

    // Support / resistance, but only where the level actually falls inside the
    // visible range — an off-chart level is noise, not information.
    (opts.levels || []).filter(function (l) {
      return l.price != null && l.price >= lo && l.price <= hi;
    }).forEach(function (l) {
      var ly = y(l.price);
      svg.appendChild(svgEl('line', {
        x1: m.left, y1: ly, x2: W - m.right, y2: ly,
        stroke: 'currentColor', 'stroke-width': 1,
        'stroke-dasharray': '1 4', opacity: .5
      }));
      var tag = svgEl('text', {
        x: m.left + 4, y: ly - 4, 'font-size': 9.5,
        fill: 'currentColor', opacity: .7,
        'font-family': 'IBM Plex Mono, monospace'
      });
      tag.textContent = (l.kind === 'r' ? 'R ' : 'S ') + num(l.price, dp);
      svg.appendChild(tag);
    });

    function path(values) {
      var d = '';
      var started = false;
      values.forEach(function (v, i) {
        if (v == null) return;
        d += (started ? ' L' : 'M') + x(i).toFixed(2) + ' ' + y(v).toFixed(2);
        started = true;
      });
      return d;
    }

    // Moving averages sit behind the price line.
    extraSeries.forEach(function (s) {
      svg.appendChild(svgEl('path', {
        d: path(s.values), fill: 'none', stroke: 'currentColor',
        'stroke-width': 1, 'stroke-dasharray': s.dash || '4 3', opacity: s.opacity || .45
      }));
    });

    // A faint wash under the price line: enough to give the series weight
    // without turning the chart into an area chart.
    var lineD = path(closes);
    if (lineD) {
      svg.appendChild(svgEl('path', {
        d: lineD + ' L' + x(closes.length - 1).toFixed(2) + ' ' + (H - m.bottom) +
           ' L' + x(0).toFixed(2) + ' ' + (H - m.bottom) + ' Z',
        fill: 'currentColor', opacity: 0.06, stroke: 'none'
      }));
    }

    svg.appendChild(svgEl('path', {
      d: lineD, fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));

    // Last point, marked, with the closing value pinned against the right
    // axis so the current number is legible without hovering.
    var lastI = closes.length - 1;
    var lastY = y(closes[lastI]);
    svg.appendChild(svgEl('circle', {
      cx: x(lastI), cy: lastY, r: 3, fill: 'currentColor'
    }));

    // The gridlines round to whole numbers so they stay legible, but the
    // pinned close is the one figure a buyer reads off directly — it gets the
    // full precision the exchange quotes.
    var pinText = num(closes[lastI], 2);
    var pinW = Math.max(44, pinText.length * 7 + 12);
    svg.appendChild(svgEl('rect', {
      x: W - m.right + 3, y: lastY - 8, width: pinW, height: 16,
      fill: 'currentColor', rx: 1
    }));
    var pin = svgEl('text', {
      x: W - m.right + 3 + pinW / 2, y: lastY + 3.5, 'font-size': 10.5,
      'text-anchor': 'middle', 'font-weight': 600,
      fill: 'var(--paper-deep)', 'font-family': 'IBM Plex Mono, monospace'
    });
    pin.textContent = pinText;
    svg.appendChild(pin);

    // First and last dates bracket the month markers.
    [[0, 'start'], [bars.length - 1, 'end']].forEach(function (p) {
      var tx = svgEl('text', {
        x: x(p[0]), y: H - 10, 'font-size': 10,
        fill: 'currentColor', opacity: .6, 'text-anchor': p[1],
        'font-family': 'IBM Plex Mono, monospace'
      });
      tx.textContent = fmtDate(bars[p[0]].date);
      svg.appendChild(tx);
    });

    // ---- crosshair ----------------------------------------------------
    // A transparent rect over the plot captures pointer movement; the values
    // are reported back through opts.onHover and rendered as HTML in the
    // chart header, where they can use the page's own type and cannot
    // overflow the viewBox.
    var cross = svgEl('g', { opacity: 0 });
    var crossLine = svgEl('line', {
      y1: m.top, y2: H - m.bottom, stroke: 'currentColor',
      'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: .75
    });
    var crossDot = svgEl('circle', { r: 3.5, fill: 'currentColor' });
    cross.appendChild(crossLine);
    cross.appendChild(crossDot);
    svg.appendChild(cross);

    var current = -1;
    function showAt(i) {
      if (i < 0 || i >= bars.length || i === current) return;
      current = i;
      var cx = x(i);
      crossLine.setAttribute('x1', cx);
      crossLine.setAttribute('x2', cx);
      crossDot.setAttribute('cx', cx);
      crossDot.setAttribute('cy', y(closes[i]));
      cross.setAttribute('opacity', 1);
      if (opts.onHover) opts.onHover(bars[i], i, bars[i - 1] || null);
    }
    function clear() {
      current = -1;
      cross.setAttribute('opacity', 0);
      if (opts.onHover) opts.onHover(null);
    }
    function indexFromEvent(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return -1;
      var vx = ((ev.clientX - r.left) / r.width) * W;   // client px -> viewBox
      var frac = (vx - m.left) / plotW;
      return Math.max(0, Math.min(bars.length - 1, Math.round(frac * (bars.length - 1))));
    }

    var capture = svgEl('rect', {
      x: m.left, y: m.top, width: plotW, height: plotH,
      fill: 'transparent', style: 'cursor:crosshair'
    });
    capture.addEventListener('pointermove', function (ev) { showAt(indexFromEvent(ev)); });
    capture.addEventListener('pointerdown', function (ev) { showAt(indexFromEvent(ev)); });
    capture.addEventListener('pointerleave', clear);
    svg.appendChild(capture);

    // Keyboard: the exact figures should not need a mouse.
    svg.setAttribute('tabindex', '0');
    svg.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      var base = current < 0 ? bars.length - 1 : current;
      showAt(base + (ev.key === 'ArrowRight' ? 1 : -1));
    });
    svg.addEventListener('blur', clear);

    return svg;
  }

  function movingAverage(values, period) {
    var out = [];
    var sum = 0;
    for (var i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      out.push(i >= period - 1 ? sum / period : null);
    }
    return out;
  }

  // ---------- sections ----------

  function renderBoard(futures) {
    var host = $('#board');
    host.innerHTML = '';
    var any = false;

    ['arabica'].forEach(function (key) {
      var c = futures && futures[key];
      if (!c) {
        host.appendChild(el('div', { class: 'contract' }, [
          notice('Unavailable', [
            'Arabica futures could not be retrieved on this run. ' +
            'No figure is shown rather than a stale one.'
          ])
        ]));
        return;
      }
      any = true;
      var q = c.quote || {};
      var dp = 2;

      var kicker = el('div', { class: 'contract-kicker' }, [
        el('span', { text: c.contract.code }),
        el('span', { class: 'dot', text: '·' }),
        el('span', { text: c.exchange })
      ]);

      var stats = el('dl', { class: 'stat-row' }, [
        stat('Open', num(q.open, dp)),
        stat('High', num(q.high, dp)),
        stat('Low', num(q.low, dp)),
        stat('Volume', q.volume == null ? '—' : num(q.volume, 0))
      ]);

      var kids = [
        kicker,
        el('h3', { class: 'contract-name', text: c.market + ' — ' + c.contract.label }),
        el('p', { class: 'contract-sub', text: c.contractName + ', second traded month · ' + c.lotSize + ' per lot' }),
        el('div', { class: 'price-row' }, [
          el('span', { class: 'price', text: num(q.last, dp) }),
          el('span', { class: 'price-unit', text: c.unit }),
          el('span', {
            class: 'change ' + dirClass(q.changePct),
            text: signed(q.change, dp) + '  (' + signed(q.changePct, 2) + '%)'
          })
        ]),
        stats
      ];

      // Surface the roll: a collapsed front month is information, not noise.
      if (c.rolled && c.frontMonth) {
        kids.push(el('p', {
          class: 'roll-note',
          text: 'Front month ' + c.frontMonth.code + ' has thinned to ' +
                num(c.frontMonth.volume, 0) + ' lots against ' + num(q.volume, 0) +
                ' here — the market has rolled into this contract.'
        }));
      }

      if (c.crossCheck) {
        kids.push(el('p', {
          class: 'roll-note',
          text: c.crossCheck.agree
            ? 'Cross-checked against a second independent feed: agrees to within ' +
              Math.abs(c.crossCheck.diffPct).toFixed(2) + '%.'
            : 'Feeds disagree (' + num(c.crossCheck.tradingView, dp) + ' vs ' +
              num(c.crossCheck.yahoo, dp) + '). Treat with caution.'
        }));
      }

      host.appendChild(el('div', { class: 'contract' }, kids));

      // The rest of the curve. With one market on the board this space is
      // better spent on the term structure than left empty: the spread between
      // months is what tells a buyer whether carrying costs money or earns it.
      if (c.curve && c.curve.length > 1) {
        var second = q.last;
        var rows = c.curve.map(function (m) {
          var spread = (second != null && m.close != null) ? m.close - second : null;
          var isCurrent = m.code === c.contract.code;
          return el('tr', { class: isCurrent ? 'curve-current' : null }, [
            el('td', { class: 'name' }, [
              m.code,
              isCurrent ? el('span', { class: 'badge', text: 'shown above' }) : null
            ]),
            el('td', { class: 'muted', text: m.label }),
            el('td', { class: 'num', text: num(m.close, dp) }),
            el('td', { class: 'num ' + (isCurrent ? 'muted' : dirClass(spread)),
                       text: isCurrent ? '—' : signed(spread, 2) }),
            el('td', { class: 'num muted', text: m.volume == null ? '—' : num(m.volume, 0) })
          ]);
        });

        host.appendChild(el('div', { class: 'contract curve-panel' }, [
          el('h3', { class: 'contract-name', text: 'Forward Months' }),
          el('p', { class: 'contract-sub', text: 'Every Coffee C month currently quoting, against ' + c.contract.code }),
          el('div', { class: 'table-scroll' }, [
            el('table', { class: 'sheet' }, [
              el('thead', {}, [el('tr', {}, [
                el('th', { text: 'Contract' }),
                el('th', { text: 'Delivery' }),
                el('th', { class: 'num', text: 'Last' }),
                el('th', { class: 'num', text: 'vs ' + c.contract.code }),
                el('th', { class: 'num', text: 'Volume' })
              ])]),
              el('tbody', {}, rows)
            ])
          ]),
          cite(['Above = carry, below = backwardation', 'TradingView'])
        ]));
      }
    });

    if (!any) {
      host.innerHTML = '';
      host.appendChild(notice('Board unavailable', [
        'The futures feed did not respond on this run. Check the sources panel for the error.'
      ]));
    }
  }

  function stat(label, value) {
    return el('div', { class: 'stat' }, [
      el('dt', { text: label }),
      el('dd', { text: value })
    ]);
  }

  // Roughly 22 trading sessions to the month.
  var TIMEFRAMES = [
    { key: '1M', label: '1M', sessions: 22 },
    { key: '3M', label: '3M', sessions: 65 },
    { key: '6M', label: '6M', sessions: 130 },
    { key: '1Y', label: '1Y', sessions: 260 }
  ];
  var TF_STORAGE_KEY = 'coffeedesk.timeframe';
  var DEFAULT_TF = '3M';

  // Storage can throw outright in a private window or with site data blocked,
  // so every read and write is guarded and the page falls back to the default.
  function readTimeframe() {
    try {
      var v = window.localStorage.getItem(TF_STORAGE_KEY);
      return TIMEFRAMES.some(function (t) { return t.key === v; }) ? v : DEFAULT_TF;
    } catch (e) { return DEFAULT_TF; }
  }
  function writeTimeframe(v) {
    try { window.localStorage.setItem(TF_STORAGE_KEY, v); } catch (e) { /* not essential */ }
  }

  function renderCharts(futures) {
    var host = $('#charts');
    host.innerHTML = '';

    var c = futures && futures.arabica;
    if (!c || !(c.bars || []).length) {
      host.appendChild(notice('No chart', ['No price history was available on this run.']));
      return;
    }

    var dp = 0;
    var full = c.bars || [];
    var fullCloses = full.map(function (b) { return b.close; });

    // Moving averages are computed over the FULL published series and sliced
    // afterwards. Computing them inside the window left the 50-day line
    // covering only the last 15 points of a three-month chart.
    var ma20Full = fullCloses.length >= 20 ? movingAverage(fullCloses, 20) : null;
    var ma50Full = fullCloses.length >= 50 ? movingAverage(fullCloses, 50) : null;

    var levels = [];
    var t = c.technicals;
    if (t && t.levels) {
      (t.levels.resistance || []).slice(0, 2).forEach(function (l) {
        levels.push({ price: l.price, kind: 'r' });
      });
      (t.levels.support || []).slice(0, 2).forEach(function (l) {
        levels.push({ price: l.price, kind: 's' });
      });
    }

    var active = readTimeframe();
    var card = el('div', { class: 'chart-card' });
    host.appendChild(card);

    function draw() {
      card.innerHTML = '';
      var tf = TIMEFRAMES.filter(function (x) { return x.key === active; })[0] ||
               TIMEFRAMES[1];
      var n = Math.min(tf.sessions, full.length);
      var bars = full.slice(-n);

      var series = [];
      if (ma20Full) series.push({ values: ma20Full.slice(-n), dash: '4 3', opacity: .5 });
      if (ma50Full) series.push({ values: ma50Full.slice(-n), dash: '1 3', opacity: .45 });

      // Timeframe control.
      var buttons = el('div', { class: 'tf-group', role: 'group', 'aria-label': 'Chart timeframe' },
        TIMEFRAMES.filter(function (x) { return full.length > x.sessions * 0.5; }).map(function (x) {
          var b = el('button', {
            type: 'button', class: 'tf-btn' + (x.key === active ? ' is-active' : ''),
            'aria-pressed': x.key === active ? 'true' : 'false',
            text: x.label
          });
          b.addEventListener('click', function () {
            if (active === x.key) return;
            active = x.key;
            writeTimeframe(active);
            draw();
          });
          return b;
        }));

      var readout = el('div', { class: 'chart-readout' });
      function setReadout(bar, prev) {
        readout.innerHTML = '';
        if (!bar) {
          var last = bars[bars.length - 1];
          var before = bars[bars.length - 2];
          bar = last; prev = before;
          readout.appendChild(el('span', { class: 'ro-tag', text: 'Latest' }));
        } else {
          readout.appendChild(el('span', { class: 'ro-tag', text: fmtDate(bar.date) }));
        }
        if (!bar) return;
        [['O', bar.open], ['H', bar.high], ['L', bar.low], ['C', bar.close]].forEach(function (p) {
          if (p[1] == null) return;
          readout.appendChild(el('span', { class: 'ro-pair' }, [
            el('span', { class: 'ro-k', text: p[0] }),
            el('span', { class: 'ro-v', text: num(p[1], 2) })
          ]));
        });
        if (prev && prev.close != null && bar.close != null) {
          var ch = bar.close - prev.close;
          readout.appendChild(el('span', {
            class: 'ro-chg ' + dirClass(ch),
            text: signed(ch, 2) + ' (' + signed((ch / prev.close) * 100, 2) + '%)'
          }));
        }
      }

      card.appendChild(el('div', { class: 'chart-title' }, [
        el('span', { text: c.contract.code + ' · ' + c.unit }),
        buttons
      ]));
      card.appendChild(readout);
      card.appendChild(lineChart({
        bars: bars, series: series, levels: levels, dp: dp,
        ariaLabel: c.market + ' ' + c.contract.code + ' price history, ' + tf.label,
        onHover: function (bar, i, prev) { setReadout(bar, prev); }
      }));

      var legend = [el('span', {}, [el('span', { class: 'swatch' }), 'Settlement'])];
      if (ma20Full) legend.push(el('span', {}, [el('span', { class: 'swatch dash' }), '20-day']));
      if (ma50Full) legend.push(el('span', {}, [el('span', { class: 'swatch dot' }), '50-day']));
      var shownLevels = levels.filter(function (l) { return l.price != null; }).length;
      if (shownLevels) legend.push(el('span', {}, ['S/R where in range']));
      // Show the year when the window straddles one, otherwise a 260-session
      // range reads as "18 Aug – 28 Aug" and looks like ten days.
      var from = bars[0].date, to = bars[bars.length - 1].date;
      var spansYears = (from || '').slice(0, 4) !== (to || '').slice(0, 4);
      var fmtEnd = function (d) {
        return spansYears
          ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          : fmtDate(d);
      };
      legend.push(el('span', { class: 'legend-range', text:
        bars.length + ' sessions · ' + fmtEnd(from) + ' – ' + fmtEnd(to) }));
      card.appendChild(el('div', { class: 'chart-legend' }, legend));
      card.appendChild(cite(['Hover, tap or use arrow keys for exact figures', 'Yahoo Finance']));

      setReadout(null);
    }

    draw();
  }

  function renderTechnicals(futures) {
    var host = $('#technicals');
    host.innerHTML = '';

    ['arabica'].forEach(function (key) {
      var c = futures && futures[key];
      if (!c) return;
      var t = c.technicals;
      var dp = c.market === 'Arabica' ? 2 : 0;

      var panel = el('div', { class: 'panel' }, [
        el('h3', { text: 'Momentum & trend' }),
        el('p', { class: 'panel-sub', text: t ? (t.basis || '') : 'No history available' })
      ]);

      if (!t || t.observations < 15) {
        panel.appendChild(notice('Not enough history yet', [
          'Indicators need at least 15 sessions before they mean anything. ' +
          'Available so far: ' + (t ? t.observations : 0) + '.'
        ]));
        host.appendChild(panel);
        return;
      }

      var rows = [];
      rows.push(techRow('RSI (14)', t.rsi14 == null ? '—' : num(t.rsi14, 1),
        t.rsi14 == null ? '' : (t.rsi14 >= 70 ? 'Overbought' : t.rsi14 <= 30 ? 'Oversold' : 'Neutral')));

      if (t.macd) {
        rows.push(techRow('MACD (12,26,9)', num(t.macd.line, 2),
          t.macd.histogram >= 0 ? 'Above signal' : 'Below signal'));
        rows.push(techRow('MACD histogram', signed(t.macd.histogram, 2),
          t.macd.histogram >= 0 ? 'Momentum positive' : 'Momentum negative'));
      }

      var last = c.quote && c.quote.last;
      [['20-day mean', t.sma20], ['50-day mean', t.sma50], ['200-day mean', t.sma200]].forEach(function (p) {
        if (p[1] == null) return;
        rows.push(techRow(p[0], num(p[1], dp),
          last == null ? '' : (last >= p[1] ? 'Price above' : 'Price below')));
      });

      if (t.atr14 != null) rows.push(techRow('ATR (14)', num(t.atr14, 2), 'Daily true range'));
      if (t.donchian20) {
        rows.push(techRow('20-day range', num(t.donchian20.low, dp) + ' – ' + num(t.donchian20.high, dp), ''));
      }
      if (t.fiftyTwoWeek) {
        rows.push(techRow('Series high/low', num(t.fiftyTwoWeek.low, dp) + ' – ' + num(t.fiftyTwoWeek.high, dp), ''));
      }

      var tbody = el('tbody', {}, rows);
      panel.appendChild(el('div', { class: 'table-scroll' }, [
        el('table', { class: 'sheet' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Indicator' }),
            el('th', { class: 'num', text: 'Value' }),
            el('th', { text: 'Reading' })
          ])]),
          tbody
        ])
      ]));

      panel.appendChild(cite(['Wilder RSI(14)', 'MACD(12,26,9)', 'ATR(14)']));
      host.appendChild(panel);

      // Levels get their own panel alongside, so the pair fills the row.
      var lv = t.levels || { support: [], resistance: [] };
      var levelsPanel = el('div', { class: 'panel' }, [
        el('h3', { text: 'Support & resistance' }),
        el('p', { class: 'panel-sub', text: 'Swing highs and lows the market has actually traded to' })
      ]);

      if (lv.resistance.length || lv.support.length) {
        var lvRows = [];
        var last2 = c.quote && c.quote.last;
        lv.resistance.slice().reverse().forEach(function (l) {
          lvRows.push(levelRow('Resistance', l, last2, dp));
        });
        if (last2 != null) {
          lvRows.push(el('tr', { class: 'level-here' }, [
            el('td', { class: 'name', text: 'Last traded' }),
            el('td', { class: 'num', text: num(last2, dp) }),
            el('td', { class: 'num muted', text: '—' }),
            el('td', { class: 'muted', text: 'now' })
          ]));
        }
        lv.support.forEach(function (l) {
          lvRows.push(levelRow('Support', l, last2, dp));
        });

        levelsPanel.appendChild(el('div', { class: 'table-scroll' }, [
          el('table', { class: 'sheet' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', { text: 'Level' }),
              el('th', { class: 'num', text: 'Price' }),
              el('th', { class: 'num', text: 'Away' }),
              el('th', { text: 'Set on' })
            ])]),
            el('tbody', {}, lvRows)
          ])
        ]));
        levelsPanel.appendChild(cite(['5-bar swing pivots']));
      } else {
        levelsPanel.appendChild(notice('No clear levels', [
          'No swing pivot in the visible history sits above or below the current price.'
        ]));
      }
      host.appendChild(levelsPanel);
    });

    if (!host.children.length) {
      host.appendChild(notice('Unavailable', ['No price history was available to compute indicators from.']));
    }
  }

  function levelRow(kind, level, last, dp) {
    var away = (last != null && level.price != null)
      ? ((level.price - last) / last) * 100 : null;
    return el('tr', {}, [
      el('td', { class: 'name', text: kind }),
      el('td', { class: 'num', text: num(level.price, dp) }),
      el('td', { class: 'num muted', text: away == null ? '—' : signed(away, 1) + '%' }),
      el('td', { class: 'muted', text: fmtDate(level.date) })
    ]);
  }

  function techRow(label, value, reading) {
    return el('tr', {}, [
      el('td', { class: 'name', text: label }),
      el('td', { class: 'num', text: value }),
      el('td', { class: 'muted', text: reading })
    ]);
  }

  function renderFx(fx) {
    var host = $('#fx');
    host.innerHTML = '';
    if (!fx || !fx.pairs) {
      host.appendChild(notice('Unavailable', ['Exchange rates could not be retrieved on this run.']));
      return;
    }

    var rows = Object.keys(fx.pairs).map(function (k) {
      var p = fx.pairs[k];
      return el('tr', {}, [
        el('td', { class: 'name', text: p.pair }),
        el('td', { class: 'num', text: num(p.rate, p.dp == null ? 4 : p.dp) }),
        el('td', { class: 'num ' + dirClass(p.changePct), text: signed(p.changePct, 2) + '%' }),
        el('td', { class: 'num ' + dirClass(p.change1m), text: signed(p.change1m, 2) + '%' }),
        el('td', { class: 'muted fx-note', text: p.note || '' })
      ]);
    });

    host.appendChild(el('div', { class: 'table-scroll' }, [
      el('table', { class: 'sheet' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Pair' }),
          el('th', { class: 'num', text: 'Rate' }),
          el('th', { class: 'num', text: 'Day' }),
          el('th', { class: 'num', text: '1 month' }),
          el('th', { text: '' })
        ])]),
        el('tbody', {}, rows)
      ])
    ]));

    host.appendChild(cite(['ECB ' + (fx.asOf || '—'), 'BCB PTAX']));
  }

  /* ---------- physical market ---------- */

  /** Calendar months from one "YYYY-MM" to another, inclusive of both. */
  function monthSpan(from, to) {
    var a = from.split('-'), b = to.split('-');
    return (b[0] - a[0]) * 12 + (b[1] - a[1]) + 1;
  }

  // Which series each of the two ICO charts is showing. Remembered per chart,
  // guarded the way the timeframe is: storage throws outright in a private
  // window, and a chart that cannot remember a preference is no reason for the
  // section not to render.
  function readChoice(key, series, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      for (var i = 0; i < series.length; i++) if (series[i].key === v) return v;
    } catch (e) { /* fall through */ }
    return fallback;
  }
  function writeChoice(key, v) {
    try { window.localStorage.setItem(key, v); } catch (e) { /* not essential */ }
  }

  /**
   * One ICO table as a chart with a series picker and a table of every series'
   * latest figure.
   *
   * `points` are month records: { month, label, values: { <seriesKey>: n } }.
   * A month with no value for the chosen series is a genuine gap — certified
   * stocks lose the months whose heading ICO renders in an unmappable font —
   * and is passed through as null rather than bridged.
   */
  function icoPanel(opts) {
    var series = (opts.block && opts.block.series) || [];
    var points = (opts.block && opts.block.points) || [];

    var panel = el('div', { class: 'panel' }, [
      el('h3', { text: opts.title }),
      el('p', { class: 'panel-sub', text: opts.subtitle })
    ]);

    if (!series.length || points.length < 2) {
      panel.appendChild(notice('Not yet on record', [opts.empty]));
      return panel;
    }

    var active = readChoice(opts.storageKey, series, series[0].key);
    var body = el('div', { class: 'chart-card' });

    function draw() {
      body.innerHTML = '';
      var current = series.filter(function (s) { return s.key === active; })[0] || series[0];

      var picker = el('select', {
        class: 'series-select',
        'aria-label': opts.pickerLabel
      }, series.map(function (s) {
        var o = el('option', { value: s.key, text: s.label });
        if (s.key === active) o.selected = true;
        return o;
      }));
      picker.addEventListener('change', function () {
        active = picker.value;
        writeChoice(opts.storageKey, active);
        draw();
      });

      body.appendChild(el('div', { class: 'chart-title' }, [
        el('span', { text: opts.unit }),
        picker
      ]));

      var readout = el('div', { class: 'chart-readout' });
      function setReadout(point) {
        readout.innerHTML = '';
        var p = point || points[points.length - 1];
        var v = p && p.values ? p.values[current.key] : null;
        readout.appendChild(el('span', { class: 'ro-tag', text: point ? p.label : 'Latest' }));
        readout.appendChild(el('span', { class: 'ro-pair' }, [
          el('span', { class: 'ro-k', text: current.label }),
          el('span', { class: 'ro-v', text: v == null ? 'no figure' : num(v, opts.dp) })
        ]));
      }
      body.appendChild(readout);

      // lineChart plots by index and reads `close` and `date`, so the monthly
      // records are mapped onto that shape. Months are evenly spaced, which is
      // exactly what an index axis assumes.
      var bars = points.map(function (p) {
        var v = p.values ? p.values[current.key] : null;
        return { date: p.month + '-01', close: v == null ? null : v, label: p.label };
      }).filter(function (b) { return b.close != null; });

      if (bars.length < 2) {
        body.appendChild(notice('Not enough history', [
          'Fewer than two months of ' + current.label + ' are on record, so there is nothing to plot.'
        ]));
      } else {
        body.appendChild(lineChart({
          bars: bars,
          dp: opts.dp,
          ariaLabel: current.label + ', ' + bars.length + ' months',
          onHover: function (bar) {
            setReadout(bar ? { label: bar.label, values: pointValues(points, bar.date) } : null);
          }
        }));
        // A month with no figure is dropped from the line, which means the
        // line joins the months either side of it and the gap becomes
        // invisible. Say how many are missing, beside the chart that hides
        // them — the alternative is a reader counting a straight segment as
        // two months of stability.
        var missing = monthSpan(points[0].month, points[points.length - 1].month) - bars.length;
        var legend = [el('span', {}, [el('span', { class: 'swatch' }), current.label])];
        if (missing > 0) {
          legend.push(el('span', { class: 'legend-gap',
            text: missing + (missing === 1 ? ' month not readable' : ' months not readable') }));
        }
        legend.push(el('span', { class: 'legend-range', text:
          bars.length + ' months · ' + points[0].label + ' – ' + points[points.length - 1].label }));
        body.appendChild(el('div', { class: 'chart-legend' }, legend));
      }

      setReadout(null);
    }

    function pointValues(all, date) {
      var month = (date || '').slice(0, 7);
      for (var i = 0; i < all.length; i++) if (all[i].month === month) return all[i].values;
      return null;
    }

    draw();
    panel.appendChild(body);

    // Every series' latest figure, so the chart's one line is not the only
    // thing on offer. The month-on-month change is derived from the two months
    // beside it, never from a different series.
    var latest = points[points.length - 1];
    var prior = points[points.length - 2];
    panel.appendChild(el('div', { class: 'table-scroll' }, [
      el('table', { class: 'sheet' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: opts.rowHead }),
          el('th', { class: 'num', text: latest.label }),
          el('th', { class: 'num', text: 'On the month' })
        ])]),
        el('tbody', {}, series.map(function (s) {
          var now = latest.values ? latest.values[s.key] : null;
          var was = prior.values ? prior.values[s.key] : null;
          var change = (now == null || was == null) ? null : now - was;
          return el('tr', {}, [
            el('td', { class: 'name', text: s.label }),
            el('td', { class: 'num', text: now == null ? '—' : num(now, opts.dp) }),
            el('td', {
              class: 'num' + (opts.colourChange && change != null ? ' ' + dirClass(change) : ''),
              text: change == null ? '—' : signed(change, opts.dp)
            })
          ]);
        }))
      ])
    ]));

    panel.appendChild(opts.cite());
    return panel;
  }

  function renderPhysical(data) {
    var host = $('#physical');
    host.innerHTML = '';

    var ico = data.ico;
    if (!ico) {
      host.appendChild(notice('No verified source', [
        'The ICO Coffee Market Report could not be read on this run and nothing is on record ' +
        'from an earlier one, so no physical-market figure is shown.',
        'Nothing is estimated in its place.'
      ]));
      return;
    }

    var reportCite = function (scope) {
      return function () {
        return cite([
          el('a', {
            href: ico.report.url, target: '_blank', rel: 'noopener noreferrer',
            text: 'ICO Coffee Market Report, ' + ico.report.label
          }),
          scope
        ]);
      };
    };

    host.appendChild(icoPanel({
      block: ico.indicators,
      title: 'Origin group prices',
      subtitle: 'ICO indicator prices by origin and quality group',
      unit: ico.unit,
      dp: 2,
      colourChange: true,
      rowHead: 'Group',
      storageKey: 'coffeedesk.icoGroup',
      pickerLabel: 'Origin group to chart',
      empty: 'No ICO indicator prices are on record yet.',
      cite: reportCite('monthly averages')
    }));

    host.appendChild(icoPanel({
      block: ico.differentials,
      title: 'Group differentials',
      subtitle: 'The spread between one ICO group indicator and another',
      unit: ico.unit,
      dp: 2,
      colourChange: true,
      rowHead: 'Pair',
      storageKey: 'coffeedesk.icoPair',
      pickerLabel: 'Differential to chart',
      empty: 'No ICO differentials are on record yet.',
      cite: reportCite('monthly averages')
    }));

    var lower = el('div', { class: 'phys-grid' });

    lower.appendChild(icoPanel({
      block: ico.certifiedStocks,
      title: 'Certified stocks',
      subtitle: 'Exchange-graded coffee in licensed warehouses',
      unit: ico.stocksUnit,
      dp: 2,
      // Stock levels are inventory, not price. Green and red are reserved for
      // price direction and weather risk, so this change stays monochrome.
      colourChange: false,
      rowHead: 'Market',
      storageKey: 'coffeedesk.icoStocks',
      pickerLabel: 'Market to chart',
      empty: 'No ICO certified stock figures are on record yet.',
      cite: reportCite('monthly, month-end')
    }));

    // What ICO does not publish, said plainly beside what it does. This panel
    // exists because the gap is the point: a reader comparing origins needs to
    // know these are quality groups, not marks, and that no certification
    // series exists at all.
    var scope = el('div', { class: 'panel' }, [
      el('h3', { text: 'What this is not' }),
      el('p', { class: 'panel-sub', text: 'The limits of the only free source that publishes any of this' }),
      el('p', { text:
        'ICO reports origin and quality groups — Colombian Milds, Other Milds, Brazilian ' +
        'Naturals, Robustas — and the spreads between them. These are not the FOB ' +
        'differentials a broker quotes against the C contract for a named mark.' }),
      el('p', { text:
        'No certification breakdown is published anywhere free: there is no Fairtrade, Organic ' +
        'or Rainforest series here because no source returned one.' })
    ]);

    // A hand-entered override, if anyone has put one in. Empty is the norm.
    var manual = data.differentials;
    if (manual && manual.entries && manual.entries.length) {
      scope.appendChild(el('div', { class: 'table-scroll' }, [
        el('table', { class: 'sheet' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Origin' }),
            el('th', { text: 'Grade' }),
            el('th', { class: 'num', text: 'Diff' }),
            el('th', { text: 'Period' })
          ])]),
          el('tbody', {}, manual.entries.map(function (e) {
            return el('tr', {}, [
              el('td', { class: 'name', text: e.origin || '—' }),
              el('td', { text: e.grade || '—' }),
              el('td', { class: 'num', text: (e.differential == null ? '—' : signed(e.differential, 2)) + ' ' + (e.unit || '') }),
              el('td', { class: 'muted', text: e.period || '—' })
            ]);
          }))
        ])
      ]));
      scope.appendChild(cite([
        'Hand-entered from ' + (manual.sourceDocument || 'a trade document'),
        'updated ' + fmtDateTime(manual.updatedAt),
        'not machine-verified'
      ]));
    }

    lower.appendChild(scope);
    host.appendChild(lower);
  }

  function renderBrief(brief) {
    var host = $('#brief');
    host.innerHTML = '';

    if (!brief || !brief.sentences || !brief.sentences.length) {
      host.appendChild(notice('No brief today', [
        'Too few figures were retrieved on this run to say anything useful about the market ' +
        'without reaching for numbers that are not here.'
      ]));
      return;
    }

    host.appendChild(el('p', { class: 'brief-body',
      text: brief.sentences.map(function (s) { return s.text; }).join(' ') }));

    host.appendChild(cite([
      'Composed by rule from the figures on this page',
      'no language model, no figure introduced',
      brief.sentences.length + ' observations'
    ]));
  }

  /**
   * Condition icons. Drawn rather than pulled from a font so they inherit
   * currentColor and stay crisp in both themes: sun, sun behind cloud, cloud
   * with drops, cloud with heavier drops.
   */
  function conditionIcon(condition, label) {
    // Decorative: the condition is always written out in words beside it, so
    // announcing the icon as well would just repeat itself. The <title> stays
    // for the mouse tooltip.
    var svg = svgEl('svg', {
      viewBox: '0 0 24 24', width: 16, height: 16,
      class: 'wx-icon wx-icon-' + (condition || 'unknown'),
      'aria-hidden': 'true', focusable: 'false',
      fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    });
    var t = document.createElementNS(SVG_NS, 'title');
    t.textContent = label || 'Condition unknown';
    svg.appendChild(t);

    function add(tag, attrs) { svg.appendChild(svgEl(tag, attrs)); }
    var CLOUD = 'M7.5 18h9a3.5 3.5 0 0 0 .3-6.99A5 5 0 0 0 7.2 10.2 3.4 3.4 0 0 0 7.5 18Z';

    if (condition === 'dry') {
      add('circle', { cx: 12, cy: 12, r: 4 });
      // Eight rays.
      [[12,2,12,4.4],[12,19.6,12,22],[2,12,4.4,12],[19.6,12,22,12],
       [5,5,6.7,6.7],[17.3,17.3,19,19],[19,5,17.3,6.7],[6.7,17.3,5,19]]
        .forEach(function (r) { add('line', { x1: r[0], y1: r[1], x2: r[2], y2: r[3] }); });
    } else if (condition === 'cloudy') {
      add('circle', { cx: 8.5, cy: 8, r: 3, opacity: .55 });
      add('path', { d: CLOUD });
    } else if (condition === 'wet') {
      add('path', { d: CLOUD.replace('18h9', '15h9').replace('cy', 'cy') });
      add('path', { d: 'M7.5 15h9a3.5 3.5 0 0 0 .3-6.99A5 5 0 0 0 7.2 7.2 3.4 3.4 0 0 0 7.5 15Z' });
      add('line', { x1: 9, y1: 18, x2: 8.2, y2: 20.5 });
      add('line', { x1: 14, y1: 18, x2: 13.2, y2: 20.5 });
    } else if (condition === 'very-wet') {
      add('path', { d: 'M7.5 14h9a3.5 3.5 0 0 0 .3-6.99A5 5 0 0 0 7.2 6.2 3.4 3.4 0 0 0 7.5 14Z' });
      add('line', { x1: 8, y1: 16.5, x2: 7, y2: 20 });
      add('line', { x1: 11.5, y1: 16.5, x2: 10.5, y2: 21 });
      add('line', { x1: 15, y1: 16.5, x2: 14, y2: 20 });
      add('line', { x1: 18, y1: 16.5, x2: 17.2, y2: 18.8 });
    } else {
      add('circle', { cx: 12, cy: 12, r: 8, opacity: .3, 'stroke-dasharray': '2 3' });
    }
    return svg;
  }

  function renderWeather(wx) {
    var host = $('#weather');
    host.innerHTML = '';
    if (!wx || !wx.regions) {
      host.appendChild(notice('Unavailable', ['Weather data could not be retrieved on this run.']));
      return;
    }

    // Group by country, in the order the pipeline declares, so the table reads
    // country-then-region rather than as a flat list.
    var order = wx.countryOrder || [];
    var byCountry = {};
    wx.regions.forEach(function (r) {
      (byCountry[r.country] = byCountry[r.country] || []).push(r);
    });
    var countries = Object.keys(byCountry).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    var body = [];
    countries.forEach(function (country) {
      body.push(el('tr', { class: 'country-row' }, [
        el('th', { colspan: 5, scope: 'rowgroup', class: 'country-head', text: country })
      ]));

      byCountry[country].forEach(function (r) {
        if (r.error) {
          body.push(el('tr', {}, [
            el('td', { class: 'name region-cell', text: r.name }),
            el('td', { colspan: 4, class: 'err', text: 'unavailable' })
          ]));
          return;
        }
        var flags = (r.alerts || []).map(function (a) {
          return el('span', { class: 'wx-flag ' + a.type, text: a.type, title: a.text });
        });

        // Icon and words together: the picture is scannable, the text is
        // unambiguous, and neither has to be guessed from the other.
        var nameCell = el('td', { class: 'name region-cell' }, [
          el('span', { class: 'wx-icon-wrap' }, [conditionIcon(r.condition, r.conditionLabel)]),
          el('span', { class: 'region-name', text: r.name }),
          r.conditionLabel
            ? el('span', { class: 'wx-cond wx-cond-' + r.condition, text: r.conditionLabel })
            : null
        ].concat(flags));

        body.push(el('tr', {}, [
          nameCell,
          el('td', {}, [el('span', { class: 'species', text: r.species })]),
          el('td', { class: 'num', text: r.current && r.current.tMax != null ? num(r.current.tMax, 0) + '°' : '—' }),
          el('td', { class: 'num', text: r.minForecast7 == null ? '—' : num(r.minForecast7, 0) + '°' }),
          el('td', { class: 'num', text: r.rain14 == null ? '—' : num(r.rain14, 0) })
        ]));
      });
    });

    host.appendChild(el('div', { class: 'table-scroll' }, [
      el('table', { class: 'sheet wx-sheet' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Region' }),
          el('th', { text: 'Type' }),
          el('th', { class: 'num', text: 'Max °C obs' }),
          el('th', { class: 'num', text: 'Min °C fc' }),
          el('th', { class: 'num', text: 'Rain 14d' })
        ])]),
        el('tbody', {}, body)
      ])
    ]));

    // Icon key, so the pictures are never guesswork.
    var key = el('div', { class: 'wx-key' }, [
      el('span', { class: 'wx-key-label', text: 'Conditions' })
    ]);
    [['dry', 'Clear / dry'], ['cloudy', 'Cloudy'], ['wet', 'Wet'], ['very-wet', 'Very wet']]
      .forEach(function (c) {
        key.appendChild(el('span', { class: 'wx-key-item' }, [
          conditionIcon(c[0], c[1]), el('span', { text: c[1] })
        ]));
      });
    host.appendChild(key);

    var alerts = [];
    wx.regions.forEach(function (r) {
      (r.alerts || []).forEach(function (a) { alerts.push(r.country + ', ' + r.name + ' — ' + a.text); });
    });
    if (alerts.length) {
      host.appendChild(el('div', { class: 'notice' }, [
        el('div', { class: 'notice-head', text: 'Flagged this morning' })
      ].concat(alerts.map(function (t) { return el('p', { text: t }); }))));
    }

    host.appendChild(cite(['Open-Meteo', '12 regions', 'flags are rules, not forecasts']));
  }

  var reducedMotion = (function () {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  })();

  /**
   * A slide-at-a-time reader. One story is composited at a time, so unlike the
   * scrolling ticker it replaced there is no enormous animated lane to run into
   * the browser's texture limit, and there is room for a summary.
   *
   * Auto-advance stops for good once the reader touches a control: a slider
   * that keeps moving after you have taken charge of it is hostile.
   */
  function slider(slides, opts) {
    opts = opts || {};
    var interval = (opts.seconds || 10) * 1000;
    var i = 0, timer = null, surrendered = reducedMotion;

    var track = el('div', { class: 'slider-track' }, slides.map(function (mk, n) {
      var s = el('div', { class: 'slide' + (n === 0 ? ' is-current' : '') }, [mk()]);
      if (n !== 0) s.setAttribute('aria-hidden', 'true');
      return s;
    }));

    var dots = el('div', { class: 'slider-dots', role: 'tablist', 'aria-label': 'Choose a story' },
      slides.map(function (_, n) {
        var d = el('button', {
          type: 'button', class: 'slider-dot' + (n === 0 ? ' is-current' : ''),
          role: 'tab', 'aria-selected': n === 0 ? 'true' : 'false',
          'aria-label': 'Story ' + (n + 1) + ' of ' + slides.length
        });
        d.addEventListener('click', function () { surrender(); go(n); });
        return d;
      }));

    function go(n) {
      var next = (n + slides.length) % slides.length;
      if (next === i) return;
      var kids = track.children;
      kids[i].classList.remove('is-current');
      kids[i].setAttribute('aria-hidden', 'true');
      kids[next].classList.add('is-current');
      kids[next].removeAttribute('aria-hidden');
      dots.children[i].classList.remove('is-current');
      dots.children[i].setAttribute('aria-selected', 'false');
      dots.children[next].classList.add('is-current');
      dots.children[next].setAttribute('aria-selected', 'true');
      i = next;
      counter.textContent = (i + 1) + ' / ' + slides.length;
    }

    function start() { if (!surrendered && !timer) timer = setInterval(function () { go(i + 1); }, interval); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function surrender() { surrendered = true; stop(); }

    var prev = el('button', { type: 'button', class: 'slider-nav', 'aria-label': 'Previous story', text: '‹' });
    var next = el('button', { type: 'button', class: 'slider-nav', 'aria-label': 'Next story', text: '›' });
    prev.addEventListener('click', function () { surrender(); go(i - 1); });
    next.addEventListener('click', function () { surrender(); go(i + 1); });

    var counter = el('span', { class: 'slider-count', text: '1 / ' + slides.length });

    var wrap = el('div', { class: 'slider' }, [
      el('div', { class: 'slider-head' }, [
        opts.label ? el('span', { class: 'slider-label', text: opts.label }) : null,
        el('div', { class: 'slider-controls' }, [prev, counter, next])
      ]),
      // aria-live off: an auto-advancing region must not interrupt a screen
      // reader mid-sentence. The controls are the way in.
      el('div', { class: 'slider-window', 'aria-live': 'off' }, [track]),
      dots
    ]);

    wrap.addEventListener('mouseenter', stop);
    wrap.addEventListener('mouseleave', start);
    wrap.addEventListener('focusin', stop);
    wrap.addEventListener('focusout', start);

    // Timers keep firing in a hidden tab while the fade is frozen, so a reader
    // coming back would find the slider several stories along for no reason.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });

    if (!document.hidden) start();
    return wrap;
  }

  function renderOriginWire(wire) {
    var host = $('#origin-wire');
    host.innerHTML = '';
    if (!wire) {
      host.appendChild(notice('Unavailable', ['The origin wire could not be retrieved on this run.']));
      return;
    }
    if (!wire.headlines || !wire.headlines.length) {
      host.appendChild(notice('Quiet on the wire', [
        'No story from the growing regions appeared across ' + wire.feedsQueried +
        ' feeds in the last ' + Math.round(wire.lookbackHours / 24) + ' days.'
      ]));
      return;
    }

    host.appendChild(slider(wire.headlines.map(function (h) {
      return function () {
        var kids = [
          el('div', { class: 'slide-meta' }, [
            el('span', { class: 'slide-region', text: h.region }),
            el('span', { class: 'slide-pub', text: h.publisher }),
            // The wire runs three weeks deep because the origins are not
            // covered daily, so every story states its age rather than
            // implying it is new.
            el('span', { class: 'slide-age', text: relTime(h.published) || fmtDate(h.published) })
          ]),
          el('h3', { class: 'slide-title' }, [
            el('a', { href: h.url, target: '_blank', rel: 'noopener noreferrer', text: h.title })
          ])
        ];
        // Not every feed carries a standfirst; the slide simply runs shorter.
        if (h.summary) kids.push(el('p', { class: 'slide-summary', text: clip(h.summary, 260) }));
        return el('article', { class: 'slide-body' }, kids);
      };
    }), { label: 'Origin wire', seconds: 10 }));

    host.appendChild(cite([
      'BBC, Guardian, FT, Al Jazeera, VnExpress',
      wire.totalTagged + ' matched, ' + wire.headlines.length + ' shown',
      Math.round(wire.lookbackHours / 24) + '-day window'
    ]));
  }

  function renderRoundup(roundup) {
    var host = $('#roundup');
    host.innerHTML = '';
    if (!roundup || !roundup.items || !roundup.items.length) {
      host.appendChild(notice('Recap unavailable', [
        'No coffee trade feed returned a story inside the past week, so there is no recap ' +
        'to show.',
        'Nothing is shown here rather than a stale or invented list.'
      ]));
      return;
    }

    // Assembled from several publishers rather than lifted from one weekly
    // article, so the credit is a list of who is represented today.
    host.appendChild(el('p', { class: 'roundup-source' },
      (roundup.publishers || []).map(function (p) {
        return el('span', { class: 'badge', text: p });
      })));

    // A weekly digest of one-line headlines: a static list reads far better
    // than motion, and there are no summaries to slide through anyway.
    // Sections that matter to someone buying physical coffee come first; the
    // rest keep the order the recap gave them.
    var PRIORITY = ['Top stories of the week', 'Trade & production'];
    var groups = [];
    var bySection = {};
    roundup.items.forEach(function (it) {
      var s = it.section || 'Other';
      if (!bySection[s]) { bySection[s] = []; groups.push(s); }
      bySection[s].push(it);
    });
    groups.sort(function (a, b) {
      var ia = PRIORITY.indexOf(a), ib = PRIORITY.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    var list = el('div', { class: 'recap' });
    groups.forEach(function (s) {
      var block = el('section', { class: 'recap-group' }, [
        el('h3', { class: 'recap-head', text: s })
      ]);
      var ul = el('ul', { class: 'recap-list' }, bySection[s].map(function (it) {
        var label = el('span', { class: 'recap-text', text: it.headline });
        return el('li', {}, [
          el('span', { class: 'recap-date', text: it.date || '' }),
          it.url
            ? el('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, [label])
            : label,
          // Several publishers now, so each headline says whose it is.
          it.publisher ? el('span', { class: 'recap-pub', text: it.publisher }) : null
        ]);
      }));
      block.appendChild(ul);
      list.appendChild(block);
    });
    host.appendChild(list);

    host.appendChild(cite([
      roundup.items.length + ' headlines from ' + (roundup.publishers || []).length + ' publishers',
      'past ' + (roundup.windowDays || 7) + ' days',
      'ranked by relevance to the physical trade'
    ]));
  }

  function renderDailyRead(daily) {
    var host = $('#daily-read');
    host.innerHTML = '';
    if (!daily || !daily.article) {
      host.appendChild(notice('Unavailable', [
        'No Daily Coffee News article could be retrieved on this run.'
      ]));
      return;
    }
    var a = daily.article;
    var kids = [
      el('h3', {}, [el('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', text: a.title })])
    ];
    if (a.summary) kids.push(el('p', { text: a.summary }));
    kids.push(el('div', { class: 'byline' }, [
      el('span', { class: 'pub', text: a.publisher }),
      ' · ' + (relTime(a.published) || fmtDate(a.published))
    ]));
    host.appendChild(el('div', { class: 'story story-single' }, kids));
    host.appendChild(cite([
      'Daily Coffee News',
      '1 of ' + (daily.considered || 0),
      'publisher’s own summary'
    ]));
  }

  function renderSources(data) {
    var host = $('#source-list');
    host.innerHTML = '';

    var groups = [];
    function addGroup(title, sources) {
      if (!sources || !sources.length) return;
      groups.push(el('div', { class: 'src-group' }, [
        el('h4', { text: title }),
        el('ul', {}, sources.map(function (s) {
          return el('li', {}, [
            el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.name }),
            s.role ? ' — ' + s.role : null
          ]);
        }))
      ]));
    }

    if (data.futures) {
      if (data.futures.arabica) addGroup('Arabica futures', data.futures.arabica.sources);
    }
    if (data.fx) addGroup('Currency', data.fx.sources);
    if (data.weather) addGroup('Weather', data.weather.sources);
    if (data.ico) {
      addGroup('Physical market', [{
        name: 'ICO Coffee Market Report, ' + data.ico.report.label,
        url: data.ico.report.url,
        role: 'indicator prices, group differentials and certified stocks, parsed from the ' +
              'published PDF'
      }]);
    }

    groups.push(el('div', { class: 'src-group' }, [
      el('h4', { text: 'News' }),
      el('ul', {}, [
        el('li', { text: 'Origin wire: BBC News, The Guardian, Financial Times and Al Jazeera, each from that publisher’s own syndication feed.' }),
        el('li', { text:
          'Weekly recap: Daily Coffee News, Fresh Cup, the Specialty Coffee Association, ' +
          'World Coffee Portal and Sprudge, each from that publisher’s own feed. The week’s ' +
          'stories are ranked here by their relevance to the physical trade; the headlines ' +
          'and links are the publishers’ own.' }),
        el('li', {}, [
          'Today’s read: ',
          el('a', { href: 'https://dailycoffeenews.com/', target: '_blank', rel: 'noopener noreferrer', text: 'Daily Coffee News' })
        ])
      ])
    ]));

    // The reasoning that used to sit under every table lives here instead, so
    // the page above stays readable and nothing is actually lost.
    var wx = data.weather || {};
    var th = wx.thresholds || {};
    var t = data.futures && data.futures.arabica && data.futures.arabica.technicals;
    var wire = (data.news || {}).originWire || {};

    var method = [];
    if (t) {
      method.push(['Indicators',
        (t.method || '') + ' Computed on ' + (data.futures.arabica.barsAnalysed || t.observations) +
        ' daily bars; the chart draws the most recent ' +
        (data.futures.arabica.barsPublished || 0) + '.']);
    }
    method.push(['Support & resistance',
      'A level is a bar whose high (or low) was the highest (or lowest) within five sessions ' +
      'either side — a price the market actually turned at, not a line drawn by eye.']);
    method.push(['Forward curve',
      'Later months trading above the near month is carry; below it is backwardation, which ' +
      'usually means the market wants coffee now.']);
    var ptaxLine = 'Each pair is requested in its own quoting convention rather than fetched ' +
      'in one base and inverted, so the rate shown is the rate the source published.';
    var ptax = data.fx && data.fx.ptax;
    var brl = data.fx && data.fx.pairs && data.fx.pairs.USDBRL;
    if (ptax && ptax.sell != null && brl && brl.rate != null) {
      ptaxLine += ' USD/BRL is cross-checked against Banco Central do Brasil’s official ' +
        'PTAX fixing, which reads ' + num(ptax.sell, 4) + ' against the ECB’s ' +
        num(brl.rate, 4) + ' — a gap of ' + num(Math.abs(ptax.sell - brl.rate), 4) + '.';
    }
    method.push(['Currency', ptaxLine]);
    if (wx.conditionMethod) {
      method.push(['Weather conditions', wx.conditionMethod]);
    }
    method.push(['Weather columns',
      '"Max °C obs" is the highest temperature on the most recent observed day. ' +
      '"Min °C fc" is the lowest in the seven-day forecast — the frost warning for Brazil, ' +
      'which is why it looks forward while the columns beside it look back. ' +
      '"Rain 14d" is observed rainfall over the past fortnight.']);
    if (th.frostC != null) {
      method.push(['Weather flags',
        'Rule-based, and descriptions of weather rather than forecasts of price: frost at or ' +
        'below ' + th.frostC + '°C in a Brazilian region, wet above ' + th.heavyRainMm +
        ' mm forecast over seven days, dry at or below ' + th.dryMm +
        ' mm observed over fourteen. "Max °C" is the most recent observed day.']);
    }
    if (wire.lookbackHours) {
      method.push(['Origin wire',
        'Headlines are tagged to a region by the countries and cities they name, and the slider ' +
        'rotates between regions so one busy country cannot crowd out the rest. The window is ' +
        Math.round(wire.lookbackHours / 24) + ' days because these origins are not covered daily ' +
        'by the international press — every headline carries its own age.']);
    }
    if (data.ico) {
      var stocks = data.ico.certifiedStocks || {};
      var stockLine = 'Certified stocks are ICO’s monthly figure for the New York and London ' +
        'markets, not a daily exchange print.';
      // Two or three of ICO's month headings are drawn in a subset font with
      // no character map, so those columns cannot be read. They are dropped.
      // Saying so is the point: the alternative was to count along from a
      // readable neighbour, which would be a guess wearing a figure's clothes.
      if ((stocks.points || []).length) {
        stockLine += ' Some months are absent because ICO renders their column heading in a ' +
          'font with no character map: the figure is there but the month it belongs to cannot ' +
          'be read, so the column is dropped rather than inferred from its neighbours.';
      }
      method.push(['Physical market', stockLine]);
      method.push(['What ICO does not publish', data.ico.note +
        ' Each report re-states the preceding year, so a figure ICO later revises is recorded ' +
        'as a revision rather than quietly replaced.']);
    }
    if (data.brief) {
      method.push(['The brief', data.brief.method +
        ' Each sentence is produced by a rule that runs only when every figure it would name is ' +
        'present; a missing input drops the sentence rather than softening it.']);
    }
    method.push(['Missing data',
      'Where a source fails or none exists, the section says so. No figure on this page is ' +
      'estimated, interpolated or carried forward.']);

    groups.push(el('div', { class: 'src-group' }, [
      el('h4', { text: 'Method' }),
      el('dl', { class: 'method-list' }, method.reduce(function (acc, m) {
        acc.push(el('dt', { text: m[0] }));
        acc.push(el('dd', { text: m[1] }));
        return acc;
      }, []))
    ]));

    groups.forEach(function (g) { host.appendChild(g); });

    // Per-run fetch log: what worked, what did not.
    if (data.status && data.status.length) {
      var rows = data.status.map(function (s) {
        return el('tr', {}, [
          el('td', { class: 'name', text: s.source }),
          el('td', { text: s.ok ? 'ok' : 'failed', class: s.ok ? '' : 'err' }),
          el('td', { class: 'num muted', text: s.ms + ' ms' }),
          el('td', { class: 'muted', text: s.error || '' })
        ]);
      });
      host.appendChild(el('div', { class: 'table-scroll' }, [
        el('table', { class: 'sheet', style: 'margin-top:.6rem' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Source' }),
            el('th', { text: 'Result' }),
            el('th', { class: 'num', text: 'Took' }),
            el('th', { text: 'Detail' })
          ])]),
          el('tbody', {}, rows)
        ])
      ]));
    }
  }

  // ---------- boot ----------

  function fail(message) {
    $('#board').innerHTML = '';
    $('#board').appendChild(notice('Could not load', [message]));
    $('#generated-at').textContent = 'Load failed';
  }

  function render(data) {
    var d = new Date(data.generatedAt || Date.now());
    $('#edition-date').textContent = d.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    $('#generated-at').textContent = 'Updated ' + fmtDateTime(data.generatedAt);
    document.title = 'The Coffee Desk — ' + d.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    });

    renderBoard(data.futures);
    renderBrief(data.brief);
    renderCharts(data.futures);
    renderTechnicals(data.futures);
    renderFx(data.fx);
    renderPhysical(data);
    renderWeather(data.weather);
    var news = data.news || {};
    renderOriginWire(news.originWire);
    renderRoundup(news.roundup);
    renderDailyRead(news.dailyRead);
    renderSources(data);

    var okCount = (data.status || []).filter(function (s) { return s.ok; }).length;
    $('#build-status').textContent =
      'This edition: ' + okCount + ' of ' + (data.status || []).length +
      ' sources retrieved successfully at ' + fmtDateTime(data.generatedAt) + '.';
  }

  fetch('data/latest.json?t=' + Date.now(), { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(render)
    .catch(function (err) {
      fail('The data file could not be read (' + err.message +
           '). If this site has just been set up, the scheduled fetch may not have run yet.');
    });
})();
