import { parseAbi, type Address } from "viem";
import { RADIAN, arcTestnet, hasPound } from "./radian";

// RadianExecutor: keeper-run scheduled buys. The user deposits quote (and
// native for gas), signs an EIP-712 BuyAuth off-chain, and the keeper calls
// executeBuy on schedule. Tokens always land in the user's wallet; withdraw
// and cancelAuth need nobody's cooperation.
//
// Two generations are deployed. v1 (Arc, Robinhood mainnet stage A) signs
// {user, token, perBuyMax, maxGasPrice, …}. v2 (2026-09-22, chains that run
// The Pound) adds the quote asset, a minimum per buy (no dust buys to farm the
// gas stipend) and a price floor, and signs under domain version "2". The
// network's `pound` config is what tells the two apart.
export const EXECUTOR_V2 = hasPound;

export const executorAbi = parseAbi([
  "function deposit() payable",
  "function depositToken(address asset, uint256 amount)",
  "function withdraw(address asset, uint256 amount, address to)",
  "function cancelAuth()",
  "function nonces(address) view returns (uint256)",
  "function balanceOf(address user, address asset) view returns (uint256)",
  "function execs(bytes32 authId) view returns (uint32 count, uint64 lastAt)",
  "function FEE_BPS() view returns (uint256)",
  "function GAS_STIPEND() view returns (uint256)",
  "function keeper() view returns (address)",
]);

// EIP-712 typed data — must match RadianExecutor.AUTH_TYPEHASH field-for-field.
const BUY_AUTH_TYPES_V1 = {
  BuyAuth: [
    { name: "user", type: "address" },
    { name: "token", type: "address" },
    { name: "perBuyMax", type: "uint256" },
    { name: "maxGasPrice", type: "uint256" },
    { name: "totalCount", type: "uint32" },
    { name: "minInterval", type: "uint32" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;
const BUY_AUTH_TYPES_V2 = {
  BuyAuth: [
    { name: "user", type: "address" },
    { name: "token", type: "address" },
    { name: "asset", type: "address" },
    { name: "perBuyMax", type: "uint256" },
    { name: "minPerBuy", type: "uint256" },
    { name: "minTokensPerQuote", type: "uint256" },
    { name: "maxGasPrice", type: "uint256" },
    { name: "totalCount", type: "uint32" },
    { name: "minInterval", type: "uint32" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;
export const BUY_AUTH_TYPES: Record<string, readonly { name: string; type: string }[]> = EXECUTOR_V2 ? BUY_AUTH_TYPES_V2 : BUY_AUTH_TYPES_V1;

export const executorDomain = () =>
  ({
    name: "RadianExecutor",
    version: EXECUTOR_V2 ? "2" : "1",
    chainId: arcTestnet.id,
    verifyingContract: RADIAN.executor as Address,
  }) as const;

export type BuyAuth = {
  user: Address;
  token: Address;
  perBuyMax: bigint;
  maxGasPrice: bigint;
  totalCount: number;
  minInterval: number;
  deadline: bigint;
  nonce: bigint;
  // v2 only
  asset?: Address;
  minPerBuy?: bigint;
  minTokensPerQuote?: bigint; // 1e18-scaled tokens per quote unit; 0 = no floor
};

// Contract constants, mirrored for the fee note (the page still reads them live).
export const EXECUTOR_FEE_BPS = 50n; // 0.5% of quote spent
export const EXECUTOR_GAS_STIPEND = 300_000n; // gas units per execution
