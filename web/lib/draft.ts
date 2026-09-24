// The launch wizard's draft: what the person has typed, kept in this browser so
// a refresh (or the creators page's quick start) does not lose it. Pure logic,
// no React except the hydration gate, so the pages only render.
import { useSyncExternalStore } from "react";
import { isAddress } from "viem";
import { POF_DEFAULTS, WALL_DEFAULTS, type PoFConfigInput, type WallConfigInput } from "./templates";

export type TemplateId = "standard" | "wall" | "pof";
export type FeeMode = "buyback" | "creator";

export interface LaunchDraft {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  website: string;
  twitter: string;
  /** QuoteAsset.key on the active network; "" = the network's featured asset */
  quoteKey: string;
  template: TemplateId;
  feeMode: FeeMode;
  /** creator tax in percent (string as typed) */
  creatorTax: string;
  feeRecipient: string;
  wall: WallConfigInput;
  pof: PoFConfigInput;
  /** the creator's first buy, in quote units (string as typed) */
  firstBuy: string;
}

export const DRAFT_KEY = "radian.draft.v1";
export const NAME_MAX = 32;
export const SYMBOL_MAX = 10;
export const DESC_MAX = 280;

export const emptyDraft = (): LaunchDraft => ({
  name: "",
  symbol: "",
  logo: "",
  description: "",
  website: "",
  twitter: "",
  quoteKey: "",
  template: "standard",
  feeMode: "buyback",
  creatorTax: "0",
  feeRecipient: "",
  wall: { ...WALL_DEFAULTS },
  pof: { ...POF_DEFAULTS },
  firstBuy: "",
});

/** Tickers are upper-case letters and digits only; typing lower case is fine, it is normalised here. */
export const cleanSymbol = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, SYMBOL_MAX);

const str = (v: unknown, max = 400): string => (typeof v === "string" ? v.slice(0, max) : "");

export function saveDraft(d: LaunchDraft): void {
  try {
    const has = d.name || d.symbol || d.description || d.logo || d.firstBuy;
    if (has) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* private mode / quota: the draft lives in memory for this visit */
  }
}

/** Read the draft back. Anything malformed collapses to the default for that field, never to a crash. */
export function loadDraft(): LaunchDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown> | null;
    if (!p || typeof p !== "object") return null;
    const e = emptyDraft();
    const wall = (p.wall ?? {}) as Record<string, unknown>;
    const pof = (p.pof ?? {}) as Record<string, unknown>;
    const pick = <T extends Record<string, string>>(base: T, src: Record<string, unknown>): T =>
      Object.fromEntries(Object.keys(base).map((k) => [k, typeof src[k] === "string" ? (src[k] as string).slice(0, 24) : base[k]])) as T;
    return {
      name: str(p.name, NAME_MAX),
      symbol: cleanSymbol(str(p.symbol, 32)),
      logo: str(p.logo, 512),
      description: str(p.description, DESC_MAX),
      website: str(p.website, 200),
      twitter: str(p.twitter, 100),
      quoteKey: str(p.quoteKey, 32),
      template: p.template === "wall" || p.template === "pof" ? p.template : "standard",
      feeMode: p.feeMode === "creator" ? "creator" : "buyback",
      creatorTax: str(p.creatorTax, 8) || "0",
      feeRecipient: str(p.feeRecipient, 64),
      wall: pick(e.wall, wall),
      pof: pick(e.pof, pof),
      firstBuy: str(p.firstBuy, 32),
    };
  } catch {
    return null;
  }
}

// Hydration gate: the draft exists only in the browser. The server snapshot is
// false, so the first client frame matches the server HTML; React re-renders
// once with true and only then is localStorage read.
const noopSubscribe = () => () => {};
export const useHydrated = (): boolean => useSyncExternalStore(noopSubscribe, () => true, () => false);

// ---- validation ----

// Angle brackets, quotes, backticks, backslashes and control characters are refused at input
// time, not only escaped at render: a name is a name. The description is a textarea, so line
// breaks and tabs stay allowed there.
export const NAME_BAD = /[<>"'`\\\x00-\x1f]/;
export const DESC_BAD = /[<>`\x00-\x08\x0b\x0c\x0e-\x1f]/;
export const nameCharsOk = (v: string) => !NAME_BAD.test(v);
export const descCharsOk = (v: string) => !DESC_BAD.test(v);

export const httpOk = (u: string) => !u.trim() || /^https?:\/\/\S+$/i.test(u.trim());
export const handleOk = (v: string) => !v.trim() || /^@?[A-Za-z0-9_]{1,15}$/.test(v.trim()) || /^https?:\/\/(x|twitter)\.com\/\S+$/i.test(v.trim());
export const taxOk = (v: string, maxPct: number) => {
  const n = Number(v || 0);
  return Number.isFinite(n) && n >= 0 && n <= maxPct;
};
export const recipientOk = (v: string) => !v.trim() || isAddress(v.trim());
export const amountOk = (v: string) => {
  if (!v.trim()) return true;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
};

/** Step 1 is complete when the token has a valid name and ticker and the links parse. */
export const nameDone = (d: LaunchDraft) =>
  d.name.trim().length > 0 && d.name.trim().length <= NAME_MAX && nameCharsOk(d.name) && descCharsOk(d.description) && /^[A-Z0-9]{1,10}$/.test(d.symbol) && httpOk(d.website) && handleOk(d.twitter);
