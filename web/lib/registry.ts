import type { Address } from "viem";

// Seeded launches (verified on-chain). Inlined rather than JSON-imported to
// avoid default-export shape ambiguity in the client bundle.
const DEV = "0x13E6b6C635CAcD4B27C9309251A4D083457eb11C" as Address;
const G = "20000000000000000000";
const seed: RegistryEntry[] = [
  // newest first; all launched + funded on Arc testnet via the live factory
  { token: "0xDe25b6d469f5607F830e4340FF7f70C2C362537f", curve: "0x0c1fd7F6838F2B73Cd035D73ae5619E05bF34b77", deployer: DEV, graduationThreshold: G },
  { token: "0xbDd735b3589420F9A4C3f31f080D1163eFa23f1F", curve: "0x2be563704A6290F6701378b392b4dFfd439e24Cd", deployer: DEV, graduationThreshold: G },
  { token: "0x2C1E7E5aC36cf54422ac035c7F008C2bCAC85988", curve: "0xEaab57d5180284E25bf909f0A9D282CB94C0E3CF", deployer: DEV, graduationThreshold: G },
  { token: "0xE34ca36154f0852DA8BCa8E350E54AFA114BFC34", curve: "0x246c72AF2b08D428adf1801AC63084bf39BcA271", deployer: DEV, graduationThreshold: G },
  { token: "0xfE829A204B07FFb7f3454077fc7c9B3f8a2d3c45", curve: "0x12a9598cF9680046F2F6Cb10DE8707F535D584e1", deployer: DEV, graduationThreshold: G },
  { token: "0xA1d3797855B9e248F27b3a172F31EF7AA5d8ee3A", curve: "0x641ba58E316479CB25Eaf348a6B231D604d82404", deployer: DEV, graduationThreshold: G },
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
