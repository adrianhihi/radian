"use client";
import { useEffect, useState } from "react";
import { keccak256, type Address, type Hex } from "viem";
import { publicClient, activeNetwork } from "./radian";

// Contract identity pinning. Each deployed platform contract's runtime code
// hash is recorded at deploy time (networks.ts `codeHashes`). Before the site
// lets anyone launch or trade, it re-hashes the live code and compares. A
// spoofed RPC or a swapped contract can fake every getter, but not its code.
// Only a PROVEN mismatch blocks: an RPC failure leaves the check "unverified"
// (shown, not blocking), so a flaky node can't take the product down.

const ZERO = "0x0000000000000000000000000000000000000000";

export type IdentityEntry = { name: string; address: Address; expected: Hex };
export type IdentityCheck = IdentityEntry & { actual: Hex | null; ok: boolean };
export type IdentityResult = {
  checked: boolean; // false = nothing pinned or the RPC read failed
  ok: boolean; // false only on a proven mismatch
  results: IdentityCheck[];
  error?: string;
};

export function pinnedContracts(): IdentityEntry[] {
  const c = activeNetwork.contracts;
  const r = activeNetwork.radian;
  const h = activeNetwork.codeHashes ?? {};
  const out: IdentityEntry[] = [];
  const pin = (name: string, address: Address | undefined, key: keyof typeof h) => {
    const expected = h[key];
    if (expected && address && address !== ZERO) out.push({ name, address, expected });
  };
  pin("PonsV2LaunchFactory", c.factory, "factory");
  pin("PonsV2MemeHook", c.hook, "hook");
  pin("RadianLaunchRouter", c.router, "router");
  pin("PonsV2FeeEscrow", c.escrow, "escrow");
  pin("PonsV2BuybackVault", c.vault, "vault");
  pin("PonsV2LaunchLocker", c.locker, "locker");
  pin("Uniswap V4 PoolManager", c.poolManager, "poolManager");
  pin("RadianStaking", r.staking, "staking");
  pin("RadianTreasury", r.treasury, "treasury");
  pin("PoFRouter", c.pofRouter, "pofRouter");
  pin("RadianExecutor", c.executor, "executor");
  // Per-launch template contracts are EIP-1167 clones of these; a clone's own
  // code is the 45-byte proxy, so the implementation is what gets pinned.
  pin("WallTreasury (implementation)", c.wallTreasuryImpl, "wallTreasuryImpl");
  pin("WallStaking (implementation)", c.wallStakingImpl, "wallStakingImpl");
  pin("PoFVault (implementation)", c.pofVaultImpl, "pofVaultImpl");
  pin("WallLadder (implementation)", c.wallLadderImpl, "wallLadderImpl");
  return out;
}

const UNVERIFIED: IdentityResult = { checked: false, ok: true, results: [] };
let cached: Promise<IdentityResult> | null = null;

export function verifyIdentity(force = false): Promise<IdentityResult> {
  if (cached && !force) return cached;
  const p = (async (): Promise<IdentityResult> => {
    const list = pinnedContracts();
    if (list.length === 0) return UNVERIFIED;
    try {
      const codes = await Promise.all(list.map((e) => publicClient.getCode({ address: e.address })));
      const results: IdentityCheck[] = list.map((e, i) => {
        const code = codes[i];
        const actual = code && code !== "0x" ? keccak256(code) : null;
        return { ...e, actual, ok: actual === e.expected };
      });
      return { checked: true, ok: results.every((x) => x.ok), results };
    } catch (e: any) {
      cached = null; // retry on the next call
      return { ...UNVERIFIED, error: e?.shortMessage ?? e?.message ?? "RPC error" };
    }
  })();
  cached = p;
  return p;
}

export function useIdentity(): IdentityResult {
  const [res, setRes] = useState<IdentityResult>(UNVERIFIED);
  useEffect(() => {
    let alive = true;
    verifyIdentity().then((r) => alive && setRes(r));
    return () => {
      alive = false;
    };
  }, []);
  return res;
}
