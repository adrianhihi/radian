"use client";
import { isAddress, type Address } from "viem";
import { readLS, writeLS } from "./ui/storage";

// Referral tags. A link like /?ref=0xABC… (or /r/0xABC…) stores the referrer for
// 30 days in this browser; every router trade and launch then carries it, and
// the PoundVault credits the referrer its share of the fee. Self-referrals are
// dropped on chain, so nothing here needs to know who the viewer is.
const KEY = "radian.ref";
const TTL_MS = 30 * 24 * 3600 * 1000;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export function captureReferrer(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    let ref = url.searchParams.get("ref");
    const m = url.pathname.match(/^\/r\/(0x[0-9a-fA-F]{40})$/);
    if (!ref && m) ref = m[1];
    if (ref && isAddress(ref)) {
      writeLS(KEY, JSON.stringify({ ref, at: Date.now() }));
    }
  } catch {}
}

export function getReferrer(): Address {
  if (typeof window === "undefined") return ZERO_ADDRESS;
  try {
    const raw = readLS(KEY);
    if (!raw) return ZERO_ADDRESS;
    const { ref, at } = JSON.parse(raw) as { ref: string; at: number };
    if (!isAddress(ref) || Date.now() - at > TTL_MS) return ZERO_ADDRESS;
    return ref as Address;
  } catch {
    return ZERO_ADDRESS;
  }
}

export function referralLink(address: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://radian-sable.vercel.app";
  return `${origin}/?ref=${address}`;
}
