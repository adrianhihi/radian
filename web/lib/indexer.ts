import type { LaunchRow, LaunchTemplate } from "./radian";
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
  template?: ApiTemplate | null;
};

// Wire shape of a launch's template. Anything unexpected → null (Standard).
type ApiTemplate =
  | { kind: "wall"; treasury: Address; staking: Address }
  | { kind: "pof"; vault: Address; pofRouter: Address };

function parseTemplate(t: ApiTemplate | null | undefined): LaunchTemplate | null {
  if (!t || typeof t !== "object") return null;
  if (t.kind === "wall" && t.treasury && t.staking) return { kind: "wall", treasury: t.treasury, staking: t.staking };
  if (t.kind === "pof" && t.vault && t.pofRouter) return { kind: "pof", vault: t.vault, pofRouter: t.pofRouter };
  return null;
}

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
    template: parseTemplate(l.template),
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

export type TokenMeta = {
  curve: Address;
  pairToken: Address;
  deployer: Address;
  sunset: Sunset | null;
  template: LaunchTemplate | null; // null = Standard, or the indexer predates templates
};

export async function fetchTokenMeta(token: string): Promise<TokenMeta | null> {
  try {
    const { token: t } = await get<{
      token?: { curve: Address; pairToken?: Address; deployer: Address; sunset?: Sunset | null; template?: ApiTemplate | null };
    }>(`/token/${token}`);
    if (!t?.curve) return null;
    return {
      curve: t.curve,
      pairToken: t.pairToken ?? ("0x0000000000000000000000000000000000000000" as Address),
      deployer: t.deployer,
      sunset: t.sunset ?? null,
      template: parseTemplate(t.template),
    };
  } catch {
    return null;
  }
}

// ── Auto-buy schedules (RadianExecutor) ──────────────────────────────────
// The signed EIP-712 authorization is stored by the indexer, which runs the
// keeper. All uint fields travel as decimal strings.
export type AuthMessage = {
  user: Address;
  token: Address;
  perBuyMax: string;
  maxGasPrice: string;
  totalCount: string;
  minInterval: string;
  deadline: string;
  nonce: string;
};
export type AuthStatus = "active" | "done" | "expired" | "cancelled";
export type AuthRecord = {
  authId: string;
  auth: AuthMessage;
  signature: `0x${string}`;
  count: number;
  lastAt: number; // unix seconds, 0 = never
  status: AuthStatus;
};

export async function postAuth(auth: AuthMessage, signature: `0x${string}`): Promise<{ authId: string }> {
  const r = await fetch(`${INDEXER_URL}/v1/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ auth, signature }),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; authId?: string; error?: string };
  if (!r.ok || !j.ok || !j.authId) throw new Error(j.error ?? `indexer /v1/auth ${r.status}`);
  return { authId: j.authId };
}

export async function fetchAuths(user: string): Promise<AuthRecord[]> {
  const { auths } = await get<{ auths?: AuthRecord[] }>(`/v1/auth/${user}`);
  return Array.isArray(auths) ? auths : [];
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
