import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, parseAbi } from "viem";
import { buildBuyForCalldata, buildDeliveryTxs, buildQuoteBody, crossBuyReceiverAbi, ZERO_ADDRESS } from "../lib/crossBuy";
import { NETWORKS } from "../lib/networks";

const token = "0x1111111111111111111111111111111111111111" as const;
const buyer = "0x2222222222222222222222222222222222222222" as const;
const ref = "0x3333333333333333333333333333333333333333" as const;
const receiver = "0xEbadbC5Bb65499c17fb68a6234893F984A4A53AA" as const;
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
const base = NETWORKS["robinhood-testnet"].crossBuy!.origins[0];

test("buyFor calldata round-trips; refundTo defaults to the recipient and referrer to none", () => {
  const data = buildBuyForCalldata({ token, minTokensOut: 123n, recipient: buyer, referrer: ref });
  const d = decodeFunctionData({ abi: crossBuyReceiverAbi, data });
  assert.equal(d.functionName, "buyFor");
  assert.deepEqual(d.args, [token, 123n, buyer, buyer, ref]);
  const plain = decodeFunctionData({ abi: crossBuyReceiverAbi, data: buildBuyForCalldata({ token, minTokensOut: 1n, recipient: buyer }) });
  assert.deepEqual(plain.args, [token, 1n, buyer, buyer, ZERO_ADDRESS]);
});

test("an ETH-quoted launch rides as value on one call; an ERC-20 launch is a transfer to the receiver, then buyFor with value 0", () => {
  const calldata = buildBuyForCalldata({ token, minTokensOut: 1n, recipient: buyer });
  const eth = buildDeliveryTxs({ receiver, quoteAsset: ZERO_ADDRESS, delivered: 10n ** 16n, calldata });
  assert.deepEqual(eth, [{ to: receiver, data: calldata, value: (10n ** 16n).toString() }]);

  const erc = buildDeliveryTxs({ receiver, quoteAsset: usdg, delivered: 5_000_000n, calldata });
  assert.equal(erc.length, 2);
  assert.equal(erc[0].to, usdg);
  assert.equal(erc[0].value, "0");
  const t = decodeFunctionData({ abi: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]), data: erc[0].data });
  assert.deepEqual(t.args, [receiver, 5_000_000n]);
  assert.deepEqual(erc[1], { to: receiver, data: calldata, value: "0" });
});

test("the Relay body carries only documented fields; amount equals the txs' total value for an ETH delivery; refundTo is the buyer", () => {
  const calldata = buildBuyForCalldata({ token, minTokensOut: 1n, recipient: buyer });
  const txs = buildDeliveryTxs({ receiver, quoteAsset: ZERO_ADDRESS, delivered: 7n, calldata });
  const body = buildQuoteBody({ user: buyer, origin: base, homeChainId: 4663, quoteAsset: ZERO_ADDRESS, amount: 7n, tradeType: "EXACT_OUTPUT", recipient: buyer, txs });
  assert.deepEqual(Object.keys(body).sort(), ["amount", "destinationChainId", "destinationCurrency", "originChainId", "originCurrency", "recipient", "refundTo", "tradeType", "txs", "user"]);
  assert.equal(body.originChainId, 8453);
  assert.equal(body.destinationChainId, 4663);
  assert.equal(body.originCurrency, base.usdc);
  assert.equal(body.refundTo, buyer);
  assert.equal(body.tradeType, "EXACT_OUTPUT");
  assert.equal(BigInt(body.amount), body.txs!.reduce((n, t) => n + BigInt(t.value), 0n));
  for (const t of body.txs!) assert.deepEqual(Object.keys(t).sort(), ["data", "to", "value"]);

  const probe = buildQuoteBody({ user: buyer, origin: base, homeChainId: 4663, quoteAsset: usdg, amount: 1_000_000n, tradeType: "EXACT_INPUT", recipient: buyer });
  assert.equal("txs" in probe, false);
  assert.equal(probe.destinationCurrency, usdg);
});

test("cross-chain buy is configured on the Robinhood networks only: the testnet has the receiver, the mainnet waits for its deploy", () => {
  const tn = NETWORKS["robinhood-testnet"].crossBuy;
  assert.ok(tn);
  assert.equal(tn.receiver, receiver);
  assert.deepEqual(
    tn.origins.map((o) => [o.chainId, o.usdc, o.usdcDecimals]),
    [
      [8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6],
      [56, "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18],
    ],
  );
  for (const o of tn.origins) {
    assert.ok(o.label.length > 0 && /^https:\/\//.test(o.rpc) && /^https:\/\//.test(o.explorer), `${o.chainId}: rpc / explorer`);
    assert.match(o.nativeSymbol, /^[A-Z]{3}$/);
  }
  const mn = NETWORKS.robinhood.crossBuy;
  assert.ok(mn);
  assert.equal(mn.receiver, undefined);
  assert.deepEqual(mn.origins, tn.origins);
  for (const k of ["testnet", "mainnet", "base"] as const) assert.equal(NETWORKS[k].crossBuy, undefined, `${k}: no cross-chain buy`);
});
