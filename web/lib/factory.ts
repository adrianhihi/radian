"use client";
import { useEffect, useState } from "react";
import { parseAbi, type Abi, type Address } from "viem";
import { publicClient, RADIAN, activeNetwork, NATIVE_QUOTE, QUOTE_ASSETS } from "./radian";

// Read-only view of the factory and its policy contracts for /factory. Every
// number here is what the chain returns right now; the page never edits.

export const factoryStateAbi = parseAbi([
  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
  "function canLaunch(address launcher) view returns (bool)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function snipeTaxStartBps() view returns (uint256)",
  "function snipeTaxSeconds() view returns (uint256)",
  "function launchForwarder() view returns (address)",
  "function owner() view returns (address)",
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns ((uint256 supply, uint256 curveFeeBps, uint256 phantomQuote, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, bool enabled))",
  "function approvedPairTokens(address) view returns (bool)",
  "function pairTokenEconomics(address) view returns (uint256 phantomQuote, uint256 graduationThreshold, uint8 decimals)",
]);

export const hookPolicyAbi = parseAbi([
  "function hookFeeBps() view returns (uint256)",
  "function protocolFeeShareBps() view returns (uint256)",
  "function buybackBurnBps() view returns (uint256)",
  "function maxInternalPriceImpactBps() view returns (uint256)",
  "function protocolFeeRecipient() view returns (address)",
  "function feeSweepOperator() view returns (address)",
  "function owner() view returns (address)",
]);

const routerKeeperAbi = parseAbi(["function keeper() view returns (address)"]);
const treasuryKeeperAbi = parseAbi(["function keeper() view returns (address)"]);

export type LaunchConfigView = {
  id: number;
  supply: bigint;
  curveFeeBps: number;
  phantomQuote: bigint;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  enabled: boolean;
};

export type QuoteEconView = {
  key: string;
  symbol: string;
  address: Address;
  native: boolean;
  decimals: number;
  stock?: { refSymbol: string; standIn: boolean };
  blurb: string;
  approved: boolean | null; // null = unreadable
  phantomQuote: bigint | null;
  graduationThreshold: bigint | null;
};

export type FactoryState = {
  launchFee: bigint | null;
  launchEnabled: boolean | null;
  maxCreatorTaxBps: number | null;
  snipeTaxStartBps: number | null;
  snipeTaxSeconds: number | null;
  launchForwarder: Address | null;
  factoryOwner: Address | null;
  configs: LaunchConfigView[];
  quotes: QuoteEconView[];
  hook: {
    hookFeeBps: number | null;
    protocolFeeShareBps: number | null;
    buybackBurnBps: number | null;
    maxInternalPriceImpactBps: number | null;
    protocolFeeRecipient: Address | null;
    feeSweepOperator: Address | null;
    owner: Address | null;
  };
  routerKeeper: Address | null;
  treasuryKeeper: Address | null;
};

type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };
type Res = { status: "success"; result: unknown } | { status: "failure" };

// One Multicall3 batch; if the batch itself fails (no Multicall3, RPC hiccup)
// every call is retried on its own so one bad read never blanks the page.
async function readMany(calls: Call[]): Promise<Res[]> {
  if (calls.length === 0) return [];
  try {
    const out = await publicClient.multicall({
      contracts: calls as unknown as Parameters<typeof publicClient.multicall>[0]["contracts"],
      allowFailure: true,
    });
    return out.map((r) => (r.status === "success" ? { status: "success", result: r.result } : { status: "failure" }));
  } catch {
    return Promise.all(
      calls.map((c) =>
        publicClient
          .readContract(c as unknown as Parameters<typeof publicClient.readContract>[0])
          .then((result): Res => ({ status: "success", result }))
          .catch((): Res => ({ status: "failure" })),
      ),
    );
  }
}

const num = (r: Res | undefined): number | null => (r && r.status === "success" ? Number(r.result as bigint) : null);
const big = (r: Res | undefined): bigint | null => (r && r.status === "success" ? (r.result as bigint) : null);
const addr = (r: Res | undefined): Address | null => (r && r.status === "success" ? (r.result as Address) : null);
const bool = (r: Res | undefined): boolean | null => (r && r.status === "success" ? (r.result as boolean) : null);

