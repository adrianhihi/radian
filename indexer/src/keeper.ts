import { createWalletClient, http, formatUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { store, type StoredAuth } from "./store.js";
import {
  arcTestnet,
  singleClient,
  KEEPER_PRIVATE_KEY,
  KEEPER_INTERVAL_MS,
  EXECUTOR,
  wallTreasuryAbi,
  pofVaultAbi,
  executorAbi,
  curveTradeAbi,
  curveReadAbi,
  HAS_RADIAN,
  RADIAN,
  treasuryAbi,
  RADIAN_QUOTE_DECIMALS,
  wallLadderAbi,
} from "./config.js";

// The platform keeper. Runs the maintenance calls the template contracts
// expose to a keeper — Wall `claimFees` / `defend`, Proof-of-Fee
// `claimAndBuy` — and the delegated buys users authorized on RadianExecutor.
// Every send is preceded by a simulation with the exact arguments; a call that
// would revert is never broadcast, and a failure in one item never stops the
// others. The keeper holds a small gas balance and no user funds.

const BPS = 10_000n;
const NATIVE = "0x0000000000000000000000000000000000000000";
const DEADLINE_S = 120;

let running = false;
let account: ReturnType<typeof privateKeyToAccount> | null = null;
let wallet: ReturnType<typeof createWalletClient> | null = null;

export function keeperAddress(): Address | null {
  return account?.address ?? null;
}

export function startKeeper() {
  if (!KEEPER_PRIVATE_KEY) {
    console.log("[keeper] disabled (no KEEPER_PRIVATE_KEY)");
    return;
  }
  account = privateKeyToAccount(KEEPER_PRIVATE_KEY);
  wallet = createWalletClient({ account, chain: arcTestnet, transport: http(undefined, { batch: false, timeout: 30_000 }) });
  console.log(`[keeper] ${account.address}, every ${KEEPER_INTERVAL_MS / 1000}s`);
  setInterval(() => void tick(), KEEPER_INTERVAL_MS);
  setTimeout(() => void tick(), 15_000);
}

async function tick() {
  if (running || !account || !wallet) return;
  running = true;
  try {
    for (const l of store.launches.values()) {
      try {
        if (l.template?.kind === "wall") {
          if (l.graduated) await ladderTick(l.token, l.template.treasury, l.template.ladder);
          else await wallTick(l.token, l.curve, l.template.treasury);
        } else if (l.template?.kind === "pof" && !l.graduated) {
          await pofTick(l.token, l.template.vault);
        }
      } catch (e) {
        console.warn(`[keeper] ${l.symbol ?? l.token}:`, short(e));
      }
    }
    // Fees sit on each curve until swept; the keeper is the hook's fee-sweep
    // operator, so it sweeps every curve with pending fees (at most hourly each).
    for (const l of store.launches.values()) {
      if (l.graduated) continue;
      try {
        await sweepTick(l.token, l.curve, l.quoteDecimals ?? 18);
      } catch (e) {
        console.warn(`[keeper] sweep ${l.symbol ?? l.token}:`, short(e));
      }
    }
    if (HAS_RADIAN) {
      try {
        await radianTick();
      } catch (e) {
        console.warn("[keeper] radian flywheel:", short(e));
      }
    }
    for (const a of store.auths.values()) {
      if (a.status !== "active") continue;
      try {
        await execTick(a);
      } catch (e) {
        console.warn(`[keeper] auth ${a.authId.slice(0, 10)}:`, short(e));
      }
    }
  } finally {
    running = false;
  }
}

const now = () => BigInt(Math.floor(Date.now() / 1000));
const short = (e: unknown) => ((e as any)?.shortMessage ?? (e as Error)?.message ?? String(e)).split("\n")[0];
const min = (...xs: bigint[]) => xs.reduce((a, b) => (a < b ? a : b));

async function send(address: Address, abi: any, functionName: string, args: any[], value?: bigint) {
  const hash = await wallet!.writeContract({ address, abi, functionName, args, value, account: account!, chain: arcTestnet });
  const r = await singleClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== "success") throw new Error(`reverted ${hash}`);
  return hash;
}

// ---- Wall ----

