import { createPublicClient, http, defineChain, parseAbi, type Address } from "viem";

// Chain parameters. Defaults are Arc testnet; every value can be overridden so
// the same image serves another EVM chain (e.g. Robinhood Chain testnet:
// CHAIN_ID=46630 RPC_URL=https://rpc.testnet.chain.robinhood.com NATIVE_SYMBOL=ETH SCAN_MODE=logs).
export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 5042002);
export const CHAIN_NAME = process.env.CHAIN_NAME ?? (CHAIN_ID === 5042002 ? "Arc Testnet" : `chain-${CHAIN_ID}`);
export const RPC_URL = process.env.RPC_URL ?? process.env.ARC_RPC ?? "https://rpc.testnet.arc.io";
export const NATIVE_SYMBOL = process.env.NATIVE_SYMBOL ?? "USDC";
export const IS_ARC_TESTNET = CHAIN_ID === 5042002;
// "receipts": per-block receipts, one call at a time (Arc's public RPC rejects
// batches and serves eth_getLogs unreliably). "logs": eth_getLogs over block
// ranges with our event topics, timestamps from the logs (standard RPCs).
export const SCAN_MODE = (process.env.SCAN_MODE ?? (IS_ARC_TESTNET ? "receipts" : "logs")) as "receipts" | "logs";
export const LOGS_RANGE = Number(process.env.LOGS_RANGE ?? 2000); // blocks per eth_getLogs in logs mode

export const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: NATIVE_SYMBOL, symbol: NATIVE_SYMBOL, decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { multicall3: { address: (process.env.MULTICALL3 ?? "0xcA11bde05977b3631167028862bE2a173976CA11") as Address } },
  testnet: true,
});

// JSON-RPC batching: concurrent block/receipt fetches collapse into a few HTTP
// requests. Arc's public RPC rejects big batches ("Request exceeds defined
// limit"), so batches stay small, and `singleClient` (no batching) is the
// fallback for any call that fails inside a batch.
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(undefined, { batch: { wait: 10, batchSize: 8 }, retryCount: 2, timeout: 20_000 }),
});
export const singleClient = createPublicClient({
  chain: arcTestnet,
  transport: http(undefined, { batch: false, retryCount: 2, timeout: 20_000 }),
});

export const FACTORY = (process.env.FACTORY ?? "0x90022cC2107De9c070F889E3A67009FcA270E4E2") as Address;
export const VAULT = (process.env.VAULT ?? "0xe84D81C3d4f3E12123C9F934AB3Cb8238772b39e") as Address;
// First block in which the factory has code (binary-searched on-chain). The
// previous value, 61305678, was ~2000 blocks late.
export const FACTORY_DEPLOY_BLOCK = BigInt(process.env.FACTORY_DEPLOY_BLOCK ?? (IS_ARC_TESTNET ? "61303632" : "0"));

// Approved pair (quote) assets on Arc testnet. Native (0x0) = USDC/18. Keep in
// sync with web/lib/networks.ts — the frontend is the source of truth for
// display metadata, this only labels what the indexer serves.
const QUOTE_ASSETS: Record<string, { symbol: string; decimals: number }> = {
  "0x89b50855aa3be2f677cd6303cec089b5f319d72a": { symbol: "EURC", decimals: 6 },
  "0xdebcc47bf6e1defe1ec76290441836e4981da882": { symbol: "NVDAx", decimals: 18 },
  "0xb538054166a5f9aa98b945d32a7d1f122c1c3c87": { symbol: "TSLAx", decimals: 18 },
  "0x88ad67d823791c2dd5ddd96cf88e573a1f5bb785": { symbol: "AAPLx", decimals: 18 },
  "0x195a4d07e2bd492f70063e6c7017e336e28a8f68": { symbol: "GOOGLx", decimals: 18 },
  "0xd7ded9057a4ec0a329d2c70784c8723f7df56e7f": { symbol: "MSFTx", decimals: 18 },
  "0x865e62e6327c572c7fb8d3427f67b03b9a4558fb": { symbol: "AMZNx", decimals: 18 },
  "0xffba38678178dc0b7a0eaceceaf36795bb750977": { symbol: "METAx", decimals: 18 },
  "0x072f8fa84c12e56fe20d3f0bfbb903a96b099973": { symbol: "SPYx", decimals: 18 },
};

