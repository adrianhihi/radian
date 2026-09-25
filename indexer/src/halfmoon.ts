import type { Address, Hex } from "viem";

// HalfMoon RFQ aggregation client (docs/HALFMOON_API.md, "mode one"). Market
// makers quote firm prices, the service returns calldata for its Router, and
// the caller broadcasts it on the same chain (BSC 56 / Base 8453). The keeper
// uses it to buy Pack coins that do not exist on the home chain and send them
// to the dead address (see keeper.ts otherChainBurns).
//
// Auth is the `business` JWT in HALFMOON_API_KEY, read from process.env at
// call time and never logged or echoed in an error. Every response is an
// envelope `{code, message, data}`; `code !== 10000` is a business failure
// and becomes a HalfMoonError carrying the code. HTTP 429 is retried once.

export const HALFMOON_BASE_URL = (process.env.HALFMOON_BASE_URL ?? "https://rfq.halfmoondex.com").replace(/\/$/, "");
export const HALFMOON_OK = 10000;

// The partner's error table. Anything else is reported as "unknown code".
export const HALFMOON_CODES: Record<number, string> = {
  401: "missing API key",
  429: "rate limited",
  10030: "insufficient liquidity",
  10070: "invalid API key",
  10084: "bad signature",
  10090: "unsupported chain",
  10091: "insufficient balance",
  10095: "bad params",
  20001: "service error",
  20002: "service error",
  20003: "service error",
  20004: "service error",
};

// Router / Settlement / Permit2 per chain, from the partner doc (2026-09-24). The keeper refuses to
// approve or call a router the firm quote names unless it is in this table (HALFMOON_ROUTERS_JSON
// extends it: '{"56":"0x…"}').
export const HALFMOON_ROUTERS: Record<number, Address> = {
  56: "0xC9f8Faab4708F498942aa9a18Ad1AF857e59A3D7",
  8453: "0xEC462c303970BD8175Ef8A43aCE23241359175f9",
};
try {
  const extra = JSON.parse(process.env.HALFMOON_ROUTERS_JSON ?? "{}") as Record<string, string>;
  for (const [k, v] of Object.entries(extra)) if (/^0x[0-9a-fA-F]{40}$/.test(v)) HALFMOON_ROUTERS[Number(k)] = v as Address;
} catch (e) {
  console.error("[halfmoon] HALFMOON_ROUTERS_JSON unreadable:", (e as Error).message);
}
export const HALFMOON_CHAINS = new Set<number>([56, 8453]); // execution chains (listing also returns Ethereum pairs)

export class HalfMoonError extends Error {
  readonly code: number;
  readonly label: string;
  readonly endpoint: string;
  constructor(code: number, message: string, endpoint: string) {
    const label = HALFMOON_CODES[code] ?? "unknown code";
    super(`HalfMoon ${endpoint}: ${label} (code ${code}${message ? `: ${message}` : ""})`);
    this.name = "HalfMoonError";
    this.code = code;
    this.label = label;
    this.endpoint = endpoint;
  }
}
export class HalfMoonNotConfiguredError extends Error {
  constructor() {
    super("HalfMoon not configured: set HALFMOON_API_KEY (server-side only)");
    this.name = "HalfMoonNotConfiguredError";
  }
}

export type HalfMoonPair = {
  id: number | string;
  chainId: number;
  baseToken: Address;
  quoteToken: Address;
  pairSymbol: string;
  feeRateBps: number;
  isEnabled: boolean;
  status: "DISABLED" | "TESTING" | "ACTIVE" | string;
  minTradeAmount: string;
};
export type HalfMoonToken = {
  id: number | string;
  chainId: number;
  address: Address;
  symbol: string;
  name: string;
  logoUrl: string;
  decimals: number;
  totalSupply: string;
  maxSupply: string;
  wrappedToken: Address | null;
  isEnabled: boolean;
};
export type IndicativeQuote = {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  feeRateBps: number;
  feeAmount: bigint;
};
export type FirmQuote = {
  swapId: string;
  chainId: number;
  /** Router.swap() calldata, decoded from the API's base64 to hex */
  calldata: Hex;
  routerAddress: Address;
  from: Address;
  to: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  amountOutMin: bigint;
  feeRateBps: number;
  feeAmount: bigint;
  /** unix seconds; the calldata must be mined before it */
  deadline: number;
};

