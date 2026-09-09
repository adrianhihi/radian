"use client";
import { useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import { arcTestnet } from "./radian";

// One hook the whole app uses for wallet state + a viem WalletClient bound to
// Privy's active wallet (embedded or connected). Keeps trade/launch pages
// agnostic to how the user logged in (email, Google, or an injected wallet).
export function useRadianWallet() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const address = (wallet?.address as Address | undefined) ?? undefined;

  const getWalletClient = useCallback(async (): Promise<{
    client: WalletClient;
    account: Address;
  } | null> => {
    if (!wallet) return null;
    // Make sure the wallet is on Arc before we ask it to sign.
    try {
      await wallet.switchChain(arcTestnet.id);
    } catch {
      /* embedded wallets are already on the configured chain */
    }
    const provider = await wallet.getEthereumProvider();
    const client = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
    return { client, account: wallet.address as Address };
  }, [wallet]);

  return { ready, authenticated, login, logout, user, address, wallet, getWalletClient };
}
