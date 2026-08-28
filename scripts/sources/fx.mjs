// Currencies that move a coffee buyer's landed cost.
//   GBP/USD  -- sterling buyers converting a dollar-priced contract. Quoted
//               the way the market quotes it (cable, ~1.36), not inverted.
//   USD/BRL  -- the single biggest driver of Brazilian producer selling.
//
// Each pair is requested in its own quoting convention rather than fetched in
// one base and flipped here, so the number on the page is the number the
// source returned and no arithmetic of ours sits between them.
//
// Primary: European Central Bank reference rates, via the Frankfurter API,
// which republishes the ECB's own daily fixing.
// Secondary: Banco Central do Brasil PTAX, the official Brazilian fixing, so
// the buyer sees the Brazilian number beside the European one.

import { getJson } from '../lib/http.mjs';

const FRANKFURTER = 'https://api.frankfurter.dev/v1';

function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const PAIRS = [
  {
    key: 'GBPUSD', pair: 'GBP/USD', base: 'GBP', quote: 'USD', dp: 4,
    note: 'Sterling stronger means a dollar-priced contract costs a UK buyer less.',
  },
  {
    key: 'USDBRL', pair: 'USD/BRL', base: 'USD', quote: 'BRL', dp: 4,
    note: 'A weaker real encourages Brazilian producer selling.',
  },
];

async function fetchPair(spec) {
  const latest = await getJson(
    `${FRANKFURTER}/latest?base=${spec.base}&symbols=${spec.quote}`
  );
  const series = await getJson(
    `${FRANKFURTER}/${isoDaysAgo(120)}..${isoDaysAgo(0)}?base=${spec.base}&symbols=${spec.quote}`
  );

  const dates = Object.keys(series.rates ?? {}).sort();
  const history = dates
    .map(d => ({ date: d, rate: series.rates[d][spec.quote] }))
    .filter(p => p.rate != null);

  const rate = latest.rates?.[spec.quote] ?? null;
  const prev = history.length >= 2 ? history[history.length - 2].rate : null;
  const monthAgo = history.length >= 22 ? history[history.length - 22].rate : null;

  return {
    asOf: latest.date ?? null,
    value: {
      pair: spec.pair,
      rate,
      previous: prev,
      dp: spec.dp,
      note: spec.note,
      change: rate != null && prev != null ? +(rate - prev).toFixed(5) : null,
      changePct: rate != null && prev != null ? +(((rate - prev) / prev) * 100).toFixed(3) : null,
      change1m: rate != null && monthAgo != null ? +(((rate - monthAgo) / monthAgo) * 100).toFixed(2) : null,
      history: history.slice(-60),
    },
  };
}

export async function fetchFx() {
  const results = await Promise.all(PAIRS.map(fetchPair));

  const pairs = {};
  results.forEach((r, i) => { pairs[PAIRS[i].key] = r.value; });

  // Official Brazilian fixing. Non-fatal: if BCB is down we still have the ECB.
  let ptax = null;
  try {
    ptax = await fetchPtax();
  } catch (err) {
    ptax = { error: err.message };
  }

  return {
    asOf: results[0]?.asOf ?? null,
    pairs,
    ptax,
    sources: [
      { name: 'European Central Bank daily reference rates (via Frankfurter)', url: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html', role: 'GBP/USD and USD/BRL, each requested in its own quoting convention' },
      { name: 'Banco Central do Brasil — PTAX', url: 'https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes', role: 'official USD/BRL fixing' },
    ],
  };
}

/** Banco Central do Brasil PTAX. Walks back to the last business day. */
async function fetchPtax() {
  for (let back = 0; back < 7; back++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - back);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const stamp = `${mm}-${dd}-${d.getUTCFullYear()}`;
    const url = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/' +
                `CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${stamp}'` +
                '&$top=1&$format=json';
    const j = await getJson(url);
    const row = j?.value?.[0];
    if (row) {
      return {
        buy: row.cotacaoCompra,
        sell: row.cotacaoVenda,
        quotedAt: row.dataHoraCotacao,
      };
    }
  }
  throw new Error('No PTAX quote in the last 7 days');
}
