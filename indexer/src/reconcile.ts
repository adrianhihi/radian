import { formatUnits, parseAbi, type Address } from "viem";
import { store } from "./store.js";
import {
  singleClient,
  FACTORY,
  curveReadAbi,
  quoteMeta,
  HAS_POUND,
  POUND_VAULT,
  poundVaultAbi,
  HAS_RADIAN,
  RADIAN,
  treasuryAbi,
  RADIAN_QUOTE_DECIMALS,
  RADIAN_QUOTE_SYMBOL,
} from "./config.js";

// Reconciliation: re-derive what the index claims from the chain at ONE block and compare.
//
//   registry        every indexed launch's curve / deployer / pair token / threshold  ==  factory.getLaunchedToken(token)
//   supply          Σ tracked holder balances (curve, locker, pool… included)          ==  token.totalSupply()
//   reserve         curve.trackedQuote()                                                ≤  Σ buys.quoteIn − Σ sells.quoteOut
//                   (fee sweeps to the protocol and the creator leave the curve without a trade event, so the chain
//                   figure can sit below the trade sum, never above it; graduated curves hold nothing and are skipped)
//   pound.*         Σ Attributed == totalPending + totalReferrals · Σ ReferralClaimed == totalReferrals ·
//                   Σ Settled legs == totalBurned / totalTreasury / (reserve + totalReferrals), per quote asset
//   radian.flushed  Σ Flushed == treasury.totalFlushed / totalBurned / totalToStakers
//
// Every chain read is pinned to the index's live checkpoint (`through`) with `blockNumber`, so both sides describe
// the same moment. The index-side sums are taken synchronously before the first await, so a scanner tick cannot move
// the checkpoint under them. A read that fails makes its check fail with the error in `detail`: never a silent pass.
// The report is cached for 60 s and one in-flight computation is shared by concurrent requests.
//
// Not derivable, so not checked: a launch count (PonsV2LaunchFactory keeps no counter or token list), the factory
// owner (the store caches nothing about it; a live read against another live read proves nothing about the index),
// and an exact curve reserve (the sweep amounts are not indexed).

export type Check = { key: string; label: string; ok: boolean; expected: string; actual: string; detail?: string };
export type Report = { block: number; computedAt: number; allOk: boolean; checks: Check[] };

const TTL_MS = Number(process.env.RECONCILE_TTL_MS ?? 60_000);
// Mirrors of the store's retention caps (store.ts keeps them private): once a ledger is at its cap, older rows may
// have been dropped and its sum is a lower bound, so the comparison becomes `≤` and says so.
const MAX_TRADES = Number(process.env.MAX_TRADES ?? 10000);
const FLYWHEEL_CAP = 2000;
const POUND_CAP = 5000;

const ZERO = "0x0000000000000000000000000000000000000000";
const registryAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))",
]);
const supplyAbi = parseAbi(["function totalSupply() view returns (uint256)"]);

type Registry = { curve: Address; deployer: Address; pairToken: Address; graduationThreshold: bigint; exists: boolean };
type MC = { status: "success" | "failure"; result?: unknown; error?: unknown };
type Row = { ok: boolean; note?: string };

