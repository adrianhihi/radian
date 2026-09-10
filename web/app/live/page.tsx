"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { Nav } from "@/components/Nav";
import { useReveal } from "@/lib/useReveal";
import { useLaunches } from "@/lib/useLaunches";
import { hasIndexer, fetchActivity, type Activity } from "@/lib/indexer";

export default function LivePage() {
  useReveal();
  const { rows, loading } = useLaunches();
  const [trades, setTrades] = useState<Activity[]>([]);

  useEffect(() => {
    if (!hasIndexer()) return;
    const load = () => fetchActivity(60).then(setTrades).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const ago = (ts: number) => {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
  };

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 0" }}>
        <div className="reveal" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="live-dot" />
          <h1 style={{ fontSize: 34 }}>Live</h1>
        </div>
        <p className="reveal" style={{ color: "var(--fg-dim)", marginTop: 10 }}>
          Every curve on Radian, refreshing straight from Arc. Price and reserve update as
          people trade.
        </p>

        <div className="panel reveal" style={{ marginTop: 24, padding: 0, overflow: "hidden" }}>
          <div
            className="kv"
            style={{ padding: "12px 20px", color: "var(--fg-faint)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}
          >
            <span>Token</span>
            <span style={{ display: "flex", gap: 40 }}>
              <span style={{ width: 110, textAlign: "right" }}>Spot (USDC)</span>
              <span style={{ width: 90, textAlign: "right" }}>Reserve</span>
              <span style={{ width: 70, textAlign: "right" }}>Progress</span>
            </span>
          </div>
          {loading && rows.length === 0 ? (
            <div className="empty">Connecting to Arc…</div>
          ) : (
            rows.map((r) => {
              const reserve = Number(formatUnits(r.trackedQuote, r.quoteDecimals));
              const pct = Math.round(r.progress * 100);
              return (
                <Link
                  key={r.token}
                  href={`/token/${r.token}`}
                  className="kv live-row"
                  style={{ padding: "14px 20px", alignItems: "center" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>
                      {r.symbol.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <span style={{ fontWeight: 600 }}>{r.name}</span>{" "}
                      <span style={{ color: "var(--fg-faint)", fontSize: 13 }}>${r.symbol}</span>
                    </span>
                    {r.graduated ? (
                      <span className="badge badge-grad">Graduated</span>
                    ) : (
                      <span className="badge badge-live">Live</span>
                    )}
                  </span>
                  <span style={{ display: "flex", gap: 40, fontVariantNumeric: "tabular-nums" }}>
                    <span className="v mono" style={{ width: 110, textAlign: "right" }}>
                      {(
                        Number(formatUnits(r.quoteReserve, r.quoteDecimals)) / 1_000_000_000
                      ).toExponential(2)}
                    </span>
                    <span className="v" style={{ width: 90, textAlign: "right" }}>
                      {reserve.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                    <span className="v" style={{ width: 70, textAlign: "right", color: r.graduated ? "var(--grad)" : "var(--up)" }}>
                      {pct}%
                    </span>
                  </span>
                </Link>
              );
            })
          )}
        </div>
        {hasIndexer() && (
          <div className="section" style={{ paddingTop: 40 }}>
            <div className="section-head reveal">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="live-dot" />
                <h2 style={{ fontSize: 24 }}>Trade tape</h2>
              </div>
              <p>Every buy and sell across Radian, newest first — indexed from Arc.</p>
            </div>
            <div className="panel reveal" style={{ padding: 0, overflow: "hidden" }}>
              {trades.length === 0 ? (
                <div className="empty">No trades yet — be the first to trade a curve.</div>
              ) : (
                trades.map((t, i) => (
                  <Link
                    key={t.txHash + t.side + i}
                    href={`/token/${t.token}`}
                    className="kv live-row"
                    style={{ padding: "12px 20px", alignItems: "center" }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        className="badge"
                        style={{
                          background: t.side === "buy" ? "rgba(52,211,153,0.14)" : "rgba(251,113,133,0.14)",
                          color: t.side === "buy" ? "var(--up)" : "var(--down)",
                        }}
                      >
                        {t.side}
                      </span>
                      <span style={{ fontWeight: 600 }}>${t.symbol || "?"}</span>
                      <span className="mono" style={{ color: "var(--fg-faint)", fontSize: 12 }}>
                        {t.trader.slice(0, 6)}…{t.trader.slice(-4)}
                      </span>
                    </span>
                    <span style={{ display: "flex", gap: 24, alignItems: "center" }}>
                      <span className="v">
                        {Number(formatUnits(BigInt(t.quote), t.quoteDecimals ?? 18)).toLocaleString(undefined, { maximumFractionDigits: 3 })} {t.quoteSymbol ?? "USDC"}
                      </span>
                      <span style={{ color: "var(--fg-faint)", fontSize: 12, width: 34, textAlign: "right" }}>
                        {ago(t.ts)}
                      </span>
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        )}
        <p className="hint" style={{ marginTop: 12 }}>
          {hasIndexer() ? "Indexed live from Arc." : "Auto-refreshes every 30s."}
        </p>
      </main>
    </>
  );
}
