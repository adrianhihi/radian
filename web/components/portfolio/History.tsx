"use client";

// The history block of the overview card (baskvia's History): the "STARTED WITH · PAST {p}"
// card, the period tabs, the chart with a value axis and dates, and the PnL strip with the
// three assets that moved most. Method: current holdings × each token's price history from
// the indexer's trades; holdings whose history does not reach the window start are left out
// and named under the chart.
import { ArrowDown, ArrowUp, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { useT } from "@/components/LangProvider";
import { DitherChart } from "@/components/ui/DitherChart";
import { Info } from "@/components/ui/Info";
import { HISTORY_PERIODS, type HistoryPeriod, type HistoryView } from "@/lib/portfolioHistory";
import { pct } from "@/lib/ui/format";

/** same vertical mapping as DitherChart (viewBox height 100, 8 top / 12 bottom), so the ticks line up */
const yPct = (v: number, min: number, span: number) => (100 - 12 - ((v - min) / span) * 80) / 100;

export function PeriodTabs({ period, onPeriod }: { period: HistoryPeriod; onPeriod: (p: HistoryPeriod) => void }) {
  const t = useT();
  return (
    <div role="tablist" aria-label={t("detail.periodAria")} className="inline-flex gap-1">
      {HISTORY_PERIODS.map((p) => (
        <button key={p} type="button" role="tab" aria-selected={p === period} onClick={() => onPeriod(p)} className={`tnum mono-label rounded-lg px-3 py-1.5 text-[11px] ${p === period ? "bg-glass-2 text-ink" : "text-ink-3 hover:text-ink-2"}`}>
          {p}
        </button>
      ))}
    </div>
  );
}

export function StartedCard({ h, period, sym, m }: { h?: HistoryView; period: HistoryPeriod; sym: string; m: (v: number, d?: number) => string }) {
  const t = useT();
  const covered = h?.assets.filter((a) => a.covered) ?? [];
  const start = covered.reduce((n, a) => n + (a.start ?? 0), 0);
  const end = covered.reduce((n, a) => n + (a.end ?? 0), 0);
  const delta = end - start;
  return (
    <div className="w-full rounded-2xl border border-stroke bg-glass-2 p-4 nav:w-[260px]">
      <div className="mono-label flex items-center gap-2 text-[10px] tracking-[.14em] text-ink-3">
        {t("pf.startedWith", { p: period })} <Info text={t("pf.infoStarted")} />
      </div>
      {h ? (
        covered.length ? (
          <>
            <div className="tnum mt-2 text-[28px] font-semibold text-ink">
              {m(start, 2)} <span className="text-[13px] font-normal text-ink-3">{sym}</span>
            </div>
            <div className={`tnum mt-1 text-[15px] font-medium ${delta >= 0 ? "text-pos" : "text-neg"}`}>
              {delta >= 0 ? <TrendingUp size={15} strokeWidth={1.8} aria-hidden="true" className="inline align-[-2px]" /> : <TrendingDown size={15} strokeWidth={1.8} aria-hidden="true" className="inline align-[-2px]" />} {delta >= 0 ? "+" : "−"}
              {m(Math.abs(delta), 2)} {start > 0 ? pct((delta / start) * 100) : ""}
            </div>
          </>
        ) : (
          <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-3">{t("pf.noHistoryYet")}</p>
        )
      ) : (
        <div className="mt-3 h-12 animate-pulse rounded-lg bg-glass-2" aria-hidden="true" />
      )}
    </div>
  );
}

export function HistoryChart({ h, m }: { h?: HistoryView; m: (v: number, d?: number) => string }) {
  const t = useT();
  if (!h) return <div className="h-[220px] animate-pulse rounded-xl bg-glass-2/50" aria-hidden="true" />;
  const vals = h.values;
  const missing = h.assets.filter((a) => !a.covered).map((a) => a.symbol);
  if (vals.length < 2 || !h.assets.some((a) => a.covered)) {
    return (
      <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-stroke-2 text-[13px] text-ink-3">
        {t("pf.chartEmpty")}
      </div>
    );
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const ticks = [0, 1, 2, 3].map((i) => min + (span * i) / 3);
  const dayFmt = new Intl.DateTimeFormat("en-US", h.period === "24H" ? { hour: "numeric" } : { month: "short", day: "numeric" });
  const labelIdx = Array.from({ length: 6 }, (_, i) => Math.round((i * (h.times.length - 1)) / 5));
  return (
    <div>
      <div className="relative h-[220px] pl-14">
        {ticks.map((v) => (
          <span key={v} className="tnum mono-label absolute left-0 -translate-y-1/2 text-[10px] text-ink-3" style={{ top: `${yPct(v, min, span) * 100}%` }}>
            {m(v, v >= 100 ? 0 : 2)}
          </span>
        ))}
        <DitherChart series={vals} label={t("pf.chartAria")} orient="vertical" className="h-full w-full" />
      </div>
      <div className="relative mt-2 h-4 pl-14">
        {labelIdx.map((i, k) => (
          <span key={i} className={`tnum mono-label absolute whitespace-nowrap text-[10px] text-ink-3 ${i === 0 ? "" : i === h.times.length - 1 ? "-translate-x-full" : "-translate-x-1/2"} ${k === 1 || k === 2 || k === 4 ? "hidden min-[560px]:block" : ""}`} style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${i / (h.times.length - 1)})` }}>
            {dayFmt.format(new Date(h.times[i]))}
          </span>
        ))}
      </div>
      {missing.length > 0 && <p className="mt-2 text-[11.5px] text-ink-3">{t("pf.coverage", { pct: `${Math.round(h.coverage * 100)}%`, list: missing.map((s) => `$${s}`).join(" · ") })}</p>}
    </div>
  );
}

/** PAST {p} ±value · the three assets that moved most · +N more / fewer. */
export function PnlStrip({ h, period, sym, m, onAsset }: { h?: HistoryView; period: HistoryPeriod; sym: string; m: (v: number, d?: number) => string; onAsset?: (token: string) => void }) {
  const t = useT();
  const [all, setAll] = useState(false);
  if (!h) return null;
  const rows = h.assets
    .filter((a) => a.covered && a.start != null && a.end != null && a.start !== a.end)
    .map((a) => ({ sym: a.symbol, token: a.token, d: (a.end ?? 0) - (a.start ?? 0) }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (!rows.length) return null;
  const total = rows.reduce((n, r) => n + r.d, 0);
  const shown = all ? rows : rows.slice(0, 3);
  const sign = (d: number) => (d >= 0 ? "+" : "−");
  return (
    <div className="mt-5 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-stroke bg-glass-2 px-4 py-4">
      <span className="mono-label text-[10.5px] tracking-[.14em] text-ink-3">{t("pf.pastPeriod", { p: period })}</span>
      <span className={`tnum text-[17px] font-semibold ${total >= 0 ? "text-pos" : "text-neg"}`}>
        {sign(total)}
        {m(Math.abs(total), 2)} {sym}
      </span>
      {shown.map((r) => (
        <button key={r.token} type="button" onClick={() => onAsset?.(r.token)} aria-label={t("pf.assetChipAria", { sym: r.sym })} className="tnum rounded-full border border-stroke-2 px-3 py-1 text-[12px] text-ink transition-colors hover:border-brand">
          ${r.sym}{" "}
          <span className={r.d >= 0 ? "text-pos" : "text-neg"}>
            {r.d >= 0 ? <ArrowUp size={11} strokeWidth={1.8} aria-hidden="true" className="inline align-[-1px]" /> : <ArrowDown size={11} strokeWidth={1.8} aria-hidden="true" className="inline align-[-1px]" />} {sign(r.d)}
            {m(Math.abs(r.d), 2)}
          </span>
        </button>
      ))}
      {rows.length > 3 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mono-label rounded-full border border-stroke px-3 py-1 text-[10.5px] tracking-[.1em] text-ink-3 hover:text-ink">
          {all ? t("pf.fewer") : t("pf.moreN", { n: rows.length - 3 })}
        </button>
      )}
    </div>
  );
}