const lc = (s: string) => s.toLowerCase();
const errMsg = (e: unknown) => String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e).split("\n")[0];
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Human amount: thousands separators, at most 6 decimals, trailing zeros trimmed. */
function amount(v: bigint, decimals: number, symbol?: string): string {
  const s = formatUnits(v, decimals);
  const neg = s.startsWith("-");
  const [i, f = ""] = (neg ? s.slice(1) : s).split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = f.slice(0, 6).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}${symbol ? ` ${symbol}` : ""}`;
}

async function read(contracts: unknown[], blockNumber: bigint): Promise<MC[]> {
  if (contracts.length === 0) return [];
  return (await singleClient.multicall({ contracts: contracts as never, allowFailure: true, blockNumber })) as MC[];
}

/** One check for a family of per-item comparisons: counts in expected/actual, the first mismatch in detail. */
function grouped(key: string, label: string, rows: Row[], caveat?: string): Check {
  const bad = rows.filter((r) => !r.ok);
  const first = bad.find((r) => r.note)?.note;
  const detail = [first ? `${first}${bad.length > 1 ? ` (+${bad.length - 1} more)` : ""}` : "", caveat ?? ""].filter(Boolean).join(" · ");
  return {
    key,
    label,
    ok: bad.length === 0,
    expected: `${rows.length} match`,
    actual: bad.length ? `${rows.length - bad.length} match, ${bad.length} differ` : `${rows.length} match`,
    ...(detail ? { detail } : {}),
  };
}

/** A check whose whole read failed: fails loudly with the reason. */
const failed = (key: string, label: string, expected: string, e: unknown): Check => ({ key, label, ok: false, expected, actual: "read failed", detail: `RPC: ${errMsg(e)}` });

/** Σ over a list, as bigint, of one string field. */
const sum = <T>(rows: T[], pick: (r: T) => string | undefined) => rows.reduce((n, r) => n + BigInt(pick(r) ?? "0"), 0n);

async function compute(): Promise<Report> {
  const block = store.checkpoint;
  const computedAt = Date.now();
  if (block === 0n) return { block: 0, computedAt, allOk: true, checks: [] };

  // ---- index side, synchronously (no await before this section ends) ----
  const launches = [...store.launches.values()];
  const nameOf = (l: { symbol?: string; token: string }) => (l.symbol ? `$${l.symbol}` : "token") + ` ${short(l.token)}`;
  const balanceSums = new Map<string, bigint>();
  for (const l of launches) {
    if (!store.hasBalances(l.token)) continue;
    let s = 0n;
    for (const b of store.balances.get(lc(l.token))?.values() ?? []) s += b;
    balanceSums.set(lc(l.token), s);
  }
  const backfillDone = store.backfillCursor >= store.backfillFrom;
  const tradesCapped = store.trades.length >= MAX_TRADES;
  const tradeSums = new Map<string, bigint>();
  if (backfillDone && !tradesCapped) {
    for (const t of store.trades) {
      if (BigInt(t.block) > block) continue;
      const k = lc(t.token);
      const q = BigInt(t.quote);
      tradeSums.set(k, (tradeSums.get(k) ?? 0n) + (t.side === "buy" ? q : -q));
    }
  }
  const transferCursor = store.transferCursor;

  // The Pound ledger per quote asset. Attributions come from the running aggregates (kept whole); claims and
  // settlements from the event ledger (capped).
  type PoundSums = { attributed: bigint; claimed: bigint; toBurn: bigint; toTreasury: bigint; toReferrals: bigint };
  const poundAssets = new Set<string>();
  const poundSums = new Map<string, PoundSums>();
  const poundCapped = store.pound.length >= POUND_CAP;
  const ps = (asset: string): PoundSums => {
    const k = lc(asset);
    poundAssets.add(k);
    let s = poundSums.get(k);
    if (!s) poundSums.set(k, (s = { attributed: 0n, claimed: 0n, toBurn: 0n, toTreasury: 0n, toReferrals: 0n }));
    return s;
  };
  if (HAS_POUND) {
    poundAssets.add(ZERO);
    for (const l of launches) poundAssets.add(lc(l.pairToken ?? ZERO));
    for (const r of store.referrers.values()) ps(r.asset).attributed += BigInt(r.accrued);
    for (const e of store.pound) {
      if (BigInt(e.block) > block || !e.asset) continue;
      if (e.kind === "referralClaim") ps(e.asset).claimed += BigInt(e.amount ?? "0");
      else if (e.kind === "settle") {
        const s = ps(e.asset);
        s.toBurn += BigInt(e.toBurn ?? "0");
        s.toTreasury += BigInt(e.toTreasury ?? "0");
        s.toReferrals += BigInt(e.toReferrals ?? "0");
      }
    }
  }

  const flywheelCapped = store.flywheel.length >= FLYWHEEL_CAP;
  const flushes = store.flywheel.filter((f) => f.kind === "flush" && BigInt(f.block) <= block);
  const flushSums = { usdcIn: sum(flushes, (f) => f.usdcIn), burned: sum(flushes, (f) => f.radianBurned), toStakers: sum(flushes, (f) => f.toStakers) };

  // ---- chain side, every read at `block` ----
  const checks: Check[] = [];

  // registry: the factory's own record of each indexed launch
  if (launches.length) {
    const label = "Launches match the factory registry";
    try {
      const res = await read(launches.map((l) => ({ address: FACTORY, abi: registryAbi, functionName: "getLaunchedToken", args: [l.token] })), block);
      const rows: Row[] = launches.map((l, i) => {
        const r = res[i];
        if (r?.status !== "success") return { ok: false, note: `${nameOf(l)}: read failed (${errMsg(r?.error)})` };
        const g = r.result as Registry;
        if (!g.exists) return { ok: false, note: `${nameOf(l)}: the factory has no record of it` };
        const diffs: string[] = [];
        if (lc(g.curve) !== lc(l.curve)) diffs.push(`curve ${g.curve} on chain, ${l.curve} indexed`);
        if (lc(g.deployer) !== lc(l.deployer)) diffs.push(`deployer ${g.deployer} on chain, ${l.deployer} indexed`);
        if (l.pairToken && lc(g.pairToken) !== lc(l.pairToken)) diffs.push(`pair token ${g.pairToken} on chain, ${l.pairToken} indexed`);
        if (g.graduationThreshold !== BigInt(l.graduationThreshold)) diffs.push(`graduation threshold ${g.graduationThreshold} on chain, ${l.graduationThreshold} indexed`);
        return diffs.length ? { ok: false, note: `${nameOf(l)}: ${diffs.join("; ")}` } : { ok: true };
      });
      checks.push(grouped("registry", label, rows));
    } catch (e) {
      checks.push(failed("registry", label, `${launches.length} match`, e));
    }
  }

  // supply: the holder ledger against the token
  const withBalances = launches.filter((l) => balanceSums.has(lc(l.token)));
  if (withBalances.length) {
    const label = "Holder balances add up to total supply";
    try {
      const res = await read(withBalances.map((l) => ({ address: l.token, abi: supplyAbi, functionName: "totalSupply" })), block);
      const rows: Row[] = withBalances.map((l, i) => {
        const r = res[i];
        if (r?.status !== "success") return { ok: false, note: `${nameOf(l)}: read failed (${errMsg(r?.error)})` };
        const supply = r.result as bigint;
        const tracked = balanceSums.get(lc(l.token))!;
        return tracked === supply ? { ok: true } : { ok: false, note: `${nameOf(l)}: Σ balances ${amount(tracked, 18)} vs totalSupply ${amount(supply, 18)}` };
      });
      const caveat = rows.some((r) => !r.ok) && transferCursor < block ? `holder history is back-filled through block ${transferCursor}; a difference can still be the back-fill` : undefined;
      checks.push(grouped("supply", label, rows, caveat));
    } catch (e) {
      checks.push(failed("supply", label, `${withBalances.length} match`, e));
    }
  }

  // reserve: only once the trade log is complete (history back-filled, nothing evicted)
  if (launches.length && backfillDone && !tradesCapped) {
    const label = "Curve quote held is within the indexed trade sum";
    const caveat = "fee sweeps to the protocol and the creator leave a curve without a trade event, so the chain figure may sit below the trade sum, never above it";
    try {
      const res = await read(
        launches.flatMap((l) => [
          { address: l.curve, abi: curveReadAbi, functionName: "graduated" },
          { address: l.curve, abi: curveReadAbi, functionName: "trackedQuote" },
        ]),
        block,
      );
      const rows: Row[] = [];
      launches.forEach((l, i) => {
        const g = res[i * 2];
        const q = res[i * 2 + 1];
        if (g?.status !== "success" || q?.status !== "success") {
          rows.push({ ok: false, note: `${nameOf(l)}: read failed (${errMsg((g?.status !== "success" ? g : q)?.error)})` });
          return;
        }
        if (g.result === true) return; // graduated: the curve hands its reserve to the pool; nothing to compare
        const held = q.result as bigint;
        const traded = tradeSums.get(lc(l.token)) ?? 0n;
        const m = quoteMeta(l.pairToken);
        rows.push(held <= traded ? { ok: true } : { ok: false, note: `${nameOf(l)}: curve holds ${amount(held, m.decimals, m.symbol)}, trades sum to ${amount(traded, m.decimals, m.symbol)}` });
      });
      checks.push(grouped("reserve", label, rows, caveat));
    } catch (e) {
      checks.push(failed("reserve", label, `${launches.length} match`, e));
    }
  }

  // The Pound: per quote asset, the ledger against the vault's counters
  if (HAS_POUND) {
    const assets = [...poundAssets];
    const per = 5;
    const labels = {
      attributed: "Referral accruals equal the vault's pending plus claimed",
      claimed: "Referral claims equal the vault's claimed total",
      settled: "Settlements equal the vault's burn, treasury and referral totals",
    };
    try {
      const res = await read(
        assets.flatMap((a) => [
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "totalPending", args: [a] },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "reserve", args: [a] },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "totalReferrals", args: [a] },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "totalBurned", args: [a] },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "totalTreasury", args: [a] },
        ]),
        block,
      );
      type Vault = { pending: bigint; reserve: bigint; referrals: bigint; burned: bigint; treasury: bigint };
      const vaults = new Map<string, Vault | string>();
      assets.forEach((a, i) => {
        const slice = res.slice(i * per, i * per + per);
        const bad = slice.find((r) => r?.status !== "success");
        if (bad || slice.length < per) vaults.set(a, `read failed (${errMsg(bad?.error)})`);
        else {
          const v = slice.map((r) => r.result as bigint);
          vaults.set(a, { pending: v[0], reserve: v[1], referrals: v[2], burned: v[3], treasury: v[4] });
        }
      });
      const sym = (a: string) => quoteMeta(a);
      // One line per asset in expected/actual; assets idle on both sides are left out unless nothing else remains.
      const compare = (key: "attributed" | "claimed" | "settled", indexOf: (s: PoundSums) => bigint[], chainOf: (v: Vault) => bigint[], exact: boolean, legs: string[]) => {
        const lines: { asset: string; expected: string; actual: string; ok: boolean; note?: string }[] = [];
        for (const a of assets) {
          const s = poundSums.get(a) ?? { attributed: 0n, claimed: 0n, toBurn: 0n, toTreasury: 0n, toReferrals: 0n };
          const v = vaults.get(a)!;
          const m = sym(a);
          const idx = indexOf(s);
          const fmt = (xs: bigint[]) => (legs.length > 1 ? legs.map((n, i) => `${n} ${amount(xs[i], m.decimals)}`).join(" / ") : amount(xs[0], m.decimals));
          if (typeof v === "string") {
            lines.push({ asset: a, expected: `${m.symbol} ${fmt(idx)}`, actual: `${m.symbol} ?`, ok: false, note: `${m.symbol}: ${v}` });
            continue;
          }
          const ch = chainOf(v);
          if (idx.every((x) => x === 0n) && ch.every((x) => x === 0n)) continue;
          const ok = idx.every((x, i) => (exact ? x === ch[i] : x <= ch[i]));
          lines.push({ asset: a, expected: `${m.symbol} ${fmt(idx)}`, actual: `${m.symbol} ${fmt(ch)}`, ok, ...(ok ? {} : { note: `${m.symbol}: indexed ${fmt(idx)}, vault ${fmt(ch)}` }) });
        }
        if (!lines.length) {
          const m = sym(ZERO);
          lines.push({ asset: ZERO, expected: `${m.symbol} 0`, actual: `${m.symbol} 0`, ok: true });
        }
        const bad = lines.filter((l) => !l.ok);
        const notes = [bad[0]?.note ?? "", bad.length > 1 ? `(+${bad.length - 1} more)` : "", exact ? "" : "the event ledger is at its retention cap, so the indexed sum is a lower bound: compared as ≤"].filter(Boolean).join(" · ");
        checks.push({ key: `pound.${key}`, label: labels[key], ok: bad.length === 0, expected: lines.map((l) => l.expected).join(" · "), actual: lines.map((l) => l.actual).join(" · "), ...(notes ? { detail: notes } : {}) });
      };
      compare("attributed", (s) => [s.attributed], (v) => [v.pending + v.referrals], true, ["accrued"]);
      compare("claimed", (s) => [s.claimed], (v) => [v.referrals], !poundCapped, ["claimed"]);
      compare("settled", (s) => [s.toBurn, s.toTreasury, s.toReferrals], (v) => [v.burned, v.treasury, v.reserve + v.referrals], !poundCapped, ["burn", "treasury", "referrals"]);
    } catch (e) {
      for (const k of ["attributed", "claimed", "settled"] as const) checks.push(failed(`pound.${k}`, labels[k], `${assets.length} asset${assets.length === 1 ? "" : "s"}`, e));
    }
  }

  // $RADIAN flywheel: the flush ledger against the treasury's lifetime counters
  if (HAS_RADIAN) {
    const label = "$RADIAN flushes equal the treasury's lifetime totals";
    const legs = (x: { usdcIn: bigint; burned: bigint; toStakers: bigint }) =>
      `flushed ${amount(x.usdcIn, RADIAN_QUOTE_DECIMALS, RADIAN_QUOTE_SYMBOL)} / burned ${amount(x.burned, 18, "RADIAN")} / to stakers ${amount(x.toStakers, RADIAN_QUOTE_DECIMALS, RADIAN_QUOTE_SYMBOL)}`;
    try {
      const res = await read(
        [
          { address: RADIAN.treasury, abi: treasuryAbi, functionName: "totalFlushed" },
          { address: RADIAN.treasury, abi: treasuryAbi, functionName: "totalBurned" },
          { address: RADIAN.treasury, abi: treasuryAbi, functionName: "totalToStakers" },
        ],
        block,
      );
      const bad = res.find((r) => r?.status !== "success");
      if (bad || res.length < 3) checks.push(failed("radian.flushed", label, legs(flushSums), bad?.error ?? new Error("short multicall result")));
      else {
        const chain = { usdcIn: res[0].result as bigint, burned: res[1].result as bigint, toStakers: res[2].result as bigint };
        const exact = !flywheelCapped;
        const cmp = (a: bigint, b: bigint) => (exact ? a === b : a <= b);
        const ok = cmp(flushSums.usdcIn, chain.usdcIn) && cmp(flushSums.burned, chain.burned) && cmp(flushSums.toStakers, chain.toStakers);
        const detail = exact ? undefined : "the flush ledger is at its retention cap, so the indexed sum is a lower bound: compared as ≤";
        checks.push({ key: "radian.flushed", label, ok, expected: legs(flushSums), actual: legs(chain), ...(detail ? { detail } : {}) });
      }
    } catch (e) {
      checks.push(failed("radian.flushed", label, legs(flushSums), e));
    }
  }

  return { block: Number(block), computedAt, allOk: checks.every((c) => c.ok), checks };
}

let cached: Report | null = null;
let inflight: Promise<Report> | null = null;

/** The latest report, at most TTL old; concurrent callers share one computation. */
export function reconcile(): Promise<Report> {
  if (cached && Date.now() - cached.computedAt < TTL_MS) return Promise.resolve(cached);
  if (!inflight) {
    inflight = compute()
      .then((r) => {
        cached = r;
        return r;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
