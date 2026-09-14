"use client";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { publicClient, arcTestnet, explorer, type QuoteAsset } from "@/lib/radian";
import { pofVaultAbi, pofRouterAbi, fmtAmount, fmtDuration } from "@/lib/templates";
import { useRadianWallet } from "@/lib/useRadianWallet";
import type { IdentityResult } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout } from "@/lib/pendingTx";

// Proof-of-Fee: creator fees buy the token back; each round's buyback is paid
// to the traders whose fees funded it, by share of quote spent through the
// official PoF router ("Work"). Rounds settle lazily after they end (any
// router buy or keeper buyback settles them), so a round can be over and
// still "awaiting settlement".

const MAX_CLAIM = 100; // rounds per claim() call
const SCAN_ROUNDS = 300; // most recent active rounds we look at per refresh

type Props = {
  token: Address;
  symbol: string;
  vault: Address;
  pofRouter: Address;
  quote: QuoteAsset;
  identity: IdentityResult;
  onToast: (m: string) => void;
  onPending: (h: `0x${string}`) => void;
  refreshKey: number;
};

type Data = Partial<{
  currentRound: bigint; launchedAt: bigint; config: readonly [bigint, number, number, number];
  unallocated: bigint; totalBought: bigint; totalPaid: bigint; plannedSpend: bigint;
  myWork: bigint; roundWork: bigint;
  claimable: bigint[]; // settled rounds with my Work, not yet claimed
  awaiting: number; // ended rounds with my Work, not yet settled
  pending: bigint; // vault.pendingOf over `claimable` (first MAX_CLAIM)
}>;

