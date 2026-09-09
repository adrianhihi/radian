"use client";
import { Nav } from "@/components/Nav";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { useReveal } from "@/lib/useReveal";
import { useStats } from "@/lib/useStats";
import { formatUnits } from "viem";

export default function StatsPage() {
  useReveal();
  const s = useStats();
  const rows = s.rows;

  const bigStats = [
    { k: s.launches, l: "Tokens launched", dp: 0 },
    { k: s.graduated, l: "Graduated", dp: 0 },
    { k: s.curveTvl, l: "USDC in curves", dp: 2, pre: "$" },
    { k: s.pendingFees, l: "Pending curve fees (USDC)", dp: 4, pre: "$" },
  ];

  const topByReserve = [...rows]
    .sort((a, b) => (b.trackedQuote > a.trackedQuote ? 1 : b.trackedQuote < a.trackedQuote ? -1 : 0))
    .slice(0, 8);

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 0" }}>
        <div className="reveal">
          <h1 style={{ fontSize: 34 }}>Protocol analytics</h1>
          <p style={{ color: "var(--fg-dim)", marginTop: 10 }}>
            Live on-chain reporting for Radian on Circle Arc testnet. Every figure is read
            directly from the contracts — no indexer, no cache.
          </p>
        </div>

        <div className="stats" style={{ marginTop: 30 }}>
          {bigStats.map((b, i) => (
            <div className="stat reveal" data-reveal-delay={i * 70} key={b.l}>
              <div className="k">
                <AnimatedNumber value={b.k} decimals={b.dp} prefix={b.pre ?? ""} />
              </div>
              <div className="l">{b.l}</div>
            </div>
          ))}
        </div>

        <div className="panel reveal" style={{ marginTop: 18 }}>
          <div className="prog-row" style={{ marginBottom: 14 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--fg)" }}>
              Buyback & lock
            </span>
            <span>5-year linear vest</span>
          </div>
          <div className="kv">
            <span>Tokens bought back and locked in the vault</span>
            <span className="v">
              <AnimatedNumber value={s.buybackLocked} decimals={0} /> tokens
            </span>
          </div>
          <p className="hint">
            Radian directs a share of every trade fee into buying the token back on its own
            curve and locking it in a five-year linear vesting vault — the fee flywheel, read
            live from the vault contract.
          </p>
        </div>

        <div className="section" style={{ paddingTop: 40 }}>
          <div className="section-head reveal">
            <div>
              <h2 style={{ fontSize: 24 }}>Top tokens by curve reserve</h2>
              <p>Ranked by real USDC currently backing each bonding curve.</p>
            </div>
          </div>
          <div className="panel reveal" style={{ padding: 0, overflow: "hidden" }}>
            {topByReserve.map((r, i) => (
              <div
                key={r.token}
                className="kv"
                style={{ padding: "14px 20px", alignItems: "center" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ color: "var(--fg-faint)", width: 18 }}>{i + 1}</span>
                  <span className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>
                    {r.symbol.slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <span style={{ fontWeight: 600 }}>{r.name}</span>{" "}
                    <span style={{ color: "var(--fg-faint)", fontSize: 13 }}>${r.symbol}</span>
                  </span>
                  {r.graduated && (
                    <span className="badge badge-grad" style={{ marginLeft: 4 }}>
                      Graduated
                    </span>
                  )}
                </span>
                <span className="v">
                  {Number(formatUnits(r.trackedQuote, 18)).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}{" "}
                  USDC
                </span>
              </div>
            ))}
            {topByReserve.length === 0 && <div className="empty">Loading…</div>}
          </div>
        </div>
      </main>
    </>
  );
}
