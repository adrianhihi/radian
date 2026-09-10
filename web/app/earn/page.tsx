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

  async function withWallet(fn: (c: any, acct: `0x${string}`) => Promise<void>) {
    if (!authenticated) return login();
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) { setToast("Sign in again."); setBusy(false); return; }
      await fn(wc.client, wc.account);
      fw.refresh();
    } catch (e: any) {
      setToast(e?.shortMessage ?? e?.message ?? "Failed.");
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
      await publicClient.waitForTransactionReceipt({ hash: ah });
      setToast("Confirm stake…");
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: RADIAN_ADDR.staking, abi: stakingAbi, functionName: "stake", args: [amt] });
      await publicClient.waitForTransactionReceipt({ hash: h });
      setToast("Staked ✓"); setAmount("");
    });

  const claim = () =>
    withWallet(async (client, acct) => {
      setToast("Claiming…");
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: RADIAN_ADDR.staking, abi: stakingAbi, functionName: "getReward" });
      await publicClient.waitForTransactionReceipt({ hash: h });
      setToast("Claimed USDC ✓");
    });

  const unstake = () =>
    withWallet(async (client, acct) => {
      if (fw.staked <= 0n) return;
      setToast("Unstaking…");
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: RADIAN_ADDR.staking, abi: stakingAbi, functionName: "withdraw", args: [fw.staked] });
      await publicClient.waitForTransactionReceipt({ hash: h });
      setToast("Unstaked ✓");
    });

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 0" }}>
        <SoonBanner />
        {net.live && (
          <>
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
