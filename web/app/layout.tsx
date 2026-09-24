import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { LangProvider } from "@/components/LangProvider";
import { ReferralCapture } from "@/components/ReferralCapture";

// Self-hosted fonts through next/font/local: preloaded, content-hashed,
// immutable cache. The CSS variables must sit on <html>: globals.css declares
// --font-sans on :root as var(--font-sora), and var() resolves on the element
// that declares it, so a variable defined only on <body> would leave the whole
// site on the system font without any error.
const sora = localFont({ src: "../fonts/sora.woff2", variable: "--font-sora", weight: "100 800", display: "swap" });
const jbmono = localFont({ src: "../fonts/jbmono.woff2", variable: "--font-jbmono", weight: "100 800", display: "swap" });

export const metadata: Metadata = {
  title: "Radian: fair launches on Robinhood Chain and Arc",
  description:
    "Launch a token in one transaction on Robinhood Chain or Circle's Arc, priced in a dollar or a stock. Fair bonding-curve discovery, locked liquidity, graduation into Uniswap V4, and every fee feeding The Pound.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Every route renders per request: the CSP (middleware.ts) is nonce-based, and a
// prerendered page would ship hydration scripts stamped with no nonce at all,
// which the browser then refuses (verified: every chunk blocked on a static
// page). The pages are client components over a thin server shell, so the
// on-demand render costs a few milliseconds, not a data fetch.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${jbmono.variable}`}>
      <body className="antialiased">
        <LangProvider>
          <Providers>
            <ReferralCapture />
            <div id="root">{children}</div>
          </Providers>
        </LangProvider>
      </body>
    </html>
  );
}
