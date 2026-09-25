import type { LaunchRow, LaunchTemplate } from "./radian";
import { getActiveNetwork } from "./networks";
import type { Address } from "viem";

// Optional indexer (Phase 4b): one fast, reliable request instead of hammering
// Arc's public RPC from every client. URL comes from the active network; falls
// back to on-chain reads when unset or unreachable.
export const INDEXER_URL = getActiveNetwork().indexerUrl.replace(/\/$/, "");

export const hasIndexer = () => INDEXER_URL.length > 0;

// Public lists carry a short Cache-Control from the indexer, so the browser may reuse a response
// for a few seconds across pages; per-wallet reads ask for a fresh one.
async function get<T>(path: string, fresh = false): Promise<T> {
  const r = await fetch(`${INDEXER_URL}${path}`, fresh ? { cache: "no-store" } : undefined);
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
  spark?: [number, number][];
  lastPrice?: number | null;
  change24h?: number | null;
  volume24h?: number;
  trades24h?: number;
  createdAt?: number;
  creatorName?: string;
  holders?: number | null;
};

// Wire shape of a launch's template. Anything unexpected → null (Standard).
type ApiTemplate =
  | { kind: "wall"; treasury: Address; staking: Address; ladder?: Address }
  | { kind: "pof"; vault: Address; pofRouter: Address };

