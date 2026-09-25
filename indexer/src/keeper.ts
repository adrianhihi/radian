import { createWalletClient, createPublicClient, defineChain, http, formatUnits, decodeEventLog, type Address, type Hex, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, base } from "viem/chains";
import { store, type StoredAuth, type PoundEvent } from "./store.js";
import { indicativeQuote, firmQuote, reportTxHash, isHalfMoonConfigured, HALFMOON_ROUTERS, type FirmQuote } from "./halfmoon.js";
import {
  OTHER_CHAIN_PACK,
  OTHER_CHAIN_RPC,
  OTHER_CHAIN_NAMES,
  OTHER_CHAIN_MIN_INTERVAL_S,
  OTHER_CHAIN_MAX_SLIPPAGE_BPS,
  isDryRun,
  erc20SpendAbi,
  type OtherChainPack,
} from "./config.js";
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
  FACTORY,
  LOCKER,
  factoryGraduateAbi,
  curveGradAbi,
  lockerAbi,
  EXECUTOR_VERSION,
  HAS_POUND,
  POUND_VAULT,
  PACK_BURNER,
  poundVaultAbi,
  packBurnerAbi,
  erc20BalanceAbi,
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
  // unref: the server and the scanner keep the process alive, never these timers (tests import this too)
  setInterval(() => void tick(), KEEPER_INTERVAL_MS).unref();
  setTimeout(() => void tick(), 15_000).unref();
}

