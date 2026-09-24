"use client";

// The full-width carousel under the hero: CURVE / GRAPH toggle · dots · ‹ › · pause.
// Body: the curve block with a spark, or a big chart with period chips. Below:
// $SYMBOL · name · creator, the description on the right, "Open token".
import { Pause, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/LangProvider";
import { DitherChart } from "@/components/ui/DitherChart";
import { AssetLogo } from "@/components/ui/AssetLogo";
import type { LaunchRow } from "@/lib/radian";
import { sparkValues, type Period } from "@/lib/explore";
import { CreatorChip, CurveBlock, PeriodChips, type CardView } from "./TokenCards";

const STEP_MS = 6000;

export function Showcase({ rows }: { rows: LaunchRow[] }) {
  const t = useT();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<CardView>("curve");
  const [period, setPeriod] = useState<Period>("ALL");

  const n = rows.length;
  useEffect(() => {
    if (paused || n < 2) return;
    const id = setInterval(() => setIdx((i) => i + 1), STEP_MS);
    return () => clearInterval(id);
  }, [paused, n]);

  if (!n) return null;
  const i = ((idx % n) + n) % n;
  const r = rows[i];
  const chartLabel = t("tcard.chartAria", { name: r.name });
  const series = sparkValues(r.spark, view === "graph" ? period : "ALL");
  const navBtn = "grid size-9 place-items-center rounded-lg border border-stroke-2 text-ink-2 transition-colors hover:border-brand hover:text-brand";

  return (
    <section aria-roledescription="carousel" aria-label={t("explore.showcaseAria")} className="glass-panel relative overflow-hidden rounded-lg">
      <div className="grad-fill h-[3px]" aria-hidden="true" />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke px-4 py-3 nav:px-6">
        <ViewToggle
          value={view}
          onChange={setView}
          options={[
            ["curve", t("explore.vCurve")],
            ["graph", t("explore.vGraph")],
          ]}
          label={t("explore.viewAria")}
        />
        {n > 1 && (
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {rows.map((x, k) => (
                <button key={x.token} type="button" aria-label={t("explore.dotAria", { n: k + 1 })} aria-current={k === i} onClick={() => setIdx(k)} className={`h-2 rounded-full transition-[width] ${k === i ? "grad-fill w-6" : "w-2 bg-stroke-2"}`} />
              ))}
            </div>
            <button type="button" aria-label={t("explore.prevFeat")} className={navBtn} onClick={() => setIdx(i - 1)}>
              ‹
            </button>
            <button type="button" aria-label={t("explore.nextFeat")} className={navBtn} onClick={() => setIdx(i + 1)}>
              ›
            </button>
            <button type="button" aria-label={paused ? t("explore.playCarousel") : t("explore.pauseCarousel")} className={navBtn} onClick={() => setPaused((p) => !p)}>
              {paused ? <Play size={12} strokeWidth={1.8} aria-hidden="true" /> : <Pause size={12} strokeWidth={1.8} aria-hidden="true" />}
            </button>
          </div>
        )}
      </div>

      <div className="px-4 pb-5 pt-4 nav:px-6">
        <div className="rounded-xl border border-stroke bg-bg-2/60 p-3" aria-live={paused ? "polite" : "off"}>
          {view === "graph" ? (
            <>
              <div className="flex justify-end">
                <PeriodChips period={period} onPeriod={setPeriod} />
              </div>
              {series.length >= 2 ? <DitherChart series={series} label={chartLabel} orient="vertical" className="mt-2 h-[240px] w-full" /> : <p className="grid h-[240px] place-items-center text-sm text-muted">{t("tcard.tooFew")}</p>}
            </>
          ) : (
            <>
              <CurveBlock row={r} wide />
              {series.length >= 2 ? <DitherChart series={series} label={chartLabel} className="mt-3 h-[70px] w-full" /> : <p className="mono-label mt-3 text-[10px] text-ink-3">{t("tcard.tooFew")}</p>}
            </>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 nav:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <AssetLogo symbol={r.symbol} src={/^https?:\/\//.test(r.logo) ? r.logo : null} size={44} radius={12} />
              <h3 className="truncate text-[clamp(34px,5vw,52px)] font-bold leading-none tracking-[-1px] text-ink">${r.symbol}</h3>
            </div>
            <p className="mono-label mt-2 truncate text-[13px] text-muted">{r.name}</p>
            <div className="mt-3">
              <CreatorChip address={r.deployer} />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {r.description && <p className="line-clamp-3 rounded-xl border border-stroke bg-glass-2 px-5 py-4 text-[15px] leading-[1.7] text-ink">{r.description}</p>}
            <Link href={`/token/${r.token}`} className="mono-label self-end rounded-lg border border-stroke-2 px-5 py-2.5 text-[11px] tracking-[.14em] text-ink-2 transition-colors hover:border-brand hover:text-brand">
              {t("explore.openToken")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Two-way toggle (CURVE / GRAPH, CARDS / LIST). */
export function ViewToggle<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: [V, string][]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-0.5 rounded-full border border-stroke bg-glass-2 p-[3px]">
      {options.map(([v, text]) => (
        <button key={v} type="button" role="tab" aria-selected={v === value} onClick={() => onChange(v)} className={`mono-label rounded-full px-3.5 py-1.5 text-[10.5px] tracking-[.12em] ${v === value ? "bg-stroke-2 text-ink" : "text-ink-3 hover:text-ink-2"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}
