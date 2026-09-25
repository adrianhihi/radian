import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The keeper's other-chain Pack burn, exercised end to end in dry-run: one BSC coin, no RPC (so the
// plan is quoted at `cap`), HalfMoon answered by a mocked fetch. Nothing touches a chain.
const dir = mkdtempSync(join(tmpdir(), "radian-otherchains-"));
process.env.SNAPSHOT_PATH = join(dir, "snap.json");
process.env.HALFMOON_API_KEY = "test-jwt";
process.env.KEEPER_PRIVATE_KEY = "0x" + "11".repeat(32); // a throwaway key: signs nothing here
process.env.OTHER_CHAIN_DRY_RUN_INTERVAL_S = "0"; // re-plan on every tick in this test
delete process.env.KEEPER_DRY_RUN; // unset + no RPC → dry-run
delete process.env.OTHER_CHAIN_RPC_JSON;
delete process.env.POUND_VAULT;
delete process.env.PACK_BURNER;
const COIN = "0xba2ae424d960c26247dd6c32edc70b295c744c43"; // DOGE on BSC
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const CAP = 50n * 10n ** 18n;
process.env.OTHER_CHAIN_PACK_JSON = JSON.stringify([
  { chainId: 56, token: COIN, symbol: "DOGE", decimals: 8, quote: USDT, quoteSymbol: "USDT", quoteDecimals: 18, floor: (10n * 10n ** 18n).toString(), cap: CAP.toString() },
  { chainId: 1, token: COIN, symbol: "BAD", decimals: 8, quote: USDT, floor: "1", cap: "1" }, // unsupported chain: skipped by config
]);

const { OTHER_CHAIN_PACK, isDryRun } = await import("../src/config.js");
const keeper = await import("../src/keeper.js");
const { store } = await import("../src/store.js");
const { halfmoonInternals } = await import("../src/halfmoon.js");

const ROUTER_BSC = "0xC9f8Faab4708F498942aa9a18Ad1AF857e59A3D7";
const DEAD = "0x000000000000000000000000000000000000dEaD";
type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
function mockHalfMoon(opts: { amountOut: bigint; firmAmountIn?: bigint; router?: string }) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, body });
    if (url.endsWith("/v1/agg-swap/indicativeQuote")) {
      return Response.json({ code: 10000, message: "success", data: { src_chain_id: 56, token_in: body.token_in, token_out: body.token_out, amount_in: body.amount_in, amount_out: opts.amountOut.toString(), fee_rate: 30, fee_amount: "0" } });
    }
    if (url.endsWith("/v1/agg-swap/firmQuote")) {
      return Response.json({
        code: 10000, message: "success",
        data: {
          swap_id: "swap-1", src_chain_id: 56, calldata: Buffer.from("a9059cbb00", "hex").toString("base64"), router_address: opts.router ?? ROUTER_BSC,
          from_address: body.from_address, to_address: body.to_address, token_in: body.token_in, token_out: body.token_out,
          amount_in: (opts.firmAmountIn ?? BigInt(String(body.amount_in))).toString(), amount_out: opts.amountOut.toString(), amount_out_min: body.amount_out_min, fee_rate: 30, fee_amount: "0", deadline: body.deadline,
        },
      });
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  halfmoonInternals.resetCache();
});

test("config: only BSC / Base entries survive, with floor ≤ cap in quote units; no RPC means dry-run", () => {
  assert.equal(OTHER_CHAIN_PACK.length, 1);
  assert.equal(OTHER_CHAIN_PACK[0].chainId, 56);
  assert.equal(OTHER_CHAIN_PACK[0].token, COIN);
  assert.equal(OTHER_CHAIN_PACK[0].cap, CAP.toString());
  assert.equal(isDryRun(56), true);
});

test("dry-run: balance → indicative → firm quote to 0x…dEaD at cap, plan recorded, nothing sent, no ledger row", async () => {
  keeper.startKeeper(); // sets the account; its timers are unref'd
  assert.ok(keeper.keeperAddress());
  mockHalfMoon({ amountOut: 1_000n * 10n ** 8n });
  await keeper.otherChainBurns();
  assert.deepEqual(calls.map((c) => c.url.split("/").slice(-1)[0]), ["indicativeQuote", "firmQuote"], "exactly the two HalfMoon calls, no RPC");
  const firm = calls[1].body;
  assert.equal(firm.to_address, DEAD);
  assert.equal(firm.from_address, keeper.keeperAddress());
  assert.equal(firm.amount_in, CAP.toString(), "no RPC: planned at cap, never above it");
  assert.equal(firm.token_in, USDT);
  assert.equal(firm.token_out, COIN);
  const expectedMin = (1_000n * 10n ** 8n * 9500n) / 10000n; // env fallback: 500 bps
  assert.equal(firm.amount_out_min, expectedMin.toString());
  const view = await keeper.otherChainStatus();
  assert.equal(view.halfmoon, true);
  assert.equal(view.keeper, keeper.keeperAddress());
  assert.equal(view.coins.length, 1);
  const c = view.coins[0];
  assert.equal(c.dryRun, true);
  assert.equal(c.rpc, false);
  assert.equal(c.balance, null);
  assert.equal(c.reason, "dry-run: planned, not sent");
  assert.equal(c.lastError, null);
  assert.ok(c.lastQuote);
  assert.equal(c.lastQuote!.dryRun, true);
  assert.equal(c.lastQuote!.amountIn, CAP.toString());
  assert.equal(c.lastQuote!.amountOutMin, expectedMin.toString());
  assert.equal(c.lastQuote!.routerKnown, true);
  assert.equal(c.lastQuote!.swapId, "swap-1");
  assert.equal(c.lastQuote!.calldataBytes, 5);
  assert.equal(c.burnCount, 0);
  assert.equal(view.ledger.length, 0, "a dry-run writes no ledger row");
  assert.equal(view.lastBurnAt, 0);
  assert.equal(store.pound.length, 0);
});

test("a firm quote that asks for more than planned is refused (the cap is never exceeded)", async () => {
  mockHalfMoon({ amountOut: 1_000n * 10n ** 8n, firmAmountIn: CAP + 1n });
  await keeper.otherChainBurns();
  const c = (await keeper.otherChainStatus()).coins[0];
  assert.match(c.lastError ?? "", /exceeds the planned/);
  assert.equal(store.pound.length, 0);
});

test("an unknown router is flagged in the plan (and would be refused on a funded run)", async () => {
  mockHalfMoon({ amountOut: 1_000n * 10n ** 8n, router: "0x1234567890123456789012345678901234567890" });
  await keeper.otherChainBurns();
  const c = (await keeper.otherChainStatus()).coins[0];
  assert.equal(c.lastQuote!.routerKnown, false);
  assert.equal(c.reason, "dry-run: planned, not sent");
});

test("without HalfMoon configured the tick explains itself instead of calling out", async () => {
  delete process.env.HALFMOON_API_KEY;
  await keeper.otherChainBurns();
  assert.equal(calls.length, 0);
  const c = (await keeper.otherChainStatus()).coins[0];
  assert.match(c.reason ?? "", /HalfMoon not configured/);
  process.env.HALFMOON_API_KEY = "test-jwt";
});
