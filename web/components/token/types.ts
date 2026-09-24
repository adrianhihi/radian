import type { Address } from "viem";
import type { QuoteAsset } from "@/lib/radian";

/** Everything the token page reads from chain in one multicall (plus the quote asset it resolves). */
export type TokenState = {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  curve: Address;
  quoteReserve: bigint;
  tokenReserve: bigint;
  trackedQuote: bigint;
  graduationThreshold: bigint;
  graduated: boolean;
  sellable: bigint;
  quoteDecimals: number;
  quoteSymbol: string;
  pairToken: Address;
  native: boolean;
  quoteAsset: QuoteAsset;
  // fee policy frozen at launch — mirrored here so the page matches the contract
  feeBps: bigint;
  creatorTaxBps: bigint;
  snipeTaxSeconds: bigint;
  /** the protocol's share of the fee (bps) and who receives it: The Pound's vault, or an older recipient */
  protocolShareBps: bigint;
  protocolRecipient: Address;
  // on-chain socials (creator-supplied; only rendered after URL validation)
  website?: string;
  twitter?: string;
};

export const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;
