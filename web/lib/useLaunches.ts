"use client";
import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { publicClient, curveAbi, tokenAbi, type LaunchRow } from "./radian";
import { getRegistry } from "./registry";
import { hasIndexer, fetchLaunches } from "./indexer";

// One Multicall3 batch for the whole grid: name/symbol/logo/description per
// token + getReserves/trackedQuote/graduated per curve. ~6 tokens × 7 calls
// collapse into a single eth_call, instead of 42 separate requests that Arc's
// public RPC rate-limits (429). A real indexer removes even this.
export function useLaunches() {
  const [rows, setRows] = useState<LaunchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      // Prefer the indexer (one fast, reliable request); fall back to chain.
      if (hasIndexer()) {
        try {
          const rows = await fetchLaunches();
          if (rows.length > 0) {
            setRows(rows);
            setLoading(false);
            return;
          }
        } catch {
          /* indexer down — fall through to on-chain reads */
        }
      }
      const reg = getRegistry();
      const contracts = reg.flatMap((e) => [
        { address: e.token, abi: tokenAbi, functionName: "name" } as const,
        { address: e.token, abi: tokenAbi, functionName: "symbol" } as const,
        { address: e.token, abi: tokenAbi, functionName: "logo" } as const,
        { address: e.token, abi: tokenAbi, functionName: "description" } as const,
        { address: e.curve, abi: curveAbi, functionName: "getReserves" } as const,
        { address: e.curve, abi: curveAbi, functionName: "trackedQuote" } as const,
        { address: e.curve, abi: curveAbi, functionName: "graduated" } as const,
      ]);
      const res = await publicClient.multicall({ contracts, allowFailure: true });

      const out: LaunchRow[] = [];
      reg.forEach((e, i) => {
        const b = i * 7;
        const name = res[b].result as string | undefined;
        const symbol = res[b + 1].result as string | undefined;
        if (!name || !symbol) return; // token unreadable this round — skip
        const reserves = res[b + 4].result as [bigint, bigint] | undefined;
        const trackedQuote = (res[b + 5].result as bigint | undefined) ?? 0n;
        const graduated = (res[b + 6].result as boolean | undefined) ?? false;
        const progress =
          e.graduationThreshold && BigInt(e.graduationThreshold) > 0n
            ? Math.min(1, Number((trackedQuote * 10000n) / BigInt(e.graduationThreshold)) / 10000)
            : 0;
        out.push({
          token: e.token,
          curve: e.curve,
          deployer: e.deployer,
          graduationThreshold: BigInt(e.graduationThreshold),
          name,
          symbol,
          logo: (res[b + 2].result as string) ?? "",
          description: (res[b + 3].result as string) ?? "",
          quoteReserve: reserves?.[0] ?? 0n,
          trackedQuote,
          graduated,
          progress,
        });
      });
      setRows(out);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "failed to load launches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000); // 30s — gentle on the public RPC
    return () => clearInterval(t);
  }, [refresh]);

  return { rows, loading, error, refresh };
}

// helper kept for callers that still format reserves
export const fmtUsdc = (v: bigint) => Number(formatUnits(v, 18));