async function wallTick(token: Address, curve: Address, treasury: Address) {
  // 1) fees: only send when the simulation says something is claimable
  const sim = await singleClient.simulateContract({ address: treasury, abi: wallTreasuryAbi, functionName: "claimFees", account: account! });
  const [claimed, streamed] = sim.result as readonly [bigint, bigint];
  if (claimed > 0n) {
    const h = await send(treasury, wallTreasuryAbi, "claimFees", []);
    console.log(`[keeper] wall ${token.slice(0, 8)} claimFees ${formatUnits(claimed, 18)} (streamed ${formatUnits(streamed, 18)}) ${h}`);
  }
  // 2) defend when under the floor, within the window budget and the interval
  const r = await singleClient.multicall({
    allowFailure: false,
    contracts: [
      { address: treasury, abi: wallTreasuryAbi, functionName: "spot" },
      { address: treasury, abi: wallTreasuryAbi, functionName: "floorPrice" },
      { address: treasury, abi: wallTreasuryAbi, functionName: "budgetRemaining" },
      { address: treasury, abi: wallTreasuryAbi, functionName: "quoteToRestoreFloor" },
      { address: treasury, abi: wallTreasuryAbi, functionName: "reserve" },
      { address: treasury, abi: wallTreasuryAbi, functionName: "lastDefendAt" },
      { address: treasury, abi: wallTreasuryAbi, functionName: "config" },
      { address: curve, abi: curveTradeAbi, functionName: "feeBps" },
      { address: curve, abi: curveTradeAbi, functionName: "creatorTaxBps" },
      { address: curve, abi: curveReadAbi, functionName: "graduated" },
    ],
  });
  const [spot, floor, budget, need, reserve, lastDefendAt, cfg, feeBps, creatorTax, graduated] = r as unknown as [
    bigint, bigint, bigint, bigint, bigint, bigint, readonly [number, number, number, number, number, bigint], bigint, bigint, boolean,
  ];
  if (graduated || spot === 0n || spot >= floor || budget === 0n) return;
  const [, , , maxSlippageBps, minInterval, keeperBounty] = cfg;
  if (lastDefendAt !== 0n && now() < lastDefendAt + BigInt(minInterval)) return;
  const bounty = min(keeperBounty, reserve / 100n);
  const spendable = reserve > bounty ? reserve - bounty : 0n;
  // the contract picks min(need, maxSpend, budget, spendable); mirror it so minOut matches
  let spend = min(need, budget, spendable);
  const fee = feeBps + creatorTax;
  for (let i = 0; i < 6 && spend > 0n; i++) {
    const net = (spend * (BPS - fee)) / BPS;
    const minOut = (((net * 10n ** 18n) / spot) * (BPS - BigInt(maxSlippageBps))) / BPS;
    const deadline = now() + BigInt(DEADLINE_S);
    try {
      await singleClient.simulateContract({ address: treasury, abi: wallTreasuryAbi, functionName: "defend", args: [spend, minOut, deadline], account: account! });
      const h = await send(treasury, wallTreasuryAbi, "defend", [spend, minOut, deadline]);
      console.log(`[keeper] wall ${token.slice(0, 8)} defend spend=${formatUnits(spend, 18)} ${h}`);
      return;
    } catch (e) {
      // price impact above the slippage bound: try a smaller bid
      spend /= 2n;
      if (i === 5) console.warn(`[keeper] wall ${token.slice(0, 8)} defend skipped:`, short(e));
    }
  }
}

// ---- Wall, after graduation: hand the pile to the ladder, then beat it ----

async function ladderTick(token: Address, treasury: Address, ladder?: Address) {
  // fees keep arriving: claim them (streams to stakers) and pass the kept part on
  const claimSim = await singleClient.simulateContract({ address: treasury, abi: wallTreasuryAbi, functionName: "claimFees", account: account! });
  const [claimed] = claimSim.result as readonly [bigint, bigint];
  if (claimed > 0n) {
    const h = await send(treasury, wallTreasuryAbi, "claimFees", []);
    console.log(`[keeper] wall ${token.slice(0, 8)} claimFees ${formatUnits(claimed, 18)} ${h}`);
  }
  if (!ladder) return; // launched before the ladder existed
  const fundSim = await singleClient.simulateContract({ address: treasury, abi: wallTreasuryAbi, functionName: "fundLadder", account: account! });
  const moved = fundSim.result as bigint;
  if (moved > 0n) {
    const h = await send(treasury, wallTreasuryAbi, "fundLadder", []);
    console.log(`[keeper] wall ${token.slice(0, 8)} fundLadder ${formatUnits(moved, 18)} ${h}`);
  }
  const [last, cfg, [, live]] = (await singleClient.multicall({
    allowFailure: false,
    contracts: [
      { address: ladder, abi: wallLadderAbi, functionName: "lastPokeAt" },
      { address: ladder, abi: wallLadderAbi, functionName: "config" },
      { address: ladder, abi: wallLadderAbi, functionName: "currentTick" },
    ],
  })) as unknown as [bigint, readonly [number, bigint, number, number], readonly [number, boolean]];
  if (!live) return;
  if (last !== 0n && now() < last + BigInt(cfg[2])) return;
  const sim = await singleClient.simulateContract({ address: ladder, abi: wallLadderAbi, functionName: "poke", account: account! });
  const [harvested, posted] = sim.result as readonly [bigint, bigint];
  if (harvested === 0n && posted === 0n && last !== 0n) return; // an idle beat: skip the gas
  const h = await send(ladder, wallLadderAbi, "poke", []);
  console.log(`[keeper] ladder ${token.slice(0, 8)} poke harvested=${formatUnits(harvested, 18)} posted=${formatUnits(posted, 18)} ${h}`);
}

