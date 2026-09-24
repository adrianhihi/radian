// Colours and logos for tokens and assets. Treemaps, tiles, avatars and
// composition bars share these so the same symbol looks the same everywhere.

/** logo.dev publishable key (pk_, meant to ship in the client bundle). */
export const LOGO_TOKEN = "pk_CisodFgmRhi9IHdz7l-hUQ";

/** Company logo by stock ticker (for stock-quoted markets). */
export const tickerLogoUrl = (ticker: string, size = 64) =>
  `https://img.logo.dev/ticker/${encodeURIComponent(ticker)}?token=${LOGO_TOKEN}&size=${size}&format=png`;

/** Two-letter fallback when there is no image. */
export const monogram = (sym: string | undefined) => String(sym ?? "").slice(0, 2).toUpperCase();

/**
 * Weight → colour on an absolute ember ramp (bigger share = deeper). Absolute,
 * not normalised per set, so 30% looks the same in every split it appears in.
 * Used for fee-split treemaps; capped at 60% (the biggest slice we draw).
 */
const RAMP = ["#fde7cf", "#f6c489", "#e8944c", "#cf6d45", "#a34a32", "#6b2f22"] as const;
const CEILING = 60;

export function weightColor(pct: number): string {
  const t = Math.min(1, Math.max(0, (Number(pct) || 0) / CEILING));
  const x = t * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  return mixColor(RAMP[i], RAMP[i + 1], x - i);
}

const chan = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);

function mixColor(a: string, b: string, t: number): string {
  const p = (i: number) =>
    Math.round(chan(a, i) + (chan(b, i) - chan(a, i)) * t)
      .toString(16)
      .padStart(2, "0");
  return "#" + p(0) + p(1) + p(2);
}

/** Dark or white text for a given background, by relative luminance. */
export function onColor(bg: string): string {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(chan(bg, 0)) + 0.7152 * lin(chan(bg, 1)) + 0.0722 * lin(chan(bg, 2));
  return L > 0.45 ? "#2a1a0e" : "#ffffff";
}

/** Mix a hex colour toward white or black. */
export function mixHex(hex: string, toWhite: boolean, amt: number): string {
  const h = String(hex).replace("#", "");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) || 0;
  const target = toWhite ? 255 : 0;
  const m = (c: number) =>
    Math.round(c + (target - c) * amt)
      .toString(16)
      .padStart(2, "0");
  return "#" + m(n(0)) + m(n(2)) + m(n(4));
}

/**
 * Ten hand-picked warm colours, distinguishable by eye and by lightness, so a
 * symbol keeps one identity colour everywhere (identity, not weight).
 */
const ASSET_PALETTE = [
  "#f6c489", // apricot
  "#e8944c", // ember
  "#f2a5a0", // salmon
  "#cf6d45", // rust
  "#e6d38a", // straw
  "#b56b8a", // plum
  "#c99a5b", // caramel
  "#f0e0c8", // sand
  "#d98a6b", // terracotta
  "#8f5a3c", // umber
] as const;

/** FNV-1a: deterministic on server and client. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  const up = String(s).toUpperCase();
  for (let i = 0; i < up.length; i++) {
    h ^= up.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export const assetColor = (sym: string): string => ASSET_PALETTE[fnv(sym) % ASSET_PALETTE.length];

/** Distinct colours for a set (collisions shift to the next free slot). */
export function assetColors(syms: string[]): Record<string, string> {
  const used = new Set<number>();
  const out: Record<string, string> = {};
  for (const sym of syms) {
    let i = fnv(sym) % ASSET_PALETTE.length;
    for (let k = 0; k < ASSET_PALETTE.length && used.has(i); k++) i = (i + 1) % ASSET_PALETTE.length;
    used.add(i);
    out[sym] = ASSET_PALETTE[i];
  }
  return out;
}
