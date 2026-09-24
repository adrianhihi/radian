"use client";

// A wallet's signed profile (name / bio / X handle): the wallet signs a message, the
// indexer verifies it and stores the three fields. Nothing on chain, no gas. The
// message format is the contract with indexer/src/meta.ts; change both or neither.
// Reads go through a module-level cache so the same address is fetched once per page
// load wherever it appears.
import { useSyncExternalStore } from "react";
import type { Address, WalletClient } from "viem";
import { INDEXER_URL, hasIndexer } from "./indexer";

export type Profile = { address: string; name: string; bio: string; x: string; updatedAt: number };
export const PROFILE_LIMITS = { NAME: 32, BIO: 160, X: 15 } as const;

export const profileMessage = (address: string, p: { name: string; bio: string; x: string }, time: number) =>
  `Radian profile\naddress: ${address.toLowerCase()}\nname: ${p.name}\nbio: ${p.bio}\nx: ${p.x}\ntime: ${time}`;

const cpLen = (s: string) => [...s].length;

/** Trims, strips a leading @, refuses `<`, `>` and control characters and over-length fields; null = invalid. */
export function cleanProfile(p: { name: string; bio: string; x: string }): { name: string; bio: string; x: string } | null {
  const name = p.name.trim();
  const bio = p.bio.trim();
  const x = p.x.trim().replace(/^@/, "");
  const bad = /[<>\u0000-\u001f]/;
  if (cpLen(name) > PROFILE_LIMITS.NAME || cpLen(bio) > PROFILE_LIMITS.BIO || bad.test(name) || bad.test(bio)) return null;
  if (x && !/^[A-Za-z0-9_]{1,15}$/.test(x)) return null;
  return { name, bio, x };
}

// undefined = not fetched yet, null = no profile
const cache = new Map<string, Profile | null | undefined>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

async function load(addr: string) {
  if (inflight.has(addr) || !hasIndexer()) return;
  inflight.add(addr);
  try {
    const r = await fetch(`${INDEXER_URL}/profile/${addr}`, { cache: "no-store" });
    const j = r.ok ? ((await r.json()) as { profile: Profile | null }) : { profile: null };
    cache.set(addr, j.profile ?? null);
  } catch {
    cache.set(addr, null);
  } finally {
    inflight.delete(addr);
    emit();
  }
}

/** The profile behind an address: undefined while loading, null when none. One request per address site-wide. */
export function useProfile(address: string | null | undefined): Profile | null | undefined {
  const addr = address ? address.toLowerCase() : null;
  const snap = useSyncExternalStore(subscribe, () => (addr ? cache.get(addr) : null), () => undefined);
  if (addr && !cache.has(addr)) {
    cache.set(addr, undefined);
    void load(addr);
  }
  return snap;
}

export type SaveResult = { ok: true; profile: Profile } | { ok: false; reason: string };

/** Signs and stores the profile; on success the cache is updated so every header re-renders without a refetch. */
export async function saveProfile(wc: { client: WalletClient; account: Address }, p: { name: string; bio: string; x: string }): Promise<SaveResult> {
  const clean = cleanProfile(p);
  if (!clean) return { ok: false, reason: "bad-input" };
  const time = Date.now();
  let signature: string;
  try {
    signature = await wc.client.signMessage({ account: wc.account, message: profileMessage(wc.account, clean, time) });
  } catch {
    return { ok: false, reason: "rejected" };
  }
  try {
    const r = await fetch(`${INDEXER_URL}/profile/${wc.account}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...clean, time, signature }) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; profile?: Profile };
    if (r.ok && j.ok && j.profile) {
      cache.set(wc.account.toLowerCase(), j.profile);
      emit();
      return { ok: true, profile: j.profile };
    }
    return { ok: false, reason: j.error ?? `http-${r.status}` };
  } catch {
    return { ok: false, reason: "network" };
  }
}
