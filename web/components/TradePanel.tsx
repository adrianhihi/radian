"use client";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { hasIndexer, fetchTokenTrades, type TokenTrade } from "@/lib/indexer";

// Price of a trade = quote in/out ÷ tokens, i.e. quote per token.
function priceOf(t: TokenTrade): number {
  const q = Number(formatUnits(BigInt(t.quote), t.quoteDecimals ?? 18));
  const tok = Number(formatUnits(BigInt(t.tokens), 18));
  return tok > 0 ? q / tok : 0;
}

function Sparkline({ trades }: { trades: TokenTrade[] }) {
  // oldest→newest so the line reads left to right
  const pts = [...trades].reverse().map(priceOf).filter((p) => p > 0);
  if (pts.length < 2) return null;
  const w = 300;
  const h = 90;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || max || 1;
  const path = pts
    .map((p, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - 6 - ((p - min) / span) * (h - 12);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  const stroke = up ? "var(--up)" : "var(--down)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="90" preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L${w},${h} L0,${h} Z`} fill="url(#fill)" stroke="none" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function TradePanel({ token, symbol }: { token: string; symbol: string }) {
  const [trades, setTrades] = useState<TokenTrade[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!hasIndexer()) return;
    const load = () => fetchTokenTrades(token).then((t) => { setTrades(t); setLoaded(true); }).catch(() => setLoaded(true));
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [token]);

  if (!hasIndexer()) return null;

  const ago = (ts: number) => {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
  };

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="prog-row" style={{ marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--fg)" }}>
          Price & trades
        </span>
        <span>{trades.length} trades</span>
      </div>
      {trades.length >= 2 ? (
        <Sparkline trades={trades} />
      ) : (
        <p className="hint" style={{ margin: "10px 0" }}>
          {loaded ? "Not enough trades yet to chart." : "Loading trades…"}
        </p>
      )}
      <div style={{ marginTop: 8, maxHeight: 260, overflowY: "auto" }} className="thin-scroll">
        {trades.slice(0, 40).map((t, i) => (
          <div key={t.txHash + i} className="kv" style={{ padding: "8px 0" }}>
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
              <span className="mono" style={{ color: "var(--fg-faint)", fontSize: 12 }}>
                {t.trader.slice(0, 6)}…{t.trader.slice(-4)}
              </span>
            </span>
            <span style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span className="v">
                {Number(formatUnits(BigInt(t.quote), t.quoteDecimals ?? 18)).toLocaleString(undefined, { maximumFractionDigits: 3 })} {t.quoteSymbol ?? "USDC"}
              </span>
              <span style={{ color: "var(--fg-faint)", fontSize: 12, width: 30, textAlign: "right" }}>{ago(t.ts)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
