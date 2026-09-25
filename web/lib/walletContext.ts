"use client";

// The wallet as the app sees it, with no Privy import: pages read this through
// useRadianWallet(), and only components/PrivyRoot.tsx (loaded as its own chunk)
// fills it in. `ready` is false while that chunk is still loading, so the wallet
// pill shows a spinner instead of flashing "Sign in" at signed-in people.
import { createContext } from "react";
import type { Address, WalletClient } from "viem";

export type WalletView = {
  /** false while the wallet provider is still loading; true once it has spoken */
  ready: boolean;
  authenticated: boolean;
  address: Address | undefined;
  /** "privy" = embedded wallet; anything else is an injected / external wallet */
  clientType: string | null;
  /** every wallet the provider knows for this login (external first, then embedded) */
  wallets: { address: Address; clientType: string }[];
  /** read and sign with this wallet from now on (remembered in this browser) */
  selectWallet: (address: Address) => void;
  login: () => void;
  logout: () => void;
  getWalletClient: () => Promise<{ client: WalletClient; account: Address } | null>;
};

const none = async () => null;

/** Before the Privy chunk has loaded. */
export const LOADING_WALLET: WalletView = { ready: false, authenticated: false, address: undefined, clientType: null, wallets: [], selectWallet: () => {}, login: () => {}, logout: () => {}, getWalletClient: none };
/** No wallet provider configured on this deployment (NEXT_PUBLIC_PRIVY_APP_ID unset). */
export const DISABLED_WALLET: WalletView = { ...LOADING_WALLET, ready: true };

export const WalletContext = createContext<WalletView>(LOADING_WALLET);
