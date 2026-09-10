"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { Nav } from "@/components/Nav";
import { SoonBanner } from "@/components/SoonBanner";
import { useNetwork } from "@/lib/networks";
import { useReveal } from "@/lib/useReveal";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useLaunches } from "@/lib/useLaunches";
import { publicClient, RADIAN, tokenAbi, escrowAbi, arcTestnet, QUOTE_ASSETS, type QuoteAsset } from "@/lib/radian";

export default function PortfolioPage() {
  useReveal();
  const net = useNetwork();
  const { authenticated, login, address, getWalletClient } = useRadianWallet();
  const { rows } = useLaunches();
  const [holdings, setHoldings] = useState<{ sym: string; name: string; token: Address; bal: bigint }[]>([]);
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [claiming, setClaiming] = useState(false);
  // Creator fees on ERC-20-quoted launches (EURC, stock stand-ins) accrue per token in the escrow.
  const [tokenClaims, setTokenClaims] = useState<{ asset: QuoteAsset; amount: bigint }[]>([]);
  const [claimingToken, setClaimingToken] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadClaimable = async (addr: Address) =>
    setClaimable(
      (await publicClient.readContract({
        address: RADIAN.escrow,
        abi: escrowAbi,
        functionName: "balanceOf",
        args: [addr],
      })) as bigint
    );

  const loadTokenClaims = async (addr: Address) => {
    const assets = QUOTE_ASSETS.filter((q) => !q.native);
    if (assets.length === 0) return setTokenClaims([]);
    try {
      const res = await publicClient.multicall({
        allowFailure: true,
        contracts: assets.map((q) => ({
          address: RADIAN.escrow, abi: escrowAbi, functionName: "balanceOfToken" as const, args: [addr, q.address] as const,
        })),
      });
      setTokenClaims(
        assets
          .map((asset, i) => ({ asset, amount: res[i].status === "success" ? (res[i].result as bigint) : 0n }))
          .filter((c) => c.amount > 0n),
      );
    } catch {}
  };

  async function claim() {
    if (!address) return;
    setClaiming(true);
    try {
      const wc = await getWalletClient();
      if (!wc) { setToast("Sign in again."); setClaiming(false); return; }
      setToast("Confirm claim…");
      const hash = await wc.client.writeContract({
        account: wc.account, chain: arcTestnet, address: RADIAN.escrow, abi: escrowAbi, functionName: "claim",
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setToast("Claimed ✓");
      await loadClaimable(address);
    } catch (e: any) {
      setToast(e?.shortMessage ?? e?.message ?? "Claim failed.");
    } finally {
      setClaiming(false);
    }
  }

  async function claimToken(asset: QuoteAsset) {
    if (!address) return;
    setClaimingToken(asset.key);
    try {
      const wc = await getWalletClient();
      if (!wc) { setToast("Sign in again."); return; }
      setToast(`Confirm ${asset.symbol} claim…`);
      const hash = await wc.client.writeContract({
        account: wc.account, chain: arcTestnet, address: RADIAN.escrow, abi: escrowAbi, functionName: "claimToken", args: [asset.address],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setToast(`Claimed ${asset.symbol} ✓`);
      await loadTokenClaims(address);
    } catch (e: any) {
      setToast(e?.shortMessage ?? e?.message ?? "Claim failed.");
    } finally {
      setClaimingToken(null);
    }
  }

  useEffect(() => {
    if (!address || rows.length === 0) return;
    (async () => {
      const hs = await Promise.all(
        rows.map(async (r) => {
          const bal = (await publicClient.readContract({
            address: r.token,
            abi: tokenAbi,
            functionName: "balanceOf",
            args: [address],
          })) as bigint;
          return { sym: r.symbol, name: r.name, token: r.token, bal };
        })
      );
      setHoldings(hs.filter((h) => h.bal > 0n));
      await loadClaimable(address);
      await loadTokenClaims(address);
    })();
  }, [address, rows]);

  const created = address
    ? rows.filter((r) => r.deployer.toLowerCase() === address.toLowerCase())
    : [];

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 0" }}>
        <SoonBanner />
        {net.live && (<>
        <div className="reveal">
          <h1 style={{ fontSize: 34 }}>Portfolio</h1>
          <p style={{ color: "var(--fg-dim)", marginTop: 10 }}>
            Your Radian tokens, creator fees, and launches — read live from Arc.
          </p>
        </div>

        {!authenticated ? (
          <div className="panel reveal" style={{ marginTop: 26, textAlign: "center", padding: 40 }}>
            <p style={{ color: "var(--fg-dim)" }}>Sign in to see your portfolio.</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={login}>
              Sign in
            </button>
          </div>
        ) : (
          <>
            <div className="stats" style={{ marginTop: 26, gridTemplateColumns: "repeat(3,1fr)" }}>
              <div className="stat reveal">
                <div className="k">{holdings.length}</div>
                <div className="l">Tokens held</div>
              </div>
              <div className="stat reveal" data-reveal-delay={70}>
                <div className="k">{created.length}</div>
                <div className="l">Tokens created</div>
              </div>
              <div className="stat reveal" data-reveal-delay={140}>
                <div className="k">
                  {Number(formatUnits(claimable, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </div>
                <div className="l">Claimable fees (native USDC)</div>
                {claimable > 0n && (
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 12, width: "100%", justifyContent: "center", padding: "9px" }}
                    onClick={claim}
                    disabled={claiming}
                  >
                    {claiming ? <span className="spinner" /> : "Claim"}
                  </button>
                )}
              </div>
            </div>

            {tokenClaims.length > 0 && (
              <div className="panel reveal" style={{ marginTop: 16, padding: "14px 20px" }}>
                <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-faint)", marginBottom: 6 }}>
                  Claimable fees in other quote assets
                </div>
                {tokenClaims.map((c) => (
                  <div key={c.asset.key} className="kv" style={{ alignItems: "center" }}>
                    <span>
                      {Number(formatUnits(c.amount, c.asset.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
                      {c.asset.symbol}
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => claimToken(c.asset)}
                      disabled={claimingToken !== null}
                    >
                      {claimingToken === c.asset.key ? <span className="spinner" /> : `Claim ${c.asset.symbol}`}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="section" style={{ paddingTop: 34 }}>
              <div className="section-head reveal">
                <div>
                  <h2 style={{ fontSize: 22 }}>Holdings</h2>
                  <p>Tokens you currently hold on Radian.</p>
                </div>
              </div>
              <div className="panel reveal" style={{ padding: 0, overflow: "hidden" }}>
                {holdings.length === 0 ? (
                  <div className="empty">No holdings yet. Buy a token to get started.</div>
                ) : (
                  holdings.map((h) => (
                    <Link key={h.token} href={`/token/${h.token}`} className="kv live-row" style={{ padding: "14px 20px", alignItems: "center" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>
                          {h.sym.slice(0, 2).toUpperCase()}
                        </span>
                        <span>
                          <span style={{ fontWeight: 600 }}>{h.name}</span>{" "}
                          <span style={{ color: "var(--fg-faint)", fontSize: 13 }}>${h.sym}</span>
                        </span>
                      </span>
                      <span className="v">
                        {Number(formatUnits(h.bal, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} {h.sym}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>

            {created.length > 0 && (
              <div className="section" style={{ paddingTop: 20 }}>
                <div className="section-head reveal">
                  <div>
                    <h2 style={{ fontSize: 22 }}>Your launches</h2>
                    <p>Tokens you created. You earn 70% of every trade fee (35% with Buyback &amp; Lock on).</p>
                  </div>
                </div>
                <div className="grid">
                  {created.map((r, i) => (
                    <Link key={r.token} href={`/token/${r.token}`} className="card reveal" data-reveal-delay={(i % 3) * 80}>
                      <div className="card-top">
                        <div className="avatar">{r.symbol.slice(0, 2).toUpperCase()}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="card-name">{r.name}</div>
                          <div className="card-sym">${r.symbol}</div>
                        </div>
                        <span className={`badge ${r.graduated ? "badge-grad" : "badge-live"}`}>
                          {r.graduated ? "Graduated" : "Live"}
                        </span>
                      </div>
                      <div className="prog">
                        <span style={{ width: `${Math.max(2, Math.round(r.progress * 100))}%` }} />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </>)}
      </main>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}
