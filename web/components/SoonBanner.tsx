"use client";
import { useNetwork } from "@/lib/networks";

// Shown on read pages when the active network isn't live yet (mainnet pre-9/16).
// Uses useNetwork() (mount-gated) so SSR/first render matches and never mismatches.
export function SoonBanner() {
  const net = useNetwork();
  if (net.live) return null;
  return (
    <div className="soon-banner">
      <h3>Radian on Arc mainnet — September 16, 2026</h3>
      <p>Mainnet launches with Circle&apos;s Arc public mainnet. Switch to Testnet (top right) to explore live now.</p>
    </div>
  );
}
