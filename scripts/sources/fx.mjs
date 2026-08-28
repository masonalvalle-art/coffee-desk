// Currencies that move a coffee buyer's landed cost.
//   USD/GBP  -- sterling buyers converting a dollar-priced contract.
//   USD/BRL  -- the single biggest driver of Brazilian producer selling.
//
// Primary: European Central Bank reference rates (via the Frankfurter API,
// which republishes the ECB's own daily fixing).
// Secondary: Banco Central do Brasil PTAX, the official Brazilian fixing.
// Two sources for BRL means we can show the buyer the official Brazilian
// number alongside the European one instead of silently choosing.

import { getJson } from '../lib/http.mjs';

const FRANKFURTER = 'https://api.frankfurter.dev/v1';

function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function fetchFx() {
  const latest = await getJson(`${FRANKFURTER}/latest?base=USD&symbols=GBP,BRL`);
  const series = await getJson(
    `${FRANKFURTER}/${isoDaysAgo(120)}..${isoDaysAgo(0)}?base=USD&symbols=GBP,BRL`
  );

  const dates = Object.keys(series.rates ?? {}).sort();
  const history = {
    GBP: dates.map(d => ({ date: d, rate: series.rates[d].GBP })).filter(p => p.rate != null),
    BRL: dates.map(d => ({ date: d, rate: series.rates[d].BRL })).filter(p => p.rate != null),
  };

  const pairs = {};
  for (const ccy of ['GBP', 'BRL']) {
    const rate = latest.rates?.[ccy] ?? null;
    const h = history[ccy];
    const prev = h.length >= 2 ? h[h.length - 2].rate : null;
    const monthAgo = h.length >= 22 ? h[h.length - 22].rate : null;
    pairs[`USD${ccy}`] = {
      pair: `USD/${ccy}`,
      rate,
      previous: prev,
      change: rate != null && prev != null ? +(rate - prev).toFixed(5) : null,
      changePct: rate != null && prev != null ? +(((rate - prev) / prev) * 100).toFixed(3) : null,
      change1m: rate != null && monthAgo != null ? +(((rate - monthAgo) / monthAgo) * 100).toFixed(2) : null,
      history: h,
    };
  }

  // Official Brazilian fixing. Non-fatal: if BCB is down we still have the ECB.
  let ptax = null;
  try {
    ptax = await fetchPtax();
  } catch (err) {
    ptax = { error: err.message };
  }

  return {
    asOf: latest.date ?? null,
    pairs,
    ptax,
    sources: [
      { name: 'European Central Bank daily reference rates (via Frankfurter)', url: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html', role: 'USD/GBP, USD/BRL' },
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
