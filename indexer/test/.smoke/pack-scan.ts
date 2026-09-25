// Read-only survey of every Uniswap V4 pool on Robinhood Chain mainnet, for picking The Pound's
// Pack (docs/PACK_CANDIDATES.md). Nothing here signs or broadcasts.
//
//   cd indexer && OUT=/some/dir npx tsx test/.smoke/pack-scan.ts scan     # PoolManager Initialize events → pools.json
//   cd indexer && OUT=/some/dir npx tsx test/.smoke/pack-scan.ts tokens   # symbol/name/decimals/totalSupply/PoolManager balance → tokens.json
//   cd indexer && OUT=/some/dir npx tsx test/.smoke/pack-scan.ts pools    # slot0 + liquidity per pool via extsload → pool-state.json
//   cd indexer && OUT=/some/dir npx tsx test/.smoke/pack-scan.ts report   # prices in USDG/ETH, per-token liquidity → report.json + report.csv
//
// The public RPC (https://rpc.mainnet.chain.robinhood.com) is not an archive node and answers 429
// when pushed, so every stage chunks conservatively, sleeps between requests, backs off on 429 and
// writes its file after every chunk (re-running resumes). Env: RPC, OUT, START (scan start block),
// CHUNK (blocks per eth_getLogs, default 250000).
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  keccak256,
  encodePacked,
  type Address,
  type Hex,
} from "viem";

const RPC = process.env.RPC ?? "https://rpc.mainnet.chain.robinhood.com";
const OUT = process.env.OUT ?? join(process.cwd(), "pack-scan-out");
const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951" as Address;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const ZERO = "0x0000000000000000000000000000000000000000";
const OUR_HOOK = "0x892ab29d86219391cff9a127eee428853c71a044"; // PonsV2MemeHook (Radian, mainnet)
const POOLS_SLOT = 6n;
const LIQUIDITY_OFFSET = 3n;
const Q96 = 2n ** 96n;

const client = createPublicClient({ transport: http(RPC, { timeout: 120_000, retryCount: 0 }) });

const initializeEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);
const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const extsloadAbi = parseAbi(["function extsload(bytes32[] slots) view returns (bytes32[])"]);
// canonical V4Quoter on Robinhood Chain (docs.uniswap.org/contracts/v4/deployments, code checked on-chain 2026-09-25)
const QUOTER = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94" as Address;
const quoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

type Pool = {
  id: Hex;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  sqrtPriceX96Init: string;
  tickInit: number;
  block: number;
  tx: Hex;
};
type Token = {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  totalSupply: string | null;
  pmBalance: string; // held by the PoolManager (all pools together)
};
type PoolState = { id: Hex; sqrtPriceX96: string; tick: number; liquidity: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const readJson = <T>(name: string, fallback: T): T => (existsSync(join(OUT, name)) ? (JSON.parse(readFileSync(join(OUT, name), "utf8")) as T) : fallback);
const writeJson = (name: string, v: unknown) => writeFileSync(join(OUT, name), JSON.stringify(v, null, 0));
const is429 = (e: unknown) => /429|too many requests|rate/i.test(String((e as Error)?.message ?? e));

async function withBackoff<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let wait = 4000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 8) throw e;
      const msg = String((e as Error)?.message ?? e).split("\n")[0];
      console.warn(`[${label}] ${msg} → sleeping ${wait} ms`);
      await sleep(wait);
      wait = Math.min(wait * 2, 60_000);
    }
  }
}

