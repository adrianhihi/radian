"use client";

// The holder wall and the creator's logo: signed messages (no gas) that the
// indexer verifies against the chain before storing — a wall post must come
// from a wallet that holds the token right now, a logo from the wallet that
// launched it. The message formats here are the contract with the indexer.
import type { Address, WalletClient } from "viem";
import { INDEXER_URL, hasIndexer } from "./indexer";

export type WallEntry = { address: Address; text: string; time: number; balance?: string };

export const WALL_MAX = 280;
export const LOGO_SIZE = 128;
export const LOGO_MAX_BYTES = 200 * 1024;

export const wallMessage = (token: string, text: string, time: number) => `Radian wall\ntoken: ${token.toLowerCase()}\ntime: ${time}\n\n${text}`;
export const logoMessage = (token: string, sha256: string, time: number) => `Radian logo\ntoken: ${token.toLowerCase()}\nsha256: ${sha256}\ntime: ${time}`;

export async function fetchWall(token: string): Promise<WallEntry[]> {
  if (!hasIndexer()) return [];
  const r = await fetch(`${INDEXER_URL}/token/${token}/wall`, { cache: "no-store" });
  if (!r.ok) return [];
  const j = (await r.json()) as { entries?: WallEntry[] };
  return j.entries ?? [];
}

export type SignResult = { ok: true } | { ok: false; reason: string };

async function post(path: string, body: unknown): Promise<SignResult> {
  try {
    const r = await fetch(`${INDEXER_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (r.ok && j.ok) return { ok: true };
    return { ok: false, reason: j.error ?? `http-${r.status}` };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Sign and post a wall message. Rejected by the indexer unless the signer holds the token. */
export async function postWall(token: string, text: string, wc: { client: WalletClient; account: Address }): Promise<SignResult> {
  const time = Date.now();
  const body = text.trim().slice(0, WALL_MAX);
  if (!body) return { ok: false, reason: "empty" };
  let signature: string;
  try {
    signature = await wc.client.signMessage({ account: wc.account, message: wallMessage(token, body, time) });
  } catch {
    return { ok: false, reason: "rejected" };
  }
  return post(`/token/${token}/wall`, { address: wc.account, text: body, time, signature });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sign and upload a logo (a data URL from resizeLogo). Rejected unless the signer launched the token. */
export async function uploadLogo(token: string, dataUrl: string, wc: { client: WalletClient; account: Address }): Promise<SignResult> {
  const m = /^data:(image\/(?:png|webp|jpeg));base64,(.+)$/.exec(dataUrl);
  if (!m) return { ok: false, reason: "bad-input" };
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, reason: "too-large" };
  const time = Date.now();
  const hash = await sha256Hex(bytes);
  let signature: string;
  try {
    signature = await wc.client.signMessage({ account: wc.account, message: logoMessage(token, hash, time) });
  } catch {
    return { ok: false, reason: "rejected" };
  }
  return post(`/token/${token}/logo`, { address: wc.account, image: dataUrl, time, signature });
}

/** Any image file → a 128×128 PNG data URL (cover crop), done in the browser. */
export function resizeLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = LOGO_SIZE;
        c.height = LOGO_SIZE;
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("canvas");
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, LOGO_SIZE, LOGO_SIZE);
        resolve(c.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}
