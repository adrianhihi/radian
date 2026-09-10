import { createPublicClient, http, parseAbi, type Address } from "viem";
import { getActiveNetwork, toViemChain } from "./networks";

// Everything below derives from the active network (testnet/mainnet). Switching
// networks reloads the page, so these module-level values re-read the choice.
const NET = getActiveNetwork();

// `arcTestnet` is kept as the export name (many callers use it as the chain to
// switch/sign against) but it is the ACTIVE network's chain.
export const arcTestnet = toViemChain(NET);
export const activeNetwork = NET;

export const RADIAN = {
  factory: NET.contracts.factory,
  locker: NET.contracts.locker,
  vault: NET.contracts.vault,
  escrow: NET.contracts.escrow,
  hook: NET.contracts.hook,
  poolManager: NET.contracts.poolManager,
  deployBlock: NET.deployBlock,
} as const;

// Quote assets a token can be paired against (native USDC + any approved ERC-20).
export const NATIVE_QUOTE = "0x0000000000000000000000000000000000000000" as Address;
export type QuoteAsset = {
  key: string; symbol: string; address: Address; decimals: number; native: boolean; blurb: string;
  gradGoal: number;
  stock?: { refSymbol: string; standIn: boolean };
};
export const QUOTE_ASSETS: QuoteAsset[] = NET.quoteAssets;
export const quoteByAddress = (a?: string): QuoteAsset =>
  QUOTE_ASSETS.find((q) => q.address.toLowerCase() === (a ?? "").toLowerCase()) ?? QUOTE_ASSETS[0];

export const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

// ---- ABIs (only what the UI needs) ----
export const factoryAbi = parseAbi([
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
  "function launchToken((string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt) params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)",
  "function launchFee() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns ((uint256 supply, uint256 curveFeeBps, uint256 phantomQuote, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, bool enabled))",
]);

export const curveAbi = parseAbi([
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function trackedQuote() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function sellableTokens() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function pairToken() view returns (address)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256)",
]);

export const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function logo() view returns (string)",
  "function description() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
]);

// extra curve reads for stats/portfolio
export const curveStatsAbi = parseAbi([
  "function quoteFeeBalance() view returns (uint256)",
  "function creator() view returns (address)",
]);

export const vaultAbi = parseAbi([
  "function totalLocked(address token) view returns (uint256)",
  "function releasable(address token) view returns (uint256)",
]);

export const escrowAbi = parseAbi([
  "function balanceOf(address recipient) view returns (uint256)",
  "function claim() returns (uint256 amount)",
  "function claimToken(address token) returns (uint256 amount)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export type LaunchRow = {
  token: Address;
  curve: Address;
  deployer: Address;
  graduationThreshold: bigint;
  name: string;
  symbol: string;
  logo: string;
  description: string;
  quoteReserve: bigint;
  trackedQuote: bigint;
  graduated: boolean;
  progress: number; // 0..1 toward graduation
  quoteSymbol: string; // "USDC" | "EURC"
  quoteDecimals: number; // 18 native, 6 for EURC
  pairToken: Address; // 0x0 for native
};

const explorerTx = (h: string) => `${arcTestnet.blockExplorers!.default.url}/tx/${h}`;
const explorerAddr = (a: string) => `${arcTestnet.blockExplorers!.default.url}/address/${a}`;
export const explorer = { tx: explorerTx, address: explorerAddr };
