import express from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { formatUnits, decodeEventLog, getAddress, isHash, TransactionNotFoundError, TransactionReceiptNotFoundError, type Abi, type Hex, type TransactionReceipt } from "viem";
import { store } from "./store.js";
import { fmt } from "./scanner.js";
import { mountAgentApi } from "./agentApi.js";
import { mountMeta } from "./meta.js";
import { reconcile } from "./reconcile.js";
import { otherChainStatus } from "./keeper.js";
import {
  publicClient,
  RADIAN,
  SUNSET,
  isSunset,
  stakingAbi,
  treasuryAbi,
  radianTokenAbi,
  curveReadAbi,
  isHidden,
  HAS_RADIAN,
  RADIAN_QUOTE,
  RADIAN_QUOTE_DECIMALS,
  RADIAN_QUOTE_SYMBOL,
  erc20BalanceAbi,
  CHAIN_ID,
  CHAIN_NAME,
  HAS_POUND,
  POUND_VAULT,
  PACK_BURNER,
  poundVaultAbi,
  packBurnerAbi,
  quoteMeta, VAULT, LOCKER, POOL_MANAGER, LAUNCH_ROUTER, LEGACY_ROUTERS, POF_ROUTER, EXECUTOR,
  FACTORY, factoryAbi, curveEventsAbi, routerEventsAbi, treasuryEventsAbi, poundEventsAbi } from "./config.js";
