"use client";

// What a wallet holds and can claim, read from the chain into one module-level
// store so the portfolio page and the nav read the same result without a second
// round of calls. Rules that must not be loosened: a balance that could not be
// read is listed as unreadable, never as zero; a holding without a price is listed
// with the reason, never valued at zero; previous data stays on screen while a
// refresh runs; a refresh that fails keeps the old data and says so.
import { useEffect, useSyncExternalStore } from "react";
import { formatUnits, type Address } from "viem";
import type { NetworkConfig } from "./networks";
import { poundVaultAbi } from "./pound";
import { publicClient, RADIAN, tokenAbi, curveAbi, escrowAbi, NATIVE_QUOTE, POUND, type LaunchRow } from "./radian";

export type Unpriced = "curve" | "graduated";
export type Holding = { row: LaunchRow; bal: bigint; spot: number | null; value: number | null; unpriced?: Unpriced };
export type Claim = { kind: "fees" | "referral"; asset: { symbol: string; decimals: number; address: Address }; amount: bigint; accrued?: bigint };
export type PortfolioState = {
  status: "idle" | "loading" | "error" | "ready";
  holdings: Holding[];
  claims: Claim[];
  /** launch tokens whose balance could not be read this round */
  unreadable: LaunchRow[];
  asOf: number | null;
};

const EMPTY: PortfolioState = { status: "idle", holdings: [], claims: [], unreadable: [], asOf: null };
const STALE_MS = 60_000;
const store = new Map<string, PortfolioState>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const keyOf = (address: string, net: NetworkConfig) => `${net.key}:${address.toLowerCase()}`;

export async function loadPortfolio(address: Address, rows: LaunchRow[], net: NetworkConfig, force = false): Promise<void> {
  const key = keyOf(address, net);
  const cur = store.get(key) ?? EMPTY;
  if (cur.status === "loading") return;
  if (!force && cur.asOf && Date.now() - cur.asOf < STALE_MS) return;
  store.set(key, { ...cur, status: "loading" });
  emit();
  try {
    // balances of every launch token; a failed read is listed, not zeroed
    const bals = rows.length
      ? await publicClient.multicall({ allowFailure: true, contracts: rows.map((r) => ({ address: r.token, abi: tokenAbi, functionName: "balanceOf" as const, args: [address] as const })) })
      : [];
    const unreadable: LaunchRow[] = [];
    const held: { row: LaunchRow; bal: bigint }[] = [];
    rows.forEach((row, i) => {
      const b = bals[i];
      if (!b || b.status !== "success") unreadable.push(row);
      else if ((b.result as bigint) > 0n) held.push({ row, bal: b.result as bigint });
    });
    const reserves = held.length
      ? await publicClient.multicall({ allowFailure: true, contracts: held.map((h) => ({ address: h.row.curve, abi: curveAbi, functionName: "getReserves" as const })) })
      : [];
    const holdings: Holding[] = held.map((h, i) => {
      const r = reserves[i]?.status === "success" ? (reserves[i].result as [bigint, bigint]) : null;
      if (h.row.graduated) return { ...h, spot: null, value: null, unpriced: "graduated" };
      if (!r || r[1] === 0n) return { ...h, spot: null, value: null, unpriced: "curve" };
      const spot = Number(formatUnits(r[0], h.row.quoteDecimals)) / Number(formatUnits(r[1], 18));
      return { ...h, spot, value: spot * Number(formatUnits(h.bal, 18)) };
    });

    // creator fees waiting in the escrow (the gas coin, then each ERC-20 quote)
    const gasSym = net.nativeSymbol ?? "USDC";
    const erc20 = net.quoteAssets.filter((q) => !q.native);
    const claims: Claim[] = [];
    try {
      const contracts = [
        { address: RADIAN.escrow, abi: escrowAbi, functionName: "balanceOf", args: [address] },
        ...erc20.map((q) => ({ address: RADIAN.escrow, abi: escrowAbi, functionName: "balanceOfToken", args: [address, q.address] })),
      ] as unknown as Parameters<typeof publicClient.multicall>[0]["contracts"];
      const res = await publicClient.multicall({ allowFailure: true, contracts });
      const nat = res[0]?.status === "success" ? (res[0].result as bigint) : 0n;
      if (nat > 0n) claims.push({ kind: "fees", asset: { symbol: gasSym, decimals: 18, address: NATIVE_QUOTE }, amount: nat });
      erc20.forEach((q, i) => {
        const v = res[i + 1]?.status === "success" ? (res[i + 1].result as bigint) : 0n;
        if (v > 0n) claims.push({ kind: "fees", asset: { symbol: q.symbol, decimals: q.decimals, address: q.address }, amount: v });
      });
    } catch {
      /* the escrow read failed: claims stay as they were */
    }
    // referral earnings in The Pound's vault
    const pound = POUND;
    if (pound) {
      const assets = [{ symbol: gasSym, decimals: 18, address: NATIVE_QUOTE }, ...erc20.map((q) => ({ symbol: q.symbol, decimals: q.decimals, address: q.address }))];
      try {
        const res = await publicClient.multicall({
          allowFailure: true,
          contracts: assets.map((a) => ({ address: pound.vault, abi: poundVaultAbi, functionName: "referralOf" as const, args: [a.address, address] as const })),
        });
        assets.forEach((a, i) => {
          const v = res[i]?.status === "success" ? (res[i].result as readonly [bigint, bigint]) : ([0n, 0n] as const);
          if (v[0] > 0n || v[1] > 0n) claims.push({ kind: "referral", asset: a, amount: v[0], accrued: v[1] });
        });
      } catch {
        /* same: keep what we had */
      }
    }
    store.set(key, { status: "ready", holdings, claims, unreadable, asOf: Date.now() });
  } catch {
    store.set(key, { ...(store.get(key) ?? EMPTY), status: "error" });
  }
  emit();
}

/** The wallet's portfolio on this network; loads when stale, keeps the last good read while reloading. */
export function usePortfolio(address: Address | undefined, rows: LaunchRow[], net: NetworkConfig): PortfolioState & { refresh: () => void } {
  const key = address ? keyOf(address, net) : null;
  const state = useSyncExternalStore(subscribe, () => (key ? (store.get(key) ?? EMPTY) : EMPTY), () => EMPTY);
  const rowsKey = rows.map((r) => r.token).join(",");
  useEffect(() => {
    if (!address || !net.live || rows.length === 0) return;
    void loadPortfolio(address, rows, net);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, rowsKey, net.key, net.live]);
  const refresh = () => {
    if (address) void loadPortfolio(address, rows, net, true);
  };
  return { ...state, refresh };
}

/** Value by quote symbol, largest first, from the priced holdings. */
export function totalsByQuote(holdings: Holding[]): [string, number][] {
  const m = new Map<string, number>();
  for (const h of holdings) if (h.value != null) m.set(h.row.quoteSymbol, (m.get(h.row.quoteSymbol) ?? 0) + h.value);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
