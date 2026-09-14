"use client";
import { useEffect, useRef } from "react";
import type { Hex, TransactionReceipt } from "viem";
import { publicClient } from "./radian";
import { getActiveNetworkKey } from "./networks";

// "Unknown result" transaction semantics. Once a wallet has returned a hash the
// transaction may land even if this tab loses the receipt (RPC timeout, tab
// closed). So every hash is recorded before we wait, a lost receipt keeps the
// record instead of being reported as a failure, and the record is resolved
// from chain on the next visit. Nothing here ever resends a transaction.

export type PendingKind = "launch" | "buy" | "sell" | "approve" | "stake" | "claim" | "unstake";
export type PendingTx = { hash: Hex; kind: PendingKind; createdAt: number; meta?: Record<string, string> };

const KEY = () => `radian.pending.${getActiveNetworkKey()}`;
const STALE_MS = 24 * 3600 * 1000;

export function listPending(): PendingTx[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY());
    return raw ? (JSON.parse(raw) as PendingTx[]) : [];
  } catch {
    return [];
  }
}
function write(list: PendingTx[]) {
  try {
    window.localStorage.setItem(KEY(), JSON.stringify(list));
  } catch {}
}
export function addPending(p: PendingTx) {
  write([...listPending().filter((x) => x.hash !== p.hash), p]);
}
export function removePending(hash: Hex) {
  write(listPending().filter((x) => x.hash !== hash));
}

export class ReceiptTimeout extends Error {
  hash: Hex;
  constructor(hash: Hex) {
    super("Submitted, but not confirmed yet.");
    this.hash = hash;
  }
}

/**
 * Waits for `hash` to be mined. A reverted tx throws a normal error and drops
 * the record. A timeout or RPC failure throws `ReceiptTimeout` and KEEPS the
 * record: the result is unknown, not failed.
 */
export async function waitReceipt(hash: Hex, kind: PendingKind, meta?: Record<string, string>, timeoutMs = 45_000): Promise<TransactionReceipt> {
  addPending({ hash, kind, createdAt: Date.now(), meta });
  let receipt: TransactionReceipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs });
  } catch {
    throw new ReceiptTimeout(hash);
  }
  removePending(hash);
  if (receipt.status !== "success") throw new Error("Transaction reverted on-chain.");
  return receipt;
}

/** Resolves recorded-but-unconfirmed transactions of the given kinds from chain. */
export function usePendingResume(kinds: PendingKind[], onResolved: (p: PendingTx, receipt: TransactionReceipt) => void) {
  const cb = useRef(onResolved);
  cb.current = onResolved;
  const key = kinds.join(",");
  useEffect(() => {
    let alive = true;
    const run = async () => {
      for (const p of listPending().filter((x) => kinds.includes(x.kind))) {
        try {
          const r = await publicClient.getTransactionReceipt({ hash: p.hash });
          if (!alive) return;
          removePending(p.hash);
          if (r.status === "success") cb.current(p, r);
        } catch {
          // not mined yet, or the RPC is down: keep it unless it is stale
          if (Date.now() - p.createdAt > STALE_MS) removePending(p.hash);
        }
      }
    };
    run();
    const t = setInterval(run, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
