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

    ['arabica', 'robusta'].forEach(function (key) {
      var c = futures && futures[key];
      if (!c) {
        host.appendChild(el('div', { class: 'contract' }, [
          notice('Unavailable', [
            (key === 'arabica' ? 'Arabica' : 'Robusta') +
            ' futures could not be retrieved on this run. No figure is shown rather than a stale one.'
          ])
        ]));
        return;
      }
      any = true;
      var q = c.quote || {};
      var dp = c.market === 'Arabica' ? 2 : 0;

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
    });

    if (!any) {
      host.innerHTML = '';
      host.appendChild(notice('Board unavailable', [
        'Neither futures feed responded on this run. Check the sources panel for the error.'
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

    ['arabica', 'robusta'].forEach(function (key) {
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

    ['arabica', 'robusta'].forEach(function (key) {
      var c = futures && futures[key];
      if (!c) return;
      var t = c.technicals;
      var dp = c.market === 'Arabica' ? 2 : 0;

      var panel = el('div', { class: 'panel' }, [
        el('h3', { text: c.market + ' ' + c.contract.code }),
        el('p', { class: 'panel-sub', text: t ? (t.basis || '') : 'No history available' })
      ]);

      if (!t || t.observations < 15) {
        panel.appendChild(notice('Not enough history yet', [
          (c.historyNote || 'Indicators need at least 15 sessions before they mean anything.') +
          ' Recorded so far: ' + (t ? t.observations : 0) + '.'
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

      // Levels
      var lv = t.levels || { support: [], resistance: [] };
      if (lv.resistance.length || lv.support.length) {
        var lvRows = [];
        lv.resistance.slice().reverse().forEach(function (l) {
          lvRows.push(el('tr', {}, [
            el('td', { class: 'name', text: 'Resistance' }),
            el('td', { class: 'num', text: num(l.price, dp) }),
            el('td', { class: 'muted', text: fmtDate(l.date) })
          ]));
        });
        lv.support.forEach(function (l) {
          lvRows.push(el('tr', {}, [
            el('td', { class: 'name', text: 'Support' }),
            el('td', { class: 'num', text: num(l.price, dp) }),
            el('td', { class: 'muted', text: fmtDate(l.date) })
          ]));
        });
        panel.appendChild(el('div', { class: 'table-scroll' }, [
          el('table', { class: 'sheet', style: 'margin-top:1rem' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', { text: 'Level' }),
              el('th', { class: 'num', text: 'Price' }),
              el('th', { text: 'Set on' })
            ])]),
            el('tbody', {}, lvRows)
          ])
        ]));
      }

      panel.appendChild(el('p', { class: 'panel-foot', text: t.method || '' }));
      host.appendChild(panel);
    });

    if (!host.children.length) {
      host.appendChild(notice('Unavailable', ['No price history was available to compute indicators from.']));
    }
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

  function renderWeather(wx) {
    var host = $('#weather');
    host.innerHTML = '';
    if (!wx || !wx.regions) {
      host.appendChild(notice('Unavailable', ['Weather data could not be retrieved on this run.']));
      return;
    }

    // Regions carrying an alert lead the table.
    var regions = wx.regions.slice().sort(function (a, b) {
      return (b.alerts ? b.alerts.length : 0) - (a.alerts ? a.alerts.length : 0);
    });

    var rows = regions.map(function (r) {
      if (r.error) {
        return el('tr', {}, [
          el('td', { class: 'name', text: r.name }),
          el('td', { colspan: 5, class: 'err', text: 'unavailable' })
        ]);
      }
      var flags = (r.alerts || []).map(function (a) {
        return el('span', { class: 'wx-flag ' + a.type, text: a.type, title: a.text });
      });

      return el('tr', {}, [
        el('td', { class: 'name' }, [
          r.name + ' ',
          el('span', { class: 'origin-country', text: r.country })
        ].concat(flags)),
        el('td', {}, [el('span', { class: 'species', text: r.species })]),
        el('td', { class: 'num', text: r.current && r.current.tMax != null ? num(r.current.tMax, 0) + '°' : '—' }),
        el('td', { class: 'num', text: r.minForecast7 == null ? '—' : num(r.minForecast7, 0) + '°' }),
        el('td', { class: 'num', text: r.rain14 == null ? '—' : num(r.rain14, 0) }),
        el('td', { class: 'num', text: r.rainForecast7 == null ? '—' : num(r.rainForecast7, 0) })
      ]);
    });

    host.appendChild(el('div', { class: 'table-scroll' }, [
      el('table', { class: 'sheet' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Region' }),
          el('th', { text: 'Type' }),
          el('th', { class: 'num', text: 'Max °C' }),
          el('th', { class: 'num', text: 'Min 7d' }),
          el('th', { class: 'num', text: 'Rain 14d mm' }),
          el('th', { class: 'num', text: 'Rain 7d fc' })
        ])]),
        el('tbody', {}, rows)
      ])
    ]));

    var alerts = [];
    regions.forEach(function (r) {
      (r.alerts || []).forEach(function (a) { alerts.push(r.name + ' — ' + a.text); });
    });
    if (alerts.length) {
      host.appendChild(el('div', { class: 'notice', style: 'margin-top:1rem' }, [
        el('div', { class: 'notice-head', text: 'Flagged this morning' })
      ].concat(alerts.map(function (t) { return el('p', { text: t }); }))));
    }

    var th = wx.thresholds || {};
    host.appendChild(el('p', {
      class: 'panel-foot',
      text: 'Flags are rule-based, not forecasts of price: frost at or below ' + th.frostC +
            '°C in a Brazilian region, wet above ' + th.heavyRainMm +
            ' mm forecast over seven days, dry at or below ' + th.dryMm +
            ' mm observed over fourteen. "Max °C" is the most recent observed day.'
    }));
  }

  function renderNews(news) {
    var host = $('#news');
    host.innerHTML = '';
    if (!news) {
      host.appendChild(notice('Unavailable', ['News feeds could not be retrieved on this run.']));
      return;
    }
    if (!news.articles || !news.articles.length) {
      host.appendChild(notice('Nothing worth your time today', [
        'Of ' + (news.totalCoffeeStories || 0) + ' coffee stories across ' + news.feedsQueried +
        ' publisher feeds in the last ' + Math.round(news.lookbackHours / 24) +
        ' days, none cleared the relevance bar for someone buying physical coffee.',
        'The list is left short on purpose rather than padded with café openings and personnel moves.'
      ]));
      return;
    }

    var wrap = el('div', { class: 'stories' }, news.articles.map(function (a, i) {
      var kids = [
        el('span', { class: 'story-rank', text: String(i + 1) }),
        el('h3', {}, [
          el('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', text: a.title })
        ])
      ];
      if (a.summary) kids.push(el('p', { text: a.summary }));
      var byline = el('div', { class: 'byline' }, [
        el('span', { class: 'pub', text: a.publisher }),
        ' · ' + (relTime(a.published) || fmtDate(a.published))
      ]);
      if (a.tier === 1) byline.appendChild(el('span', { class: 'badge', text: 'Press of record' }));
      kids.push(byline);
      return el('div', { class: 'story' }, kids);
    }));
    host.appendChild(wrap);

    var foot = 'From ' + news.feedsQueried + ' publisher feeds: ' +
      (news.totalCoffeeStories || 0) + ' coffee stories in the last ' +
      Math.round(news.lookbackHours / 24) + ' days, ' + (news.totalEligible || 0) +
      ' of them relevant to the physical trade. Ranked by outlet, trade relevance and ' +
      'recency, and scored down for café and corporate-affairs news. Summaries are the ' +
      'publishers own feed text, not generated.';
    host.appendChild(el('p', { class: 'panel-foot', text: foot }));

    if (news.totalEligible < 5) {
      host.appendChild(el('p', {
        class: 'panel-foot',
        text: 'Fewer than five today. Coffee is not a daily story for the general press, and ' +
              'this page would rather run short than pad the list.'
      }));
    }
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
      if (data.futures.robusta) addGroup('Robusta futures', data.futures.robusta.sources);
    }
    if (data.fx) addGroup('Currency', data.fx.sources);
    if (data.weather) addGroup('Weather', data.weather.sources);

    groups.push(el('div', { class: 'src-group' }, [
      el('h4', { text: 'News' }),
      el('ul', {}, [
        el('li', { text: 'Financial Times, BBC News, VnExpress International, World Coffee Portal and Daily Coffee News, each taken from that publisher own syndication feed.' })
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
    renderNews(data.news);
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
