import { test } from "node:test";
import assert from "node:assert/strict";
import { en, zh } from "../lib/i18n/dict";

// Both languages carry exactly the same keys (the types enforce it for zh; this guards
// the other direction and any drift in a refactor) and the same {placeholders} per key,
// so a translation can never silently drop a variable.
const vars = (s: string) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();

test("every dictionary key exists in both languages", () => {
  const a = Object.keys(en).sort();
  const b = Object.keys(zh).sort();
  assert.deepEqual(a, b);
});

test("every key keeps the same placeholders in both languages", () => {
  const bad: string[] = [];
  for (const k of Object.keys(en) as (keyof typeof en)[]) {
    const ve = vars(en[k]);
    const vz = vars(zh[k]);
    if (JSON.stringify(ve) !== JSON.stringify(vz)) bad.push(`${k}: en ${ve.join(",")} / zh ${vz.join(",")}`);
  }
  assert.deepEqual(bad, []);
});

test("no dictionary string is empty", () => {
  for (const [k, v] of Object.entries(en)) assert.ok(v.length > 0, k);
  for (const [k, v] of Object.entries(zh)) assert.ok(v.length > 0, k);
});
