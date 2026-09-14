import { formatUnits, parseAbi, parseUnits } from "viem";

// Launch templates (RadianLaunchRouter v2). Per-launch contracts are EIP-1167
// clones; their addresses come from the indexer (`template` on /token/:addr)
// or, for Proof-of-Fee, from PoFRouter.launches(token) on-chain.

// ---- ABIs (only what the UI needs) ----

export const wallTreasuryAbi = parseAbi([
  "function reserve() view returns (uint256)",
  "function claimable() view returns (uint256)",
  "function circulating() view returns (uint256)",
  "function bookValue() view returns (uint256)",
  "function spot() view returns (uint256)",
  "function floorPrice() view returns (uint256)",
  "function budgetRemaining() view returns (uint256)",
  "function quoteToRestoreFloor() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function totalStreamed() view returns (uint256)",
  "function totalSpent() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function totalBounty() view returns (uint256)",
  "function lastDefendAt() view returns (uint64)",
  "function pairToken() view returns (address)",
  "function staking() view returns (address)",
  "function token() view returns (address)",
  "function config() view returns (uint16 marginBps, uint16 epochBudgetBps, uint16 streamBps, uint16 maxSlippageBps, uint32 minInterval, uint128 keeperBounty)",
  "function claimFees() returns (uint256 claimed, uint256 streamed)",
]);

export const wallStakingAbi = parseAbi([
  "function stake(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function getReward()",
  "function exit()",
  "function stakedOf(address) view returns (uint256)",
  "function earned(address) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function rewardRate() view returns (uint256)",
  "function periodFinish() view returns (uint256)",
  "function rewardToken() view returns (address)",
  "function totalDistributed() view returns (uint256)",
]);

export const pofVaultAbi = parseAbi([
  "function currentRound() view returns (uint256)",
  "function settled(uint256) view returns (bool)",
  "function roundPool(uint256) view returns (uint256)",
  "function roundTotal(uint256) view returns (uint256)",
  "function claimed(uint256 round, address user) view returns (bool)",
  "function pendingOf(address user, uint256[] rounds) view returns (uint256)",
  "function claim(uint256[] rounds) returns (uint256)",
  "function unallocated() view returns (uint256)",
  "function totalBought() view returns (uint256)",
  "function totalPaid() view returns (uint256)",
  "function launchedAt() view returns (uint256)",
  "function plannedSpend() view returns (uint256)",
  "function config() view returns (uint128 targetWork, uint32 roundSeconds, uint32 minInterval, uint16 maxBuybackReserveBps)",
]);

export const pofRouterAbi = parseAbi([
  "function buy(address token, uint256 quoteIn, uint256 minOut) payable returns (uint256 out)",
  "function workOf(address token, uint256 round, address user) view returns (uint256)",
  "function totalWork(address token, uint256 round) view returns (uint256)",
  "function activeRoundCount(address token) view returns (uint256)",
  "function activeRoundAt(address token, uint256 i) view returns (uint256)",
  "function launches(address token) view returns (address vault, address curve, address pairToken)",
]);

// ---- launch-time config: defaults + the bounds the router enforces ----

export type WallConfigInput = {
  marginPct: string; // marginBps / 100
  budgetPct: string; // epochBudgetBps / 100
  streamPct: string; // streamBps / 100
  slippagePct: string; // maxSlippageBps / 100
  minIntervalMin: string; // minutes
  keeperBounty: string; // quote units
};
export const WALL_DEFAULTS: WallConfigInput = {
  marginPct: "5",
  budgetPct: "10",
  streamPct: "30",
  slippagePct: "5",
  minIntervalMin: "60",
  keeperBounty: "0.01",
};
export const WALL_BOUNDS = {
  marginBpsMax: 2000,
  epochBudgetBpsMax: 2500,
  streamBpsMax: 5000,
  maxSlippageBpsMax: 1000,
  minIntervalMin: 600, // seconds
} as const;

export type PoFConfigInput = {
  roundMin: string; // minutes
  targetWork: string; // quote units per round
  buybackCapPct: string; // maxBuybackReserveBps / 100
  minIntervalMin: string; // minutes
};
export const POF_DEFAULTS: PoFConfigInput = {
  roundMin: "10",
  targetWork: "5",
  buybackCapPct: "5",
  minIntervalMin: "10",
};
export const POF_BOUNDS = {
  roundSecondsMin: 60,
  roundSecondsMax: 86400,
  minIntervalMin: 600, // seconds
  maxBuybackReserveBpsMax: 1000,
} as const;

const toBps = (pct: string) => Math.round((Number(pct) || 0) * 100);

