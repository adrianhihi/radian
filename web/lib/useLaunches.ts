"use client";
import { useCallback, useEffect, useState } from "react";
import { publicClient, curveAbi, tokenAbi, type LaunchRow } from "./radian";
import { getRegistry } from "./registry";
import type { Address } from "viem";

async function loadRow(
  token: Address,
  curve: Address,
  deployer: Address,
  graduationThreshold: bigint
): Promise<LaunchRow> {
  const [name, symbol, logo, description, reserves, tracked, graduated] = await Promise.all([
    publicClient.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
    publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
    publicClient.readContract({ address: token, abi: tokenAbi, functionName: "logo" }).catch(() => ""),
    publicClient
      .readContract({ address: token, abi: tokenAbi, functionName: "description" })
      .catch(() => ""),
    publicClient.readContract({ address: curve, abi: curveAbi, functionName: "getReserves" }),
    publicClient.readContract({ address: curve, abi: curveAbi, functionName: "trackedQuote" }),
    publicClient.readContract({ address: curve, abi: curveAbi, functionName: "graduated" }),
  ]);
  const trackedQuote = tracked as bigint;
  const progress =
    graduationThreshold > 0n
      ? Math.min(1, Number((trackedQuote * 10000n) / graduationThreshold) / 10000)
      : 0;
  return {
    token,
    curve,
    deployer,
    graduationThreshold,
    name: name as string,
    symbol: symbol as string,
    logo: logo as string,
    description: description as string,
    quoteReserve: (reserves as [bigint, bigint])[0],
    trackedQuote,
    graduated: graduated as boolean,
    progress,
  };
}

export function useLaunches() {
  const [rows, setRows] = useState<LaunchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const launches = getRegistry();
      const settled = await Promise.allSettled(
        launches.map((a) =>
          loadRow(a.token, a.curve, a.deployer, BigInt(a.graduationThreshold))
        )
      );
      const ok = settled
        .filter((s): s is PromiseFulfilledResult<LaunchRow> => s.status === "fulfilled")
        .map((s) => s.value);
      setRows(ok);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "failed to load launches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  return { rows, loading, error, refresh };
}
