import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTxError } from "../lib/txError";

test("wallet and node failures classify by shape", () => {
  assert.equal(classifyTxError({ name: "UserRejectedRequestError", shortMessage: "User rejected the request." }).kind, "rejected");
  assert.equal(classifyTxError(new Error("insufficient funds for gas * price + value")).kind, "gas");
  assert.equal(classifyTxError({ name: "ContractFunctionExecutionError", shortMessage: "execution reverted: Slippage" }).kind, "reverted");
  assert.equal(classifyTxError(new Error("Request timed out")).kind, "timeout");
  assert.equal(classifyTxError({ name: "HttpRequestError", message: "HTTP request failed" }).kind, "network");
  assert.equal(classifyTxError(new Error("something odd")).kind, "unknown");
  assert.equal(classifyTxError(null).kind, "unknown");
});
