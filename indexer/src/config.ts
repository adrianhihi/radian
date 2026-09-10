import { createPublicClient, http, defineChain, parseAbi, type Address } from "viem";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC ?? "https://rpc.testnet.arc.io"] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

export const FACTORY = "0x90022cC2107De9c070F889E3A67009FcA270E4E2" as Address;
export const VAULT = "0xe84D81C3d4f3E12123C9F934AB3Cb8238772b39e" as Address;
export const FACTORY_DEPLOY_BLOCK = 61305678n;

// Resolve a launch's pairToken to display metadata. Native (0x0) = USDC/18.
export function quoteMeta(pairToken?: string): { symbol: string; decimals: number } {
  const a = (pairToken ?? "").toLowerCase();
  if (!a || a === "0x0000000000000000000000000000000000000000") return { symbol: "USDC", decimals: 18 };
  if (a === "0x89b50855aa3be2f677cd6303cec089b5f319d72a") return { symbol: "EURC", decimals: 6 };
  return { symbol: "TOKEN", decimals: 18 };
}

// Seed launches so /launches is never empty and historical trades are catchable.
const DEV = "0x13E6b6C635CAcD4B27C9309251A4D083457eb11C" as Address;
const NATIVE = "0x0000000000000000000000000000000000000000";
export const SEED: { token: Address; curve: Address; deployer: Address; graduationThreshold: string; pairToken: string }[] = [
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