export const isHalfMoonConfigured = () => Boolean(process.env.HALFMOON_API_KEY);

const LISTING_TTL_MS = 60_000;
const listingCache = new Map<string, { at: number; value: unknown }>();
// Test hooks: the retry delay and the cache are the only state worth resetting between cases.
export const halfmoonInternals = { retryDelayMs: 1000, resetCache: () => listingCache.clear() };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const addr = (v: unknown): Address => String(v ?? "").toLowerCase() as Address;
const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};

async function call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
  const key = process.env.HALFMOON_API_KEY;
  if (!key) throw new HalfMoonNotConfiguredError();
  const url = `${HALFMOON_BASE_URL}${path}`;
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status === 429 && attempt === 0) {
      await sleep(halfmoonInternals.retryDelayMs); // 100 QPS per IP, burst 120: one polite retry
      continue;
    }
    type Envelope = { code?: number; message?: string; data?: T };
    let env: Envelope | null = null;
    try {
      env = (await res.json()) as Envelope;
    } catch {
      env = null;
    }
    if (!env || typeof env.code !== "number") {
      throw new HalfMoonError(res.status, res.ok ? "malformed envelope" : `HTTP ${res.status}`, path);
    }
    if (env.code !== HALFMOON_OK) throw new HalfMoonError(env.code, env.message ?? "", path);
    return (env.data ?? ({} as T)) as T;
  }
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = listingCache.get(key);
  if (hit && Date.now() - hit.at < LISTING_TTL_MS) return hit.value as T;
  const value = await load();
  listingCache.set(key, { at: Date.now(), value });
  return value;
}

/** GET /v1/listing/pairs, filtered to one chain when given. Cached 60 s. */
export async function listPairs(chainId?: number): Promise<HalfMoonPair[]> {
  const all = await cached("pairs", async () => {
    const d = await call<{ pairs?: Record<string, unknown>[] }>("GET", "/v1/listing/pairs");
    return (d.pairs ?? []).map((p) => ({
      id: (p.id as number | string) ?? "",
      chainId: Number(p.chain_id),
      baseToken: addr(p.base_token),
      quoteToken: addr(p.quote_token),
      pairSymbol: String(p.pair_symbol ?? ""),
      feeRateBps: Number(p.fee_rate ?? 0),
      isEnabled: Boolean(p.is_enabled),
      status: String(p.status ?? ""),
      minTradeAmount: String(p.min_trade_amount ?? "0"),
    }));
  });
  return chainId == null ? all : all.filter((p) => p.chainId === chainId);
}

/** GET /v1/listing/tokens, filtered to one chain when given. Cached 60 s. */
export async function listTokens(chainId?: number): Promise<HalfMoonToken[]> {
  const all = await cached("tokens", async () => {
    const d = await call<{ tokens?: Record<string, unknown>[] }>("GET", "/v1/listing/tokens");
    return (d.tokens ?? []).map((t) => ({
      id: (t.id as number | string) ?? "",
      chainId: Number(t.chain_id),
      address: addr(t.token_address),
      symbol: String(t.token_symbol ?? ""),
      name: String(t.token_name ?? ""),
      logoUrl: String(t.logo_url ?? ""),
      decimals: Number(t.decimals ?? 18),
      totalSupply: String(t.total_supply ?? "0"),
      maxSupply: String(t.max_supply ?? "0"),
      wrappedToken: t.wrapped_token ? addr(t.wrapped_token) : null,
      isEnabled: Boolean(t.is_enabled),
    }));
  });
  return chainId == null ? all : all.filter((t) => t.chainId === chainId);
}