// Per-chain overrides / additions: QUOTE_ASSETS_JSON='{"0x…":{"symbol":"USDGx","decimals":6}}'
try {
  const extra = JSON.parse(process.env.QUOTE_ASSETS_JSON ?? "{}") as Record<string, { symbol: string; decimals: number }>;
  for (const [k, v] of Object.entries(extra)) QUOTE_ASSETS[k.toLowerCase()] = v;
} catch (e) {
  console.error("[config] QUOTE_ASSETS_JSON unreadable:", (e as Error).message);
}

// Resolve a launch's pairToken to display metadata.
export function quoteMeta(pairToken?: string): { symbol: string; decimals: number } {
  const a = (pairToken ?? "").toLowerCase();
  if (!a || a === "0x0000000000000000000000000000000000000000") return { symbol: NATIVE_SYMBOL, decimals: 18 };
  return QUOTE_ASSETS[a] ?? { symbol: "TOKEN", decimals: 18 };
}

// Launches retired in favour of a successor. Hidden from the lists (Explore,
// activity, stats) but still resolvable at /token/:addr so a direct link can
// explain what happened and point to the current version.
export const SUNSET: Record<string, { successor: Address; reason: string }> = {
  // The Wall v1: its immutable on-chain description misstated the mechanics.
  "0xf8ab1b64598d7d422baba415b10ec34ca6f0096d": {
    successor: "0x5a8b01D1D7Bfe524F1969494528a64971897C535" as Address,
    reason: "Relaunched with an on-chain description that matches the contracts.",
  },
};
export const isSunset = (token: string) => token.toLowerCase() in SUNSET;

// RadianLaunchRouter: launch + creator's first buy in one tx. Its transactions
// have tx.to = router, so the scanner must treat it as a known entry point.
export const LAUNCH_ROUTER = (process.env.LAUNCH_ROUTER ?? "0xB9F097662302F220989AAeBa6776041d7d625fAE") as Address; // v2 (templates)
export const LAUNCH_ROUTER_V1 = (IS_ARC_TESTNET ? "0x2333449a1d83c5F99f29d5a17554D76245412C0E" : "0x0000000000000000000000000000000000000000") as Address; // Arc only, kept for history
// Template + delegated-execution contracts (2026-09-14). Buys through PoFRouter
// and RadianExecutor have tx.to = those contracts, so they are entry points too.
export const POF_ROUTER = (process.env.POF_ROUTER ?? "0x7a21533EBEdC7222F299dcfd46E0463E744bF6E8") as Address;
export const EXECUTOR = (process.env.EXECUTOR ?? "0xbf1fbda5991Ff34733AE74eDB84F74527B9588C1") as Address;
export const KEEPER_PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY as `0x${string}` | undefined;
export const KEEPER_INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS ?? 60_000);
// Block ranges to (re)scan once on startup, e.g. launches that happened before
// an entry point was known to the scanner: "from-to,from-to".
export const RESCAN_RANGES = (process.env.RESCAN_RANGES ?? "").split(",").map((r) => r.trim()).filter(Boolean);

// Throwaway launches (speed tests, smoke tests) hidden from lists and stats.
// They stay reachable by direct URL; nothing on-chain changes.
export const HIDDEN = new Set<string>(
  [
    "0x00066b2D7194C2Af35B680b6f55fF61A1C525C08", // "Speed Test" (FAST): latency measurement, 2026-09-10
    "0x95b8fDAB9C93C4d97ec802706d7190EbdDeCFa3e", // "Router Smoke" (RSMK): first one-tx launch+buy through the router, 2026-09-10
  ].map((a) => a.toLowerCase()),
);
export const isHidden = (token: string) => HIDDEN.has(token.toLowerCase());

