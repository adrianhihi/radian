"use client";
import Link from "next/link";
import { useState } from "react";
import { parseEther } from "viem";
import { Nav } from "@/components/Nav";
import { SoonBanner } from "@/components/SoonBanner";
import { useReveal } from "@/lib/useReveal";
import { useNetwork } from "@/lib/networks";
import { publicClient, arcTestnet, activeNetwork, explorer } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useFlywheel } from "@/lib/useFlywheel";
import { RADIAN_ADDR, stakingAbi, radianErc20Abi } from "@/lib/radianToken";
import { formatUnits } from "viem";
import { useIdentity } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout, usePendingResume } from "@/lib/pendingTx";
import { IdentityBanner, PendingBar } from "@/components/TrustBanners";

function Stat({ k, l, color }: { k: string; l: string; color?: string }) {
  return (
    <div className="stat reveal">
      <div className="k" style={{ color }}>{k}</div>
      <div className="l">{l}</div>
    </div>
  );
}

export default function EarnPage() {
  useReveal();
  const net = useNetwork();
  const { authenticated, login, address, getWalletClient } = useRadianWallet();
  const fw = useFlywheel(address);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const s = fw.stats;
  const identity = useIdentity();
  const [pendingHash, setPendingHash] = useState<`0x${string}` | null>(null);
  usePendingResume(["stake", "claim", "unstake"], (p) => {
    setPendingHash(null);
    setToast(`Your earlier ${p.kind} confirmed ✓`);
    fw.refresh();
  });

  async function withWallet(fn: (c: any, acct: `0x${string}`) => Promise<void>) {
    if (!authenticated) return login();
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) { setToast("Sign in again."); setBusy(false); return; }
      await fn(wc.client, wc.account);
      fw.refresh();
    } catch (e: any) {
      if (e instanceof ReceiptTimeout) {
        setPendingHash(e.hash);
        setToast("Submitted, but not confirmed yet. This page keeps checking and never resends.");
      } else {
        setToast(e?.shortMessage ?? e?.message ?? "Failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  const stake = () =>
    withWallet(async (client, acct) => {
      const amt = parseEther(amount || "0");
      if (amt <= 0n) return;
      setToast("Approve RADIAN…");
      const ah = await client.writeContract({ account: acct, chain: arcTestnet, address: RADIAN_ADDR.token, abi: radianErc20Abi, functionName: "approve", args: [RADIAN_ADDR.staking, amt] });
      await waitReceipt(ah, "approve");
      setToast("Confirm stake…");
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: RADIAN_ADDR.staking, abi: stakingAbi, functionName: "stake", args: [amt] });
      await waitReceipt(h, "stake");
      setToast("Staked ✓"); setAmount("");
    });

  const claim = () =>
    withWallet(async (client, acct) => {
      setToast("Claiming…");
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: RADIAN_ADDR.staking, abi: stakingAbi, functionName: "getReward" });
      await waitReceipt(h, "claim");
      setToast("Claimed USDC ✓");
    });

  const unstake = () =>
    withWallet(async (client, acct) => {
      if (fw.staked <= 0n) return;
      setToast("Unstaking…");
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: RADIAN_ADDR.staking, abi: stakingAbi, functionName: "withdraw", args: [fw.staked] });
      await waitReceipt(h, "unstake");
      setToast("Unstaked ✓");
    });

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 0" }}>
        <SoonBanner />
        {net.live && (
          <>
            <IdentityBanner identity={identity} />
            <PendingBar hash={pendingHash} onClose={() => setPendingHash(null)} />
            <div className="reveal" style={{ maxWidth: 640 }}>
              <span className="eyebrow">◆ $RADIAN — the protocol token</span>
              <h1 style={{ fontSize: 36, marginTop: 16 }}>Earn a share of every fee.</h1>
              <p style={{ color: "var(--fg-dim)", marginTop: 12, fontSize: 16 }}>
                Radian shares its real revenue with the people who hold it. Every fee the platform
                collects is split: part buys <strong>$RADIAN</strong> back and burns it, the rest is
                streamed to stakers as <strong>USDC</strong>. Stake $RADIAN, earn real dollars —
                funded by fees, never by inflation.
              </p>
            </div>

            {/* flywheel */}
            <div className="flywheel reveal">
              {[
                { t: "Platform fees", d: "1% of every trade + launch fees, across all tokens" },
                { t: "Treasury", d: `splits ${s ? (s.buybackBps / 100).toFixed(0) : "50"}% buyback / rest to stakers` },
                { t: "Buyback & burn", d: "buys $RADIAN on its curve, burns it — supply ↓" },
                { t: "Stakers earn USDC", d: "real yield, streamed over 7 days" },
              ].map((x, i) => (
                <div key={x.t} className="fw-node">
                  <div className="fw-i">{i + 1}</div>
                  <div className="fw-t">{x.t}</div>
                  <div className="fw-d">{x.d}</div>
                  {i < 3 && <span className="fw-arrow">→</span>}
                </div>
              ))}
            </div>

            <div className="stats" style={{ marginTop: 24 }}>
              <Stat k={s ? `${s.apr.toFixed(1)}%` : "—"} l="Staking APR" color="var(--up)" />
              <Stat k={s ? `$${s.stakedValueUsdc.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"} l="Total staked (value)" />
              <Stat k={s ? `${s.buybackBurned.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"} l="$RADIAN burned" color="var(--grad)" />
              <Stat k={s ? `$${s.distributedToStakers.toLocaleString(undefined, { maximumFractionDigits: 3 })}` : "—"} l="USDC to stakers" />
            </div>

            {/* stake panel */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, marginTop: 26, alignItems: "start" }} className="detail-grid">
              <div className="panel reveal">
                <h3 style={{ fontSize: 18, marginBottom: 12 }}>Your position</h3>
                <div className="kv"><span>Wallet $RADIAN</span><span className="v">{fw.balanceNum.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                <div className="kv"><span>Staked</span><span className="v">{fw.stakedNum.toLocaleString(undefined, { maximumFractionDigits: 0 })} RADIAN</span></div>
                <div className="kv"><span>Claimable (live)</span><span className="v" style={{ color: "var(--up)" }}>{fw.earnedNum.toLocaleString(undefined, { maximumFractionDigits: 8 })} USDC</span></div>
                <div className="kv" style={{ border: "none" }}><span>$RADIAN price</span><span className="v">{s ? s.radianPrice.toExponential(3) : "—"} USDC</span></div>
                <p className="hint" style={{ marginTop: 10 }}>
                  Don&apos;t have $RADIAN?{" "}
                  <Link href={`/token/${net.radian.token}`} style={{ color: "var(--radian-2)" }}>Buy it on its curve →</Link>
                </p>
              </div>

              <div className="panel reveal" style={{ position: "sticky", top: 84 }}>
                <div className="field">
                  <label>Stake $RADIAN</label>
                  <input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
                  {fw.balanceNum > 0 && (
                    <p className="hint" style={{ cursor: "pointer" }} onClick={() => setAmount(String(fw.balanceNum))}>
                      Balance: {fw.balanceNum.toLocaleString(undefined, { maximumFractionDigits: 0 })} — max
                    </p>
                  )}
                </div>
                <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={stake} disabled={busy}>
                  {busy ? <span className="spinner" /> : !authenticated ? "Sign in to stake" : "Stake"}
                </button>
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={claim} disabled={busy || fw.earned <= 0n}>Claim USDC</button>
                  <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={unstake} disabled={busy || fw.staked <= 0n}>Unstake all</button>
                </div>
                <p className="hint" style={{ textAlign: "center", marginTop: 10 }}>Rewards are real fees, paid in USDC.</p>
              </div>
            </div>

            {/* append-only treasury ledger: every claim and flush, straight from chain events */}
            <div className="panel reveal" style={{ marginTop: 24, overflowX: "auto" }}>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Treasury ledger</h3>
              <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
                Every fee claim and every flush the treasury has executed, decoded from its own events. Nothing here is
                estimated; each row links to its transaction.
              </p>
              {!s?.ledger?.length ? (
                <p className="hint">No entries indexed yet.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--fg-dim)" }}>
                      <th style={{ padding: "6px 8px" }}>When</th>
                      <th style={{ padding: "6px 8px" }}>Event</th>
                      <th style={{ padding: "6px 8px" }}>USDC in</th>
                      <th style={{ padding: "6px 8px" }}>$RADIAN burned</th>
                      <th style={{ padding: "6px 8px" }}>USDC to stakers</th>
                      <th style={{ padding: "6px 8px" }}>Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.ledger.map((r) => {
                      const n = (v?: string, d = 4) => (v == null ? "—" : Number(formatUnits(BigInt(v), 18)).toLocaleString(undefined, { maximumFractionDigits: d }));
                      return (
                        <tr key={`${r.txHash}-${r.kind}-${r.ts}`} style={{ borderTop: "1px solid var(--border-soft)" }}>
                          <td style={{ padding: "8px", whiteSpace: "nowrap" }}>{new Date(r.ts).toLocaleString()}</td>
                          <td style={{ padding: "8px" }}>{r.kind === "flush" ? "Flush (buyback + stream)" : r.kind === "claim" ? "Fees claimed" : "Token fees claimed"}</td>
                          <td style={{ padding: "8px" }}>{r.kind === "flush" ? n(r.usdcIn) : n(r.amount)}</td>
                          <td style={{ padding: "8px", color: "var(--grad)" }}>{r.kind === "flush" ? n(r.radianBurned, 0) : "—"}</td>
                          <td style={{ padding: "8px", color: "var(--up)" }}>{r.kind === "flush" ? n(r.toStakers) : "—"}</td>
                          <td style={{ padding: "8px" }}>
                            <a href={`${net.explorer}/tx/${r.txHash}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{r.txHash.slice(0, 10)}…</a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <p className="hint reveal" style={{ marginTop: 20, marginBottom: 60 }}>
              Contracts:{" "}
              {/* addresses from the SSR-safe network hook, not module-level config, so server and first client render agree */}
              <a href={`${net.explorer}/address/${net.radian.staking}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>staking</a>{" · "}
              <a href={`${net.explorer}/address/${net.radian.treasury}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>treasury</a>{" · "}
              <a href={`${net.explorer}/address/${net.radian.token}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>token</a>
            </p>
          </>
        )}
      </main>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}
