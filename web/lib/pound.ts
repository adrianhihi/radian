"use client";
import { parseAbi } from "viem";

// The Pound: protocol-fee waterfall (PoundVault) and the rotating buy-and-burn
// (PackBurner). Both are global per network; addresses live in networks.ts `pound`.

export const poundVaultAbi = parseAbi([
  "function REFERRAL_BPS() view returns (uint256)",
  "function LAUNCHER_BPS() view returns (uint256)",
  "function burnShareBps() view returns (uint16)",
  "function treasury() view returns (address)",
  "function burner() view returns (address)",
  "function router() view returns (address)",
  "function pending(address asset, address referrer) view returns (uint256)",
  "function totalPending(address asset) view returns (uint256)",
  "function reserve(address asset) view returns (uint256)",
  "function totalReferrals(address asset) view returns (uint256)",
  "function totalBurned(address asset) view returns (uint256)",
  "function totalTreasury(address asset) view returns (uint256)",
  "function referralOf(address asset, address referrer) view returns (uint256 claimable, uint256 accrued)",
  "function claimReferral(address asset) returns (uint256 amount)",
  "function settle(address asset) returns (uint256 intake, uint256 toReferrals, uint256 toBurn, uint256 toTreasury)",
  "event Attributed(address indexed asset, address indexed referrer, address indexed user, uint256 amount, bool launcher)",
  "event ReferralClaimed(address indexed asset, address indexed referrer, uint256 amount)",
  "event Settled(address indexed asset, uint256 intake, uint256 toReferrals, uint256 toBurn, uint256 toTreasury)",
]);

export const packBurnerAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct Pack { address token; PoolKey key; address asset; uint128 floor; uint128 maxPerBurn; bool active; }",
  "function packCount() view returns (uint256)",
  "function packAt(uint256 i) view returns (Pack)",
  "function nextPack() view returns (uint256)",
  "function cursor() view returns (uint256)",
  "function lastBurnAt() view returns (uint64)",
  "function minInterval() view returns (uint32)",
  "function bountyBps() view returns (uint16)",
  "function maxSlippageBps() view returns (uint16)",
  "function permissionless() view returns (bool)",
  "function pool(address asset) view returns (uint256)",
  "function burnedOf(address token) view returns (uint256)",
  "function spentOf(address asset) view returns (uint256)",
  "function spotOut(uint256 index, uint256 quoteIn) view returns (uint256)",
  "function burn(uint256 amount, uint256 minOut) returns (uint256 index, uint256 tokensOut)",
  "event Burned(uint256 indexed index, address indexed token, address indexed asset, uint256 quoteIn, uint256 tokensOut, address caller, uint256 bounty)",
  "event Deposited(address indexed asset, uint256 amount, address from)",
]);

// Router v4 trade + attribution surface (the launch functions stay in lib/radian.ts routerAbi)
export const routerTradeAbi = parseAbi([
  "function buy(address token, uint256 quoteIn, uint256 minTokensOut, address recipient, address referrer) payable returns (uint256 tokensOut)",
  "function sell(address token, uint256 tokensIn, uint256 minQuoteOut, address recipient, address referrer) returns (uint256 quoteOut)",
  "function launcherRef(address token) view returns (address)",
  "function vault() view returns (address)",
  "function templatesEnabled() view returns (bool)",
  "event Bought(address indexed token, address indexed buyer, address indexed recipient, address referrer, uint256 quoteIn, uint256 tokensOut, uint256 fee)",
  "event Sold(address indexed token, address indexed seller, address indexed recipient, address referrer, uint256 tokensIn, uint256 quoteOut, uint256 fee)",
]);

// ---- indexer views ----
import { INDEXER_URL, hasIndexer } from "./indexer";

export type PoundAssetRow = {
  asset: `0x${string}`; symbol: string; decimals: number;
  totalPending: string; reserve: string; totalReferrals: string; totalBurned: string; totalTreasury: string;
  burnPool: string; burnSpent: string;
};
export type PoundPack = {
  index: number; token: `0x${string}`; asset: `0x${string}`; floor: string; maxPerBurn: string; active: boolean;
  poolFee: number; hooks: `0x${string}`; symbol?: string; burned?: string; assetSymbol?: string; assetDecimals?: number;
};
export type PoundLedgerRow = {
  txHash: string; logIndex: number; block: string; ts: number;
  kind: "settle" | "burn" | "referralClaim" | "attributed" | "packAdded" | "packSet";
  asset?: string; intake?: string; toReferrals?: string; toBurn?: string; toTreasury?: string;
  index?: number; token?: string; quoteIn?: string; tokensOut?: string; caller?: string; bounty?: string;
  floor?: string; maxPerBurn?: string; active?: boolean; referrer?: string; user?: string; amount?: string; launcher?: boolean;
};
export type PoundView = {
  vault: { address: `0x${string}`; router: `0x${string}`; burner: `0x${string}`; treasury: `0x${string}`; burnShareBps: number; referralBps: number; launcherBps: number };
  burner: { address: `0x${string}`; packCount: number; cursor: number; nextPack: number | null; lastBurnAt: number; minInterval: number; bountyBps: number; maxSlippageBps: number; permissionless: boolean; keeper: `0x${string}` };
  assets: PoundAssetRow[];
  packs: PoundPack[];
  referrers: { referrer: string; asset: string; accrued: string; trades: number; lastAt: number }[];
  ledger: PoundLedgerRow[];
};
export type ReferralView = {
  referrer: string;
  assets: { asset: `0x${string}`; symbol: string; decimals: number; claimable: string; accrued: string; trades: number }[];
  recent: PoundLedgerRow[];
};

export async function fetchPound(): Promise<PoundView | null> {
  if (!hasIndexer()) return null;
  const r = await fetch(`${INDEXER_URL}/pound`, { cache: "no-store" });
  if (!r.ok) return null;
  return (await r.json()) as PoundView;
}
export async function fetchReferral(address: string): Promise<ReferralView | null> {
  if (!hasIndexer()) return null;
  const r = await fetch(`${INDEXER_URL}/pound/referral/${address}`, { cache: "no-store" });
  if (!r.ok) return null;
  return (await r.json()) as ReferralView;
}
