// Builds safe/pack-mainnet.json (Safe Transaction Builder batch) from the survey written by
// pack-scan.ts (report.json) and a hand-picked candidates.json in the same OUT directory:
//   [{ "address": "0x…", "note": "why", "pair": true|false, "pool"?: "0x…poolId" }]
// Also prints the markdown rows for docs/PACK_CANDIDATES.md. Read-only; nothing is broadcast.
//
//   cd indexer && OUT=/some/dir npx tsx test/.smoke/pack-batch.ts > /some/dir/rows.md
//
// Sizing (all assumptions are repeated at the top of docs/PACK_CANDIDATES.md):
//   floor       = min($25,000, 0.1% of totalSupply × price), in the pool's quote asset (USDG 6-dec or ETH wei),
//                 lowered to the pool's impact cap when the pool is too thin to fill it within maxSlippageBps
//   maxPerBurn  = the largest buy the V4Quoter fills within 5% of spot (candidates.json `cap`), else 2% of the quote-side
//                 virtual depth L·√P; never below the floor
//   setParams   = 7 days, current bountyBps / maxSlippageBps / permissionless / keeper from /pound
//   pair tokens = phantom 4,000 USD / graduation 10,000 USD expressed in the token at the survey price (as USDG's 4,000 / 10,000)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";

const OUT = process.env.OUT ?? join(process.cwd(), "pack-scan-out");
const SAFE = "0x6db9a7fF776c7091C0A3c9847bD8a43eBA6892D8";
const BURNER = "0xBA7b0b8E33d64c14caFBd44cA808875A25713C34";
const FACTORY = "0xe7e9a4c041a1356747b4369C55A9991784412f24";
const KEEPER = "0xA86480B3658d220f43c274E244A0c1b3d35d79FA";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const ZERO = "0x0000000000000000000000000000000000000000";
const FLOOR_USD = 25_000;
const SUPPLY_BPS = 10; // 0.1 %
const DEPTH_SHARE = 0.02; // of the quote-side virtual depth per burn
const PHANTOM_USD = 4_000;
const GRADUATION_USD = 10_000;
// current burner params (indexer /pound, 2026-09-25): minInterval 86400 → 7 days; the rest unchanged
const PARAMS = { minInterval: 7 * 86_400, bountyBps: 50, maxSlippageBps: 500, permissionless: false, keeper: KEEPER };

type AnchorPool = {
  id: string; currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string; liquidity: string; sqrtPriceX96: string; tick: number;
  quote: string; quoteSymbol: string; priceInQuote: number; depthQuote: number; depthToken: number; depthQuoteUsd: number; block: number;
};
type Row = {
  address: string; symbol: string | null; name: string | null; decimals: number | null; totalSupply: number | null; pmBalance: number;
  priceUsd: number | null; pmValueUsd: number | null; fdvUsd: number | null; pools: number; livePools: number; anchorPools: AnchorPool[];
};
// cap: the largest buy (USD) the V4Quoter filled within maxSlippageBps of spot (pack-scan.ts `quote`); when given it
// replaces the 2%-of-depth estimate for maxPerBurn and bounds the floor.
type Candidate = { address: string; note: string; pair?: boolean; pool?: string; cap?: number };

const report = JSON.parse(readFileSync(join(OUT, "report.json"), "utf8")) as { head: number; ethUsd: number | null; rows: Row[] };
const candidates = JSON.parse(readFileSync(join(OUT, "candidates.json"), "utf8")) as Candidate[];
const byAddr = new Map(report.rows.map((r) => [r.address.toLowerCase(), r]));
const ethUsd = report.ethUsd;
if (!ethUsd) throw new Error("no ETH price in report.json");