// ---- stage 1: Initialize events ----
async function scan() {
  const head = Number(await client.getBlockNumber());
  const saved = readJson<{ cursor: number; pools: Pool[] }>("pools.json", { cursor: Number(process.env.START ?? 0), pools: [] });
  let from = saved.cursor;
  let chunk = Number(process.env.CHUNK ?? 250_000);
  const pools = saved.pools;
  const seen = new Set(pools.map((p) => p.id));
  console.log(`scan: ${from} → ${head} (${pools.length} pools saved)`);
  while (from <= head) {
    const to = Math.min(from + chunk - 1, head);
    let logs;
    try {
      logs = await client.getLogs({ address: POOL_MANAGER, event: initializeEvent, fromBlock: BigInt(from), toBlock: BigInt(to) });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).split("\n")[0];
      if (is429(e)) {
        console.warn(`429 at ${from}-${to}; sleeping 10 s`);
        await sleep(10_000);
      } else if (chunk > 5_000) {
        chunk = Math.floor(chunk / 2);
        console.warn(`getLogs ${from}-${to} failed (${msg}); chunk → ${chunk}`);
        await sleep(2000);
      } else {
        throw e;
      }
      continue;
    }
    for (const l of logs) {
      const a = l.args;
      if (!a.id || seen.has(a.id)) continue;
      seen.add(a.id);
      pools.push({
        id: a.id,
        currency0: a.currency0!.toLowerCase(),
        currency1: a.currency1!.toLowerCase(),
        fee: Number(a.fee),
        tickSpacing: Number(a.tickSpacing),
        hooks: a.hooks!.toLowerCase(),
        sqrtPriceX96Init: a.sqrtPriceX96!.toString(),
        tickInit: Number(a.tick),
        block: Number(l.blockNumber),
        tx: l.transactionHash!,
      });
    }
    from = to + 1;
    writeJson("pools.json", { cursor: from, pools });
    console.log(`  ${to}/${head}: +${logs.length} (total ${pools.length})`);
    if (logs.length > 6000 && chunk > 20_000) chunk = Math.floor(chunk / 2); // stay under the response cap
    await sleep(400);
  }
  console.log(`done: ${pools.length} pools up to block ${head}`);
}

// ---- stage 2: token metadata + PoolManager balances ----
async function tokens() {
  const { pools } = readJson<{ cursor: number; pools: Pool[] }>("pools.json", { cursor: 0, pools: [] });
  const st = readJson<Record<string, PoolState>>("pool-state.json", {});
  const live = Object.keys(st).length ? pools.filter((p) => st[p.id] && st[p.id].liquidity !== "0") : pools;
  let addrs = [...new Set(live.flatMap((p) => [p.currency0, p.currency1]))].filter((a) => a !== ZERO);
  // TOKENS_FILE: a JSON array of addresses to restrict this stage to (e.g. the tokens whose ETH/USDG pool is deep enough to matter)
  if (process.env.TOKENS_FILE) addrs = (JSON.parse(readFileSync(process.env.TOKENS_FILE, "utf8")) as string[]).map((a) => a.toLowerCase());
  console.log(`tokens: ${live.length} live pools of ${pools.length}`);
  const out = readJson<Record<string, Token>>("tokens.json", {});
  const todo = addrs.filter((a) => !out[a]);
  console.log(`tokens: ${addrs.length} currencies, ${todo.length} to resolve`);
  const ethBal = await client.getBalance({ address: POOL_MANAGER });
  out[ZERO] = { address: ZERO, symbol: "ETH", name: "Ether (gas coin)", decimals: 18, totalSupply: null, pmBalance: ethBal.toString() };
  const PER = Number(process.env.PER ?? 150); // tokens per multicall (5 calls each)
  for (let i = 0; i < todo.length; i += PER) {
    const part = todo.slice(i, i + PER);
    const contracts = part.flatMap((a) => [
      { address: a as Address, abi: erc20Abi, functionName: "symbol" },
      { address: a as Address, abi: erc20Abi, functionName: "name" },
      { address: a as Address, abi: erc20Abi, functionName: "decimals" },
      { address: a as Address, abi: erc20Abi, functionName: "totalSupply" },
      { address: a as Address, abi: erc20Abi, functionName: "balanceOf", args: [POOL_MANAGER] },
    ] as const);
    const res = await withBackoff(() => client.multicall({ contracts, allowFailure: true, multicallAddress: MULTICALL3, batchSize: 0 }), "multicall");
    part.forEach((a, k) => {
      const r = res.slice(k * 5, k * 5 + 5);
      const ok = (j: number) => (r[j].status === "success" ? r[j].result : null);
      out[a] = {
        address: a,
        symbol: (ok(0) as string | null)?.toString().slice(0, 64) ?? null,
        name: (ok(1) as string | null)?.toString().slice(0, 96) ?? null,
        decimals: ok(2) === null ? null : Number(ok(2)),
        totalSupply: ok(3) === null ? null : (ok(3) as bigint).toString(),
        pmBalance: ok(4) === null ? "0" : (ok(4) as bigint).toString(),
      };
    });
    if ((i / PER) % 20 === 0 || i + PER >= todo.length) writeJson("tokens.json", out);
    console.log(`  ${Math.min(i + PER, todo.length)}/${todo.length}`);
    await sleep(250);
  }
  console.log("done");
}

