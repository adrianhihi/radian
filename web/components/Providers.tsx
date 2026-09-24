"use client";

// The wallet boundary. Privy lives in components/PrivyRoot.tsx and is loaded as its
// own chunk after the page has painted; until then (and on the server) the tree
// renders with a "loading" wallet, so nothing depends on Privy being in the main
// bundle. Without an app id the wallet is simply off: the site still reads the chain.
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { DISABLED_WALLET, LOADING_WALLET, WalletContext } from "@/lib/walletContext";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const PrivyRoot = lazy(() => import("./PrivyRoot"));

export function Providers({ children }: { children: ReactNode }) {
  // Privy reads window and IndexedDB: never on the server, and only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!APP_ID) return <WalletContext.Provider value={DISABLED_WALLET}>{children}</WalletContext.Provider>;
  const waiting = <WalletContext.Provider value={LOADING_WALLET}>{children}</WalletContext.Provider>;
  if (!mounted) return waiting;
  return (
    <Suspense fallback={waiting}>
      <PrivyRoot appId={APP_ID}>{children}</PrivyRoot>
    </Suspense>
  );
}