const checksum = (a: string) => getAddress(a); // the survey keeps addresses lower-case; the batch is checksummed like the other files in safe/
const raw = (human: number, decimals: number): string => {
  // exact enough for a Safe input: scale in two steps to avoid float overflow past 2^53
  const [int, frac = ""] = human.toFixed(Math.min(decimals, 12)).split(".");
  const digits = (int + frac.padEnd(decimals, "0").slice(0, decimals)).replace(/^0+(?=\d)/, "");
  return digits === "" ? "0" : digits;
};
const fmtUsd = (n: number) => (n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`);
const fmtQty = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n >= 1 ? n.toFixed(2) : n.toPrecision(3));

const input = (name: string, type: string, internalType = type) => ({ name, type, internalType });
const call = (to: string, name: string, inputs: unknown[], values: Record<string, string>) => ({
  to, value: "0", data: null, contractMethod: { inputs, name, payable: false }, contractInputsValues: values,
});

const txs: unknown[] = [];
txs.push(
  call(BURNER, "setParams", [input("minInterval_", "uint32"), input("bountyBps_", "uint16"), input("maxSlippageBps_", "uint16"), input("permissionless_", "bool"), input("keeper_", "address")], {
    minInterval_: String(PARAMS.minInterval), bountyBps_: String(PARAMS.bountyBps), maxSlippageBps_: String(PARAMS.maxSlippageBps), permissionless_: String(PARAMS.permissionless), keeper_: PARAMS.keeper,
  }),
);

const mdRows: string[] = [];
const pairRows: string[] = [];
const summary: string[] = [];
for (const c of candidates) {
  const r = byAddr.get(c.address.toLowerCase());
  if (!r) throw new Error(`candidate ${c.address} not in report`);
  const pool = c.pool ? r.anchorPools.find((p) => p.id === c.pool) : r.anchorPools.find((p) => p.fee < 50_000 && (p.fee & 0x800000) === 0) ?? r.anchorPools[0];
  if (!pool) throw new Error(`candidate ${r.symbol} has no ETH/USDG pool`);
  if (r.priceUsd === null || r.totalSupply === null || r.decimals === null) throw new Error(`candidate ${r.symbol} is not priced`);
  const dec = r.decimals;
  const supplyValueUsd = r.totalSupply * r.priceUsd;
  const supplyFloorUsd = (supplyValueUsd * SUPPLY_BPS) / 10_000;
  let floorUsd = Math.min(FLOOR_USD, supplyFloorUsd);
  const capUsd = c.cap ?? pool.depthQuoteUsd * DEPTH_SHARE;
  let lowered = false;
  if (capUsd < floorUsd) { floorUsd = capUsd; lowered = true; }
  const maxUsd = Math.max(floorUsd, capUsd);
  const quoteIsUsdg = pool.quote === USDG;
  const toQuote = (usd: number) => (quoteIsUsdg ? raw(usd, 6) : raw(usd / ethUsd, 18));
  const floorRaw = toQuote(floorUsd);
  const maxRaw = toQuote(maxUsd);
  const floorTokens = floorUsd / r.priceUsd;
  const tokensFor25k = FLOOR_USD / r.priceUsd;
  const key = [checksum(pool.currency0), checksum(pool.currency1), String(pool.fee), String(pool.tickSpacing), checksum(pool.hooks)];
  txs.push(
    call(BURNER, "addPack", [
      input("token", "address"),
      { name: "key", type: "tuple", internalType: "struct PoolKey", components: [input("currency0", "address", "Currency"), input("currency1", "address", "Currency"), input("fee", "uint24"), input("tickSpacing", "int24"), input("hooks", "address", "contract IHooks")] },
      input("floor", "uint128"), input("maxPerBurn", "uint128"),
    ], { token: checksum(r.address), key: JSON.stringify(key), floor: floorRaw, maxPerBurn: maxRaw }),
  );
  const quoteUnit = quoteIsUsdg ? "USDG" : "ETH";
  const humanQuote = (usd: number) => (quoteIsUsdg ? `${fmtQty(usd)} USDG` : `${(usd / ethUsd).toFixed(4)} ETH`);
  mdRows.push(
    `| ${r.symbol} | \`${r.address}\` | ${pool.quoteSymbol} / fee ${pool.fee === 0x800000 ? "dynamic" : (pool.fee / 10_000).toFixed(2) + "%"} / ts ${pool.tickSpacing} / hooks \`${pool.hooks === ZERO ? "0x0" : pool.hooks.slice(0, 10) + "…"}\` | ${fmtUsd(pool.depthQuoteUsd)} | ${fmtUsd(r.pmValueUsd ?? 0)} | ${fmtUsd(r.priceUsd)} | ${fmtQty(r.totalSupply)} (FDV ${fmtUsd(r.fdvUsd ?? 0)}) | ${fmtQty(r.totalSupply / 1000)} = ${fmtUsd(supplyFloorUsd)} | ${fmtQty(tokensFor25k)} | ${humanQuote(floorUsd)} (${fmtUsd(floorUsd)}${lowered ? ", lowered to the pool's cap" : supplyFloorUsd < FLOOR_USD ? ", the 0.1% leg" : ", the $25K leg"}) | ${humanQuote(maxUsd)} (${fmtUsd(maxUsd)}) | ${c.note} |`,
  );
  summary.push(`${r.symbol}: pool ${pool.id.slice(0, 10)} quote=${quoteUnit} floor=${floorRaw} max=${maxRaw} (${fmtUsd(floorUsd)} / ${fmtUsd(maxUsd)}) depth=${fmtUsd(pool.depthQuoteUsd)} price=${r.priceUsd} supply=${r.totalSupply}${lowered ? " FLOOR LOWERED" : ""}`);
  if (c.pair) {
    const phantomRaw = raw(PHANTOM_USD / r.priceUsd, dec);
    const gradRaw = raw(GRADUATION_USD / r.priceUsd, dec);
    txs.push(
      call(FACTORY, "setPairTokenEconomics", [input("pairToken", "address"), input("phantomQuote", "uint256"), input("graduationThreshold", "uint256"), input("decimals", "uint8")], {
        pairToken: checksum(r.address), phantomQuote: phantomRaw, graduationThreshold: gradRaw, decimals: String(dec),
      }),
      call(FACTORY, "setPairTokenApproved", [input("pairToken", "address"), input("approved", "bool")], { pairToken: checksum(r.address), approved: "true" }),
    );
    pairRows.push(`| ${r.symbol} | ${fmtUsd(r.priceUsd)} | ${fmtQty(PHANTOM_USD / r.priceUsd)} ${r.symbol} (\`${phantomRaw}\`) | ${fmtQty(GRADUATION_USD / r.priceUsd)} ${r.symbol} (\`${gradRaw}\`) | ${dec} |`);
  }
}