export type WallConfig = { marginBps: number; epochBudgetBps: number; streamBps: number; maxSlippageBps: number; minInterval: number; keeperBounty: bigint };
export type PoFConfig = { targetWork: bigint; roundSeconds: number; minInterval: number; maxBuybackReserveBps: number };
// Either an error to show, or the tuple the router expects — never both.
export type Built<T> = { error: string; cfg?: undefined } | { error?: undefined; cfg: T };

/** Validates + encodes the Wall form. Returns an error string, or the tuple the router expects. */
export function buildWallConfig(c: WallConfigInput, quoteDecimals: number): Built<WallConfig> {
  const marginBps = toBps(c.marginPct);
  const epochBudgetBps = toBps(c.budgetPct);
  const streamBps = toBps(c.streamPct);
  const maxSlippageBps = toBps(c.slippagePct);
  const minInterval = Math.round((Number(c.minIntervalMin) || 0) * 60);
  if (marginBps < 0 || marginBps > WALL_BOUNDS.marginBpsMax) return { error: `Margin must be 0–${WALL_BOUNDS.marginBpsMax / 100}%.` };
  if (epochBudgetBps < 0 || epochBudgetBps > WALL_BOUNDS.epochBudgetBpsMax) return { error: `Daily budget must be 0–${WALL_BOUNDS.epochBudgetBpsMax / 100}%.` };
  if (streamBps < 0 || streamBps > WALL_BOUNDS.streamBpsMax) return { error: `Stream to stakers must be 0–${WALL_BOUNDS.streamBpsMax / 100}%.` };
  if (maxSlippageBps < 0 || maxSlippageBps > WALL_BOUNDS.maxSlippageBpsMax) return { error: `Max slippage must be 0–${WALL_BOUNDS.maxSlippageBpsMax / 100}%.` };
  if (minInterval < WALL_BOUNDS.minIntervalMin) return { error: `Min interval must be at least ${WALL_BOUNDS.minIntervalMin / 60} minutes.` };
  let keeperBounty: bigint;
  try {
    keeperBounty = parseUnits(c.keeperBounty || "0", quoteDecimals);
  } catch {
    return { error: "Keeper bounty is not a valid amount." };
  }
  if (keeperBounty < 0n || keeperBounty > 2n ** 128n - 1n) return { error: "Keeper bounty out of range." };
  return { cfg: { marginBps, epochBudgetBps, streamBps, maxSlippageBps, minInterval, keeperBounty } };
}

/** Validates + encodes the Proof-of-Fee form. */
export function buildPoFConfig(c: PoFConfigInput, quoteDecimals: number): Built<PoFConfig> {
  const roundSeconds = Math.round((Number(c.roundMin) || 0) * 60);
  const minInterval = Math.round((Number(c.minIntervalMin) || 0) * 60);
  const maxBuybackReserveBps = toBps(c.buybackCapPct);
  if (roundSeconds < POF_BOUNDS.roundSecondsMin || roundSeconds > POF_BOUNDS.roundSecondsMax) return { error: "Round length must be 1 minute to 24 hours." };
  if (minInterval < POF_BOUNDS.minIntervalMin) return { error: `Min interval must be at least ${POF_BOUNDS.minIntervalMin / 60} minutes.` };
  if (maxBuybackReserveBps < 0 || maxBuybackReserveBps > POF_BOUNDS.maxBuybackReserveBpsMax) return { error: `Buyback cap must be 0–${POF_BOUNDS.maxBuybackReserveBpsMax / 100}% of the curve reserve.` };
  let targetWork: bigint;
  try {
    targetWork = parseUnits(c.targetWork || "0", quoteDecimals);
  } catch {
    return { error: "Target work is not a valid amount." };
  }
  if (targetWork <= 0n) return { error: "Target work per round must be above 0." };
  if (targetWork > 2n ** 128n - 1n) return { error: "Target work out of range." };
  return { cfg: { targetWork, roundSeconds, minInterval, maxBuybackReserveBps } };
}

// ---- display helpers (a dash for unknown, never a zero) ----

/** Raw units → localized number; `undefined` (unread / failed read) → "—". */
export const fmtAmount = (v: bigint | undefined, decimals: number, digits = 4) =>
  v === undefined ? "—" : Number(formatUnits(v, decimals)).toLocaleString(undefined, { maximumFractionDigits: digits });

/** A per-token price in quote units (raw, per 1e18 tokens) → compact exponent form like the spot price. */
export const fmtPrice = (v: bigint | undefined, decimals: number) =>
  v === undefined ? "—" : Number(formatUnits(v, decimals)).toExponential(3);

export const fmtDuration = (secs: number) => {
  if (!Number.isFinite(secs) || secs < 0) return "—";
  if (secs < 60) return `${Math.floor(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.floor(secs % 60)}s`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
};
