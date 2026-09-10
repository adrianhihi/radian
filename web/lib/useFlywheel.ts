"use client";
import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { publicClient, activeNetwork } from "./radian";
import { INDEXER_URL, hasIndexer } from "./indexer";
import { RADIAN_ADDR, stakingAbi, radianErc20Abi, type FlywheelStats } from "./radianToken";

export function useFlywheel(account?: Address) {
  const [stats, setStats] = useState<FlywheelStats | null>(null);
  const [staked, setStaked] = useState(0n);
  const [earned, setEarned] = useState(0n);
  const [balance, setBalance] = useState(0n);

  const refreshStats = useCallback(async () => {
    if (!activeNetwork.live) return;
    try {
      if (hasIndexer()) {
        const r = await fetch(`${INDEXER_URL}/radian`, { cache: "no-store" });
        if (r.ok) {
          setStats(await r.json());
          return;
        }
      }
    } catch {}
  }, []);

  const refreshUser = useCallback(async () => {
    if (!account || !activeNetwork.live) return;
    try {
      const [s, e, b] = await publicClient.multicall({
        allowFailure: true,
        contracts: [
          { address: RADIAN_ADDR.staking, abi: stakingAbi, functionName: "stakedOf", args: [account] },
          { address: RADIAN_ADDR.staking, abi: stakingAbi, functionName: "earned", args: [account] },
          { address: RADIAN_ADDR.token, abi: radianErc20Abi, functionName: "balanceOf", args: [account] },
        ],
      });
      setStaked((s.result as bigint) ?? 0n);
      setEarned((e.result as bigint) ?? 0n);
      setBalance((b.result as bigint) ?? 0n);
    } catch {}
  }, [account]);

  useEffect(() => {
    refreshStats();
    const t = setInterval(refreshStats, 12000);
    return () => clearInterval(t);
  }, [refreshStats]);

  useEffect(() => {
    refreshUser();
    // earned accrues per second — poll faster so the number ticks up live
    const t = setInterval(refreshUser, 5000);
    return () => clearInterval(t);
  }, [refreshUser]);

  return {
    stats,
    staked,
    earned,
    balance,
    stakedNum: Number(formatUnits(staked, 18)),
    earnedNum: Number(formatUnits(earned, 18)),
    balanceNum: Number(formatUnits(balance, 18)),
    refresh: () => {
      refreshStats();
      refreshUser();
    },
  };
}