// ---- stage 3: slot0 + liquidity per pool ----
function stateSlot(id: Hex): bigint {
  return BigInt(keccak256(encodePacked(["bytes32", "uint256"], [id, POOLS_SLOT])));
}
function toB32(n: bigint): Hex {
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}
async function poolState() {
  const { pools } = readJson<{ cursor: number; pools: Pool[] }>("pools.json", { cursor: 0, pools: [] });
  const out = readJson<Record<string, PoolState>>("pool-state.json", {});
  // A burn must fill within maxSlippageBps (5%) of spot, so a pool whose LP fee is 5% or more can
  // never be used; skip those (they are the bulk of the spam pools). Dynamic-fee pools (0x800000) stay.
  const usable = pools.filter((p) => p.fee < 50_000 || (p.fee & 0x800000) !== 0);
  const todo = usable.filter((p) => !out[p.id]);
  console.log(`pools: ${pools.length} pools, ${usable.length} with a usable fee, ${todo.length} to read`);
  const PER = 1000; // 2,000 slots per extsload call (≈4M gas of cold SLOADs, 64 KB back)
  for (let i = 0; i < todo.length; i += PER) {
    const part = todo.slice(i, i + PER);
    const slots = part.flatMap((p) => {
      const s = stateSlot(p.id);
      return [toB32(s), toB32(s + LIQUIDITY_OFFSET)];
    });
    const words = await withBackoff(
      () => client.readContract({ address: POOL_MANAGER, abi: extsloadAbi, functionName: "extsload", args: [slots] }),
      "extsload",
    );
    part.forEach((p, k) => {
      const slot0 = BigInt(words[k * 2]);
      const liq = BigInt(words[k * 2 + 1]) & ((1n << 128n) - 1n);
      const sqrtP = slot0 & ((1n << 160n) - 1n);
      let tick = Number((slot0 >> 160n) & ((1n << 24n) - 1n));
      if (tick >= 1 << 23) tick -= 1 << 24;
      out[p.id] = { id: p.id, sqrtPriceX96: sqrtP.toString(), tick, liquidity: liq.toString() };
    });
    writeJson("pool-state.json", out);
    console.log(`  ${Math.min(i + PER, todo.length)}/${todo.length}`);
    await sleep(350);
  }
  console.log("done");
}

// ---- stage 3b: real fills through the V4Quoter ----
// Reads OUT/quote-requests.json: [{ id, key: {currency0, currency1, fee, tickSpacing, hooks}, zeroForOne, amountIn }]
// and writes OUT/quote-results.json: { id: { out: string | null, err?: string } }. Empty hookData, exactly what
// PackBurner.burn passes, so a pool that refuses the Quoter refuses the burner too.
type QuoteReq = { id: string; key: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }; zeroForOne: boolean; amountIn: string };
async function quote() {
  const reqs = readJson<QuoteReq[]>("quote-requests.json", []);
  const out = readJson<Record<string, { out: string | null; err?: string }>>("quote-results.json", {});
  const todo = reqs.filter((r) => !out[r.id]);
  console.log(`quote: ${reqs.length} requests, ${todo.length} to run`);
  const PER = Number(process.env.PER ?? 40);
  for (let i = 0; i < todo.length; i += PER) {
    const part = todo.slice(i, i + PER);
    const contracts = part.map((r) => ({
      address: QUOTER,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle" as const,
      args: [{
        poolKey: { currency0: r.key.currency0 as Address, currency1: r.key.currency1 as Address, fee: r.key.fee, tickSpacing: r.key.tickSpacing, hooks: r.key.hooks as Address },
        zeroForOne: r.zeroForOne,
        exactAmount: BigInt(r.amountIn),
        hookData: "0x" as Hex,
      }],
    }));
    const res = await withBackoff(() => client.multicall({ contracts, allowFailure: true, multicallAddress: MULTICALL3, batchSize: 0 }), "quote");
    part.forEach((r, k) => {
      const x = res[k];
      out[r.id] = x.status === "success" ? { out: (x.result as readonly [bigint, bigint])[0].toString() } : { out: null, err: String(x.error?.message ?? x.error).split("\n")[0].slice(0, 120) };
    });
    if ((i / PER) % 10 === 0 || i + PER >= todo.length) writeJson("quote-results.json", out);
    console.log(`  ${Math.min(i + PER, todo.length)}/${todo.length}`);
    await sleep(200);
  }
  writeJson("quote-results.json", out);
  console.log("done");
}

