"use client";

// The only file that imports Privy. components/Providers.tsx loads it as a separate
// chunk (dynamic import, no SSR), so every page's first-load JS stays free of the
// wallet SDK and its connectors; measured on baskvia: 787 KB with the split against
// 3.5 MB with a static import. A runtime `if (!appId) return children` would not
// help — the bundler pulls the tree in regardless.
import { useCallback, useMemo, type ReactNode, useState } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { readLS, writeLS } from "@/lib/ui/storage";

const WALLET_KEY = "radian.wallet";
import { createWalletClient, custom, type Address, type Chain, type WalletClient } from "viem";
import { originChain } from "@/lib/crossBuy";
import { activeNetwork, arcTestnet } from "@/lib/radian";
import { WalletContext, type WalletView } from "@/lib/walletContext";

// The chains a cross-chain buyer pays from (lib/networks `crossBuy.origins`). Privy only switches
// a wallet to a chain in `supportedChains` (HOLD hit this with 4663 missing), so they are listed
// alongside the active network; their RPCs are the same ones middleware.ts allows.
const ORIGIN_CHAINS: Chain[] = (activeNetwork.crossBuy?.origins ?? []).map(originChain);

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

export default function PrivyRoot({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#e8944c",
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
        supportedChains: [arcTestnet, ...ORIGIN_CHAINS],
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}

/** Turns Privy's hooks into the app's WalletView. Must sit inside PrivyProvider. */
function Bridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  // Holdings live in the wallet people already own, so an external (injected) wallet comes first
  // and the embedded one is the fallback for email / Google logins. A choice made in the menu is
  // remembered in this browser (radian.wallet) and wins while that wallet is still connected.
  const [chosen, setChosen] = useState<string | null>(() => readLS(WALLET_KEY));
  const ordered = useMemo(() => {
    const ext = wallets.filter((w) => w.walletClientType !== "privy");
    const emb = wallets.filter((w) => w.walletClientType === "privy");
    return [...ext, ...emb];
  }, [wallets]);
  const wallet = ordered.find((w) => chosen && w.address.toLowerCase() === chosen.toLowerCase()) ?? ordered[0];
  const address = (wallet?.address as Address | undefined) ?? undefined;
  const selectWallet = useCallback((a: Address) => {
    setChosen(a);
    writeLS(WALLET_KEY, a);
  }, []);

  const getWalletClient = useCallback(async (): Promise<{ client: WalletClient; account: Address } | null> => {
    if (!wallet) return null;
    // Make sure the wallet is on the active network before we ask it to sign.
    try {
      await wallet.switchChain(arcTestnet.id);
    } catch {
      /* embedded wallets are already on the configured chain */
    }
    const provider = await wallet.getEthereumProvider();
    const client = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
    return { client, account: wallet.address as Address };
  }, [wallet]);

  // The same wallet on another chain, for a cross-chain buy's origin leg. Unlike the home-chain
  // path above, a refused switch is not swallowed: signing on the wrong chain would send the
  // deposit nowhere, so the caller shows the wallet's refusal instead.
  const getWalletClientFor = useCallback(
    async (chain: Chain): Promise<{ client: WalletClient; account: Address } | null> => {
      if (!wallet) return null;
      await wallet.switchChain(chain.id);
      const provider = await wallet.getEthereumProvider();
      const client = createWalletClient({ chain, transport: custom(provider) });
      return { client, account: wallet.address as Address };
    },
    [wallet],
  );

  const value = useMemo<WalletView>(
    () => ({
      ready: ready && walletsReady,
      authenticated: authenticated && !!address,
      address,
      clientType: wallet?.walletClientType ?? null,
      wallets: ordered.map((w) => ({ address: w.address as Address, clientType: w.walletClientType })),
      selectWallet,
      login: () => login(),
      logout: () => void logout(),
      getWalletClient,
      getWalletClientFor,
    }),
    [ready, walletsReady, authenticated, address, wallet, ordered, selectWallet, login, logout, getWalletClient, getWalletClientFor],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
