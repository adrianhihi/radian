// Where a launch's trade fee goes, as shares of the fee, for the wizard's live
// preview and the creators page's simulator. The protocol share is the hook's
// policy at launch (protocolFeeShareBps); the creator slice is the rest, and a
// template redirects that slice into its treasury / vault. Where The Pound
// runs, the protocol share pays referrers first, then buys and burns the Pack.
import type { FeeMode, TemplateId } from "./draft";

export type SplitRole = "you" | "buyback" | "treasury" | "vault" | "pound" | "protocol";

export interface SplitRow {
  role: SplitRole;
  /** percent of the trade fee */
  pct: number;
}

export const ROLE_COLOR: Record<SplitRole, string> = {
  you: "var(--brand)",
  buyback: "var(--brand-3)",
  treasury: "var(--signal)",
  vault: "var(--signal)",
  pound: "var(--brand-2)",
  protocol: "var(--ink-3)",
};

/** Rows in display order. `protocolShareBps` defaults to The Pound's 50%. */
export function feeSplit(template: TemplateId, feeMode: FeeMode, protocolShareBps: number | null | undefined, pound: boolean): SplitRow[] {
  const p = Math.min(100, Math.max(0, (protocolShareBps ?? 5000) / 100));
  const creator = 100 - p;
  const tail: SplitRow = { role: pound ? "pound" : "protocol", pct: p };
  if (template === "wall") return [{ role: "treasury", pct: creator }, tail];
  if (template === "pof") return [{ role: "vault", pct: creator }, tail];
  if (feeMode === "buyback") return [{ role: "you", pct: creator / 2 }, { role: "buyback", pct: creator / 2 }, tail];
  return [{ role: "you", pct: creator }, tail];
}

/** The creator's own share of the fee, in percent (0 for the templates: their slice is the contract's). */
export function creatorPct(template: TemplateId, feeMode: FeeMode, protocolShareBps: number | null | undefined): number {
  return feeSplit(template, feeMode, protocolShareBps, true).find((r) => r.role === "you")?.pct ?? 0;
}
