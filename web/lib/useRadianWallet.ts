"use client";
import { useContext } from "react";
import { WalletContext } from "./walletContext";

// One hook the whole app uses for wallet state + a viem WalletClient bound to the
// active wallet (embedded or connected). It reads the context that
// components/PrivyRoot.tsx provides, so no page imports Privy itself.
export function useRadianWallet() {
  return useContext(WalletContext);
}
