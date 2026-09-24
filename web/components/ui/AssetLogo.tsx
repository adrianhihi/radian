"use client";

// A token or company logo on a light backing (logo.dev images carry their own
// ground colour; without the backing Apple's black square vanishes on a dark
// panel). Falls back to a two-letter monogram when there is no image or it
// fails to load.
import { useState } from "react";
import { monogram, tickerLogoUrl } from "@/lib/ui/tokens";

export function AssetLogo({
  symbol,
  src,
  ticker,
  size = 24,
  radius = 7,
  className,
}: {
  symbol: string;
  /** image URL (a launch's logo from the indexer) */
  src?: string | null;
  /** stock ticker → logo.dev company logo */
  ticker?: string;
  size?: number;
  radius?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = src || (ticker ? tickerLogoUrl(ticker, size * 3) : null);
  const style = { width: size, height: size, borderRadius: radius } as const;

  if (!url || failed) {
    return (
      <span
        className={`mono-label grid flex-none place-items-center bg-glass-2 font-semibold text-ink-2 ${className ?? ""}`}
        style={{ ...style, fontSize: Math.max(8, size * 0.36) }}
        aria-hidden="true"
      >
        {monogram(symbol)}
      </span>
    );
  }

  return (
    <span className={`grid flex-none place-items-center overflow-hidden bg-white ${className ?? ""}`} style={style} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </span>
  );
}
