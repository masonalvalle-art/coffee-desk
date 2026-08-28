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

  /** Shorten a headline for a ticker, on a word boundary where possible. */
  function clip(s, n) {
    if (!s) return '';
    if (s.length <= n) return s;
    var cut = s.slice(0, n);
    var sp = cut.lastIndexOf(' ');
    return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…';
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
   * A deliberately plain line chart: hairline axes, no fills, no gradients.
   * Draws the close series, optional moving averages, and horizontal
   * support/resistance rules taken from real swing pivots.
   */
  function lineChart(opts) {
    var bars = opts.bars || [];
    var W = 620, H = 260;
    var m = { top: 14, right: 54, bottom: 26, left: 8 };

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

    var closes = bars.map(function (b) { return b.close; });
    var extraSeries = (opts.series || []).filter(function (s) { return s.values && s.values.length; });

    var all = closes.slice();
    extraSeries.forEach(function (s) {
      s.values.forEach(function (v) { if (v != null) all.push(v); });
    });
    (opts.levels || []).forEach(function (l) { all.push(l.price); });

    var lo = Math.min.apply(null, all);
    var hi = Math.max.apply(null, all);
    var pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;

    var plotW = W - m.left - m.right;
    var plotH = H - m.top - m.bottom;
    var x = function (i) { return m.left + (i / (bars.length - 1)) * plotW; };
    var y = function (v) { return m.top + (1 - (v - lo) / (hi - lo)) * plotH; };

    // Horizontal gridlines with right-hand price labels.
    var ticks = 4;
    for (var g = 0; g <= ticks; g++) {
      var val = lo + (hi - lo) * (g / ticks);
      var yy = y(val);
      svg.appendChild(svgEl('line', {
        x1: m.left, y1: yy, x2: W - m.right, y2: yy,
        stroke: 'currentColor', 'stroke-width': 0.5, opacity: 0.13
      }));
      var lbl = svgEl('text', {
        x: W - m.right + 6, y: yy + 3.5, 'font-size': 9.5,
        fill: 'currentColor', opacity: .55,
        'font-family': 'IBM Plex Mono, monospace'
      });
      lbl.textContent = num(val, opts.dp == null ? 0 : opts.dp);
      svg.appendChild(lbl);
    }

    // Support / resistance as dotted rules.
    (opts.levels || []).forEach(function (l) {
      var yy = y(l.price);
      svg.appendChild(svgEl('line', {
        x1: m.left, y1: yy, x2: W - m.right, y2: yy,
        stroke: 'currentColor', 'stroke-width': 1,
        'stroke-dasharray': '1 4', opacity: .5
      }));
      var tag = svgEl('text', {
        x: m.left + 4, y: yy - 4, 'font-size': 8.5,
        fill: 'currentColor', opacity: .65,
        'font-family': 'IBM Plex Mono, monospace'
      });
      tag.textContent = (l.kind === 'r' ? 'R ' : 'S ') + num(l.price, opts.dp == null ? 0 : opts.dp);
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

    // Last point, marked and labelled.
    var lastI = closes.length - 1;
    svg.appendChild(svgEl('circle', {
      cx: x(lastI), cy: y(closes[lastI]), r: 2.6, fill: 'currentColor'
    }));

    // Date axis: first, middle, last.
    [0, Math.floor((bars.length - 1) / 2), bars.length - 1].forEach(function (i, k) {
      var tx = svgEl('text', {
        x: x(i), y: H - 8, 'font-size': 9,
        fill: 'currentColor', opacity: .5,
        'text-anchor': k === 0 ? 'start' : (k === 2 ? 'end' : 'middle'),
        'font-family': 'IBM Plex Mono, monospace'
      });
      tx.textContent = fmtDate(bars[i].date);
      svg.appendChild(tx);
    });

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
          el('div', { class: 'contract-kicker' }, [el('span', { text: 'Forward curve' })]),
          el('h3', { class: 'contract-name', text: 'The rest of the board' }),
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
          el('p', { class: 'panel-foot', text: 'Later months trading above the near month is carry; below it is backwardation, which usually means the market wants coffee now.' })
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

  function renderCharts(futures) {
    var host = $('#charts');
    host.innerHTML = '';

    ['arabica'].forEach(function (key) {
      var c = futures && futures[key];
      if (!c) return;
      var bars = (c.bars || []).slice(-180);
      var dp = c.market === 'Arabica' ? 0 : 0;
      var closes = bars.map(function (b) { return b.close; });

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

      var series = [];
      if (closes.length >= 20) {
        series.push({ values: movingAverage(closes, 20), dash: '4 3', opacity: .5 });
      }
      if (closes.length >= 50) {
        series.push({ values: movingAverage(closes, 50), dash: '1 3', opacity: .45 });
      }

      var legend = [el('span', {}, [
        el('span', { class: 'swatch' }), 'Settlement'
      ])];
      if (closes.length >= 20) legend.push(el('span', {}, [el('span', { class: 'swatch dash' }), '20-day']));
      if (closes.length >= 50) legend.push(el('span', {}, [el('span', { class: 'swatch dash' }), '50-day']));
      if (levels.length) legend.push(el('span', {}, ['S/R from swing pivots']));

      var card = el('div', { class: 'chart-card' }, [
        el('div', { class: 'chart-title' }, [
          el('span', { text: c.contract.code + ' · ' + c.unit }),
          el('span', { text: bars.length + ' sessions' })
        ]),
        lineChart({
          bars: bars, series: series, levels: levels, dp: dp,
          ariaLabel: c.market + ' ' + c.contract.code + ' price history'
        }),
        el('div', { class: 'chart-legend' }, legend)
      ]);

      if (c.historyNote && bars.length < 40) {
        card.appendChild(el('p', { class: 'panel-foot', text: c.historyNote }));
      }

      host.appendChild(card);
    });

    if (!host.children.length) {
      host.appendChild(notice('No charts', ['No price history was available on this run.']));
    }
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

      panel.appendChild(el('p', { class: 'panel-foot', text: t.method || '' }));
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
        levelsPanel.appendChild(el('p', {
          class: 'panel-foot',
          text: 'A level is a bar whose high (or low) was the highest (or lowest) within five ' +
                'sessions either side — a price the market turned at, not a line drawn by eye.'
        }));
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
        el('td', { class: 'num', text: num(p.rate, 4) }),
        el('td', { class: 'num ' + dirClass(p.changePct), text: signed(p.changePct, 2) + '%' }),
        el('td', { class: 'num ' + dirClass(p.change1m), text: signed(p.change1m, 2) + '%' })
      ]);
    });

    if (fx.ptax && fx.ptax.sell != null) {
      rows.push(el('tr', {}, [
        el('td', { class: 'name' }, [
          'USD/BRL ',
          el('span', { class: 'badge', text: 'PTAX official' })
        ]),
        el('td', { class: 'num', text: num(fx.ptax.sell, 4) }),
        el('td', { class: 'num muted', text: '—' }),
        el('td', { class: 'muted', text: (fx.ptax.quotedAt || '').slice(0, 16) })
      ]));
    }

    host.appendChild(el('div', { class: 'table-scroll' }, [
      el('table', { class: 'sheet' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Pair' }),
          el('th', { class: 'num', text: 'Rate' }),
          el('th', { class: 'num', text: 'Day' }),
          el('th', { class: 'num', text: '1 month' })
        ])]),
        el('tbody', {}, rows)
      ])
    ]));

    host.appendChild(el('p', {
      class: 'panel-foot',
      text: 'ECB daily reference rates as of ' + (fx.asOf || '—') +
            '. A weaker real (higher USD/BRL) typically encourages Brazilian producer selling.'
    }));
  }

  function renderPhysical(data) {
    var host = $('#physical');
    host.innerHTML = '';

    // Differentials
    var diff = data.differentials;
    var dPanel = el('div', { class: 'panel' }, [
      el('h3', { text: 'Differentials' }),
      el('p', { class: 'panel-sub', text: 'Physical premiums and discounts against the board' })
    ]);
    if (diff && diff.entries && diff.entries.length) {
      dPanel.appendChild(el('div', { class: 'table-scroll' }, [
        el('table', { class: 'sheet' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Origin' }),
            el('th', { text: 'Grade' }),
            el('th', { class: 'num', text: 'Diff' }),
            el('th', { text: 'Period' })
          ])]),
          el('tbody', {}, diff.entries.map(function (e) {
            return el('tr', {}, [
              el('td', { class: 'name', text: e.origin || '—' }),
              el('td', { text: e.grade || '—' }),
              el('td', { class: 'num', text: (e.differential == null ? '—' : signed(e.differential, 2)) + ' ' + (e.unit || '') }),
              el('td', { class: 'muted', text: e.period || '—' })
            ]);
          }))
        ])
      ]));
      dPanel.appendChild(el('p', {
        class: 'panel-foot',
        text: 'Manually entered from ' + (diff.sourceDocument || 'a trade document') +
              ', updated ' + fmtDateTime(diff.updatedAt) + '. Not machine-verified.'
      }));
    } else {
      dPanel.appendChild(notice('No verified source', [
        'Physical differentials are circulated privately by brokers and exporters. No free, ' +
        'continuously updated feed exists, so nothing is shown here rather than a guess.',
        'Planned: upload ICO and trader PDFs to populate this table and its history chart.'
      ]));
    }
    host.appendChild(dPanel);

    // Certified stocks
    var cs = data.certifiedStocks;
    var sPanel = el('div', { class: 'panel' }, [
      el('h3', { text: 'Certified Stocks' }),
      el('p', { class: 'panel-sub', text: 'Exchange-graded coffee in licensed warehouses' })
    ]);
    if (cs && cs.series && cs.series.length) {
      var latest = cs.series[cs.series.length - 1];
      sPanel.appendChild(el('div', { class: 'price-row' }, [
        el('span', { class: 'price', text: num(latest.bags, 0) }),
        el('span', { class: 'price-unit', text: 'bags' })
      ]));
      sPanel.appendChild(el('p', {
        class: 'panel-foot',
        text: 'As at ' + (latest.date || '—') + ', entered from ' + (cs.sourceDocument || 'a published report') + '.'
      }));
    } else {
      sPanel.appendChild(notice('No verified source', [
        'ICE publishes certified stocks daily, but the report sits behind bot protection and ' +
        'every free API found was a paid reseller.',
        'Planned: the same PDF upload will populate this figure and its trend.'
      ]));
    }
    host.appendChild(sPanel);
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
        el('th', { colspan: 6, scope: 'rowgroup', class: 'country-head', text: country })
      ]));

      byCountry[country].forEach(function (r) {
        if (r.error) {
          body.push(el('tr', {}, [
            el('td', { class: 'name region-cell', text: r.name }),
            el('td', { colspan: 5, class: 'err', text: 'unavailable' })
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
          el('td', { class: 'num', text: r.rain14 == null ? '—' : num(r.rain14, 0) }),
          el('td', { class: 'num', text: r.rainForecast7 == null ? '—' : num(r.rainForecast7, 0) })
        ]));
      });
    });

    host.appendChild(el('div', { class: 'table-scroll' }, [
      el('table', { class: 'sheet wx-sheet' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Region' }),
          el('th', { text: 'Type' }),
          el('th', { class: 'num', text: 'Max °C' }),
          el('th', { class: 'num', text: 'Min 7d' }),
          el('th', { class: 'num', text: 'Rain 14d mm' }),
          el('th', { class: 'num', text: 'Rain 7d fc' })
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

    var th = wx.thresholds || {};
    host.appendChild(el('p', {
      class: 'panel-foot',
      text: 'Flags are rule-based, not forecasts of price: frost at or below ' + th.frostC +
            '°C in a Brazilian region, wet above ' + th.heavyRainMm +
            ' mm forecast over seven days, dry at or below ' + th.dryMm +
            ' mm observed over fourteen. "Max °C" is the most recent observed day. ' +
            (wx.conditionMethod || '')
    }));
  }

  /**
   * A ticker. The track is duplicated so the scroll loops seamlessly; the copy
   * is hidden from assistive tech so headlines are not announced twice. Under
   * prefers-reduced-motion the CSS stops the animation and the strip becomes a
   * normal horizontally scrollable list.
   */
  function ticker(items, opts) {
    opts = opts || {};
    // The lane is duplicated, so its width is twice the content. Browsers cap
    // a composited layer at roughly 16,384px and silently fail to paint past
    // it, so the item count is capped to keep the lane comfortably inside that
    // limit. Callers truncate the text for the same reason.
    var MAX_ITEMS = opts.maxItems || 11;
    var shown = items.slice(0, MAX_ITEMS);

    function track(ariaHidden) {
      var t = el('div', { class: 'ticker-track' }, shown.map(function (mk) { return mk(); }));
      if (ariaHidden) t.setAttribute('aria-hidden', 'true');
      return t;
    }
    var speed = Math.max(30, Math.min(180, shown.length * (opts.secondsPerItem || 5)));
    var lane = el('div', { class: 'ticker-lane', style: '--ticker-duration:' + speed + 's' }, [
      track(false), track(true)
    ]);
    return el('div', { class: 'ticker' + (opts.modifier ? ' ' + opts.modifier : '') }, [
      opts.label ? el('span', { class: 'ticker-label', text: opts.label }) : null,
      el('div', { class: 'ticker-window' }, [lane])
    ]);
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

    host.appendChild(ticker(wire.headlines.map(function (h) {
      return function () {
        return el('a', {
          class: 'ticker-item', href: h.url, target: '_blank', rel: 'noopener noreferrer'
        }, [
          el('span', { class: 'ticker-region', text: h.region }),
          el('span', { class: 'ticker-text', text: clip(h.title, 62) }),
          el('span', { class: 'ticker-pub', text: h.publisher }),
          // The wire runs three weeks deep because the origins are not covered
          // daily, so every item states its age rather than implying it is new.
          el('span', { class: 'ticker-age', text: relTime(h.published) || fmtDate(h.published) })
        ]);
      };
    }), { label: 'Origin wire', secondsPerItem: 6 }));

    var regions = Object.keys(wire.byRegion || {}).filter(function (k) { return wire.byRegion[k]; });
    host.appendChild(el('p', {
      class: 'panel-foot',
      text: 'General headlines from the growing regions over the last ' +
            Math.round(wire.lookbackHours / 24) + ' days, from the BBC, the Guardian, the ' +
            'Financial Times, Al Jazeera and VnExpress International, tagged to a region by ' +
            'the countries and cities they name. ' + wire.totalTagged + ' stories matched ' +
            'across ' + (regions.length || 0) + ' regions; the ticker rotates between them so ' +
            'one busy country cannot crowd out the rest. The window is three weeks because ' +
            'these origins are not covered daily by the international press — each headline ' +
            'carries its own age.'
    }));
  }

  function renderRoundup(roundup) {
    var host = $('#roundup');
    host.innerHTML = '';
    if (!roundup || !roundup.items || !roundup.items.length) {
      host.appendChild(notice('Recap unavailable', [
        'Perfect Daily Grind rejects automated clients, so the weekly round-up could not be ' +
        'retrieved and no stored copy is available.',
        'Nothing is shown here rather than a stale or invented list.'
      ]));
      return;
    }

    host.appendChild(ticker(roundup.items.map(function (it) {
      return function () {
        var kids = [
          el('span', { class: 'ticker-region', text: it.date }),
          el('span', { class: 'ticker-text', text: clip(it.headline, 62) })
        ];
        if (it.section) kids.push(el('span', { class: 'ticker-pub', text: it.section }));
        return it.url
          ? el('a', { class: 'ticker-item', href: it.url, target: '_blank', rel: 'noopener noreferrer' }, kids)
          : el('span', { class: 'ticker-item' }, kids);
      };
    }), { label: 'Week in coffee', modifier: 'ticker-reverse', secondsPerItem: 7, maxItems: 11 }));

    var head = el('p', { class: 'roundup-source' }, [
      el('a', {
        href: roundup.articleUrl, target: '_blank', rel: 'noopener noreferrer',
        text: roundup.title || 'Coffee News Recap'
      }),
      el('span', { class: 'badge', text: 'Perfect Daily Grind' })
    ]);
    host.appendChild(head);

    var shownCount = Math.min(11, roundup.items.length);
    var scope = shownCount < roundup.items.length
      ? 'Showing ' + shownCount + ' of ' + roundup.items.length +
        ' headlines from this week’s recap — the full round-up is linked above. '
      : roundup.items.length + ' headlines. ';

    host.appendChild(el('p', {
      class: 'panel-foot',
      text: scope + 'Each links to the original source, not to the recap. ' +
        (roundup.source === 'manual'
          ? 'Perfect Daily Grind blocks automated clients, so this recap was captured by hand ' +
            'from the published article on ' + fmtDateTime(roundup.capturedAt) +
            '. The pipeline still attempts the live fetch on every run and will use it the ' +
            'moment it succeeds.'
          : 'Fetched live from Perfect Daily Grind’s weekly round-up.')
    }));
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
    host.appendChild(el('p', {
      class: 'panel-foot',
      text: 'One article, chosen from ' + (daily.considered || 0) +
            ' in the Daily Coffee News feed by relevance to the physical trade and recency. ' +
            'The summary is the publisher’s own feed text.'
    }));
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

    groups.push(el('div', { class: 'src-group' }, [
      el('h4', { text: 'News' }),
      el('ul', {}, [
        el('li', { text: 'Origin wire: BBC News, The Guardian, Financial Times and Al Jazeera, each from that publisher’s own syndication feed.' }),
        el('li', {}, [
          'Weekly recap: ',
          el('a', { href: 'https://perfectdailygrind.com/category/weekly-round-up/', target: '_blank', rel: 'noopener noreferrer', text: 'Perfect Daily Grind' }),
          ' — headlines and links are the publisher’s own.'
        ]),
        el('li', {}, [
          'Today’s read: ',
          el('a', { href: 'https://dailycoffeenews.com/', target: '_blank', rel: 'noopener noreferrer', text: 'Daily Coffee News' })
        ])
      ])
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