const names = candidates.map((c) => byAddr.get(c.address.toLowerCase())!.symbol).join(", ");
const batch = {
  version: "1.0",
  chainId: "4663",
  createdAt: Date.now(),
  meta: {
    name: "Radian: The Pound's first Pack (weekly rotation)",
    description: `1) PackBurner.setParams(7 days, ${PARAMS.bountyBps}, ${PARAMS.maxSlippageBps}, ${PARAMS.permissionless}, keeper) 2) PackBurner.addPack × ${candidates.length}: ${names} — floor = min($25K, 0.1% of supply, the pool's 5%-slippage cap) and maxPerBurn = the largest V4Quoter fill within 5% of spot, in the pool's quote asset at survey prices (block ${report.head}, ETH ${ethUsd.toFixed(0)} USDG)${pairRows.length ? ` 3) factory.setPairTokenEconomics + setPairTokenApproved for ${candidates.filter((c) => c.pair).map((c) => byAddr.get(c.address.toLowerCase())!.symbol).join(", ")} (4,000 / 10,000 USD in the token)` : ""}. Assumptions and how to submit: docs/PACK_CANDIDATES.md. Safe ${SAFE}`,
    txBuilderVersion: "1.17.0",
    createdFromSafeAddress: SAFE,
    createdFromOwnerAddress: "",
    checksum: "",
  },
  transactions: txs,
};
writeFileSync(join(OUT, "pack-mainnet.json"), JSON.stringify(batch, null, 2) + "\n");
console.log("## addPack rows\n");
console.log(mdRows.join("\n"));
console.log("\n## pair rows\n");
console.log(pairRows.join("\n"));
console.log("\n## summary\n");
console.log(summary.join("\n"));
console.error(`wrote ${join(OUT, "pack-mainnet.json")} with ${txs.length} calls`);
