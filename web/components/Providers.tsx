"use client";
import { PrivyProvider } from "@privy-io/react-auth";
import { arcTestnet } from "@/lib/radian";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "cmtuqige5005e0bl9kg12ftjq";

// Privy has an unconditional effect that fetches WalletConnect's wallet directory
// (explorer-api.walletconnect.com) even when no WalletConnect option is offered.
// The CSP (middleware.ts) does not allow that host, and Privy does not handle the
// blocked request: a console error in production, a "Failed to fetch" overlay in
// dev. Answer that one host locally with an empty directory; everything else goes
// to the real fetch. WalletConnect itself is not in the wallet list below.
const WC_EXPLORER = "explorer-api.walletconnect.com";
if (typeof window !== "undefined" && !(window as { __radianWcPatched?: boolean }).__radianWcPatched) {
  (window as { __radianWcPatched?: boolean }).__radianWcPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    try {
      if (new URL(url, location.href).hostname === WC_EXPLORER) {
        return Promise.resolve(new Response(JSON.stringify({ listings: {}, count: 0, total: 0 }), { status: 200, headers: { "content-type": "application/json" } }));
      }
    } catch {
      /* not a URL: let fetch decide */
    }
    return original(input, init);
  };
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#4f7cff",
          logo: undefined,
          walletChainType: "ethereum-only",
          // Injected wallets plus Coinbase Wallet; no WalletConnect (its relay and
          // directory are third parties the CSP keeps out). Email / Google give
          // everyone else an embedded wallet.
          walletList: ["detected_ethereum_wallets", "metamask", "coinbase_wallet", "rabby_wallet", "phantom", "okx_wallet"],
        },
        // Email / Google / wallet — low-friction onboarding like PONS/PAIR.
        loginMethods: ["email", "google", "wallet"],
        // Users without a wallet get one automatically on first login.
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
