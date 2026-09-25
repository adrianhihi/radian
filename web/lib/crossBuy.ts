// Cross-chain buy through Relay: the buyer side of "launch once, trade everywhere —
// home on Robinhood Chain, buy from any chain" (docs/CROSS_CHAIN_BUY.md).
//
// The buyer pays USDC on Base / BNB. Relay's solver delivers the launch's quote asset
// on the home chain and, in the same fill, runs the destination calls we put in the
// quote (`txs`): for an ETH-quoted launch one call, `CrossBuyReceiver.buyFor` with the
// delivered ETH as `value`; for an ERC-20-quoted launch (USDG) a plain `transfer` of the
// delivered amount to the receiver and then `buyFor` with value 0 — the receiver spends
// its whole unparked balance of the launch's quote asset, so the transfer must come in
// the same transaction, which Relay's Multicaller guarantees. The receiver buys through
// the Radian router for the real buyer with the referral tag, and a buy that cannot
// complete is refunded on the home chain to `refundTo`; a fill that never happens is
// refunded by Relay on the origin chain to the quote's `refundTo` (the buyer).
//
// Every Relay field used here is one Relay documents; nothing is guessed:
// - POST /quote/v2 (https://docs.relay.link/references/api/get-quote-v2 — /quote is
//   marked "deprecated. Use /quote/v2 instead"): user, originChainId, destinationChainId,
//   originCurrency, destinationCurrency, amount, tradeType, recipient, refundTo,
//   txs[{to, data, value}]. Response: requestId, steps[{id, kind, items[{status, data
//   {from, to, data, value, chainId, gas, maxFeePerGas, maxPriorityFeePerGas}, check
//   {endpoint, method}}]}], fees{gas, relayer, relayerGas, relayerService, app, subsidized}
//   each {currency, amount, amountFormatted, amountUsd, minimumAmount}, details
//   {currencyIn, currencyOut, timeEstimate (seconds), rate, totalImpact}
//   (details confirmed in Relay's OpenAPI document, https://api.relay.link/documentation/json).
// - GET /chains (https://docs.relay.link/references/api/get-chains): chains[{id, name,
//   displayName, disabled, depositEnabled, ...}].
// - GET /intents/status/v3?requestId= (https://docs.relay.link/references/api/get-intents-status-v3):
//   status ∈ waiting | depositing | pending | submitted | success | delayed | refund |
//   failure, inTxHashes, txHashes, failReason, refundFailReason, details, updatedAt.
// - Calling guide (https://docs.relay.link/references/api/api_guides/calling-integration-guide):
//   EXACT_OUTPUT "when the destination call requires a precise output amount"; "the
//   amount parameter must equal the total value of all txs combined"; ERC-20 calls in
//   `txs` run from the holder of the delivered tokens ("include an approval transaction
//   in your txs array before the actual contract call"), so a `transfer` from there works
//   the same way; "Set value: '0' for ERC20-only calls".
// - Refunds (https://docs.relay.link/references/api/api_core_concepts/refunds): "Refunds
//   are paid on the origin chain to the refundTo address supplied on the quote"; "If
//   refundTo is not set, automatic refund is disabled".
//
// Two quotes per price: the delivered amount must be fixed in the calldata (the curve's
// price bound and the transfer amount), so first an EXACT_INPUT quote of the typed USDC
// tells what arrives on the home chain, then an EXACT_OUTPUT quote for exactly that
// amount carries the calls and binds what the buyer pays. Nothing here retries a send.
import { createPublicClient, defineChain, encodeFunctionData, http, parseAbi, type Address, type Chain, type Hex, type WalletClient } from "viem";
import type { CrossBuyOrigin } from "./networks";
import { erc20Abi, publicClient } from "./radian";

export const RELAY_API = "https://api.relay.link";
export const RELAY_QUOTE_PATH = "/quote/v2";
export const RELAY_CHAINS_PATH = "/chains";
export const RELAY_STATUS_PATH = "/intents/status/v3";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

// ---- the receiver (src/pound/CrossBuyReceiver.sol), only what the buyer side calls ----
export const crossBuyReceiverAbi = parseAbi([
  "function buyFor(address token, uint256 minTokensOut, address recipient, address refundTo, address referrer) payable",
  "function quoteAssetOf(address token) view returns (bool known, address asset)",
]);
const erc20TransferAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

