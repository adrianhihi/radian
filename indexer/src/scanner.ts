import { decodeEventLog, formatUnits, type Address } from "viem";
import {
  publicClient,
  singleClient,
  FACTORY,
  VAULT,
  SEED,
  RADIAN,
  FACTORY_DEPLOY_BLOCK,
  factoryAbi,
  curveEventsAbi,
  curveReadAbi,
  tokenReadAbi,
  vaultAbi,
  quoteMeta,
} from "./config.js";
import { store } from "./store.js";

// Two cursors:
//  - the LIVE cursor (`store.checkpoint`) stays glued to the chain head and
//    reads every receipt in every block, so new launches and trades show up
//    within a tick no matter which contract the transaction was sent to
//    (RadianTreasury buys, routers, smart wallets…);
//  - the BACKFILL cursor walks history from the factory's deploy block up to
//    where the live cursor started, in the background, so a cold start (or an
//    old snapshot) converges on the full record without ever hiding what is
//    happening right now. History only needs to look at transactions sent to
//    the factory, a curve or the treasury, which makes it ~10× cheaper.
const LIVE_BLOCKS_PER_TICK = BigInt(process.env.MAX_BLOCKS_PER_TICK ?? 300);
const BACKFILL_BLOCKS_PER_TICK = BigInt(process.env.BACKFILL_BLOCKS_PER_TICK ?? 400);
const INITIAL_LOOKBACK = BigInt(process.env.INITIAL_LOOKBACK ?? 3000); // ~25 min at Arc's ~0.5 s blocks
// Blocks whose headers are fetched concurrently (batched 8 per JSON-RPC request).
const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? 8);
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS ?? 5000);

const FACTORY_LC = FACTORY.toLowerCase();
// Contracts that route buys/sells on users' behalf. The treasury's flush()
// buys RADIAN on its curve; add others via EXTRA_ROUTERS (comma-separated).
const ROUTERS = new Set(
  [RADIAN.treasury, ...(process.env.EXTRA_ROUTERS ?? "").split(",")].map((a) => a.trim().toLowerCase()).filter(Boolean),
);

// ---- discovery + state ----

async function seedLaunches() {
  for (const s of SEED) {
    if (!store.launches.has(s.token.toLowerCase())) {
      const qm = quoteMeta(s.pairToken);
      store.upsertLaunch({ ...s, quoteSymbol: qm.symbol, quoteDecimals: qm.decimals });
    }
  }
}

// Refresh cached on-chain state for every known launch via Multicall3.
// A failed call keeps the previous cached value — an RPC hiccup must never
// persist zeroed reserves or a false "not graduated".
async function refreshState() {
  const launches = [...store.launches.values()];
  if (launches.length === 0) return;

  const contracts = launches.flatMap((l) => [
    { address: l.token, abi: tokenReadAbi, functionName: "name" } as const,
    { address: l.token, abi: tokenReadAbi, functionName: "symbol" } as const,
    { address: l.token, abi: tokenReadAbi, functionName: "logo" } as const,
    { address: l.token, abi: tokenReadAbi, functionName: "description" } as const,
    { address: l.curve, abi: curveReadAbi, functionName: "getReserves" } as const,
    { address: l.curve, abi: curveReadAbi, functionName: "trackedQuote" } as const,
    { address: l.curve, abi: curveReadAbi, functionName: "graduated" } as const,
    { address: VAULT, abi: vaultAbi, functionName: "totalLocked", args: [l.token] } as const,
  ]);
  const PER = 8;

  const res = await singleClient.multicall({ contracts, allowFailure: true });
  const ok = <T,>(i: number): T | undefined => (res[i]?.status === "success" ? (res[i].result as T) : undefined);

  launches.forEach((l, i) => {
    const b = i * PER;
    const reserves = ok<[bigint, bigint]>(b + 4);
    const trackedQuote = ok<bigint>(b + 5);
    const graduated = ok<boolean>(b + 6);
    const locked = ok<bigint>(b + 7);
    store.upsertLaunch({
      token: l.token,
      curve: l.curve,
      deployer: l.deployer,
      graduationThreshold: l.graduationThreshold,
      name: ok<string>(b) ?? l.name,
      symbol: ok<string>(b + 1) ?? l.symbol,
      logo: ok<string>(b + 2) ?? l.logo,
      description: ok<string>(b + 3) ?? l.description,
      quoteReserve: reserves ? reserves[0].toString() : l.quoteReserve,
      trackedQuote: trackedQuote != null ? trackedQuote.toString() : l.trackedQuote,
      graduated: graduated ?? l.graduated,
      buybackLocked: locked != null ? locked.toString() : l.buybackLocked,
    });
  });
}

// ---- block scan ----
//
// Arc's public RPC: eth_getLogs is rate-limited and unreliable; receipts are
// fine. eth_getBlockReceipts works when called ONE AT A TIME (it rejects
// batches with "Request exceeds defined limit"), so the live path calls it
// sequentially per non-empty block and degrades to per-transaction receipts if
// a call fails — no block can stall the scanner.

