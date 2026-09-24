"use client";

// The overview card (baskvia's Overview / the reference's "YOUR PORTFOLIO"):
//   top:    address chip (avatar · address · copy · hide-amounts eye) (i) · big value with the
//           quote symbol small · freshness pill · one bar segment per position · legend by quote asset
//           | the "started with" card on the right
//   bottom: 24H / 7D / 30D · the chart · the PnL strip
// Everything is in the book's quote asset: the quote with the most value. Other quote assets
// are listed in the legend and grouped in Positions.
import { Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useT } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import { Info } from "@/components/ui/Info";
import { Panel } from "@/components/ui/primitives";
import type { HistoryPeriod, HistoryView } from "@/lib/portfolioHistory";
import type { Holding } from "@/lib/usePortfolio";
import { setHideAmounts } from "@/lib/ui/hideAmounts";
import { shortAddr } from "@/lib/ui/format";
import { HistoryChart, PeriodTabs, PnlStrip, StartedCard } from "./History";

export function Overview({
  address,
  book,
  bookHoldings,
  bookTotal,
  totals,
  status,
  mins,
  hidden,
  m,
  color,
  hist,
  period,
  onPeriod,
  onRefresh,
  onAsset,
}: {
  address: string;
  book: string | null;
  bookHoldings: Holding[];
  bookTotal: number;
  totals: [string, number][];
  status: "idle" | "loading" | "error" | "ready";
  mins: number | null;
  hidden: boolean;
  m: (v: number, d?: number) => string;
  color: (sym: string) => string;
  hist?: HistoryView;
  period: HistoryPeriod;
  onPeriod: (p: HistoryPeriod) => void;
  onRefresh: () => void;
  onAsset?: (token: string) => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const chip = "rounded-md px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:text-brand";
  const pctOf = (h: Holding) => (bookTotal > 0 ? ((h.value ?? 0) / bookTotal) * 100 : 0);
  return (
    <Panel className="relative">
      <div className="mono-label flex flex-wrap items-center gap-2 text-[10.5px] tracking-[.16em] text-ink-3">
        {t("pf.yourPortfolio")} ·
        <span className="inline-flex items-center gap-1 rounded-full border border-stroke bg-glass-2 py-0.5 pl-0.5 pr-1.5 tracking-normal">
          <AddressAvatar address={address} size={18} />
          <span className="tnum px-1 text-[10.5px] text-ink-2">{shortAddr(address)}</span>
          <button
            type="button"
            className={chip}
            aria-label={t("profile.copy")}
            onClick={() =>
              navigator.clipboard?.writeText(address).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                },
                () => {},
              )
            }
          >
            {copied ? t("profile.copied") : <Copy size={12} strokeWidth={1.8} aria-hidden="true" />}
          </button>
          <button type="button" className={chip} aria-pressed={hidden} aria-label={hidden ? t("portfolio.show") : t("portfolio.hide")} title={hidden ? t("portfolio.show") : t("portfolio.hide")} onClick={() => setHideAmounts(!hidden)}>
            {hidden ? <EyeOff size={12} strokeWidth={1.8} aria-hidden="true" /> : <Eye size={12} strokeWidth={1.8} aria-hidden="true" />}
          </button>
        </span>
        <Info text={t("portfolio.infoValue")} />
      </div>

      <div className="flex flex-col gap-5 nav:flex-row nav:items-start nav:justify-between">
        <div className="min-w-0">
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <div className="tnum flex items-start text-[clamp(44px,7vw,84px)] font-light leading-none tracking-[-2px] text-ink">
              {book ? (
                <>
                  {m(bookTotal, 2)}
                  <span className="ml-2 mt-[0.35em] text-[0.32em] tracking-normal text-ink-3">{book}</span>
                </>
              ) : (
                "—"
              )}
            </div>
            <button type="button" onClick={onRefresh} aria-label={t("portfolio.refreshAria")} className="mono-label mb-2 inline-flex items-center gap-1.5 rounded-full border border-stroke px-2.5 py-1 text-[10px] tracking-[.12em] text-ink-3 hover:border-brand hover:text-brand">
              <RefreshCw size={11} strokeWidth={1.8} aria-hidden="true" className={status === "loading" ? "animate-spin" : ""} />
              {status === "loading" ? t("portfolio.reading") : mins == null || mins < 1 ? t("portfolio.readJustNow") : t("portfolio.readAgo", { n: mins })}
            </button>
          </div>
          {status === "error" && (
            <p role="status" className="mt-2 text-[12.5px] text-neg">
              {t("portfolio.errorTitle")}{" "}
              <button type="button" onClick={onRefresh} className="underline">
                {t("portfolio.tryAgain")}
              </button>
            </p>
          )}

          {bookHoldings.length > 0 && (
            <div className="mt-5 max-w-[640px]">
              <div className="flex h-2 gap-[3px]" aria-hidden="true">
                {bookHoldings.map((h) => (
                  <span key={h.row.token} className="h-full rounded-full" style={{ width: `${pctOf(h)}%`, minWidth: 3, background: color(h.row.symbol) }} title={`$${h.row.symbol} ${pctOf(h).toFixed(1)}%`} />
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
                {totals.map(([sym, v]) => (
                  <span key={sym} className="tnum">
                    <span className="mono-label mr-1.5 text-[10px] tracking-[.1em] text-ink-3">{sym}</span>
                    {m(v, 2)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="nav:mt-3">
          <StartedCard h={hist} period={period} sym={book ?? ""} m={m} />
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <PeriodTabs period={period} onPeriod={onPeriod} />
      </div>
      <div className="mt-2">
        <HistoryChart h={hist} m={m} />
      </div>
      <PnlStrip h={hist} period={period} sym={book ?? ""} m={m} onAsset={onAsset} />
    </Panel>
  );
}
