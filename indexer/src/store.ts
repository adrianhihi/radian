import { readFileSync, writeFileSync } from "node:fs";
import type { Address } from "viem";

// In-memory store with a JSON snapshot on disk. No native deps → deploys
// anywhere (Railway Nixpacks) with zero build friction. Testnet volume is
// tiny; swap for Postgres if this ever needs to scale.

export type Launch = {
  token: Address;
  curve: Address;
  deployer: Address;
  graduationThreshold: string;
  pairToken?: string;
  quoteSymbol?: string;
  quoteDecimals?: number;
  // cached state (refreshed by the scanner)
  name?: string;
  symbol?: string;
  logo?: string;
  description?: string;
  quoteReserve?: string;
  trackedQuote?: string;
  graduated?: boolean;
  buybackLocked?: string;
  createdBlock?: string;
  createdAt?: number;
};

export type Trade = {
  txHash: string;
  block: string;
  ts: number;
  token: Address;
  curve: Address;
  side: "buy" | "sell";
  trader: Address;
  quote: string; // USDC leg (18-dec)
  tokens: string; // token leg (18-dec)
};

type Snapshot = {
  checkpoint: string; // last fully-scanned block
  launches: Launch[];
  trades: Trade[];
};

const SNAPSHOT = process.env.SNAPSHOT_PATH ?? "./radian-index.json";
const MAX_TRADES = 2000;

class Store {
  checkpoint = 0n;
  launches = new Map<string, Launch>();
  trades: Trade[] = [];

  load() {
    try {
      const s = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
      this.checkpoint = BigInt(s.checkpoint || "0");
      for (const l of s.launches) this.launches.set(l.token.toLowerCase(), l);
      this.trades = s.trades ?? [];
      console.log(`[store] loaded snapshot: ${this.launches.size} launches, ${this.trades.length} trades, checkpoint ${this.checkpoint}`);
    } catch {
      console.log("[store] no snapshot, starting fresh");
    }
  }

  save() {
    const snap: Snapshot = {
      checkpoint: this.checkpoint.toString(),
      launches: [...this.launches.values()],
      trades: this.trades.slice(-MAX_TRADES),
    };
    try {
      writeFileSync(SNAPSHOT, JSON.stringify(snap));
    } catch (e) {
      console.error("[store] snapshot write failed", e);
    }
  }

  upsertLaunch(l: Launch) {
    const k = l.token.toLowerCase();
    this.launches.set(k, { ...this.launches.get(k), ...l });
  }

  hasCurve(addr: string): Launch | undefined {
    const a = addr.toLowerCase();
    for (const l of this.launches.values()) if (l.curve.toLowerCase() === a) return l;
    return undefined;
  }

  addTrade(t: Trade) {
    if (this.trades.some((x) => x.txHash === t.txHash && x.side === t.side && x.trader === t.trader)) return;
    this.trades.push(t);
    if (this.trades.length > MAX_TRADES) this.trades = this.trades.slice(-MAX_TRADES);
  }

  recentTrades(limit = 50) {
    return [...this.trades].sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
}

export const store = new Store();
