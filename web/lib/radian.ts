import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  parseAbi,
  type Address,
} from "viem";

// ---- Arc testnet (Circle) ----
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  // Multicall3 is canonically deployed on Arc — lets viem batch dozens of
  // reads into ONE eth_call, so the grid doesn't hammer the public RPC (429s).
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

// ---- Radian deployment on Arc testnet (Pons V2 port) ----
export const RADIAN = {
  factory: "0x90022cC2107De9c070F889E3A67009FcA270E4E2" as Address,
  locker: "0x7efb5B773BBbf69Bd163b52b1BA88C529a0f123c" as Address,
  vault: "0xe84D81C3d4f3E12123C9F934AB3Cb8238772b39e" as Address,
  escrow: "0x6133392C976d5160CBDE63815f7cd63122f3841C" as Address,
  hook: "0x15eB3aeE2f96A199165dc58e6C8dc3Ce2e02e044" as Address,
  poolManager: "0x24219d0F3611fE4E438850bB7DB165439957dc9f" as Address,
  deployBlock: 61305678n,
} as const;

// Quote assets a token can be paired against. Native USDC is the gas coin
// (pairToken = 0, 18-dec msg.value). EURC is an approved ERC-20 (6-dec) —
// the "born paired to a real asset" story, on Arc's native Circle primitives.
export const NATIVE_QUOTE = "0x0000000000000000000000000000000000000000" as Address;
export type QuoteAsset = { key: string; symbol: string; address: Address; decimals: number; native: boolean; blurb: string };
export const QUOTE_ASSETS: QuoteAsset[] = [
  { key: "usdc", symbol: "USDC", address: NATIVE_QUOTE, decimals: 18, native: true, blurb: "Native dollar — the Arc gas coin" },
  { key: "eurc", symbol: "EURC", address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6, native: false, blurb: "Circle's euro stablecoin" },
];
export const quoteByAddress = (a?: string): QuoteAsset =>
  QUOTE_ASSETS.find((q) => q.address.toLowerCase() === (a ?? "").toLowerCase()) ?? QUOTE_ASSETS[0];

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

export function getWalletClient() {
  if (typeof window === "undefined" || !(window as any).ethereum) return null;
  return createWalletClient({
    chain: arcTestnet,
    transport: custom((window as any).ethereum),
  });
}

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
