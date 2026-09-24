import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSymbol, descCharsOk, emptyDraft, nameCharsOk, nameDone } from "../lib/draft";

test("names refuse markup and control characters; stories allow line breaks", () => {
  assert.equal(nameCharsOk("Robin Dog"), true);
  assert.equal(nameCharsOk("<script>"), false);
  assert.equal(nameCharsOk('say "hi"'), false);
  assert.equal(nameCharsOk("tab\there"), false);
  assert.equal(descCharsOk("line one\nline two"), true);
  assert.equal(descCharsOk("a `code` word"), false);
});

test("tickers are upper-case letters and digits, capped", () => {
  assert.equal(cleanSymbol("rdog"), "RDOG");
  assert.equal(cleanSymbol("r-d o.g!!"), "RDOG");
  assert.equal(cleanSymbol("abcdefghijklmnop"), "ABCDEFGHIJ");
});

test("step 1 is done only with a clean name and ticker", () => {
  const d = { ...emptyDraft(), name: "Robin Dog", symbol: "RDOG" };
  assert.equal(nameDone(d), true);
  assert.equal(nameDone({ ...d, name: "<b>x</b>" }), false);
  assert.equal(nameDone({ ...d, symbol: "" }), false);
  assert.equal(nameDone({ ...d, website: "ftp://x" }), false);
});
