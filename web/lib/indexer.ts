import type { LaunchRow } from "./radian";
import type { Address } from "viem";

// Optional indexer (Phase 4b). When NEXT_PUBLIC_INDEXER_URL is set, the app
// reads launches/activity/stats from it (one fast request, reliable) instead
// of hammering Arc's public RPC from every client. Falls back to on-chain
// reads when unset or unreachable.
export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL?.replace(/\/$/, "") ?? "";

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
};

export async function fetchActivity(limit = 60): Promise<Activity[]> {
  const { trades } = await get<{ trades: Activity[] }>(`/activity?limit=${limit}`);
  return trades;
}
