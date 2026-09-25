"use client";

// The curve as a picture (the slot baskvia's holdings treemap takes): two colour tiles,
// the token on the left growing with bonding progress, the quote asset on the right
// shrinking toward the goal; one signal-coloured tile once the token has graduated.
// Same TokenTile as the fee-split strips and the portfolio picture, so every "tile"
// on the site is the same object. Layout shares are clamped so both labels stay
// readable; the printed percentages are the real ones.
import { useT } from "@/components/LangProvider";
import { TokenTile } from "@/components/ui/TokenTile";
import { assetColor } from "@/lib/ui/tokens";

/** the quote tile: a cool tone from the ground's own family, so the ember token tile reads as "filled" */
const QUOTE_TILE = "#5d7fb6";
const POOL_TILE = "#4fb8c9";

export function CurveTiles({
  symbol,
  token,
  logo,
  quoteSymbol,
  quoteTicker,
  progress,
  graduated,
  height = 96,
  radius = 12,
  className = "",
}: {
  symbol: string;
  /** the launch token's address (seeds the pixel mark when there is no logo) */
  token?: string;
  logo?: string | null;
  quoteSymbol: string;
  /** the quote asset's real stock ticker, for its company logo */
  quoteTicker?: string;
  /** 0..1 toward graduation */
  progress: number;
  graduated: boolean;
  height?: number;
  radius?: number;
  className?: string;
}) {
  const t = useT();
  const p = graduated ? 1 : Math.min(1, Math.max(0, progress));
  const pctText = `${Math.round(p * 1000) / 10}%`;
  const src = logo && /^https?:\/\//.test(logo) ? logo : null;
  const big = height >= 120;
  const logoSize = big ? 30 : height >= 80 ? 20 : 0;
  if (graduated) {
    return (
      <div role="img" aria-label={t("tcard.progressAria", { p: 100 })} className={`flex ${className}`} style={{ height }}>
        <TokenTile symbol={symbol} logoSrc={src} seed={token} color={POOL_TILE} label={`$${symbol}`} pct={t("tcard.tilePool")} logo={logoSize} style={{ flex: "1 1 0", borderRadius: radius }} />
      </div>
    );
  }
  const share = Math.min(0.8, Math.max(0.24, p));
  return (
    <div role="img" aria-label={t("tcard.progressAria", { p: Math.round(p * 1000) / 10 })} className={`flex gap-1 ${className}`} style={{ height }}>
      <TokenTile symbol={symbol} logoSrc={src} seed={token} color={assetColor(symbol)} label={`$${symbol}`} pct={pctText} logo={logoSize} style={{ flex: `${share * 100} 1 0`, borderRadius: radius }} />
      <TokenTile symbol={quoteSymbol} ticker={quoteTicker} color={QUOTE_TILE} label={quoteSymbol} pct={`${Math.round((1 - p) * 1000) / 10}%`} logo={share < 0.7 ? logoSize : 0} style={{ flex: `${(1 - share) * 100} 1 0`, borderRadius: radius }} />
    </div>
  );
}
