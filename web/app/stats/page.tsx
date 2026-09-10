"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { useReveal } from "@/lib/useReveal";
import { useStats } from "@/lib/useStats";
import { hasIndexer, fetchStats, type ProtocolStats } from "@/lib/indexer";

function VolumeChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1e-9);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90, marginTop: 8 }}>
      {data.map((v, i) => (
        <div
          key={i}
          title={`${v.toFixed(3)} USDC`}
          style={{
            flex: 1,
            height: `${Math.max(2, (v / max) * 100)}%`,
            background: v > 0 ? "linear-gradient(180deg, var(--arc-a), var(--arc-b))" : "var(--panel-2)",
            borderRadius: 3,
            minHeight: 2,
            transition: "height 0.5s var(--ease)",
          }}
        />
      ))}
    </div>
  );
}

export default function StatsPage() {
  useReveal();
  const chain = useStats(); // on-chain fallback (launches/graduated/tvl/buyback)
  const [win, setWin] = useState<"24h" | "all">("all");
  const [s, setS] = useState<ProtocolStats | null>(null);

  useEffect(() => {
    if (!hasIndexer()) return;
    const load = () => fetchStats(win).then(setS).catch(() => {});
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [win]);

  const launches = s?.launches ?? chain.launches;
  const graduated = s?.graduated ?? chain.graduated;
  const tvl = s?.curveTvl ?? chain.curveTvl;
  const buyback = s?.buybackLocked ?? chain.buybackLocked;

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 0" }}>
        <div className="reveal" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 34 }}>Protocol analytics</h1>
            <p style={{ color: "var(--fg-dim)", marginTop: 10 }}>
              Independent on-chain reporting for Radian on Circle Arc testnet.
            </p>
          </div>
          {hasIndexer() && (
            <div className="seg" style={{ width: "auto" }}>
              {(["24h", "all"] as const).map((w) => (
                <button key={w} className={win === w ? "on-buy" : ""} onClick={() => setWin(w)} style={{ padding: "8px 16px", flex: "none" }}>
                  {w === "24h" ? "24 Hours" : "All time"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="stats" style={{ marginTop: 26 }}>
          {[
            { k: launches, l: "Tokens launched", dp: 0 },
            { k: graduated, l: "Graduated", dp: 0 },
            { k: s?.volume ?? 0, l: `Volume${hasIndexer() ? ` (${win})` : ""}`, dp: 2, pre: "$" },
            { k: s?.creatorRewards ?? 0, l: "Creator rewards", dp: 3, pre: "$" },
          ].map((b, i) => (
            <div className="stat reveal" data-reveal-delay={i * 60} key={b.l}>
              <div className="k"><AnimatedNumber value={b.k} decimals={b.dp} prefix={b.pre ?? ""} /></div>
              <div className="l">{b.l}</div>
            </div>
          ))}
        </div>

        {hasIndexer() && s && (
          <>
            <div className="panel reveal" style={{ marginTop: 18 }}>
              <div className="prog-row" style={{ marginBottom: 4 }}>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--fg)" }}>Volume, last 24h</span>
                <span>{s.trades} trades in {win}</span>
              </div>
              <VolumeChart data={s.hourlyVolume} />
            </div>

            <div className="stats" style={{ marginTop: 18, gridTemplateColumns: "repeat(3,1fr)" }}>
              <div className="stat reveal"><div className="k" style={{ color: "var(--up)" }}>${s.buyVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div><div className="l">Buy volume · {s.buyTrades} trades</div></div>
              <div className="stat reveal" data-reveal-delay={60}><div className="k" style={{ color: "var(--down)" }}>${s.sellVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div><div className="l">Sell volume · {s.sellTrades} trades</div></div>
              <div className="stat reveal" data-reveal-delay={120}><div className="k">${s.avgTrade.toLocaleString(undefined, { maximumFractionDigits: 3 })}</div><div className="l">Avg trade</div></div>
            </div>

            <div className="section" style={{ paddingTop: 34 }}>
              <div className="section-head reveal">
                <div><h2 style={{ fontSize: 22 }}>Ranked tokens</h2><p>By trading volume in {win}.</p></div>
              </div>
              <div className="panel reveal" style={{ padding: 0, overflow: "hidden" }}>
                <div className="kv" style={{ padding: "11px 20px", color: "var(--fg-faint)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <span>Token</span>
                  <span style={{ display: "flex", gap: 28 }}>
                    <span style={{ width: 90, textAlign: "right" }}>Volume</span>
                    <span style={{ width: 44, textAlign: "right" }}>Buys</span>
                    <span style={{ width: 44, textAlign: "right" }}>Sells</span>
                  </span>
                </div>
                {s.ranked.length === 0 ? (
                  <div className="empty">No trades in this window yet.</div>
                ) : (
                  s.ranked.map((r, i) => (
                    <Link key={r.token} href={`/token/${r.token}`} className="kv live-row" style={{ padding: "13px 20px", alignItems: "center" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
                        <span style={{ color: "var(--fg-faint)", width: 16 }}>{i + 1}</span>
                        <span className="avatar" style={{ width: 30, height: 30, fontSize: 12 }}>{(r.symbol || "?").slice(0, 2).toUpperCase()}</span>
                        <span><span style={{ fontWeight: 600 }}>{r.name || "—"}</span> <span style={{ color: "var(--fg-faint)", fontSize: 12 }}>${r.symbol}</span></span>
                      </span>
                      <span style={{ display: "flex", gap: 28, fontVariantNumeric: "tabular-nums" }}>
                        <span className="v" style={{ width: 90, textAlign: "right" }}>${r.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        <span style={{ width: 44, textAlign: "right", color: "var(--up)" }}>{r.buys}</span>
                        <span style={{ width: 44, textAlign: "right", color: "var(--down)" }}>{r.sells}</span>
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        <div className="panel reveal" style={{ marginTop: 18, marginBottom: 60 }}>
          <div className="prog-row" style={{ marginBottom: 4 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--fg)" }}>Buyback & lock</span>
            <span>5-year linear vest</span>
          </div>
          <div className="kv"><span>Tokens bought back and locked</span><span className="v"><AnimatedNumber value={buyback} decimals={0} /> tokens</span></div>
          <div className="kv" style={{ border: "none" }}><span>USDC currently in curves</span><span className="v">${tvl.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
        </div>
      </main>
    </>
  );
}
