"use client";

// Token colour tile: ~10px radius rectangle tinted by the asset, a white label
// top-left, an optional percentage top-right (wraps under the label when there
// is no room), and a ringed logo bottom-right. Used in fee-split strips, pack
// lists and creator cards.
import { AssetLogo } from "@/components/ui/AssetLogo";

export function TokenTile({
  symbol,
  color,
  label = symbol,
  pct,
  logo = 18,
  logoSrc,
  ticker,
  seed,
  className = "",
  style,
}: {
  symbol: string;
  color: string;
  label?: string;
  pct?: string;
  /** logo size; 0 hides it */
  logo?: number;
  logoSrc?: string | null;
  ticker?: string;
  /** a launch token's address: without an image the logo is its pixel mark */
  seed?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`relative block min-w-0 overflow-hidden rounded-[10px] ${className}`}
      style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${color} 88%, #fff), color-mix(in srgb, ${color} 62%, #000))`, ...style }}
    >
      <span className="absolute inset-x-1.5 top-1.5 flex flex-wrap items-start justify-between gap-x-0.5">
        <span className="max-w-full truncate rounded-[5px] bg-white px-1 text-[10px] font-bold leading-[16px] text-[#111]">{label}</span>
        {pct && <span className="tnum text-[9.5px] font-semibold leading-[16px] text-white [text-shadow:0_1px_2px_rgba(0,0,0,.35)]">{pct}</span>}
      </span>
      {logo > 0 && (
        <span className="absolute bottom-1.5 right-1.5 rounded-full bg-white p-[1.5px] shadow-[0_1px_3px_rgba(0,0,0,.4)]">
          <AssetLogo symbol={symbol} src={logoSrc} ticker={ticker} seed={seed} size={logo} radius={logo / 2} />
        </span>
      )}
    </span>
  );
}
