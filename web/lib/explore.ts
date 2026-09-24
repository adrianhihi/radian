// Pure helpers behind the explore page: filtering, sorting, creator rows,
// global stats, spark slicing. No DOM, no i18n, so they can be reasoned about
// and tested on their own.
import type { LaunchRow } from "./radian";

export const EXPLORE_SORTS = ["top", "change", "value", "holders", "newest", "progress"] as const;
export type ExploreSort = (typeof EXPLORE_SORTS)[number];

export interface ExploreControls {
  q: string;
  /** quote-asset filter: "all" or a pair token address (lower case; zero = gas coin) */
  quote: string;
  sort: ExploreSort;
}

export const DEFAULT_EXPLORE_CONTROLS: ExploreControls = { q: "", quote: "all", sort: "top" };

const num = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);
/** descending; missing values always last, never treated as 0 */
const desc = (x: number | null, y: number | null) => (x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : y - x);

/** curve reserve in its own quote units (comparable within one quote asset) */
export const reserveOf = (r: LaunchRow): number => Number(r.trackedQuote) / 10 ** r.quoteDecimals;

/**
 * Sorts, in the words of the chips: Top = progress toward graduation, then 24h
 * volume, then reserve; Change = 24h change; Value = curve reserve (per quote
 * asset, so mixed lists sort within their units); Newest = launch time;
 * Progress = bonding progress. Search matches name, symbol and deployer.
 */
export function filterSortLaunches(rows: LaunchRow[], controls: Partial<ExploreControls> = {}): LaunchRow[] {
  const { q = "", quote = "all", sort = "top" } = controls;
  const query = q.trim().toLowerCase();
  const idx = new Map(rows.map((r, i) => [r.token, i]));
  const byIndex = (a: LaunchRow, b: LaunchRow) => (idx.get(a.token) ?? 0) - (idx.get(b.token) ?? 0);
  const top = (a: LaunchRow, b: LaunchRow) =>
    desc(a.graduated ? 1 : a.progress, b.graduated ? 1 : b.progress) || desc(num(a.volume24h), num(b.volume24h)) || desc(reserveOf(a), reserveOf(b)) || byIndex(a, b);

  const list = rows.filter((r) => {
    const okQ =
      !query ||
      r.name.toLowerCase().includes(query) ||
      r.symbol.toLowerCase().includes(query) ||
      r.deployer.toLowerCase().includes(query) ||
      r.quoteSymbol.toLowerCase().includes(query) ||
      (r.creatorName ?? "").toLowerCase().includes(query);
    const okQuote = quote === "all" || r.pairToken.toLowerCase() === quote;
    return okQ && okQuote;
  });

  const cmp: Record<ExploreSort, (a: LaunchRow, b: LaunchRow) => number> = {
    top,
    change: (a, b) => desc(num(a.change24h), num(b.change24h)) || top(a, b),
    value: (a, b) => desc(reserveOf(a), reserveOf(b)) || byIndex(a, b),
    holders: (a, b) => desc(num(a.holders), num(b.holders)) || top(a, b),
    newest: (a, b) => desc(num(a.createdAt), num(b.createdAt)) || top(a, b),
    progress: (a, b) => desc(a.graduated ? -1 : a.progress, b.graduated ? -1 : b.progress) || byIndex(a, b),
  };
  return list.sort(cmp[sort] ?? top);
}

/** Does any row carry a value for this sort key? (else the view says so) */
export function sortHasData(rows: LaunchRow[], sort: ExploreSort): boolean {
  if (sort === "change") return rows.some((r) => num(r.change24h) != null);
  if (sort === "newest") return rows.some((r) => num(r.createdAt) != null);
  if (sort === "holders") return rows.some((r) => num(r.holders) != null);
  return true;
}

/** Quote-asset filter options: pair token address → symbol, by frequency. */
export function quoteOptions(rows: LaunchRow[]): { value: string; symbol: string; n: number }[] {
  const count = new Map<string, { symbol: string; n: number }>();
  for (const r of rows) {
    const k = r.pairToken.toLowerCase();
    const cur = count.get(k) ?? { symbol: r.quoteSymbol, n: 0 };
    cur.n += 1;
    count.set(k, cur);
  }
  return [...count.entries()].sort((a, b) => b[1].n - a[1].n).map(([value, v]) => ({ value, ...v }));
}

/** The token closest to graduation that has not graduated (the "most backed" badge); none when nothing has moved. */
export function mostBackedToken(rows: LaunchRow[]): string | undefined {
  let best: LaunchRow | undefined;
  for (const r of rows) {
    if (r.graduated || r.progress <= 0) continue;
    if (!best || r.progress > best.progress || (r.progress === best.progress && (r.volume24h ?? 0) > (best.volume24h ?? 0))) best = r;
  }
  return best?.token;
}

export interface CreatorRow {
  addr: string;
  launches: LaunchRow[];
  graduated: number;
  volume24h: number;
  /** the creator's furthest-along token */
  top: LaunchRow;
}

/** Creators aggregated by deployer. "launches" = most tokens; "volume" = most 24h volume. */
export function creatorRows(rows: LaunchRow[], sort: "launches" | "volume" = "launches"): CreatorRow[] {
  const map = new Map<string, LaunchRow[]>();
  for (const r of rows) {
    const k = r.deployer.toLowerCase();
    const list = map.get(k) ?? [];
    list.push(r);
    map.set(k, list);
  }
  const out: CreatorRow[] = [...map.entries()].map(([addr, list]) => ({
    addr,
    launches: list,
    graduated: list.filter((r) => r.graduated).length,
    volume24h: list.reduce((s, r) => s + (r.volume24h ?? 0), 0),
    top: list.reduce((a, b) => ((b.graduated ? 1 : b.progress) > (a.graduated ? 1 : a.progress) ? b : a), list[0]),
  }));
  return out.sort((a, b) => (sort === "volume" ? b.volume24h - a.volume24h : 0) || b.launches.length - a.launches.length || b.graduated - a.graduated);
}

export function globalStats(rows: LaunchRow[]): { creators: number; tokens: number; graduated: number } {
  return {
    creators: new Set(rows.map((r) => r.deployer.toLowerCase())).size,
    tokens: rows.length,
    graduated: rows.filter((r) => r.graduated).length,
  };
}

export const PERIODS = ["24H", "7D", "30D", "ALL"] as const;
export type Period = (typeof PERIODS)[number];
const PERIOD_MS: Record<Period, number> = { "24H": 86_400_000, "7D": 7 * 86_400_000, "30D": 30 * 86_400_000, ALL: Infinity };

/** Prices from the spark within the period (needs 2+ points to draw). */
export function sparkValues(spark: [number, number][] | undefined, period: Period): number[] {
  if (!spark?.length) return [];
  const since = Date.now() - PERIOD_MS[period];
  const inWindow = spark.filter((p) => p[0] >= since).map((p) => p[1]);
  return inWindow.length >= 2 ? inWindow : spark.slice(-2).map((p) => p[1]);
}
