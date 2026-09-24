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
  router: NET.contracts.router,
  pofRouter: NET.contracts.pofRouter,
  executor: NET.contracts.executor,
  wallTreasuryImpl: NET.contracts.wallTreasuryImpl,
  wallStakingImpl: NET.contracts.wallStakingImpl,
  pofVaultImpl: NET.contracts.pofVaultImpl,
  wallLadderImpl: NET.contracts.wallLadderImpl,
  deployBlock: NET.deployBlock,
} as const;

// Quote assets a token can be paired against (native USDC + any approved ERC-20).
export const NATIVE_QUOTE = "0x0000000000000000000000000000000000000000" as Address;
export type QuoteAsset = {
  key: string; symbol: string; address: Address; decimals: number; native: boolean; blurb: string;
  gradGoal: number;
  featured?: boolean;
  stock?: { refSymbol: string; standIn: boolean };
};
export const QUOTE_ASSETS: QuoteAsset[] = NET.quoteAssets;
// Native (zero address) → USDC. A known ERC-20 → its config. An ERC-20 we have no
// config for → undefined, so callers read its symbol/decimals from chain instead of
// silently treating it as native (which would send msg.value to an ERC-20 curve).
export const quoteByAddress = (a?: string): QuoteAsset | undefined => {
  const addr = (a ?? "").toLowerCase();
  if (!addr || addr === NATIVE_QUOTE) return QUOTE_ASSETS[0];
  return QUOTE_ASSETS.find((q) => q.address.toLowerCase() === addr);
};

// Arc seals a block every ~0.45s; viem's default 4s poll would make every
// receipt wait look 4-8x slower than the chain actually is.
export const publicClient = createPublicClient({ chain: arcTestnet, transport: http(), pollingInterval: 500 });
export const hasLaunchRouter = RADIAN.router !== "0x0000000000000000000000000000000000000000";
// Templates and delegated buys: deployed AND switched on for this network (networks.ts `features`).
export const hasTemplates = hasLaunchRouter && (NET.features?.templates ?? true);
export const hasPofRouter = RADIAN.pofRouter !== "0x0000000000000000000000000000000000000000" && hasTemplates;
export const hasExecutor = RADIAN.executor !== "0x0000000000000000000000000000000000000000" && (NET.features?.delegatedBuys ?? true);
// The Pound: when the network has a PoundVault the router is v4 (trades carry referral tags)
export const POUND = NET.pound;
export const hasPound = !!NET.pound;

// ---- ABIs (only what the UI needs) ----
export const factoryAbi = parseAbi([
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
  "function launchToken((string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt) params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)",
  "function launchFee() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns ((uint256 supply, uint256 curveFeeBps, uint256 phantomQuote, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, bool enabled))",
]);

// RadianLaunchRouter v2: launch + creator's first buy in one transaction, plus
// the two launch templates (The Wall, Proof-of-Fee). The router overwrites
// `creatorFeeRecipient` / `buybackEnabled` for templates (fees must reach the
// treasury / vault), so the UI sends the params as-is.
export const routerAbi = parseAbi([
  "function launchAndBuy((string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt) params, uint256 launchConfigId, address pairToken, uint256 buyAmount, uint256 minTokensOut, address[] snipeTaxExemptions, address referrer) payable returns (address token, address curve, uint256 tokensOut)",
  "function launchWall((string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt) params, uint256 launchConfigId, address pairToken, uint256 buyAmount, uint256 minTokensOut, address[] snipeTaxExemptions, (uint16 marginBps, uint16 epochBudgetBps, uint16 streamBps, uint16 maxSlippageBps, uint32 minInterval, uint128 keeperBounty) cfg) payable returns (address token, address curve, address treasury, address staking)",
  "function launchPoF((string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt) params, uint256 launchConfigId, address pairToken, uint256 buyAmount, uint256 minTokensOut, address[] snipeTaxExemptions, (uint128 targetWork, uint32 roundSeconds, uint32 minInterval, uint16 maxBuybackReserveBps) cfg) payable returns (address token, address curve, address vault)",
  "function predictWall(address creator, bytes32 salt) view returns (address treasury, address staking)",
  "function predictPoF(address creator, bytes32 salt) view returns (address vault)",
  "function pofRouter() view returns (address)",
  "function keeper() view returns (address)",
  "event WallLaunched(address indexed deployer, address indexed token, address curve, address treasury, address staking, address pairToken)",
  "event PoFLaunched(address indexed deployer, address indexed token, address curve, address vault, address pairToken)",
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
  "function creatorTaxBps() view returns (uint256)",
  "function snipeTaxSeconds() view returns (uint256)",
  "function snipeTaxStartBps() view returns (uint256)",
]);

export const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function logo() view returns (string)",
  "function description() view returns (string)",
  "function socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)",
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
  "function balanceOfToken(address recipient, address token) view returns (uint256)",
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
  // Launch template (indexer-derived); undefined/null = Standard.
  template?: LaunchTemplate | null;
  // Trade-log facts from the indexer (absent on the chain-read fallback).
  spark?: [number, number][]; // [ts ms, quote per token]
  lastPrice?: number | null;
  change24h?: number | null; // percent; null = fewer than two trades
  volume24h?: number; // quote units
  trades24h?: number;
  createdAt?: number; // ms
  creatorName?: string; // the deployer's signed profile name (indexer); "" when none
  holders?: number | null; // wallets holding it now (indexer); null = not counted yet
};

// Which launch template a token used, and where its per-launch contracts live.
export type LaunchTemplate =
  | { kind: "wall"; treasury: Address; staking: Address; ladder?: Address }
  | { kind: "pof"; vault: Address; pofRouter: Address };

const explorerTx = (h: string) => `${arcTestnet.blockExplorers!.default.url}/tx/${h}`;
const explorerAddr = (a: string) => `${arcTestnet.blockExplorers!.default.url}/address/${a}`;
export const explorer = { tx: explorerTx, address: explorerAddr };