function parseTemplate(t: ApiTemplate | null | undefined): LaunchTemplate | null {
  if (!t || typeof t !== "object") return null;
  if (t.kind === "wall" && t.treasury && t.staking) return { kind: "wall", treasury: t.treasury, staking: t.staking, ...(t.ladder ? { ladder: t.ladder } : {}) };
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
    spark: Array.isArray(l.spark) ? l.spark : [],
    lastPrice: typeof l.lastPrice === "number" ? l.lastPrice : null,
    change24h: typeof l.change24h === "number" ? l.change24h : null,
    volume24h: typeof l.volume24h === "number" ? l.volume24h : 0,
    trades24h: typeof l.trades24h === "number" ? l.trades24h : 0,
    createdAt: typeof l.createdAt === "number" ? l.createdAt : undefined,
    creatorName: typeof l.creatorName === "string" ? l.creatorName : "",
    holders: typeof l.holders === "number" ? l.holders : null,
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
  // executor v2 only
  asset?: Address;
  minPerBuy?: string;
  minTokensPerQuote?: string;
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

// One wallet's activity from the indexer's scan (see /address/:addr/activity).
export type WalletEvent = {
  kind: "buy" | "sell" | "launch" | "referralClaim";
  ts: number;
  block: string;
  txHash?: string;
  token?: string;
  symbol?: string;
  quote?: string;
  tokens?: string;
  amount?: string;
  asset?: string;
  quoteSymbol?: string;
  quoteDecimals?: number;
};
export async function fetchWalletActivity(address: string): Promise<{ indexed: boolean; through: string; events: WalletEvent[] }> {
  const j = await get<{ indexed?: boolean; through?: string; events?: WalletEvent[] }>(`/address/${address}/activity`, true);
  return { indexed: !!j.indexed, through: j.through ?? "0", events: j.events ?? [] };
}

// Reconciliation (see indexer/src/reconcile.ts): the index re-derived from the chain at the index's own
// checkpoint block, one row per family of checks. `expected` is what the index implies, `actual` what the
// contracts returned at that block; a failed read is a failing check with the reason in `detail`.
export type ReconcileCheck = { key: string; label: string; ok: boolean; expected: string; actual: string; detail?: string };
export type ReconcileReport = { block: number; computedAt: number; allOk: boolean; checks: ReconcileCheck[] };

export async function fetchReconcile(fresh = false): Promise<ReconcileReport> {
  const j = await get<Partial<ReconcileReport>>("/reconcile", fresh);
  if (typeof j.block !== "number" || !Array.isArray(j.checks)) throw new Error("indexer /reconcile: malformed report");
  return {
    block: j.block,
    computedAt: typeof j.computedAt === "number" ? j.computedAt : 0,
    allOk: !!j.allOk,
    checks: j.checks.filter((c): c is ReconcileCheck => !!c && typeof c === "object" && typeof c.key === "string"),
  };
}

// One transaction, resolved by the indexer's node (see /tx/:hash) so a tab or an agent needs no
// RPC of its own: the status, the launched token decoded from the receipt, and the decoded
// Radian events (curve trades, fee claims, Pound settlements, Pack burns). Amounts travel as
// decimal strings in the asset's own units; `quoteDecimals` says how to read them.
export type TxStatus = "pending" | "success" | "reverted" | "unknown";
export type TxEvent = {
  kind: "launch" | "buy" | "sell" | "claim" | "flush" | "settle" | "burn";
  token?: Address;
  symbol?: string;
  curve?: Address;
  template?: "wall" | "pof";
  trader?: Address;
  amounts?: { quote?: string; tokens?: string; amount?: string; asset?: string; fee?: string; tax?: string; quoteSymbol?: string; quoteDecimals?: number };
};
export type TxStatusResult = {
  hash: string;
  status: TxStatus;
  blockNumber?: string;
  confirmations?: number;
  token?: { address: Address; symbol?: string; name?: string };
  events: TxEvent[];
};
/** Throws when the indexer cannot answer (unreachable, or its node is down): the caller must not read that as "pending". */
export async function fetchTxStatus(hash: string): Promise<TxStatusResult> {
  const j = await get<Partial<TxStatusResult>>(`/tx/${hash}`, true);
  const status: TxStatus = j.status === "success" || j.status === "reverted" || j.status === "pending" ? j.status : "unknown";
  return {
    hash: typeof j.hash === "string" ? j.hash : hash,
    status,
    blockNumber: typeof j.blockNumber === "string" ? j.blockNumber : undefined,
    confirmations: typeof j.confirmations === "number" ? j.confirmations : undefined,
    token: j.token && typeof j.token === "object" && typeof j.token.address === "string" ? j.token : undefined,
    events: Array.isArray(j.events) ? j.events : [],
  };
}

// ── The Pound's burn feed (see /pound/feed.json and /pound/feed.rss in server.ts) ─────────────
// One item per Pack burn, newest first, the transaction link as the item link: the same list any
// RSS-to-X / Zapier / IFTTT automation reads, so the burn cards on /earn and the auto-posts agree.
export type BurnFeedItem = {
  id: string;
  url: string; // the explorer's transaction page
  txHash: string;
  ts: number; // ms
  token: Address;
  symbol: string;
  index: number | null;
  asset: Address;
  assetSymbol: string;
  assetDecimals: number;
  quoteIn: string;
  tokensOut: string;
  bounty: string;
  caller: Address | null;
  title: string;
  text: string; // the feed's pre-written English line
};
export const burnFeedUrl = (kind: "rss" | "json"): string => `${INDEXER_URL}/pound/feed.${kind}`;

type WireFeedItem = { id?: string; url?: string; title?: string; content_text?: string; date_published?: string; _radian?: Partial<Omit<BurnFeedItem, "id" | "url" | "title" | "text">> };

/** Throws when the indexer cannot answer or the feed is malformed: the caller must show "unread", never "no burns". */
export async function fetchBurnFeed(): Promise<BurnFeedItem[]> {
  const j = await get<{ items?: WireFeedItem[] }>("/pound/feed.json");
  if (!Array.isArray(j.items)) throw new Error("indexer /pound/feed.json: malformed feed");
  const out: BurnFeedItem[] = [];
  for (const it of j.items) {
    const r = it._radian;
    if (!r || typeof r.txHash !== "string" || typeof r.token !== "string") continue;
    out.push({
      id: typeof it.id === "string" ? it.id : r.txHash,
      url: typeof it.url === "string" ? it.url : "",
      txHash: r.txHash,
      ts: typeof r.ts === "number" ? r.ts : Date.parse(it.date_published ?? "") || 0,
      token: r.token,
      symbol: typeof r.symbol === "string" ? r.symbol : "",
      index: typeof r.index === "number" ? r.index : null,
      asset: (typeof r.asset === "string" ? r.asset : "0x0000000000000000000000000000000000000000") as Address,
      assetSymbol: typeof r.assetSymbol === "string" ? r.assetSymbol : "",
      assetDecimals: typeof r.assetDecimals === "number" ? r.assetDecimals : 18,
      quoteIn: typeof r.quoteIn === "string" ? r.quoteIn : "0",
      tokensOut: typeof r.tokensOut === "string" ? r.tokensOut : "0",
      bounty: typeof r.bounty === "string" ? r.bounty : "0",
      caller: typeof r.caller === "string" ? r.caller : null,
      title: typeof it.title === "string" ? it.title : "",
      text: typeof it.content_text === "string" ? it.content_text : "",
    });
  }
  return out;
}

// Per-coin burn facts the /pound Pack rows carry beyond lib/pound's PoundPack: the launch's name and
// logo when the coin is one of ours, and the quote spent burning it so far (its Burned events summed,
// in the pack's asset), with how many burns and when the last one landed (unix seconds).
export type PackBurnFacts = { name?: string; logo?: string; burnedQuote?: string; burnCount?: number; lastBurnAt?: number };