/** `buyFor(token, minTokensOut, recipient, refundTo, referrer)`; `refundTo` defaults to the recipient, `referrer` to none. */
export function buildBuyForCalldata(p: { token: Address; minTokensOut: bigint; recipient: Address; refundTo?: Address; referrer?: Address }): Hex {
  return encodeFunctionData({
    abi: crossBuyReceiverAbi,
    functionName: "buyFor",
    args: [p.token, p.minTokensOut, p.recipient, p.refundTo ?? p.recipient, p.referrer ?? ZERO_ADDRESS],
  });
}

// ---- Relay request / response shapes (documented fields only) ----
export type RelayTx = { to: Address; data: Hex; value: string };
export type RelayTradeType = "EXACT_INPUT" | "EXACT_OUTPUT";
export type RelayQuoteBody = {
  user: Address;
  originChainId: number;
  destinationChainId: number;
  originCurrency: Address;
  destinationCurrency: Address;
  amount: string;
  tradeType: RelayTradeType;
  recipient: Address;
  refundTo: Address;
  txs?: RelayTx[];
};
export type RelayCurrency = { chainId: number; address: string; symbol: string; name: string; decimals: number };
export type RelayAmount = { currency: RelayCurrency; amount: string; amountFormatted: string; amountUsd?: string; minimumAmount?: string };
export type RelayTxData = { from: string; to: string; data: Hex; value: string; chainId: number; gas?: string | number; maxFeePerGas?: string; maxPriorityFeePerGas?: string };
export type RelayStepItem = { status: "complete" | "incomplete"; data: RelayTxData; check?: { endpoint: string; method: string } };
export type RelayStep = { id: string; action?: string; description?: string; kind: "transaction" | "signature"; items: RelayStepItem[] };
export type RelayQuote = {
  requestId?: string;
  steps: RelayStep[];
  fees?: Partial<Record<"gas" | "relayer" | "relayerGas" | "relayerService" | "app" | "subsidized", RelayAmount>>;
  details?: { operation?: string; timeEstimate?: number; rate?: string; currencyIn?: RelayAmount; currencyOut?: RelayAmount; totalImpact?: { usd?: string; percent?: string } };
};
export type RelayStatusValue = "waiting" | "depositing" | "pending" | "submitted" | "success" | "delayed" | "refund" | "failure";
export type RelayStatus = {
  status: RelayStatusValue;
  details?: string;
  inTxHashes?: string[];
  txHashes?: string[];
  updatedAt?: number;
  originChainId?: number;
  destinationChainId?: number;
  failReason?: string;
  refundFailReason?: string;
};
export type RelayChain = { id: number; name?: string; displayName?: string; disabled?: boolean; depositEnabled?: boolean };

/** The destination calls for one delivery: ETH rides as `value` on `buyFor`; an ERC-20 is transferred to the receiver first, then `buyFor` with value 0. */
export function buildDeliveryTxs(p: { receiver: Address; quoteAsset: Address; delivered: bigint; calldata: Hex }): RelayTx[] {
  if (p.quoteAsset === ZERO_ADDRESS) return [{ to: p.receiver, data: p.calldata, value: p.delivered.toString() }];
  return [
    { to: p.quoteAsset, data: encodeFunctionData({ abi: erc20TransferAbi, functionName: "transfer", args: [p.receiver, p.delivered] }), value: "0" },
    { to: p.receiver, data: p.calldata, value: "0" },
  ];
}

/** A /quote/v2 body. `refundTo` is always the buyer on the origin chain: without it Relay does not refund a failed fill. */
export function buildQuoteBody(p: {
  user: Address;
  origin: CrossBuyOrigin;
  homeChainId: number;
  quoteAsset: Address;
  amount: bigint;
  tradeType: RelayTradeType;
  recipient: Address;
  txs?: RelayTx[];
}): RelayQuoteBody {
  const body: RelayQuoteBody = {
    user: p.user,
    originChainId: p.origin.chainId,
    destinationChainId: p.homeChainId,
    originCurrency: p.origin.usdc,
    destinationCurrency: p.quoteAsset,
    amount: p.amount.toString(),
    tradeType: p.tradeType,
    recipient: p.recipient,
    refundTo: p.user,
  };
  if (p.txs) body.txs = p.txs;
  return body;
}

