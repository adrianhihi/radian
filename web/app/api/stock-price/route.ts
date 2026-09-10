import { NextResponse } from "next/server";

// Server-side stock price. Fetched here (not in the browser) because the public
// price APIs don't send CORS headers and Pyth's keyless Hermes endpoint is now
// gated. This is a REFERENCE price only — a human sanity-check shown next to a
// stock-denominated launch. The launchpad contracts never read it; the curve's
// own trading price (in shares) is the real, on-chain price.
//
// Source: Yahoo Finance chart endpoint (keyless). Delayed/last-close quote.

export const revalidate = 30; // cache for 30s across requests

const ALLOWED = new Set(["NVDA", "TSLA", "AAPL", "GOOGL", "SPY", "MSFT", "AMZN", "META"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  if (!ALLOWED.has(symbol)) {
    return NextResponse.json({ error: "unsupported symbol" }, { status: 400 });
  }
  try {
    const y = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 30 } },
    );
    if (!y.ok) throw new Error(`yahoo ${y.status}`);
    const json = (await y.json()) as {
      chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; currency?: string; regularMarketTime?: number } }[] };
    };
    const m = json.chart?.result?.[0]?.meta;
    if (!m?.regularMarketPrice) throw new Error("no price");
    return NextResponse.json(
      {
        symbol,
        price: m.regularMarketPrice,
        prevClose: m.chartPreviousClose ?? null,
        currency: m.currency ?? "USD",
        marketTime: m.regularMarketTime ?? null,
        source: "Yahoo Finance",
      },
      // Public, keyless reference data — let product sites (e.g. the flagship
      // token's own site) read it cross-origin, and let the CDN serve it for 30 s
      // (`revalidate` does nothing for a handler that reads searchParams).
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
