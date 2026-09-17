import { decodeEventLog, formatUnits, keccak256, type Address } from "viem";
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
  LAUNCH_ROUTER,
  treasuryEventsAbi,
  CODE_HASHES,
  LAUNCH_ROUTER_V1,
  POF_ROUTER,
  EXECUTOR,
  routerEventsAbi,
  RESCAN_RANGES,
  SCAN_MODE,
  LOGS_RANGE,
  HAS_RADIAN,
  LEGACY_ROUTERS,
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
const LIVE_BLOCKS_PER_TICK = BigInt(process.env.MAX_BLOCKS_PER_TICK ?? (SCAN_MODE === "logs" ? 20_000 : 300));
const BACKFILL_BLOCKS_PER_TICK = BigInt(process.env.BACKFILL_BLOCKS_PER_TICK ?? (SCAN_MODE === "logs" ? 40_000 : 400));
const INITIAL_LOOKBACK = BigInt(process.env.INITIAL_LOOKBACK ?? (SCAN_MODE === "logs" ? 20_000 : 3000)); // ~25 min at Arc's ~0.5 s blocks
// Blocks whose headers are fetched concurrently (batched 8 per JSON-RPC request).
const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? 8);
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS ?? 5000);

const FACTORY_LC = FACTORY.toLowerCase();
const TREASURY_LC = RADIAN.treasury.toLowerCase();
const ROUTER_LCS = new Set([LAUNCH_ROUTER, ...LEGACY_ROUTERS].map((a) => a.toLowerCase()));
// Contracts that route buys/sells on users' behalf. The treasury's flush()
// buys RADIAN on its curve; add others via EXTRA_ROUTERS (comma-separated).
const ROUTERS = new Set(
  [RADIAN.treasury, LAUNCH_ROUTER, LAUNCH_ROUTER_V1, ...LEGACY_ROUTERS, POF_ROUTER, EXECUTOR, ...(process.env.EXTRA_ROUTERS ?? "").split(",")].map((a) => a.trim().toLowerCase()).filter(Boolean),
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

// LOGS MODE: one eth_getLogs per block range, filtered to our event topics.
// Timestamps come from the logs (standard RPCs include blockTimestamp); blocks
// without a matching log are simply skipped. The range shrinks on a provider
// limit error and grows back slowly.
const SCAN_EVENTS = [...factoryAbi, ...curveEventsAbi, ...treasuryEventsAbi, ...routerEventsAbi].filter((x) => x.type === "event");
let logsRange = BigInt(Math.max(10, LOGS_RANGE));
const blockTsCache = new Map<string, number>();

async function collectLogs(nums: bigint[]): Promise<BlockLogs[]> {
  if (nums.length === 0) return [];
  const from = nums[0];
  const to = nums[nums.length - 1];
  let logs: Awaited<ReturnType<typeof publicClient.getLogs>>;
  try {
    logs = await publicClient.getLogs({ fromBlock: from, toBlock: to, events: SCAN_EVENTS as never });
    if (logsRange < BigInt(LOGS_RANGE)) logsRange = logsRange * 2n > BigInt(LOGS_RANGE) ? BigInt(LOGS_RANGE) : logsRange * 2n;
  } catch (e) {
    const msg = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e);
    if (nums.length > 10) {
      logsRange = BigInt(Math.max(10, Math.floor(nums.length / 2)));
      console.warn(`[scan] eth_getLogs ${from}-${to} failed (${msg.split("\n")[0]}); range → ${logsRange}`);
      const mid = Math.floor(nums.length / 2);
      return [...(await collectLogs(nums.slice(0, mid))), ...(await collectLogs(nums.slice(mid)))];
    }
    throw e;
  }
  const byBlock = new Map<string, BlockLogs>();
  for (const l of logs) {
    if (l.blockNumber == null) continue;
    const key = l.blockNumber.toString();
    let b = byBlock.get(key);
    if (!b) {
      const tsHex = (l as unknown as { blockTimestamp?: `0x${string}` }).blockTimestamp;
      let ts = tsHex ? Number(BigInt(tsHex)) * 1000 : (blockTsCache.get(key) ?? 0);
      if (!ts) {
        const blk = await singleClient.getBlock({ blockNumber: l.blockNumber });
        ts = Number(blk.timestamp) * 1000;
      }
      blockTsCache.set(key, ts);
      if (blockTsCache.size > 5000) blockTsCache.delete(blockTsCache.keys().next().value as string);
      b = { number: l.blockNumber, ts, logs: [] };
      byBlock.set(key, b);
    }
    b.logs.push({ address: l.address, topics: l.topics as RawLog["topics"], data: l.data, logIndex: l.logIndex, transactionHash: l.transactionHash ?? "0x" });
  }
  return [...byBlock.values()].sort((a, b) => (a.number < b.number ? -1 : 1));
}

