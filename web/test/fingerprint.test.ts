import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint } from "../lib/ui/fingerprint";

test("a fingerprint is three words, stable, case-insensitive, and changes with any byte", () => {
  const a = "0x6db9a7fF776c7091C0A3c9847bD8a43eBA6892D8";
  const f = fingerprint(a);
  assert.match(f, /^[a-z]+-[a-z]+-[a-z]+$/);
  assert.equal(fingerprint(a.toLowerCase()), f);
  assert.notEqual(fingerprint(a.slice(0, -1) + "9"), f, "last byte changed");
  assert.notEqual(fingerprint("0x7db9a7fF776c7091C0A3c9847bD8a43eBA6892D8"), f, "first byte changed");
  assert.equal(fingerprint("not an address"), "");
});