type RawLog = {
  address: Address;
  topics: [`0x${string}`, ...`0x${string}`[]] | [];
  data: `0x${string}`;
  logIndex: `0x${string}` | number | null;
  transactionHash: `0x${string}`;
};
type RawReceipt = { transactionHash: `0x${string}`; logs: RawLog[] };
type BlockLogs = { number: bigint; ts: number; logs: RawLog[] };

let receiptsUnavailable = false;
let degradedBlocks = 0;

async function blockReceipts(n: bigint): Promise<RawReceipt[] | null> {
  if (receiptsUnavailable) return null;
  try {
    const r = (await singleClient.request({
      method: "eth_getBlockReceipts" as never,
      params: [`0x${n.toString(16)}`] as never,
    })) as unknown;
    return Array.isArray(r) ? (r as RawReceipt[]) : null;
  } catch (e) {
    const msg = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
    if (/method not (found|supported)|unsupported method|-32601/i.test(msg)) {
      console.warn("[scan] eth_getBlockReceipts unavailable — per-tx receipts from now on:", msg);
      receiptsUnavailable = true;
    }
    return null;
  }
}

const interesting = (to?: string | null) => {
  const a = to?.toLowerCase();
  return !!a && (a === FACTORY_LC || ROUTERS.has(a) || !!store.hasCurve(a));
};

function pushLogs(out: RawLog[], logs: readonly { address: Address; topics: readonly `0x${string}`[]; data: `0x${string}`; logIndex: number | null; transactionHash: `0x${string}` | null }[]) {
  for (const log of logs) {
    out.push({
      address: log.address,
      topics: log.topics as RawLog["topics"],
      data: log.data,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash ?? "0x",
    });
  }
}

// Receipts for the transactions addressed to a contract we care about.
async function filteredReceipts(txs: readonly { hash: `0x${string}`; to: Address | null }[]): Promise<RawLog[]> {
  const logs: RawLog[] = [];
  for (const tx of txs) {
    if (!interesting(tx.to)) continue;
    const receipt = await singleClient.getTransactionReceipt({ hash: tx.hash });
    pushLogs(logs, receipt.logs);
  }
  return logs;
}

// LIVE: every receipt in the block (complete), degrading per block.
async function collectLive(nums: bigint[]): Promise<BlockLogs[]> {
  const blocks = await Promise.all(nums.map((n) => publicClient.getBlock({ blockNumber: n, includeTransactions: true })));
  const out: BlockLogs[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const n = nums[i];
    const ts = Number(block.timestamp) * 1000;
    const txs = block.transactions.filter((t): t is Exclude<typeof t, string> => typeof t !== "string");
    if (txs.length === 0) {
      out.push({ number: n, ts, logs: [] });
      continue;
    }
    const receipts = await blockReceipts(n);
    if (receipts) {
      out.push({ number: n, ts, logs: receipts.flatMap((r) => r.logs) });
    } else {
      degradedBlocks++;
      out.push({ number: n, ts, logs: await filteredReceipts(txs) });
    }
  }
  return out;
}

// BACKFILL: only transactions addressed to the factory / a curve / a router.
// Walked in ascending order so every curve is known before its trades.
async function collectBackfill(nums: bigint[]): Promise<BlockLogs[]> {
  const blocks = await Promise.all(nums.map((n) => publicClient.getBlock({ blockNumber: n, includeTransactions: true })));
  const out: BlockLogs[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const txs = block.transactions.filter((t): t is Exclude<typeof t, string> => typeof t !== "string");
    out.push({ number: nums[i], ts: Number(block.timestamp) * 1000, logs: await filteredReceipts(txs) });
  }
  return out;
}

function decode(abi: typeof factoryAbi | typeof curveEventsAbi, log: RawLog) {
  try {
    if (log.topics.length === 0) return null;
    return decodeEventLog({ abi, topics: log.topics, data: log.data }) as unknown as {
      eventName: string;
      args: Record<string, unknown>;
    };
  } catch {
    return null;
  }
}

const toNum = (v: RawLog["logIndex"]) => (typeof v === "string" ? Number.parseInt(v, 16) : (v ?? 0));