async function tick() {
  if (running || !account || !wallet) return;
  running = true;
  try {
    for (const l of store.launches.values()) {
      try {
        await graduateTick(l.token, l.curve, l.graduated ?? false);
      } catch (e) {
        console.warn(`[keeper] graduate ${l.symbol ?? l.token}:`, short(e));
      }
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
    if (HAS_POUND) {
      try {
        await poundTick();
      } catch (e) {
        console.warn("[keeper] pound:", short(e));
      }
    }
    if (OTHER_CHAIN_PACK.length) {
      try {
        await otherChainBurns();
      } catch (e) {
        console.warn("[keeper] pack other chains:", short(e));
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

// ---- finish stuck graduations ----
// A buy that crosses the threshold tries to graduate in-line and swallows a
// failure so the buy itself cannot be griefed; the two phases stay
// permissionless. The keeper runs them for any curve that sold out.

const gradChecked = new Map<string, number>();

async function graduateTick(token: Address, curve: Address, graduatedCached: boolean) {
  const key = curve.toLowerCase();
  const t = Number(now());
  if (t - (gradChecked.get(key) ?? 0) < 120) return; // cheap, but not every tick
  gradChecked.set(key, t);
  const [graduated, sellable] = (await singleClient.multicall({
    allowFailure: false,
    contracts: [
      { address: curve, abi: curveGradAbi, functionName: "graduated" },
      { address: curve, abi: curveGradAbi, functionName: "sellableTokens" },
    ],
  })) as unknown as [boolean, bigint];
  if (!graduated) {
    if (sellable !== 0n) return; // still selling: nothing to do
    await singleClient.simulateContract({ address: FACTORY, abi: factoryGraduateAbi, functionName: "graduate", args: [token], account: account! });
    const h = await send(FACTORY, factoryGraduateAbi, "graduate", [token]);
    console.log(`[keeper] graduate ${token.slice(0, 8)} phase 1 ${h}`);
  }
  if (LOCKER === "0x0000000000000000000000000000000000000000") return;
  const locked = (await singleClient.readContract({ address: LOCKER, abi: lockerAbi, functionName: "isLocked", args: [token] })) as boolean;
  if (locked) return;
  await singleClient.simulateContract({ address: FACTORY, abi: factoryGraduateAbi, functionName: "createGraduatedPool", args: [token], account: account! });
  const h = await send(FACTORY, factoryGraduateAbi, "createGraduatedPool", [token]);
  console.log(`[keeper] graduate ${token.slice(0, 8)} pool seeded ${h}`);
  void graduatedCached;
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

// ---- The Pound ----
// 1. settle: the vault claims what the escrow holds for it per quote asset and
//    runs the waterfall (referrals → burn pool → treasury), at most hourly per asset.
// 2. burn: when the burner's interval has passed and the burn pool holds at least
//    the next Pack coin's floor, buy it at the pool's spot (within maxSlippage) and
//    send it to the dead address. minOut is bound to the simulated fill.
const SETTLE_INTERVAL_S = 3600;
const lastSettleAt = new Map<string, number>();

async function poundTick() {
  const assets = new Set<string>([NATIVE]);
  for (const l of store.launches.values()) assets.add((l.pairToken ?? NATIVE).toLowerCase());
  const t = Number(now());
  for (const asset of assets) {
    if (t < (lastSettleAt.get(asset) ?? 0) + SETTLE_INTERVAL_S) continue;
    let intake = 0n;
    try {
      const sim = await singleClient.simulateContract({ address: POUND_VAULT, abi: poundVaultAbi, functionName: "settle", args: [asset as Address], account: account! });
      intake = (sim.result as readonly [bigint, bigint, bigint, bigint])[0];
    } catch (e) {
      console.warn(`[keeper] pound settle ${asset}:`, short(e));
      lastSettleAt.set(asset, t);
      continue;
    }
    lastSettleAt.set(asset, t);
    if (intake === 0n) continue;
    const h = await send(POUND_VAULT, poundVaultAbi, "settle", [asset]);
    console.log(`[keeper] pound settle ${asset.slice(0, 10)} intake=${intake} ${h}`);
  }

  if (PACK_BURNER === NATIVE) return;
  const [kp, permissionless, lastBurnAt, minInterval, bountyBps, maxSlippageBps] = (await singleClient.multicall({
    allowFailure: false,
    contracts: [
      { address: PACK_BURNER, abi: packBurnerAbi, functionName: "keeper" },
      { address: PACK_BURNER, abi: packBurnerAbi, functionName: "permissionless" },
      { address: PACK_BURNER, abi: packBurnerAbi, functionName: "lastBurnAt" },
      { address: PACK_BURNER, abi: packBurnerAbi, functionName: "minInterval" },
      { address: PACK_BURNER, abi: packBurnerAbi, functionName: "bountyBps" },
      { address: PACK_BURNER, abi: packBurnerAbi, functionName: "maxSlippageBps" },
    ],
  })) as unknown as [Address, boolean, bigint, number, number, number];
  if (!permissionless && kp.toLowerCase() !== account!.address.toLowerCase()) return; // not our job
  if (lastBurnAt !== 0n && now() < lastBurnAt + BigInt(minInterval)) return;
  let index: bigint;
  try {
    index = (await singleClient.readContract({ address: PACK_BURNER, abi: packBurnerAbi, functionName: "nextPack" })) as bigint;
  } catch {
    return; // NoActivePack: nothing curated yet
  }
  const p = (await singleClient.readContract({ address: PACK_BURNER, abi: packBurnerAbi, functionName: "packAt", args: [index] })) as {
    token: Address; asset: Address; floor: bigint; maxPerBurn: bigint; active: boolean;
  };
  const poolBal = (await singleClient.readContract({ address: PACK_BURNER, abi: packBurnerAbi, functionName: "pool", args: [p.asset] })) as bigint;
  const amount = min(poolBal, p.maxPerBurn);
  if (amount < p.floor || amount === 0n) return; // pool below this coin's floor: wait for more fees
  const quoteIn = amount - (amount * BigInt(bountyBps)) / BPS;
  const spot = (await singleClient.readContract({ address: PACK_BURNER, abi: packBurnerAbi, functionName: "spotOut", args: [index, quoteIn] })) as bigint;
  const floorOut = (spot * (BPS - BigInt(maxSlippageBps))) / BPS;
  let sim;
  try {
    sim = await singleClient.simulateContract({ address: PACK_BURNER, abi: packBurnerAbi, functionName: "burn", args: [amount, floorOut], account: account! });
  } catch (e) {
    console.warn(`[keeper] pound burn #${index} ${p.token.slice(0, 10)} would revert:`, short(e)); // thin pool / impact over the cap
    return;
  }
  const [, tokensOut] = sim.result as readonly [bigint, bigint];
  const minOut = tokensOut > floorOut ? ((tokensOut * 995n) / 1000n > floorOut ? (tokensOut * 995n) / 1000n : floorOut) : floorOut;
  const h = await send(PACK_BURNER, packBurnerAbi, "burn", [amount, minOut]);
  console.log(`[keeper] pound burn #${index} ${p.token.slice(0, 10)} amount=${amount} out=${formatUnits(tokensOut, 18)} ${h}`);
}

// ---- delegated buys ----

async function execTick(a: StoredAuth) {
  const t = Number(now());
  if (t > a.auth.deadline) return mark(a, "expired");
  if (a.count >= a.auth.totalCount) return mark(a, "done");
  if (a.lastAt !== 0 && t < a.lastAt + a.auth.minInterval) return;
  const v1 = {
    user: a.auth.user,
    token: a.auth.token,
    perBuyMax: BigInt(a.auth.perBuyMax),
    maxGasPrice: BigInt(a.auth.maxGasPrice),
    totalCount: a.auth.totalCount,
    minInterval: a.auth.minInterval,
    deadline: BigInt(a.auth.deadline),
    nonce: BigInt(a.auth.nonce),
  };
  // executor v2 auths carry the quote asset, a minimum per buy and a price floor (all signed)
  const authTuple =
    EXECUTOR_VERSION === "2"
      ? {
          user: v1.user, token: v1.token, asset: (a.auth.asset ?? NATIVE) as Address, perBuyMax: v1.perBuyMax,
          minPerBuy: BigInt(a.auth.minPerBuy ?? "0"), minTokensPerQuote: BigInt(a.auth.minTokensPerQuote ?? "0"),
          maxGasPrice: v1.maxGasPrice, totalCount: v1.totalCount, minInterval: v1.minInterval, deadline: v1.deadline, nonce: v1.nonce,
        }
      : v1;
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
    if (/BadSignature|WrongAsset/.test(msg)) return mark(a, "cancelled");
    return; // Insufficient / TooSoon / UnknownToken / BelowPriceFloor / SnipeWindow: wait for the next tick
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

// ---- The Pack on other chains ----
// A Pack coin that lives on BSC or Base is out of the home-chain PackBurner's reach. The keeper
// buys it on that chain through HalfMoon (firm quote → Router.swap with the dead address as the
// recipient) with the quote asset the operator bridged there, one coin per interval, in rotation,
// and writes a ledger row the web shows next to the home-chain burns. The home-chain wallet is
// never used here: every read and every send goes through a client built for that chain, and the
// spend is bounded by the coin's `cap` and by what the firm quote names as amount_in.
//
// Dry-run (KEEPER_DRY_RUN=1, or no RPC for the chain) walks the whole path up to and including
// the firm quote, logs the plan and stops before the approval. Funded runs additionally check the
// router against the known table, approve the exact amount, eth_call the calldata, send it, wait
// for the receipt, report the hash to HalfMoon and record the row.

const DEAD = "0x000000000000000000000000000000000000dEaD" as Address; // sent checksummed; compared lower-cased
const DEAD_LC = DEAD.toLowerCase();
const OTHER_DEADLINE_S = 180; // approve + swap must both land before the firm quote's deadline
const OTHER_DRY_RUN_INTERVAL_S = Number(process.env.OTHER_CHAIN_DRY_RUN_INTERVAL_S ?? 3600);
const OTHER_BALANCE_TTL_MS = 30_000;
const OTHER_EXPLORERS: Record<number, string> = { 56: "https://bscscan.com", 8453: "https://basescan.org" };

type OtherQuote = {
  at: number; // unix s
  dryRun: boolean;
  swapId: string;
  amountIn: string;
  amountOut: string;
  amountOutMin: string;
  feeRateBps: number;
  router: Address;
  routerKnown: boolean;
  deadline: number;
  calldataBytes: number;
};
type OtherState = {
  balance: bigint | null;
  gas: bigint | null;
  balanceAt: number; // ms
  lastAttemptAt: number; // unix s: the last plan (dry) or send (live) for this coin
  lastQuote: OtherQuote | null;
  lastError: string | null;
  reason: string | null; // why the last tick did not burn this coin
};
const otherState = new Map<string, OtherState>();
const keyOf = (c: OtherChainPack) => `${c.chainId}:${c.token}`;
const stateOf = (c: OtherChainPack): OtherState => {
  let s = otherState.get(keyOf(c));
  if (!s) otherState.set(keyOf(c), (s = { balance: null, gas: null, balanceAt: 0, lastAttemptAt: 0, lastQuote: null, lastError: null, reason: null }));
  return s;
};
let otherCursor = 0; // index of the next coin in OTHER_CHAIN_PACK to consider
let otherLastBurnAt = 0; // unix s, funded burns only (seeded from the ledger)
let otherLastPlanAt = 0; // unix s, dry-run plans
let otherBusy = false;

// The ledger is the only durable record: after a restart the cadence and the rotation resume from
// the last burned row rather than from zero. Seeded on first use, after the snapshot is loaded.
let otherSeeded = false;
function seedOtherChains() {
  if (otherSeeded) return;
  otherSeeded = true;
  const rows = store.pound.filter((e) => e.kind === "burned" && e.chainId != null);
  if (!rows.length) return;
  const last = rows.reduce((a, b) => (b.ts > a.ts ? b : a));
  otherLastBurnAt = Math.floor(last.ts / 1000);
  const i = OTHER_CHAIN_PACK.findIndex((c) => c.chainId === last.chainId && c.token === (last.token ?? "").toLowerCase());
  if (i >= 0) otherCursor = (i + 1) % OTHER_CHAIN_PACK.length;
}

// Clients for one other chain, built from viem's preset with the configured RPC. The wallet signs
// with the keeper's key; it exists only when the keeper runs.
function makeOtherClients(chain: Chain, url: string) {
  const pub = createPublicClient({ chain, transport: http(url, { batch: false, retryCount: 2, timeout: 20_000 }) });
  const wallet = account ? createWalletClient({ account, chain, transport: http(url, { batch: false, timeout: 30_000 }) }) : null;
  return { pub, wallet, chain };
}
const otherClients = new Map<number, ReturnType<typeof makeOtherClients>>();
function otherChain(chainId: number) {
  const hit = otherClients.get(chainId);
  if (hit) return hit;
  const url = OTHER_CHAIN_RPC[chainId];
  if (!url) return null;
  const preset = chainId === 56 ? bsc : chainId === 8453 ? base : null;
  if (!preset) return null;
  const entry = makeOtherClients(defineChain({ ...preset, rpcUrls: { default: { http: [url] } } }), url);
  otherClients.set(chainId, entry);
  return entry;
}

// The keeper's quote-asset and gas balances on that chain, cached briefly (the status route and the
// tick share the reads). `null` when the chain has no RPC or the keeper has no key.
async function readOtherBalances(c: OtherChainPack, force = false): Promise<OtherState> {
  const st = stateOf(c);
  if (!force && Date.now() - st.balanceAt < OTHER_BALANCE_TTL_MS) return st;
  const oc = otherChain(c.chainId);
  if (!oc || !account) {
    st.balance = null;
    st.gas = null;
    return st;
  }
  const [bal, gas] = await Promise.all([
    oc.pub.readContract({ address: c.quote, abi: erc20SpendAbi, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
    oc.pub.getBalance({ address: account.address }),
  ]);
  st.balance = bal;
  st.gas = gas;
  st.balanceAt = Date.now();
  return st;
}

// The cadence and the slippage bound are the home burner's when there is one, so the whole Pack
// rotates at one rhythm; otherwise the env fallbacks apply.
let burnParamsCache: { at: number; minInterval: number; maxSlippageBps: number } | null = null;
async function otherBurnParams() {
  if (burnParamsCache && Date.now() - burnParamsCache.at < 300_000) return burnParamsCache;
  let minInterval = OTHER_CHAIN_MIN_INTERVAL_S;
  let maxSlippageBps = OTHER_CHAIN_MAX_SLIPPAGE_BPS;
  if (HAS_POUND && PACK_BURNER !== NATIVE) {
    try {
      const [mi, ms] = (await singleClient.multicall({
        allowFailure: false,
        contracts: [
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "minInterval" },
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "maxSlippageBps" },
        ],
      })) as unknown as [number, number];
      minInterval = Number(mi);
      maxSlippageBps = Number(ms);
    } catch (e) {
      console.warn("[keeper] pack other chains: burner params unreadable, using env fallbacks:", short(e));
    }
  }
  burnParamsCache = { at: Date.now(), minInterval, maxSlippageBps };
  return burnParamsCache;
}

export async function otherChainBurns() {
  if (!OTHER_CHAIN_PACK.length || !account || otherBusy) return;
  otherBusy = true;
  seedOtherChains();
  try {
    const { minInterval, maxSlippageBps } = await otherBurnParams();
    const t = Number(now());
    if (otherLastBurnAt !== 0 && t < otherLastBurnAt + minInterval) return; // one burn per interval across the other chains
    if (!isHalfMoonConfigured()) {
      for (const c of OTHER_CHAIN_PACK) stateOf(c).reason = "HalfMoon not configured (HALFMOON_API_KEY)";
      return;
    }
    const n = OTHER_CHAIN_PACK.length;
    for (let k = 0; k < n; k++) {
      const i = (otherCursor + k) % n;
      const c = OTHER_CHAIN_PACK[i];
      const st = stateOf(c);
      const dry = isDryRun(c.chainId);
      const tag = `[keeper] pack ${OTHER_CHAIN_NAMES[c.chainId] ?? c.chainId} ${c.symbol}`;
      if (dry && otherLastPlanAt !== 0 && t < otherLastPlanAt + OTHER_DRY_RUN_INTERVAL_S) {
        st.reason = "dry-run: next plan after the dry-run interval";
        continue;
      }
      let fq: FirmQuote | null = null;
      try {
        st.lastError = null;
        // 1) what the keeper holds there
        const bal = (await readOtherBalances(c, true)).balance;
        let amount: bigint;
        if (bal == null) {
          if (!dry) {
            st.reason = "no RPC for this chain";
            continue;
          }
          amount = BigInt(c.cap); // nothing to read: plan the largest allowed burn
          st.reason = "balance unknown (no RPC): dry-run plans at cap";
        } else if (bal < BigInt(c.floor)) {
          st.reason = `below floor: ${formatUnits(bal, c.quoteDecimals)} < ${formatUnits(BigInt(c.floor), c.quoteDecimals)} ${c.quoteSymbol}`;
          continue;
        } else {
          amount = min(bal, BigInt(c.cap));
          st.reason = null;
        }
        if (!dry && (st.gas ?? 0n) === 0n) {
          st.reason = "no gas on this chain";
          continue;
        }
        // 2) indicative → the slippage-bound minimum, 3) the firm quote with the dead address as recipient
        const ind = await indicativeQuote({ chainId: c.chainId, tokenIn: c.quote, tokenOut: c.token, amountIn: amount });
        if (ind.amountOut === 0n) {
          st.reason = "no indicative fill";
          continue;
        }
        const amountOutMin = (ind.amountOut * (BPS - BigInt(maxSlippageBps))) / BPS;
        const deadline = t + OTHER_DEADLINE_S;
        fq = await firmQuote({ chainId: c.chainId, from: account.address, to: DEAD, tokenIn: c.quote, tokenOut: c.token, amountIn: amount, amountOutMin, deadline });
        // 4) the quote must be exactly what was asked: never more than planned (≤ cap), never to another
        //    recipient or token, never under the slippage bound
        if (fq.amountIn > amount) throw new Error(`firm quote amount_in ${fq.amountIn} exceeds the planned ${amount}`);
        if (fq.amountIn === 0n) throw new Error("firm quote amount_in is zero");
        if (fq.amountOut < amountOutMin) throw new Error(`firm quote amount_out ${fq.amountOut} under the bound ${amountOutMin}`);
        if (fq.to !== DEAD_LC) throw new Error(`firm quote recipient ${fq.to} is not the dead address`);
        if (fq.tokenIn !== c.quote || fq.tokenOut !== c.token) throw new Error("firm quote token pair differs from the request");
        if (fq.deadline < t + 30) throw new Error(`firm quote deadline ${fq.deadline} too close`);
        const known = HALFMOON_ROUTERS[c.chainId];
        const routerKnown = !!known && fq.routerAddress === known.toLowerCase();
        st.lastQuote = {
          at: t, dryRun: dry, swapId: fq.swapId, amountIn: fq.amountIn.toString(), amountOut: fq.amountOut.toString(), amountOutMin: amountOutMin.toString(),
          feeRateBps: fq.feeRateBps, router: fq.routerAddress, routerKnown, deadline: fq.deadline, calldataBytes: (fq.calldata.length - 2) / 2,
        };
        st.lastAttemptAt = t;
        otherCursor = (i + 1) % n;
        const plan = `${formatUnits(fq.amountIn, c.quoteDecimals)} ${c.quoteSymbol} → ≥${formatUnits(amountOutMin, c.decimals)} (quoted ${formatUnits(fq.amountOut, c.decimals)}) ${c.symbol} → 0x…dEaD via ${fq.routerAddress} (${routerKnown ? "known router" : "UNKNOWN ROUTER"}), fee ${fq.feeRateBps} bps, deadline ${fq.deadline}, swap ${fq.swapId}`;
        if (dry) {
          otherLastPlanAt = t;
          st.reason = "dry-run: planned, not sent";
          console.log(`${tag} DRY-RUN plan: ${plan}`);
          return;
        }
        if (!routerKnown) throw new Error(`router ${fq.routerAddress} is not the known HalfMoon router for chain ${c.chainId}; add it to HALFMOON_ROUTERS_JSON if the partner rotated it`);
        console.log(`${tag} burn: ${plan}`);
      } catch (e) {
        st.lastError = short(e);
        console.warn(`${tag} skipped:`, short(e));
        continue; // a failed quote on one chain never blocks the next coin
      }
      // 5) funded: approve exactly amount_in, check the calldata with eth_call, send, wait, report, record
      try {
        await sendOtherBurn(c, fq, t);
      } catch (e) {
        st.lastError = short(e);
        console.warn(`${tag} failed:`, short(e));
      }
      return; // one burn attempt per tick once a firm quote was accepted
    }
  } finally {
    otherBusy = false;
  }
}

async function sendOtherBurn(c: OtherChainPack, fq: FirmQuote, t: number) {
  const st = stateOf(c);
  const oc = otherChain(c.chainId);
  if (!oc?.wallet) throw new Error("no wallet client for this chain");
  const tag = `[keeper] pack ${OTHER_CHAIN_NAMES[c.chainId] ?? c.chainId} ${c.symbol}`;
  const allowance = (await oc.pub.readContract({ address: c.quote, abi: erc20SpendAbi, functionName: "allowance", args: [account!.address, fq.routerAddress] })) as bigint;
  if (allowance < fq.amountIn) {
    const ah = await oc.wallet.writeContract({ address: c.quote, abi: erc20SpendAbi, functionName: "approve", args: [fq.routerAddress, fq.amountIn], account: account!, chain: oc.chain });
    const ar = await oc.pub.waitForTransactionReceipt({ hash: ah, timeout: 90_000 });
    if (ar.status !== "success") throw new Error(`approve reverted ${ah}`);
    console.log(`${tag} approved ${formatUnits(fq.amountIn, c.quoteDecimals)} ${c.quoteSymbol} to ${fq.routerAddress} ${ah}`);
  }
  await oc.pub.call({ account: account!.address, to: fq.routerAddress, data: fq.calldata, value: 0n }); // reverts here cost nothing
  const hash = await oc.wallet.sendTransaction({ account: account!, chain: oc.chain, to: fq.routerAddress, data: fq.calldata, value: 0n });
  otherLastBurnAt = t; // the interval starts at the broadcast, even if the receipt is late or reverted
  let receipt;
  try {
    receipt = await oc.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  } finally {
    try {
      await reportTxHash(c.chainId, [{ quoteId: fq.swapId, txHash: hash }]);
    } catch (e) {
      console.warn(`${tag} reportTxHash:`, short(e));
    }
  }
  if (receipt.status !== "success") throw new Error(`swap reverted ${hash}`);
  // what actually reached the dead address, from the coin's own Transfer logs; the quote as a fallback
  let tokensOut = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== c.token) continue;
    try {
      const ev = decodeEventLog({ abi: erc20SpendAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "Transfer" && (ev.args as { to: Address }).to.toLowerCase() === DEAD_LC) tokensOut += (ev.args as { value: bigint }).value;
    } catch {
      /* not a Transfer */
    }
  }
  if (tokensOut === 0n) tokensOut = fq.amountOut;
  const row: PoundEvent = {
    txHash: hash, logIndex: 0, block: receipt.blockNumber.toString(), ts: Date.now(), kind: "burned",
    chainId: c.chainId, token: c.token, symbol: c.symbol, asset: c.quote, quoteIn: fq.amountIn.toString(), tokensOut: tokensOut.toString(),
    caller: account!.address, via: "halfmoon",
  };
  store.addPound(row);
  store.save(); // real money moved: the audit row must survive a crash
  st.lastError = null;
  st.reason = null;
  st.balanceAt = 0; // re-read on the next look
  console.log(`${tag} burned ${formatUnits(tokensOut, c.decimals)} ${c.symbol} for ${formatUnits(fq.amountIn, c.quoteDecimals)} ${c.quoteSymbol} ${hash}`);
}

// What /pound/otherchains and /pound.otherChains serve: the configured coins with the keeper's live
// balance there, the last burn, the next eligible time, the last quote and why the last tick passed.
export async function otherChainStatus() {
  seedOtherChains();
  const { minInterval, maxSlippageBps } = OTHER_CHAIN_PACK.length ? await otherBurnParams() : { minInterval: OTHER_CHAIN_MIN_INTERVAL_S, maxSlippageBps: OTHER_CHAIN_MAX_SLIPPAGE_BPS };
  await Promise.all(
    OTHER_CHAIN_PACK.map(async (c) => {
      try {
        await readOtherBalances(c);
      } catch (e) {
        stateOf(c).lastError = `balance: ${short(e)}`;
      }
    }),
  );
  const burned = store.pound.filter((e) => e.kind === "burned" && e.chainId != null).sort((a, b) => b.ts - a.ts);
  const nextEligibleAt = otherLastBurnAt === 0 ? 0 : otherLastBurnAt + minInterval;
  const coins = OTHER_CHAIN_PACK.map((c, i) => {
    const st = stateOf(c);
    const rows = burned.filter((e) => e.chainId === c.chainId && (e.token ?? "").toLowerCase() === c.token);
    const floor = BigInt(c.floor);
    return {
      index: i,
      chainId: c.chainId,
      chainName: OTHER_CHAIN_NAMES[c.chainId] ?? `chain-${c.chainId}`,
      explorer: OTHER_EXPLORERS[c.chainId] ?? "",
      token: c.token,
      symbol: c.symbol,
      decimals: c.decimals,
      quote: c.quote,
      quoteSymbol: c.quoteSymbol,
      quoteDecimals: c.quoteDecimals,
      floor: c.floor,
      cap: c.cap,
      rpc: Boolean(OTHER_CHAIN_RPC[c.chainId]),
      dryRun: isDryRun(c.chainId),
      balance: st.balance == null ? null : st.balance.toString(),
      gas: st.gas == null ? null : st.gas.toString(),
      balanceAt: st.balanceAt ? Math.floor(st.balanceAt / 1000) : 0,
      funded: st.balance != null && st.balance >= floor,
      next: i === otherCursor,
      lastBurn: rows[0] ?? null,
      burnCount: rows.length,
      burnedQuote: rows.reduce((s, e) => s + BigInt(e.quoteIn ?? "0"), 0n).toString(),
      burnedTokens: rows.reduce((s, e) => s + BigInt(e.tokensOut ?? "0"), 0n).toString(),
      nextEligibleAt,
      lastAttemptAt: st.lastAttemptAt,
      lastQuote: st.lastQuote,
      lastError: st.lastError,
      reason: st.reason,
    };
  });
  return {
    keeper: account?.address ?? null,
    halfmoon: isHalfMoonConfigured(),
    minInterval,
    maxSlippageBps,
    lastBurnAt: otherLastBurnAt,
    nextEligibleAt,
    cursor: otherCursor,
    coins,
    ledger: burned.slice(0, 50),
  };
}

export { NATIVE };
