// The insights that depend on price history, as pure functions (baskvia's insightsMath):
// inputs are the same grid the history chart draws, so a card never disagrees with the chart.

/** Rolling 7-point change of the portfolio: worst and best (fractions, e.g. -0.07). null under 8 points. */
export function worstBestWeek(values: number[]): { worst: number; best: number } | null {
  if (values.length < 8) return null;
  const r: number[] = [];
  for (let i = 7; i < values.length; i++) if (values[i - 7] > 0) r.push(values[i] / values[i - 7] - 1);
  if (!r.length) return null;
  return { worst: Math.min(...r), best: Math.max(...r) };
}

/** Days two price series moved the same way (days where neither moved are skipped). */
export function sameDirectionDays(a: number[], b: number[]): { same: number; days: number } {
  let same = 0;
  let days = 0;
  for (let i = 1; i < Math.min(a.length, b.length); i++) {
    const da = Math.sign(a[i] - a[i - 1]);
    const db = Math.sign(b[i] - b[i - 1]);
    if (da === 0 && db === 0) continue;
    days++;
    if (da === db) same++;
  }
  return { same, days };
}

const returns = (p: number[]) => p.slice(1).map((v, i) => (p[i] > 0 ? v / p[i] - 1 : 0));

function corr(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const my = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/**
 * "Moves like N independent bets": N = 1 / ΣΣ wᵢwⱼρᵢⱼ, value-weighted, ρ the correlation of
 * daily returns (ρᵢᵢ = 1). Fully independent → 1/Σwᵢ² (n for equal weights); all in lockstep → 1.
 * A granularity measurement, not a score.
 */
export function independentBets(items: { weight: number; prices: number[] }[]): number | null {
  const xs = items.filter((i) => i.weight > 0 && i.prices.length > 2);
  if (!xs.length) return null;
  const tot = xs.reduce((s, i) => s + i.weight, 0);
  const w = xs.map((i) => i.weight / tot);
  const r = xs.map((i) => returns(i.prices));
  let s = 0;
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < xs.length; j++) s += w[i] * w[j] * (i === j ? 1 : corr(r[i], r[j]));
  return s > 0 ? 1 / s : null;
}
