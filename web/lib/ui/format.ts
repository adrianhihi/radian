// Display formatting shared by the new components. Amount formatting for token
// units stays in lib/templates (fmtAmount) until the pages move over.

const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234.5 → $1,234.50 (already a number in dollars) */
export const usd = (n: number): string => usdFmt.format(n);

/** 0xDE00…DE01 */
export const shortAddr = (a: string | null | undefined): string => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

/** +4.28% / -1.32% */
export const pct = (n: number, digits = 2): string => `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;

/** Character whitelist for SVG ids. */
export const svgId = (s: string): string => String(s).replace(/[^A-Za-z0-9_-]/g, "");

/** A curve price (quote per token): 4 significant digits, exponent only when it is truly tiny. */
export const fmtPrice = (n: number): string => {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (n >= 1e-6) return n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  return n.toExponential(2);
};

/** Plain number with at most `digits` decimals, grouped. */
export const fmtNum = (n: number, digits = 2): string => n.toLocaleString(undefined, { maximumFractionDigits: digits });

/** 12s / 4m / 3h / 2d since a ms timestamp. */
export const ago = (ts: number, now = Date.now()): string => {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
