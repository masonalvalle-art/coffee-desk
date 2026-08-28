/* ============================================================
   DESIGN PHASE ONLY — the variant switcher.

   Activates on ?lab=1 and does nothing otherwise, so the real
   page is unaffected. Deleted once a combination is chosen.

   Sets data-skin / data-layout / data-accent on <html>, which is
   what assets/themes.css keys off. Choices persist and are
   reflected in the URL, so an exact combination can be shared:
     index.html?lab=1&skin=feature&layout=rail&accent=ink
   ============================================================ */

(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  if (params.get('lab') !== '1') return;

  // First value in each list is the default, so the lab opens on the
  // combination that has been chosen rather than on the control.
  var AXES = [
    { key: 'skin',     label: 'Skin',     values: ['editorial', 'feature', 'broadsheet'] },
    { key: 'layout',   label: 'Layout',   values: ['stacked', 'frontispiece', 'rail'] },
    { key: 'accent',   label: 'Accent',   values: ['aubergine', 'ink', 'ochre'] },
    { key: 'masthead', label: 'Masthead', values: ['cinzel', 'caslon', 'garamond'] },
    { key: 'paper',    label: 'Paper',    values: ['manila', 'cream', 'ivory'] }
  ];
  var STORE = 'coffeedesk.lab.v3';   // bumped again so the chosen combination is what opens
  var root = document.documentElement;

  function saved() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}'); }
    catch (e) { return {}; }
  }
  function save(state) {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* not essential */ }
  }

  // URL wins over stored choice, so a shared link always shows what it says.
  var stored = saved();
  var state = {};
  AXES.forEach(function (a) {
    var v = params.get(a.key) || stored[a.key] || a.values[0];
    state[a.key] = a.values.indexOf(v) >= 0 ? v : a.values[0];
  });

  function apply() {
    AXES.forEach(function (a) { root.setAttribute('data-' + a.key, state[a.key]); });
    save(state);
    var q = new URLSearchParams(location.search);
    q.set('lab', '1');
    AXES.forEach(function (a) { q.set(a.key, state[a.key]); });
    history.replaceState(null, '', location.pathname + '?' + q.toString());
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  var bar = el('div', { id: 'lab-bar', role: 'region', 'aria-label': 'Design variant switcher' });

  AXES.forEach(function (a) {
    var sel = el('select', { id: 'lab-' + a.key, 'aria-label': a.label });
    a.values.forEach(function (v) {
      var o = el('option', { value: v, text: v });
      if (v === state[a.key]) o.setAttribute('selected', 'selected');
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { state[a.key] = sel.value; apply(); });
    bar.appendChild(el('label', { for: 'lab-' + a.key, text: a.label }));
    bar.appendChild(sel);
  });

  // Quick way to see the same combination on the other ground.
  var themeBtn = el('button', { type: 'button', id: 'lab-theme', text: 'Flip light/dark' });
  themeBtn.addEventListener('click', function () {
    var cur = root.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    themeBtn.textContent = next === 'dark' ? 'Light' : 'Dark';
  });
  bar.appendChild(themeBtn);

  var style = el('style', {});
  style.textContent = [
    '#lab-bar{position:fixed;z-index:9999;left:50%;transform:translateX(-50%);bottom:1rem;',
    'display:flex;gap:.5rem;align-items:center;padding:.5rem .7rem;',
    'background:#141414;color:#f4f1ea;border-radius:2px;box-shadow:0 4px 18px rgba(0,0,0,.35);',
    'font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;',
    'text-transform:uppercase;max-width:calc(100vw - 2rem);flex-wrap:wrap;justify-content:center}',
    '#lab-bar label{opacity:.55}',
    '#lab-bar select,#lab-bar button{font:inherit;text-transform:uppercase;letter-spacing:.06em;',
    'background:#262626;color:#f4f1ea;border:1px solid #3d3d3d;border-radius:2px;padding:.3rem .4rem;cursor:pointer}',
    '#lab-bar select:hover,#lab-bar button:hover{border-color:#6f6f6f}',
    '@media print{#lab-bar{display:none}}'
  ].join('');
  document.head.appendChild(style);

  apply();
  document.body.appendChild(bar);
})();
