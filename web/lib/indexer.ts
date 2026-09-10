import type { LaunchRow } from "./radian";
import { getActiveNetwork } from "./networks";
import type { Address } from "viem";

// Optional indexer (Phase 4b): one fast, reliable request instead of hammering
// Arc's public RPC from every client. URL comes from the active network; falls
// back to on-chain reads when unset or unreachable.
export const INDEXER_URL = getActiveNetwork().indexerUrl.replace(/\/$/, "");

export const hasIndexer = () => INDEXER_URL.length > 0;

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${INDEXER_URL}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`indexer ${path} ${r.status}`);
  return (await r.json()) as T;
}

type ApiLaunch = {
  token: Address;
  curve: Address;
  deployer: Address;
  name: string;
  symbol: string;
  logo: string;
  description: string;
  graduated: boolean;
  quoteReserve: string;
  trackedQuote: string;
  graduationThreshold: string;
  buybackLocked: string;
  progress: number;
  pairToken: Address;
  quoteSymbol: string;
  quoteDecimals: number;
};

export async function fetchLaunches(): Promise<LaunchRow[]> {
  const { launches } = await get<{ launches: ApiLaunch[] }>("/launches");
  return launches.map((l) => ({
    token: l.token,
    curve: l.curve,
    deployer: l.deployer,
    graduationThreshold: BigInt(l.graduationThreshold),
    name: l.name,
    symbol: l.symbol,
    logo: l.logo,
    description: l.description,
    quoteReserve: BigInt(l.quoteReserve),
    trackedQuote: BigInt(l.trackedQuote),
    graduated: l.graduated,
    progress: l.progress,
    quoteSymbol: l.quoteSymbol ?? "USDC",
    quoteDecimals: l.quoteDecimals ?? 18,
    pairToken: l.pairToken ?? "0x0000000000000000000000000000000000000000",
  }));
}

export type Activity = {
  txHash: string;
  ts: number;
  token: Address;
  side: "buy" | "sell";
  trader: Address;
  quote: string;
  tokens: string;
  name: string;
  symbol: string;
  quoteSymbol?: string;
  quoteDecimals?: number;
};

export async function fetchActivity(limit = 60): Promise<Activity[]> {
  const { trades } = await get<{ trades: Activity[] }>(`/activity?limit=${limit}`);
  return trades;
}

export type TokenTrade = {
  txHash: string;
  ts: number;
  side: "buy" | "sell";
  trader: Address;
  quote: string;
  tokens: string;
  quoteDecimals?: number;
  quoteSymbol?: string;
};

export async function fetchTokenTrades(token: string): Promise<TokenTrade[]> {
  const { trades } = await get<{ trades: TokenTrade[] }>(`/token/${token}`);
  return trades;
}

// Resolve a token's curve (and pair token) from the indexer. Used by the token
// detail page as a fallback when the launch isn't in this browser's local
// registry (e.g. it was created elsewhere but is visible on Explore).
export type Sunset = { successor: Address; reason: string };

export async function fetchTokenMeta(
  token: string,
): Promise<{ curve: Address; pairToken: Address; deployer: Address; sunset: Sunset | null } | null> {
  try {
    const { token: t } = await get<{
      token?: { curve: Address; pairToken?: Address; deployer: Address; sunset?: Sunset | null };
    }>(`/token/${token}`);
    if (!t?.curve) return null;
    return {
      curve: t.curve,
      pairToken: t.pairToken ?? ("0x0000000000000000000000000000000000000000" as Address),
      deployer: t.deployer,
      sunset: t.sunset ?? null,
    };
  } catch {
    return null;
  }
}

export type ProtocolStats = {
  window: string;
  launches: number;
  graduated: number;
  curveTvl: number;
  buybackLocked: number;
  trades: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  buyTrades: number;
  sellTrades: number;
  avgTrade: number;
  creatorRewards: number;
  hourlyVolume: number[];
  ranked: { token: Address; name: string; symbol: string; volume: number; buys: number; sells: number; trades: number }[];
};

export async function fetchStats(window: "24h" | "all"): Promise<ProtocolStats> {
  return get<ProtocolStats>(`/stats?window=${window}`);
}
