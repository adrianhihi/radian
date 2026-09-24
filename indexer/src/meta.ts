import type { Express } from "express";
import express from "express";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { isAddress, type Address, type Hex } from "viem";
import { store, type WallEntry, type Profile } from "./store.js";
import { publicClient, erc20BalanceAbi, ownerAbi, FACTORY, WALL_MODERATORS } from "./config.js";

// Signed-message metadata (no gas): the holder wall, its moderation, the creator's logo and
// wallet profiles. Nothing is stored on a claim alone — every write is checked against the chain:
//   wall     — the signature must be the poster's, and the poster must hold the token at the
//              moment of posting (balanceOf > 0); one line per wallet, a new line replaces it;
//   hide     — the signature must be a moderator's (the factory owner, read live, or WALL_MODERATORS);
//              it hides a line, not a wallet: the next line from that wallet shows again;
//   logo     — the signature must be the launch's deployer's. The image replaces the on-chain logo
//              in what this indexer serves; the chain is untouched;
//   profile  — the signature must be the wallet's own. Name / bio / X are the only fields.
// Message formats are shared with web/lib/wall.ts and web/lib/profile.ts; change both or neither.
// viem's verifyMessage accepts EOA signatures and ERC-1271 (smart accounts).

const WALL_MAX = 280;
const WALL_PER_TOKEN = 200; // kept per token (incl. hidden); the GET serves the newest WALL_SERVED
const WALL_SERVED = 50;
const SKEW_MS = 10 * 60 * 1000;
const LOGO_MAX_BYTES = 200 * 1024;
const POSTS_PER_HOUR = 30;
export const PROFILE_LIMITS = { NAME: 32, BIO: 160, X: 15 } as const;

// C0 controls except \t \n \r (a wall line may hold a line break; a name may not).
const CONTROL_ANY = /[\u0000-\u001f]/;
const CONTROL_NOT_WS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const cpLen = (s: string) => [...s].length;

export const wallMessage = (token: string, text: string, time: number) => `Radian wall\ntoken: ${token.toLowerCase()}\ntime: ${time}\n\n${text}`;
export const hideMessage = (token: string, target: string, time: number) => `Radian moderation: hide wall message\ntoken: ${token.toLowerCase()}\naddress: ${target.toLowerCase()}\ntime: ${time}`;
export const logoMessage = (token: string, sha256: string, time: number) => `Radian logo\ntoken: ${token.toLowerCase()}\nsha256: ${sha256}\ntime: ${time}`;
export const profileMessage = (address: string, p: { name: string; bio: string; x: string }, time: number) =>
  `Radian profile\naddress: ${address.toLowerCase()}\nname: ${p.name}\nbio: ${p.bio}\nx: ${p.x}\ntime: ${time}`;

