"use client";

// Token cards for Explore, on baskvia's BasketCard skeleton: a well with the
// curve state and a spark chart (or a big chart with period chips), then
// $SYMBOL · name · creator chip, the description, and 24h change · reserve ·
// open link. The whole card is not a link: it holds other links and a toggle.
import Link from "next/link";
import { useState } from "react";
import { formatUnits } from "viem";
import { useT, useTDynamic } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { DitherChart } from "@/components/ui/DitherChart";
import { quoteByAddress, type LaunchRow } from "@/lib/radian";
import { CurveTiles } from "@/components/token/CurveTiles";
import { pct, shortAddr } from "@/lib/ui/format";
import { PERIODS, sparkValues, type Period } from "@/lib/explore";

export type CardView = "curve" | "graph";

const fmtQ = (v: bigint, dec: number, digits = 2) => Number(formatUnits(v, dec)).toLocaleString(undefined, { maximumFractionDigits: digits });

/** Creator chip: avatar + short address, linking to the creator's page. */
export function CreatorChip({ address, name }: { address: string; name?: string }) {
  const t = useT();
  return (
    <Link
      href={`/profile/${address}`}
      aria-label={t("tcard.creatorAria", { addr: shortAddr(address) })}
      className="mono-label inline-flex flex-none items-center gap-1.5 rounded-full border border-stroke bg-glass-2 py-1 pl-1 pr-2.5 text-[10.5px] text-muted transition-colors hover:border-brand hover:text-ink"
    >
      <AddressAvatar address={address} size={18} />
      {name || shortAddr(address)}
    </Link>
  );
}

/** "+4.28% 24H" pill; "—" when the token has fewer than two trades. */
export function ChangePill({ value }: { value: number | null | undefined }) {
  const t = useT();
  const has = typeof value === "number";
  return (
    <span
      className={`tnum inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-sm font-semibold ${
        !has ? "border-stroke text-ink-3" : value >= 0 ? "border-brand/60 text-brand" : "border-neg/50 text-neg"
      }`}
    >
      {has ? pct(value) : "—"}
      <small className="mono-label text-[9.5px] font-normal tracking-[.08em] text-muted">{t("tcard.change24")}</small>
    </span>
  );
}