function applyBlock(b: BlockLogs) {
  const n = b.number;
  // A launch registered earlier in this block must be known before its trades.
  const ordered = [...b.logs].sort((x, y) => toNum(x.logIndex) - toNum(y.logIndex));
  for (const log of ordered) {
    const addr = log.address.toLowerCase();
    if (addr === FACTORY_LC) {
      const ev = decode(factoryAbi, log);
      if (ev?.eventName === "TokenLaunched") {
        const a = ev.args as { token: Address; curve: Address; deployer: Address; pairToken: Address; graduationThreshold: bigint };
        const qm = quoteMeta(a.pairToken);
        store.upsertLaunch({
          token: a.token,
          curve: a.curve,
          deployer: a.deployer,
          graduationThreshold: a.graduationThreshold.toString(),
          pairToken: a.pairToken,
          quoteSymbol: qm.symbol,
          quoteDecimals: qm.decimals,
          createdBlock: n.toString(),
          createdAt: b.ts,
        });
      }
      continue;
    }
    const launch = store.hasCurve(addr);
    if (!launch) continue;
    const ev = decode(curveEventsAbi, log);
    if (ev?.eventName === "CurveBuy") {
      const a = ev.args as { recipient: Address; quoteIn: bigint; tokensOut: bigint };
      store.addTrade({
        txHash: log.transactionHash, logIndex: toNum(log.logIndex), block: n.toString(), ts: b.ts,
        token: launch.token, curve: launch.curve, side: "buy", trader: a.recipient,
        quote: a.quoteIn.toString(), tokens: a.tokensOut.toString(),
      });
    } else if (ev?.eventName === "CurveSell") {
      const a = ev.args as { recipient: Address; tokensIn: bigint; quoteOut: bigint };
      store.addTrade({
        txHash: log.transactionHash, logIndex: toNum(log.logIndex), block: n.toString(), ts: b.ts,
        token: launch.token, curve: launch.curve, side: "sell", trader: a.recipient,
        quote: a.quoteOut.toString(), tokens: a.tokensIn.toString(),
      });
    }
  }
}

// Scans [from, to] ascending in chunks, reporting progress through `advance`
// after every block so a crash mid-range loses at most the in-flight chunk.
async function processBlockRange(
  from: bigint,
  to: bigint,
  collect: (nums: bigint[]) => Promise<BlockLogs[]>,
  advance: (n: bigint) => void,
) {
  const width = BigInt(CONCURRENCY);
  for (let start = from; start <= to; start += width) {
    const end = start + width - 1n > to ? to : start + width - 1n;
    const nums: bigint[] = [];
    for (let n = start; n <= end; n++) nums.push(n);
    const blocks = await collect(nums);
    for (const b of blocks) {
      applyBlock(b);
      advance(b.number);
    }
  }
}

// ---- main loop ----

let scanning = false;

/** Returns true when there is more work queued (live behind or backfill pending). */
export async function tick(): Promise<boolean> {
  if (scanning) return false;
  scanning = true;
  let busy = false;
  try {
    const head = await singleClient.getBlockNumber();

    if (store.checkpoint === 0n) {
      // Cold start: track the head from a short lookback right away…
      store.checkpoint = head > INITIAL_LOOKBACK ? head - INITIAL_LOOKBACK : 0n;
      console.log(`[scan] cold start — live from block ${store.checkpoint + 1n}`);
    }
    if (store.backfillFrom === 0n) {
      // …and queue the history behind it. Also taken by snapshots that predate
      // backfilling: they re-scan once, and the logIndex dedup makes that safe.
      store.backfillFrom = store.checkpoint; // upper bound (inclusive)
      store.backfillCursor = FACTORY_DEPLOY_BLOCK > 0n ? FACTORY_DEPLOY_BLOCK - 1n : 0n; // last scanned
      if (store.backfillCursor < store.backfillFrom) {
        console.log(`[scan] backfill queued: blocks ${store.backfillCursor + 1n}–${store.backfillFrom}`);
      }
    }

    // Live: keep up with the head first.
    const from = store.checkpoint + 1n;
    if (head >= from) {
      const to = head - from > LIVE_BLOCKS_PER_TICK ? from + LIVE_BLOCKS_PER_TICK : head;
      await processBlockRange(from, to, collectLive, (n) => (store.checkpoint = n));
    }

    // Backfill: a bounded slice of history per tick.
    if (store.backfillCursor < store.backfillFrom) {
      const bFrom = store.backfillCursor + 1n;
      const bTo = store.backfillFrom - bFrom > BACKFILL_BLOCKS_PER_TICK ? bFrom + BACKFILL_BLOCKS_PER_TICK : store.backfillFrom;
      await processBlockRange(bFrom, bTo, collectBackfill, (n) => (store.backfillCursor = n));
      if (store.backfillCursor >= store.backfillFrom) console.log("[scan] backfill complete");
    }

    await refreshState();
    store.save();

    const behind = head - store.checkpoint;
    const left = store.backfillFrom > store.backfillCursor ? store.backfillFrom - store.backfillCursor : 0n;
    busy = behind > LIVE_BLOCKS_PER_TICK || left > 0n;
    console.log(
      `[scan] head ${head} live ${store.checkpoint} (${behind} behind)` +
        (left > 0n ? ` backfill ${left} left` : "") +
        (degradedBlocks > 0 ? ` [${degradedBlocks} live blocks via per-tx receipts]` : "") +
        ` | ${store.launches.size} launches, ${store.trades.length} trades`,
    );
  } catch (e) {
    console.error("[scan] tick error:", (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
  } finally {
    scanning = false;
  }
  return busy;
}

export async function startScanner() {
  store.load();
  await seedLaunches();
  const loop = async () => {
    const busy = await tick();
    // Work through the queue as fast as the RPC allows; settle into the interval once idle.
    setTimeout(loop, busy ? 250 : SCAN_INTERVAL_MS);
  };
  void loop();
}

export const fmt = (v?: string) => (v ? Number(formatUnits(BigInt(v), 18)) : 0);
