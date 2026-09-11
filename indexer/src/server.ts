import express from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { formatUnits } from "viem";
import { store } from "./store.js";
import { fmt } from "./scanner.js";
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
} from "./config.js";

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

  const decOf = (token: string) => store.launches.get(token.toLowerCase())?.quoteDecimals ?? 18;

  const launchView = () =>
    [...store.launches.values()]
      .map((l) => {
        // progress is a ratio of same-unit values, so decimals cancel out
        const tq = Number(l.trackedQuote ?? "0");
        const goal = Number(l.graduationThreshold ?? "0");
        return {
          token: l.token,
          curve: l.curve,
          deployer: l.deployer,
          name: l.name ?? "",
          symbol: l.symbol ?? "",
          logo: l.logo ?? "",
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
        };
      })
      // newest first (by createdAt when known, else by reserve)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || Number(BigInt(b.trackedQuote) - BigInt(a.trackedQuote)));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, checkpoint: store.checkpoint.toString(), launches: store.launches.size, trades: store.trades.length });
  });

  app.get("/launches", (_req, res) => {
    // Retired launches stay resolvable at /token/:addr but leave the lists.
    res.json({ launches: launchView().filter((l) => !l.sunset && !isHidden(l.token)) });
  });

  app.get("/token/:addr", (req, res) => {
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

  app.get("/stats", (req, res) => {
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
        ],
      });
      const num = (i: number) => Number(formatUnits((r[i].result as bigint | undefined) ?? 0n, 18));
      const totalStaked = num(0);
      const rewardRate = num(1); // USDC/sec
      const reserves = r[8].result as [bigint, bigint] | undefined;
      const quoteReserve = reserves ? Number(formatUnits(reserves[0], 18)) : 0;
      const tokenReserve = reserves ? Number(formatUnits(reserves[1], 18)) : 1;
      const radianPrice = tokenReserve > 0 ? quoteReserve / tokenReserve : 0; // USDC per RADIAN
      const annualRewards = rewardRate * 365 * 86400; // USDC/yr
      const stakedValue = totalStaked * radianPrice;
      const treasuryBal = Number(formatUnits(await publicClient.getBalance({ address: RADIAN.treasury }), 18));
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
        distributedToStakers: num(5),
        totalDistributedStaking: num(3),
        buybackBurned: num(4),
        radianSupply: num(7),
        buybackBps: Number((r[6].result as number | undefined) ?? 0),
        treasuryBalance: treasuryBal,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.shortMessage ?? String(e) });
    }
  });

  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => console.log(`[api] listening on :${port}`));
}
