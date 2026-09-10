import express from "express";
import cors from "cors";
import { store } from "./store.js";
import { fmt } from "./scanner.js";

export function startServer() {
  const app = express();
  app.use(cors());

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
