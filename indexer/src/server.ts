import express from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { store } from "./store.js";
import { fmt } from "./scanner.js";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "https://radian-indexer-production.up.railway.app").replace(/\/$/, "");
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function startServer() {
  const app = express();
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

  const launchView = () =>
    [...store.launches.values()]
      .map((l) => {
        const tq = fmt(l.trackedQuote);
        const goal = fmt(l.graduationThreshold);
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
    const trades = store.trades
      .filter((t) => t.token.toLowerCase() === req.params.addr.toLowerCase())
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 100);
    res.json({ token: l, trades });
  });

  app.get("/activity", (req, res) => {
    const limit = Math.min(200, Number(req.query.limit ?? 50));
    const byToken = new Map(launchView().map((l) => [l.token.toLowerCase(), l]));
    const trades = store.recentTrades(limit).map((t) => ({
      ...t,
      name: byToken.get(t.token.toLowerCase())?.name ?? "",
      symbol: byToken.get(t.token.toLowerCase())?.symbol ?? "",
    }));
    res.json({ trades });
  });

  app.get("/stats", (_req, res) => {
    const ls = launchView();
    res.json({
      launches: ls.length,
      graduated: ls.filter((l) => l.graduated).length,
      curveTvl: ls.reduce((s, l) => s + fmt(l.trackedQuote), 0),
      buybackLocked: ls.reduce((s, l) => s + fmt(l.buybackLocked), 0),
      trades: store.trades.length,
    });
  });

  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => console.log(`[api] listening on :${port}`));
}
