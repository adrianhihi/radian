import type { Address } from "viem";

// Seeded launches (verified on-chain). Inlined rather than JSON-imported to
// avoid default-export shape ambiguity in the client bundle.
const seed: RegistryEntry[] = [
  {
    token: "0xA1d3797855B9e248F27b3a172F31EF7AA5d8ee3A",
    curve: "0x641ba58E316479CB25Eaf348a6B231D604d82404",
    deployer: "0x13E6b6C635CAcD4B27C9309251A4D083457eb11C",
    graduationThreshold: "20000000000000000000",
  },
];

// Arc testnet's public RPCs serve eth_call reliably but eth_getLogs
// inconsistently (lagging / sharded nodes). So launch DISCOVERY uses a
// registry instead of log scans; all live data still comes from eth_call.
// Sources, newest first: the user's own launches (this browser) + a seeded
// list. Phase 4b replaces this with an indexer API.

export type RegistryEntry = {
  token: Address;
  curve: Address;
  deployer: Address;
  graduationThreshold: string; // decimal string (JSON-safe)
};

const LS_KEY = "radian.launches.v1";

function readLocal(): RegistryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as RegistryEntry[]) : [];
  } catch {
    return [];
  }
}

export function addLocalLaunch(entry: RegistryEntry) {
  if (typeof window === "undefined") return;
  try {
    const cur = readLocal();
    if (cur.some((e) => e.token.toLowerCase() === entry.token.toLowerCase())) return;
    window.localStorage.setItem(LS_KEY, JSON.stringify([entry, ...cur]));
  } catch {}
}

export function getRegistry(): RegistryEntry[] {
  const local = readLocal();
  const merged = [...local, ...seed];
  const seen = new Set<string>();
  return merged.filter((e) => {
    const k = e.token.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function findCurve(token: string): RegistryEntry | undefined {
  return getRegistry().find((e) => e.token.toLowerCase() === token.toLowerCase());
}
