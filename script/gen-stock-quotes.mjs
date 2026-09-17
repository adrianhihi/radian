// Builds the Safe batches (and the web / indexer config snippets) that approve
// Robinhood's canonical stock tokens as quote assets on the Robinhood Chain
// mainnet factory. Nothing here touches the chain: the Safe executes the
// batches, and only after the legal read on tokenized stocks (MAINNET_RUNBOOK.md).
//
//   node script/gen-stock-quotes.mjs            # writes safe/stocks/*
//
// Economics per token mirror the USDG pair (4,000 / 10,000 dollars): shares are
// derived from a reference price (Yahoo chart endpoint, keyless, delayed) and the
// token's ERC-8056 uiMultiplier (1 raw token unit = multiplier shares).
import { mkdir, writeFile } from "node:fs/promises";

const FACTORY = "0xe7e9a4c041a1356747b4369C55A9991784412f24";
const SAFE = "0x6db9a7fF776c7091C0A3c9847bD8a43eBA6892D8";
const PHANTOM_USD = 4000;
const GRADUATION_USD = 10000;
const CHUNK = 30; // tokens per Safe batch (2 calls each) — keeps one execution well under the block gas limit

const regRaw = await (await fetch("https://api.robinhood.com/rhj/assets", { headers: { "User-Agent": "Mozilla/5.0" } })).json();
const reg = Array.isArray(regRaw) ? regRaw : regRaw.results ?? regRaw.assets ?? regRaw.data ?? [];
const assets = reg
  .filter((a) => a.status === "ASSET_STATUS_ACTIVE" && a.isin && a.tokenDecimals === 18)
  .map((a) => ({
    symbol: a.tokenSymbol,
    name: a.tokenName.replace(" • Robinhood Token", ""),
    address: a.deployments.find((d) => d.chainId === 4663)?.contractAddress,
    multiplier: Number(a.currentMultiplier),
    logo: a.logoUrl,
    tradable: a.tradingCapabilities?.market?.whole === "TRADING_STATUS_TRADABLE",
  }))
  .filter((a) => a.address && a.tradable);

async function price(symbol) {
  const y = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const r = await fetch(y, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return null;
  const j = await r.json();
  const m = j?.chart?.result?.[0]?.meta;
  return m?.regularMarketPrice && m.currency === "USD" ? m.regularMarketPrice : null;
}

const rows = [];
const skipped = [];
for (const a of assets) {
  const p = await price(a.symbol);
  if (!p) { skipped.push(`${a.symbol} (no USD price)`); continue; }
  // raw units = shares / multiplier; 18 decimals
  const raw = (usd) => BigInt(Math.round((usd / p / a.multiplier) * 1e6)) * 10n ** 12n;
  rows.push({ ...a, price: p, phantom: raw(PHANTOM_USD).toString(), graduation: raw(GRADUATION_USD).toString(), gradShares: GRADUATION_USD / p });
  await new Promise((r) => setTimeout(r, 150));
}

await mkdir("safe/stocks", { recursive: true });
const call = (name, inputs, values) => ({ to: FACTORY, value: "0", data: null, contractMethod: { inputs, name, payable: false }, contractInputsValues: values });
for (let i = 0; i < rows.length; i += CHUNK) {
  const part = rows.slice(i, i + CHUNK);
  const txs = part.flatMap((r) => [
    call("setPairTokenEconomics", [{ name: "pairToken", type: "address", internalType: "address" }, { name: "phantomQuote", type: "uint256", internalType: "uint256" }, { name: "graduationThreshold", type: "uint256", internalType: "uint256" }, { name: "decimals", type: "uint8", internalType: "uint8" }], { pairToken: r.address, phantomQuote: r.phantom, graduationThreshold: r.graduation, decimals: "18" }),
    call("setPairTokenApproved", [{ name: "pairToken", type: "address", internalType: "address" }, { name: "approved", type: "bool", internalType: "bool" }], { pairToken: r.address, approved: "true" }),
  ]);
  const n = i / CHUNK + 1;
  await writeFile(`safe/stocks/approve-stocks-${String(n).padStart(2, "0")}.json`, JSON.stringify({
    version: "1.0", chainId: "4663", createdAt: Date.now(),
    meta: { name: `Radian: approve stock quote assets ${n}`, description: `${part.map((r) => r.symbol).join(", ")}. Economics = ${PHANTOM_USD} / ${GRADUATION_USD} USD in shares at generation-time prices. Safe ${SAFE}.`, txBuilderVersion: "1.17.0", createdFromSafeAddress: SAFE, createdFromOwnerAddress: "", checksum: "" },
    transactions: txs,
  }, null, 2));
}
// web quoteAssets entries + indexer QUOTE_ASSETS_JSON
const web = rows.map((r) => `      { key: "${r.symbol.toLowerCase()}", symbol: "${r.symbol}", address: "${r.address}", decimals: 18, native: false, gradGoal: ${r.gradShares.toFixed(r.gradShares < 10 ? 3 : 1)}, blurb: "${r.name.replace(/"/g, "")}, priced in shares", stock: { refSymbol: "${r.symbol}", standIn: false } },`).join("\n");
await writeFile("safe/stocks/web-quoteAssets.ts.txt", web + "\n");
await writeFile("safe/stocks/indexer-QUOTE_ASSETS_JSON.txt", JSON.stringify(Object.fromEntries(rows.map((r) => [r.address, { symbol: r.symbol, decimals: 18 }]))) + "\n");
await writeFile("safe/stocks/prices-used.csv", "symbol,address,price_usd,multiplier,phantom_raw,graduation_raw\n" + rows.map((r) => [r.symbol, r.address, r.price, r.multiplier, r.phantom, r.graduation].join(",")).join("\n") + "\n");
console.log(`${rows.length} tokens priced, ${Math.ceil(rows.length / CHUNK)} batches; skipped ${skipped.length}: ${skipped.join("; ")}`);