export function PeriodChips({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  return (
    <div role="tablist" className="inline-flex gap-0.5">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={p === period}
          onClick={() => onPeriod(p)}
          className={`tnum mono-label rounded-md px-2 py-1 text-[10.5px] ${p === period ? "bg-glass-2 text-ink" : "text-ink-3 hover:text-ink-2"}`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

/** Curve state: status + template, the progress bar, reserve and goal. */
export function CurveBlock({ row, wide = false }: { row: LaunchRow; wide?: boolean }) {
  const t = useT();
  const p = row.graduated ? 100 : Math.round(row.progress * 1000) / 10;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="mono-label flex items-center gap-2 text-[10.5px] tracking-[.12em]">
          <span className={row.graduated ? "text-signal" : "text-brand"}>{row.graduated ? t("tcard.graduated") : t("tcard.live")}</span>
          {row.template && <span className="rounded-md border border-stroke px-1.5 py-px text-[9.5px] text-ink-3">{row.template.kind === "wall" ? t("tcard.wall") : t("tcard.pof")}</span>}
        </span>
        <span className="tnum mono-label text-[11px] text-ink-2">{p}%</span>
      </div>
      <CurveTiles symbol={row.symbol} token={row.token} logo={row.logo} quoteSymbol={row.quoteSymbol} quoteTicker={quoteByAddress(row.pairToken)?.stock?.refSymbol} progress={row.progress} graduated={row.graduated} height={wide ? 168 : 104} className="mt-2.5" />
      <div className="tnum mt-2 flex justify-between gap-2 text-[11px] text-muted">
        <span>{t("tcard.inCurve", { v: fmtQ(row.trackedQuote, row.quoteDecimals), sym: row.quoteSymbol })}</span>
        <span>{t("tcard.goal", { v: fmtQ(row.graduationThreshold, row.quoteDecimals, 0), sym: row.quoteSymbol })}</span>
      </div>
    </div>
  );
}

/** Description: two lines, then "Read the story". Never invents copy for a token without one. */
export function Description({ row, className = "" }: { row: LaunchRow; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const text = (row.description ?? "").trim();
  if (!text) return <p className={`mono-label text-[11px] tracking-[.06em] text-ink-3 ${className}`}>{t("tcard.noDesc")}</p>;
  const long = text.length > 140;
  return (
    <div className={className}>
      <p className={`text-[15px] leading-[1.5] text-ink ${open ? "" : "line-clamp-2"}`}>{text}</p>
      {long && (
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="mono-label mt-1.5 inline-flex items-center gap-1 text-[10.5px] tracking-[.1em] text-ink-3 hover:text-ink-2">
          <span aria-hidden="true" className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>
            ›
          </span>
          {open ? t("tcard.hideDesc") : t("tcard.readDesc")}
        </button>
      )}
    </div>
  );
}

export function TokenCard({ row, view = "curve", badge = false }: { row: LaunchRow; view?: CardView; badge?: boolean }) {
  const t = useT();
  const td = useTDynamic();
  const [period, setPeriod] = useState<Period>("ALL");
  const href = `/token/${row.token}`;
  const chartLabel = t("tcard.chartAria", { name: row.name });
  const series = sparkValues(row.spark, view === "graph" ? period : "ALL");

  return (
    <article className="glass-panel relative flex min-w-0 flex-col rounded-panel p-4 nav:p-5">
      {badge && (
        <span className="mono-label absolute -top-2.5 right-4 z-10 rounded-full border border-stroke-2 bg-bg-2 px-2.5 py-1 text-[9.5px] tracking-[.12em] text-ink-2">
          {t("tcard.mostBacked")}
        </span>
      )}
      <div className="rounded-xl border border-stroke bg-bg-2/60 p-2.5">
        {view === "graph" ? (
          <>
            <div className="flex justify-end">
              <PeriodChips period={period} onPeriod={setPeriod} />
            </div>
            {series.length >= 2 ? <DitherChart series={series} label={chartLabel} orient="vertical" className="mt-1 h-[150px] w-full" /> : <p className="grid h-[150px] place-items-center text-xs text-muted">{t("tcard.tooFew")}</p>}
          </>
        ) : (
          <>
            <CurveBlock row={row} />
            {series.length >= 2 ? <DitherChart series={series} label={chartLabel} className="mt-2 h-[44px] w-full" /> : <p className="mono-label mt-2 text-[10px] text-ink-3">{t("tcard.tooFew")}</p>}
          </>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2.5">
        <AssetLogo symbol={row.symbol} src={/^https?:\/\//.test(row.logo) ? row.logo : null} seed={row.token} size={30} radius={9} />
        <h3 className="min-w-0 truncate text-[19px] font-bold tracking-[-.2px] text-ink">
          ${row.symbol} <span className="mono-label text-[12.5px] font-normal tracking-normal text-muted">{row.name}</span>
        </h3>
        <span className="ml-auto">
          <CreatorChip address={row.deployer} name={row.creatorName} />
        </span>
      </div>

      <Description row={row} className="mt-3" />

      <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
        <ChangePill value={row.change24h} />
        <span className="tnum mono-label text-[11px] text-muted">{td("tcard.trades24", { n: row.trades24h ?? 0 })}</span>
        <Link href={href} aria-label={t("tcard.openAria", { name: row.name })} className="mono-label ml-auto rounded-lg border border-stroke-2 px-3 py-1.5 text-[10.5px] tracking-[.12em] text-ink-2 transition-colors hover:border-brand hover:text-brand">
          {t("explore.openToken")}
        </Link>
      </div>
    </article>
  );
}
