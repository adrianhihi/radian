"use client";

// Transactions this browser sent for a wallet, kept in localStorage. A full
// on-chain history needs the indexer's event scan; this is the honest local
// list ("sent from this browser"), shown on the portfolio page with explorer
// links. Reads and writes are wrapped: a private window records nothing and
// the transaction itself is unaffected.
import { useSyncExternalStore } from "react";

export type TxKind = "buy" | "sell" | "launch" | "claim" | "stake" | "unstake" | "deposit" | "withdraw" | "cancel" | "wallClaim" | "pofClaim" | "referralClaim";

export interface TxRecord {
  hash: string;
  kind: TxKind;
  /** the launch token the transaction was about, when there is one */
  token?: string;
  /** what moved, already formatted for display ("12.5 USDGx", "1,000 RDOG") */
  amount?: string;
  time: number;
}

const KEY = "radian.txlog.v1";
const MAX = 200;
const EMPTY: TxRecord[] = [];
let cache: Record<string, TxRecord[]> | null = null;
const listeners = new Set<() => void>();

function read(): Record<string, TxRecord[]> {
  if (cache) return cache;
  try {
    const x = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    cache = x && typeof x === "object" ? (x as Record<string, TxRecord[]>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function recordTx(address: string, rec: TxRecord): void {
  const all = read();
  const k = address.toLowerCase();
  cache = { ...all, [k]: [rec, ...(all[k] ?? []).filter((r) => r.hash !== rec.hash)].slice(0, MAX) };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota / private mode: this visit only */
  }
  listeners.forEach((f) => f());
}

export function useTxLog(address: string | null | undefined): TxRecord[] {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => (address ? (read()[address.toLowerCase()] ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
}