/** POST /v1/agg-swap/indicativeQuote: a non-binding estimate, no market-maker round trip. */
export async function indicativeQuote(q: { chainId: number; tokenIn: Address; tokenOut: Address; amountIn: bigint }): Promise<IndicativeQuote> {
  const d = await call<Record<string, unknown>>("POST", "/v1/agg-swap/indicativeQuote", {
    src_chain_id: q.chainId,
    dst_chain_id: q.chainId, // same-chain only today
    token_in: q.tokenIn,
    token_out: q.tokenOut,
    amount_in: q.amountIn.toString(),
  });
  return {
    chainId: Number(d.src_chain_id ?? q.chainId),
    tokenIn: addr(d.token_in ?? q.tokenIn),
    tokenOut: addr(d.token_out ?? q.tokenOut),
    amountIn: big(d.amount_in ?? q.amountIn),
    amountOut: big(d.amount_out),
    feeRateBps: Number(d.fee_rate ?? 0),
    feeAmount: big(d.fee_amount),
  };
}

/**
 * POST /v1/agg-swap/firmQuote: a binding quote with executable calldata. The caller approves
 * `amountIn` of an ERC-20 `tokenIn` to `routerAddress`, then sends `{to: routerAddress, data:
 * calldata, value: tokenIn is the gas coin ? amountIn : 0}` before `deadline`.
 */
export async function firmQuote(q: {
  chainId: number;
  from: Address;
  to: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  deadline: number;
}): Promise<FirmQuote> {
  const d = await call<Record<string, unknown>>("POST", "/v1/agg-swap/firmQuote", {
    src_chain_id: q.chainId,
    dst_chain_id: q.chainId,
    from_address: q.from,
    to_address: q.to,
    token_in: q.tokenIn,
    token_out: q.tokenOut,
    amount_in: q.amountIn.toString(),
    amount_out_min: q.amountOutMin.toString(),
    deadline: q.deadline,
  });
  const raw = String(d.calldata ?? "");
  if (!raw) throw new HalfMoonError(HALFMOON_OK, "firm quote without calldata", "/v1/agg-swap/firmQuote");
  const calldata = decodeCalldata(raw);
  const routerAddress = addr(d.router_address);
  if (!/^0x[0-9a-f]{40}$/.test(routerAddress)) throw new HalfMoonError(HALFMOON_OK, "firm quote without router_address", "/v1/agg-swap/firmQuote");
  return {
    swapId: String(d.swap_id ?? ""),
    chainId: Number(d.src_chain_id ?? q.chainId),
    calldata,
    routerAddress,
    from: addr(d.from_address ?? q.from),
    to: addr(d.to_address ?? q.to),
    tokenIn: addr(d.token_in ?? q.tokenIn),
    tokenOut: addr(d.token_out ?? q.tokenOut),
    amountIn: big(d.amount_in ?? q.amountIn),
    amountOut: big(d.amount_out),
    amountOutMin: big(d.amount_out_min ?? q.amountOutMin),
    feeRateBps: Number(d.fee_rate ?? 0),
    feeAmount: big(d.fee_amount),
    deadline: Number(d.deadline ?? q.deadline),
  };
}

/** `bytes` are base64 in JSON; a value that already looks like hex is passed through. */
export function decodeCalldata(raw: string): Hex {
  if (/^0x[0-9a-fA-F]*$/.test(raw)) return raw.toLowerCase() as Hex;
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 0 || buf.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw new HalfMoonError(HALFMOON_OK, "calldata is not valid base64", "/v1/agg-swap/firmQuote");
  }
  return `0x${buf.toString("hex")}` as Hex;
}

/**
 * POST /v1/quote/reportTxHash after the broadcast, so the partner can match the quote to the
 * transaction. Idempotent per (quote_id, tx_hash); the firm quote's `swap_id` is the quote id.
 */
export async function reportTxHash(chainId: number, pairs: { quoteId: string; txHash: Hex }[]): Promise<void> {
  if (!pairs.length) return;
  await call<unknown>("POST", "/v1/quote/reportTxHash", {
    chain_id: chainId,
    pairs: pairs.slice(0, 64).map((p) => ({ quote_id: p.quoteId, tx_hash: p.txHash })),
  });
}