// ---- failures, by shape ----
export type CrossBuyFail = "unknownToken" | "curve" | "relay" | "unsupportedStep" | "noWallet" | "reverted" | "failed" | "refunded";
export class CrossBuyError extends Error {
  kind: CrossBuyFail;
  detail: string;
  constructor(kind: CrossBuyFail, detail = "") {
    super(detail || kind);
    this.name = "CrossBuyError";
    this.kind = kind;
    this.detail = detail;
  }
}

const messageOf = (j: unknown): string | null => {
  const x = j as { message?: unknown; error?: unknown; errorCode?: unknown } | null;
  const m = [x?.message, x?.error, x?.errorCode].find((v) => typeof v === "string" && v.length > 0);
  return typeof m === "string" ? m.slice(0, 200) : null;
};

async function relayFetch<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${RELAY_API}${path}`, { ...init, cache: "no-store", headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
  } catch (e) {
    throw new CrossBuyError("relay", (e as Error)?.message ?? "Relay unreachable");
  }
  const text = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON: the status line is the message */
  }
  if (!r.ok) throw new CrossBuyError("relay", messageOf(json) ?? `Relay ${r.status}`);
  return json as T;
}

// ---- coverage: GET /chains, once per session ----
let chainsPromise: Promise<RelayChain[]> | null = null;
export function relayChains(): Promise<RelayChain[]> {
  if (!chainsPromise) {
    chainsPromise = relayFetch<{ chains?: RelayChain[] } | RelayChain[]>(RELAY_CHAINS_PATH)
      .then((j) => (Array.isArray(j) ? j : (j.chains ?? [])))
      .catch((e) => {
        chainsPromise = null; // a failed read is not "unsupported": try again next time
        throw e;
      });
  }
  return chainsPromise;
}
/** Whether Relay lists `chainId` and has not disabled it. Throws when Relay cannot be reached (the caller says so; it never means "unsupported"). */
export async function relaySupports(chainId: number): Promise<boolean> {
  const chains = await relayChains();
  return chains.some((c) => c.id === chainId && !c.disabled);
}

// ---- the origin chains (viem chain objects + read clients), from lib/networks `crossBuy.origins` ----
const chains = new Map<number, Chain>();
export function originChain(o: CrossBuyOrigin): Chain {
  let c = chains.get(o.chainId);
  if (!c) {
    c = defineChain({
      id: o.chainId,
      name: o.label,
      nativeCurrency: { name: o.nativeSymbol, symbol: o.nativeSymbol, decimals: 18 },
      rpcUrls: { default: { http: [o.rpc] } },
      blockExplorers: { default: { name: "Explorer", url: o.explorer } },
    });
    chains.set(o.chainId, c);
  }
  return c;
}
const clients = new Map<number, ReturnType<typeof createPublicClient>>();
export function originPublicClient(o: CrossBuyOrigin) {
  let c = clients.get(o.chainId);
  if (!c) {
    c = createPublicClient({ chain: originChain(o), transport: http(o.rpc) });
    clients.set(o.chainId, c);
  }
  return c;
}
/** The buyer's USDC on the origin chain, in its smallest unit (`origin.usdcDecimals`). */
export async function originUsdcBalance(o: CrossBuyOrigin, who: Address): Promise<bigint> {
  return (await originPublicClient(o).readContract({ address: o.usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] })) as bigint;
}
export const originExplorerTx = (o: CrossBuyOrigin, hash: string) => `${o.explorer}/tx/${hash}`;

// ---- the quote ----
export type CrossBuyQuote = {
  origin: CrossBuyOrigin;
  token: Address;
  /** the home-chain asset Relay delivers (zero = ETH), from the receiver's `quoteAssetOf` */
  quoteAsset: Address;
  /** what the buyer pays on the origin chain, bound by the EXACT_OUTPUT quote */
  pay: RelayAmount;
  /** what lands at the receiver on the home chain and is spent on the curve */
  delivered: bigint;
  deliveredFormatted: string;
  /** the curve's answer for `delivered`: the estimate and the bound written into the calldata */
  tokensOut: bigint;
  minTokensOut: bigint;
  relayFee: RelayAmount | null;
  originGas: RelayAmount | null;
  etaSeconds: number | null;
  requestId: string | null;
  steps: RelayStep[];
  /** the status endpoint of the deposit step (path under RELAY_API) */
  checkEndpoint: string | null;
  quotedAt: number;
};

/**
 * Price a cross-chain buy of `token` with `amount` USDC (smallest unit) from `origin`. The receiver
 * must know the token (`quoteAssetOf`); an unknown token never reaches Relay. `curveQuote` is the
 * curve's estimate for a given delivered amount (lib/useTrade quoteBuy with the viewer's slippage).
 */
export async function quoteCrossBuy(p: {
  origin: CrossBuyOrigin;
  amount: bigint;
  token: Address;
  recipient: Address;
  receiver: Address;
  homeChainId: number;
  curveQuote: (delivered: bigint) => { out: bigint; minOut: bigint } | null;
  refundTo?: Address;
  referrer?: Address;
  signal?: AbortSignal;
}): Promise<CrossBuyQuote> {
  const [known, quoteAsset] = (await publicClient.readContract({ address: p.receiver, abi: crossBuyReceiverAbi, functionName: "quoteAssetOf", args: [p.token] })) as readonly [boolean, Address];
  if (!known) throw new CrossBuyError("unknownToken");

  // 1. what `amount` USDC becomes on the home chain
  const probe = await relayFetch<RelayQuote>(RELAY_QUOTE_PATH, {
    method: "POST",
    body: JSON.stringify(buildQuoteBody({ user: p.recipient, origin: p.origin, homeChainId: p.homeChainId, quoteAsset, amount: p.amount, tradeType: "EXACT_INPUT", recipient: p.recipient })),
    signal: p.signal,
  });
  const outAmount = probe.details?.currencyOut?.amount;
  if (!outAmount) throw new CrossBuyError("relay", "Relay's quote carries no destination amount");
  const delivered = BigInt(outAmount);
  if (delivered <= 0n) throw new CrossBuyError("relay", "Relay's quote delivers nothing");

  // 2. the curve's bound for exactly that delivery, written into the calls
  const cq = p.curveQuote(delivered);
  if (!cq) throw new CrossBuyError("curve");
  const calldata = buildBuyForCalldata({ token: p.token, minTokensOut: cq.minOut, recipient: p.recipient, refundTo: p.refundTo ?? p.recipient, referrer: p.referrer });
  const txs = buildDeliveryTxs({ receiver: p.receiver, quoteAsset, delivered, calldata });

  // 3. the binding quote: exactly `delivered` on the home chain, with the calls
  const q = await relayFetch<RelayQuote>(RELAY_QUOTE_PATH, {
    method: "POST",
    body: JSON.stringify(buildQuoteBody({ user: p.recipient, origin: p.origin, homeChainId: p.homeChainId, quoteAsset, amount: delivered, tradeType: "EXACT_OUTPUT", recipient: p.recipient, txs })),
    signal: p.signal,
  });
  const pay = q.details?.currencyIn;
  if (!pay?.amount) throw new CrossBuyError("relay", "Relay's quote carries no origin amount");
  if (!Array.isArray(q.steps) || q.steps.length === 0) throw new CrossBuyError("relay", "Relay's quote carries no steps");
  const deposit = [...q.steps].reverse().find((s) => s.kind === "transaction");
  const check = deposit?.items.find((i) => i.check?.endpoint)?.check?.endpoint ?? (q.requestId ? `${RELAY_STATUS_PATH}?requestId=${q.requestId}` : null);
  const outDec = q.details?.currencyOut?.currency?.decimals ?? probe.details?.currencyOut?.currency?.decimals ?? 18;
  return {
    origin: p.origin,
    token: p.token,
    quoteAsset,
    pay,
    delivered,
    deliveredFormatted: q.details?.currencyOut?.amountFormatted ?? formatFixed(delivered, outDec),
    tokensOut: cq.out,
    minTokensOut: cq.minOut,
    relayFee: q.fees?.relayer ?? null,
    originGas: q.fees?.gas ?? null,
    etaSeconds: typeof q.details?.timeEstimate === "number" ? q.details.timeEstimate : null,
    requestId: q.requestId ?? null,
    steps: q.steps,
    checkEndpoint: check,
    quotedAt: Date.now(),
  };
}

const formatFixed = (v: bigint, dec: number): string => {
  const s = v.toString().padStart(dec + 1, "0");
  const i = s.slice(0, s.length - dec);
  const f = s.slice(s.length - dec).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
};

// ---- execution: sign the origin steps, then follow the fill ----
export type CrossBuyStage = "switch" | "approve" | "confirm" | "sent" | "filling";
export type CrossBuyResult = {
  status: "success" | "pending";
  requestId: string | null;
  originTxHash: Hex | null;
  /** the home-chain fill (Relay `txHashes[0]`); null while still pending */
  destinationTxHash: Hex | null;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res) => {
    const id = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      res();
    });
  });

/** GET the status endpoint until Relay settles; `pending` after `maxWaitMs` (the fill may still land — nothing is resent). */
export async function pollRelayStatus(endpoint: string, o: { onStatus?: (s: RelayStatus) => void; signal?: AbortSignal; pollMs?: number; maxWaitMs?: number } = {}): Promise<RelayStatus | null> {
  const started = Date.now();
  const pollMs = o.pollMs ?? 3000;
  const maxWaitMs = o.maxWaitMs ?? 15 * 60_000;
  while (!o.signal?.aborted) {
    let s: RelayStatus | null = null;
    try {
      s = await relayFetch<RelayStatus>(endpoint, { signal: o.signal });
    } catch {
      /* a failed read is not a failed fill: read again */
    }
    if (s) {
      o.onStatus?.(s);
      if (s.status === "success") return s;
      if (s.status === "failure") throw new CrossBuyError("failed", [s.failReason, s.details].filter(Boolean).join(" · "));
      if (s.status === "refund") throw new CrossBuyError("refunded", [s.failReason, s.refundFailReason, s.details].filter(Boolean).join(" · "));
    }
    if (Date.now() - started > maxWaitMs) return null;
    await sleep(pollMs, o.signal);
  }
  return null;
}

/**
 * Send the quote's origin transactions with the buyer's wallet (switched to the origin chain by
 * `getClient`), wait for each receipt, then poll Relay until the fill lands. Resolves with the
 * home-chain transaction hash so /tx/<hash> can show the buy.
 */
export async function executeCrossBuy(
  q: CrossBuyQuote,
  o: {
    getClient: (chain: Chain) => Promise<{ client: WalletClient; account: Address } | null>;
    onStage?: (stage: CrossBuyStage, meta?: { hash?: Hex; relay?: RelayStatus }) => void;
    signal?: AbortSignal;
    pollMs?: number;
    maxWaitMs?: number;
  },
): Promise<CrossBuyResult> {
  const todo = q.steps.filter((s) => s.items.some((i) => i.status !== "complete"));
  const odd = todo.find((s) => s.kind !== "transaction" || s.items.some((i) => i.data?.chainId !== q.origin.chainId));
  if (odd) throw new CrossBuyError("unsupportedStep", odd.kind === "transaction" ? `${odd.id} on chain ${odd.items[0]?.data?.chainId}` : odd.kind);

  const chain = originChain(q.origin);
  o.onStage?.("switch");
  const wc = await o.getClient(chain);
  if (!wc) throw new CrossBuyError("noWallet");
  const { client, account } = wc;
  const reader = originPublicClient(q.origin);

  let originTxHash: Hex | null = null;
  let checkEndpoint = q.checkEndpoint;
  for (const step of todo) {
    for (const item of step.items) {
      if (item.status === "complete") continue;
      const d = item.data;
      o.onStage?.(step.id === "approve" ? "approve" : "confirm");
      const hash = await client.sendTransaction({
        account,
        chain,
        to: d.to as Address,
        data: d.data,
        value: BigInt(d.value || "0"),
        gas: d.gas != null && d.gas !== "" ? BigInt(d.gas) : undefined,
      });
      originTxHash = hash;
      o.onStage?.("sent", { hash });
      const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success") throw new CrossBuyError("reverted", `${step.id} reverted on ${q.origin.label}`);
      if (item.check?.endpoint) checkEndpoint = item.check.endpoint;
    }
  }

  o.onStage?.("filling");
  if (!checkEndpoint) return { status: "pending", requestId: q.requestId, originTxHash, destinationTxHash: null };
  const final = await pollRelayStatus(checkEndpoint, { signal: o.signal, pollMs: o.pollMs, maxWaitMs: o.maxWaitMs, onStatus: (relay) => o.onStage?.("filling", { relay }) });
  if (!final) return { status: "pending", requestId: q.requestId, originTxHash, destinationTxHash: null };
  const dest = final.txHashes?.find((h) => /^0x[0-9a-fA-F]{64}$/.test(h)) as Hex | undefined;
  return { status: "success", requestId: q.requestId, originTxHash, destinationTxHash: dest ?? null };
}
