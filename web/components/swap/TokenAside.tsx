"use client";

// /swap's right column: the picked token at a glance — logo · name · $SYMBOL,
// the story, 24h change + period tabs + the spark chart, price / in curve,
// the curve state, 24h volume and trades, and the way to its page.
import Link from "next/link";
import { useState } from "react";
import { formatUnits } from "viem";
import { useT } from "@/components/LangProvider";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { DitherChart } from "@/components/ui/DitherChart";
import { ChangePill, CurveBlock, Description, PeriodChips } from "@/components/explore/TokenCards";
import { sparkValues, type Period } from "@/lib/explore";
import type { LaunchRow } from "@/lib/radian";
import { fmtNum, fmtPrice } from "@/lib/ui/format";

export function TokenAside({ row }: { row: LaunchRow }) {
  const t = useT();
  const [period, setPeriod] = useState<Period>("7D");
  const series = sparkValues(row.spark, period);
  const price = row.lastPrice ?? null;

  return (
    <aside className="glass-panel rounded-2xl p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <AssetLogo symbol={row.symbol} src={/^https?:\/\//.test(row.logo) ? row.logo : null} size={34} radius={10} />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[15px] font-semibold text-ink">{row.name}</span>
          <span className="mono-label block text-[11px] text-muted">${row.symbol}</span>
        </span>
      </div>

      <Description row={row} className="mb-4" />

      <div className="mb-1.5 flex items-center justify-between gap-2">
        <ChangePill value={row.change24h} />
        <PeriodChips period={period} onPeriod={setPeriod} />
      </div>
      {series.length >= 2 ? (
        <DitherChart series={series} label={t("tcard.chartAria", { name: row.name })} className="mb-4 h-[86px] w-full" />
      ) : (
        <p className="mb-4 grid h-[86px] place-items-center rounded-[10px] border border-dashed border-stroke-2 text-[12px] text-ink-3">{t("tcard.tooFew")}</p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Stat label={t("swap.asidePrice")} value={price != null ? `${fmtPrice(price)} ${row.quoteSymbol}` : "—"} />
        <Stat label={t("swap.asideReserve")} value={`${fmtNum(Number(formatUnits(row.trackedQuote, row.quoteDecimals)), 2)} ${row.quoteSymbol}`} />
        <Stat label={t("swap.asideVolume")} value={row.volume24h != null ? `${fmtNum(row.volume24h, 2)} ${row.quoteSymbol}` : "—"} />
        <Stat label={t("swap.asideTrades")} value={row.trades24h != null ? String(row.trades24h) : "—"} />
      </div>

      <CurveBlock row={row} />

      <Link
        href={`/token/${row.token}`}
        className="mono-label mt-4 block rounded-[10px] border border-stroke-2 bg-glass-2 py-2.5 text-center text-[11px] tracking-[.06em] text-ink-2 transition-colors hover:border-brand hover:text-brand"
      >
        {t("swap.asideView")}
      </Link>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="mono-label text-[10px] text-ink-3">{label}</div>
      <div className="tnum truncate text-[15px] font-[550] text-ink">{value}</div>
    </div>
  );
}
