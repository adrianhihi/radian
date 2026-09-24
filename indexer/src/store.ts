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
  // launch template (from the router's WallLaunched / PoFLaunched events)
  template?: { kind: "wall"; treasury: Address; staking: Address; ladder?: Address } | { kind: "pof"; vault: Address; pofRouter: Address } | null;
};

// A signed, bounded buy authorization for RadianExecutor, submitted through the API.
export type StoredAuth = {
  authId: string;
  user: Address;
  token: Address;
  auth: {
    user: Address; token: Address; perBuyMax: string; maxGasPrice: string; totalCount: number; minInterval: number; deadline: number; nonce: string;
    // executor v2 only
    asset?: Address; minPerBuy?: string; minTokensPerQuote?: string;
  };
  signature: `0x${string}`;
  createdAt: number; // ms
  count: number;
  lastAt: number; // unix seconds
  status: "active" | "done" | "expired" | "cancelled";
  lastError?: string;
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

// One RadianTreasury event: a fee claim or a flush (buyback + burn + stream).
// The Pound ledger: vault settlements, referral accruals and claims, Pack burns.
export type PoundEvent = {
  txHash: string;
  logIndex: number;
  block: string;
  ts: number; // ms
  kind: "settle" | "burn" | "referralClaim" | "attributed" | "packAdded" | "packSet";
  asset?: string; // quote asset (zero = gas coin)
  intake?: string; toReferrals?: string; toBurn?: string; toTreasury?: string; // settle
  index?: number; token?: string; quoteIn?: string; tokensOut?: string; caller?: string; bounty?: string; // burn / pack
  floor?: string; maxPerBurn?: string; active?: boolean; // packAdded / packSet
  referrer?: string; user?: string; amount?: string; launcher?: boolean; // attributed / referralClaim
};
export type ReferrerAgg = { referrer: string; asset: string; accrued: string; trades: number; lastAt: number };

export type FlywheelEvent = {
  txHash: string;
  logIndex: number;
  block: string;
  ts: number; // ms
  kind: "flush" | "claim" | "claimToken";
  usdcIn?: string; // 18-dec native USDC (flush)
  radianBurned?: string; // 18-dec (flush)
  toStakers?: string; // 18-dec (flush)
  amount?: string; // claim / claimToken
  token?: string; // claimToken
};

export type Identity = { checked: boolean; ok: boolean; mismatches: string[]; checkedAt?: number };

// A holder's signed line on a token's wall (server-verified: signature + balanceOf > 0 at post time).
// `hidden` is set by a moderator's signed message; a new line from the same wallet un-hides it.
export type WallEntry = { address: Address; text: string; time: number; balance?: string; hidden?: boolean };

// A wallet's signed profile (name / bio / X handle without the @); updatedAt = the signed time.
export type Profile = { name: string; bio: string; x: string; updatedAt: number };

type Snapshot = {
  checkpoint: string; // live cursor: last block scanned at the head
  backfillFrom?: string; // history is complete once backfillCursor reaches this (the block the live cursor started from)
  backfillCursor?: string; // last history block scanned, ascending from the factory deploy block; "0" = not started
  launches: Launch[];
  trades: Trade[];
  flywheel?: FlywheelEvent[];
  pound?: PoundEvent[];
  referrers?: ReferrerAgg[];
  auths?: StoredAuth[];
  rescansDone?: string[];
  wall?: Record<string, WallEntry[]>; // token → entries
  logos?: Record<string, string>; // token → creator-signed logo URL (overrides the on-chain logo in views)
  profiles?: Record<string, Profile>; // address → signed profile
  balances?: Record<string, Record<string, string>>; // token → holder → balance (from Transfer events)
  transfers?: string[]; // txHash:logIndex of every Transfer already applied (idempotent rescans)
  transferCursor?: string; // last block whose token Transfers were back-filled (history runs up to the live cursor)
  factory?: string; // the factory this index was built from; a different one means "start over"
};

const SNAPSHOT = process.env.SNAPSHOT_PATH ?? "./radian-index.json";
const BACKUP = `${SNAPSHOT}.bak`;
const MAX_TRADES = Number(process.env.MAX_TRADES ?? 10000);

const legacyKey = (t: Trade) => `${t.txHash.toLowerCase()}:${t.side}:${t.trader.toLowerCase()}`;
const eventKey = (t: Trade) => (t.logIndex != null ? `${t.txHash.toLowerCase()}:${t.logIndex}` : null);

class Store {
  checkpoint = 0n;
  backfillFrom = 0n;
  backfillCursor = 0n;
  launches = new Map<string, Launch>();
  trades: Trade[] = [];
  flywheel: FlywheelEvent[] = [];
  pound: PoundEvent[] = [];
  referrers = new Map<string, ReferrerAgg>(); // `${asset}:${referrer}` → running totals from Attributed events
  private poundKeys = new Set<string>();
  auths = new Map<string, StoredAuth>();
  rescansDone = new Set<string>();
  wall = new Map<string, WallEntry[]>();
  logos = new Map<string, string>();
  profiles = new Map<string, Profile>();
  balances = new Map<string, Map<string, bigint>>();
  private transferKeys = new Set<string>();
  transferCursor = 0n;
  /** the factory address recorded in the loaded snapshot ("" when none) */
  loadedFactory = "";
  /** the factory this process indexes (set by the scanner; written into the snapshot) */
  factory = "";
  identity: Identity = { checked: false, ok: true, mismatches: [] };
  private flywheelKeys = new Set<string>();
  private curveIndex = new Map<string, Launch>();
  // Two indexes: by event (txHash:logIndex) and, for rows that predate
  // logIndex, by the legacy (txHash:side:trader) key.
  private byEvent = new Map<string, Trade>();
  private legacyRows = new Map<string, Trade>();

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
        // Rows with a logIndex first, so legacy duplicates of the same event
        // (written before logIndex existed) are recognised and dropped.
        const rows = [...(s.trades ?? [])].sort((a, b) => (a.logIndex != null ? 0 : 1) - (b.logIndex != null ? 0 : 1));
        for (const t of rows) this.addTrade(t);
        for (const f of s.flywheel ?? []) this.addFlywheel(f);
        for (const r of s.referrers ?? []) this.referrers.set(`${r.asset.toLowerCase()}:${r.referrer.toLowerCase()}`, r);
        for (const e of s.pound ?? []) this.addPound(e, false);
        for (const a of s.auths ?? []) this.auths.set(a.authId.toLowerCase(), a);
        for (const r of s.rescansDone ?? []) this.rescansDone.add(r);
        for (const [k, v] of Object.entries(s.wall ?? {})) this.wall.set(k.toLowerCase(), v);
        for (const [k, v] of Object.entries(s.logos ?? {})) this.logos.set(k.toLowerCase(), v);
        for (const [k, v] of Object.entries(s.profiles ?? {})) this.profiles.set(k.toLowerCase(), v);
        for (const [tok, holders] of Object.entries(s.balances ?? {})) {
          const m = new Map<string, bigint>();
          for (const [h, b] of Object.entries(holders)) m.set(h, BigInt(b));
          this.balances.set(tok.toLowerCase(), m);
        }
        for (const k of s.transfers ?? []) this.transferKeys.add(k);
        this.transferCursor = BigInt(s.transferCursor || "0");
        this.loadedFactory = (s.factory ?? "").toLowerCase();
        console.log(
          `[store] loaded ${path === BACKUP ? "BACKUP " : ""}snapshot: ${this.launches.size} launches, ${this.trades.length} trades (${(s.trades ?? []).length} rows), checkpoint ${this.checkpoint}, backfill ${this.backfillCursor}/${this.backfillFrom}`,
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
      flywheel: this.flywheel.slice(-2000),
      pound: this.pound.slice(-5000),
      referrers: [...this.referrers.values()],
      auths: [...this.auths.values()],
      rescansDone: [...this.rescansDone],
      wall: Object.fromEntries(this.wall),
      logos: Object.fromEntries(this.logos),
      profiles: Object.fromEntries(this.profiles),
      balances: Object.fromEntries([...this.balances].map(([tok, m]) => [tok, Object.fromEntries([...m].filter(([, b]) => b !== 0n).map(([h, b]) => [h, b.toString()]))])),
      transfers: [...this.transferKeys],
      transferCursor: this.transferCursor.toString(),
      factory: this.factory || this.loadedFactory,
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

  // `aggregate` is false when replaying a snapshot (its referrer totals are already stored).
  addPound(e: PoundEvent, aggregate = true): boolean {
    const key = `${e.txHash.toLowerCase()}:${e.logIndex}`;
    if (this.poundKeys.has(key)) return false;
    this.poundKeys.add(key);
    this.pound.push(e);
    if (aggregate && e.kind === "attributed" && e.asset && e.referrer && e.amount) {
      const k = `${e.asset.toLowerCase()}:${e.referrer.toLowerCase()}`;
      const cur = this.referrers.get(k) ?? { referrer: e.referrer, asset: e.asset, accrued: "0", trades: 0, lastAt: 0 };
      cur.accrued = (BigInt(cur.accrued) + BigInt(e.amount)).toString();
      cur.trades += 1;
      cur.lastAt = Math.max(cur.lastAt, e.ts);
      this.referrers.set(k, cur);
    }
    return true;
  }

  addFlywheel(f: FlywheelEvent): boolean {
    const key = `${f.txHash.toLowerCase()}:${f.logIndex}`;
    if (this.flywheelKeys.has(key)) return false;
    this.flywheelKeys.add(key);
    this.flywheel.push(f);
    return true;
  }
  hasFlywheelTx(txHash: string): boolean {
    const h = txHash.toLowerCase();
    return this.flywheel.some((f) => f.txHash.toLowerCase() === h);
  }

  setTemplate(token: string, template: NonNullable<Launch["template"]>): boolean {
    const l = this.launches.get(token.toLowerCase());
    if (!l) return false;
    l.template = template;
    return true;
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

  addTrade(t: Trade) {
    const ek = eventKey(t);
    const lk = legacyKey(t);
    if (ek) {
      if (this.byEvent.has(ek)) return;
      // Same event already stored without a logIndex (pre-upgrade row): upgrade it in place.
      const legacy = this.legacyRows.get(lk);
      if (legacy) {
        legacy.logIndex = t.logIndex;
        legacy.block = t.block;
        legacy.ts = t.ts;
        this.legacyRows.delete(lk);
        this.byEvent.set(ek, legacy);
        return;
      }
      this.byEvent.set(ek, t);
    } else {
      // Legacy row: skip if an event row for the same (hash, side, trader) exists,
      // or another legacy row already covers it.
      if (this.legacyRows.has(lk)) return;
      for (const row of this.byEvent.values()) if (legacyKey(row) === lk) return;
      this.legacyRows.set(lk, t);
    }
    this.trades.push(t);
    if (this.trades.length > MAX_TRADES) {
      // Drop the oldest by time, not by insertion order — backfill inserts old rows late.
      this.trades.sort((a, b) => a.ts - b.ts);
      const dropped = this.trades.splice(0, this.trades.length - MAX_TRADES);
      for (const d of dropped) {
        const dk = eventKey(d);
        if (dk) this.byEvent.delete(dk);
        else this.legacyRows.delete(legacyKey(d));
      }
    }
  }

  recentTrades(limit = 50) {
    return [...this.trades].sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  /**
   * Applies one ERC-20 Transfer of a launch token to the holder balances. Keyed by
   * txHash:logIndex, so a rescanned block changes nothing. Mints (from zero) and
   * burns (to zero) only touch the other side.
   */
  applyTransfer(token: string, from: string, to: string, value: bigint, key: string): boolean {
    const k = key.toLowerCase();
    if (this.transferKeys.has(k)) return false;
    this.transferKeys.add(k);
    const tok = token.toLowerCase();
    let m = this.balances.get(tok);
    if (!m) {
      m = new Map();
      this.balances.set(tok, m);
    }
    const f = from.toLowerCase();
    const t = to.toLowerCase();
    if (f !== ZERO_LC) m.set(f, (m.get(f) ?? 0n) - value);
    if (t !== ZERO_LC) m.set(t, (m.get(t) ?? 0n) + value);
    return true;
  }

  /** Wallets holding the token right now, minus the contracts in `excluded` (curve, locker, pool…). */
  holderCount(token: string, excluded: Set<string>): number {
    const m = this.balances.get(token.toLowerCase());
    if (!m) return 0;
    let n = 0;
    for (const [h, b] of m) if (b > 0n && !excluded.has(h)) n++;
    return n;
  }
  /** Whether any Transfer of this token has been seen (an index with no rows says "unknown", not 0). */
  hasBalances(token: string): boolean {
    return this.balances.has(token.toLowerCase());
  }

  /**
   * Forgets everything derived from the chain (cursors, launches, trades, ledgers, balances) while
   * keeping what people signed off-chain (wall, logos, profiles) and the agent auths. Used when the
   * configured factory differs from the one the snapshot was built from.
   */
  resetIndex() {
    this.checkpoint = 0n;
    this.backfillFrom = 0n;
    this.backfillCursor = 0n;
    this.launches.clear();
    this.curveIndex.clear();
    this.trades = [];
    this.byEvent.clear();
    this.legacyRows.clear();
    this.flywheel = [];
    this.flywheelKeys.clear();
    this.pound = [];
    this.poundKeys.clear();
    this.referrers.clear();
    this.rescansDone.clear();
    this.balances.clear();
    this.transferKeys.clear();
    this.transferCursor = 0n;
  }
}

const ZERO_LC = "0x0000000000000000000000000000000000000000";

export const store = new Store();