function decode(abi: typeof factoryAbi | typeof curveEventsAbi | typeof treasuryEventsAbi | typeof routerEventsAbi, log: RawLog) {
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
    if (addr === TREASURY_LC) {
      const ev = decode(treasuryEventsAbi, log);
      if (ev) recordFlywheel(ev, log, n.toString(), b.ts);
      continue;
    }
    if (ROUTER_LCS.has(addr)) {
      // Emitted after the factory's TokenLaunched in the same tx, so the launch exists.
      const ev = decode(routerEventsAbi, log);
      if (ev?.eventName === "WallLaunched") {
        const a = ev.args as { token: Address; treasury: Address; staking: Address };
        if (!store.setTemplate(a.token, { kind: "wall", treasury: a.treasury, staking: a.staking })) {
          console.warn(`[scan] WallLaunched for unknown launch ${a.token}`);
        }
      } else if (ev?.eventName === "WallLadderCreated") {
        const a = ev.args as { token: Address; ladder: Address };
        const l = store.launches.get(a.token.toLowerCase());
        if (l?.template?.kind === "wall") store.setTemplate(a.token, { ...l.template, ladder: a.ladder });
      } else if (ev?.eventName === "PoFLaunched") {
        const a = ev.args as { token: Address; vault: Address };
        if (!store.setTemplate(a.token, { kind: "pof", vault: a.vault, pofRouter: POF_ROUTER })) {
          console.warn(`[scan] PoFLaunched for unknown launch ${a.token}`);
        }
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
  for (let start = from; start <= to; ) {
    const width = SCAN_MODE === "logs" ? logsRange : BigInt(CONCURRENCY);
    const end = start + width - 1n > to ? to : start + width - 1n;
    const nums: bigint[] = [];
    for (let n = start; n <= end; n++) nums.push(n);
    const blocks = await collect(nums);
    for (const b of blocks) {
      applyBlock(b);
      advance(b.number);
    }
    advance(end); // a chunk with no matching logs still moves the cursor
    start = end + 1n;
  }
}

// ---- treasury ledger + identity ----

function recordFlywheel(ev: { eventName: string; args: unknown }, log: RawLog, block: string, ts: number) {
  const base = { txHash: log.transactionHash, logIndex: toNum(log.logIndex), block, ts };
  if (ev.eventName === "Flushed") {
    const a = ev.args as { usdcIn: bigint; radianBurned: bigint; toStakers: bigint };
    store.addFlywheel({ ...base, kind: "flush", usdcIn: a.usdcIn.toString(), radianBurned: a.radianBurned.toString(), toStakers: a.toStakers.toString() });
  } else if (ev.eventName === "FeesClaimed") {
    const a = ev.args as { amount: bigint };
    store.addFlywheel({ ...base, kind: "claim", amount: a.amount.toString() });
  } else if (ev.eventName === "TokenFeesClaimed") {
    const a = ev.args as { token: Address; amount: bigint };
    store.addFlywheel({ ...base, kind: "claimToken", token: a.token, amount: a.amount.toString() });
  }
}

// Flushes scanned before the ledger existed are already in the store as the
// treasury's curve buys; pull their receipts once and decode the treasury
// events, so the ledger is complete without a full re-scan.
async function backfillFlywheel() {
  if (!HAS_RADIAN) return;
  const seen = new Set<string>();
  for (const t of store.trades) {
    if (t.trader.toLowerCase() !== TREASURY_LC) continue;
    const h = t.txHash.toLowerCase();
    if (seen.has(h) || store.hasFlywheelTx(h)) continue;
    seen.add(h);
    try {
      const r = await singleClient.getTransactionReceipt({ hash: t.txHash as `0x${string}` });
      for (const log of r.logs) {
        if (log.address.toLowerCase() !== TREASURY_LC) continue;
        const raw: RawLog = { address: log.address, topics: log.topics as RawLog["topics"], data: log.data, logIndex: log.logIndex, transactionHash: t.txHash as `0x${string}` };
        const ev = decode(treasuryEventsAbi, raw);
        if (ev) recordFlywheel(ev, raw, r.blockNumber.toString(), t.ts);
      }
    } catch (e) {
      console.warn(`[ledger] receipt ${t.txHash} unavailable:`, (e as Error)?.message ?? e);
    }
  }
  if (seen.size) console.log(`[ledger] backfilled ${seen.size} treasury tx, ${store.flywheel.length} ledger rows`);
}

// One-off re-scans of block ranges named in RESCAN_RANGES ("from-to,…"): for
// launches that landed before their entry point was known to the scanner.
// Each range runs once; the logIndex dedup makes repeats harmless anyway.
async function rescanRanges() {
  for (const r of RESCAN_RANGES) {
    if (store.rescansDone.has(r)) continue;
    const [a, b] = r.split("-").map((x) => BigInt(x));
    if (!a || !b || b < a || b - a > 5000n) {
      console.warn(`[scan] bad RESCAN_RANGES entry ${r}`);
      continue;
    }
    console.log(`[scan] rescanning ${a}-${b}`);
    await processBlockRange(a, b, SCAN_MODE === "logs" ? collectLogs : collectBackfill, () => {});
    store.rescansDone.add(r);
    store.save();
  }
}

// Re-hash the live code of every pinned contract. A mismatch never stops the
// indexer (reads are still useful for forensics) but is reported on /health.
export async function verifyIdentity() {
  const mismatches: string[] = [];
  if (CODE_HASHES.length === 0) {
    store.identity = { checked: false, ok: true, mismatches: [], checkedAt: Date.now() };
    console.log("[identity] nothing pinned on this chain (set CODE_HASHES_JSON)");
    return;
  }
  try {
    for (const c of CODE_HASHES) {
      const code = await singleClient.getCode({ address: c.address });
      const actual = code && code !== "0x" ? keccak256(code) : null;
      if (actual !== c.hash) mismatches.push(`${c.name}@${c.address}: expected ${c.hash}, live ${actual ?? "no code"}`);
    }
    store.identity = { checked: true, ok: mismatches.length === 0, mismatches, checkedAt: Date.now() };
    if (mismatches.length) console.error("[identity] CONTRACT CODE MISMATCH\n  " + mismatches.join("\n  "));
    else console.log(`[identity] ${CODE_HASHES.length} pinned contracts match their runtime code hashes`);
  } catch (e) {
    store.identity = { checked: false, ok: true, mismatches: [], checkedAt: Date.now() };
    console.warn("[identity] check skipped (RPC):", (e as Error)?.message ?? e);
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
      await processBlockRange(from, to, SCAN_MODE === "logs" ? collectLogs : collectLive, (n) => (store.checkpoint = n));
    }

    // Backfill: a bounded slice of history per tick.
    if (store.backfillCursor < store.backfillFrom) {
      const bFrom = store.backfillCursor + 1n;
      const bTo = store.backfillFrom - bFrom > BACKFILL_BLOCKS_PER_TICK ? bFrom + BACKFILL_BLOCKS_PER_TICK : store.backfillFrom;
      await processBlockRange(bFrom, bTo, SCAN_MODE === "logs" ? collectLogs : collectBackfill, (n) => (store.backfillCursor = n));
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
  console.log(`[scan] mode=${SCAN_MODE}${SCAN_MODE === "logs" ? ` range=${LOGS_RANGE}` : ""}`);
  await verifyIdentity();
  await backfillFlywheel();
  await rescanRanges();
  await seedLaunches();
  const loop = async () => {
    const busy = await tick();
    // Work through the queue as fast as the RPC allows; settle into the interval once idle.
    setTimeout(loop, busy ? 250 : SCAN_INTERVAL_MS);
  };
  void loop();
}

export const fmt = (v?: string) => (v ? Number(formatUnits(BigInt(v), 18)) : 0);
