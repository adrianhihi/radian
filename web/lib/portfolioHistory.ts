// The portfolio's value over a window: **current holdings × the price history of each
// token**, the way baskvia's "STARTED WITH" reads. Prices come from each launch row's
// spark (the indexer's last trades as [ts, quote-per-token]); a holding whose history
// does not reach back to the window start is left out and named, never back-filled.
// Everything is in the book's quote asset, so only one quote asset's holdings go in.
import type { Holding } from "./usePortfolio";

export type HistoryPeriod = "24H" | "7D" | "30D";
export const HISTORY_PERIODS: HistoryPeriod[] = ["24H", "7D", "30D"];

/** grid: points × step (ms); +1 point so the window's two ends are both on the grid */
const GRID: Record<HistoryPeriod, { n: number; step: number }> = {
  "24H": { n: 24, step: 3_600_000 },
  "7D": { n: 42, step: 4 * 3_600_000 },
  "30D": { n: 30, step: 86_400_000 },
};

export type HistoryAsset = {
  symbol: string;
  token: string;
  covered: boolean;
  /** why it is not covered */
  reason?: "no-history" | "too-short";
  start?: number;
  end?: number;
  /** price at every grid point (covered assets only) */
  prices?: number[];
};

export type HistoryView = {
  period: HistoryPeriod;
  times: number[];
  values: number[];
  assets: HistoryAsset[];
  /** covered value ÷ total current value of the book (0..1) */
  coverage: number;
};

/** last price at or before `t`, from an ascending [ts, price] series; null if none */
function priceAt(spark: [number, number][], t: number): number | null {
  let p: number | null = null;
  for (const [ts, v] of spark) {
    if (ts <= t) p = v;
    else break;
  }
  return p;
}

export function portfolioHistory(holdings: Holding[], period: HistoryPeriod, now = Date.now()): HistoryView {
  const { n, step } = GRID[period];
  const end = Math.floor(now / step) * step;
  const times = Array.from({ length: n + 1 }, (_, i) => end - (n - i) * step);
  const assets: HistoryAsset[] = [];
  const values = new Array<number>(times.length).fill(0);
  let coveredValue = 0;
  let totalValue = 0;
  for (const h of holdings) {
    const spark = (h.row.spark ?? []).slice().sort((a, b) => a[0] - b[0]);
    const bal = Number(h.bal) / 1e18;
    totalValue += h.value ?? 0;
    if (spark.length < 2) {
      assets.push({ symbol: h.row.symbol, token: h.row.token, covered: false, reason: "no-history" });
      continue;
    }
    if (priceAt(spark, times[0]) == null) {
      assets.push({ symbol: h.row.symbol, token: h.row.token, covered: false, reason: "too-short" });
      continue;
    }
    const prices = times.map((t) => priceAt(spark, t) as number);
    // the last point is the live spot when we have it
    if (h.spot != null) prices[prices.length - 1] = h.spot;
    prices.forEach((p, i) => (values[i] += p * bal));
    coveredValue += h.value ?? 0;
    assets.push({ symbol: h.row.symbol, token: h.row.token, covered: true, start: prices[0] * bal, end: prices[prices.length - 1] * bal, prices });
  }
  return { period, times, values, assets, coverage: totalValue > 0 ? coveredValue / totalValue : 0 };
}
