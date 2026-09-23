"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import type { NetworkConfig } from "@/lib/networks";
import { publicClient, arcTestnet, QUOTE_ASSETS, NATIVE_QUOTE } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useIdentity } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout, usePendingResume } from "@/lib/pendingTx";
import { IdentityBanner, PendingBar } from "@/components/TrustBanners";
import { poundVaultAbi, fetchPound, fetchReferral, type PoundView, type ReferralView } from "@/lib/pound";
import { referralLink } from "@/lib/referral";

// /earn on a network that runs The Pound. Two things a person can do here:
// share a referral link (5.55% of every fee their referrals pay, forever, per
// quote asset) and claim what it has accrued; and watch the Pack — the burn
// pool every settlement feeds and the coins it buys and burns in rotation.
// Every number is read from the vault/burner or decoded from their events.

const ZERO = "0x0000000000000000000000000000000000000000";
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const fmt = (v: string | bigint | undefined, dec: number, max = 4) =>
  v === undefined ? "—" : Number(formatUnits(typeof v === "string" ? BigInt(v) : v, dec)).toLocaleString(undefined, { maximumFractionDigits: max });
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
const ago = (unix: number, now: number) => {
  if (!unix) return "never";
  const s = Math.max(0, now - unix);
  return s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};

function Stat({ k, l, color }: { k: string; l: string; color?: string }) {
  return (
    <div className="stat reveal">
      <div className="k" style={{ color }}>{k}</div>
      <div className="l">{l}</div>
    </div>
  );
}