// ---- Proof-of-Fee ----

async function pofTick(token: Address, vault: Address) {
  const [last, cfg] = (await singleClient.multicall({
    allowFailure: false,
    contracts: [
      { address: vault, abi: pofVaultAbi, functionName: "lastBuybackAt" },
      { address: vault, abi: pofVaultAbi, functionName: "config" },
    ],
  })) as unknown as [bigint, readonly [bigint, number, number, number]];
  if (last !== 0n && now() < last + BigInt(cfg[2])) return;
  const deadline = now() + BigInt(DEADLINE_S);
  // the simulation runs the whole path (sweep → claim → buy) with the exact spend
  const sim = await singleClient.simulateContract({ address: vault, abi: pofVaultAbi, functionName: "claimAndBuy", args: [1n, deadline], account: account! });
  const [spent, out] = sim.result as readonly [bigint, bigint];
  if (out === 0n) return; // nothing to buy back yet (fees claimed on the next real buyback)
  const minOut = (out * 99n) / 100n;
  await singleClient.simulateContract({ address: vault, abi: pofVaultAbi, functionName: "claimAndBuy", args: [minOut, deadline], account: account! });
  const h = await send(vault, pofVaultAbi, "claimAndBuy", [minOut, deadline]);
  console.log(`[keeper] pof ${token.slice(0, 8)} claimAndBuy spent=${formatUnits(spent, 18)} out=${formatUnits(out, 18)} ${h}`);
}

// ---- curve fee sweeps ----

const SWEEP_MIN_INTERVAL_S = 3600;
const lastSweep = new Map<string, number>();

async function sweepTick(token: Address, curve: Address, quoteDecimals = 18) {
  const t = Number(now());
  const prev = lastSweep.get(curve.toLowerCase()) ?? 0;
  if (t - prev < SWEEP_MIN_INTERVAL_S) return;
  const [feeBal, taxBal, bb, reserves, graduated] = (await singleClient.multicall({
    allowFailure: false,
    contracts: [
      { address: curve, abi: curveTradeAbi, functionName: "quoteFeeBalance" },
      { address: curve, abi: curveTradeAbi, functionName: "creatorTaxBalance" },
      { address: curve, abi: curveTradeAbi, functionName: "buybackQuoteBalance" },
      { address: curve, abi: curveTradeAbi, functionName: "getReserves" },
      { address: curve, abi: curveTradeAbi, functionName: "graduated" },
    ],
  })) as unknown as [bigint, bigint, bigint, readonly [bigint, bigint], boolean];
  if (graduated || feeBal + taxBal === 0n) return;
  // the buyback slice buys against the curve's own reserves: bound it to 99% of the constant-product output
  let minOut = 0n;
  if (bb > 0n) {
    const [q, tk] = reserves;
    const out = tk - (q * tk) / (q + bb);
    minOut = (out * 99n) / 100n;
  }
  await singleClient.simulateContract({ address: curve, abi: curveTradeAbi, functionName: "sweepFees", args: [minOut], account: account! });
  const h = await send(curve, curveTradeAbi, "sweepFees", [minOut]);
  lastSweep.set(curve.toLowerCase(), t);
  console.log(`[keeper] swept ${token.slice(0, 8)} fees=${formatUnits(feeBal + taxBal, quoteDecimals)} ${h}`);
}

// ---- $RADIAN flywheel: claim fees, then flush when the interval allows ----

const full = (e: unknown) => String((e as any)?.details ?? "") + " " + String((e as any)?.shortMessage ?? "") + " " + String((e as Error)?.message ?? e);