import { isAddress, parseAbi, type Address } from "viem";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;
const symbolAbi = parseAbi(["function symbol() view returns (string)"]);

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "https://radian-indexer-production.up.railway.app").replace(/\/$/, "");
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function startServer() {
  const app = express();
  // Node's built-in querystring instead of `qs`: no nested/array parsing, which
  // is both all we need and the surface behind the open qs advisories.
  app.set("query parser", "simple");
  app.disable("x-powered-by");
  app.use(cors());
  try { mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}

  // Token logo upload: store the image, return a stable URL that goes into
  // the token's on-chain `logo` metadata. (Testnet: disk-backed; production
  // should point UPLOAD_DIR at a volume or swap for S3/IPFS.)
  // Abuse limits for an unauthenticated, CORS-open endpoint: a per-IP budget, a
  // disk quota shared with the snapshot volume, and the file's real type is
  // sniffed from its bytes — the Content-Type header only picks the extension.
  const UPLOADS_PER_HOUR = Number(process.env.UPLOADS_PER_HOUR ?? 20);
  const UPLOAD_QUOTA_BYTES = Number(process.env.UPLOAD_QUOTA_MB ?? 500) * 1024 * 1024;
  const uploadHits = new Map<string, number[]>();
  const sniff = (b: Buffer): string | null => {
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
    if (b.length > 6 && b.subarray(0, 6).toString("latin1").startsWith("GIF8")) return "gif";
    if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
    return null;
  };
  const uploadDirBytes = () => {
    try {
      return readdirSync(UPLOAD_DIR).reduce((s, f) => s + (statSync(`${UPLOAD_DIR}/${f}`).size || 0), 0);
    } catch {
      return 0;
    }
  };

  app.post("/upload", express.raw({ type: "image/*", limit: "2mb" }), (req, res) => {
    const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.socket.remoteAddress ?? "?").trim();
    const now = Date.now();
    const hits = (uploadHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (hits.length >= UPLOADS_PER_HOUR) return res.status(429).json({ error: "too many uploads, try later" });
    const declared = EXT[req.headers["content-type"] ?? ""];
    if (!declared || !req.body?.length) return res.status(400).json({ error: "send a png/jpg/webp/gif body" });
    const actual = sniff(req.body as Buffer);
    if (!actual || actual !== declared) return res.status(400).json({ error: "body is not the declared image type" });
    if (uploadDirBytes() + req.body.length > UPLOAD_QUOTA_BYTES) return res.status(507).json({ error: "upload storage full" });
    hits.push(now);
    uploadHits.set(ip, hits);
    const hash = createHash("sha256").update(req.body).digest("hex").slice(0, 24);
    const file = `${hash}.${actual}`;
    if (!existsSync(`${UPLOAD_DIR}/${file}`)) writeFileSync(`${UPLOAD_DIR}/${file}`, req.body);
    res.json({ url: `${PUBLIC_URL}/img/${file}` });
  });

  app.get("/img/:file", (req, res) => {
    // Only names this server can have written: 24 hex chars + a known extension.
    // Anything else is 404 — no traversal, no directory reads, no header spoofing.
    const m = /^([0-9a-f]{24})\.(png|jpg|webp|gif)$/.exec(req.params.file);
    if (!m) return res.status(404).end();
    const path = `${UPLOAD_DIR}/${m[0]}`;
    if (!existsSync(path)) return res.status(404).end();
    res.setHeader("Content-Type", `image/${m[2] === "jpg" ? "jpeg" : m[2]}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(readFileSync(path));
  });

  // Holder wall + creator-signed logos (signed messages, verified on chain, stored in the snapshot).
  mountMeta(app, { uploadDir: UPLOAD_DIR, publicUrl: PUBLIC_URL, sniff, hasRoom: (n) => uploadDirBytes() + n <= UPLOAD_QUOTA_BYTES });

  const decOf = (token: string) => store.launches.get(token.toLowerCase())?.quoteDecimals ?? 18;

  // Per-token price facts from the trade log, for the explore lists: a spark
  // series of [ts, price] (quote per token, last 60 trades), the last price,
  // the 24h change (vs the last trade at or before 24h ago; a token younger
  // than that measures from its first trade), 24h volume and trade count.
  type TokenStats = { spark: [number, number][]; lastPrice: number | null; change24h: number | null; volume24h: number; trades24h: number };
  const tradeStats = (): Map<string, TokenStats> => {
    const since = Date.now() - 86_400_000;
    const by = new Map<string, typeof store.trades>();
    for (const t of store.trades) {
      const k = t.token.toLowerCase();
      const list = by.get(k);
      if (list) list.push(t);
      else by.set(k, [t]);
    }
    const out = new Map<string, TokenStats>();
    for (const [k, list] of by) {
      list.sort((a, b) => a.ts - b.ts);
      const dec = decOf(k);
      const pts: [number, number][] = [];
      for (const t of list) {
        const q = Number(t.quote) / 10 ** dec;
        const tok = Number(t.tokens) / 1e18;
        if (tok > 0 && q > 0) pts.push([t.ts, q / tok]);
      }
      const last = pts.length ? pts[pts.length - 1][1] : null;
      let ref: number | null = null;
      for (const p of pts) {
        if (p[0] <= since) ref = p[1];
        else break;
      }
      if (ref == null && pts.length > 1) ref = pts[0][1];
      const recent = list.filter((t) => t.ts >= since);
      out.set(k, {
        spark: pts.slice(-60),
        lastPrice: last,
        change24h: last != null && ref != null && ref > 0 ? (last / ref - 1) * 100 : null,
        volume24h: recent.reduce((s, t) => s + Number(t.quote) / 10 ** dec, 0),
        trades24h: recent.length,
      });
    }
    return out;
  };

  // Contracts that hold launch tokens without being holders: the curve, the locker and the V4 pool
  // after graduation, the buyback vault, the routers, the template contracts, The Pound, the dead address.
  const SYSTEM_LC = new Set(
    [LOCKER, VAULT, POOL_MANAGER, LAUNCH_ROUTER, ...LEGACY_ROUTERS, POF_ROUTER, EXECUTOR, POUND_VAULT, PACK_BURNER, RADIAN.treasury, RADIAN.staking, "0x000000000000000000000000000000000000dEaD"]
      .map((a) => String(a).toLowerCase())
      .filter((a) => a && a !== "0x0000000000000000000000000000000000000000"),
  );
  const holdersOf = (l: { token: string; curve: string; template?: { kind: string; [k: string]: unknown } | null }): number | null => {
    if (!store.hasBalances(l.token)) return null; // no Transfer seen yet: unknown, not zero
    const ex = new Set(SYSTEM_LC);
    ex.add(l.curve.toLowerCase());
    ex.add(l.token.toLowerCase());
    for (const v of Object.values(l.template ?? {})) if (typeof v === "string" && v.startsWith("0x")) ex.add(v.toLowerCase());
    return store.holderCount(l.token, ex);
  };

  // The launch rows are rebuilt from the whole trade log; memoised for a few seconds because every
  // list endpoint and every poll asks for them (the scanner mutates the store in between anyway).
  let viewCache: { at: number; rows: ReturnType<typeof buildLaunchView> } | null = null;
  const VIEW_TTL_MS = Number(process.env.VIEW_TTL_MS ?? 4000);
  const launchView = () => {
    if (viewCache && Date.now() - viewCache.at < VIEW_TTL_MS) return viewCache.rows;
    viewCache = { at: Date.now(), rows: buildLaunchView() };
    return viewCache.rows;
  };
  const buildLaunchView = () => {
    const stats = tradeStats();
    return [...store.launches.values()]
      .map((l) => {
        // progress is a ratio of same-unit values, so decimals cancel out
        const tq = Number(l.trackedQuote ?? "0");
        const goal = Number(l.graduationThreshold ?? "0");
        const st = stats.get(l.token.toLowerCase());
        return {
          spark: st?.spark ?? [],
          lastPrice: st?.lastPrice ?? null,
          change24h: st?.change24h ?? null,
          volume24h: st?.volume24h ?? 0,
          trades24h: st?.trades24h ?? 0,
          token: l.token,
          curve: l.curve,
          deployer: l.deployer,
          creatorName: store.profiles.get(l.deployer.toLowerCase())?.name ?? "",
          holders: holdersOf(l),
          name: l.name ?? "",
          symbol: l.symbol ?? "",
          logo: store.logos.get(l.token.toLowerCase()) ?? l.logo ?? "", // a creator-signed logo replaces the on-chain one
          description: l.description ?? "",
          graduated: !!l.graduated,
          quoteReserve: l.quoteReserve ?? "0",
          trackedQuote: l.trackedQuote ?? "0",
          graduationThreshold: l.graduationThreshold,
          buybackLocked: l.buybackLocked ?? "0",
          pairToken: l.pairToken ?? "0x0000000000000000000000000000000000000000",
          quoteSymbol: l.quoteSymbol ?? "USDC",
          quoteDecimals: l.quoteDecimals ?? 18,
          progress: goal > 0 ? Math.min(1, tq / goal) : 0,
          createdAt: l.createdAt ?? 0,
          sunset: SUNSET[l.token.toLowerCase()] ?? null,
          template: l.template ?? null,
        };
      })
      // newest first (by createdAt when known, else by reserve)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || Number(BigInt(b.trackedQuote) - BigInt(a.trackedQuote)));
  };

  // Public reads are the same for everyone and change every few seconds: let browsers and any CDN in
  // front keep them briefly. Per-wallet and signed data stay uncached (see meta.ts).
  const pub = (res: express.Response, seconds = 5) => res.setHeader("Cache-Control", `public, max-age=${seconds}, s-maxage=${seconds * 3}`);
  const indexMeta = () => ({ through: store.checkpoint.toString(), backfillDone: store.backfillCursor >= store.backfillFrom });

  app.get("/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, checkpoint: store.checkpoint.toString(), ...indexMeta(), launches: store.launches.size, trades: store.trades.length, ledger: store.flywheel.length, identity: store.identity });
  });

  app.get("/launches", (_req, res) => {
    pub(res);
    // Retired launches stay resolvable at /token/:addr but leave the lists. `through` / `backfillDone`
    // let a client say "still indexing" instead of "nothing launched" on a cold index.
    res.json({ launches: launchView().filter((l) => !l.sunset && !isHidden(l.token)), ...indexMeta() });
  });

  app.get("/token/:addr", (req, res) => {
    if (!isAddress(req.params.addr)) return res.status(400).json({ error: "address" });
    pub(res);
    const l = launchView().find((x) => x.token.toLowerCase() === req.params.addr.toLowerCase());
    if (!l) return res.status(404).json({ error: "not found" });
    const dec = decOf(req.params.addr);
    const trades = store.trades
      .filter((t) => t.token.toLowerCase() === req.params.addr.toLowerCase())
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 100)
      .map((t) => ({ ...t, quoteDecimals: dec, quoteSymbol: l.quoteSymbol }));
    res.json({ token: l, trades });
  });

  app.get("/activity", (req, res) => {
    pub(res);
    const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit)) || 50));
    const byToken = new Map(launchView().map((l) => [l.token.toLowerCase(), l]));
    const trades = store.recentTrades(limit * 2).filter((t) => !isSunset(t.token) && !isHidden(t.token)).slice(0, limit).map((t) => {
      const l = byToken.get(t.token.toLowerCase());
      return {
        ...t,
        name: l?.name ?? "",
        symbol: l?.symbol ?? "",
        quoteSymbol: l?.quoteSymbol ?? "USDC",
        quoteDecimals: l?.quoteDecimals ?? 18,
      };
    });
    res.json({ trades });
  });

  // Everything one wallet did here, newest first: its curve trades, its launches and its
  // referral claims, with `through` so a client can say how far the index reaches.
  app.get("/address/:addr/activity", (req, res) => {
    if (!isAddress(req.params.addr)) return res.status(400).json({ error: "address" });
    res.setHeader("Cache-Control", "no-store");
    const who = req.params.addr.toLowerCase();
    const byToken = new Map(launchView().map((l) => [l.token.toLowerCase(), l]));
    type Row = { kind: "buy" | "sell" | "launch" | "referralClaim"; ts: number; block: string; txHash?: string; token?: string; symbol?: string; quote?: string; tokens?: string; amount?: string; asset?: string; quoteSymbol?: string; quoteDecimals?: number };
    const rows: Row[] = [];
    for (const t of store.trades) {
      if (t.trader.toLowerCase() !== who) continue;
      const l = byToken.get(t.token.toLowerCase());
      rows.push({ kind: t.side, ts: t.ts, block: t.block, txHash: t.txHash, token: t.token, symbol: l?.symbol ?? "", quote: t.quote, tokens: t.tokens, quoteSymbol: l?.quoteSymbol ?? "", quoteDecimals: l?.quoteDecimals ?? 18 });
    }
    for (const l of store.launches.values()) {
      if (l.deployer.toLowerCase() !== who || !l.createdAt) continue;
      rows.push({ kind: "launch", ts: l.createdAt, block: l.createdBlock ?? "0", token: l.token, symbol: l.symbol ?? "" });
    }
    for (const e of store.pound) {
      if (e.kind === "referralClaim" && (e.referrer ?? "").toLowerCase() === who) rows.push({ kind: "referralClaim", ts: e.ts, block: e.block, txHash: e.txHash, amount: e.amount, asset: e.asset });
    }
    rows.sort((a, b) => b.ts - a.ts);
    res.json({ indexed: true, ...indexMeta(), events: rows.slice(0, 200) });
  });

  // One transaction, resolved here so agents and other browser tabs need no RPC of their own:
  // pending / success / reverted / unknown, the launched token decoded from the factory's
  // TokenLaunched log, and every curve trade, fee claim, Pound settlement and Pack burn the
  // receipt carries (decoded with the same ABIs the scanner uses, only from the contracts that
  // emit them). Nothing is cached while pending; a settled receipt never changes, so it may be.
  type TxEvent = {
    kind: "launch" | "buy" | "sell" | "claim" | "flush" | "settle" | "burn";
    token?: Address;
    symbol?: string;
    curve?: Address;
    template?: "wall" | "pof";
    trader?: Address;
    amounts?: { quote?: string; tokens?: string; amount?: string; asset?: string; fee?: string; tax?: string; quoteSymbol?: string; quoteDecimals?: number };
  };
  const FACTORY_LC = FACTORY.toLowerCase();
  const TREASURY_LC = RADIAN.treasury.toLowerCase();
  const POUND_LCS = new Set(HAS_POUND ? [POUND_VAULT, PACK_BURNER].map((a) => a.toLowerCase()) : []);
  const ROUTER_LCS = new Set([LAUNCH_ROUTER, ...LEGACY_ROUTERS].map((a) => a.toLowerCase()));
  const decodeLog = (abi: Abi, log: { topics: readonly Hex[]; data: Hex }) => {
    try {
      if (log.topics.length === 0) return null;
      return decodeEventLog({ abi, topics: log.topics as [Hex, ...Hex[]], data: log.data }) as unknown as { eventName: string; args: Record<string, unknown> };
    } catch {
      return null;
    }
  };
  // viem names its errors; the instanceof check covers the same module, the name check a duplicated one
  const isErr = (e: unknown, cls: typeof TransactionNotFoundError | typeof TransactionReceiptNotFoundError, name: string) => e instanceof cls || (e as { name?: string })?.name === name;
  const errText = (e: unknown) => String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
  const decodeReceipt = (receipt: TransactionReceipt): { events: TxEvent[]; launched: Address | null } => {
    const events: TxEvent[] = [];
    // curves born in this very transaction: their trades follow TokenLaunched in the same receipt
    const bornCurves = new Map<string, { token: Address; pairToken: string }>();
    let launched: Address | null = null;
    const symOf = (token: string) => store.launches.get(token.toLowerCase())?.symbol;
    const logs = [...receipt.logs].sort((a, b) => (a.logIndex ?? 0) - (b.logIndex ?? 0));
    for (const log of logs) {
      const addr = log.address.toLowerCase();
      if (addr === FACTORY_LC) {
        const ev = decodeLog(factoryAbi, log);
        if (ev?.eventName === "TokenLaunched") {
          const a = ev.args as { token: Address; curve: Address; pairToken: Address };
          launched ??= a.token;
          bornCurves.set(a.curve.toLowerCase(), { token: a.token, pairToken: a.pairToken });
          events.push({ kind: "launch", token: a.token, curve: a.curve, symbol: symOf(a.token) });
        }
        continue;
      }
      if (ROUTER_LCS.has(addr)) {
        const ev = decodeLog(routerEventsAbi, log);
        if (ev?.eventName === "WallLaunched" || ev?.eventName === "PoFLaunched") {
          const a = ev.args as { token: Address };
          const row = events.find((e) => e.kind === "launch" && e.token?.toLowerCase() === a.token.toLowerCase());
          if (row) row.template = ev.eventName === "WallLaunched" ? "wall" : "pof";
        }
        continue;
      }
      if (HAS_RADIAN && addr === TREASURY_LC) {
        const ev = decodeLog(treasuryEventsAbi, log);
        if (ev?.eventName === "FeesClaimed") {
          const a = ev.args as { amount: bigint };
          events.push({ kind: "claim", amounts: { amount: a.amount.toString(), asset: RADIAN_QUOTE, quoteSymbol: RADIAN_QUOTE_SYMBOL, quoteDecimals: RADIAN_QUOTE_DECIMALS } });
        } else if (ev?.eventName === "TokenFeesClaimed") {
          const a = ev.args as { token: Address; amount: bigint };
          events.push({ kind: "claim", token: a.token, symbol: symOf(a.token), amounts: { amount: a.amount.toString(), asset: RADIAN_QUOTE, quoteSymbol: RADIAN_QUOTE_SYMBOL, quoteDecimals: RADIAN_QUOTE_DECIMALS } });
        } else if (ev?.eventName === "Flushed") {
          // quote in → $RADIAN bought and burned (the curve buy itself is listed as its own event)
          const a = ev.args as { usdcIn: bigint; radianBurned: bigint };
          events.push({ kind: "flush", token: RADIAN.token, symbol: symOf(RADIAN.token) ?? "RADIAN", amounts: { quote: a.usdcIn.toString(), tokens: a.radianBurned.toString(), asset: RADIAN_QUOTE, quoteSymbol: RADIAN_QUOTE_SYMBOL, quoteDecimals: RADIAN_QUOTE_DECIMALS } });
        }
        continue;
      }
      if (POUND_LCS.has(addr)) {
        const ev = decodeLog(poundEventsAbi, log);
        if (ev?.eventName === "ReferralClaimed") {
          const a = ev.args as { asset: Address; referrer: Address; amount: bigint };
          const m = quoteMeta(a.asset);
          events.push({ kind: "claim", trader: a.referrer, amounts: { amount: a.amount.toString(), asset: a.asset, quoteSymbol: m.symbol, quoteDecimals: m.decimals } });
        } else if (ev?.eventName === "Settled") {
          const a = ev.args as { asset: Address; intake: bigint };
          const m = quoteMeta(a.asset);
          events.push({ kind: "settle", amounts: { amount: a.intake.toString(), asset: a.asset, quoteSymbol: m.symbol, quoteDecimals: m.decimals } });
        } else if (ev?.eventName === "Burned") {
          const a = ev.args as { token: Address; asset: Address; quoteIn: bigint; tokensOut: bigint };
          const m = quoteMeta(a.asset);
          events.push({ kind: "burn", token: a.token, symbol: symOf(a.token), amounts: { quote: a.quoteIn.toString(), tokens: a.tokensOut.toString(), asset: a.asset, quoteSymbol: m.symbol, quoteDecimals: m.decimals } });
        }
        continue;
      }
      // Curve trades: only from a curve the index knows or one launched in this receipt, so a
      // foreign contract emitting the same signature can never be read as a Radian trade.
      const known = store.hasCurve(addr);
      const born = bornCurves.get(addr);
      if (!known && !born) continue;
      const token = known ? known.token : born!.token;
      const qm = known
        ? { symbol: known.quoteSymbol ?? quoteMeta(known.pairToken).symbol, decimals: known.quoteDecimals ?? quoteMeta(known.pairToken).decimals }
        : quoteMeta(born!.pairToken);
      const ev = decodeLog(curveEventsAbi, log);
      if (ev?.eventName === "CurveBuy") {
        const a = ev.args as { recipient: Address; quoteIn: bigint; tokensOut: bigint; fee: bigint; tax: bigint };
        events.push({ kind: "buy", token, symbol: symOf(token), curve: getAddress(log.address), trader: a.recipient, amounts: { quote: a.quoteIn.toString(), tokens: a.tokensOut.toString(), fee: a.fee.toString(), tax: a.tax.toString(), quoteSymbol: qm.symbol, quoteDecimals: qm.decimals } });
      } else if (ev?.eventName === "CurveSell") {
        const a = ev.args as { recipient: Address; tokensIn: bigint; quoteOut: bigint; fee: bigint; tax: bigint };
        events.push({ kind: "sell", token, symbol: symOf(token), curve: getAddress(log.address), trader: a.recipient, amounts: { quote: a.quoteOut.toString(), tokens: a.tokensIn.toString(), fee: a.fee.toString(), tax: a.tax.toString(), quoteSymbol: qm.symbol, quoteDecimals: qm.decimals } });
      }
    }
    return { events, launched };
  };

  app.get("/tx/:hash", async (req, res) => {
    const hash = String(req.params.hash);
    if (!isHash(hash)) return res.status(400).json({ error: "hash" });
    let receipt: TransactionReceipt | null = null;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash });
    } catch (e) {
      if (!isErr(e, TransactionReceiptNotFoundError, "TransactionReceiptNotFoundError")) return res.status(502).json({ error: "chain-unavailable", detail: errText(e) });
    }
    if (!receipt) {
      // No receipt yet: pending when the node holds the transaction, unknown when it never saw it
      // (not propagated yet, or dropped). Neither answer may be cached.
      res.setHeader("Cache-Control", "no-store");
      try {
        await publicClient.getTransaction({ hash });
        return res.json({ hash, status: "pending", events: [] });
      } catch (e) {
        if (isErr(e, TransactionNotFoundError, "TransactionNotFoundError")) return res.json({ hash, status: "unknown", events: [] });
        return res.status(502).json({ error: "chain-unavailable", detail: errText(e) });
      }
    }
    let confirmations: number | undefined;
    try {
      const tip = await publicClient.getBlockNumber();
      confirmations = Math.max(0, Number(tip - receipt.blockNumber + 1n));
    } catch {
      /* the receipt is the fact; the confirmation count is a courtesy */
    }
    const { events, launched } = receipt.status === "success" ? decodeReceipt(receipt) : { events: [], launched: null };
    // The launched token, or the one token a plain trade / claim was about; absent when there is none or several.
    const touched = [...new Set(events.map((e) => e.token?.toLowerCase()).filter((x): x is string => !!x))];
    const primary = launched ?? (touched.length === 1 ? events.find((e) => e.token)!.token! : null);
    const known = primary ? store.launches.get(primary.toLowerCase()) : undefined;
    const token = primary ? { address: primary, ...(known?.symbol ? { symbol: known.symbol } : {}), ...(known?.name ? { name: known.name } : {}) } : undefined;
    pub(res, 30);
    res.json({
      hash,
      status: receipt.status === "success" ? "success" : "reverted",
      blockNumber: receipt.blockNumber.toString(),
      ...(confirmations != null ? { confirmations } : {}),
      ...(token ? { token } : {}),
      events,
    });
  });

  app.get("/stats", (req, res) => {
    pub(res, 10);
    const ls = launchView().filter((l) => !l.sunset && !isHidden(l.token));
    const window = req.query.window === "24h" ? "24h" : "all";
    const since = window === "24h" ? Date.now() - 86_400_000 : 0;
    const trades = store.trades.filter((t) => t.ts >= since && !isSunset(t.token) && !isHidden(t.token));

    // format each trade's quote leg in its own asset decimals (USDC 18, EURC 6)
    const q = (t: (typeof trades)[number]) => Number(t.quote) / 10 ** decOf(t.token);
    const buys = trades.filter((t) => t.side === "buy");
    const sells = trades.filter((t) => t.side === "sell");
    const buyVolume = buys.reduce((s, t) => s + q(t), 0);
    const sellVolume = sells.reduce((s, t) => s + q(t), 0);
    const volume = buyVolume + sellVolume;

    // per-token ranked table
    const byTok = new Map<string, { token: string; name: string; symbol: string; volume: number; buys: number; sells: number; trades: number }>();
    for (const t of trades) {
      const k = t.token.toLowerCase();
      const l = ls.find((x) => x.token.toLowerCase() === k);
      const row = byTok.get(k) ?? { token: t.token, name: l?.name ?? "", symbol: l?.symbol ?? "", volume: 0, buys: 0, sells: 0, trades: 0 };
      row.volume += q(t);
      row.trades += 1;
      if (t.side === "buy") row.buys += 1; else row.sells += 1;
      byTok.set(k, row);
    }
    const ranked = [...byTok.values()].sort((a, b) => b.volume - a.volume);

    // hourly volume buckets for the last 24h (for the chart)
    const buckets = new Array(24).fill(0);
    const now = Date.now();
    for (const t of store.trades) {
      if (isSunset(t.token) || isHidden(t.token)) continue;
      const hrsAgo = Math.floor((now - t.ts) / 3_600_000);
      if (hrsAgo >= 0 && hrsAgo < 24) buckets[23 - hrsAgo] += q(t);
    }

    res.json({
      window,
      launches: ls.length,
      graduated: ls.filter((l) => l.graduated).length,
      curveTvl: ls.reduce((s, l) => s + fmt(l.trackedQuote), 0),
      buybackLocked: ls.reduce((s, l) => s + fmt(l.buybackLocked), 0),
      trades: trades.length,
      volume,
      buyVolume,
      sellVolume,
      buyTrades: buys.length,
      sellTrades: sells.length,
      avgTrade: trades.length ? volume / trades.length : 0,
      creatorRewards: volume * 0.005, // 1% fee × 50% creator share
      hourlyVolume: buckets,
      ranked,
    });
  });

  // $RADIAN flywheel state — staked, APR, buyback burned, revenue distributed.
  app.get("/radian", async (_req, res) => {
    if (!HAS_RADIAN) return res.status(404).json({ error: "no $RADIAN flywheel on this chain" });
    try {
      const r = await publicClient.multicall({
        allowFailure: true,
        contracts: [
          { address: RADIAN.staking, abi: stakingAbi, functionName: "totalStaked" },
          { address: RADIAN.staking, abi: stakingAbi, functionName: "rewardRate" },
          { address: RADIAN.staking, abi: stakingAbi, functionName: "periodFinish" },
          { address: RADIAN.staking, abi: stakingAbi, functionName: "totalDistributed" },
          { address: RADIAN.treasury, abi: treasuryAbi, functionName: "totalBurned" },
          { address: RADIAN.treasury, abi: treasuryAbi, functionName: "totalToStakers" },
          { address: RADIAN.treasury, abi: treasuryAbi, functionName: "buybackBps" },
          { address: RADIAN.token, abi: radianTokenAbi, functionName: "totalSupply" },
          { address: RADIAN.curve, abi: curveReadAbi, functionName: "getReserves" },
          // RadianStakingERC20 v2 keeps rewardRate scaled by RATE_SCALE (1e18); v1 pools have no such getter
          { address: RADIAN.staking, abi: stakingAbi, functionName: "RATE_SCALE" },
        ],
      });
      const QD = RADIAN_QUOTE_DECIMALS;
      const num = (i: number, d = 18) => Number(formatUnits((r[i].result as bigint | undefined) ?? 0n, d));
      const totalStaked = num(0);
      const rateScale = r[9].status === "success" ? (r[9].result as bigint) : 1n;
      const rewardRate = Number(formatUnits(((r[1].result as bigint | undefined) ?? 0n) / rateScale, QD)); // quote units per second
      const reserves = r[8].result as [bigint, bigint] | undefined;
      const quoteReserve = reserves ? Number(formatUnits(reserves[0], QD)) : 0;
      const tokenReserve = reserves ? Number(formatUnits(reserves[1], 18)) : 1;
      const radianPrice = tokenReserve > 0 ? quoteReserve / tokenReserve : 0; // USDC per RADIAN
      const annualRewards = rewardRate * 365 * 86400; // USDC/yr
      const stakedValue = totalStaked * radianPrice;
      const treasuryBal =
        RADIAN_QUOTE === "0x0000000000000000000000000000000000000000"
          ? Number(formatUnits(await publicClient.getBalance({ address: RADIAN.treasury }), 18))
          : Number(formatUnits((await publicClient.readContract({ address: RADIAN_QUOTE, abi: erc20BalanceAbi, functionName: "balanceOf", args: [RADIAN.treasury] })) as bigint, QD));
      res.json({
        token: RADIAN.token,
        curve: RADIAN.curve,
        staking: RADIAN.staking,
        treasury: RADIAN.treasury,
        totalStaked,
        radianPrice,
        stakedValueUsdc: stakedValue,
        apr: stakedValue > 0 ? (annualRewards / stakedValue) * 100 : 0,
        periodFinish: Number((r[2].result as bigint | undefined) ?? 0n),
        rewardRatePerSec: rewardRate,
        distributedToStakers: num(5, QD),
        totalDistributedStaking: num(3, QD),
        quoteSymbol: RADIAN_QUOTE_SYMBOL,
        quoteDecimals: QD,
        buybackBurned: num(4),
        radianSupply: num(7),
        buybackBps: Number((r[6].result as number | undefined) ?? 0),
        treasuryBalance: treasuryBal,
        // append-only ledger of treasury events, newest first
        ledger: [...store.flywheel].sort((a, b) => b.ts - a.ts || b.logIndex - a.logIndex).slice(0, 50),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.shortMessage ?? String(e) });
    }
  });

  // Where a transaction link points on this chain (override with EXPLORER_URL). Used by the burn feed,
  // whose readers are auto-posters that cannot resolve a bare hash.
  const EXPLORER = (
    process.env.EXPLORER_URL ??
    ({ 5042002: "https://testnet.arcscan.app", 5042: "https://arcscan.app", 46630: "https://explorer.testnet.chain.robinhood.com", 4663: "https://robinhoodchain.blockscout.com", 8453: "https://basescan.org" } as Record<number, string>)[CHAIN_ID] ??
    ""
  ).replace(/\/$/, "");
  const txUrl = (hash: string) => (EXPLORER ? `${EXPLORER}/tx/${hash}` : hash);
  const WEB_URL = (process.env.WEB_URL ?? "https://radian-sable.vercel.app").replace(/\/$/, "");
  // Pack coin symbols already read on chain (by /pound or the feed), so naming a coin costs one read ever.
  const packSymbols = new Map<string, string>();

  // The Pound: vault totals per quote asset, the Pack, burner parameters, the
  // ledger (settlements, burns, claims) and the referrer leaderboard.
  app.get("/pound", async (_req, res) => {
    if (!HAS_POUND) return res.status(404).json({ error: "no Pound on this chain" });
    try {
      const assetSet = new Set<string>([ZERO_ADDR]);
      for (const l of store.launches.values()) assetSet.add((l.pairToken ?? ZERO_ADDR).toLowerCase());
      const assets = [...assetSet] as Address[];
      const head = (await publicClient.multicall({
        allowFailure: true,
        contracts: [
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "router" },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "burner" },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "treasury" },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "burnShareBps" },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "REFERRAL_BPS" },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "LAUNCHER_BPS" },
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "packCount" },
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "cursor" },
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "lastBurnAt" },
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "minInterval" },
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "bountyBps" },
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "maxSlippageBps" },
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "permissionless" },
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "keeper" },
        ],
      })) as { status: string; result?: unknown }[];
      const g = <T,>(i: number, d: T): T => (head[i].status === "success" ? (head[i].result as T) : d);
      const packCount = Number(g<bigint>(6, 0n));
      const perAsset = (await publicClient.multicall({
        allowFailure: true,
        contracts: assets.flatMap((a) => [
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "totalPending", args: [a] },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "reserve", args: [a] },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "totalReferrals", args: [a] },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "totalBurned", args: [a] },
          { address: POUND_VAULT, abi: poundVaultAbi, functionName: "totalTreasury", args: [a] },
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "pool", args: [a] },
          { address: PACK_BURNER, abi: packBurnerAbi, functionName: "spentOf", args: [a] },
        ]),
      })) as { status: string; result?: unknown }[];
      const s = (i: number) => (perAsset[i]?.status === "success" ? String(perAsset[i].result) : "0");
      const assetRows = assets.map((a, k) => {
        const m = quoteMeta(a);
        const o = k * 7;
        return {
          asset: a, symbol: m.symbol, decimals: m.decimals,
          totalPending: s(o), reserve: s(o + 1), totalReferrals: s(o + 2), totalBurned: s(o + 3), totalTreasury: s(o + 4),
          burnPool: s(o + 5), burnSpent: s(o + 6),
        };
      });
      const packReads = packCount
        ? ((await publicClient.multicall({
            allowFailure: true,
            contracts: Array.from({ length: packCount }, (_, i) => ({ address: PACK_BURNER, abi: packBurnerAbi, functionName: "packAt" as const, args: [BigInt(i)] })),
          })) as { status: string; result?: unknown }[])
        : [];
      const packs = packReads.map((r, i) => {
        const p = (r.status === "success" ? r.result : null) as { token: Address; asset: Address; floor: bigint; maxPerBurn: bigint; active: boolean; key: { fee: number; tickSpacing: number; hooks: Address } } | null;
        return p ? { index: i, token: p.token, asset: p.asset, floor: p.floor.toString(), maxPerBurn: p.maxPerBurn.toString(), active: p.active, poolFee: p.key.fee, hooks: p.key.hooks } : null;
      }).filter(Boolean) as { index: number; token: Address; asset: Address; floor: string; maxPerBurn: string; active: boolean; poolFee: number; hooks: Address }[];
      if (packs.length) {
        const extra = (await publicClient.multicall({
          allowFailure: true,
          contracts: packs.flatMap((p) => [
            { address: p.token, abi: symbolAbi, functionName: "symbol" as const },
            { address: PACK_BURNER, abi: packBurnerAbi, functionName: "burnedOf" as const, args: [p.token] },
          ]),
        })) as { status: string; result?: unknown }[];
        // Per coin, what the burner has spent on it so far (the sum of its Burned events' quoteIn, in the
        // pack's asset), how many burns and when the last one was: the Pack picture sizes its tiles by this.
        const agg = new Map<string, { quote: bigint; n: number; last: number }>();
        for (const e of store.pound) {
          if (e.kind !== "burn" || !e.token) continue;
          const k = e.token.toLowerCase();
          const a = agg.get(k) ?? { quote: 0n, n: 0, last: 0 };
          a.quote += BigInt(e.quoteIn ?? "0");
          a.n += 1;
          a.last = Math.max(a.last, e.ts);
          agg.set(k, a);
        }
        packs.forEach((p, i) => {
          const l = store.launches.get(p.token.toLowerCase());
          const symbol = extra[i * 2]?.status === "success" ? String(extra[i * 2].result) : (l?.symbol ?? "?");
          if (symbol !== "?") packSymbols.set(p.token.toLowerCase(), symbol);
          const a = agg.get(p.token.toLowerCase());
          Object.assign(p, {
            symbol,
            burned: extra[i * 2 + 1]?.status === "success" ? String(extra[i * 2 + 1].result) : "0",
            assetSymbol: quoteMeta(p.asset).symbol, assetDecimals: quoteMeta(p.asset).decimals,
            // one of our launches: its name and logo (a creator-signed logo replaces the on-chain one)
            name: l?.name ?? "",
            logo: l ? (store.logos.get(p.token.toLowerCase()) ?? l.logo ?? "") : "",
            burnedQuote: (a?.quote ?? 0n).toString(),
            burnCount: a?.n ?? 0,
            lastBurnAt: a ? Math.floor(a.last / 1000) : 0,
          });
        });
      }
      let nextPack: number | null = null;
      for (let k = 0; k < packs.length; k++) {
        const i = (Number(g<bigint>(7, 0n)) + k) % packs.length;
        if (packs[i]?.active) { nextPack = i; break; }
      }
      const referrers = [...store.referrers.values()].sort((a, b) => (BigInt(b.accrued) > BigInt(a.accrued) ? 1 : -1)).slice(0, 50);
      res.json({
        vault: {
          address: POUND_VAULT, router: g<Address>(0, ZERO_ADDR), burner: g<Address>(1, ZERO_ADDR), treasury: g<Address>(2, ZERO_ADDR),
          burnShareBps: Number(g<number>(3, 0)), referralBps: Number(g<bigint>(4, 0n)), launcherBps: Number(g<bigint>(5, 0n)),
        },
        burner: {
          address: PACK_BURNER, packCount, cursor: Number(g<bigint>(7, 0n)), nextPack, lastBurnAt: Number(g<bigint>(8, 0n)),
          minInterval: Number(g<number>(9, 0)), bountyBps: Number(g<number>(10, 0)), maxSlippageBps: Number(g<number>(11, 0)),
          permissionless: g<boolean>(12, false), keeper: g<Address>(13, ZERO_ADDR),
        },
        assets: assetRows,
        packs,
        referrers,
        // home-chain rows only; the other chains' burns travel under otherChains (their own explorer, ledger)
        ledger: [...store.pound].filter((e) => e.kind !== "attributed" && e.chainId == null).sort((a, b) => b.ts - a.ts || b.logIndex - a.logIndex).slice(0, 100),
        // The Pack coins that live on BSC / Base and are burned there by the keeper through HalfMoon
        otherChains: await otherChainStatus().catch((e: any) => ({ error: String(e?.shortMessage ?? e?.message ?? e) })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.shortMessage ?? String(e) });
    }
  });

  // The burn feed: the newest 50 Pack burns as plain items, one per Burned event, the transaction link
  // as the item link. "Every burn auto-posts" is delivered by pointing any RSS-to-X / Zapier / IFTTT
  // automation at /pound/feed.rss (or the JSON Feed twin), so this service never holds social
  // credentials. A coin is named from our launches, from a symbol /pound already read, or from one
  // cached symbol() read; a coin that cannot be named is shown by its address, never dropped.
  const fmtEn = (v: string | undefined, decimals: number, whole = false) => {
    const n = Number(formatUnits(BigInt(v ?? "0"), decimals));
    if (whole) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
    return n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toLocaleString("en-US", { maximumSignificantDigits: 3 });
  };
  const burnFeedItems = async () => {
    const burns = [...store.pound].filter((e) => e.kind === "burn" && !!e.token).sort((a, b) => b.ts - a.ts || b.logIndex - a.logIndex).slice(0, 50);
    const unknown = [...new Set(burns.map((e) => e.token!.toLowerCase()))].filter((k) => !packSymbols.has(k) && !store.launches.get(k)?.symbol);
    if (unknown.length) {
      try {
        const r = (await publicClient.multicall({ allowFailure: true, contracts: unknown.map((k) => ({ address: k as Address, abi: symbolAbi, functionName: "symbol" as const })) })) as { status: string; result?: unknown }[];
        unknown.forEach((k, i) => {
          if (r[i]?.status === "success") packSymbols.set(k, String(r[i].result));
        });
      } catch {
        /* the feed still serves; unnamed coins show their address */
      }
    }
    return burns.map((e) => {
      const token = e.token!;
      const k = token.toLowerCase();
      const symbol = store.launches.get(k)?.symbol || packSymbols.get(k) || `${token.slice(0, 6)}…${token.slice(-4)}`;
      const m = quoteMeta(e.asset);
      const tokensText = fmtEn(e.tokensOut, 18, true);
      const quoteText = fmtEn(e.quoteIn, m.decimals);
      const url = txUrl(e.txHash);
      return {
        id: `${e.txHash}:${e.logIndex}`,
        url,
        txHash: e.txHash,
        ts: e.ts,
        token,
        symbol,
        index: e.index ?? null,
        asset: e.asset ?? ZERO_ADDR,
        assetSymbol: m.symbol,
        assetDecimals: m.decimals,
        quoteIn: e.quoteIn ?? "0",
        tokensOut: e.tokensOut ?? "0",
        bounty: e.bounty ?? "0",
        caller: e.caller ?? null,
        title: `The Pound burned ${tokensText} $${symbol} (${quoteText} ${m.symbol})`,
        text: `The Pound just burned ${tokensText} $${symbol} (${quoteText} ${m.symbol}) · tx: ${url}`,
      };
    });
  };
  const feedTitle = `The Pound · Pack burns · ${CHAIN_NAME}`;
  const feedDescription = "Every Pack burn by The Pound, newest first: the coin, the amount burned, what it cost in the quote asset and the transaction. Rotation, not a contest; everyone gets fed.";
  const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);

  app.get("/pound/feed.json", async (_req, res) => {
    if (!HAS_POUND) return res.status(404).json({ error: "no Pound on this chain" });
    try {
      const items = await burnFeedItems();
      pub(res, 60);
      res.json({
        version: "https://jsonfeed.org/version/1.1",
        title: feedTitle,
        home_page_url: `${WEB_URL}/earn`,
        feed_url: `${PUBLIC_URL}/pound/feed.json`,
        description: feedDescription,
        items: items.map((i) => ({
          id: i.id,
          url: i.url,
          title: i.title,
          content_text: i.text,
          date_published: new Date(i.ts).toISOString(),
          _radian: { txHash: i.txHash, ts: i.ts, token: i.token, symbol: i.symbol, index: i.index, asset: i.asset, assetSymbol: i.assetSymbol, assetDecimals: i.assetDecimals, quoteIn: i.quoteIn, tokensOut: i.tokensOut, bounty: i.bounty, caller: i.caller },
        })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.shortMessage ?? String(e) });
    }
  });

  app.get("/pound/feed.rss", async (_req, res) => {
    if (!HAS_POUND) return res.status(404).type("text/plain").send("no Pound on this chain");
    try {
      const items = await burnFeedItems();
      pub(res, 60);
      res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      const body = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
        `<channel>`,
        `<title>${xml(feedTitle)}</title>`,
        `<link>${xml(`${WEB_URL}/earn`)}</link>`,
        `<description>${xml(feedDescription)}</description>`,
        `<language>en</language>`,
        `<lastBuildDate>${new Date(items[0]?.ts ?? Date.now()).toUTCString()}</lastBuildDate>`,
        `<atom:link href="${xml(`${PUBLIC_URL}/pound/feed.rss`)}" rel="self" type="application/rss+xml"/>`,
        ...items.map(
          (i) =>
            `<item><title>${xml(i.title)}</title><link>${xml(i.url)}</link><guid isPermaLink="${EXPLORER ? "true" : "false"}">${xml(EXPLORER ? i.url : i.id)}</guid><pubDate>${new Date(i.ts).toUTCString()}</pubDate><description>${xml(i.text)}</description></item>`,
        ),
        `</channel>`,
        `</rss>`,
      ].join("\n");
      res.send(body);
    } catch (e: any) {
      res.status(500).type("text/plain").send(e?.shortMessage ?? String(e));
    }
  });

  // The Pack coins on other chains (OTHER_CHAIN_PACK_JSON) with their live status: the keeper's quote
  // and gas balances there, the last burn, the next eligible time, the last HalfMoon quote and why the
  // last tick passed. Same object as /pound.otherChains (docs/PACK_OTHER_CHAINS.md).
  app.get("/pound/otherchains", async (_req, res) => {
    try {
      const view = await otherChainStatus();
      res.setHeader("Cache-Control", "public, max-age=30");
      res.json(view);
    } catch (e: any) {
      res.status(500).json({ error: e?.shortMessage ?? String(e) });
    }
  });

  // One referrer: what they can claim and have accrued per quote asset (live), plus indexed trade counts.
  app.get("/pound/referral/:addr", async (req, res) => {
    if (!HAS_POUND) return res.status(404).json({ error: "no Pound on this chain" });
    const who = String(req.params.addr);
    if (!isAddress(who)) return res.status(400).json({ error: "bad address" });
    try {
      const assetSet = new Set<string>([ZERO_ADDR]);
      for (const l of store.launches.values()) assetSet.add((l.pairToken ?? ZERO_ADDR).toLowerCase());
      const assets = [...assetSet] as Address[];
      const r = (await publicClient.multicall({
        allowFailure: true,
        contracts: assets.map((a) => ({ address: POUND_VAULT, abi: poundVaultAbi, functionName: "referralOf" as const, args: [a, who as Address] })),
      })) as { status: string; result?: unknown }[];
      const rows = assets.map((a, i) => {
        const m = quoteMeta(a);
        const v = (r[i].status === "success" ? r[i].result : [0n, 0n]) as readonly [bigint, bigint];
        const agg = store.referrers.get(`${a.toLowerCase()}:${who.toLowerCase()}`);
        return { asset: a, symbol: m.symbol, decimals: m.decimals, claimable: v[0].toString(), accrued: v[1].toString(), trades: agg?.trades ?? 0 };
      });
      const recent = [...store.pound]
        .filter((e) => e.referrer?.toLowerCase() === who.toLowerCase())
        .sort((a, b) => b.ts - a.ts || b.logIndex - a.logIndex)
        .slice(0, 50);
      res.json({ referrer: who, assets: rows, recent });
    } catch (e: any) {
      res.status(500).json({ error: e?.shortMessage ?? String(e) });
    }
  });

  // Reconciliation: what the index claims, re-derived from the chain at the index's own checkpoint block
  // (see reconcile.ts for the checks). Computed at most once a minute; concurrent requests share one run.
  app.get("/reconcile", async (_req, res) => {
    try {
      const report = await reconcile();
      pub(res, 60);
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: e?.shortMessage ?? String(e) });
    }
  });

  mountAgentApi(app);
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => console.log(`[api] listening on :${port}`));
}
