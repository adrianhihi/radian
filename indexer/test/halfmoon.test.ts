import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// The client reads HALFMOON_API_KEY from process.env at call time and uses the
// global fetch, so each case installs its own key and mock before calling.
const KEY = "test-jwt-never-logged";
process.env.HALFMOON_API_KEY = KEY;
const hm = await import("../src/halfmoon.js");

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

/** Installs a fetch mock that answers each call from `answers` in order (the last one repeats). */
function mockFetch(answers: { status?: number; body?: unknown; text?: string }[]) {
  let i = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const a = answers[Math.min(i++, answers.length - 1)];
    const text = a.text ?? JSON.stringify(a.body ?? {});
    return new Response(text, { status: a.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  process.env.HALFMOON_API_KEY = KEY;
  hm.halfmoonInternals.retryDelayMs = 0;
  hm.halfmoonInternals.resetCache();
});

test("envelope: data is unwrapped, the bearer key is sent, listings are filtered per chain and cached 60 s", async () => {
  mockFetch([
    {
      body: {
        code: 10000, message: "success",
        data: { pairs: [
          { id: 1, chain_id: 56, base_token: "0xAAAA000000000000000000000000000000000001", quote_token: "0xBBBB000000000000000000000000000000000002", pair_symbol: "DOGE/USDT", fee_rate: 30, is_enabled: true, status: "ACTIVE", min_trade_amount: "1000" },
          { id: 2, chain_id: 8453, base_token: "0xCCCC000000000000000000000000000000000003", quote_token: "0xDDDD000000000000000000000000000000000004", pair_symbol: "ETH/USDC", fee_rate: 10, is_enabled: true, status: "ACTIVE", min_trade_amount: "1" },
        ] },
      },
    },
  ]);
  const bsc = await hm.listPairs(56);
  assert.equal(bsc.length, 1);
  assert.equal(bsc[0].pairSymbol, "DOGE/USDT");
  assert.equal(bsc[0].baseToken, "0xaaaa000000000000000000000000000000000001", "addresses are lower-cased");
  assert.equal(bsc[0].feeRateBps, 30);
  assert.equal(calls[0].url, "https://rfq.halfmoondex.com/v1/listing/pairs");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  const base = await hm.listPairs(8453);
  assert.equal(base.length, 1);
  assert.equal(calls.length, 1, "second listing call served from the cache");
  const all = await hm.listPairs();
  assert.equal(all.length, 2);
});

test("a business failure (code != 10000) becomes a typed HalfMoonError with the doc's label", async () => {
  mockFetch([{ body: { code: 10030, message: "no MM can fill 1e30", data: null } }]);
  await assert.rejects(
    hm.indicativeQuote({ chainId: 56, tokenIn: "0x0000000000000000000000000000000000000001", tokenOut: "0x0000000000000000000000000000000000000002", amountIn: 10n ** 30n }),
    (e: unknown) => {
      assert.ok(e instanceof hm.HalfMoonError);
      assert.equal(e.code, 10030);
      assert.equal(e.label, "insufficient liquidity");
      assert.equal(e.endpoint, "/v1/agg-swap/indicativeQuote");
      assert.ok(!e.message.includes(KEY), "the key never appears in an error");
      return true;
    },
  );
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.src_chain_id, 56);
  assert.equal(body.dst_chain_id, 56, "same-chain only");
  assert.equal(body.amount_in, (10n ** 30n).toString(), "amounts travel as decimal strings");
});

