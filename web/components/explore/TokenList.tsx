"use client";

// List view (Tokens tab): expand arrow · rank · logo · $SYM name · 24h · progress · reserve.
// Expanded: description with the creator avatar, curve/graph toggle, quick buy, open link.
// A "Have an idea?" launch entry sits after row 5.
import Link from "next/link";
import { Fragment, useState } from "react";
import { formatUnits } from "viem";
import { useT, useTDynamic } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { DitherChart } from "@/components/ui/DitherChart";
import { explorer, type LaunchRow } from "@/lib/radian";
import { pct } from "@/lib/ui/format";
import { sparkValues, type Period } from "@/lib/explore";
import { CreatorChip, CurveBlock, PeriodChips, type CardView } from "./TokenCards";
import { ViewToggle } from "./Showcase";
import { QuickBuy } from "./QuickBuy";

const CTA_AFTER = 5;

export function TokenList({ rows }: { rows: LaunchRow[] }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ol className="grid gap-2.5" aria-label={t("explore.feedAria")}>
      {rows.map((r, i) => (
        <Fragment key={r.token}>
          <Row row={r} rank={i + 1} open={open === r.token} onToggle={() => setOpen(open === r.token ? null : r.token)} />
          {i === CTA_AFTER - 1 && <LaunchCta />}
        </Fragment>
      ))}
      {rows.length < CTA_AFTER && <LaunchCta />}
    </ol>
  );
}

function Stat({ value, label, tone = "", width }: { value: string; label: string; tone?: string; width: string }) {
  return (
    <div className={`text-right ${width}`}>
      <div className={`tnum text-[17px] leading-tight nav:text-[19px] ${tone || "text-ink"}`}>{value}</div>
      <div className="mono-label mt-1 text-[9.5px] tracking-[.12em] text-ink-3">{label}</div>
    </div>
  );
}

function Row({ row: r, rank, open, onToggle }: { row: LaunchRow; rank: number; open: boolean; onToggle: () => void }) {
  const t = useT();
  const panelId = `row-${r.token.slice(2, 10)}`;
  const p = r.graduated ? 100 : Math.round(r.progress * 100);
  const has = typeof r.change24h === "number";
  return (
    <li className={`glass-panel overflow-hidden rounded-xl transition-colors ${open ? "border-stroke-2" : ""}`}>
      <button type="button" aria-expanded={open} aria-controls={panelId} aria-label={t("explore.expandAria", { name: r.name })} onClick={onToggle} className="flex w-full items-center gap-3 px-3.5 py-3 text-left nav:gap-4 nav:px-5">
        <span aria-hidden="true" className={`text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}>
          ›
        </span>
        <span className="tnum w-5 flex-none text-center text-xs text-ink-3">{rank}</span>
        <AssetLogo symbol={r.symbol} src={/^https?:\/\//.test(r.logo) ? r.logo : null} size={36} radius={10} />
        <span className="min-w-0 flex-1 truncate">
          <b className="text-[15px] font-bold text-ink nav:text-base">${r.symbol}</b> <span className="mono-label hidden text-[12.5px] text-muted nav:inline">{r.name}</span>
        </span>
        <span className="flex flex-none items-center gap-4 nav:gap-8">
          <Stat value={has ? pct(r.change24h as number) : "—"} label={t("explore.colChange")} tone={!has ? "text-ink-3" : (r.change24h as number) >= 0 ? "text-brand" : "text-neg"} width="w-[72px] nav:w-[90px]" />
          <Stat value={`${p}%`} label={t("explore.colProgress")} tone={r.graduated ? "text-signal" : ""} width="w-[64px] nav:w-[80px]" />
          <span className="hidden nav:block">
            <Stat value={`${Number(formatUnits(r.trackedQuote, r.quoteDecimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${r.quoteSymbol}`} label={t("explore.colReserve")} width="w-[140px]" />
          </span>
        </span>
      </button>
      {open && <Expanded row={r} id={panelId} />}
    </li>
  );
}

function Expanded({ row: r, id }: { row: LaunchRow; id: string }) {
  const t = useT();
  const td = useTDynamic();
  const [view, setView] = useState<CardView>("curve");
  const [period, setPeriod] = useState<Period>("ALL");
  const series = sparkValues(r.spark, view === "graph" ? period : "ALL");
  const chartLabel = t("tcard.chartAria", { name: r.name });
  return (
    <div id={id} className="border-t border-stroke px-3.5 pb-4 pt-3.5 nav:px-5">
      <div className="flex items-start gap-4 rounded-xl border border-stroke bg-glass-2 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium leading-[1.5] text-ink">{r.description || t("tcard.noDesc")}</p>
        </div>
        <a href={explorer.address(r.deployer)} target="_blank" rel="noreferrer" aria-label={t("tcard.creatorAria", { addr: r.deployer })} className="flex-none">
          <AddressAvatar address={r.deployer} size={38} />
        </a>
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3">
        <ViewToggle
          value={view}
          onChange={setView}
          options={[
            ["curve", t("explore.vCurve")],
            ["graph", t("explore.vGraph")],
          ]}
          label={t("explore.viewAria")}
        />
        {view === "graph" && <PeriodChips period={period} onPeriod={setPeriod} />}
      </div>
      <div className="mt-2.5">
        {view === "graph" ? (
          series.length >= 2 ? (
            <DitherChart series={series} label={chartLabel} orient="vertical" className="h-[200px] w-full" />
          ) : (
            <p className="grid h-[120px] place-items-center text-sm text-muted">{t("tcard.tooFew")}</p>
          )
        ) : (
          <CurveBlock row={r} wide />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted">
        <span className="tnum">{td("tcard.trades24", { n: r.trades24h ?? 0 })}</span>
        <span className="inline-flex items-center gap-2">
          {t("explore.byCreator")} <CreatorChip address={r.deployer} />
        </span>
      </div>

      {!r.graduated && (
        <div className="mt-3.5">
          <QuickBuy rows={[r]} token={r.token} onToken={() => {}} />
        </div>
      )}

      <div className="mt-3.5 flex justify-end">
        <Link href={`/token/${r.token}`} className="mono-label rounded-lg border border-stroke-2 px-3.5 py-2 text-[10.5px] tracking-[.12em] text-ink-2 transition-colors hover:border-brand hover:text-brand">
          {t("explore.openToken")}
        </Link>
      </div>
    </div>
  );
}

function LaunchCta() {
  const t = useT();
  return (
    <li className="glass-panel relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-xl px-5 py-4">
      <div className="grad-fill absolute inset-x-0 top-0 h-[2px]" aria-hidden="true" />
      <p className="text-[15px] text-ink">
        <b className="font-semibold">{t("explore.ctaTitle")}</b> <span className="text-muted">{t("explore.ctaBody")}</span>
      </p>
      <Link href="/create" className="grad-fill mono-label rounded-lg px-4 py-2.5 text-[11px] tracking-[.12em]">
        {t("explore.ctaBtn")}
      </Link>
    </li>
  );
}
