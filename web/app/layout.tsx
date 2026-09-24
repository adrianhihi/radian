import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
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

const TITLE = "Radian: fair launches on Robinhood Chain and Arc";
const DESCRIPTION =
  "Launch a token in one transaction on Robinhood Chain or Circle's Arc, priced in a dollar or a stock. Fair bonding-curve discovery, locked liquidity, graduation into Uniswap V4, and every fee feeding The Pound.";

export const metadata: Metadata = {
  // Absolute URLs in share cards need the site's origin; set NEXT_PUBLIC_SITE_URL on Vercel.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://radian-sable.vercel.app"),
  title: TITLE,
  description: DESCRIPTION,
  icons: { icon: "/favicon.svg", apple: "/favicon.svg" },
  openGraph: { type: "website", siteName: "Radian", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

// Pre-paint theme: light-theme readers must never see a dark first frame, so this
// runs as a blocking inline script before hydration; the CSP allows it by nonce.
// The theme button (components/shell/Shell.tsx) writes the same key.
const THEME_INIT = `try{var t=localStorage.getItem('radian.theme');if(t==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}`;

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Every route renders per request: the CSP (middleware.ts) is nonce-based, and a
// prerendered page would ship hydration scripts stamped with no nonce at all,
// which the browser then refuses (verified: every chunk blocked on a static
// page). The pages are client components over a thin server shell, so the
// on-demand render costs a few milliseconds, not a data fetch.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: the script above sets data-theme before React compares the markup.
    <html lang="en" className={`${sora.variable} ${jbmono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
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
