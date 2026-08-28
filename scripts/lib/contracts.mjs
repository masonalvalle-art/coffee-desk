// Futures contract-month resolution.
// Arabica "Coffee C" (ICE US) trades Mar/May/Jul/Sep/Dec.
// We never hardcode a contract: we enumerate upcoming months, probe the
// exchange feed, and keep whatever actually returns a live quote. That way the
// dashboard rolls itself when a contract expires.

export const ARABICA_MONTHS = { 3: 'H', 5: 'K', 7: 'N', 9: 'U', 12: 'Z' };

/**
 * Enumerate the next `count` delivery months for a contract calendar,
 * starting from the current month (a contract is still listed during the
 * month before its delivery month).
 */
export function upcomingContracts(monthMap, count = 8, now = new Date()) {
  const out = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1; // 1-12
  const codes = Object.keys(monthMap).map(Number).sort((a, b) => a - b);

  while (out.length < count) {
    for (const m of codes) {
      if (year === now.getUTCFullYear() && m < month) continue;
      out.push({
        year,
        month: m,
        code: monthMap[m],
        // e.g. "Z26"
        short: `${monthMap[m]}${String(year).slice(2)}`,
        // e.g. "Z2026"
        long: `${monthMap[m]}${year}`,
        label: `${monthName(m)} ${year}`,
      });
      if (out.length >= count) break;
    }
    year += 1;
    month = 1;
  }
  return out;
}

function monthName(m) {
  return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m];
}

/**
 * Given probed contracts (in delivery order) that returned a live quote,
 * pick the front and second month, and separately identify the most-active
 * contract by volume. When the front month is in its expiry window its volume
 * collapses, which is worth surfacing to a buyer.
 */
export function classify(live) {
  const front = live[0] ?? null;
  const second = live[1] ?? null;
  let mostActive = null;
  for (const c of live) {
    if (c.volume == null) continue;
    if (!mostActive || c.volume > mostActive.volume) mostActive = c;
  }
  const rolled =
    front && second && front.volume != null && second.volume != null &&
    second.volume > 0 && front.volume < second.volume * 0.05;
  return { front, second, mostActive, rolled };
}
