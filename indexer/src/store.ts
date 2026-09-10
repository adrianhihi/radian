import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
  createdAt?: number; // ms
};

export type Trade = {
  txHash: string;
  logIndex?: number; // present for everything scanned after the receipts-based scanner shipped
  block: string;
  ts: number; // ms
  token: Address;
  curve: Address;
  side: "buy" | "sell";
  trader: Address;
  quote: string; // quote-asset leg, in that asset's own decimals
  tokens: string; // token leg (18-dec)
};

type Snapshot = {
  checkpoint: string; // live cursor: last block scanned at the head
  backfillFrom?: string; // history is complete once backfillCursor reaches this (the block the live cursor started from)
  backfillCursor?: string; // last history block scanned, ascending from the factory deploy block; "0" = not started
  launches: Launch[];
  trades: Trade[];
};

const SNAPSHOT = process.env.SNAPSHOT_PATH ?? "./radian-index.json";
const BACKUP = `${SNAPSHOT}.bak`;
const MAX_TRADES = Number(process.env.MAX_TRADES ?? 10000);

class Store {
  checkpoint = 0n;
  backfillFrom = 0n;
  backfillCursor = 0n;
  launches = new Map<string, Launch>();
  trades: Trade[] = [];
  private curveIndex = new Map<string, Launch>();
  private tradeKeys = new Set<string>();

  load() {
    // The live snapshot is written atomically (tmp + rename) and the previous
    // good copy is kept as .bak, so a crash can never leave us with nothing.
    for (const path of [SNAPSHOT, BACKUP]) {
      try {
        if (!existsSync(path)) continue;
        const s = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
        this.checkpoint = BigInt(s.checkpoint || "0");
        this.backfillFrom = BigInt(s.backfillFrom || "0");
        this.backfillCursor = BigInt(s.backfillCursor || "0");
        for (const l of s.launches ?? []) this.upsertLaunch(l);
        for (const t of s.trades ?? []) this.addTrade(t);
        console.log(
          `[store] loaded ${path === BACKUP ? "BACKUP " : ""}snapshot: ${this.launches.size} launches, ${this.trades.length} trades, checkpoint ${this.checkpoint}, backfill ${this.backfillCursor}/${this.backfillFrom}`,
        );
        return;
      } catch (e) {
        console.error(`[store] snapshot ${path} unreadable:`, (e as Error)?.message ?? e);
      }
    }
    console.log("[store] no snapshot, starting fresh");
  }

  save() {
    const snap: Snapshot = {
      checkpoint: this.checkpoint.toString(),
      backfillFrom: this.backfillFrom.toString(),
      backfillCursor: this.backfillCursor.toString(),
      launches: [...this.launches.values()],
      trades: this.trades.slice(-MAX_TRADES),
    };
    const tmp = `${SNAPSHOT}.tmp`;
    try {
      mkdirSync(dirname(SNAPSHOT), { recursive: true });
      writeFileSync(tmp, JSON.stringify(snap));
      if (existsSync(SNAPSHOT)) copyFileSync(SNAPSHOT, BACKUP);
      renameSync(tmp, SNAPSHOT); // atomic on POSIX: readers see old or new, never a torn file
    } catch (e) {
      console.error("[store] snapshot write failed", e);
    }
  }

  upsertLaunch(l: Launch) {
    const k = l.token.toLowerCase();
    const merged = { ...this.launches.get(k), ...l };
    this.launches.set(k, merged);
    this.curveIndex.set(merged.curve.toLowerCase(), merged);
  }

  hasCurve(addr: string): Launch | undefined {
    return this.curveIndex.get(addr.toLowerCase());
  }

  private tradeKey(t: Trade) {
    // logIndex uniquely identifies an event; older snapshots predate it, so
    // fall back to the legacy (hash, side, trader) key for those rows only.
    return t.logIndex != null ? `${t.txHash.toLowerCase()}:${t.logIndex}` : `${t.txHash.toLowerCase()}:${t.side}:${t.trader.toLowerCase()}`;
  }

  addTrade(t: Trade) {
    const k = this.tradeKey(t);
    if (this.tradeKeys.has(k)) return;
    this.tradeKeys.add(k);
    this.trades.push(t);
    if (this.trades.length > MAX_TRADES) {
      // Drop the oldest by time, not by insertion order — backfill inserts old rows late.
      this.trades.sort((a, b) => a.ts - b.ts);
      const dropped = this.trades.splice(0, this.trades.length - MAX_TRADES);
      for (const d of dropped) this.tradeKeys.delete(this.tradeKey(d));
    }
  }

  recentTrades(limit = 50) {
    return [...this.trades].sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
}

export const store = new Store();
