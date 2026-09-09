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
      let buyback = 0;
      let fees = 0;
      await Promise.all(
        reg.map(async (e) => {
          try {
            const [locked, fee] = await Promise.all([
              publicClient.readContract({
                address: RADIAN.vault,
                abi: vaultAbi,
                functionName: "totalLocked",
                args: [e.token],
              }),
              publicClient.readContract({
                address: e.curve,
                abi: curveStatsAbi,
                functionName: "quoteFeeBalance",
              }),
            ]);
            buyback += Number(formatUnits(locked as bigint, 18));
            fees += Number(formatUnits(fee as bigint, 18));
          } catch {}
        })
      );
      setExtra({ buybackLocked: buyback, pendingFees: fees });
    })();
  }, [rows.length]);

  return {
    launches: rows.length,
    graduated: rows.filter((r) => r.graduated).length,
    curveTvl: rows.reduce((s, r) => s + Number(formatUnits(r.trackedQuote, 18)), 0),
    buybackLocked: extra.buybackLocked,
    pendingFees: extra.pendingFees,
    loading,
    rows,
  };
}