/** Trims, strips a leading @, refuses angle brackets / control chars / over-length; null = reject. */
export function cleanProfile(p: { name?: unknown; bio?: unknown; x?: unknown }): { name: string; bio: string; x: string } | null {
  const name = String(p.name ?? "").trim();
  const bio = String(p.bio ?? "").trim();
  const x = String(p.x ?? "").trim().replace(/^@/, "");
  const bad = /[<>\u0000-\u001f]/;
  if (cpLen(name) > PROFILE_LIMITS.NAME || cpLen(bio) > PROFILE_LIMITS.BIO || bad.test(name) || bad.test(bio)) return null;
  if (x && !/^[A-Za-z0-9_]{1,15}$/.test(x)) return null;
  return { name, bio, x };
}

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
    if (hits.size > 5000) hits.clear();
    return false;
  };
  const bad = (res: express.Response, code: number, error: string) => res.status(code).json({ ok: false, error });
  const noStore = (res: express.Response) => res.setHeader("Cache-Control", "no-store");
  const verify = async (address: Address, message: string, signature: Hex): Promise<boolean> => {
    try {
      return await publicClient.verifyMessage({ address, message, signature });
    } catch {
      return false;
    }
  };
  const freshTime = (time: number) => Number.isFinite(time) && Math.abs(Date.now() - time) <= SKEW_MS;
  const sigShape = (s: string) => /^0x[0-9a-fA-F]{130,}$/.test(s);

  // The factory owner (a Safe on mainnet) moderates the wall, plus any address in WALL_MODERATORS.
  let ownerCache: { at: number; owner: string } | null = null;
  const moderators = async (): Promise<string[]> => {
    if (!ownerCache || Date.now() - ownerCache.at > 60_000) {
      try {
        const owner = (await publicClient.readContract({ address: FACTORY, abi: ownerAbi, functionName: "owner" })) as string;
        ownerCache = { at: Date.now(), owner: owner.toLowerCase() };
      } catch {
        ownerCache = ownerCache ?? { at: 0, owner: "" };
      }
    }
    return [...new Set([ownerCache.owner, ...WALL_MODERATORS].filter(Boolean))];
  };

  const withNames = (entries: WallEntry[]) => entries.map((e) => ({ ...e, name: store.profiles.get(e.address.toLowerCase())?.name ?? "" }));

  // ---- holder wall ----

  app.get("/token/:addr/wall", async (req, res) => {
    noStore(res);
    if (!isAddress(req.params.addr)) return res.status(400).json({ error: "address" });
    const all = store.wall.get(req.params.addr.toLowerCase()) ?? [];
    const entries = [...all].filter((e) => !e.hidden).sort((a, b) => b.time - a.time).slice(0, WALL_SERVED);
    res.json({ entries: withNames(entries), moderators: await moderators() });
  });

  app.post("/token/:addr/wall", json, async (req, res) => {
    noStore(res);
    const token = req.params.addr;
    if (!isAddress(token) || !store.launches.get(token.toLowerCase())) return bad(res, 404, "unknown token");
    const b = (req.body ?? {}) as { address?: string; text?: string; time?: number; signature?: string };
    const address = String(b.address ?? "");
    const text = String(b.text ?? "").trim();
    const time = Number(b.time);
    const signature = String(b.signature ?? "") as Hex;
    if (!isAddress(address)) return bad(res, 400, "bad-input");
    if (!text) return bad(res, 400, "empty");
    if (cpLen(text) > WALL_MAX || CONTROL_NOT_WS.test(text)) return bad(res, 400, "bad-input");
    if (!freshTime(time)) return bad(res, 400, "stale");
    if (!sigShape(signature)) return bad(res, 400, "signature");
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

  // A moderator hides one wallet's line on one token's wall (signed; nothing on chain).
  app.post("/token/:addr/wall/hide", json, async (req, res) => {
    noStore(res);
    const token = req.params.addr;
    if (!isAddress(token)) return bad(res, 404, "unknown token");
    const b = (req.body ?? {}) as { address?: string; by?: string; time?: number; signature?: string };
    const target = String(b.address ?? "");
    const by = String(b.by ?? "");
    const time = Number(b.time);
    const signature = String(b.signature ?? "") as Hex;
    if (!isAddress(target) || !isAddress(by)) return bad(res, 400, "bad-input");
    if (!freshTime(time)) return bad(res, 400, "stale");
    if (!sigShape(signature)) return bad(res, 400, "signature");
    if (limited(req)) return bad(res, 429, "rate");
    if (!(await moderators()).includes(by.toLowerCase())) return bad(res, 403, "not-moderator");
    if (!(await verify(by as Address, hideMessage(token, target, time), signature))) return bad(res, 401, "signature");
    const list = store.wall.get(token.toLowerCase()) ?? [];
    const e = list.find((x) => x.address.toLowerCase() === target.toLowerCase());
    if (!e) return bad(res, 404, "not-found");
    e.hidden = true;
    store.save();
    res.json({ ok: true });
  });

  // ---- creator logo ----

  app.post("/token/:addr/logo", json, async (req, res) => {
    noStore(res);
    const token = req.params.addr;
    const launch = isAddress(token) ? store.launches.get(token.toLowerCase()) : undefined;
    if (!launch) return bad(res, 404, "unknown token");
    const b = (req.body ?? {}) as { address?: string; image?: string; time?: number; signature?: string };
    const address = String(b.address ?? "");
    const time = Number(b.time);
    const signature = String(b.signature ?? "") as Hex;
    const image = String(b.image ?? "");
    if (image.length > 300_000) return bad(res, 413, "too-large"); // before decoding anything
    const m = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!isAddress(address) || !m) return bad(res, 400, "bad-input");
    if (!freshTime(time)) return bad(res, 400, "stale");
    if (!sigShape(signature)) return bad(res, 400, "signature");
    if (limited(req)) return bad(res, 429, "rate");
    const bytes = Buffer.from(m[2], "base64");
    if (!bytes.length || bytes.length > LOGO_MAX_BYTES) return bad(res, 400, "too-large");
    const actual = sniff(bytes);
    if (!actual) return bad(res, 400, "bad-input");
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (!(await verify(address as Address, logoMessage(token, sha, time), signature))) return bad(res, 401, "signature");
    if (launch.deployer.toLowerCase() !== address.toLowerCase()) return bad(res, 403, "creator");
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

  // ---- profiles ----

  app.get("/profile/:addr", (req, res) => {
    noStore(res);
    if (!isAddress(req.params.addr)) return res.status(400).json({ error: "address" });
    const p = store.profiles.get(req.params.addr.toLowerCase()) ?? null;
    res.json({ profile: p ? { address: req.params.addr.toLowerCase(), ...p } : null });
  });

  app.post("/profile/:addr", json, async (req, res) => {
    noStore(res);
    const address = req.params.addr;
    if (!isAddress(address)) return bad(res, 400, "bad-input");
    const b = (req.body ?? {}) as { name?: unknown; bio?: unknown; x?: unknown; time?: number; signature?: string };
    const clean = cleanProfile(b);
    if (!clean) return bad(res, 400, "bad-input");
    const time = Number(b.time);
    const signature = String(b.signature ?? "") as Hex;
    if (!freshTime(time)) return bad(res, 400, "stale");
    if (!sigShape(signature)) return bad(res, 400, "signature");
    if (limited(req)) return bad(res, 429, "rate");
    if (!(await verify(address as Address, profileMessage(address, clean, time), signature))) return bad(res, 401, "signature");
    const profile: Profile = { ...clean, updatedAt: time };
    store.profiles.set(address.toLowerCase(), profile);
    store.save();
    res.json({ ok: true, profile: { address: address.toLowerCase(), ...profile } });
  });

  // A body over the JSON limit is a plain "too large", not a stack trace.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.too.large") return bad(res, 413, "too-large");
    if (e?.type === "entity.parse.failed") return bad(res, 400, "bad-input");
    next(err);
  });
}
