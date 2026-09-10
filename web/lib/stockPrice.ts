"use client";
import { useEffect, useRef, useState } from "react";

// Reference USD price for a stock ticker, via our own /api/stock-price route
// (same-origin — no CORS). This is a delayed human reference shown next to a
// stock-denominated launch; the launchpad never reads it on-chain.

export type StockQuote = { price: number; prevClose: number | null; currency: string; source: string };

export function useStockPrice(symbol?: string, intervalMs = 30_000) {
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [error, setError] = useState(false);
  const symRef = useRef(symbol);
  symRef.current = symbol;

  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/stock-price?symbol=${encodeURIComponent(symbol)}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as StockQuote;
        if (alive && typeof json.price === "number") {
          setQuote(json);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol, intervalMs]);

  return { quote, error };
}

export const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
