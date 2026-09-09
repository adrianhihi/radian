"use client";
import Link from "next/link";
import { formatUnits } from "viem";
import { Nav } from "@/components/Nav";
import { useReveal } from "@/lib/useReveal";
import { useLaunches } from "@/lib/useLaunches";

export default function LivePage() {
  useReveal();
  const { rows, loading } = useLaunches(); // polls every 15s

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
              const reserve = Number(formatUnits(r.trackedQuote, 18));
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
                        Number(formatUnits(r.quoteReserve, 18)) / 1_000_000_000
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
        <p className="hint" style={{ marginTop: 12 }}>
          Auto-refreshes every 15s. A full cross-user trade tape arrives with the indexer
          (Phase 4b).
        </p>
      </main>
    </>
  );
}
