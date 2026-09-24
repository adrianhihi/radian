"use client";

// Live reference-price line for a stock-denominated market. The price is a
// delayed real-world quote shown only as a human sanity check; the launch
// trades in shares of the token and never reads this number.
import { useT } from "@/components/LangProvider";
import { useStockPrice, fmtUsd } from "@/lib/stockPrice";
import type { QuoteAsset } from "@/lib/radian";

export function StockTag({ standIn }: { standIn: boolean }) {
  const t = useT();
  return <span className="mono-label ml-2 inline-block rounded-md border border-signal/50 px-1.5 py-px align-middle text-[9.5px] uppercase tracking-[.1em] text-signal">{standIn ? `${t("create.stockTag")} · ${t("create.stockTest")}` : t("create.stockTag")}</span>;
}

export function StockRef({ asset, compact = false }: { asset: QuoteAsset; compact?: boolean }) {
  const t = useT();
  const { quote, error } = useStockPrice(asset.stock?.refSymbol);
  if (!asset.stock) return null;
  const change = quote && quote.prevClose ? ((quote.price - quote.prevClose) / quote.prevClose) * 100 : null;
  return (
    <div className={`rounded-[14px] border border-stroke bg-glass-2 ${compact ? "px-3.5 py-2.5" : "px-4 py-3"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="mono-label text-[10.5px] tracking-[.14em] text-ink-3">
          <b className="text-[13px] tracking-normal text-ink">{asset.stock.refSymbol}</b> · {t("create.refPrice")}
        </span>
        <span className="tnum text-[15px] text-ink">
          {quote ? (
            <>
              {fmtUsd(quote.price)}
              {change != null && <span className={`ml-2 text-[12px] ${change >= 0 ? "text-pos" : "text-neg"}`}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%</span>}
            </>
          ) : error ? (
            <span className="text-[12px] text-ink-3">{t("create.refUnavailable")}</span>
          ) : (
            <span className="text-[12px] text-ink-3">{t("create.refLoading")}</span>
          )}
        </span>
      </div>
      {!compact && <p className="mt-1.5 text-[11.5px] leading-[1.6] text-ink-3">{t("create.refNote", { sym: asset.symbol, src: quote?.source ?? "Yahoo Finance" })}</p>}
    </div>
  );
}
