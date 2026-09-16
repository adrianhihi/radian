"use client";
import { useEffect, useState } from "react";
import { defineChain, type Address } from "viem";

// ── Network registry ──────────────────────────────────────────────────────
// One place that defines every chain-specific value. The active network is a
// per-viewer choice (localStorage); switching reloads so all module-level
// config re-derives from the chosen network. Mainnet is a placeholder until
// Arc mainnet is live (2026-09-16) and we fill its addresses + flip `live`.

export type NetworkKey = "testnet" | "mainnet" | "base" | "robinhood-testnet";

export type QuoteAssetDef = {
  key: string;
  symbol: string;
  address: Address;
  decimals: number;
  native: boolean;
  blurb: string;
  gradGoal: number; // whole units of this asset in the curve to graduate (display)
  featured?: boolean; // default selection on the launch page (else the native coin)
  // When set, this quote asset is a tokenized STOCK: launches paired against it
  // are "denominated in shares," and the UI shows the real share price (via the
  // /api/stock-price route) purely as a human reference — the contract never
  // reads it. `refSymbol` is the real ticker to price; `standIn` marks a testnet
  // placeholder (no real stock on Arc) vs. a real mainnet tokenized stock.
  stock?: { refSymbol: string; standIn: boolean };
};

export type NetworkConfig = {
  key: NetworkKey;
  label: string;
  live: boolean;
  hidden?: boolean; // config-ready but not surfaced in the switcher yet
  chainId: number;
  chainName: string;
  // gas coin symbol (USDC on Arc; ETH on Robinhood Chain / Base). Decimals are 18 everywhere we run.
  nativeSymbol?: string;
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
    // Atomic launch + first buy (RadianLaunchRouter). Zero = not deployed; the
    // launch page then falls back to two transactions.
    router: Address;
    // Launch templates (router v2). Per-launch WallTreasury / WallStaking /
    // PoFVault are EIP-1167 clones of these implementations, so pinning the
    // implementation hash covers every instance. Zero = not deployed.
    pofRouter: Address;
    executor: Address; // RadianExecutor: keeper-run delegated buys
    wallTreasuryImpl: Address;
    wallStakingImpl: Address;
    pofVaultImpl: Address;
  };
  radian: {
    token: Address;
    curve: Address;
    staking: Address;
    treasury: Address;
  };
  quoteAssets: QuoteAssetDef[];
  // keccak256 of each deployed contract's runtime code, recorded at deploy
  // (`cast keccak $(cast code <addr>)`). The site re-hashes the live code and
  // refuses to launch or trade on a mismatch (lib/identity.ts). Fill on deploy.
  codeHashes: Partial<
    Record<
      | "factory" | "hook" | "router" | "escrow" | "vault" | "locker" | "poolManager" | "staking" | "treasury"
      | "pofRouter" | "executor" | "wallTreasuryImpl" | "wallStakingImpl" | "pofVaultImpl",
      `0x${string}`
    >
  >;
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
      // v2 (2026-09-14): launchAndBuy + launchWall + launchPoF
      router: "0xB9F097662302F220989AAeBa6776041d7d625fAE",
      pofRouter: "0x7a21533EBEdC7222F299dcfd46E0463E744bF6E8",
      executor: "0xbf1fbda5991Ff34733AE74eDB84F74527B9588C1",
      wallTreasuryImpl: "0x88f6f47AAFf65B948712f8C87b6eF51C7B6197c4",
      wallStakingImpl: "0x7F15D040Ae2A758D891A75e9399ab6b9487e70C1",
      pofVaultImpl: "0xeAF10129B449F3108923E666Fb7E7f00eC176bC5",
    },
    radian: {
      token: "0x0B764B1e50E4D17A897Cdd9494CaC3355579fDcD",
      curve: "0x8925494f3cfB34cD0df2b4Bf83328928Fe22F126",
      // v2 (2026-09-10): two-step ownership, escrow claim, bounded flush.
      staking: "0xf3832Fa6EBa9cD09161C2010c7E93a1A2B7f8B4c",
      treasury: "0xebCcaE2eDDaEfcaA5452058fc8f426dfC9570ba0",
    },
    codeHashes: {
      // Arc testnet, recorded 2026-09-13
      factory: "0x4444b7a1dbfc5b7b43f7ea4213be5db1720e8e381628a0a5024a3bba57d71595",
      hook: "0x4d459c2b449407539e90df566a137db52aa6a34f69e45f1a062bd57e785a4bb2",
      router: "0xd73b94c80452b2e91fe4c38347ce2157d9f45cd7f9c242009f0480501a0b4788",
      escrow: "0xdbc3d137ff3b35ee6fa87e0bb86ddbf9a6006fb3204b16006b5b0717acaff686",
      vault: "0xa3f5985eb0b204f7659581846c6335006148665a5572b7e47567e8a5362e3edb",
      locker: "0x38748c627ad799e26df81475147c567afe965b35467741aceaf10f49c7b8939e",
      poolManager: "0xb13c6cc815ee74f897a9168dfd9bce10a140e87981b7f9d83f3d90250dda70ad",
      staking: "0xf7e675e11f13fbc04cebd15754c1ae0c14994d5e2f3815b9d8eea04992bafb57",
      treasury: "0x232fdd7004bfce03847d90b4d777acfdacdb0d1549b7261f051a6ea475bacd87",
      // templates + executor, recorded 2026-09-14
      pofRouter: "0xf5eb91076302ba59b8f58d3c6d445694e6a17c7acfa3d8e14040035130db0b98",
      executor: "0x521601531f84dc48bbb390e6514314684da9cf1e45c46dee77f8eacc3e14623c",
      wallTreasuryImpl: "0x718ad47a561ab9daedadef3db329acbac22a8c54106b76e38ca6312854de63e4",
      wallStakingImpl: "0x0128ecfb818d294790edc549a882cf0efa8a2ee787e249fca92ca888c3d5c012",
      pofVaultImpl: "0x95f3971dff5cc41428090a979a462c5784b5204b8833c2b5716fdb4ceffe0674",
    },
    quoteAssets: [
      { key: "usdc", symbol: "USDC", address: ZERO, decimals: 18, native: true, gradGoal: 20, blurb: "Native dollar — the Arc gas coin" },
      { key: "eurc", symbol: "EURC", address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6, native: false, gradGoal: 20, blurb: "Circle's euro stablecoin" },
      { key: "nvdax", symbol: "NVDAx", address: "0xDebcC47bf6e1DEFE1eC76290441836E4981dA882", decimals: 18, native: false, gradGoal: 50, blurb: "Nvidia — priced in shares, not dollars", stock: { refSymbol: "NVDA", standIn: true } },
      { key: "tslax", symbol: "TSLAx", address: "0xb538054166A5f9aa98b945d32A7d1F122c1c3c87", decimals: 18, native: false, gradGoal: 50, blurb: "Tesla — priced in shares, not dollars", stock: { refSymbol: "TSLA", standIn: true } },
      { key: "aaplx", symbol: "AAPLx", address: "0x88Ad67D823791C2DD5dDd96CF88e573A1F5Bb785", decimals: 18, native: false, gradGoal: 50, blurb: "Apple — priced in shares, not dollars", stock: { refSymbol: "AAPL", standIn: true } },
      { key: "googlx", symbol: "GOOGLx", address: "0x195a4d07E2Bd492F70063e6c7017E336e28a8F68", decimals: 18, native: false, gradGoal: 50, blurb: "Alphabet — priced in shares, not dollars", stock: { refSymbol: "GOOGL", standIn: true } },
      { key: "msftx", symbol: "MSFTx", address: "0xD7DeD9057a4EC0a329d2c70784C8723f7df56e7F", decimals: 18, native: false, gradGoal: 50, blurb: "Microsoft — priced in shares, not dollars", stock: { refSymbol: "MSFT", standIn: true } },
      { key: "amznx", symbol: "AMZNx", address: "0x865e62E6327C572C7fb8d3427f67b03b9A4558fb", decimals: 18, native: false, gradGoal: 50, blurb: "Amazon — priced in shares, not dollars", stock: { refSymbol: "AMZN", standIn: true } },
      { key: "metax", symbol: "METAx", address: "0xfFBA38678178dC0B7a0EaCeceAF36795BB750977", decimals: 18, native: false, gradGoal: 50, blurb: "Meta — priced in shares, not dollars", stock: { refSymbol: "META", standIn: true } },
      { key: "spyx", symbol: "SPYx", address: "0x072F8FA84c12e56fE20d3F0BFbB903a96B099973", decimals: 18, native: false, gradGoal: 50, blurb: "S&P 500 ETF — priced in shares, not dollars", stock: { refSymbol: "SPY", standIn: true } },
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
      router: ZERO,
      pofRouter: ZERO,
      executor: ZERO,
      wallTreasuryImpl: ZERO,
      wallStakingImpl: ZERO,
      pofVaultImpl: ZERO,
    },
    radian: { token: ZERO, curve: ZERO, staking: ZERO, treasury: ZERO },
    codeHashes: {},
    quoteAssets: [
      { key: "usdc", symbol: "USDC", address: ZERO, decimals: 18, native: true, gradGoal: 20, blurb: "Native dollar — the Arc gas coin" },
    ],
  },
  // Multi-chain scaffolding. Base has canonical Uniswap V4 and Ondo tokenized
  // stocks, so launches are quoted in Base USDC (ERC-20, 6-dec) — the "priced in
  // real dollars" USP survives even though Base's gas coin is ETH. Hidden until
  // deployed: flip live+hidden, fill the Pons addresses + PositionManager, and
  // set NEXT_PUBLIC_BASE_RPC / NEXT_PUBLIC_BASE_INDEXER_URL in Vercel.
  // Robinhood Chain testnet (Arbitrum Orbit, ETH gas). Canonical Uniswap V4 +
  // Permit2 exist at the mainnet addresses; no USDG or stock tokens on the
  // testnet, so dollar/stock stand-ins are deployed with the stack. Addresses
  // are filled by script/DeployChain.s.sol output; hidden until then.
  "robinhood-testnet": {
    key: "robinhood-testnet",
    label: "Robinhood Testnet",
    live: true,
    chainId: 46630,
    chainName: "Robinhood Chain Testnet",
    nativeSymbol: "ETH",
    rpc: process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    deployBlock: 120304515n,
    indexerUrl:
      process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_INDEXER_URL?.replace(/\/$/, "") ??
      "https://radian-indexer-robinhood-production.up.railway.app",
    // DeployChain.s.sol, 2026-09-16 (Arbitrum Orbit, ETH gas; canonical Uniswap V4)
    contracts: {
      factory: "0x55622f7eD404f982cb6C5fa12268894A580848F6",
      locker: "0x61171A1a50AA2493918f6EAf3d9cf112e569FAea",
      vault: "0xD7aD9E5c0216E09238105363DdaA6Ce3B81eCca1",
      escrow: "0x112923deC686B647D140Ee58C17b0e4B6F804149",
      hook: "0x15d5B10A1fCe67c01196EF118E5632B0D18Ca044",
      poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
      router: "0x5AC74F2666d284D55e5AEACF122C75fF9268a3Da",
      pofRouter: "0xa6B14Ab7490123De19a82521137cA1F59BFA4fC5",
      executor: "0xefb3FBDCf95662177d66E264B8394E7BD4Ece11c",
      wallTreasuryImpl: "0xa8D3DFEE672ee92663298300030a1DFB078Cb552",
      wallStakingImpl: "0x8F523C5240714033c408760fb8C7f7bF4F3BaD99",
      pofVaultImpl: "0xd08304E63ADf9EFc7a0700d9b2aB613A0cA37C37",
    },
    // no $RADIAN flywheel here (its contracts pay the gas coin; an ERC-20 variant comes first)
    radian: { token: ZERO, curve: ZERO, staking: ZERO, treasury: ZERO },
    quoteAssets: [
      // index 0 must be the native coin (quoteByAddress resolves the zero address to it)
      { key: "eth", symbol: "ETH", address: ZERO, decimals: 18, native: true, gradGoal: 0.042, blurb: "The gas coin" },
      { key: "usdgx", symbol: "USDGx", address: "0xf6f8fF47fEa2f2cE3195ad197B8A9BF520c13ed0", decimals: 6, native: false, gradGoal: 10000, featured: true, blurb: "Dollar stand-in for the testnet (USDG on mainnet)" },
      { key: "nvdax", symbol: "NVDAx", address: "0x4B2E6503e10708d5be2245DE0DED7D0ccF5AeF19", decimals: 18, native: false, gradGoal: 50, blurb: "Nvidia — priced in shares, not dollars", stock: { refSymbol: "NVDA", standIn: true } },
      { key: "tslax", symbol: "TSLAx", address: "0xE8a0d16201bfbA7c42712Fa000B86E0b3BfD0745", decimals: 18, native: false, gradGoal: 50, blurb: "Tesla — priced in shares, not dollars", stock: { refSymbol: "TSLA", standIn: true } },
      { key: "aaplx", symbol: "AAPLx", address: "0x176892e311fB4e517Ed2419626d6F9691bD7DcC6", decimals: 18, native: false, gradGoal: 50, blurb: "Apple — priced in shares, not dollars", stock: { refSymbol: "AAPL", standIn: true } },
    ],
    codeHashes: {
      // recorded 2026-09-16; the three clone implementations hash identically to Arc's (no immutables)
      factory: "0xad2a5c89974e730ab607d7fb734aded658373624816548bf4f7d3b1ff6dab0b6",
      hook: "0x505ddf6d9505bf40d0291550fb1ddb9a366d5dc1767fb26ca8512b652421ab9f",
      router: "0x45d5d28e1e7a70114d4dbc7b0a09032776b02fc2090529e6f192205eb2e1e112",
      escrow: "0x87218669be442aa96ee406a6ba1886c29d8d450a7266628fa6f19b2c788d8316",
      vault: "0x0c146bf2d9808a225cbefef67e7a68a530398791b15a4b825d500a69b91e7878",
      locker: "0x5304631acb89c64e75397509c745337b6ddb3e7f529e2297a335114049bcff7d",
      poolManager: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
      pofRouter: "0x2e9adcbce828f92581f5582907bba015f91358a90aa6d985121d42c66e7e2811",
      executor: "0x4e35c2b6d49b5b007a4abd1d1ad8c76e0aee92178b530880dabb21d9b3c6f7df",
      wallTreasuryImpl: "0x718ad47a561ab9daedadef3db329acbac22a8c54106b76e38ca6312854de63e4",
      wallStakingImpl: "0x0128ecfb818d294790edc549a882cf0efa8a2ee787e249fca92ca888c3d5c012",
      pofVaultImpl: "0x95f3971dff5cc41428090a979a462c5784b5204b8833c2b5716fdb4ceffe0674",
    },
  },
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
      router: ZERO,
      pofRouter: ZERO,
      executor: ZERO,
      wallTreasuryImpl: ZERO,
      wallStakingImpl: ZERO,
      pofVaultImpl: ZERO,
    },
    radian: { token: ZERO, curve: ZERO, staking: ZERO, treasury: ZERO },
    codeHashes: {},
    quoteAssets: [
      // Base USDC (native Circle USDC on Base, 6-dec) — the featured quote.
      { key: "usdc", symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, native: false, gradGoal: 20, blurb: "Circle USDC on Base" },
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
    nativeCurrency: { name: n.nativeSymbol ?? "USDC", symbol: n.nativeSymbol ?? "USDC", decimals: 18 },
    rpcUrls: { default: { http: [http] } },
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
    blockExplorers: { default: { name: "Explorer", url: n.explorer } },
    testnet: !n.live ? true : n.key === "testnet",
  });
}
