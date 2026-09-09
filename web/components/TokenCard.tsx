"use client";
import Link from "next/link";
import { formatUnits } from "viem";
import type { LaunchRow } from "@/lib/radian";

export function TokenCard({ row, delay }: { row: LaunchRow; delay: number }) {
  const pct = Math.round(row.progress * 100);
  const reserve = Number(formatUnits(row.trackedQuote, 18));
  return (
    <Link href={`/token/${row.token}`} className="card reveal" data-reveal-delay={delay}>
      <div className="card-top">
        <div className="avatar">
          {row.logo && /^https?:\/\//.test(row.logo) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.logo} alt={row.symbol} />
          ) : (
            row.symbol.slice(0, 2).toUpperCase()
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="card-name">{row.name}</div>
          <div className="card-sym">${row.symbol}</div>
        </div>
        <span className={`badge ${row.graduated ? "badge-grad" : "badge-live"}`}>
          {row.graduated ? "Graduated" : "Live"}
        </span>
      </div>
      <div className="card-desc">{row.description || "A token launched on Radian."}</div>
      <div>
        <div className="prog-row">
          <span>{row.graduated ? "Bonded" : "Bonding curve"}</span>
          <span>{pct}%</span>
        </div>
        <div className="prog">
          <span style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <div className="prog-row" style={{ marginTop: 6, marginBottom: 0 }}>
          <span>{reserve.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC in curve</span>
          <span>goal {Number(formatUnits(row.graduationThreshold, 18)).toLocaleString()} USDC</span>
        </div>
      </div>
    </Link>
  );
}