async function radianTick() {
  const t = RADIAN.treasury;
  // The native treasury's claimFees reverts (NoBalance) when the escrow holds
  // nothing for it; the ERC-20 one returns 0. Both mean "nothing to claim".
  let claimed = 0n;
  try {
    const claimSim = await singleClient.simulateContract({ address: t, abi: treasuryAbi, functionName: "claimFees", account: account! });
    claimed = claimSim.result as bigint;
  } catch (e) {
    if (!/NoBalance|0xc2caa2a6/.test(full(e))) throw e; // NoBalance() = 0xc2caa2a6
  }
  if (claimed > 0n) {
    const h = await send(t, treasuryAbi, "claimFees", []);
    console.log(`[keeper] radian claimFees ${formatUnits(claimed, RADIAN_QUOTE_DECIMALS)} ${h}`);
  }
  const [last, interval, kp] = (await singleClient.multicall({
    allowFailure: false,
    contracts: [
      { address: t, abi: treasuryAbi, functionName: "lastFlushAt" },
      { address: t, abi: treasuryAbi, functionName: "minFlushInterval" },
      { address: t, abi: treasuryAbi, functionName: "keeper" },
    ],
  })) as unknown as [bigint, number, Address];
  if (kp.toLowerCase() !== account!.address.toLowerCase()) return; // not our job on this chain
  if (last !== 0n && now() < last + BigInt(interval)) return;
  const deadline = now() + BigInt(DEADLINE_S);
  // simulate with a nominal quote to learn the buyback size, then bind minOut to it
  let sim;
  try {
    sim = await singleClient.simulateContract({ address: t, abi: treasuryAbi, functionName: "flush", args: [1n, deadline], account: account! });
  } catch (e) {
    if (/empty|too soon|no staking|quote required/i.test(full(e))) return; // nothing to flush yet
    throw e;
  }
  const [burned, toStakers] = sim.result as readonly [bigint, bigint];
  const minOut = burned > 0n ? (burned * 99n) / 100n : 1n;
  if (burned > 0n) await singleClient.simulateContract({ address: t, abi: treasuryAbi, functionName: "flush", args: [minOut, deadline], account: account! });
  const h = await send(t, treasuryAbi, "flush", [minOut, deadline]);
  console.log(`[keeper] radian flush burned=${formatUnits(burned, 18)} toStakers=${formatUnits(toStakers, RADIAN_QUOTE_DECIMALS)} ${h}`);
}

// ---- delegated buys ----

async function execTick(a: StoredAuth) {
  const t = Number(now());
  if (t > a.auth.deadline) return mark(a, "expired");
  if (a.count >= a.auth.totalCount) return mark(a, "done");
  if (a.lastAt !== 0 && t < a.lastAt + a.auth.minInterval) return;
  const authTuple = {
    user: a.auth.user,
    token: a.auth.token,
    perBuyMax: BigInt(a.auth.perBuyMax),
    maxGasPrice: BigInt(a.auth.maxGasPrice),
    totalCount: a.auth.totalCount,
    minInterval: a.auth.minInterval,
    deadline: BigInt(a.auth.deadline),
    nonce: BigInt(a.auth.nonce),
  };
  const [nonce, [count, lastAt]] = (await singleClient.multicall({
    allowFailure: false,
    contracts: [
      { address: EXECUTOR, abi: executorAbi, functionName: "nonces", args: [a.user] },
      { address: EXECUTOR, abi: executorAbi, functionName: "execs", args: [a.authId as Hex] },
    ],
  })) as unknown as [bigint, readonly [number, bigint]];
  if (nonce !== BigInt(a.auth.nonce)) return mark(a, "cancelled");
  a.count = count;
  a.lastAt = Number(lastAt);
  if (a.count >= a.auth.totalCount) return mark(a, "done");
  if (a.lastAt !== 0 && t < a.lastAt + a.auth.minInterval) return;

  const amount = BigInt(a.auth.perBuyMax);
  const deadline = now() + BigInt(DEADLINE_S);
  void deadline;
  let out: bigint;
  try {
    const sim = await singleClient.simulateContract({
      address: EXECUTOR, abi: executorAbi, functionName: "executeBuy", args: [authTuple, a.signature, amount, 0n], account: account!,
    });
    out = sim.result as bigint;
  } catch (e) {
    const msg = short(e);
    a.lastError = msg;
    if (/AuthExpired/.test(msg)) return mark(a, "expired");
    if (/AuthExhausted/.test(msg)) return mark(a, "done");
    if (/BadSignature/.test(msg)) return mark(a, "cancelled");
    return; // Insufficient / TooSoon / UnknownToken: wait for the next tick
  }
  const minOut = (out * 99n) / 100n;
  const h = await send(EXECUTOR, executorAbi, "executeBuy", [authTuple, a.signature, amount, minOut]);
  a.count += 1;
  a.lastAt = t;
  a.lastError = undefined;
  if (a.count >= a.auth.totalCount) a.status = "done";
  console.log(`[keeper] exec ${a.authId.slice(0, 10)} ${a.user.slice(0, 8)} buy ${formatUnits(amount, 18)} → ${formatUnits(out, 18)} ${h}`);
}

function mark(a: StoredAuth, status: StoredAuth["status"]) {
  if (a.status !== status) {
    a.status = status;
    console.log(`[keeper] auth ${a.authId.slice(0, 10)} → ${status}`);
  }
}

export { NATIVE };
