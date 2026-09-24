"use client";

// A token or company logo on a light backing (logo.dev images carry their own
// ground colour; without the backing Apple's black square vanishes on a dark
// panel). A launch token without an image gets a pixel mark generated from
// its address (8×8, mirrored, in the symbol's colour) — the same mark for the
// same token everywhere; anything else falls back to a two-letter monogram.
import { useState } from "react";
import { assetColor, mixHex, monogram, tickerLogoUrl } from "@/lib/ui/tokens";

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pixel mark: the cells to paint as [x, y, colour] (pure; mirrored left–right). */
export function pixelMark(seed: string, color: string): { bg: string; px: [number, number, string][] } {
  const r = rng(seed.toLowerCase());
  const palette = [color, mixHex(color, true, 0.45), mixHex(color, false, 0.35)];
  const px: [number, number, string][] = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 4; x++) {
      if (r() < 0.5) continue;
      const c = palette[Math.floor(r() * palette.length)];
      px.push([x, y, c], [7 - x, y, c]);
    }
  return { bg: mixHex(color, false, 0.72), px };
}

export function AssetLogo({
  symbol,
  src,
  ticker,
  seed,
  size = 24,
  radius = 7,
  className,
}: {
  symbol: string;
  /** image URL (a launch's logo from the indexer) */
  src?: string | null;
  /** stock ticker → logo.dev company logo */
  ticker?: string;
  /** a launch token's address: without an image it gets a pixel mark instead of a monogram */
  seed?: string;
  size?: number;
  radius?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = src || (ticker ? tickerLogoUrl(ticker, size * 3) : null);
  const style = { width: size, height: size, borderRadius: radius } as const;

  if (!url || failed) {
    if (seed) {
      const { bg, px } = pixelMark(seed, assetColor(symbol));
      return (
        <svg aria-hidden="true" width={size} height={size} viewBox="-1 -1 10 10" shapeRendering="crispEdges" className={`block flex-none ${className ?? ""}`} style={{ ...style, background: bg }}>
          {px.map(([x, y, c], i) => (
            <rect key={i} x={x} y={y} width="1" height="1" fill={c} />
          ))}
        </svg>
      );
    }
    return (
      <span className={`mono-label grid flex-none place-items-center bg-glass-2 font-semibold text-ink-2 ${className ?? ""}`} style={{ ...style, fontSize: Math.max(8, size * 0.36) }} aria-hidden="true">
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