// Seed launches so /launches is never empty on a cold start while the
// backfill from FACTORY_DEPLOY_BLOCK is still running.
const DEV = "0x13E6b6C635CAcD4B27C9309251A4D083457eb11C" as Address;
const NATIVE = "0x0000000000000000000000000000000000000000";
export const SEED: { token: Address; curve: Address; deployer: Address; graduationThreshold: string; pairToken: string }[] = !IS_ARC_TESTNET ? [] : [
  { token: "0xF10B44F56AA4D92081e62311102E78EB39fe74DF", curve: "0xcEF395CCd9f79c11b459BB7bA1afd94227fE7Fd4", deployer: DEV, graduationThreshold: "20000000", pairToken: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" }, // EDOGE / EURC
  { token: "0xDe25b6d469f5607F830e4340FF7f70C2C362537f", curve: "0x0c1fd7F6838F2B73Cd035D73ae5619E05bF34b77", deployer: DEV, graduationThreshold: "20000000000000000000", pairToken: NATIVE },
  { token: "0xbDd735b3589420F9A4C3f31f080D1163eFa23f1F", curve: "0x2be563704A6290F6701378b392b4dFfd439e24Cd", deployer: DEV, graduationThreshold: "20000000000000000000", pairToken: NATIVE },
  { token: "0x2C1E7E5aC36cf54422ac035c7F008C2bCAC85988", curve: "0xEaab57d5180284E25bf909f0A9D282CB94C0E3CF", deployer: DEV, graduationThreshold: "20000000000000000000", pairToken: NATIVE },
  { token: "0xE34ca36154f0852DA8BCa8E350E54AFA114BFC34", curve: "0x246c72AF2b08D428adf1801AC63084bf39BcA271", deployer: DEV, graduationThreshold: "20000000000000000000", pairToken: NATIVE },
  { token: "0xfE829A204B07FFb7f3454077fc7c9B3f8a2d3c45", curve: "0x12a9598cF9680046F2F6Cb10DE8707F535D584e1", deployer: DEV, graduationThreshold: "20000000000000000000", pairToken: NATIVE },
  { token: "0xA1d3797855B9e248F27b3a172F31EF7AA5d8ee3A", curve: "0x641ba58E316479CB25Eaf348a6B231D604d82404", deployer: DEV, graduationThreshold: "20000000000000000000", pairToken: NATIVE },
];

export const factoryAbi = parseAbi([
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
]);

export const curveEventsAbi = parseAbi([
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
]);

export const curveReadAbi = parseAbi([
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function trackedQuote() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function quoteFeeBalance() view returns (uint256)",
]);

export const tokenReadAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function logo() view returns (string)",
  "function description() view returns (string)",
]);

export const vaultAbi = parseAbi([
  "function totalLocked(address token) view returns (uint256)",
]);

// ---- $RADIAN flywheel ----
export const RADIAN = {
  token: (process.env.RADIAN_TOKEN ?? (IS_ARC_TESTNET ? "0x0B764B1e50E4D17A897Cdd9494CaC3355579fDcD" : "0x0000000000000000000000000000000000000000")) as Address,
  curve: (process.env.RADIAN_CURVE ?? (IS_ARC_TESTNET ? "0x8925494f3cfB34cD0df2b4Bf83328928Fe22F126" : "0x0000000000000000000000000000000000000000")) as Address,
  // v2 (2026-09-10): two-step ownership, escrow claim, bounded flush.
  staking: (process.env.RADIAN_STAKING ?? (IS_ARC_TESTNET ? "0xf3832Fa6EBa9cD09161C2010c7E93a1A2B7f8B4c" : "0x0000000000000000000000000000000000000000")) as Address,
  treasury: (process.env.RADIAN_TREASURY ?? (IS_ARC_TESTNET ? "0xebCcaE2eDDaEfcaA5452058fc8f426dfC9570ba0" : "0x0000000000000000000000000000000000000000")) as Address,
};

export const stakingAbi = parseAbi([
  "function totalStaked() view returns (uint256)",
  "function rewardRate() view returns (uint256)",
  "function periodFinish() view returns (uint256)",
  "function totalDistributed() view returns (uint256)",
]);

export const treasuryAbi = parseAbi([
  "function totalBurned() view returns (uint256)",
  "function totalToStakers() view returns (uint256)",
  "function totalFlushed() view returns (uint256)",
  "function buybackBps() view returns (uint16)",
]);

export const radianTokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
]);

// RadianTreasury events → the public treasury ledger (see /radian.ledger).
export const treasuryEventsAbi = parseAbi([
  "event Flushed(uint256 usdcIn, uint256 radianBurned, uint256 toStakers)",
  "event FeesClaimed(uint256 amount)",
  "event TokenFeesClaimed(address indexed token, uint256 amount)",
]);

