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
