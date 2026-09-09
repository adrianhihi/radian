"use client";
import { PrivyProvider } from "@privy-io/react-auth";
import { arcTestnet } from "@/lib/radian";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "cmtuqige5005e0bl9kg12ftjq";

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