export function PoFPanel({ token, symbol, vault, pofRouter, quote, identity, onToast, onPending, refreshKey }: Props) {
  const { authenticated, login, address: account, getWalletClient } = useRadianWallet();
  const [d, setD] = useState<Data>({});
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const who = account ?? ("0x0000000000000000000000000000000000000000" as Address);
    try {
      const head = await publicClient.multicall({
        allowFailure: true,
        contracts: [
          { address: vault, abi: pofVaultAbi, functionName: "currentRound" },
          { address: vault, abi: pofVaultAbi, functionName: "launchedAt" },
          { address: vault, abi: pofVaultAbi, functionName: "config" },
          { address: vault, abi: pofVaultAbi, functionName: "unallocated" },
          { address: vault, abi: pofVaultAbi, functionName: "totalBought" },
          { address: vault, abi: pofVaultAbi, functionName: "totalPaid" },
          { address: vault, abi: pofVaultAbi, functionName: "plannedSpend" },
          { address: pofRouter, abi: pofRouterAbi, functionName: "activeRoundCount", args: [token] },
        ],
      });
      const g = <T,>(i: number) => (head[i].status === "success" ? (head[i].result as T) : undefined);
      const next: Data = {
        currentRound: g<bigint>(0), launchedAt: g<bigint>(1), config: g<Data["config"]>(2),
        unallocated: g<bigint>(3), totalBought: g<bigint>(4), totalPaid: g<bigint>(5), plannedSpend: g<bigint>(6),
      };
      const cur = next.currentRound;
      const count = g<bigint>(7);
      if (cur !== undefined) {
        const work = await publicClient.multicall({
          allowFailure: true,
          contracts: [
            { address: pofRouter, abi: pofRouterAbi, functionName: "workOf", args: [token, cur, who] },
            { address: pofRouter, abi: pofRouterAbi, functionName: "totalWork", args: [token, cur] },
          ],
        });
        next.myWork = account && work[0].status === "success" ? (work[0].result as bigint) : undefined;
        next.roundWork = work[1].status === "success" ? (work[1].result as bigint) : undefined;
      }
      if (account && cur !== undefined && count !== undefined && count > 0n) {
        // Newest SCAN_ROUNDS active rounds → which ended ones hold unclaimed Work of mine.
        const n = Number(count);
        const from = Math.max(0, n - SCAN_ROUNDS);
        const idx = Array.from({ length: n - from }, (_, i) => BigInt(from + i));
        const rs = await publicClient.multicall({
          allowFailure: true,
          contracts: idx.map((i) => ({ address: pofRouter, abi: pofRouterAbi, functionName: "activeRoundAt", args: [token, i] })),
        });
        const rounds = rs.flatMap((r) => (r.status === "success" ? [r.result as bigint] : [])).filter((r) => r < cur);
        if (rounds.length > 0) {
          const st = await publicClient.multicall({
            allowFailure: true,
            contracts: rounds.flatMap((r) => [
              { address: vault, abi: pofVaultAbi, functionName: "settled", args: [r] } as const,
              { address: vault, abi: pofVaultAbi, functionName: "claimed", args: [r, account] } as const,
              { address: pofRouter, abi: pofRouterAbi, functionName: "workOf", args: [token, r, account] } as const,
            ]),
          });
          const claimable: bigint[] = [];
          let awaiting = 0;
          rounds.forEach((r, i) => {
            const settled = st[i * 3].result as boolean | undefined;
            const claimed = st[i * 3 + 1].result as boolean | undefined;
            const w = st[i * 3 + 2].result as bigint | undefined;
            if (!w || w === 0n || claimed) return;
            if (settled) claimable.push(r);
            else awaiting++;
          });
          next.claimable = claimable;
          next.awaiting = awaiting;
          if (claimable.length > 0) {
            try {
              next.pending = (await publicClient.readContract({
                address: vault, abi: pofVaultAbi, functionName: "pendingOf", args: [account, claimable.slice(0, MAX_CLAIM)],
              })) as bigint;
            } catch {}
          } else next.pending = 0n;
        } else {
          next.claimable = [];
          next.awaiting = 0;
          next.pending = 0n;
        }
      }
      setD(next);
    } catch {}
  }, [vault, pofRouter, token, account]);

  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [load, refreshKey]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  async function claim() {
    if (!authenticated) return login();
    if (identity.checked && !identity.ok) return onToast("Disabled: a platform contract's live code does not match its pinned hash.");
    const rounds = (d.claimable ?? []).slice(0, MAX_CLAIM);
    if (rounds.length === 0) return;
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) return onToast("No wallet available. Sign in again.");
      onToast(`Confirm the claim for ${rounds.length} round${rounds.length === 1 ? "" : "s"}…`);
      const h = await wc.client.writeContract({
        account: wc.account, chain: arcTestnet, address: vault, abi: pofVaultAbi, functionName: "claim", args: [rounds],
      });
      await waitReceipt(h, "claim", { token, what: "pof" });
      onToast(`Claimed ${symbol} ✓`);
      await load();
    } catch (e: any) {
      if (e instanceof ReceiptTimeout) {
        onPending(e.hash);
        onToast("Submitted, but not confirmed yet. This page keeps checking and never resends.");
      } else onToast(e?.shortMessage ?? e?.message ?? "Claim failed.");
    } finally {
      setBusy(false);
    }
  }

  const cfg = d.config;
  const roundSecs = cfg ? Number(cfg[1]) : undefined;
  const endsIn =
    d.currentRound !== undefined && d.launchedAt !== undefined && roundSecs && now > 0
      ? Number(d.launchedAt) + (Number(d.currentRound) + 1) * roundSecs - now
      : undefined;
  const q = (v?: bigint, digits = 4) => `${fmtAmount(v, quote.decimals, digits)} ${quote.symbol}`;
  const claimableN = d.claimable?.length;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="prog-row" style={{ marginBottom: 6 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--fg)" }}>Proof-of-Fee rewards</span>
        <a href={explorer.address(vault)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--radian-2)" }}>
          vault {vault.slice(0, 8)}…{vault.slice(-6)}
        </a>
      </div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        Creator fees buy {symbol} back on its curve. Each round&apos;s buyback goes to the traders whose fees funded it, by share of {quote.symbol} spent
        through the official PoF router — buys on this page use it. Direct curve buys and sells earn no Work. Nothing is minted.
      </p>

      <div className="kv"><span>Round</span><span className="v">{d.currentRound === undefined ? "—" : `#${d.currentRound.toString()}`}{roundSecs ? ` · ${fmtDuration(roundSecs)} each` : ""}</span></div>
      <div className="kv"><span>Round ends in</span><span className="v">{endsIn === undefined ? "—" : fmtDuration(Math.max(0, endsIn))}</span></div>
      <div className="kv"><span>Your Work this round</span><span className="v">{account ? q(d.myWork) : "sign in"}</span></div>
      <div className="kv"><span>Round total</span><span className="v">{q(d.roundWork)}{cfg ? ` (target ${fmtAmount(cfg[0], quote.decimals)} ${quote.symbol})` : ""}</span></div>

      <div style={{ borderTop: "1px solid var(--border-soft)", margin: "10px 0" }} />
      <div className="kv"><span>Bought back, lifetime</span><span className="v">{fmtAmount(d.totalBought, 18, 0)} {symbol}</span></div>
      <div className="kv"><span>Paid out, lifetime</span><span className="v">{fmtAmount(d.totalPaid, 18, 0)} {symbol}</span></div>
      <div className="kv"><span>Unallocated (pool for coming rounds)</span><span className="v">{fmtAmount(d.unallocated, 18, 0)} {symbol}</span></div>
      <div className="kv"><span>Next buyback would spend</span><span className="v">{q(d.plannedSpend)}</span></div>
      <div className="kv" style={{ fontSize: 12.5 }}>
        <span>Config</span>
        <span className="v" style={{ fontWeight: 500, textAlign: "right" }}>
          {cfg ? `round ${fmtDuration(Number(cfg[1]))} · target ${fmtAmount(cfg[0], quote.decimals)} ${quote.symbol} · buyback ≤ ${(Number(cfg[3]) / 100).toFixed(1)}% of reserve · every ≥ ${fmtDuration(Number(cfg[2]))}` : "—"}
        </span>
      </div>

      <div style={{ borderTop: "1px solid var(--border-soft)", margin: "10px 0" }} />
      {account ? (
        <>
          <div className="kv"><span>Settled rounds you can claim</span><span className="v">{claimableN === undefined ? "—" : claimableN}</span></div>
          <div className="kv"><span>Claimable now</span><span className="v" style={{ color: "var(--up)" }}>{fmtAmount(d.pending, 18, 2)} {symbol}</span></div>
          {!!d.awaiting && (
            <p className="hint">
              {d.awaiting} ended round{d.awaiting === 1 ? "" : "s"} with your Work still await settlement — the next router buy or keeper buyback settles them.
            </p>
          )}
          {claimableN !== undefined && claimableN > 0 && (
            <p className="hint" style={{ marginTop: 4 }}>
              Rounds: {d.claimable!.slice(0, 12).map((r) => `#${r}`).join(", ")}{claimableN > 12 ? ` … (+${claimableN - 12})` : ""}
              {claimableN > MAX_CLAIM ? ` — ${MAX_CLAIM} per claim.` : ""}
            </p>
          )}
        </>
      ) : (
        <p className="hint">Sign in to see your Work and claimable rounds.</p>
      )}
      <button
        className="btn btn-primary"
        style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
        onClick={claim}
        disabled={busy || (identity.checked && !identity.ok) || (authenticated && !(claimableN && d.pending && d.pending > 0n))}
      >
        {busy ? <span className="spinner" /> : !authenticated ? "Sign in to claim" : claimableN ? `Claim ${Math.min(claimableN, MAX_CLAIM)} round${claimableN === 1 ? "" : "s"}` : "Nothing to claim yet"}
      </button>
    </div>
  );
}