test("firmQuote decodes the base64 calldata to hex and the amounts to bigint", async () => {
  const data = Buffer.from("deadbeef0102", "hex").toString("base64");
  mockFetch([
    {
      body: {
        code: 10000, message: "success",
        data: {
          swap_id: "swap-77", src_chain_id: 8453, calldata: data, router_address: "0xEC462c303970BD8175Ef8A43aCE23241359175f9",
          from_address: "0x1111111111111111111111111111111111111111", to_address: "0x000000000000000000000000000000000000dEaD",
          token_in: "0x2222222222222222222222222222222222222222", token_out: "0x3333333333333333333333333333333333333333",
          amount_in: "1000000", amount_out: "123456789", amount_out_min: "120000000", fee_rate: 10, fee_amount: "1000", deadline: 1700000000,
        },
      },
    },
  ]);
  const q = await hm.firmQuote({
    chainId: 8453, from: "0x1111111111111111111111111111111111111111", to: "0x000000000000000000000000000000000000dEaD",
    tokenIn: "0x2222222222222222222222222222222222222222", tokenOut: "0x3333333333333333333333333333333333333333",
    amountIn: 1000000n, amountOutMin: 120000000n, deadline: 1700000000,
  });
  assert.equal(q.calldata, "0xdeadbeef0102");
  assert.equal(q.routerAddress, "0xec462c303970bd8175ef8a43ace23241359175f9");
  assert.equal(q.swapId, "swap-77");
  assert.equal(q.amountIn, 1000000n);
  assert.equal(q.amountOut, 123456789n);
  assert.equal(q.amountOutMin, 120000000n);
  assert.equal(q.deadline, 1700000000);
  assert.equal(q.to, "0x000000000000000000000000000000000000dead");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.to_address, "0x000000000000000000000000000000000000dEaD");
  assert.equal(body.amount_out_min, "120000000");
  assert.equal(body.deadline, 1700000000);
});

test("decodeCalldata rejects garbage and passes hex through", () => {
  assert.equal(hm.decodeCalldata("0xABcd"), "0xabcd");
  assert.equal(hm.decodeCalldata(Buffer.from([0x12, 0x34]).toString("base64")), "0x1234");
  assert.throws(() => hm.decodeCalldata("not base64!!"), hm.HalfMoonError);
});

test("HTTP 429 is retried once, then surfaces as a typed error if it repeats", async () => {
  mockFetch([
    { status: 429, body: { code: 429, message: "too many requests" } },
    { body: { code: 10000, message: "success", data: { tokens: [{ id: 1, chain_id: 56, token_address: "0xAAAA000000000000000000000000000000000001", token_symbol: "DOGE", token_name: "Dogecoin", decimals: 8, is_enabled: true }] } } },
  ]);
  const tokens = await hm.listTokens(56);
  assert.equal(calls.length, 2, "one retry after the 429");
  assert.equal(tokens[0].symbol, "DOGE");
  assert.equal(tokens[0].decimals, 8);

  calls = [];
  hm.halfmoonInternals.resetCache();
  mockFetch([{ status: 429, body: { code: 429, message: "too many requests" } }]);
  await assert.rejects(hm.listTokens(56), (e: unknown) => e instanceof hm.HalfMoonError && e.code === 429 && e.label === "rate limited");
  assert.equal(calls.length, 2, "exactly one retry, never a loop");
});

test("reportTxHash posts (quote_id, tx_hash) pairs and skips an empty list", async () => {
  mockFetch([{ body: { code: 10000, message: "success", data: {} } }]);
  await hm.reportTxHash(56, []);
  assert.equal(calls.length, 0);
  await hm.reportTxHash(56, [{ quoteId: "swap-1", txHash: "0xabc" }]);
  assert.equal(calls[0].url, "https://rfq.halfmoondex.com/v1/quote/reportTxHash");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { chain_id: 56, pairs: [{ quote_id: "swap-1", tx_hash: "0xabc" }] });
});

test("without HALFMOON_API_KEY every call throws a clear 'not configured' error before any request", async () => {
  delete process.env.HALFMOON_API_KEY;
  mockFetch([{ body: { code: 10000, data: {} } }]);
  assert.equal(hm.isHalfMoonConfigured(), false);
  await assert.rejects(hm.listPairs(), hm.HalfMoonNotConfiguredError);
  await assert.rejects(hm.firmQuote({ chainId: 56, from: "0x1111111111111111111111111111111111111111", to: "0x000000000000000000000000000000000000dEaD", tokenIn: "0x2222222222222222222222222222222222222222", tokenOut: "0x3333333333333333333333333333333333333333", amountIn: 1n, amountOutMin: 0n, deadline: 1 }), /HalfMoon not configured/);
  assert.equal(calls.length, 0, "no request leaves the process without a key");
  globalThis.fetch = realFetch;
});
