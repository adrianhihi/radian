import express from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { formatUnits } from "viem";
import { store } from "./store.js";
import { fmt } from "./scanner.js";
import {
  publicClient,
  RADIAN,
  stakingAbi,
  treasuryAbi,
  radianTokenAbi,
  curveReadAbi,
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
  app.post("/upload", express.raw({ type: "image/*", limit: "2mb" }), (req, res) => {
    const ext = EXT[req.headers["content-type"] ?? ""];
    if (!ext || !req.body?.length) return res.status(400).json({ error: "send a png/jpg/webp/gif body" });
    const hash = createHash("sha256").update(req.body).digest("hex").slice(0, 24);
    const file = `${hash}.${ext}`;
    writeFileSync(`${UPLOAD_DIR}/${file}`, req.body);
    res.json({ url: `${PUBLIC_URL}/img/${file}` });
  });

  app.get("/img/:file", (req, res) => {
    // keep hex hash + lowercase ext; strip anything else (blocks traversal)
    const safe = req.params.file.replace(/[^a-z0-9.]/g, "");
    if (safe.includes("..")) return res.status(400).end();
    const path = `${UPLOAD_DIR}/${safe}`;
    if (!existsSync(path)) return res.status(404).end();
    const ext = req.params.file.split(".").pop();
    res.setHeader("Content-Type", `image/${ext === "jpg" ? "jpeg" : ext}`);
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
        };
      })
      // newest first (by createdAt when known, else by reserve)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || Number(BigInt(b.trackedQuote) - BigInt(a.trackedQuote)));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, checkpoint: store.checkpoint.toString(), launches: store.launches.size, trades: store.trades.length });
  });

  app.get("/launches", (_req, res) => {
    res.json({ launches: launchView() });
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
    const trades = store.recentTrades(limit).map((t) => {
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
    const ls = launchView();
    const window = req.query.window === "24h" ? "24h" : "all";
    const since = window === "24h" ? Date.now() - 86_400_000 : 0;
    const trades = store.trades.filter((t) => t.ts >= since);

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
