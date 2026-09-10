"use client";
import { useEffect, useState } from "react";
import { defineChain, type Address } from "viem";

// ── Network registry ──────────────────────────────────────────────────────
// One place that defines every chain-specific value. The active network is a
// per-viewer choice (localStorage); switching reloads so all module-level
// config re-derives from the chosen network. Mainnet is a placeholder until
// Arc mainnet is live (2026-09-16) and we fill its addresses + flip `live`.

export type NetworkKey = "testnet" | "mainnet" | "base";

export type QuoteAssetDef = {
  key: string;
  symbol: string;
  address: Address;
  decimals: number;
  native: boolean;
  blurb: string;
};

export type NetworkConfig = {
  key: NetworkKey;
  label: string;
  live: boolean;
  hidden?: boolean; // config-ready but not surfaced in the switcher yet
  chainId: number;
  chainName: string;
  rpc: string;
  wsRpc?: string;
  explorer: string;
  deployBlock: bigint;
  indexerUrl: string;
  contracts: {
    factory: Address;
    locker: Address;
    vault: Address;
    escrow: Address;
    hook: Address;
    poolManager: Address;
  };
  radian: {
    token: Address;
    curve: Address;
    staking: Address;
    treasury: Address;
  };
  quoteAssets: QuoteAssetDef[];
};

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  testnet: {
    key: "testnet",
    label: "Testnet",
    live: true,
    chainId: 5042002,
    chainName: "Arc Testnet",
    rpc: "https://rpc.testnet.arc.io",
    explorer: "https://testnet.arcscan.app",
    deployBlock: 61305678n,
    indexerUrl:
      process.env.NEXT_PUBLIC_INDEXER_URL?.replace(/\/$/, "") ??
      "https://radian-indexer-production.up.railway.app",
    contracts: {
      factory: "0x90022cC2107De9c070F889E3A67009FcA270E4E2",
      locker: "0x7efb5B773BBbf69Bd163b52b1BA88C529a0f123c",
      vault: "0xe84D81C3d4f3E12123C9F934AB3Cb8238772b39e",
      escrow: "0x6133392C976d5160CBDE63815f7cd63122f3841C",
      hook: "0x15eB3aeE2f96A199165dc58e6C8dc3Ce2e02e044",
      poolManager: "0x24219d0F3611fE4E438850bB7DB165439957dc9f",
    },
    radian: {
      token: "0x0B764B1e50E4D17A897Cdd9494CaC3355579fDcD",
      curve: "0x8925494f3cfB34cD0df2b4Bf83328928Fe22F126",
      staking: "0x1da4Ebf52892Fb209701a8E6cFF06058e89c21Cc",
      treasury: "0xbFf760f35F421cAE2E9650aF1571FDd618e206a7",
    },
    quoteAssets: [
      { key: "usdc", symbol: "USDC", address: ZERO, decimals: 18, native: true, blurb: "Native dollar — the Arc gas coin" },
      { key: "eurc", symbol: "EURC", address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6, native: false, blurb: "Circle's euro stablecoin" },
    ],
  },
  mainnet: {
    key: "mainnet",
    label: "Mainnet",
    live: false, // flip to true once deployed (see MAINNET_RUNBOOK.md)
    chainId: 5042,
    chainName: "Arc",
    rpc: process.env.NEXT_PUBLIC_ARC_MAINNET_RPC ?? "",
    explorer: "https://arcscan.app",
    deployBlock: 0n,
    indexerUrl: process.env.NEXT_PUBLIC_MAINNET_INDEXER_URL?.replace(/\/$/, "") ?? "",
    contracts: {
      factory: ZERO,
      locker: ZERO,
      vault: ZERO,
      escrow: ZERO,
      hook: ZERO,
      // canonical Uniswap V4 on Arc mainnet (verify on Arcscan at launch)
      poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
    },
    radian: { token: ZERO, curve: ZERO, staking: ZERO, treasury: ZERO },
    quoteAssets: [
      { key: "usdc", symbol: "USDC", address: ZERO, decimals: 18, native: true, blurb: "Native dollar — the Arc gas coin" },
    ],
  },
  // Multi-chain scaffolding. Base has canonical Uniswap V4 and Ondo tokenized
  // stocks, so launches are quoted in Base USDC (ERC-20, 6-dec) — the "priced in
  // real dollars" USP survives even though Base's gas coin is ETH. Hidden until
  // deployed: flip live+hidden, fill the Pons addresses + PositionManager, and
  // set NEXT_PUBLIC_BASE_RPC / NEXT_PUBLIC_BASE_INDEXER_URL in Vercel.
  base: {
    key: "base",
    label: "Base",
    live: false,
    hidden: true,
    chainId: 8453,
    chainName: "Base",
    rpc: process.env.NEXT_PUBLIC_BASE_RPC ?? "https://mainnet.base.org",
    explorer: "https://basescan.org",
    deployBlock: 0n,
    indexerUrl: process.env.NEXT_PUBLIC_BASE_INDEXER_URL?.replace(/\/$/, "") ?? "",
    contracts: {
      factory: ZERO,
      locker: ZERO,
      vault: ZERO,
      escrow: ZERO,
      hook: ZERO,
      // canonical Uniswap V4 PoolManager on Base (verified on BaseScan)
      poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    },
    radian: { token: ZERO, curve: ZERO, staking: ZERO, treasury: ZERO },
    quoteAssets: [
      // Base USDC (native Circle USDC on Base, 6-dec) — the featured quote.
      { key: "usdc", symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, native: false, blurb: "Circle USDC on Base" },
    ],
  },
};

const LS_KEY = "radian.network";

export function getActiveNetworkKey(): NetworkKey {
  if (typeof window === "undefined") return "testnet";
  try {
    const k = window.localStorage.getItem(LS_KEY);
    if (k === "mainnet" || k === "testnet") return k;
  } catch {}
  return "testnet";
}

export function getActiveNetwork(): NetworkConfig {
  return NETWORKS[getActiveNetworkKey()];
}

// SSR-safe hook: returns the default (testnet) on the server and first client
// render — so hydration matches — then reconciles to the real choice on mount.
// Use this for anything that GATES rendering; module-level config (addresses,
// clients) still reflects the real choice for data/effects (client-only).
export function useNetwork(): NetworkConfig {
  const [n, setN] = useState<NetworkConfig>(NETWORKS.testnet);
  useEffect(() => setN(getActiveNetwork()), []);
  return n;
}

export function setActiveNetwork(key: NetworkKey) {
  try {
    window.localStorage.setItem(LS_KEY, key);
  } catch {}
  window.location.reload();
}

export function toViemChain(n: NetworkConfig) {
  // Always provide a URL so the viem transport can be constructed even before a
  // network is live (its read hooks short-circuit on `live`, so it's never hit).
  const http = n.rpc || "https://rpc.testnet.arc.io";
  return defineChain({
    id: n.chainId,
    name: n.chainName,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [http] } },
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
    blockExplorers: { default: { name: "Arcscan", url: n.explorer } },
    testnet: !n.live ? true : n.key === "testnet",
  });
}
