import type { Express } from "express";
import express from "express";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { isAddress, type Address, type Hex } from "viem";
import { store, type WallEntry } from "./store.js";
import { publicClient, erc20BalanceAbi } from "./config.js";

// Signed-message metadata (no gas): the holder wall and the creator's logo.
// Nothing is stored on a claim alone — every post is checked against the chain:
//   wall  — the signature must be the poster's, and the poster must hold the
//           token at the moment of posting (balanceOf > 0);
//   logo  — the signature must be the launch's deployer's. The image replaces
//           the on-chain logo in what this indexer serves; the chain is untouched.
// Message formats are shared with web/lib/wall.ts; change both or neither.

const WALL_MAX = 280;
const WALL_PER_TOKEN = 200;
const SKEW_MS = 10 * 60 * 1000;
const LOGO_MAX_BYTES = 200 * 1024;
const POSTS_PER_HOUR = 30;

export const wallMessage = (token: string, text: string, time: number) => `Radian wall\ntoken: ${token.toLowerCase()}\ntime: ${time}\n\n${text}`;
export const logoMessage = (token: string, sha256: string, time: number) => `Radian logo\ntoken: ${token.toLowerCase()}\nsha256: ${sha256}\ntime: ${time}`;

type Opts = { uploadDir: string; publicUrl: string; sniff: (b: Buffer) => string | null; hasRoom: (bytes: number) => boolean };

export function mountMeta(app: Express, { uploadDir, publicUrl, sniff, hasRoom }: Opts) {
  const json = express.json({ limit: "512kb" });
  const hits = new Map<string, number[]>();
  const limited = (req: express.Request): boolean => {
    const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.socket.remoteAddress ?? "?").trim();
    const now = Date.now();
    const h = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (h.length >= POSTS_PER_HOUR) return true;
    h.push(now);
    hits.set(ip, h);
    return false;
  };
  const bad = (res: express.Response, code: number, error: string) => res.status(code).json({ ok: false, error });
  const verify = async (address: Address, message: string, signature: Hex): Promise<boolean> => {
    try {
      return await publicClient.verifyMessage({ address, message, signature });
    } catch {
      return false;
    }
  };

  app.get("/token/:addr/wall", (req, res) => {
    const entries = store.wall.get(req.params.addr.toLowerCase()) ?? [];
    res.json({ entries: [...entries].sort((a, b) => b.time - a.time) });
  });

  app.post("/token/:addr/wall", json, async (req, res) => {
    const token = req.params.addr;
    if (!isAddress(token) || !store.launches.get(token.toLowerCase())) return bad(res, 404, "unknown token");
    const b = (req.body ?? {}) as { address?: string; text?: string; time?: number; signature?: string };
    const address = String(b.address ?? "");
    const text = String(b.text ?? "").trim().replace(/\s+\n/g, "\n");
    const time = Number(b.time);
    const signature = String(b.signature ?? "") as Hex;
    if (!isAddress(address)) return bad(res, 400, "bad-input");
    if (!text || text.length > WALL_MAX) return bad(res, 400, "empty");
    if (!Number.isFinite(time) || Math.abs(Date.now() - time) > SKEW_MS) return bad(res, 400, "stale");
    if (!/^0x[0-9a-fA-F]{130,}$/.test(signature)) return bad(res, 400, "signature");
    if (limited(req)) return bad(res, 429, "rate");
    if (!(await verify(address as Address, wallMessage(token, text, time), signature))) return bad(res, 401, "signature");
    let balance = 0n;
    try {
      balance = (await publicClient.readContract({ address: token as Address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [address as Address] })) as bigint;
    } catch {
      return bad(res, 503, "network");
    }
    if (balance === 0n) return bad(res, 403, "holding");
    const k = token.toLowerCase();
    const entry: WallEntry = { address: address as Address, text, time, balance: balance.toString() };
    const next = [entry, ...(store.wall.get(k) ?? []).filter((e) => e.address.toLowerCase() !== address.toLowerCase())].slice(0, WALL_PER_TOKEN);
    store.wall.set(k, next);
    store.save();
    res.json({ ok: true });
  });

  app.post("/token/:addr/logo", json, async (req, res) => {
    const token = req.params.addr;
    const launch = isAddress(token) ? store.launches.get(token.toLowerCase()) : undefined;
    if (!launch) return bad(res, 404, "unknown token");
    const b = (req.body ?? {}) as { address?: string; image?: string; time?: number; signature?: string };
    const address = String(b.address ?? "");
    const time = Number(b.time);
    const signature = String(b.signature ?? "") as Hex;
    const m = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image ?? ""));
    if (!isAddress(address) || !m) return bad(res, 400, "bad-input");
    if (!Number.isFinite(time) || Math.abs(Date.now() - time) > SKEW_MS) return bad(res, 400, "stale");
    if (launch.deployer.toLowerCase() !== address.toLowerCase()) return bad(res, 403, "creator");
    if (limited(req)) return bad(res, 429, "rate");
    const bytes = Buffer.from(m[2], "base64");
    if (!bytes.length || bytes.length > LOGO_MAX_BYTES) return bad(res, 400, "too-large");
    const actual = sniff(bytes);
    if (!actual) return bad(res, 400, "bad-input");
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (!(await verify(address as Address, logoMessage(token, sha, time), signature))) return bad(res, 401, "signature");
    if (!hasRoom(bytes.length)) return bad(res, 507, "storage");
    const file = `${sha.slice(0, 24)}.${actual}`;
    try {
      if (!existsSync(`${uploadDir}/${file}`)) writeFileSync(`${uploadDir}/${file}`, bytes);
    } catch {
      return bad(res, 500, "storage");
    }
    const url = `${publicUrl}/img/${file}`;
    store.logos.set(token.toLowerCase(), url);
    store.save();
    res.json({ ok: true, url });
  });
}
