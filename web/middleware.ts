import { NextResponse, type NextRequest } from "next/server";

// Security headers for every page. Vercel serves no CSP of its own, so this is
// the only thing that stops a rogue script, frame or exfiltration channel once
// something on the page is compromised. The lists are the site's whole network
// surface; anything not here fails in the browser, so extend them with the code
// that adds a new host, not after a report from a user.
//
// script-src is nonce-based: Next reads the nonce from this request's CSP
// header and stamps it on its own inline hydration / flight scripts, and
// 'strict-dynamic' then trusts the chunks those scripts load (route code,
// Privy's dynamic imports) without listing hosts. There is no inline script of
// our own. A nonce only reaches a page rendered for this request, so the root
// layout forces dynamic rendering (app/layout.tsx). Verified locally with
// `next build && next start` (see DESIGN.md).

const origin = (u: string | undefined): string | null => {
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

// JSON-RPC nodes and indexers per network (lib/networks.ts, incl. the env overrides Vercel may set).
const DATA_HOSTS = [
  "https://rpc.testnet.arc.io", // Arc testnet (no override)
  process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC, "https://rpc.testnet.chain.robinhood.com",
  process.env.NEXT_PUBLIC_ROBINHOOD_RPC, "https://rpc.mainnet.chain.robinhood.com",
  process.env.NEXT_PUBLIC_BASE_RPC, "https://mainnet.base.org",
  process.env.NEXT_PUBLIC_INDEXER_URL, "https://radian-indexer-production.up.railway.app",
  process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_INDEXER_URL, "https://radian-indexer-robinhood-production.up.railway.app",
  process.env.NEXT_PUBLIC_ROBINHOOD_INDEXER_URL, "https://radian-indexer-robinhood-mainnet-production.up.railway.app",
  process.env.NEXT_PUBLIC_BASE_INDEXER_URL,
];

// Privy (login, embedded wallet iframe) and the Coinbase Wallet SDK (its own popup + SDK
// endpoints; the Coinbase entries follow the SDK source, not captured traffic). Injected
// wallets (MetaMask, Rabby, Phantom, OKX) talk through window.ethereum and need nothing.
// WalletConnect is deliberately not listed: its option is off in components/Providers.tsx.
const WALLET_CONNECT_SRC = ["https://auth.privy.io", "https://keys.coinbase.com", "https://cca-lite.coinbase.com"];
const WALLET_FRAME_SRC = ["https://auth.privy.io", "https://keys.coinbase.com"];

function buildCsp(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  const data = Array.from(new Set(DATA_HOSTS.map(origin).filter((o): o is string => !!o)));
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // inline style attributes (widths, colours computed from data) and Privy's modal styles
    "style-src 'self' 'unsafe-inline'",
    // A launch's logo is whatever https URL its creator put on chain, plus the indexer's
    // signed uploads and logo.dev for stock quotes: any https image host, nothing else.
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self' ${[...data, ...WALLET_CONNECT_SRC].join(" ")}${dev ? " ws: wss:" : ""}`,
    `frame-src ${WALLET_FRAME_SRC.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const STATIC_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  // Full URL to our own pages, only the origin to anyone else (referral codes stay ours).
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=()"],
];

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = buildCsp(nonce);
  // Next reads the nonce from the request's CSP header when it renders.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  for (const [k, v] of STATIC_HEADERS) response.headers.set(k, v);
  return response;
}

export const config = {
  // Pages only: static assets and the JSON API carry no scripts, and a per-request CSP on
  // long-cached files would only defeat their caching.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|api/|.*\\.[a-zA-Z0-9]+$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
