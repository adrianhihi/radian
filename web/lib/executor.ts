import { parseAbi, type Address } from "viem";
import { RADIAN, arcTestnet } from "./radian";

// RadianExecutor: keeper-run scheduled buys. The user deposits quote (and
// native for gas), signs an EIP-712 BuyAuth off-chain, and the keeper calls
// executeBuy on schedule. Tokens always land in the user's wallet; withdraw
// and cancelAuth need nobody's cooperation.

export const executorAbi = parseAbi([
  "function deposit() payable",
  "function depositToken(address asset, uint256 amount)",
  "function withdraw(address asset, uint256 amount, address to)",
  "function cancelAuth()",
  "function nonces(address) view returns (uint256)",
  "function balanceOf(address user, address asset) view returns (uint256)",
  "function execs(bytes32 authId) view returns (uint32 count, uint64 lastAt)",
  "function authId((address user, address token, uint256 perBuyMax, uint256 maxGasPrice, uint32 totalCount, uint32 minInterval, uint64 deadline, uint256 nonce) a) pure returns (bytes32)",
  "function FEE_BPS() view returns (uint256)",
  "function GAS_STIPEND() view returns (uint256)",
  "function keeper() view returns (address)",
]);

// EIP-712 typed data — must match RadianExecutor.AUTH_TYPEHASH field-for-field.
export const BUY_AUTH_TYPES = {
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

export const executorDomain = () =>
  ({
    name: "RadianExecutor",
    version: "1",
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
};

// Contract constants, mirrored for the fee note (the page still reads them live).
export const EXECUTOR_FEE_BPS = 50n; // 0.5% of quote spent
export const EXECUTOR_GAS_STIPEND = 300_000n; // gas units per execution
