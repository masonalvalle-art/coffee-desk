// Weather in the origins that actually move the board.
// Source: Open-Meteo (free, no key, no attribution barrier). It blends
// national met-service models -- for Brazil and Vietnam that is primarily
// ECMWF/GFS. We publish observed past days and forecast days side by side and
// never smooth between them.

import { getJson } from '../lib/http.mjs';

// Ordered roughly by weight in the world balance.
export const REGIONS = [
  { key: 'sul-de-minas',   name: 'Sul de Minas',      country: 'Brazil',    species: 'Arabica', lat: -21.55, lon: -45.43, note: 'Largest single arabica belt; frost-exposed Jun–Aug, flowering Sep–Oct.' },
  { key: 'cerrado',        name: 'Cerrado Mineiro',   country: 'Brazil',    species: 'Arabica', lat: -18.94, lon: -46.99, note: 'Mechanised, irrigated; rain timing sets flowering uniformity.' },
  { key: 'mogiana',        name: 'Mogiana',           country: 'Brazil',    species: 'Arabica', lat: -20.54, lon: -47.40, note: 'São Paulo arabica belt.' },
  { key: 'matas-de-minas', name: 'Matas de Minas',    country: 'Brazil',    species: 'Arabica', lat: -20.26, lon: -42.03, note: 'Hillside, largely rainfed — drought-sensitive.' },
  { key: 'espirito-santo', name: 'Espírito Santo',    country: 'Brazil',    species: 'Robusta', lat: -19.39, lon: -40.07, note: 'Conilon heartland; Brazil’s robusta supply.' },
  { key: 'dak-lak',        name: 'Dak Lak',           country: 'Vietnam',   species: 'Robusta', lat:  12.68, lon: 108.05, note: 'Central Highlands; the single largest robusta origin.' },
  { key: 'lam-dong',       name: 'Lam Dong',          country: 'Vietnam',   species: 'Robusta', lat:  11.55, lon: 107.81, note: 'Second Vietnamese robusta province.' },
  { key: 'huila',          name: 'Huila',             country: 'Colombia',  species: 'Arabica', lat:   1.85, lon: -76.05, note: 'Washed mild arabica; two harvests a year.' },
  { key: 'antioquia',      name: 'Antioquia',         country: 'Colombia',  species: 'Arabica', lat:   6.25, lon: -75.56, note: 'Northern Colombian belt.' },
  { key: 'gayo',           name: 'Gayo Highlands',    country: 'Indonesia', species: 'Arabica', lat:   4.63, lon:  96.85, note: 'Sumatran arabica.' },
  { key: 'lampung',        name: 'Lampung',           country: 'Indonesia', species: 'Robusta', lat:  -5.45, lon: 105.27, note: 'Indonesian robusta export hub.' },
  { key: 'jimma',          name: 'Jimma',             country: 'Ethiopia',  species: 'Arabica', lat:   7.67, lon:  36.83, note: 'Origin of arabica; largely forest and garden coffee.' },
  { key: 'marcala',        name: 'Marcala',           country: 'Honduras',  species: 'Arabica', lat:  14.16, lon: -88.02, note: 'Central America’s largest arabica exporter.' },
  { key: 'chanchamayo',    name: 'Chanchamayo',       country: 'Peru',      species: 'Arabica', lat: -11.05, lon: -75.33, note: 'Peruvian organic/washed arabica.' },
];

// Thresholds are stated so a reader can check our reasoning.
const FROST_C = 4;        // radiative frost damage risk in Brazilian arabica
const HEAVY_RAIN_MM = 50; // over the forecast week, harvest/drying disruption
const DRY_MM = 5;         // over the past fortnight, moisture stress

export async function fetchWeather() {
  const lats = REGIONS.map(r => r.lat).join(',');
  const lons = REGIONS.map(r => r.lon).join(',');
  const url = 'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lats}&longitude=${lons}` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum' +
    '&timezone=auto&past_days=14&forecast_days=7';

  const raw = await getJson(url);
  const list = Array.isArray(raw) ? raw : [raw];
  const today = new Date().toISOString().slice(0, 10);

  const regions = REGIONS.map((region, i) => {
    const d = list[i]?.daily;
    if (!d) return { ...region, error: 'no data returned' };

    const days = d.time.map((date, j) => ({
      date,
      tMax: d.temperature_2m_max?.[j] ?? null,
      tMin: d.temperature_2m_min?.[j] ?? null,
      rain: d.precipitation_sum?.[j] ?? null,
      observed: date < today,
    }));

    const past14 = days.filter(x => x.observed);
    const fwd7 = days.filter(x => !x.observed);
    const sum = (arr, k) => arr.reduce((a, b) => a + (b[k] ?? 0), 0);
    const minOf = (arr, k) => {
      const v = arr.map(x => x[k]).filter(x => x != null);
      return v.length ? Math.min(...v) : null;
    };

    const rain14 = +sum(past14, 'rain').toFixed(1);
    const rainFwd = +sum(fwd7, 'rain').toFixed(1);
    const minFwd = minOf(fwd7, 'tMin');

    const alerts = [];
    if (region.country === 'Brazil' && minFwd != null && minFwd <= FROST_C) {
      alerts.push({ type: 'frost', severity: minFwd <= 2 ? 'high' : 'watch',
        text: `Forecast low of ${minFwd.toFixed(1)}°C — frost risk (threshold ${FROST_C}°C).` });
    }
    if (rainFwd >= HEAVY_RAIN_MM) {
      alerts.push({ type: 'wet', severity: 'watch',
        text: `${rainFwd.toFixed(0)} mm forecast over 7 days — harvest/drying disruption risk.` });
    }
    if (rain14 <= DRY_MM) {
      alerts.push({ type: 'dry', severity: 'watch',
        text: `Only ${rain14.toFixed(0)} mm in the past 14 days — moisture stress.` });
    }

    return {
      ...region,
      timezone: list[i].timezone ?? null,
      elevation: list[i].elevation ?? null,
      current: past14.at(-1) ?? null,
      rain14, rainForecast7: rainFwd, minForecast7: minFwd,
      maxForecast7: (() => {
        const v = fwd7.map(x => x.tMax).filter(x => x != null);
        return v.length ? Math.max(...v) : null;
      })(),
      days,
      alerts,
    };
  });

  return {
    fetchedAt: new Date().toISOString(),
    thresholds: { frostC: FROST_C, heavyRainMm: HEAVY_RAIN_MM, dryMm: DRY_MM },
    regions,
    sources: [
      { name: 'Open-Meteo forecast API', url: 'https://open-meteo.com/', role: 'observed + forecast daily temperature and precipitation' },
    ],
  };
}