export async function fetchFactoryState(): Promise<FactoryState> {
  const f = RADIAN.factory;
  const h = RADIAN.hook;
  const first: Call[] = [
    { address: f, abi: factoryStateAbi, functionName: "launchFee" },
    { address: f, abi: factoryStateAbi, functionName: "launchEnabled" },
    { address: f, abi: factoryStateAbi, functionName: "maxCreatorTaxBps" },
    { address: f, abi: factoryStateAbi, functionName: "snipeTaxStartBps" },
    { address: f, abi: factoryStateAbi, functionName: "snipeTaxSeconds" },
    { address: f, abi: factoryStateAbi, functionName: "launchForwarder" },
    { address: f, abi: factoryStateAbi, functionName: "owner" },
    { address: f, abi: factoryStateAbi, functionName: "launchConfigCount" },
    { address: h, abi: hookPolicyAbi, functionName: "hookFeeBps" },
    { address: h, abi: hookPolicyAbi, functionName: "protocolFeeShareBps" },
    { address: h, abi: hookPolicyAbi, functionName: "buybackBurnBps" },
    { address: h, abi: hookPolicyAbi, functionName: "maxInternalPriceImpactBps" },
    { address: h, abi: hookPolicyAbi, functionName: "protocolFeeRecipient" },
    { address: h, abi: hookPolicyAbi, functionName: "feeSweepOperator" },
    { address: h, abi: hookPolicyAbi, functionName: "owner" },
  ];
  if (RADIAN.router !== NATIVE_QUOTE) first.push({ address: RADIAN.router, abi: routerKeeperAbi, functionName: "keeper" });
  if (activeNetwork.radian.treasury !== NATIVE_QUOTE) first.push({ address: activeNetwork.radian.treasury, abi: treasuryKeeperAbi, functionName: "keeper" });
  const r1 = await readMany(first);
  let i = 15;
  const routerKeeper = RADIAN.router !== NATIVE_QUOTE ? addr(r1[i++]) : null;
  const treasuryKeeper = activeNetwork.radian.treasury !== NATIVE_QUOTE ? addr(r1[i++]) : null;

  const count = num(r1[7]) ?? 0;
  const second: Call[] = [];
  for (let id = 0; id < Math.min(count, 16); id++) second.push({ address: f, abi: factoryStateAbi, functionName: "getLaunchConfig", args: [BigInt(id)] });
  for (const q of QUOTE_ASSETS) {
    second.push({ address: f, abi: factoryStateAbi, functionName: "approvedPairTokens", args: [q.address] });
    second.push({ address: f, abi: factoryStateAbi, functionName: "pairTokenEconomics", args: [q.address] });
  }
  const r2 = await readMany(second);

  const configs: LaunchConfigView[] = [];
  for (let id = 0; id < Math.min(count, 16); id++) {
    const r = r2[id];
    if (!r || r.status !== "success") continue;
    const c = r.result as { supply: bigint; curveFeeBps: bigint; phantomQuote: bigint; graduationThreshold: bigint; poolFee: number; tickSpacing: number; enabled: boolean };
    configs.push({ id, supply: c.supply, curveFeeBps: Number(c.curveFeeBps), phantomQuote: c.phantomQuote, graduationThreshold: c.graduationThreshold, poolFee: Number(c.poolFee), tickSpacing: Number(c.tickSpacing), enabled: c.enabled });
  }
  const quotes: QuoteEconView[] = QUOTE_ASSETS.map((q, k) => {
    const base = Math.min(count, 16) + k * 2;
    const ap = r2[base];
    const ec = r2[base + 1];
    const econ = ec && ec.status === "success" ? (ec.result as readonly [bigint, bigint, number]) : null;
    // The native quote is priced by the launch config itself; ERC-20 quotes carry their own economics.
    const fallback = q.native ? configs[0] : undefined;
    return {
      key: q.key,
      symbol: q.symbol,
      address: q.address,
      native: q.native,
      decimals: q.decimals,
      stock: q.stock,
      blurb: q.blurb,
      approved: q.native ? true : bool(ap),
      phantomQuote: econ && econ[0] > 0n ? econ[0] : fallback ? fallback.phantomQuote : null,
      graduationThreshold: econ && econ[1] > 0n ? econ[1] : fallback ? fallback.graduationThreshold : null,
    };
  });

  return {
    launchFee: big(r1[0]),
    launchEnabled: bool(r1[1]),
    maxCreatorTaxBps: num(r1[2]),
    snipeTaxStartBps: num(r1[3]),
    snipeTaxSeconds: num(r1[4]),
    launchForwarder: addr(r1[5]),
    factoryOwner: addr(r1[6]),
    configs,
    quotes,
    hook: {
      hookFeeBps: num(r1[8]),
      protocolFeeShareBps: num(r1[9]),
      buybackBurnBps: num(r1[10]),
      maxInternalPriceImpactBps: num(r1[11]),
      protocolFeeRecipient: addr(r1[12]),
      feeSweepOperator: addr(r1[13]),
      owner: addr(r1[14]),
    },
    routerKeeper,
    treasuryKeeper,
  };
}

export function useFactoryState(): { state: FactoryState | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<FactoryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!activeNetwork.live) {
      setLoading(false);
      return;
    }
    fetchFactoryState()
      .then((s) => alive && setState(s))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { state, loading, error };
}