// `net` comes from the page's own SSR-safe network hook: a child hook would start on the
// default network for its first render (no `pound` there) and crash before syncing.
export function PoundEarn({ net }: { net: NetworkConfig }) {
  const pound = net.pound!;
  const { authenticated, login, address, getWalletClient } = useRadianWallet();
  const identity = useIdentity();
  const [view, setView] = useState<PoundView | null>(null);
  const [mine, setMine] = useState<ReferralView | null>(null);
  const [live, setLive] = useState<Record<string, { claimable: bigint; accrued: bigint }>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(0);
  const [pendingHash, setPendingHash] = useState<`0x${string}` | null>(null);

  const gasSym = net.nativeSymbol ?? "USDC";
  const assetMeta = (asset: string) => {
    const a = asset.toLowerCase();
    if (a === ZERO) return { symbol: gasSym, decimals: 18 };
    const q = QUOTE_ASSETS.find((x) => x.address.toLowerCase() === a);
    return q ? { symbol: q.symbol, decimals: q.decimals } : { symbol: "TOKEN", decimals: 18 };
  };

  const refresh = useCallback(async () => {
    try { setView(await fetchPound()); } catch {}
    if (address) {
      try { setMine(await fetchReferral(address)); } catch {}
      // live claimable/accrued straight from the vault, for every quote asset this network lists
      const assets: Address[] = [NATIVE_QUOTE, ...QUOTE_ASSETS.filter((q) => !q.native).map((q) => q.address)];
      try {
        const r = await publicClient.multicall({
          allowFailure: true,
          contracts: assets.map((a) => ({ address: pound.vault, abi: poundVaultAbi, functionName: "referralOf" as const, args: [a, address] })),
        });
        const next: Record<string, { claimable: bigint; accrued: bigint }> = {};
        assets.forEach((a, i) => {
          const v = r[i].status === "success" ? (r[i].result as readonly [bigint, bigint]) : ([0n, 0n] as const);
          next[a.toLowerCase()] = { claimable: v[0], accrued: v[1] };
        });
        setLive(next);
      } catch {}
    }
  }, [address, pound.vault]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(t);
  }, []);
  usePendingResume(["claim"], () => {
    setPendingHash(null);
    setToast("Your earlier claim confirmed ✓");
    refresh();
  });

  async function claim(asset: Address) {
    if (!authenticated) return login();
    if (identity.checked && !identity.ok) return setToast("Contract identity check failed on this network; not sending.");
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) throw new Error("Sign in again.");
      setToast("Confirm the claim in your wallet…");
      const hash = await wc.client.writeContract({
        account: wc.account, chain: arcTestnet, address: pound.vault, abi: poundVaultAbi, functionName: "claimReferral", args: [asset],
      });
      await waitReceipt(hash, "claim");
      setToast("Claimed ✓");
      await refresh();
    } catch (e: any) {
      if (e instanceof ReceiptTimeout) {
        setPendingHash(e.hash);
        setToast("Submitted, but not confirmed yet. This page keeps checking and never resends.");
      } else setToast(e?.shortMessage ?? e?.message ?? "Failed.");
    } finally {
      setBusy(false);
    }
  }

  const link = address ? referralLink(address) : null;
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setToast(link); }
  };

  const burnShare = view ? view.vault.burnShareBps : 7000;
  const refBps = view ? view.vault.referralBps : 555;
  const totalBurnedRows = (view?.assets ?? []).filter((a) => BigInt(a.burnSpent) > 0n || BigInt(a.burnPool) > 0n);
  const nextBurnIn = view ? Math.max(0, view.burner.lastBurnAt + view.burner.minInterval - now) : 0;
  const myRows = Object.entries(live).filter(([, v]) => v.accrued > 0n || v.claimable > 0n);

  return (
    <>
      <IdentityBanner identity={identity} />
      <PendingBar hash={pendingHash} onClose={() => setPendingHash(null)} />
      <div className="reveal" style={{ maxWidth: 680 }}>
        <span className="eyebrow">◆ The Pound — referrals and the Pack</span>
        <h1 style={{ fontSize: 36, marginTop: 16 }}>Every fee feeds the Pack.</h1>
        <p style={{ color: "var(--fg-dim)", marginTop: 12, fontSize: 16 }}>
          Every trade on {net.label} pays a 1% fee. Half of it is the protocol share, and that half is split by a contract, not a
          promise: <strong>{pct(refBps)}</strong> of the whole fee goes to whoever referred the buyer, the same again to whoever
          referred the token&apos;s creator, and <strong>{pct(burnShare)}</strong> of what is left buys coins from the Pack and burns
          them. Nothing is minted. Nobody gets paid before the fees exist.
        </p>
      </div>

      <div className="flywheel reveal">
        {[
          { t: "Trade fee", d: "1% of every buy and sell, on every token" },
          { t: "Referrals first", d: `${pct(refBps)} to the buyer's referrer, ${pct(refBps)} to the launcher's referrer` },
          { t: "Pack burn", d: `${pct(burnShare)} of the rest buys the next Pack coin and sends it to 0x…dEaD` },
          { t: "Treasury", d: "the remainder funds operations and future Pack additions" },
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
        <Stat k={view ? String(view.packs.filter((p) => p.active).length) : "—"} l="Coins in the Pack" />
        <Stat
          k={totalBurnedRows.length ? totalBurnedRows.map((a) => `${fmt(a.burnSpent, a.decimals, 2)} ${a.symbol}`).join(" · ") : view ? "0" : "—"}
          l="Spent on burns"
          color="var(--grad)"
        />
        <Stat
          k={view ? view.assets.filter((a) => BigInt(a.burnPool) > 0n).map((a) => `${fmt(a.burnPool, a.decimals, 2)} ${a.symbol}`).join(" · ") || "0" : "—"}
          l="Burn pool waiting"
        />
        <Stat
          k={
            view
              ? view.assets
                  .filter((a) => BigInt(a.totalReferrals) + BigInt(a.totalPending) > 0n)
                  // all-time referral earnings = still outstanding (totalPending) + already paid out (totalReferrals)
                  .map((a) => `${fmt(BigInt(a.totalReferrals) + BigInt(a.totalPending), a.decimals, 2)} ${a.symbol}`)
                  .join(" · ") || "0"
              : "—"
          }
          l="Earned by referrers"
          color="var(--up)"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24, marginTop: 26, alignItems: "start" }} className="detail-grid">
        {/* the Pack */}
        <div className="panel reveal" style={{ overflowX: "auto" }}>
          <h3 style={{ fontSize: 18, marginBottom: 6 }}>The Pack</h3>
          <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
            Coins native to this chain with a Uniswap V4 pool, curated by the Safe. Burns rotate through the list; each burn is at
            least the floor, at most the cap, and must fill within {view ? pct(view.burner.maxSlippageBps) : "—"} of the pool&apos;s
            spot price or it reverts. {view && view.burner.lastBurnAt > 0 ? `Last burn ${ago(view.burner.lastBurnAt, now)}.` : "No burn yet."}{" "}
            {view && view.burner.nextPack != null && nextBurnIn > 0 ? `Next allowed in ${Math.ceil(nextBurnIn / 3600)} h.` : ""}
          </p>
          {!view ? (
            <p className="hint">Reading the burner…</p>
          ) : view.packs.length === 0 ? (
            <p className="hint">The Pack is empty. The burn pool keeps accruing; the first coins are added by the Safe.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--fg-dim)" }}>
                  <th style={{ padding: "6px 8px" }}>#</th>
                  <th style={{ padding: "6px 8px" }}>Coin</th>
                  <th style={{ padding: "6px 8px" }}>Per burn</th>
                  <th style={{ padding: "6px 8px" }}>Burned so far</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {view.packs.map((p) => {
                  const am = assetMeta(p.asset);
                  const next = view.burner.nextPack === p.index;
                  return (
                    <tr key={p.index} style={{ borderTop: "1px solid var(--border-soft)" }}>
                      <td style={{ padding: "8px" }}>{p.index}</td>
                      <td style={{ padding: "8px" }}>
                        <a href={`${net.explorer}/address/${p.token}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)", fontWeight: 600 }}>{p.symbol ?? short(p.token)}</a>
                        <span className="hint" style={{ marginLeft: 6 }}>pool fee {(p.poolFee / 10000).toFixed(2)}%</span>
                      </td>
                      <td style={{ padding: "8px", whiteSpace: "nowrap" }}>{fmt(p.floor, am.decimals, 4)} – {fmt(p.maxPerBurn, am.decimals, 4)} {am.symbol}</td>
                      <td style={{ padding: "8px", color: "var(--grad)" }}>{fmt(p.burned, 18, 0)}</td>
                      <td style={{ padding: "8px" }}>{!p.active ? "paused" : next ? "next in rotation" : "active"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* your referral link + claims */}
        <div className="panel reveal" style={{ position: "sticky", top: 84 }}>
          <h3 style={{ fontSize: 18, marginBottom: 6 }}>Your referral link</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Anyone who trades through your link pays you {pct(refBps)} of every fee, on every token, for as long as they trade. Launch a
            token through it and you earn on the creator&apos;s side too. Paid in the token&apos;s quote asset; claim any time.
          </p>
          {!authenticated ? (
            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 12 }} onClick={login}>Sign in to get your link</button>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <input className="input" readOnly value={link ?? ""} style={{ flex: 1, fontSize: 12.5 }} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn btn-ghost" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
              </div>
              <div style={{ marginTop: 14 }}>
                {myRows.length === 0 ? (
                  <p className="hint">Nothing accrued yet. Share the link; every fee your referrals pay shows up here.</p>
                ) : (
                  myRows.map(([asset, v]) => {
                    const m = assetMeta(asset);
                    return (
                      <div key={asset} className="kv" style={{ alignItems: "center" }}>
                        <span>
                          <strong>{fmt(v.claimable, m.decimals, 6)} {m.symbol}</strong> claimable
                          <span className="hint" style={{ marginLeft: 6 }}>{fmt(v.accrued, m.decimals, 6)} earned all-time</span>
                        </span>
                        <button className="btn btn-ghost" style={{ padding: "6px 12px" }} disabled={busy || v.claimable === 0n} onClick={() => claim(asset as Address)}>
                          {busy ? <span className="spinner" /> : "Claim"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              {mine && mine.assets.some((a) => a.trades > 0) && (
                <p className="hint" style={{ marginTop: 8 }}>
                  {mine.assets.reduce((n, a) => n + a.trades, 0)} referred trades indexed. Accrued fees become claimable after the vault&apos;s
                  next settlement (the keeper settles hourly).
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ledger */}
      <div className="panel reveal" style={{ marginTop: 24, overflowX: "auto" }}>
        <h3 style={{ fontSize: 18, marginBottom: 6 }}>Pound ledger</h3>
        <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
          Every settlement, burn and referral claim, decoded from the vault&apos;s and burner&apos;s own events. Nothing here is
          estimated; each row links to its transaction.
        </p>
        {!view?.ledger?.length ? (
          <p className="hint">No entries indexed yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--fg-dim)" }}>
                <th style={{ padding: "6px 8px" }}>When</th>
                <th style={{ padding: "6px 8px" }}>Event</th>
                <th style={{ padding: "6px 8px" }}>Amounts</th>
                <th style={{ padding: "6px 8px" }}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {view.ledger.slice(0, 40).map((r) => {
                const m = assetMeta(r.asset ?? ZERO);
                const pack = r.token ? view.packs.find((p) => p.token.toLowerCase() === r.token!.toLowerCase()) : undefined;
                const what =
                  r.kind === "settle" ? "Settled" : r.kind === "burn" ? `Burned ${pack?.symbol ?? short(r.token)}` : r.kind === "referralClaim" ? "Referral claimed" : r.kind === "packAdded" ? `Pack: added ${pack?.symbol ?? short(r.token)}` : r.kind === "packSet" ? `Pack #${r.index} updated` : r.kind;
                const amounts =
                  r.kind === "settle"
                    ? `${fmt(r.intake, m.decimals)} ${m.symbol} in → ${fmt(r.toReferrals, m.decimals)} referrals · ${fmt(r.toBurn, m.decimals)} burn pool · ${fmt(r.toTreasury, m.decimals)} treasury`
                    : r.kind === "burn"
                      ? `${fmt(r.quoteIn, m.decimals)} ${m.symbol} → ${fmt(r.tokensOut, 18, 0)} ${pack?.symbol ?? "tokens"} to 0x…dEaD · bounty ${fmt(r.bounty, m.decimals, 6)}`
                      : r.kind === "referralClaim"
                        ? `${fmt(r.amount, m.decimals, 6)} ${m.symbol} to ${short(r.referrer)}`
                        : r.kind === "packAdded" || r.kind === "packSet"
                          ? `floor ${fmt(r.floor, m.decimals)} · cap ${fmt(r.maxPerBurn, m.decimals)} ${m.symbol}${r.kind === "packSet" ? (r.active ? " · active" : " · paused") : ""}`
                          : "";
                return (
                  <tr key={`${r.txHash}-${r.logIndex}`} style={{ borderTop: "1px solid var(--border-soft)" }}>
                    <td style={{ padding: "8px", whiteSpace: "nowrap" }}>{new Date(r.ts).toLocaleString()}</td>
                    <td style={{ padding: "8px", whiteSpace: "nowrap", color: r.kind === "burn" ? "var(--grad)" : r.kind === "referralClaim" ? "var(--up)" : undefined }}>{what}</td>
                    <td style={{ padding: "8px" }}>{amounts}</td>
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

      {view && view.referrers.length > 0 && (
        <div className="panel reveal" style={{ marginTop: 18, overflowX: "auto" }}>
          <h3 style={{ fontSize: 18, marginBottom: 6 }}>Top referrers</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--fg-dim)" }}>
                <th style={{ padding: "6px 8px" }}>Referrer</th>
                <th style={{ padding: "6px 8px" }}>Earned</th>
                <th style={{ padding: "6px 8px" }}>Referred trades</th>
              </tr>
            </thead>
            <tbody>
              {view.referrers.slice(0, 10).map((r) => {
                const m = assetMeta(r.asset);
                return (
                  <tr key={`${r.asset}-${r.referrer}`} style={{ borderTop: "1px solid var(--border-soft)" }}>
                    <td style={{ padding: "8px", fontFamily: "var(--mono, monospace)" }}>{short(r.referrer)}{address && r.referrer.toLowerCase() === address.toLowerCase() ? " (you)" : ""}</td>
                    <td style={{ padding: "8px", color: "var(--up)" }}>{fmt(r.accrued, m.decimals, 6)} {m.symbol}</td>
                    <td style={{ padding: "8px" }}>{r.trades}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="hint reveal" style={{ marginTop: 20, marginBottom: 60 }}>
        Contracts:{" "}
        <a href={`${net.explorer}/address/${pound.vault}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>vault</a>{" · "}
        <a href={`${net.explorer}/address/${pound.burner}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>burner</a>{" · "}
        <a href={`${net.explorer}/address/${net.contracts.router}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>router</a>
        {" · "}<Link href="/factory" style={{ color: "var(--radian-2)" }}>how the split is set</Link>
      </p>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}