// ---- stage 4: prices and per-token liquidity ----
// price1per0 = (sqrtP/2^96)^2 in raw units; human price of token0 in token1 = raw × 10^(d0-d1).
function priceRaw(sqrtP: bigint): number {
  const s = Number(sqrtP) / Number(Q96);
  return s * s;
}
function report() {
  const { pools, cursor } = readJson<{ cursor: number; pools: Pool[] }>("pools.json", { cursor: 0, pools: [] });
  const toks = readJson<Record<string, Token>>("tokens.json", {});
  const st = readJson<Record<string, PoolState>>("pool-state.json", {});
  const dec = (a: string) => toks[a]?.decimals ?? 18;
  // usd price per human unit; USDG = 1
  const usd: Record<string, number> = { [USDG]: 1 };
  type Edge = { pool: Pool; state: PoolState; other: string; priceInOther: number; depthOther: number; depthSelf: number };
  const edges: Record<string, Edge[]> = {};
  for (const p of pools) {
    const s = st[p.id];
    if (!s || s.liquidity === "0" || s.sqrtPriceX96 === "0") continue;
    const sqrtP = BigInt(s.sqrtPriceX96);
    const L = BigInt(s.liquidity);
    const raw = priceRaw(sqrtP); // token1 per token0, raw
    const d0 = dec(p.currency0), d1 = dec(p.currency1);
    const p0in1 = raw * 10 ** (d0 - d1);
    // virtual reserves at the current price if all liquidity were full-range: x = L/√P, y = L·√P
    const x = Number((L * Q96) / sqrtP) / 10 ** d0;
    const y = Number((L * sqrtP) / Q96) / 10 ** d1;
    (edges[p.currency0] ??= []).push({ pool: p, state: s, other: p.currency1, priceInOther: p0in1, depthOther: y, depthSelf: x });
    (edges[p.currency1] ??= []).push({ pool: p, state: s, other: p.currency0, priceInOther: p0in1 > 0 ? 1 / p0in1 : 0, depthOther: x, depthSelf: y });
  }
  // ETH from the deepest ETH/USDG or WETH/USDG pool
  const anchor = (a: string) => {
    const cands = (edges[a] ?? []).filter((e) => e.other === USDG);
    cands.sort((u, v) => v.depthOther - u.depthOther);
    return cands[0];
  };
  const ethEdge = anchor(ZERO) ?? anchor(WETH);
  if (ethEdge) {
    usd[ZERO] = ethEdge.priceInOther;
    usd[WETH] = ethEdge.priceInOther;
    console.log(`ETH = ${ethEdge.priceInOther.toFixed(2)} USDG (pool ${ethEdge.pool.id.slice(0, 10)}, quote depth ${ethEdge.depthOther.toFixed(0)} USDG)`);
  }
  const wethEdge = anchor(WETH);
  if (wethEdge && !usd[WETH]) usd[WETH] = wethEdge.priceInOther;
  // propagate: up to 3 hops, always through the deepest priced neighbour (depth measured in USD)
  const via: Record<string, Edge> = {};
  for (let hop = 0; hop < 3; hop++) {
    for (const a of Object.keys(edges)) {
      if (usd[a] !== undefined && hop > 0 && via[a] === undefined && a !== ZERO && a !== WETH && a !== USDG) continue;
      if (a === USDG || a === ZERO || a === WETH) continue;
      let best: Edge | undefined, bestDepth = 0;
      for (const e of edges[a]) {
        const po = usd[e.other];
        if (po === undefined || !(e.priceInOther > 0)) continue;
        const d = e.depthOther * po;
        if (d > bestDepth) { bestDepth = d; best = e; }
      }
      if (best) { usd[a] = best.priceInOther * usd[best.other]; via[a] = best; }
    }
  }
  const poolCount: Record<string, number> = {};
  for (const p of pools) {
    poolCount[p.currency0] = (poolCount[p.currency0] ?? 0) + 1;
    poolCount[p.currency1] = (poolCount[p.currency1] ?? 0) + 1;
  }
  const rows = Object.values(toks).map((t) => {
    const a = t.address;
    const px = usd[a];
    const d = t.decimals ?? 18;
    const bal = Number(t.pmBalance) / 10 ** d;
    const supply = t.totalSupply === null ? null : Number(t.totalSupply) / 10 ** d;
    const e = via[a];
    const myPools = (edges[a] ?? []).length;
    const anchorPools = (edges[a] ?? [])
      .filter((e) => e.other === ZERO || e.other === USDG)
      .map((e) => ({
        id: e.pool.id, currency0: e.pool.currency0, currency1: e.pool.currency1, fee: e.pool.fee, tickSpacing: e.pool.tickSpacing, hooks: e.pool.hooks,
        liquidity: e.state.liquidity, sqrtPriceX96: e.state.sqrtPriceX96, tick: e.state.tick, quote: e.other, quoteSymbol: e.other === ZERO ? "ETH" : "USDG",
        priceInQuote: e.priceInOther, depthQuote: e.depthOther, depthToken: e.depthSelf, depthQuoteUsd: e.depthOther * (usd[e.other] ?? 0), block: e.pool.block,
      }))
      .sort((u, v) => v.depthQuoteUsd - u.depthQuoteUsd);
    const allPools = poolCount[a] ?? 0;
    return {
      address: a,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      totalSupply: supply,
      pmBalance: bal,
      priceUsd: px ?? null,
      pmValueUsd: px !== undefined ? bal * px : null,
      fdvUsd: px !== undefined && supply !== null ? supply * px : null,
      pools: allPools,
      livePools: myPools,
      anchorPools,
      bestPool: e
        ? {
            id: e.pool.id,
            currency0: e.pool.currency0,
            currency1: e.pool.currency1,
            fee: e.pool.fee,
            tickSpacing: e.pool.tickSpacing,
            hooks: e.pool.hooks,
            liquidity: e.state.liquidity,
            sqrtPriceX96: e.state.sqrtPriceX96,
            tick: e.state.tick,
            quote: e.other,
            quoteSymbol: toks[e.other]?.symbol ?? null,
            priceInQuote: e.priceInOther,
            depthQuote: e.depthOther,
            depthToken: e.depthSelf,
            depthQuoteUsd: e.depthOther * (usd[e.other] ?? 0),
            ours: e.pool.hooks === OUR_HOOK,
          }
        : null,
    };
  });
  rows.sort((u, v) => (v.pmValueUsd ?? -1) - (u.pmValueUsd ?? -1));
  writeJson("report.json", { head: cursor - 1, ethUsd: usd[ZERO] ?? null, pools: pools.length, tokens: rows.length, rows });
  const csv = [
    "address,symbol,name,decimals,totalSupply,pmBalance,priceUsd,pmValueUsd,fdvUsd,pools,livePools,bestPoolQuote,bestPoolFee,bestPoolTickSpacing,bestPoolHooks,bestPoolLiquidity,depthQuoteUsd",
    ...rows.map((r) =>
      [
        r.address, JSON.stringify(r.symbol ?? ""), JSON.stringify(r.name ?? ""), r.decimals ?? "", r.totalSupply ?? "", r.pmBalance, r.priceUsd ?? "", r.pmValueUsd ?? "", r.fdvUsd ?? "", r.pools, r.livePools,
        r.bestPool?.quoteSymbol ?? "", r.bestPool?.fee ?? "", r.bestPool?.tickSpacing ?? "", r.bestPool?.hooks ?? "", r.bestPool?.liquidity ?? "", r.bestPool?.depthQuoteUsd ?? "",
      ].join(","),
    ),
  ].join("\n");
  writeFileSync(join(OUT, "report.csv"), csv);
  const hooks: Record<string, number> = {};
  for (const p of pools) hooks[p.hooks] = (hooks[p.hooks] ?? 0) + 1;
  console.log(`pools ${pools.length}, tokens ${rows.length}, priced ${rows.filter((r) => r.priceUsd !== null).length}`);
  console.log("hooks:", Object.entries(hooks).sort((a, b) => b[1] - a[1]).slice(0, 12));
}

mkdirSync(OUT, { recursive: true });
const stage = process.argv[2];
const run = { scan, tokens, pools: poolState, quote, report }[stage as "scan"];
if (!run) {
  console.error("usage: pack-scan.ts scan|tokens|pools|quote|report");
  process.exit(1);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
