"use client";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { publicClient, RADIAN, vaultAbi, curveStatsAbi } from "./radian";
import { getRegistry } from "./registry";
import { useLaunches } from "./useLaunches";

import type { LaunchRow } from "./radian";

export type Stats = {
  launches: number;
  graduated: number;
  curveTvl: number; // USDC across all live curves
  buybackLocked: number; // USDC-equiv tokens locked in the 5y vault (token units)
  pendingFees: number; // USDC pending in curve fee balances
  loading: boolean;
  rows: LaunchRow[];
};

export function useStats(): Stats {
  const { rows, loading } = useLaunches();
  const [extra, setExtra] = useState({ buybackLocked: 0, pendingFees: 0 });

  useEffect(() => {
    (async () => {
      const reg = getRegistry();
      if (reg.length === 0) return;
      const contracts = reg.flatMap((e) => [
        { address: RADIAN.vault, abi: vaultAbi, functionName: "totalLocked", args: [e.token] } as const,
        { address: e.curve, abi: curveStatsAbi, functionName: "quoteFeeBalance" } as const,
      ]);
      try {
        const res = await publicClient.multicall({ contracts, allowFailure: true });
        let buyback = 0;
        let fees = 0;
        reg.forEach((_, i) => {
          const locked = res[i * 2].result as bigint | undefined;
          const fee = res[i * 2 + 1].result as bigint | undefined;
          if (locked) buyback += Number(formatUnits(locked, 18));
          if (fee) fees += Number(formatUnits(fee, 18));
        });
        setExtra({ buybackLocked: buyback, pendingFees: fees });
      } catch {}
    })();
  }, [rows.length]);

  return {
    launches: rows.length,
    graduated: rows.filter((r) => r.graduated).length,
    // Native-USDC curves only — EURC (6-dec) and stock stand-ins (shares) are other units.
    curveTvl: rows
      .filter((r) => r.pairToken === "0x0000000000000000000000000000000000000000")
      .reduce((s, r) => s + Number(formatUnits(r.trackedQuote, 18)), 0),
    buybackLocked: extra.buybackLocked,
    pendingFees: extra.pendingFees,
    loading,
    rows,
  };
}