// Runtime code hashes recorded at deploy (`cast keccak $(cast code <addr>)`).
// The scanner re-hashes the live code at startup and reports the result on
// /health; a mismatch is logged loudly. The website does the same check and
// disables launching/trading on a proven mismatch.
const ARC_CODE_HASHES: { name: string; address: Address; hash: `0x${string}` }[] = [
  { name: "PonsV2LaunchFactory", address: FACTORY, hash: "0x4444b7a1dbfc5b7b43f7ea4213be5db1720e8e381628a0a5024a3bba57d71595" },
  { name: "PonsV2MemeHook", address: (process.env.RADIAN_ADDRESS ?? (IS_ARC_TESTNET ? "0x15eB3aeE2f96A199165dc58e6C8dc3Ce2e02e044" : "0x0000000000000000000000000000000000000000")) as Address, hash: "0x4d459c2b449407539e90df566a137db52aa6a34f69e45f1a062bd57e785a4bb2" },
  { name: "RadianLaunchRouter", address: LAUNCH_ROUTER, hash: "0xd73b94c80452b2e91fe4c38347ce2157d9f45cd7f9c242009f0480501a0b4788" },
  { name: "PoFRouter", address: POF_ROUTER, hash: "0xf5eb91076302ba59b8f58d3c6d445694e6a17c7acfa3d8e14040035130db0b98" },
  { name: "RadianExecutor", address: EXECUTOR, hash: "0x521601531f84dc48bbb390e6514314684da9cf1e45c46dee77f8eacc3e14623c" },
  { name: "RadianStaking", address: RADIAN.staking, hash: "0xf7e675e11f13fbc04cebd15754c1ae0c14994d5e2f3815b9d8eea04992bafb57" },
  { name: "RadianTreasury", address: RADIAN.treasury, hash: "0x232fdd7004bfce03847d90b4d777acfdacdb0d1549b7261f051a6ea475bacd87" },
];
// Other chains: CODE_HASHES_JSON='[{"name":"PonsV2LaunchFactory","address":"0x…","hash":"0x…"}]'
export const CODE_HASHES: { name: string; address: Address; hash: `0x${string}` }[] = (() => {
  try {
    const j = JSON.parse(process.env.CODE_HASHES_JSON ?? "null");
    if (Array.isArray(j)) return j;
  } catch (e) {
    console.error("[config] CODE_HASHES_JSON unreadable:", (e as Error).message);
  }
  return IS_ARC_TESTNET ? ARC_CODE_HASHES : [];
})();

// ---- templates ----
export const routerEventsAbi = parseAbi([
  "event WallLaunched(address indexed deployer, address indexed token, address curve, address treasury, address staking, address pairToken)",
  "event PoFLaunched(address indexed deployer, address indexed token, address curve, address vault, address pairToken)",
]);

export const wallTreasuryAbi = parseAbi([
  "function reserve() view returns (uint256)",
  "function claimable() view returns (uint256)",
  "function bookValue() view returns (uint256)",
  "function spot() view returns (uint256)",
  "function floorPrice() view returns (uint256)",
  "function budgetRemaining() view returns (uint256)",
  "function quoteToRestoreFloor() view returns (uint256)",
  "function lastDefendAt() view returns (uint64)",
  "function config() view returns (uint16 marginBps, uint16 epochBudgetBps, uint16 streamBps, uint16 maxSlippageBps, uint32 minInterval, uint128 keeperBounty)",
  "function claimFees() returns (uint256 claimed, uint256 streamed)",
  "function defend(uint256 maxSpend, uint256 minOut, uint256 deadline) returns (uint256 spent, uint256 burned)",
]);

export const pofVaultAbi = parseAbi([
  "function plannedSpend() view returns (uint256)",
  "function lastBuybackAt() view returns (uint64)",
  "function config() view returns (uint128 targetWork, uint32 roundSeconds, uint32 minInterval, uint16 maxBuybackReserveBps)",
  "function claimAndBuy(uint256 minOut, uint256 deadline) returns (uint256 spent, uint256 out)",
  "function poke()",
  "function currentRound() view returns (uint256)",
]);

export const executorAbi = parseAbi([
  "struct BuyAuth { address user; address token; uint256 perBuyMax; uint256 maxGasPrice; uint32 totalCount; uint32 minInterval; uint64 deadline; uint256 nonce; }",
  "function executeBuy(BuyAuth a, bytes sig, uint256 amount, uint256 minOut) returns (uint256 tokensOut)",
  "function nonces(address) view returns (uint256)",
  "function balanceOf(address user, address asset) view returns (uint256)",
  "function execs(bytes32) view returns (uint32 count, uint64 lastAt)",
  "function authId((address user,address token,uint256 perBuyMax,uint256 maxGasPrice,uint32 totalCount,uint32 minInterval,uint64 deadline,uint256 nonce) a) pure returns (bytes32)",
  "function keeper() view returns (address)",
]);

export const curveTradeAbi = parseAbi([
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256)",
  "function launchedAt() view returns (uint256)",
]);

export const EXECUTOR_DOMAIN = { name: "RadianExecutor", version: "1" } as const;
export const HAS_RADIAN = RADIAN.token !== "0x0000000000000000000000000000000000000000";
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
