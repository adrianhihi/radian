"use client";
import { useStockPrice, fmtUsd } from "@/lib/stockPrice";
import type { QuoteAsset } from "@/lib/radian";

// Small "STOCK" tag for a paired-market card.
export function StockTag({ standIn }: { standIn: boolean }) {
  return (
    <span className="stock-tag" title={standIn ? "Testnet stand-in for a real tokenized stock" : "Real tokenized stock"}>
      STOCK{standIn ? " · testnet" : ""}
    </span>
  );
}

// Live reference-price line for a stock-denominated market. The price is a
// delayed real-world quote shown only as a human sanity check; the launch trades
// in shares of the token and never reads this number.
export function StockRef({ asset, compact = false }: { asset: QuoteAsset; compact?: boolean }) {
  const { quote, error } = useStockPrice(asset.stock?.refSymbol);
  if (!asset.stock) return null;

  const change =
    quote && quote.prevClose ? ((quote.price - quote.prevClose) / quote.prevClose) * 100 : null;
  const up = change != null && change >= 0;

  return (
    <div className={`stockref${compact ? " compact" : ""}`}>
      <div className="stockref-head">
        <span className="stockref-sym">{asset.stock.refSymbol}</span>
        <span className="stockref-label">reference price</span>
      </div>
      <div className="stockref-body">
        {quote ? (
          <>
            <span className="stockref-px">{fmtUsd(quote.price)}</span>
            {change != null && (
              <span className={`stockref-chg ${up ? "up" : "down"}`}>
                {up ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
              </span>
            )}
          </>
        ) : error ? (
          <span className="stockref-muted">reference unavailable</span>
        ) : (
          <span className="stockref-muted">loading…</span>
        )}
      </div>
      <div className="stockref-foot">
        {asset.stock.standIn
          ? `Trades in ${asset.symbol} — a testnet stand-in for ${asset.stock.refSymbol}. Price via ${quote?.source ?? "Yahoo Finance"}, delayed, off-chain reference only.`
          : `Priced in ${asset.symbol} shares. USD via ${quote?.source ?? "Yahoo Finance"}, delayed reference.`}
      </div>
    </div>
  );
}
