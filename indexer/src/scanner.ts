import { decodeEventLog, formatUnits, type Address, type Log } from "viem";
import {
  publicClient,
  FACTORY,
  VAULT,
  SEED,
  factoryAbi,
  curveEventsAbi,
  curveReadAbi,
  tokenReadAbi,
  vaultAbi,
} from "./config.js";
import { store, type Launch } from "./store.js";

const MAX_BLOCKS_PER_TICK = 300n; // bound catch-up so a tick never stalls
const INITIAL_LOOKBACK = 3000n; // on cold start, scan ~last 50 min for trades

// ---- discovery + state ----

async function seedLaunches() {
  for (const s of SEED) {
    if (!store.launches.has(s.token.toLowerCase())) {
      store.upsertLaunch({ ...s });
    }
  }
}

// Refresh cached on-chain state for every known launch in ONE Multicall3 batch.
async function refreshState() {
  const launches = [...store.launches.values()];
  if (launches.length === 0) return;

  const staticContracts = launches.flatMap((l) => [
    { address: l.token, abi: tokenReadAbi, functionName: "name" } as const,
    { address: l.token, abi: tokenReadAbi, functionName: "symbol" } as const,
    { address: l.token, abi: tokenReadAbi, functionName: "logo" } as const,
    { address: l.token, abi: tokenReadAbi, functionName: "description" } as const,
    { address: l.curve, abi: curveReadAbi, functionName: "getReserves" } as const,
    { address: l.curve, abi: curveReadAbi, functionName: "trackedQuote" } as const,
    { address: l.curve, abi: curveReadAbi, functionName: "graduated" } as const,
    { address: VAULT, abi: vaultAbi, functionName: "totalLocked", args: [l.token] } as const,
  ]);

  const res = await publicClient.multicall({ contracts: staticContracts, allowFailure: true });
  launches.forEach((l, i) => {
    const b = i * 8;
    const reserves = res[b + 4].result as [bigint, bigint] | undefined;
    store.upsertLaunch({
      token: l.token,
      curve: l.curve,
      deployer: l.deployer,
      graduationThreshold: l.graduationThreshold,
      name: (res[b].result as string) ?? l.name,
      symbol: (res[b + 1].result as string) ?? l.symbol,
      logo: (res[b + 2].result as string) ?? l.logo,
      description: (res[b + 3].result as string) ?? l.description,
      quoteReserve: (reserves?.[0] ?? 0n).toString(),
      trackedQuote: ((res[b + 5].result as bigint | undefined) ?? 0n).toString(),
      graduated: (res[b + 6].result as boolean | undefined) ?? false,
      buybackLocked: ((res[b + 7].result as bigint | undefined) ?? 0n).toString(),
    });
  });
}

// ---- block scan: reliable discovery + trade feed (getLogs is flaky on Arc) ----

function tryDecode(abi: any, log: Pick<Log, "topics" | "data">) {
  try {
    return decodeEventLog({ abi, topics: log.topics as any, data: log.data });
  } catch {
    return null;
  }
}

async function processBlockRange(from: bigint, to: bigint) {
  for (let n = from; n <= to; n++) {
    const block = await publicClient.getBlock({ blockNumber: n, includeTransactions: true });
    const ts = Number(block.timestamp) * 1000;
    for (const tx of block.transactions) {
      if (typeof tx === "string") continue;
      const toAddr = tx.to?.toLowerCase();
      const isFactory = toAddr === FACTORY.toLowerCase();
      const curveLaunch = toAddr ? store.hasCurve(toAddr) : undefined;
      if (!isFactory && !curveLaunch) continue;

      // reads on receipts are reliable on Arc even when getLogs isn't
      const receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
      for (const log of receipt.logs) {
        if (isFactory && log.address.toLowerCase() === FACTORY.toLowerCase()) {
          const ev = tryDecode(factoryAbi, log);
          if (ev?.eventName === "TokenLaunched") {
            const a = ev.args as any;
            store.upsertLaunch({
              token: a.token,
              curve: a.curve,
              deployer: a.deployer,
              graduationThreshold: (a.graduationThreshold as bigint).toString(),
              createdBlock: n.toString(),
              createdAt: ts,
            });
          }
        }
        // trades: decode CurveBuy / CurveSell emitted by the curve
        const l = store.hasCurve(log.address.toLowerCase());
        if (l) {
          const ev = tryDecode(curveEventsAbi, log);
          if (ev?.eventName === "CurveBuy") {
            const a = ev.args as any;
            store.addTrade({
              txHash: tx.hash, block: n.toString(), ts, token: l.token, curve: l.curve,
              side: "buy", trader: a.recipient, quote: (a.quoteIn as bigint).toString(),
              tokens: (a.tokensOut as bigint).toString(),
            });
          } else if (ev?.eventName === "CurveSell") {
            const a = ev.args as any;
            store.addTrade({
              txHash: tx.hash, block: n.toString(), ts, token: l.token, curve: l.curve,
              side: "sell", trader: a.recipient, quote: (a.quoteOut as bigint).toString(),
              tokens: (a.tokensIn as bigint).toString(),
            });
          }
        }
      }
    }
    store.checkpoint = n;
  }
}

// ---- main loop ----

let scanning = false;

export async function tick() {
  if (scanning) return;
  scanning = true;
  try {
    const head = await publicClient.getBlockNumber();
    if (store.checkpoint === 0n) {
      store.checkpoint = head > INITIAL_LOOKBACK ? head - INITIAL_LOOKBACK : 0n;
    }
    const from = store.checkpoint + 1n;
    if (head >= from) {
      const to = head - from > MAX_BLOCKS_PER_TICK ? from + MAX_BLOCKS_PER_TICK : head;
      await processBlockRange(from, to);
    }
    await refreshState();
    store.save();
    const behind = head - store.checkpoint;
    console.log(`[scan] head ${head} checkpoint ${store.checkpoint} (${behind} behind) | ${store.launches.size} launches, ${store.trades.length} trades`);
  } catch (e: any) {
    console.error("[scan] tick error:", e?.shortMessage ?? e?.message ?? e);
  } finally {
    scanning = false;
  }
}

export async function startScanner() {
  store.load();
  await seedLaunches();
  await tick();
  setInterval(tick, Number(process.env.SCAN_INTERVAL_MS ?? 5000));
}

export const fmt = (v?: string) => (v ? Number(formatUnits(BigInt(v), 18)) : 0);
